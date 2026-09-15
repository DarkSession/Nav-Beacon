import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  FIXTURE_HULL,
  FIXTURE_SLOTS,
  UNSUPPORTED_PARTIAL_QUALITY,
  defaultBuild,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../i18n/i18n.providers';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { ActiveBuildStore } from '../active-build/active-build.store';
import type { BuildCandidate } from '../active-build/active-build.models';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import { OutfittingStore } from '../outfitting/outfitting.store';
import { SlefImportCoordinator } from './slef-import.coordinator';
import { SlefStore } from './slef.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

const VALID = JSON.stringify({ event: 'Loadout', Ship: FIXTURE_HULL, Modules: [] });

/** Every draft that must leave the build exactly as it found it. */
const REFUSALS: readonly (readonly [string, string])[] = [
  ['an oversized paste', `{"Pad":"${'a'.repeat(70_000)}"}`],
  ['an empty paste', '   \n\t '],
  ['malformed JSON', '{ not json'],
  ['no entries', '[]'],
  ['two entries', JSON.stringify([{ event: 'Loadout', Ship: FIXTURE_HULL, Modules: [] }, {}])],
  ['a rejected entry', JSON.stringify([{ header: {}, data: {} }])],
  ['an unknown hull', JSON.stringify({ event: 'Loadout', Ship: 'Nonexistent_Hull', Modules: [] })],
  ['an unsupported partial roll', JSON.stringify(UNSUPPORTED_PARTIAL_QUALITY)],
];

/**
 * The in-memory session state an import must not disturb.
 *
 * One string, compared whole. Asserting field by field is how a new piece of
 * state gets added and quietly left out of the comparison; this fails the
 * moment anything in it moves (import contract, "Atomicity").
 *
 * What it does *not* reach is what has no provider here: the stored working and
 * named record bytes, and the published fragment and history length. Those are
 * asserted where they actually exist, in `e2e/slef-import.spec.ts` — a fake
 * store compared against itself would prove nothing about either.
 */
function session(active: ActiveBuildStore, outfitting: OutfittingStore): string {
  return JSON.stringify({
    fingerprint: active.fingerprint(),
    revision: active.revision(),
    hullName: active.hullName(),
    provenance: active.provenance(),
    workingRecordId: active.autosaveRecordId(),
    sourceNamed: active.sourceNamed(),
    baseline: active.baselineFingerprint(),
    dirty: active.dirty(),
    link: active.link(),
    validation: active.validation(),
    canUndo: outfitting.canUndo(),
    canRedo: outfitting.canRedo(),
    undoSummary: outfitting.undoSummary(),
    redoSummary: outfitting.redoSummary(),
  });
}

