import { BLUEPRINTS } from '@elite-dangerous-almanac/core/ships/blueprints';
import {
  getBlueprintsForModule,
  getExperimentalsForModule,
} from '@elite-dangerous-almanac/core/ships/engineering-options';
import { EXPERIMENTAL_EFFECTS } from '@elite-dangerous-almanac/core/ships/experimental-effects';
import { ALL_MODULES } from '@elite-dangerous-almanac/core/ships/modules-all';
import { PRE_ENGINEERED_MODULES } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  assertCapacityFitsEnvelope,
  assertCapacityWithinCodecLimits,
  assertTableFitsEnvelope,
  assertTableWithinCapacity,
  readCodecConstants,
} from './build-link-codec-capacity.mjs';

const TABLE_VERSION = 2;
/**
 * The table versions a decoder still answers for, oldest first.
 *
 * The application is published, so every one of these files is a promise to the links already
 * shared against it: a Commander's link names the table that decodes it, and that table has to
 * hold the content it held when the link was made. This script therefore writes the current
 * table only, and refuses to touch an earlier one at all.
 */
const PUBLISHED_TABLE_VERSIONS = [1];
const tablePathFor = (version) =>
  fileURLToPath(
    new URL(`../src/app/domain/ships/build-link/codec-table-${version}.json`, import.meta.url),
  );
const outputPath = process.env.CODEC_TABLE_OUTPUT_PATH ?? tablePathFor(TABLE_VERSION);
const almanacPackageUrl = new URL(
  '../../package.json',
  import.meta.resolve('@elite-dangerous-almanac/core/ships/ships'),
);
const almanacPackage = JSON.parse(await readFile(almanacPackageUrl, 'utf8'));
const almanacVersion = almanacPackage.version;

/**
 * A table's identity is its content, not the Almanac release it came from. Upgrading the
 * package is expected to reproduce the same table; only a table whose content moved is a
 * new encoding, because every published link is decoded with the table its payload names.
 * Hashing the payload — everything but `$generated`, which holds the table's label and the
 * hash itself rather than any encoded value — is what tells those two cases apart.
 */
const canonicalise = (value) => {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
};
const contentHashOf = (payload) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalise(payload)))
    .digest('hex');

