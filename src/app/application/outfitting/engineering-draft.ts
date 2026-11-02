import { getMenuBlueprintForModule } from '@elite-dangerous-almanac/core/ships/blueprint-menu';
import {
  getModuleBySymbol,
  type OutfittingModule,
} from '@elite-dangerous-almanac/core/ships/modules';
import type {
  AvailableBlueprint,
  ShipLoadout,
} from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  captureCheckpoint,
  restoreCheckpoint,
} from '../../domain/ships/build/modeled-build-checkpoint';
import { WEAPON_FIGURES, weaponFigures } from '../../domain/ships/offence/weapon-figures';
import type { EditOperation } from '../../domain/ships/outfitting/build-edit-transaction';
import {
  engineeringCost,
  type EngineeringCostView,
} from '../../domain/ships/outfitting/engineering-cost';
import type { BuildEditIntent } from './build-edit-intent';
import { engineeringView, type EngineeringView } from './engineering-view';
import {
  fittedModuleView,
  type FittedModuleView,
  type ModuleTextResolver,
} from './fitted-module-view';
import { carryPower, powerStateOf } from './power-carry';

/**
 * The Commander choosing the package's explicit no-blueprint entry.
 *
 * Kept distinct from `null` all the way through, because they are two different
 * facts and only one of them is an instruction: `null` means nothing has been
 * chosen yet, and `'none'` means "remove the engineering". Collapsing them would
 * make opening the editor look like asking to strip the module, and it would
 * make the apply control's meaning depend on state a Commander cannot see
 * (data model, "EngineeringView and EngineeringDraft").
 */
export const NO_BLUEPRINT = 'none';

/** What a Commander has chosen. Selection only — never build state. */
export interface EngineeringSelection {
  readonly blueprintFdname: string | typeof NO_BLUEPRINT | null;
  readonly grade: number | null;
  /** `null` is an explicit "no effect", which is a choice, not an omission. */
  readonly effectFdname: string | null;
}

/**
 * One package module field the editor compares.
 *
 * Every numeric field the Almanac publishes on a module, and the module's own
 * record decides which of them it has: `previewOf` drops any row neither side
 * carries, so a pulse laser lists its thirteen and a power distributor lists a
 * different seven. There is no shorter list to draw. An earlier pass named six
 * fields by hand, which was this application deciding that a Commander
 * engineering a frame shift drive did not need to see its optimal mass.
 *
 * A fixed, ordered table rather than whatever the package's modifier block
 * happens to name. A journal modifier label — `FSDOptimalMass`, `DamagePerSecond`
 * — is a package identity with no translation anywhere in the Almanac, and
 * echoing one as a column heading would ship an untranslatable English string
 * into a German screen. Each field carries an application-owned localized label
 * the way the chooser's columns already do (FR-020, localization contract).
 *
 * Two numbers are left out. `class` is the article's identity, drawn in the
 * panel's own header as `HUGE MULTI-CANNON 4A`, and no recipe changes it.
 * `cost` is a price rather than an attribute: it is what the module costs to
 * buy, which the manifest row it is bought from states as its own `COST cr`
 * column and which the rail totals for the whole build — not something the
 * article does, and not something a recipe moves (wave 11, Commander request).
 * The package's non-numeric fields are identity or restriction rather than
 * attributes, and are carried elsewhere on the row that states them.
 */
