import { TestBed } from '@angular/core/testing';
import type {
  SchematicDocument,
  SchematicSide,
  SideAssetState,
} from '../../domain/ships/anatomy/anatomy-model';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { FIXTURE_SLOTS, defaultBuild } from '../../domain/ships/outfitting/outfitting.fixtures';
import { AlmanacSchematicLoader } from '../../platform/assets/almanac-schematic-loader';
import { ActiveBuildStore } from '../active-build/active-build.store';
import type { BuildCandidate } from '../active-build/active-build.models';
import { OutfittingStore } from '../outfitting/outfitting.store';
import { AnatomyStore } from './anatomy.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/**
 * What the store publishes, and what it refuses to publish.
 *
 * The loader is replaced by a fake whose answers are handed over one at a time,
 * because every rule worth asserting here is about *when* a result is allowed
 * to become state: after a hull change, after a retry, after an abort. A
 * request that has been overtaken must be dropped rather than relabelled, and
 * the only way to see that is to control the moment each one resolves.
 */

class FakeLoader {
  readonly asked: { symbol: string; side: SchematicSide; signal?: AbortSignal }[] = [];
  readonly #pending: { side: SchematicSide; settle: (state: SideAssetState) => void }[] = [];

  load(symbol: string, side: SchematicSide, signal?: AbortSignal): Promise<SideAssetState> {
    this.asked.push({ symbol, side, signal });
    return new Promise((resolve) => this.#pending.push({ side, settle: resolve }));
  }

  /** Settles the oldest outstanding request for one side. */
  async settle(side: SchematicSide, state: SideAssetState): Promise<void> {
    const index = this.#pending.findIndex((request) => request.side === side);
    const [request] = this.#pending.splice(index, 1);
    request.settle(state);
    await Promise.resolve();
    await Promise.resolve();
  }

  get outstanding(): number {
    return this.#pending.length;
  }
}

function documentWith(side: SchematicSide, journalSlot: string): SchematicDocument {
  return {
    side,
    symbol: 'Anaconda',
    viewBox: '0 0 10 10',
    content: { x: 0, y: 0, width: 10, height: 10 },
    annotations: [
      {
        feature: journalSlot.startsWith('Tiny') ? 'utility_mount' : 'hardpoint',
        journalSlot,
        centre: { x: 2, y: 2 },
      },
    ],
  };
}

function candidate(hull = 'Anaconda'): BuildCandidate {
  return {
    loadout: defaultBuild(hull),
    suppliedFit: suppliedFit(defaultBuild(hull).shipSymbol),
    hullName: hull,
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  };
}

describe('AnatomyStore', () => {
  let loader: FakeLoader;
  let store: AnatomyStore;
  let active: ActiveBuildStore;
  let outfitting: OutfittingStore;

  beforeEach(() => {
    loader = new FakeLoader();
    TestBed.configureTestingModule({
      providers: [
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        { provide: AlmanacSchematicLoader, useValue: loader },
      ],
    });
    active = TestBed.inject(ActiveBuildStore);
    outfitting = TestBed.inject(OutfittingStore);
    store = TestBed.inject(AnatomyStore);
    TestBed.tick();
  });

  it('asks for nothing while no build is open', () => {
    expect(loader.asked).toEqual([]);
    expect(store.symbol()).toBeNull();
    expect(store.projection().items).toEqual([]);
  });

  it('asks for exactly the active hull two schematics, once', () => {
    active.commit(candidate());
    TestBed.tick();

    expect(loader.asked.map(({ symbol, side }) => ({ symbol, side }))).toEqual([
      { symbol: 'Anaconda', side: 'top' },
      { symbol: 'Anaconda', side: 'bottom' },
    ]);
  });

  it('publishes every mount before either side arrives', () => {
    active.commit(candidate());
    TestBed.tick();

    const { items } = store.projection();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.sides.length === 0)).toBe(true);
  });

  it('renders a ready side as soon as it arrives, without waiting for its peer', async () => {
    active.commit(candidate());
    TestBed.tick();

    await loader.settle('top', {
      kind: 'ready',
      document: documentWith('top', FIXTURE_SLOTS.hardpoint),
    });

    expect(store.sides().top.kind).toBe('ready');
    expect(store.sides().bottom.kind).toBe('loading');
    expect(store.projection().occurrences.top.map((o) => o.item.key)).toEqual([
      FIXTURE_SLOTS.hardpoint,
    ]);
  });

  it('leaves one side failing without touching the other or the mounts', async () => {
    active.commit(candidate());
    TestBed.tick();

    await loader.settle('bottom', { kind: 'temporarilyUnavailable' });
    await loader.settle('top', {
      kind: 'ready',
      document: documentWith('top', FIXTURE_SLOTS.hardpoint),
    });

    expect(store.sides().bottom).toEqual({ kind: 'temporarilyUnavailable' });
    expect(store.sides().top.kind).toBe('ready');
    expect(store.projection().items.length).toBeGreaterThan(0);
  });

  it('discards a completion for a hull that is no longer open', async () => {
    active.commit(candidate('Anaconda'));
    TestBed.tick();
    active.commit(candidate('Adder'));
    TestBed.tick();

    // The first hull's top schematic lands late. It describes a ship that is
    // not on screen, so it must not become state.
    await loader.settle('top', {
      kind: 'ready',
      document: documentWith('top', FIXTURE_SLOTS.hardpoint),
    });

    expect(store.sides().top.kind).toBe('loading');
    expect(loader.asked.filter((request) => request.symbol === 'Adder')).toHaveLength(2);
  });

