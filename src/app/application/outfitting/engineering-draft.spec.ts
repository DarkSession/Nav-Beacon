import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  FIXED_REWARD_REGRESSION,
  FIXTURE_HULL,
  FIXTURE_SLOTS,
  defaultBuild,
  fixedEffectMercenaryBuild,
  fixedRewardBuild,
  mercenaryVariant,
  packageText,
} from '../../domain/ships/outfitting/outfitting.fixtures';
import { WEAPON_FIGURES, weaponFigures } from '../../domain/ships/offence/weapon-figures';
import {
  HIGHER_IS_BETTER,
  NO_BLUEPRINT,
  currentSelection,
  draftIsStale,
  engineeringIntent,
  engineeringOperation,
  openEngineeringDraft,
  openingSelection,
  withBlueprint,
  withEffect,
  withGrade,
  type EngineeringDraft,
  type EngineeringSelection,
} from './engineering-draft';
import { engineeringView } from './engineering-view';
import { fittedModuleView } from './fitted-module-view';

/**
 * The engineering draft, against the installed package.
 *
 * Every menu, grade and identity in here comes from a real `ShipLoadout`. The
 * draft's whole job is to offer exactly what the package offers and nothing
 * else, so a suite that wrote its own menus down would be testing the
 * fabrication rather than the rule (constitution II).
 */

const TEXT = packageText();
const SLOT = FIXTURE_SLOTS.frameShiftDrive;
const NO_SELECTION: EngineeringSelection = {
  blueprintFdname: null,
  grade: null,
  effectFdname: null,
};

/** A draft over the fixture hull's drive, at revision 1. */
function driveDraft(
  selection: EngineeringSelection = { blueprintFdname: null, grade: null, effectFdname: null },
  loadout: ShipLoadout = defaultBuild(),
  revision = 1,
): EngineeringDraft {
  const draft = openEngineeringDraft(loadout, SLOT, revision, selection, TEXT);
  expect(draft).not.toBeNull();
  return draft!;
}