export const COMPARED_ATTRIBUTES = [
  'ammoMaximum',
  'armourPiercing',
  'bootTime',
  'burstInterval',
  'burstRateOfFire',
  'burstRounds',
  'cargoCapacity',
  'causticResistance',
  'chargeTime',
  'clipSize',
  'damage',
  'distributorDraw',
  'engineHeatRate',
  'enginesCapacity',
  'enginesRecharge',
  'explosiveResistance',
  'falloffRange',
  'fsdHeatRate',
  'fuelCapacity',
  'fuelMul',
  'fuelPower',
  'heatEfficiency',
  'hullBoost',
  'hullReinforcement',
  'integrity',
  'interdictorFacingLimit',
  'interdictorRange',
  'jitter',
  'jumpBoost',
  'kineticResistance',
  'mass',
  'maxFuel',
  'maxMass',
  'maxMultiplier',
  'maxRotationMultiplier',
  'maxSpeedMultiplier',
  'maximumRange',
  'minMass',
  'minMultiplier',
  'minRotationMultiplier',
  'minSpeedMultiplier',
  'moduleProtection',
  'optMass',
  'optMultiplier',
  'optRotationMultiplier',
  'optSpeedMultiplier',
  'powerCapacity',
  'powerDraw',
  'probeRadius',
  'rateOfFire',
  'refuelRate',
  'reloadTime',
  'roundsPerShot',
  'scanAngle',
  'scanTime',
  'scannerRange',
  'shieldAddition',
  'shieldBankDuration',
  'shieldBankHeat',
  'shieldBankReinforcement',
  'shieldBankSpinUp',
  'shieldBoost',
  'shieldBrokenRegenRate',
  'shieldRegenRate',
  'shotSpeed',
  'systemsCapacity',
  'systemsRecharge',
  'thermalLoad',
  'thermalResistance',
  'weaponsCapacity',
  'weaponsRecharge',
] as const;

/**
 * The table draws what the package calculates as well as what it catalogues.
 *
 * Damage per second is what a Commander engineering a weapon is deciding
 * about, and no catalogue field states it: a recipe that trades rate of fire
 * for damage per round moves both rows and leaves the reader to multiply. The
 * Almanac publishes the calculation, so the panel shows the package's own
 * answer beside the stats it was worked out from (FR-012a). `weaponFigures`
 * decides which articles have one, and which of its numbers are readings
 * rather than echoes of a catalogue row.
 */
export type ComparedAttribute =
  (typeof COMPARED_ATTRIBUTES)[number] | (typeof WEAPON_FIGURES)[number];

/**
 * Which way is better, per attribute.
 *
 * The canvas colours a modified figure green or red and marks it ▲ or ▼, and
 * the direction is not the arithmetic one: it draws `Power Draw 0.88 ▼` for a
 * figure that went up. So the direction is a property of the attribute, not of
 * the number, and it is stated here — six fields this application chose to
 * compare, each with the sense the canvas gives it.
 *
 * The Almanac's own `LessIsGood` is documented as unreliable and is not used.
 * This table is the application's, kept beside the list it belongs to so the
 * two cannot drift apart (wave 4; supersedes the reference review's
 * "Attribute and cost honesty" ruling, which withdrew the markers entirely).
 *
 * It is exhaustive over `ComparedAttribute` by type, so a field the Almanac adds
 * to a module cannot reach the panel without someone stating which way is better
 * for it — which is the whole point of the table being written down.
 */
export const HIGHER_IS_BETTER: Record<ComparedAttribute, boolean> = {
  ammoMaximum: true,
  armourPiercing: true,
  bootTime: false,
  burstInterval: false,
  burstRateOfFire: true,
  burstRounds: true,
  cargoCapacity: true,
  causticResistance: true,
  chargeTime: false,
  clipSize: true,
  damage: true,
  damagePerSecond: true,
  damagePerShot: true,
  distributorDraw: false,
  energyPerSecond: false,
  engineHeatRate: false,
  enginesCapacity: true,
  enginesRecharge: true,
  explosiveResistance: true,
  falloffRange: true,
  fsdHeatRate: false,
  fuelCapacity: true,
  fuelMul: false,
  fuelPower: false,
  heatEfficiency: false,
  heatPerSecond: false,
  hullBoost: true,
  hullReinforcement: true,
  integrity: true,
  interdictorFacingLimit: true,
  interdictorRange: true,
  jitter: false,
  jumpBoost: true,
  kineticResistance: true,
  mass: false,
  maxFuel: true,
  maxMass: true,
  maxMultiplier: true,
  maxRotationMultiplier: true,
  maxSpeedMultiplier: true,
  maximumRange: true,
  minMass: true,
  minMultiplier: true,
  minRotationMultiplier: true,
  minSpeedMultiplier: true,
  moduleProtection: true,
  optMass: true,
  optMultiplier: true,
  optRotationMultiplier: true,
  optSpeedMultiplier: true,
  powerCapacity: true,
  powerDraw: false,
  probeRadius: true,
  rateOfFire: true,
  refuelRate: true,
  reloadTime: false,
  roundsPerShot: true,
  scanAngle: true,
  scanTime: false,
  scannerRange: true,
  shieldAddition: true,
  shieldBankDuration: true,
  shieldBankHeat: false,
  shieldBankReinforcement: true,
  shieldBankSpinUp: false,
  shieldBoost: true,
  shieldBrokenRegenRate: true,
  shieldRegenRate: true,
  shotSpeed: true,
  sustainedDamagePerSecond: true,
  sustainedEnergyPerSecond: false,
  sustainedHeatPerSecond: false,
  sustainedRateOfFire: true,
  systemsCapacity: true,
  systemsRecharge: true,
  thermalLoad: false,
  thermalResistance: true,
  weaponsCapacity: true,
  weaponsRecharge: true,
};

