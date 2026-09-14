import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { LoadoutEvent } from '@elite-dangerous-almanac/core/ships/slef';
import {
  PRE_ENGINEERED_MODULES,
  getPreEngineeredVariants,
  type PreEngineeredVariant,
} from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { getOutfittingFamilyName } from '@elite-dangerous-almanac/core/i18n/module-families';
import { getModuleName } from '@elite-dangerous-almanac/core/i18n/modules';
import { getPreEngineeredVariantName } from '@elite-dangerous-almanac/core/i18n/pre-engineered';
import { presentGameText } from '../../../i18n/game-text.presenter';
import type { ModuleTextResolver } from '../../../application/outfitting/fitted-module-view';

/**
 * The shared outfitting fixtures.
 *
 * Every value here is *evidence about the installed package*, not a mock of it.
 * A hull symbol, a slot key, a module symbol and a blueprint `fdname` are
 * identities the package either carries or does not; the constants below name
 * ones it carries at the pinned version, and the guards beside them fail loudly
 * when a release stops carrying one — which is the point. A fixture that
 * silently degrades into "no candidates" would make a suite pass by testing
 * nothing (constitution II, VIII).
 *
 * Nothing here fabricates a game value. Costs, stats, modifiers and menus are
 * never written down; every fixture builds a real `ShipLoadout` and lets the
 * package answer.
 */

/** The hull every ordinary fixture starts from: it has every mount kind. */
export const FIXTURE_HULL = 'Anaconda';

/** Exact package slot keys this feature's tests name, one per mount kind. */
export const FIXTURE_SLOTS = {
  armour: 'Armour',
  core: 'PowerPlant',
  frameShiftDrive: 'FrameShiftDrive',
  thrusters: 'MainEngines',
  hardpoint: 'HugeHardpoint1',
  /** A mount the hull's default build arrives with something fitted in. */
  fittedHardpoint: 'SmallHardpoint1',
  /** A fitted, removable optional internal. */
  fittedOptional: 'Slot03_Size6',
  utility: 'TinyHardpoint1',
  optional: 'Slot01_Size7',
  cargoHatch: 'CargoHatch',
} as const;

/**
 * The largest candidate list the installed package offers, for SC-002.
 *
 * Discovered by walking every hull's every slot and counting stock records plus
 * their pre-engineered variants. It is named rather than rediscovered at test
 * time because the walk takes seconds and the point of the measurement is the
 * chooser, not the search for it. `assertLargestChoiceSet` re-proves the claim.
 */
export const LARGEST_CHOICE_SET = {
  hull: 'PantherMkII',
  slot: 'Slot01_Size8',
  /** Stock records plus every variant, at the pinned package version. */
  approximateChoices: 469,
} as const;

/**
 * A fixed-reward article that is still re-engineerable.
 *
 * The regression this feature keeps returning to: adding, replacing and
 * removing only an experimental effect on a tech-broker article must leave the
 * package's own fixed modifier block and `preEngineeredVariant` identity
 * intact (FR-012, contract "Package acceptance" item 2).
 */
export const FIXED_REWARD_REGRESSION = {
  hull: 'Anaconda',
  slot: FIXTURE_SLOTS.frameShiftDrive,
  symbol: 'Int_Hyperdrive_Size5_Class5',
  blueprint: 'FSD_LongRange',
  acquisition: 'techBroker',
} as const;

/**
 * One module the package sells through two different routes.
 *
 * Route-distinct variants must stay distinct: they are two articles a Commander
 * acquires two different ways, and collapsing them would lose the acquisition
 * label the choice is chosen by (FR-006).
 */
export const ROUTE_DISTINCT_SYMBOL = 'Hpt_Slugshot_Gimbal_Small';

/** A hull symbol the package does not carry, for the refusal path. */
export const UNKNOWN_HULL = 'Nonexistent_Hull';

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

/** The default build for the fixture hull: every mount kind, all fixed mounts filled. */
export function defaultBuild(hull: string = FIXTURE_HULL): ShipLoadout {
  return ShipLoadout.default(hull);
}

