import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import type { OutfittingModule } from '@elite-dangerous-almanac/core/ships/modules';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { HardpointCoverage } from '../outfitting/hardpoint-coverage';
import { defaultBuild } from '../outfitting/outfitting.fixtures';

/**
 * Builds that reach the states this feature has to tell apart.
 *
 * Every one of them is a real `ShipLoadout` the package answers for. Nothing
 * here writes down a damage figure, a piercing factor, a range or a megajoule:
 * the fixtures put a build into a condition and let `weaponMetrics()` and
 * `weaponsCapacitorMetrics()` say what that condition means (constitution II).
 *
 * The module symbols below are identities the installed package either carries
 * or does not, and `packageModule` fails loudly when one stops being carried —
 * a fixture that silently degraded into "the default build again" would make a
 * suite pass while testing nothing.
 */

/** The fixture hull: eight hardpoints across every mount size. */
export const OFFENCE_FIXTURE_HULL = 'Anaconda';

/** The two mounts the fixture hull's default build arrives with weapons in. */
export const OFFENCE_DEFAULT_SLOTS = ['SmallHardpoint1', 'SmallHardpoint2'] as const;

/**
 * The weapons that carry this feature's edge states, and which state each is for.
 *
 * Every one of them was found by walking the installed hardpoint catalogue, not
 * chosen from memory: these are the articles that actually produce a caustic
 * amount, a missing piercing factor, absent range fields and a turreted mount
 * beside the fixed ones, at the pinned package version.
 */
export const OFFENCE_WEAPONS = {
  /** Conventional kinetic, a clip and a reload behind it, both range fields present. */
  kinetic: 'Hpt_MultiCannon_Fixed_Large',
  /** Continuous fire: no clip and no reload, so its sustained rate is its burst rate. */
  continuous: 'Hpt_BeamLaser_Fixed_Small',
  /** The heaviest continuous draw the hull's largest mounts take. */
  drain: 'Hpt_BeamLaser_Fixed_Large',
  /** Explosive, with neither range field returned. */
  explosive: 'Hpt_DumbfireMissileRack_Fixed_Medium',
  /** A positive anti-xeno overlay beside conventional kinetic damage. */
  antiXeno: 'Hpt_ATMultiCannon_Fixed_Large',
  /**
   * The one article in the catalogue with a caustic share, which it deals
   * beside an explosive one — the split's rarest legend row.
   */
  caustic: 'Hpt_CausticMissile_Fixed_Medium',
  /** The one Small article the hull's smallest mounts take beside a beam. */
  mining: 'Hpt_Mining_AbrBlstr_Fixed_Small',
  /**
   * A genuine zero: the package returns `0` damage for it, not an absence — and
   * no `armourPiercing` at all, which is an absence. One article carries both
   * edges, so the row that proves a stated zero proves a stated not-stated too.
   */
  noPiercing: 'Hpt_ATVentDisruptorPylon_Fixed_Medium',
  /** A turreted mount, which the gunsight's shot sentences name apart. */
  turreted: 'Hpt_ATDumbfireMissile_Turret_Large',
} as const;

/** The mount each edge-state weapon is fitted to in `everyStateBuild()`. */
export const OFFENCE_STATE_SLOTS = {
  antiXeno: 'HugeHardpoint1',
  caustic: 'LargeHardpoint1',
  turreted: 'LargeHardpoint2',
  kinetic: 'LargeHardpoint3',
  noPiercing: 'MediumHardpoint1',
  explosive: 'MediumHardpoint2',
  mining: 'SmallHardpoint1',
  continuous: 'SmallHardpoint2',
} as const;

/** The fixture hull's stock build: two enabled weapons, positive totals. */
export function populatedBuild(): ShipLoadout {
  return defaultBuild(OFFENCE_FIXTURE_HULL);
}

/** A hull with every hardpoint empty, and so a package result of nothing. */
export function noWeaponsBuild(): ShipLoadout {
  return ShipLoadout.empty(OFFENCE_FIXTURE_HULL);
}

/** The stock build with one of its two weapons switched off. */
export function partlyDisabledBuild(): ShipLoadout {
  const build = populatedBuild();
  build.setModuleEnabled(OFFENCE_DEFAULT_SLOTS[0], false);
  return build;
}