/**
 * One row of the comparison. Either side may be unavailable, and stays so.
 *
 * `stock` is the module's catalogue record — the reference's own `STOCK` column
 * — not the module as it currently stands. Both canvases head the two columns
 * `STOCK` and `MODIFIED`, which is also what the game's own engineering panel
 * shows: what this article is before any recipe, and what the selection would
 * make of it.
 */
export interface AttributeComparison {
  readonly attribute: ComparedAttribute;
  readonly stock: number | null;
  readonly modified: number | null;
}

/**
 * What the draft would produce, read off a build nobody is looking at.
 *
 * `unavailable` is not a failure to render around: it is the package declining
 * to resolve the article, or refusing the selection outright, and either way
 * there is no candidate to describe. No value is estimated in its place.
 */
export type EngineeringPreview =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'known';
      /**
       * Whether there is a second column to draw at all.
       *
       * An unengineered module with nothing chosen has attributes but no
       * *comparison*: its modified figures would be its stock figures copied,
       * and a column of numbers repeated is a recipe that appears to have done
       * nothing. The panel states what the article is, and gains the second
       * column the moment there is something to compare it against.
       */
      readonly comparing: boolean;
      readonly attributes: readonly AttributeComparison[];
    };

/**
 * One mount's engineering editor, as a value.
 *
 * The draft holds *selection* and the package answers it produced; it holds no
 * build. Opening it, changing it and abandoning it spend no revision and record
 * no history, which is why a Commander can look at what a grade 5 would cost
 * and walk away having changed nothing (FR-018).
 *
 * `baseBuildRevision` is what makes that safe in the other direction. A draft
 * built against a build that has since changed describes menus that were true a
 * revision ago; applying it would be applying a decision to a build the
 * Commander is no longer looking at, so a stale draft refuses and rebuilds
 * instead (data model, "EngineeringDraft").
 */
export interface EngineeringDraft {
  readonly slotKey: string;
  readonly baseBuildRevision: number;
  /** The package's exact menu for this mount, in the package's own order. */
  readonly blueprints: readonly AvailableBlueprint[];
  readonly selectedBlueprintFdname: string | typeof NO_BLUEPRINT | null;
  /** The selected recipe's route. `null` when nothing, or `'none'`, is selected. */
  readonly selectedRoute: AvailableBlueprint['route'] | null;
  /** Always one of the selected descriptor's own grades, or `null`. */
  readonly selectedGrade: number | null;
  /** Exactly the effects the package offers this mount. */
  readonly effects: readonly string[];
  readonly selectedEffectFdname: string | null;
  /**
   * What the module carries now, for the editor to show beside the choice. Its
   * recipe is the menu's entry for it, so the menu can mark it applied.
   */
  readonly current: EngineeringView;
  readonly preview: EngineeringPreview;
  readonly cost: EngineeringCostView;
  /**
   * Whether the package offers this mount any engineering at all.
   *
   * An empty menu is a complete, correct answer — the cargo hatch, a fuel tank,
   * a final Guardian article — and it is not the same as the editor failing to
   * read one. The editor says so rather than drawing an empty list (FR-009).
   */
  readonly packageEmpty: boolean;
  /** True on an article the package will accept no further engineering on. */
  readonly finalArticle: boolean;
}

/**
 * The selection an editor opens with: whatever the module already carries.
 *
 * Opening the editor is not a decision, so it proposes the state the Commander
 * is already in. A module with no engineering opens with nothing selected —
 * *not* with `'none'`, which would be the editor proposing to strip a module
 * that has nothing to strip.
 */