describe('engineering draft', () => {
  describe('menus', () => {
    it('offers exactly the package’s own blueprint menu, in its own order', () => {
      const loadout = defaultBuild();

      const draft = driveDraft(undefined, loadout);

      expect(draft.blueprints).toEqual(loadout.availableBlueprints(SLOT));
      expect(draft.blueprints.length).toBeGreaterThan(0);
    });

    it('offers exactly the package’s own effect menu', () => {
      const loadout = defaultBuild();

      const draft = driveDraft(undefined, loadout);

      expect(draft.effects).toEqual(loadout.availableExperimentalEffects(SLOT));
    });

    it('offers no grade the selected descriptor does not publish', () => {
      const loadout = defaultBuild();
      const descriptor = loadout.availableBlueprints(SLOT)[0]!;

      const draft = driveDraft(
        { blueprintFdname: descriptor.blueprintSymbol, grade: 99, effectFdname: null },
        loadout,
      );

      // A grade the package never published for this recipe is not a grade a
      // Commander can be offered, so it is dropped rather than clamped into one.
      expect(draft.selectedGrade).toBeNull();
      expect(descriptor.grades).not.toContain(99);
    });

    it('drops an effect that is not on this mount’s menu', () => {
      const draft = driveDraft({
        blueprintFdname: null,
        grade: null,
        effectFdname: 'special_no_such_effect',
      });

      expect(draft.selectedEffectFdname).toBeNull();
    });

    it('says the package offers nothing rather than drawing an empty editor', () => {
      const loadout = defaultBuild();
      const hatch = FIXTURE_SLOTS.cargoHatch;
      expect(loadout.availableBlueprints(hatch)).toHaveLength(0);

      const draft = openEngineeringDraft(
        loadout,
        hatch,
        1,
        { blueprintFdname: null, grade: null, effectFdname: null },
        TEXT,
      );

      expect(draft?.packageEmpty).toBe(true);
    });

    it('is nothing at all for an empty mount', () => {
      const loadout = ShipLoadout.empty(FIXTURE_HULL);
      const empty = loadout.slots().find((slot) => slot.module === null);
      expect(empty).toBeDefined();

      expect(
        openEngineeringDraft(
          loadout,
          empty!.key,
          1,
          { blueprintFdname: null, grade: null, effectFdname: null },
          TEXT,
        ),
      ).toBeNull();
    });
  });

  describe('no selection and no blueprint', () => {
    it('opens on what the module already carries, never on “remove it”', () => {
      const loadout = defaultBuild();
      loadout.applyBlueprint(SLOT, 'FSD_LongRange', { grade: 4, quality: 1 });
      const current = engineeringView(fittedModuleView(loadout.fittedModuleAt(SLOT)!, TEXT));

      expect(openingSelection(current)).toEqual({
        blueprintFdname: 'FSD_LongRange',
        grade: 4,
        effectFdname: null,
      });
    });

    it('opens an unengineered module with nothing selected, not with ‘none’', () => {
      const draft = driveDraft();

      // `null` is "the Commander has chosen nothing yet". `'none'` would be the
      // editor proposing to strip a module that has nothing to strip.
      expect(draft.selectedBlueprintFdname).toBeNull();
      expect(draft.selectedBlueprintFdname).not.toBe(NO_BLUEPRINT);
    });

    it('asks for nothing when nothing has been chosen', () => {
      expect(engineeringIntent(driveDraft())).toBeNull();
    });

    it('dispatches clearEngineering for ‘none’, never applyBlueprint', () => {
      const loadout = defaultBuild();
      loadout.applyBlueprint(SLOT, 'FSD_LongRange', { grade: 5, quality: 1 });
      const draft = driveDraft(
        { blueprintFdname: NO_BLUEPRINT, grade: null, effectFdname: null },
        loadout,
      );

      // The package has a word for removing engineering. Using `applyBlueprint`
      // with a hole in it would blur what was asked for (data model).
      expect(engineeringIntent(draft)).toEqual({ kind: 'clearEngineering', slotKey: SLOT });
    });

    it('really does strip the module when ‘none’ is applied', () => {
      const loadout = defaultBuild();
      loadout.applyBlueprint(SLOT, 'FSD_LongRange', { grade: 5, quality: 1 });
      const draft = driveDraft(
        { blueprintFdname: NO_BLUEPRINT, grade: null, effectFdname: null },
        loadout,
      );

      engineeringOperation(engineeringIntent(draft)!)!(loadout);

      expect(loadout.fittedModuleAt(SLOT)?.engineering).toBeUndefined();
    });

    it('clears the effect with the blueprint when ‘none’ is chosen', () => {
      const loadout = defaultBuild();
      const effect = loadout.availableExperimentalEffects(SLOT)[0]!;
      loadout.applyBlueprint(SLOT, 'FSD_LongRange', {
        grade: 5,
        quality: 1,
        experimentalEffectSymbol: effect,
      });
      const draft = driveDraft(
        { blueprintFdname: 'FSD_LongRange', grade: 5, effectFdname: effect },
        loadout,
      );

      // Otherwise the editor would show a chosen effect that the operation it
      // is about to run discards.
      expect(withBlueprint(draft, NO_BLUEPRINT)).toEqual({
        blueprintFdname: NO_BLUEPRINT,
        grade: null,
        effectFdname: null,
      });
    });
  });

  describe('quality', () => {
    it('is the literal 1 on every projection, whatever the block says', () => {
      const loadout = defaultBuild();
      loadout.applyBlueprint(SLOT, 'FSD_LongRange', { grade: 5, quality: 0.42 });

      const draft = driveDraft(undefined, loadout);

      // The application models completed grades only. A roll is not something
      // it can produce, edit or show (FR-013).
      expect(draft.current.quality).toBe(1);
    });

    it('applies at explicit quality 1, never at the package’s default', () => {
      const loadout = defaultBuild();
      const draft = driveDraft(
        { blueprintFdname: 'FSD_LongRange', grade: 5, effectFdname: null },
        loadout,
      );

      engineeringOperation(engineeringIntent(draft)!)!(loadout);

      expect(loadout.fittedModuleAt(SLOT)?.engineering?.Quality).toBe(1);
    });

    it('exposes no roll control of any kind', () => {
      const draft = driveDraft();

      // The draft is the only thing an editor can render a control from, so a
      // quality field absent here is a quality control absent everywhere.
      expect(Object.keys(draft)).not.toContain('quality');
      expect(Object.keys(draft)).not.toContain('selectedQuality');
    });
  });

  describe('purchase identity', () => {
    it('keeps a fixed effect as current state and out of the edit menu', () => {
      const { build, slot, variant } = fixedEffectMercenaryBuild();
      const fitted = fittedModuleView(build.fittedModuleAt(slot)!, TEXT);
      const current = engineeringView(fitted);

      const draft = openEngineeringDraft(build, slot, 1, openingSelection(current), TEXT);

      expect(draft?.current.effectFdname).toBe(variant.experimentalEffectSymbol);
      expect(draft?.selectedEffectFdname).toBeNull();
      expect(draft?.effects).toEqual([]);
    });

    it('keeps the purchase grade separate from the grade now applied', () => {
      const merc = mercenaryVariant();
      const loadout = ShipLoadout.default(FIXTURE_HULL);
      const slot = loadout
        .slots('hardpoint')
        .find((candidate) =>
          loadout.modulesForSlot(candidate.key).some((module) => module.symbol === merc.symbol),
        );
      expect(slot).toBeDefined();
      loadout.setPreEngineeredVariant(slot!.key, merc);

      const draft = openEngineeringDraft(
        loadout,
        slot!.key,
        1,
        { blueprintFdname: null, grade: null, effectFdname: null },
        TEXT,
      );

      // Two different numbers about two different things. Showing one as the
      // other tells a Commander their reward is worse than it is (FR-007).
      expect(draft?.current.purchaseVariant?.grade).toBe(merc.grade);
      expect(draft?.current.currentGrade).toBe(merc.grade);
      expect(draft?.current.purchaseVariant?.blueprintSymbol).toBe(merc.blueprintSymbol);
    });

    it('previews an effect-only change without rolling a reward’s recipe', () => {
      const loadout = fixedRewardBuild();
      const slot = FIXED_REWARD_REGRESSION.slot;
      const effect = loadout.availableExperimentalEffects(slot)[0]!;
      const current = loadout.fittedModuleAt(slot)!;

      const draft = openEngineeringDraft(
        loadout,
        slot,
        1,
        {
          blueprintFdname: current.engineering!.BlueprintName,
          grade: current.engineering!.Level,
          effectFdname: effect,
        },
        TEXT,
      );

      // Nothing about the recipe is moving, so this is the effect operation —
      // the one that keeps the article's hand-set block and its identity
      // (FR-012). Previewing it as a fresh `applyBlueprint` would show a reward
      // that had been rolled into an ordinary module.
      expect(engineeringIntent(draft!)).toEqual({
        kind: 'setExperimental',
        slotKey: slot,
        effectFdname: effect,
      });
    });
  });

  describe('selection transitions', () => {
    it('keeps a grade the new recipe also offers', () => {
      const loadout = defaultBuild();
      const [first, second] = loadout.availableBlueprints(SLOT);
      expect(second).toBeDefined();
      const shared = first!.grades.find((grade) => second!.grades.includes(grade))!;

      const draft = driveDraft(
        { blueprintFdname: first!.blueprintSymbol, grade: shared, effectFdname: null },
        loadout,
      );

      expect(withBlueprint(draft, second!.blueprintSymbol).grade).toBe(shared);
    });

    it('ignores a blueprint the package does not offer here', () => {
      const draft = driveDraft();

      expect(withBlueprint(draft, 'Weapon_Overcharged')).toEqual(currentSelection(draft));
    });

    it('moves the grade and the effect without touching the rest', () => {
      const loadout = defaultBuild();
      const descriptor = loadout.availableBlueprints(SLOT)[0]!;
      const effect = loadout.availableExperimentalEffects(SLOT)[0]!;
      const draft = driveDraft(
        {
          blueprintFdname: descriptor.blueprintSymbol,
          grade: descriptor.grades[0]!,
          effectFdname: null,
        },
        loadout,
      );

      expect(withGrade(draft, descriptor.grades.at(-1)!)).toEqual({
        blueprintFdname: descriptor.blueprintSymbol,
        grade: descriptor.grades.at(-1),
        effectFdname: null,
      });
      expect(withEffect(draft, effect).effectFdname).toBe(effect);
      expect(withEffect(draft, null).effectFdname).toBeNull();
    });
  });

  describe('staleness', () => {
    it('is stale exactly when the build has moved on', () => {
      const draft = driveDraft(undefined, defaultBuild(), 7);

      expect(draftIsStale(draft, 7)).toBe(false);
      expect(draftIsStale(draft, 8)).toBe(true);
    });

    it('rebuilds against the current build rather than reusing the old menus', () => {
      const loadout = defaultBuild();
      const slot = FIXTURE_SLOTS.fittedOptional;
      const descriptor = loadout.availableBlueprints(slot)[0]!;
      const before = openEngineeringDraft(
        loadout,
        slot,
        1,
        {
          blueprintFdname: descriptor.blueprintSymbol,
          grade: descriptor.grades.at(-1)!,
          effectFdname: null,
        },
        TEXT,
      );
      expect(before?.selectedBlueprintFdname).toBe(descriptor.blueprintSymbol);

      // The mount is emptied under the open draft. Rebuilding is what turns a
      // selection about a module that is gone into no selection at all, rather
      // than into a fit the package would refuse after offering it.
      loadout.removeModule(slot);
      const after = openEngineeringDraft(loadout, slot, 2, currentSelection(before!), TEXT);

      expect(after).toBeNull();
    });
  });

  describe('the preview', () => {
    it('describes the modified module against the stock one, from package stats', () => {
      const loadout = defaultBuild();
      const draft = driveDraft(
        { blueprintFdname: 'FSD_LongRange', grade: 5, effectFdname: null },
        loadout,
      );

      expect(draft.preview.kind).toBe('known');
      const attributes = draft.preview.kind === 'known' ? draft.preview.attributes : [];
      expect(attributes.length).toBeGreaterThan(0);
      // Every row has at least one side, or it would not be a row.
      expect(attributes.every((row) => row.stock !== null || row.modified !== null)).toBe(true);
      // The stock column is the package's catalogue record for the fitted
      // article — the reference's own `STOCK` — not the module as it stands.
      const mass = attributes.find((row) => row.attribute === 'mass');
      expect(mass?.stock).toBe(loadout.fittedModuleAt(SLOT)?.stats?.mass);
    });

    it('reads a pre-engineered article’s stock column from the catalogue, not from stats', () => {
      // The package publishes the *resolved* article in `stats` for a fixed
      // pre-engineered variant, so that stats a journal capture left out still
      // describe the article. Taken as the stock column, that prints the same
      // figures in both columns and the engineering the article is bought for
      // is nowhere on the panel (Commander request 2026-08-30).
      const loadout = fixedRewardBuild();
      const draft = driveDraft(NO_SELECTION, loadout);

      const fitted = loadout.fittedModuleAt(SLOT);
      expect(fitted?.preEngineeredVariant).not.toBeNull();

      const catalogued = getModuleBySymbol(FIXED_REWARD_REGRESSION.symbol);
      const resolved = fitted?.stats;
      // The fixture only says something if the two records actually differ.
      // This article's long-range engineering moves its optimal mass furthest.
      expect(catalogued?.optMass).not.toBe(resolved?.optMass);

      const attributes = draft.preview.kind === 'known' ? draft.preview.attributes : [];
      const optMass = attributes.find((row) => row.attribute === 'optMass');
      expect(optMass?.stock).toBe(catalogued?.optMass);
      expect(optMass?.stock).not.toBe(resolved?.optMass);
    });

    it('keeps stats as the stock column for a module the package does not call a variant', () => {
      // The condition is identification, not the article's kind: `stats` is the
      // base catalogue record everywhere else, and a symbol lookup on it would
      // be a second reading of the same thing.
      const loadout = defaultBuild();
      const draft = driveDraft(NO_SELECTION, loadout);

      expect(loadout.fittedModuleAt(SLOT)?.preEngineeredVariant ?? null).toBeNull();
      const attributes = draft.preview.kind === 'known' ? draft.preview.attributes : [];
      const mass = attributes.find((row) => row.attribute === 'mass');
      expect(mass?.stock).toBe(loadout.fittedModuleAt(SLOT)?.stats?.mass);
    });

    it('changes nothing about the build it previewed against', () => {
      const loadout = defaultBuild();
      const before = loadout.fittedModuleAt(SLOT)?.engineering;

      driveDraft({ blueprintFdname: 'FSD_LongRange', grade: 5, effectFdname: null }, loadout);

      // Opening a draft is not a decision. The preview runs on a detached copy,
      // so looking at what a grade 5 would do costs nothing (FR-018).
      expect(loadout.fittedModuleAt(SLOT)?.engineering).toEqual(before);
    });

    it('lists the article and does not compare it when no recipe has been chosen', () => {
      const loadout = defaultBuild();

      const draft = driveDraft({ blueprintFdname: null, grade: null, effectFdname: null }, loadout);

      // An unengineered mount is not an unresolved one. It has every attribute
      // the Almanac catalogued it with, and the panel is where a Commander reads
      // them — but there is nothing yet to compare them against, so there is no
      // second column and no modified figure on any row.
      expect(draft.preview.kind).toBe('known');
      const preview = draft.preview.kind === 'known' ? draft.preview : null;
      expect(preview?.comparing).toBe(false);
      expect(preview?.attributes.length).toBeGreaterThan(0);
      expect(preview?.attributes.every((row) => row.modified === null)).toBe(true);
      const mass = preview?.attributes.find((row) => row.attribute === 'mass');
      expect(mass?.stock).toBe(loadout.fittedModuleAt(SLOT)?.stats?.mass);
    });

    it('shows every attribute the package publishes for the article, not a chosen few', () => {
      const loadout = defaultBuild();

      const draft = driveDraft({ blueprintFdname: null, grade: null, effectFdname: null }, loadout);

      const stats = loadout.fittedModuleAt(SLOT)?.stats;
      const published = Object.entries(stats ?? {})
        // `class` is identity and `cost` is a price, and neither is an
        // attribute of the article — see `COMPARED_ATTRIBUTES`.
        .filter(([, value]) => typeof value === 'number')
        .filter(([field]) => field !== 'class' && field !== 'cost')
        // A boot time of zero is the one published figure the panel leaves
        // off, and the rule it is left off by is its own test below.
        .filter(([field, value]) => !(field === 'bootTime' && value === 0))
        .map(([field]) => field)
        .sort();
      const drawn =
        draft.preview.kind === 'known'
          ? draft.preview.attributes.map((row) => row.attribute as string).sort()
          : [];

      // Not "at least these": exactly these. A field the Almanac publishes on
      // this article and the panel leaves out is a figure a Commander cannot
      // read anywhere, and one the panel invents is a figure nobody measured.
      expect(drawn).toEqual(published);
    });

    it('leaves off a boot time of zero, and keeps one that is not', () => {
      const loadout = defaultBuild();

      const rows = new Map(
        Object.entries(FIXTURE_SLOTS)
          .map(([, slotKey]) => {
            const draft = openEngineeringDraft(loadout, slotKey, 1, NO_SELECTION, TEXT);
            const preview = draft?.preview;
            if (preview === undefined || preview.kind !== 'known') {
              return null;
            }
            const published = loadout.fittedModuleAt(slotKey)?.stats?.bootTime ?? null;
            const drawn = preview.attributes.some((row) => row.attribute === 'bootTime');
            return [slotKey, { published, drawn }] as const;
          })
          .filter((entry) => entry !== null),
      );

      // Both halves of the rule have to be witnessed on the fixture hull, or
      // "hide it" and "hide the row entirely" would pass the same suite.
      const zeros = [...rows.values()].filter((row) => row.published === 0);
      const others = [...rows.values()].filter(
        (row) => typeof row.published === 'number' && row.published !== 0,
      );
      expect(zeros.length).toBeGreaterThan(0);
      expect(others.length).toBeGreaterThan(0);

      expect(zeros.every((row) => !row.drawn)).toBe(true);
      expect(others.every((row) => row.drawn)).toBe(true);
    });

    it('adds the package’s calculated figures for a weapon, on both sides', () => {
      const loadout = defaultBuild();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      // A weapon that stops to reload, so its sustained figures are readings of
      // their own rather than the burst figures written twice.
      loadout.setModule(slot, getModuleBySymbol('Hpt_MultiCannon_Fixed_Small')!);
      const blueprint = loadout.availableBlueprints(slot)[0]!;

      const draft = openEngineeringDraft(
        loadout,
        slot,
        1,
        {
          blueprintFdname: blueprint.blueprintSymbol,
          grade: blueprint.grades.at(-1)!,
          effectFdname: null,
        },
        TEXT,
      );

      const preview = draft?.preview.kind === 'known' ? draft.preview : null;
      const rows = new Map(preview?.attributes.map((row) => [row.attribute as string, row]));
      // Damage per second is the figure the whole recipe is chosen for, and no
      // catalogue field states it. It is the package's own calculation over the
      // same two articles the catalogue rows come from.
      const stock = weaponFigures(loadout.fittedModuleAt(slot)?.stats ?? null);
      // The modified reading, worked out a second time on a build the recipe
      // was actually applied to. `expect.any(Number)` would pass for any
      // wiring at all; this fails unless the panel measured the right article
      // with the right recipe on it.
      const applied = defaultBuild();
      applied.setModule(slot, getModuleBySymbol('Hpt_MultiCannon_Fixed_Small')!);
      applied.applyBlueprint(slot, blueprint.blueprintSymbol, {
        grade: blueprint.grades.at(-1)!,
        quality: 1,
      });
      const modified = weaponFigures(applied.fittedModuleAt(slot)?.effectiveStats ?? null);
      expect(stock).not.toBeNull();
      expect(modified).not.toBeNull();
      // Its one round a shot makes a damage per shot that is its damage, so
      // that row is the only one of the eight this article does not get.
      const drawnFigures = WEAPON_FIGURES.filter((figure) => figure !== 'damagePerShot');
      for (const attribute of drawnFigures) {
        expect(rows.get(attribute)?.stock).toBe(stock?.[attribute]);
        expect(rows.get(attribute)?.modified).toBe(modified?.[attribute]);
      }
      expect(rows.get('damagePerSecond')?.modified).not.toBe(rows.get('damagePerSecond')?.stock);

      // Exactly these rows, the way the drive's own test reads exactly its
      // catalogue fields: a calculated figure the panel invents is a figure
      // nobody measured, and one it drops is a figure a Commander cannot read.
      const stats = loadout.fittedModuleAt(slot)?.stats;
      const published = Object.entries(stats ?? {})
        .filter(([, value]) => typeof value === 'number')
        .filter(([field]) => field !== 'class' && field !== 'cost')
        .filter(([field, value]) => !(field === 'bootTime' && value === 0))
        .map(([field]) => field);
      expect([...rows.keys()].sort()).toEqual([...published, ...drawnFigures].sort());
    });

    it('gives a module that is not a weapon no calculated figures', () => {
      const draft = driveDraft({ blueprintFdname: null, grade: null, effectFdname: null });

      const drawn =
        draft.preview.kind === 'known'
          ? draft.preview.attributes.map((row) => row.attribute as string)
          : [];

      // `weaponMetrics` answers for anything, and its answer for a frame shift
      // drive is a block of zeroes. A zero here is not a reading (constitution
      // IV), so the rows are never offered rather than being drawn and excused.
      for (const attribute of WEAPON_FIGURES) {
        expect(drawn).not.toContain(attribute);
      }
    });

    it('leaves off a sustained figure that repeats the row above it', () => {
      const loadout = defaultBuild();
      // A pulse laser never stops to reload, so it sustains exactly what it
      // starts with and its four sustained figures are four rows written twice.
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      expect(loadout.fittedModuleAt(slot)?.stats?.clipSize).toBeUndefined();

      const draft = openEngineeringDraft(loadout, slot, 1, NO_SELECTION, TEXT);

      const drawn =
        draft?.preview.kind === 'known'
          ? draft.preview.attributes.map((row) => row.attribute as string)
          : [];
      expect(drawn).toEqual(
        expect.arrayContaining(['damagePerSecond', 'energyPerSecond', 'heatPerSecond']),
      );
      for (const attribute of [
        'sustainedDamagePerSecond',
        'sustainedEnergyPerSecond',
        'sustainedHeatPerSecond',
        'sustainedRateOfFire',
        // And it fires one round a shot, so its damage per shot is its damage.
        'damagePerShot',
      ]) {
        expect(drawn).not.toContain(attribute);
      }
    });

    it('keeps a damage per shot that is not the article’s damage', () => {
      const loadout = defaultBuild();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      // A fragment cannon fires twelve rounds a shot, so what one shot lands is
      // not what one round does — and no catalogue row states it.
      loadout.setModule(slot, getModuleBySymbol('Hpt_Slugshot_Fixed_Small')!);

      const draft = openEngineeringDraft(loadout, slot, 1, NO_SELECTION, TEXT);

      const rows = new Map(
        draft?.preview.kind === 'known'
          ? draft.preview.attributes.map((row) => [row.attribute as string, row])
          : [],
      );
      expect(rows.get('roundsPerShot')?.stock).toBeGreaterThan(1);
      expect(rows.get('damagePerShot')?.stock).not.toBe(rows.get('damage')?.stock);
    });

    it('keeps a sustained figure that is a reading on one side only', () => {
      const loadout = defaultBuild();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      loadout.setModule(slot, getModuleBySymbol('Hpt_Cannon_Fixed_Small')!);

      const draft = openEngineeringDraft(
        loadout,
        slot,
        1,
        { blueprintFdname: 'Weapon_RapidFire', grade: 5, effectFdname: null },
        TEXT,
      );

      const row =
        draft?.preview.kind === 'known'
          ? draft.preview.attributes.find((entry) => entry.attribute === 'sustainedDamagePerSecond')
          : undefined;
      // A cannon reloads at stock and stops losing anything to it once rapid
      // fire has shortened the reload. The row is a reading on one side and a
      // repetition on the other, and dropping it would report the reading as
      // lost.
      expect(row?.stock).not.toBe(row?.modified);
      expect(Number.isFinite(row?.stock)).toBe(true);
    });

    it('gives a continuous-fire weapon no calculated figures either', () => {
      const loadout = defaultBuild();
      const slot = FIXTURE_SLOTS.fittedHardpoint;
      loadout.setModule(slot, getModuleBySymbol('Hpt_BeamLaser_Fixed_Small')!);

      const draft = openEngineeringDraft(loadout, slot, 1, NO_SELECTION, TEXT);

      const drawn =
        draft?.preview.kind === 'known'
          ? draft.preview.attributes.map((row) => row.attribute as string)
          : [];
      // A beam's damage, draw and heat are already per second, so the drawn
      // catalogue rows are the reading and a calculated row would repeat one.
      expect(drawn).toContain('damage');
      for (const attribute of WEAPON_FIGURES) {
        expect(drawn).not.toContain(attribute);
      }
    });

    it('marks a calculated figure the way the attribute’s own sense reads', () => {
      // Rapid fire buys its rate of fire with heat. More heat per second is
      // worse and more damage per second is better, and the table that says so
      // is the application's — the Almanac's `LessIsGood` is not read.
      expect(HIGHER_IS_BETTER.damagePerSecond).toBe(true);
      expect(HIGHER_IS_BETTER.sustainedDamagePerSecond).toBe(true);
      expect(HIGHER_IS_BETTER.sustainedRateOfFire).toBe(true);
      expect(HIGHER_IS_BETTER.heatPerSecond).toBe(false);
      expect(HIGHER_IS_BETTER.sustainedHeatPerSecond).toBe(false);
      expect(HIGHER_IS_BETTER.energyPerSecond).toBe(false);
      expect(HIGHER_IS_BETTER.sustainedEnergyPerSecond).toBe(false);
    });
  });
});