  it('does not refetch a valid document when the build is edited', async () => {
    active.commit(candidate());
    TestBed.tick();
    await loader.settle('top', {
      kind: 'ready',
      document: documentWith('top', FIXTURE_SLOTS.hardpoint),
    });
    const asked = loader.asked.length;

    outfitting.select(FIXTURE_SLOTS.fittedHardpoint);
    outfitting.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedHardpoint });
    TestBed.tick();

    expect(loader.asked).toHaveLength(asked);
    expect(store.sides().top.kind).toBe('ready');
  });

  it('reprojects fitted state on an edit, at the same geometry', async () => {
    active.commit(candidate());
    TestBed.tick();
    await loader.settle('top', {
      kind: 'ready',
      document: documentWith('top', FIXTURE_SLOTS.fittedHardpoint),
    });
    const before = store.projection().items.find((i) => i.key === FIXTURE_SLOTS.fittedHardpoint);
    expect(before?.fitted).toBe(true);

    outfitting.select(FIXTURE_SLOTS.fittedHardpoint);
    outfitting.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedHardpoint });

    const after = store.projection().items.find((i) => i.key === FIXTURE_SLOTS.fittedHardpoint);
    expect(after?.fitted).toBe(false);
    expect(store.projection().occurrences.top).toHaveLength(1);
  });

  describe('retry', () => {
    it('asks for one side again and leaves the other alone', async () => {
      active.commit(candidate());
      TestBed.tick();
      await loader.settle('bottom', { kind: 'temporarilyUnavailable' });

      store.retry('bottom');

      expect(loader.asked.filter((r) => r.side === 'bottom')).toHaveLength(2);
      expect(loader.asked.filter((r) => r.side === 'top')).toHaveLength(1);
      expect(store.sides().bottom).toEqual({ kind: 'loading' });
    });

    it('puts the retry on the hull’s own abort signal', async () => {
      // A retry left running past a hull change is a request for a ship nobody
      // is looking at. Its result could not be published either way — the
      // per-side counter has moved on — but without the signal the connection
      // is spent anyway.
      active.commit(candidate());
      TestBed.tick();
      await loader.settle('bottom', { kind: 'temporarilyUnavailable' });

      store.retry('bottom');

      const retried = loader.asked.filter((request) => request.side === 'bottom').at(-1);
      expect(retried?.signal).toBeDefined();
      expect(retried?.signal?.aborted).toBe(false);

      active.commit(candidate('Sidewinder'));
      TestBed.tick();

      expect(retried?.signal?.aborted).toBe(true);
    });

    it('asks again for what did not arrive when connectivity returns', async () => {
      active.commit(candidate());
      TestBed.tick();
      await loader.settle('bottom', { kind: 'temporarilyUnavailable' });
      await loader.settle('top', { kind: 'contractDefect' });

      store.retryUnavailable();

      expect(loader.asked.filter((r) => r.side === 'bottom')).toHaveLength(2);
      // A file that arrived and was wrong is not a connectivity problem.
      expect(loader.asked.filter((r) => r.side === 'top')).toHaveLength(1);
    });
  });

  describe('the shown side', () => {
    beforeEach(async () => {
      active.commit(candidate());
      TestBed.tick();
      await loader.settle('top', {
        kind: 'ready',
        document: documentWith('top', FIXTURE_SLOTS.hardpoint),
      });
      await loader.settle('bottom', {
        kind: 'ready',
        document: documentWith('bottom', FIXTURE_SLOTS.utility),
      });
    });

    it('opens on top', () => {
      expect(store.visibleSide()).toBe('top');
    });

    it('does not move for the selection a freshly opened build arrives with', async () => {
      // A hull whose first mount is underneath: nobody chose it, so nothing
      // should flip the plate away from the side the capability opens on.
      active.commit(candidate('Adder'));
      TestBed.tick();
      await loader.settle('bottom', {
        kind: 'ready',
        document: documentWith('bottom', outfitting.slots()[0].key),
      });
      await loader.settle('top', { kind: 'loading' });
      TestBed.tick();

      expect(store.visibleSide()).toBe('top');
    });

    it('follows a chosen side, and spends no revision doing it', () => {
      const revision = active.revision();

      store.showSide('bottom');
      TestBed.tick();

      expect(store.visibleSide()).toBe('bottom');
      expect(active.revision()).toBe(revision);
    });

    it('moves to a side that draws the selected mount', () => {
      outfitting.select(FIXTURE_SLOTS.utility);
      TestBed.tick();

      expect(store.visibleSide()).toBe('bottom');
    });

    it('stays where it is when the shown side already draws the selection', () => {
      store.showSide('bottom');

      outfitting.select(FIXTURE_SLOTS.utility);
      TestBed.tick();

      expect(store.visibleSide()).toBe('bottom');
    });

    it('stays where a Commander put it while a mount that side draws is selected', () => {
      outfitting.select(FIXTURE_SLOTS.utility);
      TestBed.tick();

      store.showSide('top');
      TestBed.tick();

      expect(store.visibleSide()).toBe('top');
    });

    it('stays where it is for a mount no side draws', () => {
      store.showSide('bottom');

      outfitting.select(FIXTURE_SLOTS.fittedHardpoint);
      TestBed.tick();

      expect(store.visibleSide()).toBe('bottom');
    });

    it('stays where it is for an internal slot, which has no geometry at all', () => {
      store.showSide('bottom');

      outfitting.select(FIXTURE_SLOTS.core);
      TestBed.tick();

      expect(store.visibleSide()).toBe('bottom');
      expect(store.projection().items.map((i) => i.key)).not.toContain(FIXTURE_SLOTS.core);
    });
  });

  it('publishes one selected identity, feature 002 own', () => {
    active.commit(candidate());
    TestBed.tick();

    outfitting.select(FIXTURE_SLOTS.utility);

    expect(store.selectedKey()).toBe(FIXTURE_SLOTS.utility);
  });
});
