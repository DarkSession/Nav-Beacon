import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { TestBed } from '@angular/core/testing';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { captureCheckpoint } from '../../domain/ships/build/modeled-build-checkpoint';
import { FIXTURE_SLOTS, defaultBuild } from '../../domain/ships/outfitting/outfitting.fixtures';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import type { BuildCandidate } from '../active-build/active-build.models';
import { OutfittingStore } from './outfitting.store';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/**
 * The store's two promises, checked from the outside.
 *
 * One: looking is free. Selecting a mount, opening a chooser, typing a query
 * and closing again must leave the build's revision exactly where it was, or
 * undo would fill up with things nobody decided (FR-018).
 *
 * Two: a refusal costs nothing. The build, the revision and every editing field
 * a Commander had open stay as they were.
 */

function candidateFor(loadout = defaultBuild()): BuildCandidate {
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

describe('outfitting store', () => {
  let store: OutfittingStore;
  let active: ActiveBuildStore;
  let coordinator: BuildIngressCoordinator;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    coordinator = TestBed.inject(BuildIngressCoordinator);
    store = TestBed.inject(OutfittingStore);
    // Replacing an unsaved build asks first, so the tests that replace one
    // answer yes. That question is feature 001's and is not what is under test.
    active.commit(candidateFor());
  });

  it('spends no revision on selection, surface or query changes', () => {
    const revision = active.revision();

    store.select(FIXTURE_SLOTS.core);
    store.showSurface('replacement');
    store.setQuery('multi');
    store.showSurface('engineering');
    store.select(null);

    expect(active.revision()).toBe(revision);
  });

  it('commits exactly one revision for one changed decision', () => {
    const revision = active.revision();

    const result = store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });

    expect(result.kind).toBe('committed');
    expect(active.revision()).toBe(revision + 1);
    expect(active.loadout()?.fittedModuleAt(FIXTURE_SLOTS.fittedOptional)).toBeNull();
  });

  it('keeps the build, the revision and every editing field after a refusal', () => {
    store.select(FIXTURE_SLOTS.cargoHatch);
    store.showSurface('replacement');
    store.setQuery('hatch');
    const before = captureCheckpoint(active.loadout()!);
    const revision = active.revision();

    // The package reports the cargo hatch as immovable, so removal is an
    // operation it does not offer.
    const result = store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.cargoHatch });

    expect(result.kind).toBe('refused');
    expect(active.revision()).toBe(revision);
    expect(captureCheckpoint(active.loadout()!)).toEqual(before);
    expect(store.selectedSlotKey()).toBe(FIXTURE_SLOTS.cargoHatch);
    expect(store.surface()).toBe('replacement');
    expect(store.query()).toBe('hatch');
    expect(store.lastEditFailure()?.category).toBe('unavailableOperation');
  });

  it('clears selection, surface and query when the build is replaced', async () => {
    store.select(FIXTURE_SLOTS.core);
    store.showSurface('engineering');
    store.setQuery('plant');

    await coordinator.commit(() => ({ ok: true, candidate: candidateFor() }));

    // Back to where the canvas opens: the first mount of the new build, not a
    // bench with nothing in it — the reference draws no such screen.
    expect(store.selectedSlotKey()).toBe(store.slots()[0]?.key);
    expect(store.surface()).toBe('workspace');
    expect(store.query()).toBe('');
    expect(store.lastEditFailure()).toBeNull();
  });

  it('preserves editing state when an incoming build is refused', async () => {
    store.select(FIXTURE_SLOTS.core);
    store.showSurface('replacement');
    store.setQuery('plant');

    const result = await coordinator.commit(() => ({ ok: false, reason: 'refused' }));

    expect(result.kind).toBe('failed');
    // Nothing arrived, so nothing about what the Commander was doing changed.
    expect(store.selectedSlotKey()).toBe(FIXTURE_SLOTS.core);
    expect(store.surface()).toBe('replacement');
    expect(store.query()).toBe('plant');
  });

  it('refuses every intent while there is no build', () => {
    active.clear();

    const result = store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') {
      return;
    }
    expect(result.failure.category).toBe('unavailableOperation');
    expect(store.hasBuild()).toBe(false);
  });

  it('clears a previous refusal once a decision succeeds', () => {
    store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.cargoHatch });
    expect(store.lastEditFailure()).not.toBeNull();

    store.dispatch({ kind: 'remove', slotKey: FIXTURE_SLOTS.fittedOptional });

    expect(store.lastEditFailure()).toBeNull();
  });
});