/** The stock build with every weapon switched off: rows stay, totals go to zero. */
export function allDisabledBuild(): ShipLoadout {
  const build = populatedBuild();
  for (const slot of OFFENCE_DEFAULT_SLOTS) {
    build.setModuleEnabled(slot, false);
  }
  return build;
}

/**
 * One build carrying every weapon state this feature draws differently.
 *
 * Eight mounts, eight articles: an anti-xeno overlay, a caustic amount, a
 * turreted mount, an absent piercing factor, absent range fields, a continuous
 * beam, a mining blaster and an ordinary kinetic weapon. `armourPiercing` and
 * both range fields are absent on at least one of them and present on another,
 * and the build carries a fixed mount beside a turreted one, because the
 * gunsight's shot sentences name them apart. No article in the catalogue deals
 * unclassified damage, so that one type is absent throughout and the suite pins
 * its position with a written-out split instead.
 */
export function everyStateBuild(): ShipLoadout {
  const build = ShipLoadout.empty(OFFENCE_FIXTURE_HULL);
  for (const [state, slot] of Object.entries(OFFENCE_STATE_SLOTS)) {
    build.setModule(slot, packageModule(OFFENCE_WEAPONS[state as keyof typeof OFFENCE_WEAPONS]));
  }
  return build;
}

/**
 * A build whose sustained firing load outruns the capacitor's recharge.
 *
 * Four large beam lasers on no pips: `timeToDrain` is a finite number of
 * seconds, which is the `finite` endurance meaning.
 */
export function drainingBuild(): ShipLoadout {
  const build = ShipLoadout.empty(OFFENCE_FIXTURE_HULL);
  build.setModule('HugeHardpoint1', packageModule('Hpt_BeamLaser_Fixed_Huge'));
  for (const slot of ['LargeHardpoint1', 'LargeHardpoint2', 'LargeHardpoint3']) {
    build.setModule(slot, packageModule(OFFENCE_WEAPONS.drain));
  }
  return build;
}

/**
 * A build whose weapons capacitor holds nothing at all.
 *
 * The distributor is switched off, which is one of several ways the package
 * documents reaching a zero-capacity result. Which one applied is not something
 * the package says, so nothing this feature draws says it either: the fixture
 * exists to produce the result, not to name a cause (FR-007).
 *
 * One huge beam laser draws against that empty capacitor, so `timeToDrain` is
 * the package's own `0` — the `immediate` endurance meaning.
 */
export function zeroCapacityBuild(): ShipLoadout {
  const build = ShipLoadout.empty(OFFENCE_FIXTURE_HULL);
  build.setModuleEnabled(OFFENCE_DISTRIBUTOR_SLOT, false);
  build.setModule('HugeHardpoint1', packageModule('Hpt_BeamLaser_Fixed_Huge'));
  return build;
}

/**
 * The same empty capacitor with nothing firing at it.
 *
 * A different outcome from the one above, and deliberately kept apart from it:
 * zero capacity beside a zero draw returns positive infinity, which says the
 * load never drains rather than that it lasts forever
 * (`contracts/capacitor-endurance.md`, "Empty, unavailable and disabled
 * contexts").
 */
export function idleZeroCapacityBuild(): ShipLoadout {
  const build = ShipLoadout.empty(OFFENCE_FIXTURE_HULL);
  build.setModuleEnabled(OFFENCE_DISTRIBUTOR_SLOT, false);
  return build;
}

/** Feature 002's answers, as this feature receives them. */
export const OFFENCE_COVERAGE = {
  complete: { kind: 'complete', occupiedSlots: [...OFFENCE_DEFAULT_SLOTS] },
  confirmedEmpty: { kind: 'confirmedEmpty' },
  unavailable: { kind: 'unavailable' },
} as const satisfies Record<string, HardpointCoverage>;

/**
 * The allocation the fixtures read the capacitor at, when the point is not the
 * allocation itself: the game's own opening WEP setting.
 */
export const OFFENCE_FIXTURE_PIPS = 2;

/** The hull slot the capacitor's own capacity comes from. */
const OFFENCE_DISTRIBUTOR_SLOT = 'PowerDistributor';

function packageModule(symbol: string): OutfittingModule {
  const module = getModuleBySymbol(symbol);
  if (module === null || module === undefined) {
    throw new Error(
      `The installed Almanac no longer carries "${symbol}". Pick a new fixture from the ` +
        'package rather than writing one here.',
    );
  }
  return module;
}