const assertUniqueIdentities = (values, kind) => {
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${kind} contains an empty or non-string identity.`);
    }
    const key = value.toLowerCase();
    if (seen.has(key)) throw new Error(`${kind} contains duplicate identity ${value}.`);
    seen.add(key);
  }
};
const assertIndexes = (values, valueCount, kind) => {
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value >= valueCount)) {
    throw new Error(`${kind} contains an out-of-range index.`);
  }
};

const ships = SHIPS.map(({ symbol }) => symbol);
const stockLoadouts = Object.fromEntries(ships.map((ship) => [ship, ShipLoadout.default(ship)]));
const modules = ALL_MODULES.map(({ symbol }) => symbol);
const knownModules = new Set(modules.map((symbol) => symbol.toLowerCase()));
const moduleStatsBySymbol = new Map(
  ALL_MODULES.map((module) => [module.symbol.toLowerCase(), module]),
);
for (const ship of ships) {
  for (const module of stockLoadouts[ship].fittedModules()) {
    const { symbol } = module;
    if (knownModules.has(symbol.toLowerCase())) continue;
    if (module.stats === null) {
      throw new Error(`Stock module ${symbol} has no catalogue statistics.`);
    }
    knownModules.add(symbol.toLowerCase());
    modules.push(symbol);
    moduleStatsBySymbol.set(symbol.toLowerCase(), module.stats);
  }
}
/**
 * Which modules carry a power state in a link.
 *
 * The mirror of the mount card's own `showsPower`, and it has to be: a mount
 * that offers a Commander a power chip has a state to carry, and a state the
 * link drops is a setting that survives the local record and dies in the share.
 *
 * A module the Almanac prices at no draw — the surface scanner, the approach
 * suites, the module stabilisers — has nothing to power and nothing to group,
 * and neither the card nor the link spends a bit on one. A module whose draw
 * the Almanac does not publish — every power plant, fuel tank, cargo rack,
 * reinforcement, passenger cabin and bulkhead — keeps its state, because not
 * having read a figure is not the same as having read a zero (constitution IV).
 * Excluding those was why a priority set on the plant came back unset from a
 * shared link while the record beside it still held it (reported 2026-08-26).
 */
const poweredModules = modules.flatMap((symbol, index) => {
  const powerDraw = moduleStatsBySymbol.get(symbol.toLowerCase())?.powerDraw;
  return typeof powerDraw === 'number' && powerDraw <= 0 ? [] : [index];
});
const blueprints = [
  ...new Set([
    ...Object.keys(BLUEPRINTS),
    ...PRE_ENGINEERED_MODULES.map(({ blueprintSymbol }) => blueprintSymbol),
  ]),
].sort();
const blueprintGrades = blueprints.map((fdname) => {
  const blueprint = BLUEPRINTS[fdname];
  if (!blueprint) return [];
  const grades = Object.keys(blueprint.grades).map(Number);
  if (
    grades.length === 0 ||
    grades.some(
      (grade, index) =>
        !Number.isInteger(grade) || grade < 1 || grade > 5 || grade <= (grades[index - 1] ?? 0),
    )
  ) {
    throw new Error(`Engineering blueprint ${fdname} has unsupported grades.`);
  }
  return grades;
});
const experimentalEffects = Object.keys(EXPERIMENTAL_EFFECTS).sort();
assertUniqueIdentities(ships, 'Ship table');
assertUniqueIdentities(modules, 'Module table');
assertUniqueIdentities(blueprints, 'Blueprint table');
assertUniqueIdentities(experimentalEffects, 'Experimental-effect table');
const moduleIndex = new Map(modules.map((symbol, index) => [symbol.toLowerCase(), index]));
const blueprintIndex = new Map(blueprints.map((fdname, index) => [fdname.toLowerCase(), index]));
const experimentalIndex = new Map(
  experimentalEffects.map((fdname, index) => [fdname.toLowerCase(), index]),
);
/**
 * The codec encodes the mounts whose module the commander chooses, and carries the rest as
 * stock. That split is about what can be *fitted*, not what can be *emptied*: a hull's
 * armour and seven core internals cannot be left empty, yet every one of them takes a
 * choice of module. Only the built-in cargo hatch offers no choice at all.
 */
const isEncodableSlot = ({ kind }) => kind !== 'cargoHatch';
const encodableSlotsByShip = Object.fromEntries(
  ships.map((ship) => [ship, ShipLoadout.empty(ship).slots().filter(isEncodableSlot)]),
);
const slotsByShip = Object.fromEntries(
  ships.map((ship) => [ship, encodableSlotsByShip[ship].map(({ key }) => key)]),
);
for (const ship of ships) assertUniqueIdentities(slotsByShip[ship], `${ship} slot table`);
const indexOf = (index, identity, kind) => {
  const value = index.get(identity.toLowerCase());
  if (value === undefined) throw new Error(`Missing ${kind} identity ${identity}.`);
  return value;
};

const fixedModulesByShip = Object.fromEntries(
  ships.map((ship) => {
    const stock = stockLoadouts[ship];
    return [
      ship,
      ShipLoadout.empty(ship)
        .slots()
        .filter((slot) => !isEncodableSlot(slot))
        .map(({ key }) => {
          const module = stock.fittedModuleAt(key);
          if (!module) throw new Error(`Fixed slot ${ship}:${key} has no stock module.`);
          return { slot: key, module: indexOf(moduleIndex, module.symbol, 'fixed module') };
        }),
    ];
  }),
);

const preEngineeredVariants = PRE_ENGINEERED_MODULES.map(
  ({
    symbol,
    blueprintSymbol: blueprint,
    grade,
    acquisition,
    experimentalEffectSymbol: experimental,
  }) => ({
    module: indexOf(moduleIndex, symbol, 'pre-engineered module'),
    blueprint: indexOf(blueprintIndex, blueprint, 'pre-engineered blueprint'),
    grade,
    acquisition,
    experimental:
      experimental === undefined || experimental === null
        ? null
        : indexOf(experimentalIndex, experimental, 'pre-engineered experimental effect'),
  }),
);
const preEngineeredKeys = preEngineeredVariants.map(
  ({ module, blueprint, grade, acquisition }) => `${module}:${blueprint}:${grade}:${acquisition}`,
);
if (new Set(preEngineeredKeys).size !== preEngineeredKeys.length) {
  throw new Error('Pre-engineered codec identities are not unique.');
}

const internSets = () => {
  const unique = [];
  const indexes = new Map();
  return {
    intern(values) {
      const key = values.join(',');
      const existing = indexes.get(key);
      if (existing !== undefined) return existing;
      const index = unique.length;
      unique.push(values);
      indexes.set(key, index);
      return index;
    },
    unique,
  };
};

/**
 * How a candidate set is ordered, and why the order is worth pinning.
 *
 * A contextual index is priced by `CONTEXT_INDEX_DECAY`, which makes an early position in a
 * candidate set much cheaper than a late one. That only pays if the sets are ordered by how
 * likely a Commander is to fit the article, so the tables below put the popular choice first.
 *
 * They are a hand-estimated prior, and they are a prior over the package's own records: the sort
 * reads the size, class, mount and family the package publishes for each module, and ranks those
 * values. This repository does not keep game data of its own, and none of this is
 * game data — a wrong guess costs a link a few characters and nothing else, because the order is
 * table data that every decoder of that table reads back identically.
 *
 * The ranks below hold for the slot kinds a set belongs to. Core mounts take one family each, so
 * their order comes from the class rank alone, except that the overcharge drives outrank the
 * plain ones because outfitting no longer sells a size-8 drive outside that line.
 */
const MODULE_FAMILY_ORDER_BY_SLOT_KIND = {
  optional: [
    'shieldGenerators',
    'hullReinforcements',
    'cargoRacks',
    'fuelScoops',
    'shieldCellBanks',
    'fsdBoosters',
    'moduleReinforcements',
    'fsdInterdictors',
    'collectorLimpets',
    'fuelTransferLimpets',
    'prospectingLimpets',
    'hatchBreakerLimpets',
    'repairLimpets',
    'researchLimpets',
    'decontaminationLimpets',
    'reconLimpets',
    'miningMultiLimpetControllers',
    'multiLimpetControllers',
    'vesselHangars',
    'planetaryVehicleHangars',
    'surfaceScanners',
    'dockingComputers',
    'flightAssists',
    'refineries',
    'fuelTanks',
    'passengerCabins',
  ],
  hardpoint: [
    'multiCannons',
    'beamLasers',
    'pulseLasers',
    'burstLasers',
    'railGuns',
    'plasmaAccelerators',
    'fragmentCannons',
    'cannons',
    'missiles',
    'mines',
    'torpedoes',
  ],
  utility: ['shieldBoosters', 'chaffLaunchers', 'heatsinkLaunchers', 'pointDefence'],
};
/** Rating letters in the order a fitted module usually carries them. */
const MODULE_RATING_ORDER = ['A', 'D', 'B', 'C', 'E'];
const MODULE_MOUNT_ORDER = ['Gimballed', 'Fixed', 'Turreted'];
const rankIn = (order, value) => {
  const rank = order.indexOf(value);
  return rank === -1 ? order.length : rank;
};
const moduleFamilyRank = (slot, record) => {
  if (slot.kind === 'core') return record.supercruiseOvercharge === true ? 0 : 1;
  const order = MODULE_FAMILY_ORDER_BY_SLOT_KIND[slot.kind];
  return order === undefined ? 0 : rankIn(order, record.familyId);
};
const moduleSortKey = (slot, record) => {
  if (!record) return [2, 0, 0, 0, 0];
  const size = typeof record.class === 'number' ? record.class : 0;
  return [
    size === slot.size ? 0 : 1,
    -size,
    moduleFamilyRank(slot, record),
    rankIn(MODULE_RATING_ORDER, record.rating),
    rankIn(MODULE_MOUNT_ORDER, record.mount),
  ];
};
/** Sort by the ranks `rankOf` returns, most significant first; ties keep catalogue order. */
const orderCandidates = (candidates, rankOf) =>
  candidates
    .map((value, position) => ({ value, position }))
    .sort((left, right) => {
      const leftRank = rankOf(left.value);
      const rightRank = rankOf(right.value);
      for (const [position, rank] of leftRank.entries()) {
        if (rank !== rightRank[position]) return rank - rightRank[position];
      }
      return left.position - right.position;
    })
    .map(({ value }) => value);
const orderModuleCandidates = (candidates, slot) =>
  orderCandidates(candidates, (module) =>
    moduleSortKey(slot, moduleStatsBySymbol.get(modules[module].toLowerCase())),
  );

/**
 * Blueprints in the order a Commander usually picks them, most popular first, so the pinned
 * decay prices the common roll cheaply. A blueprint this list does not name keeps its catalogue
 * position after the ones it does.
 */
const BLUEPRINT_ORDER = [
  'Weapon_Overcharged',
  'Weapon_Efficient',
  'Weapon_LongRange',
  'Weapon_ShortRange',
  'Weapon_Focused',
  'Weapon_Sturdy',
  'Weapon_RapidFire',
  'Weapon_HighCapacity',
  'Weapon_LightWeight',
  'Weapon_DoubleShot',
  'ShieldGenerator_Thermic',
  'ShieldGenerator_Reinforced',
  'ShieldGenerator_Kinetic',
  'ShieldGenerator_Optimised',
  'ShieldBooster_HeavyDuty',
  'ShieldBooster_Resistive',
  'ShieldBooster_Thermic',
  'ShieldBooster_Kinetic',
  'ShieldBooster_Explosive',
  'Engine_Dirty',
  'Engine_Tuned',
  'Engine_Reinforced',
  'FSD_LongRange',
  'FSD_Shielded',
  'FSD_FastBoot',
  'PowerPlant_Armoured',
  'PowerPlant_Boosted',
  'PowerPlant_Stealth',
  'PowerDistributor_HighFrequency',
  'PowerDistributor_PriorityEngines',
  'PowerDistributor_PriorityWeapons',
  'PowerDistributor_PrioritySystems',
  'PowerDistributor_Shielded',
  'PowerDistributor_HighCapacity',
  'PowerDistributor_Balanced',
  'Sensor_LightWeight',
  'Sensor_LongRange',
  'Sensor_WideAngle',
  'Sensor_Expanded',
  'Sensor_FastScan',
  'LifeSupport_LightWeight',
  'LifeSupport_Reinforced',
  'LifeSupport_Shielded',
  'Armour_HeavyDuty',
  'Armour_Kinetic',
  'Armour_Thermic',
  'Armour_Explosive',
  'Armour_Advanced',
  'HullReinforcement_HeavyDuty',
  'HullReinforcement_Kinetic',
  'HullReinforcement_Thermic',
  'HullReinforcement_Explosive',
  'HullReinforcement_Advanced',
  'ModuleReinforcement_HeavyDuty',
  'ShieldCellBank_Specialised',
  'ShieldCellBank_Rapid',
  'FSDinterdictor_LongRange',
  'FSDinterdictor_Expanded',
  'FuelScoop_Efficiency',
  'FuelScoop_Shielded',
  'DetailedSurfaceScanner_LongRange',
  'Misc_Shielded',
  'Misc_LightWeight',
  'Misc_Reinforced',
  'Misc_ChaffCapacity',
  'Misc_HeatSinkCapacity',
  'Misc_PointDefenseCapacity',
  'CollectionLimpet_LightWeight',
  'CollectionLimpet_Reinforced',
  'CollectionLimpet_Shielded',
  'FuelTransferLimpet_LightWeight',
  'FuelTransferLimpet_Reinforced',
  'FuelTransferLimpet_Shielded',
  'HatchBreakerLimpet_LightWeight',
  'HatchBreakerLimpet_Reinforced',
  'HatchBreakerLimpet_Shielded',
  'ProspectingLimpet_LightWeight',
  'ProspectingLimpet_Reinforced',
  'ProspectingLimpet_Shielded',
];
const orderBlueprintCandidates = (candidates) =>
  orderCandidates(candidates, (blueprint) => [rankIn(BLUEPRINT_ORDER, blueprints[blueprint])]);

const moduleSets = internSets();
const moduleSetByShip = {};
const defaultModulesByShip = {};
for (const ship of ships) {
  const empty = ShipLoadout.empty(ship);
  const stock = stockLoadouts[ship];
  const slots = slotsByShip[ship];
  moduleSetByShip[ship] = encodableSlotsByShip[ship].map((slot) => {
    let candidates = [];
    try {
      candidates = empty
        .modulesForSlot(slot.key)
        .map(({ symbol }) => indexOf(moduleIndex, symbol, 'module'));
    } catch {
      // Immutable built-ins have no editor candidate list; global fallback remains available.
    }
    return moduleSets.intern(orderModuleCandidates(candidates, slot));
  });
  defaultModulesByShip[ship] = slots.map((slot) => {
    const module = stock.fittedModuleAt(slot);
    return module ? indexOf(moduleIndex, module.symbol, 'module') : null;
  });
}

const blueprintSets = internSets();
const experimentalSets = internSets();
const preEngineeredSetByModule = modules.map((symbol) =>
  preEngineeredVariants.flatMap(({ module }, index) =>
    modules[module].toLowerCase() === symbol.toLowerCase() ? [index] : [],
  ),
);
/**
 * Every blueprint a record over this module may name.
 *
 * The module's own engineering menu, and then the blueprints its pre-engineered variants carry.
 * A bought article can be climbed past the grade it was sold at, and the variant record only
 * reproduces the grade on the receipt, so a climbed article has to be written as an ordinary
 * record naming that same blueprint. Six modules are sold pre-engineered with no ordinary menu
 * of their own — the Mercenary hardpoints among them — and until their variants' blueprints
 * joined this set, climbing one past its purchased grade left the build with no encodable record
 * at all and the link simply vanished.
 */
const blueprintSetByModule = modules.map((symbol, moduleIndex) =>
  blueprintSets.intern(
    orderBlueprintCandidates([
      ...new Set([
        ...getBlueprintsForModule(symbol).map((fdname) =>
          indexOf(blueprintIndex, fdname, 'engineering blueprint'),
        ),
        ...preEngineeredSetByModule[moduleIndex].map(
          (variant) => preEngineeredVariants[variant].blueprint,
        ),
      ]),
    ]),
  ),
);
/**
 * Experimental effects keep their catalogue order. The package publishes a name, a modifier
 * block and a description for each one and nothing that separates a popular effect from a rare
 * one, so any ranking here would be game knowledge this repository invented rather than a prior
 * over the package's records. `CONTEXT_INDEX_FLOOR` is what keeps the pinned decay from taxing
 * an unordered set: it bounds how much a late position can cost against uniform coding.
 */
const experimentalSetByModule = modules.map((symbol) =>
  experimentalSets.intern(
    getExperimentalsForModule(symbol).map((fdname) =>
      indexOf(experimentalIndex, fdname, 'experimental effect'),
    ),
  ),
);

assertIndexes(poweredModules, modules.length, 'Powered-module table');
for (const ship of ships) {
  const slots = slotsByShip[ship];
  if (
    moduleSetByShip[ship].length !== slots.length ||
    defaultModulesByShip[ship].length !== slots.length
  ) {
    throw new Error(`${ship} has inconsistent parallel slot tables.`);
  }
  assertIndexes(moduleSetByShip[ship], moduleSets.unique.length, `${ship} module-set table`);
  assertIndexes(
    defaultModulesByShip[ship].filter((value) => value !== null),
    modules.length,
    `${ship} default-module table`,
  );
  assertIndexes(
    fixedModulesByShip[ship].map(({ module }) => module),
    modules.length,
    `${ship} fixed-module table`,
  );
  assertUniqueIdentities(
    fixedModulesByShip[ship].map(({ slot }) => slot),
    `${ship} fixed-slot table`,
  );
}
for (const [index, set] of moduleSets.unique.entries()) {
  assertIndexes(set, modules.length, `Module candidate set ${index}`);
}
for (const [index, set] of blueprintSets.unique.entries()) {
  assertIndexes(set, blueprints.length, `Blueprint candidate set ${index}`);
}
for (const [index, set] of experimentalSets.unique.entries()) {
  assertIndexes(set, experimentalEffects.length, `Experimental candidate set ${index}`);
}
if (
  blueprintGrades.length !== blueprints.length ||
  blueprintSetByModule.length !== modules.length ||
  experimentalSetByModule.length !== modules.length ||
  preEngineeredSetByModule.length !== modules.length
) {
  throw new Error('Codec table parallel arrays have inconsistent lengths.');
}
assertIndexes(blueprintSetByModule, blueprintSets.unique.length, 'Blueprint-set mapping');
assertIndexes(experimentalSetByModule, experimentalSets.unique.length, 'Experimental-set mapping');
for (const [index, variant] of preEngineeredVariants.entries()) {
  assertIndexes([variant.module], modules.length, `Pre-engineered variant ${index} module`);
  assertIndexes(
    [variant.blueprint],
    blueprints.length,
    `Pre-engineered variant ${index} blueprint`,
  );
  if (variant.experimental !== null) {
    assertIndexes(
      [variant.experimental],
      experimentalEffects.length,
      `Pre-engineered variant ${index} experimental`,
    );
  }
}
for (const [index, set] of preEngineeredSetByModule.entries()) {
  assertIndexes(set, preEngineeredVariants.length, `Pre-engineered module set ${index}`);
}
const payload = {
  SHIPS: ships,
  MODULES: modules,
  POWERED_MODULES: poweredModules,
  BLUEPRINTS: blueprints,
  BLUEPRINT_GRADES: blueprintGrades,
  EXPERIMENTAL_EFFECTS: experimentalEffects,
  SLOTS_BY_SHIP: slotsByShip,
  FIXED_MODULES_BY_SHIP: fixedModulesByShip,
  DEFAULT_MODULES_BY_SHIP: defaultModulesByShip,
  MODULE_SETS: moduleSets.unique,
  MODULE_SET_BY_SHIP: moduleSetByShip,
  BLUEPRINT_SETS: blueprintSets.unique,
  BLUEPRINT_SET_BY_MODULE: blueprintSetByModule,
  EXPERIMENTAL_SETS: experimentalSets.unique,
  EXPERIMENTAL_SET_BY_MODULE: experimentalSetByModule,
  PRE_ENGINEERED_VARIANTS: preEngineeredVariants,
  PRE_ENGINEERED_SET_BY_MODULE: preEngineeredSetByModule,
};

/**
 * Pinned symbol models, mirrored against the codec's own validation bounds. The weights are
 * hand-estimated priors for real builds — grades are usually maximal, engineered modules
 * usually carry an experimental effect, identities almost always resolve contextually,
 * explicit enabled states are usually on, a changed slot is usually filled rather than emptied,
 * an engineering record on a mount that already has one usually repeats it, names read like
 * English while idents read like callsigns — validated against the reference corpus in
 * `build-link-codec-models.spec.ts`. Back-reference streams adapt at increment 8, the largest
 * increment the corpus does not pay for. The candidate-set decay pays because the sets above are
 * ordered by a popularity prior, and its floor bounds what a late position costs when that
 * prior is wrong. Like every other pinned array, these numbers are frozen once the table is
 * published: better-measured weights belong to the next table version.
 */
const MAX_MODEL_WEIGHT_TOTAL = 2 ** 24;
const MAX_CONTEXT_INDEX_DECAY_DENOMINATOR = 64;
const CONTEXT_INDEX_FIRST_WEIGHT = 2 ** 16;
const MAX_CONTEXT_ADAPTATION_INCREMENT = 2 ** 16;
const COMPACT_STRING_ALPHABET_LENGTH = 64;
const PINNED_SYMBOL_MODELS = {
  GRADE_IS_MAX: [1, 7],
  EXPERIMENTAL_PRESENT: [1, 3],
  CONTEXT_HIT: [1, 31],
  ENGINEERING_REFERENCE: [1, 3],
  IDENTITY_REPEATED: [7, 1],
  IDENTITY_IS_DEFAULT: [3, 1],
  BASELINE_SLOT_PRESENT: [1, 7],
  POWER_ON: [2, 1, 5],
  POWER_PRIORITY: [4, 4, 8, 5, 3, 2],
  CONTEXT_INDEX_DECAY: [3, 4],
  CONTEXT_INDEX_FLOOR: 2_048,
  CONTEXT_ADAPTATION: 8,
  NAME_CHARACTERS: [
    // A-Z
    41, 8, 14, 22, 64, 11, 10, 31, 35, 2, 4, 20, 12, 34, 38, 10, 2, 30, 32, 46, 14, 5, 12, 2, 10, 2,
    // a-z
    82, 15, 28, 43, 127, 22, 20, 61, 70, 2, 8, 40, 24, 67, 75, 19, 1, 60, 63, 91, 28, 10, 24, 2, 20,
    1,
    // 0-9
    8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
    // space, dash
    40, 12,
  ],
  IDENT_CHARACTERS: [
    // A-Z
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
    // a-z
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    // 0-9
    40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
    // space, dash
    2, 60,
  ],
};

// The codec's `createSymbolModels` is the authoritative validator and the unit specs run it
// against the committed JSON; this mirror only fails generation before a bad table is written.
const assertModelWeights = (weights, expectedLength, kind) => {
  if (!Array.isArray(weights) || weights.length !== expectedLength) {
    throw new Error(`${kind} must pin exactly ${expectedLength} weights.`);
  }
  if (weights.some((weight) => !Number.isSafeInteger(weight) || weight < 1)) {
    throw new Error(`${kind} weights must be positive integers.`);
  }
  if (weights.reduce((total, weight) => total + weight, 0) > MAX_MODEL_WEIGHT_TOTAL) {
    throw new Error(`${kind} weights exceed the model weight-total cap.`);
  }
};
// A model a table leaves out prices its symbol uniformly, so only a key that is present is
// checked. The codec validates the same way.
const assertOptionalModelWeights = (weights, expectedLength, kind) => {
  if (weights === undefined) return;
  assertModelWeights(weights, expectedLength, kind);
};
const assertSymbolModels = (models) => {
  assertModelWeights(models.GRADE_IS_MAX, 2, 'GRADE_IS_MAX');
  assertModelWeights(models.EXPERIMENTAL_PRESENT, 2, 'EXPERIMENTAL_PRESENT');
  assertModelWeights(models.CONTEXT_HIT, 2, 'CONTEXT_HIT');
  assertOptionalModelWeights(models.ENGINEERING_REFERENCE, 2, 'ENGINEERING_REFERENCE');
  assertOptionalModelWeights(models.IDENTITY_REPEATED, 2, 'IDENTITY_REPEATED');
  assertOptionalModelWeights(models.IDENTITY_IS_DEFAULT, 2, 'IDENTITY_IS_DEFAULT');
  assertOptionalModelWeights(models.BASELINE_SLOT_PRESENT, 2, 'BASELINE_SLOT_PRESENT');
  assertModelWeights(models.POWER_ON, 3, 'POWER_ON');
  assertModelWeights(models.POWER_PRIORITY, 6, 'POWER_PRIORITY');
  assertModelWeights(models.NAME_CHARACTERS, COMPACT_STRING_ALPHABET_LENGTH, 'NAME_CHARACTERS');
  assertModelWeights(models.IDENT_CHARACTERS, COMPACT_STRING_ALPHABET_LENGTH, 'IDENT_CHARACTERS');
  const [decayNumerator, decayDenominator, ...decayRest] = models.CONTEXT_INDEX_DECAY;
  if (
    decayRest.length > 0 ||
    !Number.isSafeInteger(decayNumerator) ||
    !Number.isSafeInteger(decayDenominator) ||
    decayNumerator < 1 ||
    decayDenominator < decayNumerator ||
    decayDenominator > MAX_CONTEXT_INDEX_DECAY_DENOMINATOR
  ) {
    throw new Error('CONTEXT_INDEX_DECAY must be a valid [numerator, denominator] pair.');
  }
  if (
    models.CONTEXT_INDEX_FLOOR !== undefined &&
    (!Number.isSafeInteger(models.CONTEXT_INDEX_FLOOR) ||
      models.CONTEXT_INDEX_FLOOR < 1 ||
      models.CONTEXT_INDEX_FLOOR > CONTEXT_INDEX_FIRST_WEIGHT)
  ) {
    throw new Error('CONTEXT_INDEX_FLOOR must be a weight the decay can reach.');
  }
  if (
    !Number.isSafeInteger(models.CONTEXT_ADAPTATION) ||
    models.CONTEXT_ADAPTATION < 0 ||
    models.CONTEXT_ADAPTATION > MAX_CONTEXT_ADAPTATION_INCREMENT
  ) {
    throw new Error('CONTEXT_ADAPTATION must be a bounded non-negative integer.');
  }
};
assertSymbolModels(PINNED_SYMBOL_MODELS);

/**
 * The models ride in the same table as the catalogue they price, and are frozen with it. A
 * better-measured weight is a different encoding of the same build, so it belongs to the next
 * table version beside the catalogue move that mints it.
 */
const tablePayload = { ...payload, MODELS: PINNED_SYMBOL_MODELS };

const codecConstants = await readCodecConstants();
assertCapacityWithinCodecLimits();
const budgeted = assertCapacityFitsEnvelope(codecConstants);
assertTableWithinCapacity(tablePayload);
const envelope = assertTableFitsEnvelope(tablePayload, codecConstants);

const contentHash = contentHashOf(tablePayload);
const payloadOf = (table) =>
  Object.fromEntries(Object.entries(table).filter(([key]) => key !== '$generated'));
const readTable = async (path) => JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));

/**
 * Every earlier table still holds the content its declared hash names.
 *
 * A link shared before today decodes with the table it names, so an edit to one of those files
 * silently changes what an already-shared link means. Reading them back on every run is what
 * turns that from a thing to remember into a thing the build refuses.
 */
for (const version of PUBLISHED_TABLE_VERSIONS) {
  const path = tablePathFor(version);
  const table = await readTable(path);
  if (table === null) {
    throw new Error(
      `Codec table ${version} is missing.\nA link naming table ${version} has no other table ` +
        'that decodes it, so the file stays in the repository for as long as the link does.',
    );
  }
  const actual = contentHashOf(payloadOf(table));
  if (table.$generated?.contentHash !== actual) {
    throw new Error(
      `Codec table ${version} content does not match its declared hash\n` +
        `  declared: ${table.$generated?.contentHash ?? '(none recorded)'}\n` +
        `  actual:   ${actual}\n` +
        `Table ${version} is published. Restore it, and mint a new table version for the ` +
        'content you meant to change.',
    );
  }
}

const previous = await readTable(outputPath);
const previousHash = previous ? contentHashOf(payloadOf(previous)) : null;
const declaredPreviousHash = previous?.$generated?.contentHash;

if (previous && declaredPreviousHash !== previousHash) {
  throw new Error(
    `Codec table ${TABLE_VERSION} content does not match its declared hash\n` +
      `  declared: ${declaredPreviousHash ?? '(none recorded)'}\n` +
      `  actual:   ${previousHash}\n` +
      'Refusing to replace a table whose integrity check failed.',
  );
}

if (previous && previousHash !== contentHash) {
  throw new Error(
    `Codec table ${TABLE_VERSION} content changed under Almanac ${almanacVersion}\n` +
      `  committed: ${previousHash}\n` +
      `  generated: ${contentHash}\n` +
      'Every published link names the table version that decodes it, so a changed table is a\n' +
      `new encoding. Raise TABLE_VERSION, add ${TABLE_VERSION} to PUBLISHED_TABLE_VERSIONS, and\n` +
      'teach the codec loader to read the new file. A published table is never written again.',
  );
}

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      $generated: {
        tableVersion: TABLE_VERSION,
        contentHash,
      },
      ...tablePayload,
    },
    null,
    2,
  )}\n`,
);

console.log(
  previous && previousHash === contentHash
    ? `Codec table ${TABLE_VERSION} unchanged under Almanac ${almanacVersion} (${contentHash.slice(0, 12)}…).`
    : `Codec table ${TABLE_VERSION} written from Almanac ${almanacVersion} (${contentHash.slice(0, 12)}…).`,
);
// Printed every run so the trend is visible long before the budget refuses a table.
console.log(
  `Largest build it can express: up to ${envelope.bytes} of the ${envelope.limit} bytes a codec value holds` +
    ` (${budgeted.bytes} once grown to the budgeted capacity).`,
);