export function openingSelection(current: EngineeringView): EngineeringSelection {
  return {
    blueprintFdname: current.blueprintFdname,
    grade: current.currentGrade,
    effectFdname: current.effectFdname,
  };
}

/**
 * Builds the draft for one mount at one revision.
 *
 * `null` when the mount is empty: there is no module to engineer, and an editor
 * over nothing would be a surface with nothing behind it.
 */
export function openEngineeringDraft(
  loadout: ShipLoadout,
  slotKey: string,
  buildRevision: number,
  selection: EngineeringSelection,
  text: ModuleTextResolver,
): EngineeringDraft | null {
  const fitted = loadout.fittedModuleAt(slotKey);
  if (fitted === null) {
    return null;
  }

  const module = fittedModuleView(fitted, text);
  // A build can spell its recipe other than the menu does — `Misc_LightWeight`
  // for a life support's `LifeSupport_LightWeight` — so the package names the
  // menu entry a fitted recipe is. A recipe the menu does not list keeps its id.
  const menuEntry = (fdname: string): string =>
    getMenuBlueprintForModule(module.symbol, fdname) ?? fdname;
  const fittedEngineering = engineeringView(module);
  const current: EngineeringView = {
    ...fittedEngineering,
    blueprintFdname:
      fittedEngineering.blueprintFdname === null
        ? null
        : menuEntry(fittedEngineering.blueprintFdname),
  };
  // The recipes this mount can actually take, filtered here rather than in the
  // component that draws them. A recipe whose grades start above 1 is a Merc-Coin
  // article's own: the Almanac sells it with the purchase and starts it at the
  // grade it was bought at, so offering one on a module that was not bought that
  // way offers a job the package would refuse after the Commander had chosen it
  // (wave 4). It moved down here in wave 9 because `packageEmpty` has to be
  // computed from what is actually offered — a mount whose only recipe is one
  // nobody here can take has no engineering, and drawing a menu holding only
  // `None` said otherwise.
  const purchased = current.purchaseVariant !== null;
  const blueprints = loadout
    .availableBlueprints(slotKey)
    .filter((blueprint) => purchased || (blueprint.grades[0] ?? 1) <= 1);
  const effects = loadout.availableExperimentalEffects(slotKey);

  const chosen = selection.blueprintFdname;
  const descriptor =
    chosen === null || chosen === NO_BLUEPRINT
      ? null
      : (blueprints.find((candidate) =>
          sameIdentity(candidate.blueprintSymbol, menuEntry(chosen)),
        ) ?? null);

  // A grade is only a grade if the selected descriptor offers it. Anything else
  // is a number the package never published for this recipe, and the package
  // would refuse it — after the Commander had been offered it.
  const purchase = current.purchaseVariant;
  const selectedGrade =
    descriptor !== null &&
    selection.grade !== null &&
    (descriptor.grades.includes(selection.grade) ||
      // A bespoke Mercenary recipe starts at grade 2, and an article bought at
      // grade 1 carries a grade its own recipe does not offer. That grade is a
      // grade the article really has, so it is offered like any other: the bar
      // shows it when the article is at it, and a Commander who climbed to
      // grade 3 can press it to come back down (wave 5, wave 6).
      (purchase !== null &&
        selection.grade === purchase.grade &&
        sameIdentity(descriptor.blueprintSymbol, purchase.blueprintSymbol)))
      ? selection.grade
      : null;

  // Likewise for the effect: the menu is the package's, and a selection that
  // has fallen off it is no selection.
  const selectedEffectFdname =
    selection.effectFdname !== null &&
    effects.some((candidate) => sameIdentity(candidate, selection.effectFdname))
      ? selection.effectFdname
      : null;

  const resolved: EngineeringSelection = {
    blueprintFdname:
      selection.blueprintFdname === NO_BLUEPRINT
        ? NO_BLUEPRINT
        : (descriptor?.blueprintSymbol ?? null),
    grade: selectedGrade,
    effectFdname: selectedEffectFdname,
  };

  return {
    slotKey,
    baseBuildRevision: buildRevision,
    blueprints,
    selectedBlueprintFdname: resolved.blueprintFdname,
    selectedRoute: descriptor?.route ?? null,
    selectedGrade,
    effects,
    selectedEffectFdname,
    current,
    preview: previewOf(loadout, slotKey, resolved, current, stockArticleOf(module)),
    cost: engineeringCost({
      blueprintFdname: resolved.blueprintFdname === NO_BLUEPRINT ? null : resolved.blueprintFdname,
      grade: selectedGrade,
      effectFdname: selectedEffectFdname,
      currentBlueprintFdname: current.blueprintFdname,
      currentGrade: current.currentGrade,
      currentEffectFdname: current.effectFdname,
      purchaseVariant: current.purchaseVariant,
    }),
    // No recipe offered and none already on the module means nothing can be
    // chosen here at all: the effect menu is drawn only once a recipe is, so an
    // empty recipe list is an empty panel. Requiring the effect list to be empty
    // too left a mount like a stock Abrasion Blaster — effects in the package,
    // no ordinary blueprint for it — drawing a `BLUEPRINT` menu whose only entry
    // was `None`, which is a control over nothing (wave 9, FR-009).
    packageEmpty: blueprints.length === 0 && current.blueprintFdname === null,
    finalArticle: current.purchaseVariant?.engineeringLocked === true,
  };
}

