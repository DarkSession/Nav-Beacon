import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { baselineFingerprint } from '../../domain/ships/build/build-fingerprint';
import { ActiveBuildStore } from './active-build.store';
import type { BuildCandidate } from './active-build.models';
import { BuildIngressCoordinator, type CandidateOutcome } from './build-ingress.coordinator';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

function setup(): { store: ActiveBuildStore; coordinator: BuildIngressCoordinator } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return {
    store: TestBed.inject(ActiveBuildStore),
    coordinator: TestBed.inject(BuildIngressCoordinator),
  };
}

function candidateFor(symbol: string, saved = false): BuildCandidate {
  const loadout = ShipLoadout.default(symbol);
  return {
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: symbol,
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: saved ? baselineFingerprint(toBuildSnapshotV1(loadout)) : null,
  };
}

const succeeds =
  (symbol: string, saved = false) =>
  (): CandidateOutcome => ({
    ok: true,
    candidate: candidateFor(symbol, saved),
  });

describe('BuildIngressCoordinator', () => {
  it('commits a constructed candidate', async () => {
    const { store, coordinator } = setup();

    const result = await coordinator.commit(succeeds('SideWinder'));

    expect(result.kind).toBe('committed');
    expect(store.loadout()?.shipSymbol).toBe('SideWinder');
  });

  it('replaces unsaved work without asking anything', async () => {
    // Nothing is asked, because there is nothing to lose: a build carrying a
    // decision is in the record autosave keeps it in, and a build still at its
    // hull's package default is in no record because selecting the hull reaches
    // it again (024/FR-001, FR-008, FR-009).
    const { store, coordinator } = setup();
    await coordinator.commit(succeeds('SideWinder'));
    expect(store.dirty()).toBe(true);

    const result = await coordinator.commit(succeeds('Anaconda'));

    expect(result.kind).toBe('committed');
    expect(store.loadout()?.shipSymbol).toBe('Anaconda');
  });

  it('replaces a saved build the same way it replaces an unsaved one', async () => {
    // One path, whatever the build being replaced is. Two would be two places
    // for a build to be half-replaced.
    const { store, coordinator } = setup();
    await coordinator.commit(succeeds('SideWinder', true));
    expect(store.dirty()).toBe(false);

    await coordinator.commit(succeeds('Anaconda'));

    expect(store.loadout()?.shipSymbol).toBe('Anaconda');
  });

  it('leaves active state untouched when construction fails', async () => {
    const { store, coordinator } = setup();
    await coordinator.commit(succeeds('SideWinder', true));

    const result = await coordinator.commit(() => ({ ok: false, reason: 'unknown hull' }));

    expect(result).toEqual({ kind: 'failed', reason: 'unknown hull' });
    expect(store.loadout()?.shipSymbol).toBe('SideWinder');
  });

  it('leaves active state untouched when construction throws', async () => {
    const { store, coordinator } = setup();
    await coordinator.commit(succeeds('SideWinder', true));

    const result = await coordinator.commit(() => {
      throw new Error('the package refused');
    });

    expect(result).toMatchObject({ kind: 'failed', reason: 'the package refused' });
    expect(store.loadout()?.shipSymbol).toBe('SideWinder');
  });

  it('discards a candidate a newer request has already superseded', async () => {
    const { store, coordinator } = setup();
    let release: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => (release = resolve));

    const first = coordinator.commit(async () => {
      await slow;
      return { ok: true, candidate: candidateFor('SideWinder') };
    });
    const second = await coordinator.commit(succeeds('Anaconda'));
    release!();

    expect(await first).toEqual({ kind: 'superseded' });
    expect(second.kind).toBe('committed');
    expect(store.loadout()?.shipSymbol).toBe('Anaconda');
  });

  it('runs every registered sink after a commit, and none after a refusal', async () => {
    const { coordinator } = setup();
    const committed: string[] = [];
    const unregister = coordinator.addSink({
      onCommitted: (candidate) => committed.push(candidate.loadout.shipSymbol),
    });

    await coordinator.commit(succeeds('SideWinder', true));
    await coordinator.commit(() => ({ ok: false, reason: 'no' }));
    expect(committed).toEqual(['SideWinder']);

    unregister();
    await coordinator.commit(succeeds('Anaconda'));
    expect(committed).toEqual(['SideWinder']);
  });
});