/** The largest-chooser build, for the SC-002 timing fixture. */
export function largestChoiceBuild(): ShipLoadout {
  return ShipLoadout.default(LARGEST_CHOICE_SET.hull);
}

/** A build carrying the re-engineerable fixed reward in its drive mount. */
export function fixedRewardBuild(): ShipLoadout {
  const build = ShipLoadout.default(FIXED_REWARD_REGRESSION.hull);
  build.setPreEngineeredVariant(FIXED_REWARD_REGRESSION.slot, fixedRewardVariant());
  return build;
}

/** The package's own record for the fixed-reward regression article. */
export function fixedRewardVariant(): PreEngineeredVariant {
  const variant = getPreEngineeredVariants(FIXED_REWARD_REGRESSION.symbol).find(
    (candidate) =>
      candidate.acquisition === FIXED_REWARD_REGRESSION.acquisition &&
      candidate.blueprintSymbol === FIXED_REWARD_REGRESSION.blueprint,
  );
  if (variant === undefined) {
    throw new Error(
      `The installed Almanac no longer carries a ${FIXED_REWARD_REGRESSION.acquisition} ` +
        `"${FIXED_REWARD_REGRESSION.blueprint}" variant of ${FIXED_REWARD_REGRESSION.symbol}. ` +
        'Pick a new regression subject from the package rather than writing one here.',
    );
  }
  return variant;
}

/**
 * A build carrying an article the package locks against further engineering.
 *
 * Asked of the Almanac rather than named here: twelve of its pre-engineered
 * variants report `engineeringLocked`, and which twelve is the package's
 * business (constitution II). None of them is a hull default, so the article is
 * fitted first and the mount comes out of the search — a release that moves one
 * to another module keeps the fixture honest instead of failing to find it.
 */
export function lockedArticleBuild(): { build: ShipLoadout; slot: string } {
  const build = ShipLoadout.default('Anaconda');
  for (const slot of build.slots()) {
    for (const module of build.modulesForSlot(slot.key) ?? []) {
      const locked = (getPreEngineeredVariants(module.symbol) ?? []).find(
        (variant) => variant.engineeringLocked === true,
      );
      if (locked !== undefined) {
        build.setModule(slot.key, module);
        build.setPreEngineeredVariant(slot.key, locked);
        return { build, slot: slot.key };
      }
    }
  }
  throw new Error(
    'The installed Almanac reports no fittable pre-engineered variant with ' +
      '`engineeringLocked`. A final article is a package state; pick the ' +
      'regression subject from the package rather than writing one here.',
  );
}

/** A final article whose package-owned experimental effect remains visible. */
export function lockedEffectArticleBuild(): { build: ShipLoadout; slot: string } {
  const build = ShipLoadout.default('Anaconda');
  for (const slot of build.slots()) {
    for (const module of build.modulesForSlot(slot.key) ?? []) {
      const locked = (getPreEngineeredVariants(module.symbol) ?? []).find(
        (variant) =>
          variant.engineeringLocked === true &&
          typeof variant.experimentalEffectSymbol === 'string',
      );
      if (locked !== undefined) {
        build.setModule(slot.key, module);
        build.setPreEngineeredVariant(slot.key, locked);
        return { build, slot: slot.key };
      }
    }
  }
  throw new Error(
    'The installed Almanac reports no fittable final article with an experimental effect. ' +
      'Pick the regression subject from the package rather than writing one here.',
  );
}

/**
 * A Mercenary article: bought with Merc Coin, engineered from grade 1 upward.
 *
 * Its bespoke recipe is the reason it is here. A Mercenary blueprint defines
 * only the grades above the purchase, so it is the fixture that proves a climb
 * starts above the grade the article arrived at rather than from nothing
 * (FR-013, contract "Engineering").
 */
export function mercenaryVariant(): PreEngineeredVariant {
  const variant = PRE_ENGINEERED_MODULES.find(
    (candidate) => candidate.acquisition === 'mercenary' && candidate.mercCoinCost !== undefined,
  );
  if (variant === undefined) {
    throw new Error(
      'The installed Almanac no longer carries a Merc-Coin priced Mercenary article. ' +
        'Pick a new fixture from the package rather than writing one here.',
    );
  }
  return variant;
}