/**
 * Moves the selection to one blueprint, keeping the grade where the new recipe
 * offers it.
 *
 * A recipe that does not offer the grade the Commander was looking at falls to
 * that recipe's own highest grade rather than to nothing, because a complete
 * grade is what this application models and the editor's whole subject is which
 * complete grade to apply. `'none'` clears the grade entirely: there is no
 * grade of not being engineered.
 */
export function withBlueprint(
  draft: EngineeringDraft,
  fdname: string | typeof NO_BLUEPRINT,
): EngineeringSelection {
  if (fdname === NO_BLUEPRINT) {
    // Clearing removes the effect with the blueprint, because that is what the
    // package's `clearEngineering` does. Leaving an effect selected would show
    // a choice the operation is about to discard.
    return { blueprintFdname: NO_BLUEPRINT, grade: null, effectFdname: null };
  }

  const descriptor = draft.blueprints.find((candidate) =>
    sameIdentity(candidate.blueprintSymbol, fdname),
  );
  if (descriptor === undefined) {
    return currentSelection(draft);
  }

  const grade =
    draft.selectedGrade !== null && descriptor.grades.includes(draft.selectedGrade)
      ? draft.selectedGrade
      : (descriptor.grades.at(-1) ?? null);

  return {
    blueprintFdname: descriptor.blueprintSymbol,
    grade,
    effectFdname: draft.selectedEffectFdname,
  };
}

/** Moves the selection to one grade of the selected recipe. */
export function withGrade(draft: EngineeringDraft, grade: number): EngineeringSelection {
  return { ...currentSelection(draft), grade };
}

/** Moves the selection to one effect, or to the explicit no-effect. */
export function withEffect(draft: EngineeringDraft, fdname: string | null): EngineeringSelection {
  return { ...currentSelection(draft), effectFdname: fdname };
}

/** The draft's own selection, as the value the transitions build from. */
export function currentSelection(draft: EngineeringDraft): EngineeringSelection {
  return {
    blueprintFdname: draft.selectedBlueprintFdname,
    grade: draft.selectedGrade,
    effectFdname: draft.selectedEffectFdname,
  };
}

/** True when the draft describes a build that has since changed. */
export function draftIsStale(draft: EngineeringDraft, buildRevision: number): boolean {
  return draft.baseBuildRevision !== buildRevision;
}

/**
 * The one decision applying this draft makes, or none.
 *
 * Three intents rather than one, because the package offers three operations
 * and they are not interchangeable. `'none'` dispatches `clearEngineering` and
 * never `applyBlueprint` with an empty recipe — the package has a word for
 * removing engineering and using a different call with a hole in it would blur
 * what was asked for (data model, "EngineeringDraft").
 *
 * An effect change on its own is `setExperimentalEffect`, which is what keeps a
 * fixed reward's hand-set modifier block and its purchase identity intact:
 * re-applying the blueprint would roll the recipe and lose both (FR-012).
 */
