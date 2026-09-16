import { TestBed } from '@angular/core/testing';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { captureCheckpoint } from '../../domain/ships/build/modeled-build-checkpoint';
import { HISTORY_CAPACITY } from '../../domain/ships/outfitting/session-edit-history';
import {
  FIXTURE_SLOTS,
  defaultBuild,
  fixedRewardBuild,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import type { BuildCandidate } from '../active-build/active-build.models';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import { OutfittingStore } from './outfitting.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/**
 * Undo and redo, from the store's side.
 *
 * Two claims run through everything here. One decision is one frame — not the
 * three package calls an engineering apply happens to make, and not the zero a
 * refusal makes. And a restored build is the build: every modelled field back
 * exactly as it was, with the package recomputing everything that follows from
 * them rather than the tape carrying any of it (FR-016, FR-018, edit-history
 * contract).
 */

function candidateFor(loadout: ShipLoadout): BuildCandidate {
  return {
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId: null,
    baseline: null,
  };
}

/** The modelled state, as the tape would capture it. Never a package figure. */
function modelled(loadout: ShipLoadout): string {
  return JSON.stringify(captureCheckpoint(loadout).snapshot);
}

describe('outfitting store: undo and redo', () => {
  let store: OutfittingStore;
  let active: ActiveBuildStore;

  function open(loadout: ShipLoadout = defaultBuild()): void {
    active.commit(candidateFor(loadout));
  }

  function fittedSymbolAt(slotKey: string): string | null {
    return store.loadout()?.fittedModuleAt(slotKey)?.symbol ?? null;
  }

  /** Fits whatever the chooser offers first for a mount, as a Commander would. */
  function fitFirstChoice(slotKey: string): void {
    store.select(slotKey);
    const choice = store.candidateQuery()?.choices[0];
    if (choice === undefined) {
      throw new Error(`The Almanac offers nothing for ${slotKey}.`);
    }
    store.dispatch(
      choice.kind === 'stock'
        ? { kind: 'fitStock', slotKey, choiceKey: choice.key }
        : { kind: 'fitVariant', slotKey, choiceKey: choice.key },
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
  });

  describe('what records a decision', () => {
    it('records one frame for a fit, and undo puts the mount back', () => {
      open();
      const before = modelled(store.loadout()!);
      expect(store.canUndo()).toBe(false);

      fitFirstChoice(FIXTURE_SLOTS.hardpoint);

      expect(store.canUndo()).toBe(true);
      expect(modelled(store.loadout()!)).not.toBe(before);

      store.undo();

      expect(modelled(store.loadout()!)).toBe(before);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);
    });

    it('records one frame for a whole engineering apply, not one per package call', () => {
      const build = defaultBuild();
      open(build);
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;

      // A recipe, a grade and an effect confirmed together are one decision
      // (edit-history contract, "Included decisions").
      store.dispatch({
        kind: 'applyEngineering',
        slotKey: slot,
        blueprintFdname: 'FSD_LongRange',
        grade: 5,
        effectFdname: effect,
      });

      store.undo();

      expect(store.loadout()?.fittedModuleAt(slot)?.engineering).toBeUndefined();
      expect(store.canUndo()).toBe(false);
    });

    it('records one frame each for power, effect and removal', () => {
      open();
      const slot = FIXTURE_SLOTS.fittedHardpoint;

      store.dispatch({ kind: 'setEnabled', slotKey: slot, enabled: false });
      store.dispatch({ kind: 'setPriority', slotKey: slot, priority: 3 });
      store.dispatch({ kind: 'remove', slotKey: slot });

      expect(fittedSymbolAt(slot)).toBeNull();

      store.undo();
      expect(fittedSymbolAt(slot)).not.toBeNull();
      expect(store.loadout()?.fittedModuleAt(slot)?.priority).toBe(3);

      store.undo();
      expect(store.loadout()?.fittedModuleAt(slot)?.priority).not.toBe(3);

      store.undo();
      expect(store.loadout()?.fittedModuleAt(slot)?.on).not.toBe(false);
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('what records nothing', () => {
    it('spends no frame on looking, choosing or searching', () => {
      open();

      store.select(FIXTURE_SLOTS.frameShiftDrive);
      store.showSurface('engineering');
      store.setQuery('drive');
      store.clearQuery();
      store.showSurface('workspace');
      store.select(FIXTURE_SLOTS.cargoHatch);

      // None of it is a decision about the build (FR-018).
      expect(store.canUndo()).toBe(false);
    });

    it('spends no frame on a refusal', () => {
      open();

      const result = store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.cargoHatch });

      expect(result.kind).toBe('refused');
      expect(store.canUndo()).toBe(false);
    });

    it('spends no frame on a command that changed nothing', () => {
      open();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      store.dispatch({ kind: 'setPriority', slotKey: slot, priority: 2 });

      const result = store.dispatch({ kind: 'setPriority', slotKey: slot, priority: 2 });

      expect(result.kind).toBe('unchanged');
      // One frame, from the first one. Pressing undo after a no-op must undo
      // the decision before it, not do nothing visible.
      store.undo();
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('the branch', () => {
    it('is discarded by a new decision after an undo', () => {
      open();
      fitFirstChoice(FIXTURE_SLOTS.hardpoint);
      store.undo();
      expect(store.canRedo()).toBe(true);

      store.dispatch({
        kind: 'setEnabled',
        slotKey: FIXTURE_SLOTS.fittedHardpoint,
        enabled: false,
      });

      expect(store.canRedo()).toBe(false);
    });

    it('returns exactly the state it came from', () => {
      open();
      fitFirstChoice(FIXTURE_SLOTS.hardpoint);
      const fitted = modelled(store.loadout()!);

      store.undo();
      store.redo();

      expect(modelled(store.loadout()!)).toBe(fitted);
      expect(store.canRedo()).toBe(false);
    });

    it('is a no-op at either end', () => {
      open();
      const revision = store.revision();

      expect(store.undo().kind).toBe('unchanged');
      expect(store.redo().kind).toBe('unchanged');
      expect(store.revision()).toBe(revision);
    });
  });

  describe('capacity', () => {
    it('retains the newest hundred of a hundred and one decisions', () => {
      open();
      const slot = FIXTURE_SLOTS.fittedHardpoint;

      // 101 decisions that each change something: the power group, cycled.
      for (let step = 0; step < HISTORY_CAPACITY + 1; step += 1) {
        store.dispatch({
          kind: 'setPriority',
          slotKey: slot,
          priority: ((step % 4) + 1) as 1 | 2 | 3 | 4,
        });
      }

      let steps = 0;
      while (store.canUndo() && steps <= HISTORY_CAPACITY + 5) {
        store.undo();
        steps += 1;
      }

      expect(steps).toBe(HISTORY_CAPACITY);
    });
  });

  describe('restoration', () => {
    it('reproduces every modelled field and lets the package recompute the rest', () => {
      const build = defaultBuild();
      open(build);
      const before = modelled(store.loadout()!);
      const massBefore = store.loadout()!.unladenMass;

      store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });
      expect(store.loadout()!.unladenMass).not.toBe(massBefore);

      store.undo();

      expect(modelled(store.loadout()!)).toBe(before);
      // Recomputed from the restored decisions, not carried on the tape.
      expect(store.loadout()!.unladenMass).toBe(massBefore);
    });

    it('restores a purchased article whole, with its identity', () => {
      open(fixedRewardBuild());
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const variant = store.loadout()?.fittedModuleAt(slot)?.preEngineeredVariant ?? null;
      expect(variant).not.toBeNull();

      store.dispatch({ kind: 'clearEngineering', slotKey: slot });
      expect(store.loadout()?.fittedModuleAt(slot)?.preEngineeredVariant).toBeNull();

      store.undo();

      expect(store.loadout()?.fittedModuleAt(slot)?.preEngineeredVariant?.symbol).toBe(
        variant?.symbol,
      );
    });

    it('restores a package-populated fixed mount as an ordinary decision', () => {
      open();
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const before = fittedSymbolAt(slot);

      fitFirstChoice(slot);
      store.undo();

      // No auxiliary provenance comes back with it: it is the same modelled
      // module the package put there, restored like any other.
      expect(fittedSymbolAt(slot)).toBe(before);
    });

    it('spends one revision per step, so everything downstream re-reads once', () => {
      open();
      fitFirstChoice(FIXTURE_SLOTS.hardpoint);
      const revision = store.revision();

      store.undo();

      expect(store.revision()).toBe(revision + 1);
    });
  });

  describe('the ship’s name and ident', () => {
    it('records one frame for a confirmed name, and undo restores absence', () => {
      open();
      expect(store.loadout()?.shipName).toBeNull();

      store.dispatch({ kind: 'setShipName', value: 'Pacifier' });

      expect(store.loadout()?.shipName).toBe('Pacifier');

      store.undo();

      // Absence, not an empty string: the two are different builds.
      expect(store.loadout()?.shipName).toBeNull();
    });

    it('clears back to absence rather than to an empty string', () => {
      open();
      store.dispatch({ kind: 'setShipName', value: 'Pacifier' });

      store.dispatch({ kind: 'setShipName', value: null });

      expect(store.loadout()?.shipName).toBeNull();
      store.undo();
      expect(store.loadout()?.shipName).toBe('Pacifier');
    });

    it('changes nothing else about the build', () => {
      open();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      const before = fittedSymbolAt(slot);

      store.dispatch({ kind: 'setShipIdent', value: 'FD-11X' });

      expect(store.loadout()?.shipIdent).toBe('FD-11X');
      expect(fittedSymbolAt(slot)).toBe(before);
    });

    it('spends no frame when the value is the one already held', () => {
      open();
      store.dispatch({ kind: 'setShipIdent', value: 'FD-11X' });

      const result = store.dispatch({ kind: 'setShipIdent', value: 'FD-11X' });

      expect(result.kind).toBe('unchanged');
      store.undo();
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('the summaries', () => {
    it('name the decision each direction would move through, in the ledger’s words', () => {
      open();
      store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });

      const summary = store.undoSummary() ?? '';

      expect(summary.length).toBeGreaterThan(0);
      // The mount as the ledger names it, never its package key.
      expect(summary).not.toContain(FIXTURE_SLOTS.fittedOptional);
      expect(store.redoSummary()).toBeNull();

      store.undo();

      expect(store.undoSummary()).toBeNull();
      expect(store.redoSummary()).toBe(summary);
    });

    it('name a rename without naming the name', () => {
      open();
      store.dispatch({ kind: 'setShipName', value: 'Pacifier' });

      // The tape holds no game text and no Commander text either.
      expect(store.undoSummary()).not.toContain('Pacifier');
    });
  });

  describe('replacement', () => {
    it('clears both directions when a different build is accepted', async () => {
      open();
      fitFirstChoice(FIXTURE_SLOTS.hardpoint);
      store.undo();
      expect(store.canRedo()).toBe(true);

      await TestBed.inject(BuildIngressCoordinator).commit(() => ({
        ok: true,
        candidate: candidateFor(defaultBuild()),
      }));

      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });

    it('keeps both directions when an incoming build is refused', async () => {
      open();
      fitFirstChoice(FIXTURE_SLOTS.hardpoint);

      await TestBed.inject(BuildIngressCoordinator).commit(() => ({
        ok: false,
        reason: 'refused',
      }));

      // Nothing replaced the build, so nothing about its history changed.
      expect(store.canUndo()).toBe(true);
    });
  });
});