/** A Mercenary article whose shop-supplied experimental effect cannot be edited. */
export function fixedEffectMercenaryBuild(): {
  readonly build: ShipLoadout;
  readonly slot: string;
  readonly variant: PreEngineeredVariant & { readonly experimentalEffectSymbol: string };
} {
  const variant = PRE_ENGINEERED_MODULES.find(
    (
      candidate,
    ): candidate is PreEngineeredVariant & { readonly experimentalEffectSymbol: string } =>
      candidate.acquisition === 'mercenary' &&
      candidate.mercCoinCost !== undefined &&
      typeof candidate.experimentalEffectSymbol === 'string',
  );
  if (variant === undefined) {
    throw new Error(
      'The installed Almanac reports no Merc-Coin article with an experimental effect. ' +
        'Pick a new fixture from the package rather than writing one here.',
    );
  }

  const build = defaultBuild();
  const slot = build
    .slots('hardpoint')
    .find((candidate) =>
      build.modulesForSlot(candidate.key).some((module) => module.symbol === variant.symbol),
    );
  if (slot === undefined) {
    throw new Error(
      "The fixture hull has no hardpoint for the package's fixed-effect Mercenary article.",
    );
  }

  build.setPreEngineeredVariant(slot.key, variant);
  return { build, slot: slot.key, variant };
}

/** Every package variant of the two-route module, in package order. */
export function routeDistinctVariants(): readonly PreEngineeredVariant[] {
  const variants = getPreEngineeredVariants(ROUTE_DISTINCT_SYMBOL);
  const routes = new Set(variants.map((variant) => variant.acquisition));
  if (routes.size < 2) {
    throw new Error(
      `${ROUTE_DISTINCT_SYMBOL} no longer has variants from more than one acquisition route.`,
    );
  }
  return variants;
}

// ---------------------------------------------------------------------------
// Ingress payloads
//
// These are `LoadoutEvent` values — what a decoder hands the ingress pipeline —
// rather than built loadouts, because what is under test is what the package
// does with them.
// ---------------------------------------------------------------------------

/** A payload naming no modules at all: every fixed mount is absent. */
export const OMITTED_FIXED_MOUNTS: LoadoutEvent = {
  event: 'Loadout',
  Ship: FIXTURE_HULL,
  Modules: [],
};

/**
 * A payload naming a module a fixed mount cannot hold.
 *
 * A pulse laser in the power-plant mount. The package refuses the article and
 * installs the hull's own default; the application neither classifies the slot
 * nor chooses the replacement (FR-010).
 */
export const UNUSABLE_FIXED_MOUNT: LoadoutEvent = {
  event: 'Loadout',
  Ship: FIXTURE_HULL,
  Modules: [{ Slot: FIXTURE_SLOTS.core, Item: 'Hpt_PulseLaser_Fixed_Small' }],
};

/**
 * A payload whose partial engineering the package can complete losslessly.
 *
 * Dirty drives at grade 5 and a quality below 1: the package identifies the
 * recipe, so `completeEngineeringGrade` returns `normalized` and the modelled
 * build becomes a true 100% grade (FR-013).
 */
export const SUPPORTED_PARTIAL_QUALITY: LoadoutEvent = {
  event: 'Loadout',
  Ship: FIXTURE_HULL,
  Modules: [
    {
      Slot: FIXTURE_SLOTS.thrusters,
      Item: 'Int_Engine_Size7_Class5',
      Engineering: { BlueprintName: 'Engine_Dirty', Level: 5, Quality: 0.37 },
    },
  ],
};

/** The quality the supported payload arrives with, for the notice assertion. */
export const SUPPORTED_PARTIAL_SOURCE_QUALITY = 0.37;

/**
 * A payload whose partial engineering the package cannot complete.
 *
 * A thruster recipe named against a frame shift drive: the module's engineering
 * menu does not offer `Engine_Dirty`, and no catalogued article of that module
 * answers to it either, so the package can neither roll the recipe nor identify
 * an article carrying it. It reports `unresolvedEngineering` on import and
 * answers `unsupported` to `completeEngineeringGrade`, and the whole candidate
 * is refused before activation.
 *
 * A recipe the module's menu *does* offer is rolled at the stated grade and
 * quality even where a fixed article of the same module carries the same
 * blueprint at the same grade, so a mismatch of that kind is not one of these.
 */