export function engineeringIntent(draft: EngineeringDraft): BuildEditIntent | null {
  return selectionIntent(draft.slotKey, currentSelection(draft), draft.current);
}

/**
 * Which of the three operations one selection asks for, against what is fitted.
 *
 * Shared with the preview so a Commander is shown the result of the operation
 * that would actually run. Previewing an effect-only change as though it were a
 * fresh `applyBlueprint` would show a fixed reward rolled into an ordinary
 * module — the exact loss FR-012 exists to prevent — and then commit something
 * else entirely.
 */
function selectionIntent(
  slotKey: string,
  selection: EngineeringSelection,
  current: EngineeringView,
): BuildEditIntent | null {
  const selected = selection.blueprintFdname;

  if (selected === NO_BLUEPRINT) {
    return { kind: 'clearEngineering', slotKey };
  }

  // Back to the article as it was bought. The Almanac has no recipe at that
  // grade — a bespoke Mercenary table starts above it — so this is the purchase
  // being restored rather than a grade being crafted (wave 6).
  const purchase = current.purchaseVariant;
  if (
    purchase !== null &&
    selection.grade === purchase.grade &&
    sameIdentity(selected, purchase.blueprintSymbol) &&
    !(
      sameIdentity(purchase.blueprintSymbol, current.blueprintFdname) &&
      current.currentGrade === purchase.grade
    )
  ) {
    return { kind: 'restorePurchase', slotKey };
  }

  const effectChanged = !sameIdentity(selection.effectFdname, current.effectFdname);

  if (
    selected === null ||
    selection.grade === null ||
    (sameIdentity(selected, current.blueprintFdname) && selection.grade === current.currentGrade)
  ) {
    // Nothing about the recipe is moving. If the effect is, that is its own
    // operation; if it is not, there is no decision here at all.
    return effectChanged
      ? { kind: 'setExperimental', slotKey, effectFdname: selection.effectFdname }
      : null;
  }

  return {
    kind: 'applyEngineering',
    slotKey,
    blueprintFdname: selected,
    grade: selection.grade,
    effectFdname: selection.effectFdname,
  };
}

/**
 * The package operation one engineering intent performs on a candidate.
 *
 * Shared by the preview and by the store, so what a Commander was shown and
 * what is committed cannot be two different operations. `unsupported` from
 * `setExperimentalEffect` is reported through `onUnsupported` rather than
 * thrown: it is a structured refusal the package returns deliberately, and
 * turning it into an exception would lose the code and parameters that are the
 * whole reason it is structured (contract, "Refusals").
 */
export function engineeringOperation(
  intent: BuildEditIntent,
  onUnsupported?: (code: string, params: unknown) => void,
): EditOperation | null {
  switch (intent.kind) {
    case 'applyEngineering':
      return (candidate) => {
        candidate.applyBlueprint(intent.slotKey, intent.blueprintFdname, {
          grade: intent.grade,
          // Explicit, always. Every grade this application models is complete,
          // and letting the package's own default supply it would leave the one
          // number the whole feature turns on unstated (FR-013).
          quality: 1,
          // Omitted rather than passed as null when there is no effect: the
          // package reads the property once, and "not asked for" is the shape
          // its own signature is written in.
          ...(intent.effectFdname === null
            ? {}
            : { experimentalEffectSymbol: intent.effectFdname }),
        });
      };

    case 'setExperimental':
      return (candidate) => {
        const result = candidate.setExperimentalEffect(intent.slotKey, intent.effectFdname);
        if (result.kind === 'unsupported') {
          onUnsupported?.(result.code, result.params);
        }
      };

    case 'clearEngineering':
      return (candidate) => {
        candidate.clearEngineering(intent.slotKey);
      };

    case 'restorePurchase':
      return (candidate) => {
        const fitted = candidate.fittedModuleAt(intent.slotKey);
        const variant = fitted?.preEngineeredVariant;
        if (variant != null) {
          // The same package call a variant fit makes, and it resets the mount
          // the same way: `On`, `Priority` and `Health` go back to a fresh
          // mount's. So the same carry, for the same reason — a Commander who
          // put this article in group 3 and switched it off decided that about
          // the mount, and putting the purchase back is not a decision to undo
          // it. Reached from the engineering panel rather than the chooser,
          // which is why losing it here would be the harder of the two to
          // notice (reported in review, 2026-08-27; FR-015).
          const carried = powerStateOf(fitted);
          candidate.setPreEngineeredVariant(intent.slotKey, variant);
          carryPower(candidate, intent.slotKey, carried);
        }
      };

    default:
      return null;
  }
}