/**
 * Fitting, replacing and removing (US1).
 *
 * The behaviours that make an edit trustworthy rather than merely successful: a
 * replacement starts from stock rather than inheriting what was there, remove
 * is offered only where the package permits it, and a refusal leaves the build,
 * the snapshot, the revision and everything derived from them exactly as they
 * were.
 */
describe('outfitting store - fitting', () => {
  let store: OutfittingStore;
  let active: ActiveBuildStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideLocalization(), ...provideIsolatedLocaleEnvironment()],
    });
    active = TestBed.inject(ActiveBuildStore);
    store = TestBed.inject(OutfittingStore);
    active.commit(candidateFor());
  });

  it('fits the exact package record the choice was built from', () => {
    store.select(FIXTURE_SLOTS.utility);
    const choice = store.membership()!.choices.find((candidate) => candidate.kind === 'stock')!;

    const result = store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.utility,
      choiceKey: choice.key,
    });

    expect(result.kind).toBe('committed');
    expect(active.loadout()?.fittedModuleAt(FIXTURE_SLOTS.utility)?.symbol).toBe(
      choice.module.symbol,
    );
  });

  it('carries no previous engineering into a replacement', () => {
    store.select(FIXTURE_SLOTS.thrusters);
    active.loadout()!.applyBlueprint(FIXTURE_SLOTS.thrusters, 'Engine_Dirty', {
      grade: 5,
      quality: 1,
    });
    active.touch();

    const fitted = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!.symbol;
    const choice = store
      .membership()!
      .choices.find(
        (candidate) => candidate.kind === 'stock' && candidate.module.symbol !== fitted,
      )!;

    store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.thrusters,
      choiceKey: choice.key,
    });

    // A different module is a different article. Inheriting the old blueprint
    // would be this application deciding what the new one is engineered to.
    expect(active.loadout()?.fittedModuleAt(FIXTURE_SLOTS.thrusters)?.engineering).toBeUndefined();
  });

  it('carries the mount\u2019s power group and off state into a replacement', () => {
    store.select(FIXTURE_SLOTS.thrusters);

    // A Commander's two decisions about this mount, made through the store so
    // they are exactly the edits the power controls dispatch.
    store.dispatch({ kind: 'setPriority', slotKey: FIXTURE_SLOTS.thrusters, priority: 3 });
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.thrusters, enabled: false });

    const fitted = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!.symbol;
    const choice = store
      .membership()!
      .choices.find(
        (candidate) => candidate.kind === 'stock' && candidate.module.symbol !== fitted,
      )!;
    const revision = active.revision();

    const result = store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.thrusters,
      choiceKey: choice.key,
    });

    // The package resets all three of `On`, `Priority` and `Health` on a fit
    // and says to set them again where a screen keeps a group across a swap.
    // This one does: the group is the mount's, not the article's
    // (FR-015, Commander request 2026-08-27).
    expect(result.kind).toBe('committed');
    const swapped = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!;
    expect(swapped.symbol).toBe(choice.module.symbol);
    expect(swapped.priority).toBe(3);
    expect(swapped.on).toBe(false);

    // And it is one decision, not three: the carry rides inside the fit's own
    // operation, so one undo puts the whole swap back.
    expect(active.revision()).toBe(revision + 1);
    store.undo();
    expect(active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!.symbol).toBe(fitted);
  });

  it('carries the mount\u2019s power state onto a pre-engineered variant too', () => {
    // `setPreEngineeredVariant` is the other package operation a fit can be,
    // and it resets the mount exactly as `setModule` does. Same carry, same
    // code path — asserted because "same code path" is a claim about today.
    store.select(FIXTURE_SLOTS.frameShiftDrive);
    store.dispatch({ kind: 'setPriority', slotKey: FIXTURE_SLOTS.frameShiftDrive, priority: 2 });
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.frameShiftDrive, enabled: false });

    const variant = store.membership()!.choices.find((candidate) => candidate.kind === 'variant');
    expect(variant).toBeDefined();

    const result = store.dispatch({
      kind: 'fitVariant',
      slotKey: FIXTURE_SLOTS.frameShiftDrive,
      choiceKey: variant!.key,
    });

    expect(result.kind).toBe('committed');
    const fitted = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.frameShiftDrive)!;
    expect(fitted.preEngineeredVariant).not.toBeNull();
    expect(fitted.priority).toBe(2);
    expect(fitted.on).toBe(false);
  });

  it('keeps the mount\u2019s power state when a purchase is put back', () => {
    // `restorePurchase` re-applies the article's own variant, which is the same
    // package call a variant fit makes and resets the mount the same way. It is
    // reached from the engineering panel rather than the chooser, and a
    // Commander does not think of it as replacing anything — which is exactly
    // why losing the group there would be harder to notice, not easier.
    store.select(FIXTURE_SLOTS.frameShiftDrive);
    const variant = store.membership()!.choices.find((candidate) => candidate.kind === 'variant');
    expect(variant).toBeDefined();
    store.dispatch({
      kind: 'fitVariant',
      slotKey: FIXTURE_SLOTS.frameShiftDrive,
      choiceKey: variant!.key,
    });

    store.dispatch({ kind: 'setPriority', slotKey: FIXTURE_SLOTS.frameShiftDrive, priority: 4 });
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.frameShiftDrive, enabled: false });

    store.dispatch({ kind: 'restorePurchase', slotKey: FIXTURE_SLOTS.frameShiftDrive });

    const fitted = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.frameShiftDrive)!;
    expect(fitted.preEngineeredVariant).not.toBeNull();
    expect(fitted.priority).toBe(4);
    expect(fitted.on).toBe(false);
  });

  it('carries a stated on-state as readily as a stated off one', () => {
    // Switched off and on again, which is how a mount comes to state `On: true`
    // without an import — every journal and SLEF loadout states it on every
    // module, so this is the ordinary case rather than the odd one.
    store.select(FIXTURE_SLOTS.thrusters);
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.thrusters, enabled: false });
    store.dispatch({ kind: 'setEnabled', slotKey: FIXTURE_SLOTS.thrusters, enabled: true });

    const before = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!;
    expect(before.on).toBe(true);

    const choice = store
      .membership()!
      .choices.find(
        (candidate) => candidate.kind === 'stock' && candidate.module.symbol !== before.symbol,
      )!;
    store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.thrusters,
      choiceKey: choice.key,
    });

    // Writing it back preserves a field the build had; it does not add one.
    // Carrying only an explicit `false` turned a stated `true` into an absence,
    // so an imported build exported one field fewer than it was read from
    // (FR-015; reported in review 2026-08-27).
    expect(active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!.on).toBe(true);
  });

  it('writes no power field a replaced module did not carry', () => {
    store.select(FIXTURE_SLOTS.thrusters);

    // A mount that really is occupied, and a module that really does say
    // nothing about its power. Both matter: on an empty mount every assertion
    // below reads `undefined` off a `null`, and on a choice that is already
    // fitted the transaction returns `unchanged` and edits nothing — either way
    // the test would pass without the rule holding.
    const before = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!;
    expect(before.priority).toBeUndefined();
    expect(before.on).toBeUndefined();

    const choice = store
      .membership()!
      .choices.find(
        (candidate) => candidate.kind === 'stock' && candidate.module.symbol !== before.symbol,
      )!;
    const result = store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.thrusters,
      choiceKey: choice.key,
    });

    // An unstated group is group 1 and an unstated `on` is on, both answered by
    // the package. Carrying them across as written values would put fields in
    // the build that no Commander set (FR-015).
    expect(result.kind).toBe('committed');
    const swapped = active.loadout()!.fittedModuleAt(FIXTURE_SLOTS.thrusters)!;
    expect(swapped.symbol).toBe(choice.module.symbol);
    expect(swapped.symbol).not.toBe(before.symbol);
    expect(swapped.priority).toBeUndefined();
    expect(swapped.on).toBeUndefined();
  });

  it('fits a pre-engineered variant through the package own operation', () => {
    store.select(FIXTURE_SLOTS.frameShiftDrive);
    const variant = store.membership()!.choices.find((candidate) => candidate.kind === 'variant');
    expect(variant).toBeDefined();

    const result = store.dispatch({
      kind: 'fitVariant',
      slotKey: FIXTURE_SLOTS.frameShiftDrive,
      choiceKey: variant!.key,
    });

    expect(result.kind).toBe('committed');
    expect(
      active.loadout()?.fittedModuleAt(FIXTURE_SLOTS.frameShiftDrive)?.preEngineeredVariant,
    ).not.toBeNull();
  });

  it('retains no choice across a revision, rebuilding the set instead', () => {
    store.select(FIXTURE_SLOTS.utility);
    const before = store.membership()!;
    expect(before.buildRevision).toBe(active.revision());

    active.touch();
    const after = store.membership()!;

    // A different set, read at the new revision - not the old one carried
    // forward. That is what makes "no candidate retained across revisions" a
    // property of the design rather than a rule someone has to remember.
    expect(after).not.toBe(before);
    expect(after.buildRevision).toBe(active.revision());
    expect(after.buildRevision).not.toBe(before.buildRevision);
  });

  it('offers remove only where the package reports the mount removable', () => {
    store.select(FIXTURE_SLOTS.core);
    expect(store.selectedCapabilities()?.canRemove).toBe(false);

    store.select(FIXTURE_SLOTS.fittedOptional);
    expect(store.selectedCapabilities()?.canRemove).toBe(true);
  });

  /**
   * A family toggle is looking, not deciding.
   *
   * It is the same promise as selecting a mount or typing a query, and it is
   * worth its own test because the open set lives *inside* the query state:
   * writing to it must not rebuild that state, or every toggle would re-sort
   * and re-fold hundreds of choices (FR-021, decision 15).
   */
  describe('module families', () => {
    it('spends no revision, no history step and no rebuilt index on a toggle', () => {
      store.select(FIXTURE_SLOTS.fittedHardpoint);
      const revision = active.revision();
      const before = store.candidateQuery()!;
      const familyId = [...before.openFamilies][0]!;

      store.toggleFamily(familyId);
      const after = store.candidateQuery()!;

      expect(after.openFamilies.has(familyId)).toBe(false);
      expect(active.revision()).toBe(revision);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
      // The ordered choices and the folded index are the same objects: a toggle
      // reads nothing from the package and rebuilds nothing.
      expect(after.choices).toBe(before.choices);
      expect(after.index).toBe(before.index);
      expect(after.results).toBe(before.results);
    });

    it('opens the fitted module\u2019s family and no other', () => {
      store.select(FIXTURE_SLOTS.fittedHardpoint);
      const state = store.candidateQuery()!;

      expect(state.fittedFamilyId).not.toBeNull();
      expect([...state.openFamilies]).toEqual([state.fittedFamilyId]);
    });

    it('keeps the Commander\u2019s open set across a rebuild at the same mount', () => {
      store.select(FIXTURE_SLOTS.fittedHardpoint);
      const closed = store.candidateQuery()!.openFamilies.values().next().value!;

      store.toggleFamily(closed);
      expect([...store.candidateQuery()!.openFamilies]).toEqual([]);

      // Fitting a module, undoing a fit and redoing one all rebuild the chooser
      // at a new revision for the same mount, the same language and the same
      // search — so the reveals are still about what is in front of the
      // Commander and survive it (FR-021, Commander request 2026-08-31).
      active.touch();

      expect([...store.candidateQuery()!.openFamilies]).toEqual([]);
    });

    it('seeds again when the search changes, whatever the Commander had open', () => {
      store.select(FIXTURE_SLOTS.fittedHardpoint);
      const seeded = [...store.candidateQuery()!.openFamilies];
      for (const familyId of seeded) {
        store.toggleFamily(familyId);
      }
      expect([...store.candidateQuery()!.openFamilies]).toEqual([]);

      // A different search is a different presentation, and the seed is what a
      // presentation opens with (FR-023).
      store.setQuery('pulse');
      expect([...store.candidateQuery()!.openFamilies].length).toBeGreaterThan(0);

      // Clearing it is a different presentation again, and an empty search
      // seeds from the fitted module's family (FR-021).
      store.clearQuery();
      expect([...store.candidateQuery()!.openFamilies]).toEqual(seeded);
    });

    it('leaves a family the Commander closed closed when they fit from another', () => {
      // The report, at the level it was made: search on a phone, close one
      // family, fit a module from a different one, and the closed family opened
      // again (Commander request 2026-08-31).
      store.select(FIXTURE_SLOTS.hardpoint);
      store.setQuery('laser');

      const families = [
        ...new Set(store.candidateQuery()!.results.map((choice) => choice.presentation.familyId)),
      ];
      expect(families.length).toBeGreaterThan(1);
      const [closed, kept] = families;

      // Both open, whatever the search seeded, and then one closed.
      for (const familyId of [closed!, kept!]) {
        if (!store.candidateQuery()!.openFamilies.has(familyId)) {
          store.toggleFamily(familyId);
        }
      }
      store.toggleFamily(closed!);
      expect(store.candidateQuery()!.openFamilies.has(closed!)).toBe(false);

      const choice = store
        .candidateQuery()!
        .results.find(
          (candidate) => candidate.kind === 'stock' && candidate.presentation.familyId === kept,
        )!;
      expect(
        store.dispatch({
          kind: 'fitStock',
          slotKey: FIXTURE_SLOTS.hardpoint,
          choiceKey: choice.key,
        }).kind,
      ).toBe('committed');

      expect(store.candidateQuery()!.openFamilies.has(closed!)).toBe(false);
      expect(store.candidateQuery()!.openFamilies.has(kept!)).toBe(true);
    });

    it('carries the open family exactly one step, and not two', () => {
      // A mount with one family open. Leaving it carries that family to the
      // next mount, which is what makes moving down a row of empty hardpoints
      // keep the category a Commander is working in (FR-021).
      store.select(FIXTURE_SLOTS.fittedHardpoint);
      const carried = [...store.candidateQuery()!.openFamilies][0]!;

      store.select(FIXTURE_SLOTS.hardpoint);
      expect(store.candidateQuery()?.carriedFamilyId).toBe(carried);

      // Nothing is carried out of a chooser with none open. Written only when
      // there was something to carry, the first mount's family outlived the one
      // step it belonged to and seeded a mount two selections later.
      const open = store.candidateQuery()!.openFamilies;
      for (const familyId of [...open]) {
        store.toggleFamily(familyId);
      }
      expect([...store.candidateQuery()!.openFamilies]).toEqual([]);

      store.select(FIXTURE_SLOTS.utility);
      expect(store.candidateQuery()?.carriedFamilyId).toBeNull();
    });
  });

  it('leaves the snapshot, revision and derived results untouched after a refusal', () => {
    store.select(FIXTURE_SLOTS.hardpoint);
    const before = captureCheckpoint(active.loadout()!);
    const revision = active.revision();
    const jump = BuildMetrics.of(active.loadout()!).maxJumpRange();

    // A key no choice in this mount ever carried. It resolves to nothing, which
    // is a refusal rather than a guess at what was meant.
    const result = store.dispatch({
      kind: 'fitStock',
      slotKey: FIXTURE_SLOTS.hardpoint,
      choiceKey: 'a-key-no-choice-has',
    });

    expect(result.kind).toBe('refused');
    expect(active.revision()).toBe(revision);
    expect(captureCheckpoint(active.loadout()!)).toEqual(before);
    expect(BuildMetrics.of(active.loadout()!).maxJumpRange()).toBe(jump);
  });
});
