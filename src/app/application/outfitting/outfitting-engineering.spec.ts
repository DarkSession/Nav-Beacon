import { TestBed } from '@angular/core/testing';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import {
  FIXED_REWARD_REGRESSION,
  FIXTURE_SLOTS,
  defaultBuild,
  fixedRewardBuild,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { ActiveBuildStore } from '../active-build/active-build.store';
import type { BuildCandidate } from '../active-build/active-build.models';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { OutfittingStore } from './outfitting.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/**
 * Engineering and power, dispatched through the one edit path.
 *
 * The point of every case here is that three package operations stay three
 * operations. An effect-only edit is not a re-roll, clearing is not an apply
 * with a hole in it, and a power change is not a refit — and a Commander can
 * tell, because what survives each one is different (FR-012, FR-014).
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

describe('outfitting store: engineering and power', () => {
  let store: OutfittingStore;
  let active: ActiveBuildStore;

  function open(loadout: ShipLoadout): void {
    active.commit(candidateFor(loadout));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
  });

  describe('applying a blueprint', () => {
    it('applies recipe, grade and effect as one decision and one revision', () => {
      const build = defaultBuild();
      open(build);
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;
      const revision = active.revision();

      const result = store.dispatch({
        kind: 'applyEngineering',
        slotKey: slot,
        blueprintFdname: 'FSD_LongRange',
        grade: 5,
        effectFdname: effect,
      });

      expect(result.kind).toBe('committed');
      expect(active.revision()).toBe(revision + 1);
      const engineering = active.loadout()?.fittedModuleAt(slot)?.engineering;
      expect(engineering?.BlueprintName).toBe('FSD_LongRange');
      expect(engineering?.Level).toBe(5);
      expect(engineering?.ExperimentalEffect).toBe(effect);
      // Explicit, always. It is the one number the whole feature turns on.
      expect(engineering?.Quality).toBe(1);
    });

    it('refuses a mount the package offers no engineering on, without touching the build', () => {
      open(defaultBuild());
      const revision = active.revision();

      const result = store.dispatch({
        kind: 'applyEngineering',
        slotKey: FIXTURE_SLOTS.cargoHatch,
        blueprintFdname: 'FSD_LongRange',
        grade: 5,
        effectFdname: null,
      });

      expect(result.kind).toBe('refused');
      expect(active.revision()).toBe(revision);
    });
  });

  describe('changing only the effect', () => {
    it('keeps a fixed reward’s blueprint, grade, modifier block and identity', () => {
      const build = fixedRewardBuild();
      open(build);
      const slot = FIXED_REWARD_REGRESSION.slot;
      const before = active.loadout()!.fittedModuleAt(slot)!;
      const baselineModifiers = before.engineering?.Modifiers;
      const effect = build.availableExperimentalEffects(slot)[0]!;

      expect(
        store.dispatch({ kind: 'setExperimental', slotKey: slot, effectFdname: effect }).kind,
      ).toBe('committed');

      const after = active.loadout()!.fittedModuleAt(slot)!;
      expect(after.engineering?.ExperimentalEffect).toBe(effect);
      expect(after.engineering?.BlueprintName).toBe(before.engineering?.BlueprintName);
      expect(after.engineering?.Level).toBe(before.engineering?.Level);
      // The two that make it the article it is. Losing either turns a reward
      // into an ordinary module that happens to be well rolled (FR-012).
      expect(after.preEngineeredVariant?.acquisition).toBe(FIXED_REWARD_REGRESSION.acquisition);
      expect(after.engineering?.Modifiers).not.toEqual(baselineModifiers);

      // And removing it again puts the article back exactly as it was.
      expect(
        store.dispatch({ kind: 'setExperimental', slotKey: slot, effectFdname: null }).kind,
      ).toBe('committed');
      const restored = active.loadout()!.fittedModuleAt(slot)!;
      expect(restored.engineering?.ExperimentalEffect).toBeUndefined();
      expect(restored.preEngineeredVariant?.acquisition).toBe(FIXED_REWARD_REGRESSION.acquisition);
      expect(restored.engineering?.Modifiers).toEqual(baselineModifiers);
    });

    it('preserves the blueprint and grade of ordinary engineering', () => {
      const build = defaultBuild();
      build.applyBlueprint(FIXTURE_SLOTS.frameShiftDrive, 'FSD_LongRange', {
        grade: 4,
        quality: 1,
      });
      open(build);
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;

      store.dispatch({ kind: 'setExperimental', slotKey: slot, effectFdname: effect });

      const engineering = active.loadout()?.fittedModuleAt(slot)?.engineering;
      expect(engineering?.BlueprintName).toBe('FSD_LongRange');
      expect(engineering?.Level).toBe(4);
    });

    it('spends no revision when the effect is already the one asked for', () => {
      const build = fixedRewardBuild();
      open(build);
      const slot = FIXED_REWARD_REGRESSION.slot;
      const revision = active.revision();

      // The article carries no effect, and this asks for none. A revision and a
      // history frame here would mean pressing undo and watching nothing happen.
      const result = store.dispatch({ kind: 'setExperimental', slotKey: slot, effectFdname: null });

      expect(result.kind).toBe('unchanged');
      expect(active.revision()).toBe(revision);
    });

    it('surfaces the package’s own code when it refuses, changing nothing', () => {
      const build = defaultBuild();
      open(build);
      // Unengineered: there is no engineering for an effect to sit on, and the
      // package says so with a structured `unsupported` rather than an exception.
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;
      const revision = active.revision();

      const result = store.dispatch({
        kind: 'setExperimental',
        slotKey: slot,
        effectFdname: effect,
      });

      expect(result.kind).toBe('refused');
      expect(result.kind === 'refused' && result.failure.category).toBe('packageResult');
      // The package's own stable code, kept whole and never parsed into a rule.
      expect(result.kind === 'refused' && result.failure.code).toBe('notEngineered');
      expect(active.revision()).toBe(revision);
      expect(active.loadout()?.fittedModuleAt(slot)?.engineering).toBeUndefined();
    });

    it('does not report a refusal from a previous edit on the next one', () => {
      const build = defaultBuild();
      open(build);
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;
      store.dispatch({ kind: 'setExperimental', slotKey: slot, effectFdname: effect });

      const result = store.dispatch({
        kind: 'applyEngineering',
        slotKey: slot,
        blueprintFdname: 'FSD_LongRange',
        grade: 5,
        effectFdname: effect,
      });

      expect(result.kind).toBe('committed');
    });
  });

  describe('clearing engineering', () => {
    it('removes blueprint and effect together, in one revision', () => {
      const build = defaultBuild();
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const effect = build.availableExperimentalEffects(slot)[0]!;
      build.applyBlueprint(slot, 'FSD_LongRange', {
        grade: 5,
        quality: 1,
        experimentalEffectSymbol: effect,
      });
      open(build);
      const revision = active.revision();

      expect(store.dispatch({ kind: 'clearEngineering', slotKey: slot }).kind).toBe('committed');

      expect(active.revision()).toBe(revision + 1);
      expect(active.loadout()?.fittedModuleAt(slot)?.engineering).toBeUndefined();
    });

    it('differs from removing the effect: the package’s Mercenary identity goes too', () => {
      const build = fixedRewardBuild();
      open(build);
      const slot = FIXED_REWARD_REGRESSION.slot;
      expect(active.loadout()?.fittedModuleAt(slot)?.preEngineeredVariant).not.toBeNull();

      store.dispatch({ kind: 'clearEngineering', slotKey: slot });

      // This is the consequence the editor discloses before it happens: the
      // article stops being identified as a purchase at all.
      expect(active.loadout()?.fittedModuleAt(slot)?.preEngineeredVariant).toBeNull();
    });
  });

  describe('power', () => {
    it('switches a module off without unfitting it', () => {
      const build = defaultBuild();
      open(build);
      const slot = FIXTURE_SLOTS.core;
      const mass = active.loadout()?.fittedModuleAt(slot)?.effectiveStats?.mass;

      expect(store.dispatch({ kind: 'setEnabled', slotKey: slot, enabled: false }).kind).toBe(
        'committed',
      );

      const after = active.loadout()?.fittedModuleAt(slot);
      expect(after?.on).toBe(false);
      // Still fitted, so its mass and its catalogue cost are still in the build
      // (contract, "Power and recalculation").
      expect(after?.symbol).toBeDefined();
      expect(after?.effectiveStats?.mass).toBe(mass);
    });

    it('writes the package’s zero-based group, not the number a Commander reads', () => {
      open(defaultBuild());
      const slot = FIXTURE_SLOTS.core;

      // The interface presents 1–5. What reaches the package is 0–4, and the
      // translation happens once, at the control (contract, "Operations").
      expect(store.dispatch({ kind: 'setPriority', slotKey: slot, priority: 0 }).kind).toBe(
        'committed',
      );
      expect(active.loadout()?.fittedModuleAt(slot)?.priority).toBe(0);

      expect(store.dispatch({ kind: 'setPriority', slotKey: slot, priority: 4 }).kind).toBe(
        'committed',
      );
      expect(active.loadout()?.fittedModuleAt(slot)?.priority).toBe(4);
    });

    it('fabricates no group for a module the source never gave one', () => {
      open(defaultBuild());
      const slot = FIXTURE_SLOTS.core;
      const before = active.loadout()?.fittedModuleAt(slot)?.priority;
      const revision = active.revision();

      expect(before).toBeUndefined();
      // Absent is not zero. Setting the group a Commander never chose, just to
      // have one, would be a decision nobody made.
      expect(store.dispatch({ kind: 'setEnabled', slotKey: slot, enabled: true }).kind).toBe(
        'unchanged',
      );
      expect(active.loadout()?.fittedModuleAt(slot)?.priority).toBeUndefined();
      expect(active.revision()).toBe(revision);
    });

    it('is offered on the cargo hatch, which offers nothing else', () => {
      open(defaultBuild());
      const hatch = FIXTURE_SLOTS.cargoHatch;

      expect(store.dispatch({ kind: 'setEnabled', slotKey: hatch, enabled: false }).kind).toBe(
        'committed',
      );
      expect(active.loadout()?.fittedModuleAt(hatch)?.on).toBe(false);
      expect(store.dispatch({ kind: 'clearEngineering', slotKey: hatch }).kind).toBe('unchanged');
    });

    it('refuses an empty mount rather than throwing at the package', () => {
      const build = defaultBuild();
      build.removeModule(FIXTURE_SLOTS.fittedOptional);
      open(build);
      const revision = active.revision();

      const result = store.dispatch({
        kind: 'setPriority',
        slotKey: FIXTURE_SLOTS.fittedOptional,
        priority: 2,
      });

      expect(result.kind).toBe('refused');
      expect(result.kind === 'refused' && result.failure.category).toBe('unavailableOperation');
      expect(active.revision()).toBe(revision);
    });
  });
});