/**
 * The candidate this selection would produce, against the stock article.
 *
 * Built on a detached copy through the same checkpoint round trip every commit
 * uses, so what the preview measures is what would actually be installed rather
 * than an approximation of it. A refusal here is not surfaced as an error —
 * a half-chosen draft refusing is ordinary — it simply has nothing to show.
 */
function previewOf(
  loadout: ShipLoadout,
  slotKey: string,
  selection: EngineeringSelection,
  current: EngineeringView,
  stockArticle: OutfittingModule | null,
): EngineeringPreview {
  const modified = modifiedArticleOf(loadout, slotKey, selection, current);
  // A selection the package will not resolve has nothing to describe. This is
  // the only unavailable case: a module with no engineering on it yet is not
  // one of them — it has every attribute it was catalogued with.
  if (modified.kind === 'refused') {
    return { kind: 'unavailable' };
  }

  const modifiedArticle = modified.kind === 'article' ? modified.article : null;
  if (stockArticle === null && modifiedArticle === null) {
    return { kind: 'unavailable' };
  }

  const stockFigures = weaponFigures(stockArticle);
  const modifiedFigures = weaponFigures(modifiedArticle);
  const attributes = [
    ...COMPARED_ATTRIBUTES.map((attribute) => ({
      attribute,
      stock: stockArticle?.[attribute] ?? null,
      modified: modifiedArticle?.[attribute] ?? null,
    })),
    // The package's own calculations for the same two articles, after the
    // stats they are worked out from. `null` on both sides for anything that
    // is not a weapon, which the row filter then drops.
    ...WEAPON_FIGURES.map((attribute) => ({
      attribute,
      stock: stockFigures?.[attribute] ?? null,
      modified: modifiedFigures?.[attribute] ?? null,
    })),
    // A row neither side publishes is not a row: a multi-cannon has no
    // integrity figure to compare and drawing an empty one would suggest the
    // package lost it.
  ]
    .filter((row) => row.stock !== null || row.modified !== null)
    .filter((row) => !silentZero(row));
  const drawn = new Map(attributes.map((row) => [row.attribute, row] as const));

  return {
    kind: 'known',
    comparing: modifiedArticle !== null,
    attributes: attributes.filter((row) => !restatesAnotherRow(row, drawn)),
  };
}

/**
 * The row each calculated figure restates where a weapon's cadence is flat.
 *
 * A weapon that never stops to reload sustains exactly what it starts with, so
 * its four sustained figures are the four above them written twice; a weapon
 * whose cadence is one shot a second has a damage per second equal to its
 * damage. Neither is wrong, and neither is a second reading.
 */
const RESTATED_BY: Partial<Record<ComparedAttribute, ComparedAttribute>> = {
  damagePerShot: 'damage',
  damagePerSecond: 'damage',
  energyPerSecond: 'distributorDraw',
  heatPerSecond: 'thermalLoad',
  sustainedDamagePerSecond: 'damagePerSecond',
  sustainedEnergyPerSecond: 'energyPerSecond',
  sustainedHeatPerSecond: 'heatPerSecond',
  sustainedRateOfFire: 'rateOfFire',
};

/**
 * A calculated row that says what another row of the table already says.
 *
 * Dropped only where *both* readings match, because that is what makes it a
 * repetition rather than a change. A small cannon reloads at stock and does not
 * once rapid fire has shortened its reload to nothing: its sustained figures
 * are a reading on one side and a repetition on the other, and a row that
 * vanished from one column would report the reading as lost (FR-012a).
 */
function restatesAnotherRow(
  row: AttributeComparison,
  drawn: ReadonlyMap<ComparedAttribute, AttributeComparison>,
): boolean {
  const restated = RESTATED_BY[row.attribute];
  const other = restated === undefined ? undefined : drawn.get(restated);
  return other !== undefined && other.stock === row.stock && other.modified === row.modified;
}

