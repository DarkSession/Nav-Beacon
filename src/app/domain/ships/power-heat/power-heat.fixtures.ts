import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import type { OutfittingModule } from '@elite-dangerous-almanac/core/ships/modules';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { defaultBuild } from '../outfitting/outfitting.fixtures';

/**
 * Builds that reach the states this feature has to tell apart.
 *
 * Every one of them is a real `ShipLoadout` the package answers for. Nothing
 * here writes down a megawatt, a megajoule or a heat level: the fixtures put a
 * build into a condition and let `powerBudget()`, `distributorMetricsResult()`
 * and `heatMetricsResult()` say what that condition means (constitution II).
 *
 * The module symbols below are identities the installed package either carries
 * or does not, and `packageModule` fails loudly when one stops being carried —
 * a fixture that silently degraded into "the default build again" would make a
 * suite pass while testing nothing.
 */

/** The fixture hull, which has every mount kind and a generous plant. */
export const POWER_FIXTURE_HULL = 'Anaconda';

/**
 * The mount whose priority these fixtures move to reach the fifth band.
 *
 * Thrusters, because they are the largest single draw on the default build and
 * are not `deployedOnly` — so the band they land in draws the same in both
 * hardpoint states, and any divergence between the two verdicts comes from the
 * weapons above it rather than from the band itself.
 */
export const SHED_SLOT = 'MainEngines';

/**
 * The journal's `Priority` is zero-based, and `setModulePriority` takes it that
 * way: `4` here is the outfitting panel's group 5, and the group
 * `PowerConsumerResult.priority` reports as `5`.
 */
const JOURNAL_PRIORITY_GROUP_5 = 4;

/** A build comfortably inside its plant's output, with every band powered. */
export function withinBudgetBuild(): ShipLoadout {
  return defaultBuild(POWER_FIXTURE_HULL);
}

/**
 * A build whose fifth band is shed in both hardpoint states.
 *
 * A small plant under a large thruster draw: group 5's running total is over
 * the plant's output whether the hardpoints are out or not.
 */
export function shedBandBuild(): ShipLoadout {
  return plantedBuild('Int_Powerplant_Size2_Class1');
}

/**
 * A build whose fifth band's two verdicts disagree.
 *
 * The plant covers group 5 with the hardpoints stowed and not with them out,
 * so `poweredRetracted` is `true` and `poweredDeployed` is `false` on the same
 * band. It is the fixture that catches a reader answering about one state with
 * the other state's verdict.
 */
export function divergentBandBuild(): ShipLoadout {
  return plantedBuild('Int_Powerplant_Size4_Class2');
}

/**
 * A build whose demand runs far past its plant.
 *
 * The same small plant as {@link shedBandBuild} under the A-rated drives,
 * frame shift drive and shield generator the hull can carry, so the demand is
 * nearly three times the output and the plant's mark stands in the first third
 * of the track. It is the build that asks whether a second mark can be named
 * beside that one.
 */
export function overloadedPlantBuild(): ShipLoadout {
  const build = plantedBuild('Int_Powerplant_Size2_Class1');
  build.setModule(SHED_SLOT, packageModule('Int_Engine_Size7_Class5'));
  build.setModule('FrameShiftDrive', packageModule('Int_Hyperdrive_Size6_Class5'));
  build.setModule('Slot03_Size6', packageModule('Int_ShieldGenerator_Size6_Class5'));
  return build;
}

/**
 * A build with no powered plant.
 *
 * Zero output, a positive draw, every band shed, `Infinity` utilisation, and
 * both `heatMetricsResult()` and `distributorMetricsResult()` valuing `null` — four of
 * this feature's states in one build, and all four are the package's answers
 * rather than an application special case.
 */
export function noPlantOutputBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModuleEnabled('PowerPlant', false);
  return build;
}

/**
 * A build whose distributor is switched off.
 *
 * `distributorMetricsResult()` values `null` while heat and power stay readable, and
 * the switched-off distributor keeps its row in `consumers` — the disabled
 * consumer FR-004 says must stay visible.
 */
export function distributorOffBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModuleEnabled('PowerDistributor', false);
  return build;
}

/**
 * A build that cooks itself on a drained weapons capacitor.
 *
 * The huge beam laser's alpha strike puts more load into the hull than it can
 * shed, so the package's `firingDrained` reports `Infinity` heat level and
 * gauge, while `firingSustained` stays finite and never overheats. The panel
 * draws only the second.
 */
export function overheatingBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModule('HugeHardpoint1', packageModule('Hpt_BeamLaser_Fixed_Huge'));
  return build;
}

/**
 * A build that cooks itself under sustained fire, which is the rail's sentence.
 *
 * Four beam lasers put more load into the hull than it sheds, so
 * `firingSustained` reports `Infinity` heat level, `Infinity` gauge,
 * `overheats: true` and a finite `secondsToOverheat` — the scenario the status
 * rail names, in the one shape the package produces for it. Every profile
 * observed pairs an overheat with a load that never settles; the rail still
 * reads the two fields separately, because it states what each says rather
 * than deriving one from the other (FR-011).
 */
export function sustainedOverheatBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModule('HugeHardpoint1', packageModule('Hpt_BeamLaser_Fixed_Huge'));
  for (const slot of ['LargeHardpoint1', 'LargeHardpoint2', 'LargeHardpoint3']) {
    build.setModule(slot, packageModule('Hpt_BeamLaser_Fixed_Large'));
  }
  return build;
}

/**
 * The default build with an A-rated shield cell bank in its largest optional
 * slot.
 *
 * `heatMetricsResult()` publishes no scenario for a bank, so this is the build
 * whose heat block draws the bank's bar after the four scenarios. The bank's
 * spike runs the gauge past the module-damage threshold.
 */
export function overheatingBankBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModule('Slot01_Size7', packageModule('Int_ShieldCellBank_Size7_Class5'));
  return build;
}

/**
 * The default build with every weapon mount emptied.
 *
 * `weaponMetrics()` returns nothing for it, and `heatMetricsResult()` still
 * returns its sustained-fire scenario. Utility mounts keep what they carry.
 */
export function unarmedBuild(): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  for (const { slot } of build.fittedModules()) {
    if (/^(?:Small|Medium|Large|Huge)Hardpoint/u.test(slot)) {
      build.removeModule(slot);
    }
  }
  return build;
}

/** The default build with a smaller plant and the thrusters moved to group 5. */
function plantedBuild(plant: string): ShipLoadout {
  const build = defaultBuild(POWER_FIXTURE_HULL);
  build.setModule('PowerPlant', packageModule(plant));
  build.setModulePriority(SHED_SLOT, JOURNAL_PRIORITY_GROUP_5);
  return build;
}

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
