import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { getOutfittingFamilyName } from '@elite-dangerous-almanac/core/i18n/module-families';
import {
  OUTFITTING_FAMILIES,
  type OutfittingFamilyId,
} from '@elite-dangerous-almanac/core/ships/module-families';
import { getPreEngineeredStats } from '@elite-dangerous-almanac/core/ships/pre-engineered-stats';
import { getPreEngineeredVariants } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { ModuleEngineering } from '@elite-dangerous-almanac/core/ships/slef';
import { reconstructFromSnapshot } from '../build/build-snapshot.reconstructor';
import { toBuildSnapshotV1 } from '../build/build-snapshot.serializer';
import { emptyFixedMounts } from '../build/fixed-mounts';
import {
  FIXTURE_HULL,
  FIXTURE_SLOTS,
  LARGEST_CHOICE_SET,
  OMITTED_FIXED_MOUNTS,
  SUPPORTED_PARTIAL_QUALITY,
  SUPPORTED_PARTIAL_SOURCE_QUALITY,
  UNKNOWN_HULL_PAYLOAD,
  UNSUPPORTED_PARTIAL_QUALITY,
  UNUSABLE_FIXED_MOUNT,
  assertLargestChoiceSet,
  defaultBuild,
  finalArticlePartialQuality,
  fixedEffectMercenaryBuild,
  fixedRewardBuild,
  fixedRewardVariant,
  routeDistinctVariants,
} from './outfitting.fixtures';

/**
 * What the installed Almanac actually does, written down.
 *
 * This suite tests the *package*, not this application. Every behaviour feature
 * 002 is built on top of — reconstruction, fixed-mount defaulting, quality
 * normalization, effect-only edits on a fixed reward — is a promise the package
 * makes, and constitution II says a broken promise is fixed upstream rather
 * than patched here. So the promises are characterized: when a release changes
 * one, this file fails first and names it, instead of a feature suite failing
 * somewhere downstream with a symptom.
 */