/**
 * A published figure that says nothing, and is left off rather than drawn.
 *
 * Only `bootTime`, and only where no side of the row is a non-zero number. The
 * Almanac publishes `0` on 244 modules that simply have no boot delay — it is a
 * real value, not a gap, which is why it is filtered here rather than turned
 * into an absence upstream. `Boot time s 0` is a row a Commander reads and
 * learns nothing from, and on a weapon list it was the first row in the table.
 *
 * Deliberately not a general "hide every zero" rule. A zero is data everywhere
 * else on this surface — constitution IV keeps `[]` as a known zero — and a
 * module whose damage really is 0 is stating something.
 */
function silentZero(row: AttributeComparison): boolean {
  return row.attribute === 'bootTime' && (row.stock ?? 0) === 0 && (row.modified ?? 0) === 0;
}

/**
 * The article the comparison's `MODIFIED` column is about.
 *
 * A selection with something still to apply is measured on a detached copy
 * through the same checkpoint round trip every commit uses, so what a Commander
 * is shown is what would actually be installed rather than an approximation of
 * it. A selection with nothing left to apply — which is every selection once it
 * has been committed — is measured on the module itself: canvas 1c draws the
 * comparison beside a module that already carries its recipe, and a panel that
 * went blank the moment the recipe was applied would empty exactly when a
 * Commander went looking for what it did.
 *
 * A refusal is not surfaced as an error. A half-chosen draft refusing is
 * ordinary; it simply has nothing to show.
 */
/**
 * What, if anything, the second column would hold.
 *
 * `none` and `refused` were one `null` before, and collapsing them cost the
 * panel every attribute of every unengineered module: "nothing is engineered
 * here yet" was answered the same way as "the package will not resolve this
 * selection", so a stock pulse laser reported that no values could be resolved
 * for it. They are different answers and the panel draws them differently.
 */
type ModifiedArticle =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'article'; readonly article: OutfittingModule };

function modifiedArticleOf(
  loadout: ShipLoadout,
  slotKey: string,
  selection: EngineeringSelection,
  current: EngineeringView,
): ModifiedArticle {
  const engineered =
    current.blueprintFdname !== null ||
    current.effectFdname !== null ||
    current.modifiers !== null ||
    current.purchaseVariant !== null;
  const fitted = (): ModifiedArticle => {
    if (!engineered) {
      return { kind: 'none' };
    }
    const article = loadout.fittedModuleAt(slotKey)?.effectiveStats ?? null;
    return article === null ? { kind: 'refused' } : { kind: 'article', article };
  };

  const intent = selectionIntent(slotKey, selection, current);
  if (intent === null) {
    return fitted();
  }

  const operation = engineeringOperation(intent);
  if (operation === null) {
    return fitted();
  }

  const restored = restoreCheckpoint(captureCheckpoint(loadout));
  if (!restored.ok) {
    return { kind: 'refused' };
  }

  try {
    operation(restored.loadout);
  } catch {
    return { kind: 'refused' };
  }

  const article = restored.loadout.fittedModuleAt(slotKey)?.effectiveStats ?? null;
  return article === null ? { kind: 'refused' } : { kind: 'article', article };
}

/**
 * The module as it is catalogued, before any engineering.
 *
 * `FittedModule.stats` is that record for every module the application can
 * engineer, and it is what the `STOCK` column wants. A fixed pre-engineered
 * article is the one exception: the package publishes its resolved article
 * there as well as through `effectiveStats`, so that stats a journal capture
 * left out still describe the article. Read as the stock column, that prints
 * the article's own figures in both columns and the engineering it was bought
 * with disappears (Commander request 2026-08-30).
 *
 * So the column asks the package for the same module in stock. That is a second
 * package record, not a correction of the first: nothing is re-derived and
 * nothing is adjusted, and a symbol the catalogue does not carry states its
 * absence like any other unavailable figure.
 */
function stockArticleOf(module: FittedModuleView): OutfittingModule | null {
  return module.variant === null ? module.article : getModuleBySymbol(module.symbol);
}

/** Package identities are compared the way the package matches them. */
function sameIdentity(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