describe('what an import that does not happen costs', () => {
  let active: ActiveBuildStore;
  let outfitting: OutfittingStore;
  let store: SlefStore;
  let replacement: BuildIngressCoordinator;
  let coordinator: SlefImportCoordinator;
  let router: Router;
  let committed: BuildCandidate[];

  /**
   * A session with something to lose: a dirty build off a saved record, a
   * published link and an edit on the undo tape.
   */
  function seed(): void {
    active.commit({
      loadout: defaultBuild(),
      suppliedFit: suppliedFit(defaultBuild().shipSymbol),
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: { recordId: 'record-1', baseRevisionId: 'rev-1' },
      autosaveRecordId: null,
      baseline: null,
    });
    active.setAutosaveRecordId('working-1');
    active.markSaved({ recordId: 'record-1', baseRevisionId: 'rev-1' });
    outfitting.select(FIXTURE_SLOTS.hardpoint);
    const choice = outfitting.candidateQuery()?.choices[0];
    if (choice === undefined) {
      throw new Error('The Almanac offers nothing for the hardpoint.');
    }
    outfitting.dispatch(
      choice.kind === 'stock'
        ? { kind: 'fitStock', slotKey: FIXTURE_SLOTS.hardpoint, choiceKey: choice.key }
        : { kind: 'fitVariant', slotKey: FIXTURE_SLOTS.hardpoint, choiceKey: choice.key },
    );
    active.setLink({ kind: 'published', fragment: 'b.abc', revision: active.revision() });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        // The import coordinator reaches the record repository to store a batch.
        ...provideMemoryStorage(new MemoryStorage()),
      ],
    });
    active = TestBed.inject(ActiveBuildStore);
    outfitting = TestBed.inject(OutfittingStore);
    store = TestBed.inject(SlefStore);
    replacement = TestBed.inject(BuildIngressCoordinator);
    coordinator = TestBed.inject(SlefImportCoordinator);
    router = TestBed.inject(Router);
    committed = [];
    replacement.addSink({
      onCommitted: (candidate) => {
        committed.push(candidate);
      },
    });
  });

  describe('every refusal', () => {
    it.each(REFUSALS)('changes nothing after %s', async (_name, draft) => {
      seed();
      const before = session(active, outfitting);
      store.setDraft(draft);

      const submission = await coordinator.submit();

      expect(submission).toEqual({ kind: 'failed' });
      expect(session(active, outfitting)).toBe(before);
      expect(committed).toHaveLength(0);
    });

    it.each(REFUSALS)('keeps the draft exactly as typed after %s', async (_name, draft) => {
      seed();
      store.setDraft(draft);

      await coordinator.submit();

      expect(store.draft().text).toBe(draft);
    });
  });

  describe('a committed handoff', () => {
    it('stands by the commit even if the layer closes as it lands', async () => {
      // A token issued after feature 001 has written the store cannot un-commit
      // the build, and reporting anything but `committed` would describe an
      // active build as one that never arrived.
      seed();
      store.setDraft(VALID);
      const stop = replacement.addSink({
        onCommitted: () => {
          coordinator.abandon();
          store.closeLayer();
        },
      });

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });
      expect(committed).toHaveLength(1);
      stop();
    });

    it('stands by it when a newer submit is issued as it lands', async () => {
      seed();
      store.setDraft(VALID);
      const stop = replacement.addSink({ onCommitted: () => store.issueToken() });

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });
      expect(committed).toHaveLength(1);
      stop();
    });

    it('stands by it when the Commander navigates as it lands', async () => {
      seed();
      store.setDraft(VALID);
      const stop = replacement.addSink({
        onCommitted: () => {
          void router.navigateByUrl('/outfitting');
          coordinator.abandon();
        },
      });

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });
      expect(committed).toHaveLength(1);
      stop();
    });
  });

  describe('a request nobody answered', () => {
    it('is refused at the handoff when its token is no longer current', async () => {
      seed();
      const before = session(active, outfitting);
      store.setDraft(VALID);
      // The guard is the candidate supplier, which feature 001 calls before it
      // touches the store. A stale token there produces no candidate at all, so
      // there is nothing to commit.
      const stale = store.requestToken - 1;
      const result = await replacement.commit(() => {
        expect(store.isCurrent(stale)).toBe(false);
        return { ok: false, reason: 'stale' };
      });

      expect(result).toEqual({ kind: 'failed', reason: 'stale' });
      expect(session(active, outfitting)).toBe(before);
      expect(committed).toHaveLength(0);
    });

    it('loses to a newer ingress started while it was in flight', async () => {
      // Feature 001's own token decides: the newer request wins, the older one
      // is superseded rather than committed, and the draft it came from is
      // still exactly as it was typed.
      seed();
      const other: BuildCandidate = {
        loadout: ShipLoadout.default('Eagle'),
        suppliedFit: suppliedFit(ShipLoadout.default('Eagle').shipSymbol),
        hullName: 'Eagle',
        provenance: 'stock',
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      };
      store.setDraft(VALID);

      const inFlight = coordinator.submit();
      await replacement.commit(() => ({ ok: true, candidate: other }));

      expect(await inFlight).toEqual({ kind: 'superseded' });
      expect(active.hullName()).toBe('Eagle');
      expect(committed).toEqual([other]);
      expect(store.draft().text).toBe(VALID);
    });
  });

  describe('the accepted import', () => {
    it('is the only path that spends a revision, and spends exactly one', async () => {
      seed();
      const revision = active.revision();
      store.setDraft(VALID);

      expect(await coordinator.submit()).toEqual({ kind: 'committed' });

      expect(committed).toHaveLength(1);
      expect(active.revision()).toBe(revision + 1);
      expect(active.provenance()).toBe('working');
      expect(store.draft().text).toBe('');
    });
  });
});