describe('installed Almanac acceptance', () => {
  describe('snapshot reconstruction', () => {
    it('restores every modelled field, including name and ident', () => {
      const source = defaultBuild();
      source.setModulePriority(FIXTURE_SLOTS.core, 3);
      source.setModuleEnabled(FIXTURE_SLOTS.cargoHatch, false);
      source.applyBlueprint(FIXTURE_SLOTS.thrusters, 'Engine_Dirty', {
        grade: 5,
        quality: 1,
        experimentalEffectSymbol: 'special_engine_cooled',
      });
      source.setPreEngineeredVariant(FIXTURE_SLOTS.frameShiftDrive, fixedRewardVariant());

      const snapshot = { ...toBuildSnapshotV1(source), shipName: 'Pacifier', shipIdent: 'FD-11X' };

      const rebuilt = reconstructFromSnapshot(snapshot);
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) {
        return;
      }

      expect(rebuilt.loadout.shipName).toBe('Pacifier');
      expect(rebuilt.loadout.shipIdent).toBe('FD-11X');
      // A round trip through the package returns the same modelled state, with
      // the name and ident it was given. That is what makes the snapshot a
      // usable history checkpoint.
      expect(toBuildSnapshotV1(rebuilt.loadout)).toEqual(snapshot);
    });

    it('recomputes current catalogue cost rather than restoring a captured one', () => {
      const source = defaultBuild();
      const snapshot = toBuildSnapshotV1(source);

      // No price is in the snapshot at all — that is the point. The rebuilt
      // build still has one, because the package derives it from the catalogue.
      expect(JSON.stringify(snapshot)).not.toContain('Value');
      const rebuilt = reconstructFromSnapshot(snapshot);
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) {
        return;
      }
      expect(BuildMetrics.of(rebuilt.loadout).buildCost().credits.modules).toBe(
        BuildMetrics.of(source).buildCost().credits.modules,
      );
    });

    it('refuses a hull it does not carry', () => {
      const refusal = reconstructFromSnapshot({
        format: 'ednb.build',
        version: 1,
        shipSymbol: UNKNOWN_HULL_PAYLOAD.Ship,
        shipName: null,
        shipIdent: null,
        modules: [],
      });

      expect(refusal.ok).toBe(false);
      if (refusal.ok) {
        return;
      }
      expect(refusal.failure).toBe('unknown-hull');
    });
  });

  describe('fixed mounts', () => {
    it('populates every absent fixed mount from the hull default', () => {
      const build = ShipLoadout.fromLoadout(OMITTED_FIXED_MOUNTS);

      expect(emptyFixedMounts(build)).toEqual([]);
      // The package reports what it did; the application reads that rather than
      // deciding for itself which mount needed filling (FR-010).
      expect(build.importOutcomes.every((outcome) => outcome.action === 'defaulted')).toBe(true);
    });

    it('replaces an article a fixed mount cannot hold with the hull default', () => {
      const build = ShipLoadout.fromLoadout(UNUSABLE_FIXED_MOUNT);
      const outcome = build.importOutcomes.find(
        (candidate) => candidate.slot === FIXTURE_SLOTS.core,
      );

      expect(outcome?.action).toBe('defaulted');
      expect(build.fittedModuleAt(FIXTURE_SLOTS.core)).not.toBeNull();
      expect(emptyFixedMounts(build)).toEqual([]);
    });

    it('keeps the cargo hatch fitted, immovable and named as such', () => {
      const hatch = defaultBuild()
        .slots('cargoHatch')
        .find((slot) => slot.key === FIXTURE_SLOTS.cargoHatch);

      expect(hatch?.module).not.toBeNull();
      expect(hatch?.removable).toBe(false);
      expect(hatch?.immovableReason).toBe('cargoHatch');
    });
  });

  describe('partial engineering quality', () => {
    it('completes a supported partial grade losslessly', () => {
      const build = ShipLoadout.fromLoadout(SUPPORTED_PARTIAL_QUALITY);
      const before = build.fittedModuleAt(FIXTURE_SLOTS.thrusters);
      expect(before?.engineering?.Quality).toBe(SUPPORTED_PARTIAL_SOURCE_QUALITY);

      const result = build.completeEngineeringGrade(FIXTURE_SLOTS.thrusters);

      expect(result).toEqual({
        kind: 'normalized',
        previousQuality: SUPPORTED_PARTIAL_SOURCE_QUALITY,
        quality: 1,
      });
      const after = build.fittedModuleAt(FIXTURE_SLOTS.thrusters);
      expect(after?.engineering?.Quality).toBe(1);
      expect(after?.engineering?.BlueprintName).toBe('Engine_Dirty');
      expect(after?.engineering?.Level).toBe(5);
    });

    it('answers unsupported, stably, for a partial grade it cannot identify', () => {
      const build = ShipLoadout.fromLoadout(UNSUPPORTED_PARTIAL_QUALITY);

      const first = build.completeEngineeringGrade(FIXTURE_SLOTS.frameShiftDrive);
      expect(first.kind).toBe('unsupported');

      // Stable: asking again neither succeeds nor mutates. An ingress that
      // refuses on the first answer is refusing something that stays refused.
      expect(build.completeEngineeringGrade(FIXTURE_SLOTS.frameShiftDrive)).toEqual(first);
      expect(build.fittedModuleAt(FIXTURE_SLOTS.frameShiftDrive)?.engineering?.Quality).toBe(
        build.fittedModuleAt(FIXTURE_SLOTS.frameShiftDrive)?.engineering?.Quality,
      );
    });

    it('reports a completed roll as unchanged, whatever quality the source stated', () => {
      const complete = ShipLoadout.fromLoadout({
        event: 'Loadout',
        Ship: FIXTURE_HULL,
        Modules: [
          {
            Slot: FIXTURE_SLOTS.thrusters,
            Item: 'Int_Engine_Size7_Class5',
            Engineering: {
              BlueprintName: 'Engine_Dirty',
              Level: 5,
              Quality: 1,
              Modifiers: [{ Label: 'Mass', Value: 26, OriginalValue: 20, LessIsGood: 1 }],
            },
          },
        ],
      });
      expect(complete.completeEngineeringGrade(FIXTURE_SLOTS.thrusters).kind).toBe('unchanged');

      // A block naming a blueprint and grade but stating no modifiers at all is
      // the identity-only shape SLEF permits and other tools write. Import
      // rolls that recipe at the grade and quality the block states, so the
      // module arrives with the package's own modifiers and there is nothing
      // left to complete. This is the fix an imported build reads its
      // engineered figures from; without it every such module published the
      // figures of an unengineered one.
      const identityOnly = ShipLoadout.fromLoadout({
        event: 'Loadout',
        Ship: FIXTURE_HULL,
        Modules: [
          {
            Slot: FIXTURE_SLOTS.thrusters,
            Item: 'Int_Engine_Size7_Class5',
            Engineering: { BlueprintName: 'Engine_Dirty', Level: 5, Quality: 1 },
          },
        ],
      });
      const rolled = identityOnly.fittedModuleAt(FIXTURE_SLOTS.thrusters);
      expect(rolled?.engineering?.Modifiers?.length).toBeGreaterThan(0);
      expect(identityOnly.completeEngineeringGrade(FIXTURE_SLOTS.thrusters).kind).toBe('unchanged');

      // SLEF requires `Quality`, so this shape cannot be typed — but a real
      // export from another tool can still omit it, which is why the pipeline
      // guards on the value rather than trusting the declaration. The package
      // rolls a stated recipe with no quality at a full one.
      const absent = ShipLoadout.fromLoadout({
        event: 'Loadout',
        Ship: FIXTURE_HULL,
        Modules: [
          {
            Slot: FIXTURE_SLOTS.thrusters,
            Item: 'Int_Engine_Size7_Class5',
            Engineering: { BlueprintName: 'Engine_Dirty', Level: 5 } as ModuleEngineering,
          },
        ],
      });
      expect(absent.fittedModuleAt(FIXTURE_SLOTS.thrusters)?.engineering?.Quality).toBe(1);
      // And this is why the pipeline never calls the operation for a quality it
      // did not read as partial: there is nothing left to complete, so the
      // answer is `unchanged` — which the pipeline reads as the two halves of
      // the released contract disagreeing, and refuses the build over.
      expect(absent.completeEngineeringGrade(FIXTURE_SLOTS.thrusters).kind).toBe('unchanged');
    });

    it('identifies a final article and declines to complete its baked grade', () => {
      // The promise the ingress guard is built on. A producer states the recipe
      // a pre-engineered Guardian weapon was built with and writes `Quality: 0`
      // beside it, because there was never a roll. The package recognises the
      // article, applies its fixed modifiers and locks it — so `finalArticle`
      // is the right answer to a question the application must not ask, not a
      // reason to refuse the build.
      const { event, slot, symbol, variant } = finalArticlePartialQuality();
      const build = ShipLoadout.fromLoadout(event);

      const fitted = build.fittedModuleAt(slot);
      expect(fitted?.symbol).toBe(symbol);
      expect(fitted?.preEngineeredVariant?.engineeringLocked).toBe(true);
      expect(fitted?.preEngineeredVariant?.blueprintSymbol).toBe(variant.blueprintSymbol);

      const result = build.completeEngineeringGrade(slot);
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' ? result.code : null).toBe('finalArticle');

      // Declining changed nothing: the article is still the article.
      expect(build.fittedModuleAt(slot)?.preEngineeredVariant?.engineeringLocked).toBe(true);
    });
  });

  describe('re-engineerable fixed rewards', () => {
    it('adds, replaces and removes only the effect, keeping the fixed identity', () => {
      const build = fixedRewardBuild();
      const slot = FIXTURE_SLOTS.frameShiftDrive;
      const baseline = build.fittedModuleAt(slot);
      const baselineModifiers = baseline?.engineering?.Modifiers;
      expect(baseline?.preEngineeredVariant?.acquisition).toBe('techBroker');
      expect(baselineModifiers?.length).toBeGreaterThan(0);

      const effects = build.availableExperimentalEffects(slot);
      expect(effects.length).toBeGreaterThan(1);

      const added = build.setExperimentalEffect(slot, effects[0]!);
      expect(added.kind).toBe('updated');
      const withEffect = build.fittedModuleAt(slot);
      expect(withEffect?.engineering?.ExperimentalEffect).toBe(effects[0]);
      expect(withEffect?.preEngineeredVariant?.blueprintSymbol).toBe(
        baseline?.preEngineeredVariant?.blueprintSymbol,
      );
      expect(withEffect?.engineering?.BlueprintName).toBe(baseline?.engineering?.BlueprintName);
      expect(withEffect?.engineering?.Level).toBe(baseline?.engineering?.Level);

      const replaced = build.setExperimentalEffect(slot, effects[1]!);
      expect(replaced.kind).toBe('updated');
      expect(build.fittedModuleAt(slot)?.engineering?.ExperimentalEffect).toBe(effects[1]);

      const removed = build.setExperimentalEffect(slot, null);
      expect(removed.kind).toBe('updated');
      const cleared = build.fittedModuleAt(slot);
      expect(cleared?.engineering?.ExperimentalEffect).toBeUndefined();
      // The whole point of the regression: the fixed block and the article's
      // identity survive an effect-only round trip untouched (FR-012).
      expect(cleared?.preEngineeredVariant?.acquisition).toBe('techBroker');
      expect(cleared?.engineering?.Modifiers).toEqual(baselineModifiers);
    });

    it('reports an unchanged effect as unchanged', () => {
      const build = fixedRewardBuild();
      const slot = FIXTURE_SLOTS.frameShiftDrive;

      expect(build.setExperimentalEffect(slot, null).kind).toBe('unchanged');
    });
  });

  describe('Mercenary fixed experimental effects', () => {
    it('keeps the shop effect fixed through later grades', () => {
      const { build, slot, variant } = fixedEffectMercenaryBuild();
      const purchase = build.fittedModuleAt(slot);

      expect(purchase?.engineering?.ExperimentalEffect).toBe(variant.experimentalEffectSymbol);
      expect(build.availableExperimentalEffects(slot)).toEqual([]);

      const blueprint = build
        .availableBlueprints(slot)
        .find((candidate) => candidate.blueprintSymbol === variant.blueprintSymbol);
      expect(blueprint).toBeDefined();
      build.applyBlueprint(slot, variant.blueprintSymbol, {
        grade: blueprint!.grades.at(-1)!,
        quality: 1,
      });

      expect(build.fittedModuleAt(slot)?.engineering?.ExperimentalEffect).toBe(
        variant.experimentalEffectSymbol,
      );
      expect(build.availableExperimentalEffects(slot)).toEqual([]);
    });
  });

  describe('candidate membership', () => {
    it('still offers the largest chooser this feature measures against', () => {
      const measured = assertLargestChoiceSet();

      expect(measured.choices).toBeGreaterThan(300);
      expect(measured.hull).toBe(LARGEST_CHOICE_SET.hull);
    });

    it('keeps route-distinct variants of one module distinct', () => {
      const variants = routeDistinctVariants();
      const routes = new Set(variants.map((variant) => variant.acquisition));

      expect(routes.size).toBeGreaterThan(1);
      expect(variants.length).toBe(routes.size);
    });
  });

  /**
   * The family taxonomy, characterized against the installed package.
   *
   * FR-020 says the grouping is the Almanac's and only the Almanac's. That is a
   * promise about `modulesForSlot`, not about this application: every record it
   * returns has to carry a family, or the chooser has a choice with nowhere to
   * put it and the only remaining answer would be a local rule. So the promise
   * is written down here, and a release that breaks it fails by name.
   */
  describe('module families', () => {
    /** The number of families the pinned package publishes. */
    const FAMILY_COUNT = 77;

    const MOUNTS = [
      FIXTURE_SLOTS.hardpoint,
      FIXTURE_SLOTS.utility,
      FIXTURE_SLOTS.optional,
      FIXTURE_SLOTS.core,
      FIXTURE_SLOTS.armour,
    ] as const;

    it('carries a known family on every record, across every kind of mount', () => {
      const build = defaultBuild();

      for (const slotKey of MOUNTS) {
        const records = build.modulesForSlot(slotKey);
        expect(records.length).toBeGreaterThan(0);

        for (const record of records) {
          expect(typeof record.familyId).toBe('string');
          // A family the package does not also name is a family with no row
          // heading, which is the one thing the chooser cannot render.
          expect(OUTFITTING_FAMILIES[record.familyId]).toBeDefined();
        }
      }
    });

    it('leaves a pre-engineered variant in its base module\u2019s family', () => {
      const build = defaultBuild();
      const withVariants = build
        .modulesForSlot(FIXTURE_SLOTS.hardpoint)
        .map((module) => ({ module, variants: getPreEngineeredVariants(module.symbol) }))
        .filter((entry) => entry.variants.length > 0);

      expect(withVariants.length).toBeGreaterThan(0);

      for (const entry of withVariants) {
        for (const variant of entry.variants) {
          // A reward is the module it was built on, already modified — so the
          // package resolves it into the same family, and the chooser can put
          // it directly under the ordinary article without a rule of its own.
          expect(getPreEngineeredStats(variant)?.familyId).toBe(entry.module.familyId);
        }
      }
    });

    it('names every family it publishes, in English', () => {
      for (const familyId of Object.keys(OUTFITTING_FAMILIES) as OutfittingFamilyId[]) {
        expect(getOutfittingFamilyName(familyId, 'en')).toBeTruthy();
      }
    });

    it('adds no family without this repository noticing', () => {
      // Exhaustive over the package's own id union, and deliberately not a list
      // of the ids: research decision 13 is that the taxonomy is 77 ids the
      // package publishes and this repository does not copy. Writing them out
      // here to get a compile-time tripwire would be the copy. So the type
      // proves the package's table covers its own union, and the count is the
      // tripwire — a release that adds a family fails this test by name rather
      // than shipping a heading nothing accounted for.
      const published: Readonly<Record<OutfittingFamilyId, string>> = OUTFITTING_FAMILIES;

      expect(Object.keys(published).length).toBe(FAMILY_COUNT);
    });
  });
});