export const UNSUPPORTED_PARTIAL_QUALITY: LoadoutEvent = {
  event: 'Loadout',
  Ship: FIXTURE_HULL,
  Modules: [
    {
      Slot: FIXTURE_SLOTS.frameShiftDrive,
      Item: 'Int_Hyperdrive_Size6_Class5',
      Engineering: { BlueprintName: 'Engine_Dirty', Level: 5, Quality: 0.42 },
    },
  ],
};

/** The quality the unsupported payload arrives with, for the refusal assertion. */
export const UNSUPPORTED_PARTIAL_SOURCE_QUALITY = 0.42;

/**
 * A payload whose only fractional quality belongs to a final article.
 *
 * The shape a real export of a pre-engineered Guardian weapon arrives in: the
 * game states the baked recipe and writes `Quality: 0` beside it, because there
 * was never a roll. The package identifies the article, applies its fixed
 * modifiers and locks it, so `completeEngineeringGrade` answers `finalArticle`
 * — and an ingress that read that as a normalization failure would refuse every
 * build carrying one.
 *
 * The article, its mount and its recipe all come out of `lockedArticleBuild()`,
 * so which twelve variants the Almanac locks stays the package's business.
 */
export function finalArticlePartialQuality(): {
  readonly event: LoadoutEvent;
  readonly slot: string;
  readonly symbol: string;
  readonly variant: PreEngineeredVariant;
} {
  const { build, slot } = lockedArticleBuild();
  const fitted = build.fittedModuleAt(slot);
  const variant = fitted?.preEngineeredVariant;
  if (!fitted || !variant) {
    throw new Error(
      `The installed Almanac no longer reports a pre-engineered variant on the article ` +
        `fitted at ${slot}. Read the fixture from the package rather than writing one here.`,
    );
  }
  return {
    event: {
      event: 'Loadout',
      Ship: FIXTURE_HULL,
      Modules: [
        {
          Slot: slot,
          Item: fitted.symbol,
          Engineering: {
            BlueprintName: variant.blueprintSymbol,
            Level: variant.grade,
            Quality: FINAL_ARTICLE_SOURCE_QUALITY,
          },
        },
      ],
    },
    slot,
    symbol: fitted.symbol,
    variant,
  };
}

/** What the game writes for an article that was never rolled. */
export const FINAL_ARTICLE_SOURCE_QUALITY = 0;

/** A payload naming a hull the package does not carry. */
export const UNKNOWN_HULL_PAYLOAD: LoadoutEvent = {
  event: 'Loadout',
  Ship: UNKNOWN_HULL,
  Modules: [],
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Re-proves that the named largest chooser is still the largest.
 *
 * Called from the acceptance characterization rather than from every suite: it
 * walks the whole installed catalogue, which is worth doing once.
 */
export function assertLargestChoiceSet(): { hull: string; slot: string; choices: number } {
  const build = largestChoiceBuild();
  const stock = build.modulesForSlot(LARGEST_CHOICE_SET.slot);
  const choices = stock.reduce(
    (total, module) => total + 1 + getPreEngineeredVariants(module.symbol).length,
    0,
  );
  return { hull: LARGEST_CHOICE_SET.hull, slot: LARGEST_CHOICE_SET.slot, choices };
}

/**
 * A module-name resolver backed by the package's own i18n leaves.
 *
 * Tests that assert ordering need the names a Commander actually reads, and
 * those are the package's. Stubbing them would make the tests assert the stub's
 * alphabet rather than the Almanac's, which is the one thing the ordering rules
 * are written against (module-catalogue contract, "Sections, groups and order").
 */
export function packageText(locale = 'en'): ModuleTextResolver {
  return {
    moduleName: (symbol) => presentGameText(getModuleName, symbol, locale),
    preEngineeredVariantName: (variant) =>
      presentGameText(getPreEngineeredVariantName, variant, locale),
    outfittingFamilyName: (familyId) => presentGameText(getOutfittingFamilyName, familyId, locale),
  };
}
