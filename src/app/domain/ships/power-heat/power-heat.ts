import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { DistributorMetrics } from '@elite-dangerous-almanac/core/ships/distributor';
import {
  heatLevelAtTime,
  OVERHEAT_HEAT_LEVEL,
  type HeatMetrics,
  type HeatState,
} from '@elite-dangerous-almanac/core/ships/heat';
import type {
  PowerBand,
  PowerBudget,
  PowerConsumerResult,
} from '@elite-dangerous-almanac/core/ships/power';
import type { FittedModule, ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';

/**
 * What the plant makes, what the build draws, what it runs at and what its
 * distributor holds — as canvases 1c and 1d draw it in `POWER & THERMALS`.
 *
 * One pure synchronous read of three `BuildMetrics` methods, and nothing else.
 * There is no store, no cache, no revision key and no lifecycle: the loadout is
 * already in memory, the three calls are synchronous, and the signal graph
 * memoises the whole thing for the surfaces that read it. That is the shape
 * feature 009's rail block already ships, and the shape feature 003's ruling
 * named for features 005 to 008 (`design/reference-review.md`, wave 12).
 *
 * Almost everything below is a *selection* from a package result. The few
 * readings that are not — the powered/unpowered split of the draw, each group's
 * share of plant output, and what a kind of module draws across its mounts —
 * are the ones the canvases draw and the package does not publish, and they are
 * worked out here, once, so that every surface reading them reads the same
 * figure. Where the package says `null` or `Infinity`, that meaning is carried
 * through as its own state rather than flattened into a number (constitution II
 * and IV).
 */
export interface PowerAndHeat {
  /** The hardpoint state every selected figure below was read under. */
  readonly hardpoints: HardpointState;
  readonly power: PowerView;
  /** `DRAW BY MODULE`, heaviest first, as canvases 1c and 1d list it. */
  readonly modules: readonly ModuleDrawRow[];
  /** `null` exactly when `heatMetricsResult().value` was. Never a zeroed profile. */
  readonly heat: HeatView | null;
  /** `null` exactly when `distributorMetricsResult().value` was. */
  readonly distributor: DistributorView | null;
}

/** Which of the package's two totals is being read. */
export type HardpointState = 'deployed' | 'retracted';

/**
 * Pips per bank: `0`–`4` each on the half step, six between the three.
 *
 * The package takes any fraction in range and asks for no total; the six are the
 * ship's rule, and the store that moves them is where it is kept.
 */
export interface DistributorPipAllocation {
  readonly systems: number;
  readonly engines: number;
  readonly weapons: number;
}

/** Everything the projection needs that is not the build. */
export interface PowerConditions {
  readonly hardpoints: HardpointState;
  readonly pips: DistributorPipAllocation;
}

export interface PowerView {
  /** What the plant generates. `0` with no powered plant, which is a real zero. */
  readonly available: number;
  /** The selected state's total draw. */
  readonly draw: number;
  /**
   * The priority groups the build actually uses, in the package's order.
   *
   * The package always returns five, because five is what the game has. A group
   * nothing is assigned to is not a reading of this build — it is an empty row
   * saying `0.00 MW` about a group that does not exist here — so the groups with
   * no consumer in them are left out.
   */
  readonly bands: readonly PowerBandView[];
  /**
   * The draw of every group the plant does not keep lit, in the selected state.
   *
   * The canvas's third summary tile, `UNPOWERED 7.80 MW`. The package states
   * each group's draw and whether it is lit; which of them are dark, and what
   * they add up to, is this projection's reading of that — and it is a real
   * zero when the plant covers everything.
   */
  readonly unpowered: number;
  /**
   * The draw the plant actually keeps lit, in the selected state.
   *
   * The canvas's second summary tile, `POWERED DRAW 29.64 MW`, beside a module
   * list whose own total is `37.44` — the same build, once with the dark groups
   * counted and once without. {@link draw} is the package's total; this is that
   * total less {@link unpowered}, and the two are drawn as the canvas draws
   * them rather than one standing in for the other.
   */
  readonly poweredDraw: number;
  /**
   * The rail's bar, as three shares of one track.
   *
   * Canvas 1c draws the status rail's `POWER` figures over a bar whose lengths
   * are the same four numbers again: `79%` amber, `21%` hatched after it, and a
   * mark at `83.3%`. Those come out of the artboard's own figures exactly —
   * `29.64 / 37.44`, `7.80 / 37.44` and `31.20 / 37.44` — so the track is the
   * whole demand and the mark is where the plant runs out.
   *
   * The track is scaled to whichever of the demand and the plant is larger, so
   * that a build the plant covers puts its mark at the end rather than off the
   * track. Where the demand is the larger — the artboard's build, and every
   * build with a dark group — that is the demand, and the three come out at the
   * artboard's own percentages.
   */
  readonly bar: PowerDrawBar;
  /**
   * The lit draw as a share of plant output, or `null` with no output to share.
   *
   * Canvas 1d's compact strip closes with `PWR 95%`, which is `29.64` of
   * `31.20 MW` — the plant, not the whole demand. It answers a different
   * question from {@link bar}: how much of the plant is already spoken for,
   * rather than how much of the demand it covers. Both are drawn, so both are
   * projected here rather than either being worked out at a screen.
   *
   * `null` where the plant generates nothing. A share of no output is not a
   * small percentage; it is a division with no answer, and a zero here would be
   * a figure standing in for one that does not exist (constitution IV).
   */
  readonly plantShare: number | null;
}

/** Three lengths on one track, each a share of it between `0` and `1`. */
export interface PowerDrawBar {
  /** The draw the plant keeps lit. */
  readonly powered: number;
  /** The draw it does not, running on from where the lit draw ends. */
  readonly unpowered: number;
  /** Where the plant's output falls on the same track. */
  readonly plant: number;
}

export interface PowerBandView {
  readonly priority: number;
  /** This group's own draw in the selected state. */
  readonly draw: number;
  /** This group's and every higher-priority group's, in the selected state. */
  readonly cumulativeDraw: number;
  /**
   * {@link cumulativeDraw} as a fraction of plant output, or `null` with no
   * output to be a fraction of.
   *
   * The canvas draws this as the third column of its priority groups, `60%`
   * against `18.72 MW`, and the bar each row is filled to. A plant of zero has
   * no share to state rather than an infinite one.
   */
  readonly cumulativeShare: number | null;
  /**
   * How far along the shared track this group's own length starts, in `[0, 1]`.
   *
   * The canvas draws each row as two lengths on one track: everything the
   * groups above this one draw, in a wash, and then this group's own draw in
   * the solid fill — so the row says both what it adds and what it adds to.
   * This is the first of the two, and it is the previous row's
   * {@link precedingShare} plus that row's {@link ownShare}.
   */
  readonly precedingShare: number;
  /**
   * What this group's own draw takes of the same track, in `[0, 1]`.
   *
   * Both lengths are shares of whichever of the whole demand and the plant's
   * output is larger — the same track {@link PowerDrawBar} is measured on, so
   * the plant's mark falls in the same place on every row.
   */
  readonly ownShare: number;
  /** Whether the plant keeps this group lit in the selected state. */
  readonly powered: boolean;
}

export interface ModuleDrawRow {
  /**
   * The row's identity: the symbol and group it stands for, or the package's
   * own slot key where there is no symbol to stand for anything.
   */
  readonly id: string;
  readonly symbol: string | null;
  /**
   * The package's own `label`, which is the fitted module's exact journal slot
   * key. `null` where the package supplied none, and `null` again where this
   * row stands for more than one mount and so for more than one key.
   */
  readonly slotKey: string | null;
  /** How many mounts this row stands for. The canvas writes any figure but `1`. */
  readonly count: number;
  /**
   * What those mounts draw together in the selected state, post-engineering.
   *
   * A real zero where the row is not drawing: a hardpoint's weapon with the
   * hardpoints stowed, or a module switched off. Both are still listed, because
   * a mount that vanishes from the list when a condition changes is the one
   * case where a reader cannot tell what happened to it — and both cases add up
   * to the state's own total rather than to a different build's.
   */
  readonly draw: number;
  /** The package's own `1`-`5`. */
  readonly priority: number;
  /** Whether the plant leaves this row's group dark in the selected state. */
  readonly offline: boolean;
  /** Whether every mount on this line is switched off in the outfitting panel. */
  readonly disabled: boolean;
  /**
   * {@link draw} against the heaviest row's, in `[0, 1]`.
   *
   * The length the canvas draws each bar to: its own list is filled to the
   * width of its heaviest entry, not to the plant's output. Decoration, and the
   * figure beside it is what is read.
   */
  readonly share: number;
}

/**
 * The track canvas 1c draws its heat bars on: the damage threshold sits at 62.5%
 * of it, which is a track running to 160% of the threshold.
 */
const CANVAS_HEAT_SCALE = 1.6;

/**
 * The four of the five `heatMetricsResult()` scenarios that canvas 1c draws, in
 * its order.
 *
 * The package's `firingDrained`, the alpha-strike case where every weapon makes
 * five times its thermal load, is not drawn, so it is not projected. The track
 * scale is set by the bars that are drawn, and a bar nobody sees never sets it.
 */
export const HEAT_SCENARIOS = ['idle', 'thrusters', 'fsdCharging', 'firingSustained'] as const;

export type HeatScenarioKey = (typeof HEAT_SCENARIOS)[number];

export interface HeatView {
  readonly efficiency: number;
  readonly hullHeatCapacity: number;
  readonly hullHeatDissipation: number;
  readonly scenarios: readonly HeatScenarioView[];
  /**
   * Where on the canvases' track the module-damage threshold falls, in `[0, 1]`.
   *
   * Canvas 1c draws it at 62.5%, which is a track running to 160% of the
   * threshold, and every bar it draws fits inside that. A build hotter than that
   * would run off the end, so the track grows to hold the hottest bar instead —
   * and at the canvas's own figures it is the canvas's own track.
   */
  readonly thresholdAt: number;
  /**
   * The bar after the four scenarios, `Shield cell bank`, or `null` with no bank fitted.
   *
   * `heatMetricsResult()` publishes five scenarios and says outright that this is not
   * one of them: a bank states its heat per *activation* rather than per second,
   * and the package's own remedy is to divide that by the bank's spin-up, add it
   * to the build's load and run it for the spin-up's duration. That is done here
   * — with the package's own {@link heatLevelAtTime} doing the running — because
   * this is the one place allowed to put two package figures together.
   */
  readonly shieldBankSpike: HeatSpikeView | null;
  /**
   * The heat sink launchers fitted, and what they carry.
   *
   * The canvases' fourth tile, `HEAT SINKS 6` over `2 x 3`. It comes from the
   * build rather than from `heatMetricsResult()`, which models no sink at all: a
   * sink removes heat, and every load the package accepts is non-negative.
   */
  readonly heatSinks: HeatSinkView;
}

/**
 * How long a heat bar runs, either side of the module-damage threshold.
 *
 * Both are fractions of the whole track, and both are decoration: the gauge
 * reading beside the bar is what is read. A level that never settles fills the
 * track to its end, because the package says it climbs without stopping and a
 * bar that stopped somewhere would be naming a level nobody named.
 */
export interface HeatBarLengths {
  /** How far it runs before the threshold, in `[0, 1]` of the track. */
  readonly within: number;
  /** How far past it, in `[0, 1]` of the track. `0` where it does not go past. */
  readonly over: number;
  /** Whether it goes past the threshold at all. */
  readonly overheats: boolean;
}

/** One momentary heat source the package declines to publish as a scenario. */
export interface HeatSpikeView extends HeatBarLengths {
  /** The load it adds while it runs, per second, on top of the build's own. */
  readonly thermalLoad: number;
  /** Where the gauge has got to when it finishes. */
  readonly gauge: HeatLevelValue;
  /** How long it runs, in seconds. */
  readonly seconds: number;
}

/** What the build carries to drop its own heat. */
export interface HeatSinkView {
  /** How many launchers are fitted. `0` is a real answer and the tile says it. */
  readonly launchers: number;
  /**
   * Charges one launcher carries fully rearmed, or `null` where the fitted
   * launchers do not all carry the same number — the canvas's `2 x 3` is one
   * multiplication, and two unlike launchers are not one.
   */
  readonly charges: number | null;
  /** Charges carried between them: the tile's own figure. */
  readonly total: number;
}

export interface HeatScenarioView extends HeatBarLengths {
  readonly key: HeatScenarioKey;
  readonly thermalLoad: number;
  readonly heatLevel: HeatLevelValue;
  readonly gauge: HeatLevelValue;
  readonly overheats: boolean;
  readonly timeToOverheat: OverheatTime;
}

/** The three capacitors, in the order the canvas's table draws them. */
export const CAPACITOR_KINDS = ['systems', 'engines', 'weapons'] as const;

export type CapacitorKind = (typeof CAPACITOR_KINDS)[number];

export interface DistributorView {
  readonly capacitors: readonly CapacitorView[];
}

export interface CapacitorView {
  readonly kind: CapacitorKind;
  readonly capacity: number;
  readonly ratedRecharge: number;
  /** The allocation the package used, taken from its result rather than the request. */
  readonly pips: number;
  readonly rechargeRate: number;
}

/**
 * A heat level or a cockpit gauge reading.
 *
 * `Infinity` means the load exceeds what the hull can shed, so heat settles
 * nowhere: the ship keeps climbing until it cooks. Distinct from a high number
 * and distinct from an absent profile.
 */
export type HeatLevelValue =
  { readonly kind: 'level'; readonly value: number } | { readonly kind: 'doesNotSettle' };

/**
 * Seconds until the gauge reads 100%.
 *
 * The package's `null` means the gauge never gets there under this scenario.
 * That is a fact about the build, not a missing value, and it never reads as
 * zero or as an unavailable figure.
 */
export type OverheatTime =
  { readonly kind: 'seconds'; readonly value: number } | { readonly kind: 'neverOverheats' };

/** `Infinity` becomes the non-settling statement; every finite level stays one. */
function heatLevelValue(level: number): HeatLevelValue {
  return Number.isFinite(level) ? { kind: 'level', value: level } : { kind: 'doesNotSettle' };
}

/** `null` becomes the never-overheats statement; every number stays one. */
function overheatTime(seconds: number | null): OverheatTime {
  return seconds === null ? { kind: 'neverOverheats' } : { kind: 'seconds', value: seconds };
}

/**
 * Reads one active loadout under one set of conditions.
 *
 * Each of the three package methods is called exactly once. `powerBudget()` in
 * particular is called once and read three ways — the bands, the module list
 * and the summary tiles all come out of that single result, so nothing on the
 * screen can disagree with anything else on it.
 */
export function projectPowerHeat(loadout: ShipLoadout, conditions: PowerConditions): PowerAndHeat {
  // Every calculation lives on `BuildMetrics`, which reads the build it is
  // handed rather than holding a copy of it (Almanac 0.2.0).
  const metrics = BuildMetrics.of(loadout);
  const budget = metrics.powerBudget();
  // Since Almanac 0.2.2 every metric that can be unavailable is a
  // `CalculationResult`, so the value is read off `.value`. This screen states
  // the absence and not its reasons, so `.issues` is left where it is.
  const heat = metrics.heatMetricsResult().value;
  // Read once and passed down. What it answers is about the build's own fitting
  // rather than about a package figure, and asking twice invites two answers.
  const fitted = loadout.fittedModules();
  const distributor = metrics.distributorMetricsResult({
    systemsPips: conditions.pips.systems,
    enginesPips: conditions.pips.engines,
    weaponsPips: conditions.pips.weapons,
  }).value;

  return Object.freeze({
    hardpoints: conditions.hardpoints,
    power: projectPower(budget, conditions.hardpoints),
    modules: projectModuleDraws(budget, conditions.hardpoints === 'deployed'),
    heat: heat === null ? null : projectHeat(heat, fitted),
    distributor: distributor === null ? null : projectDistributor(distributor),
  });
}

/** The plant summary and the groups this build uses, for one hardpoint state. */
function projectPower(budget: PowerBudget, hardpoints: HardpointState): PowerView {
  const deployed = hardpoints === 'deployed';
  const scale = powerTrackScale(budget, deployed);

  return {
    available: budget.available,
    draw: deployed ? budget.deployed : budget.retracted,
    bands: occupiedBands(budget).map((band) =>
      projectBand(band, deployed, budget.available, scale),
    ),
    poweredDraw: (deployed ? budget.deployed : budget.retracted) - unpoweredDraw(budget, deployed),
    unpowered: unpoweredDraw(budget, deployed),
    bar: drawBar(budget, deployed),
    plantShare: plantShare(budget, deployed),
  };
}

/**
 * The lit draw against the plant's own output — canvas 1d's `PWR 95%`.
 *
 * Done here rather than at the badge, because every division of two package
 * figures in this application is done in this one file: a percentage worked out
 * at a screen is a reading nobody can find again (005/FR-001, FR-002).
 */
function plantShare(budget: PowerBudget, deployed: boolean): number | null {
  if (budget.available <= 0) {
    return null;
  }
  const draw = deployed ? budget.deployed : budget.retracted;
  return (draw - unpoweredDraw(budget, deployed)) / budget.available;
}

/**
 * The track every bar drawn from this budget is measured on.
 *
 * Whichever of the whole demand and the plant's output is larger, so a build
 * the plant covers puts the plant's mark at the end of the track rather than
 * off it, and a build it does not covers the track and marks where it ran out.
 * The rail's bar and each priority group's row share it, which is what lets one
 * mark stand for the plant on all of them.
 */
function powerTrackScale(budget: PowerBudget, deployed: boolean): number {
  return Math.max(deployed ? budget.deployed : budget.retracted, budget.available);
}

/** The rail's three lengths, over whichever of demand and output is larger. */
function drawBar(budget: PowerBudget, deployed: boolean): PowerDrawBar {
  const draw = deployed ? budget.deployed : budget.retracted;
  const unpowered = unpoweredDraw(budget, deployed);
  const scale = powerTrackScale(budget, deployed);

  // A ship with no plant and nothing fitted draws an empty track rather than a
  // division by nothing.
  return scale === 0
    ? { powered: 0, unpowered: 0, plant: 0 }
    : {
        powered: (draw - unpowered) / scale,
        unpowered: unpowered / scale,
        plant: budget.available / scale,
      };
}

/**
 * The groups this build puts something in, in the package's order.
 *
 * Membership is the consumer's own group, whether or not it is switched on and
 * whether or not its hardpoints are out: a group holding one weapon exists with
 * the hardpoints stowed, and a row appearing and disappearing as a condition
 * changes would be a worse answer than a row reading zero.
 */
function occupiedBands(budget: PowerBudget): readonly PowerBand[] {
  const used = new Set(budget.consumers.map((consumer) => consumer.priority));
  return budget.bands.filter((band) => used.has(band.priority));
}

/** What the groups the plant does not keep lit draw between them. */
function unpoweredDraw(budget: PowerBudget, deployed: boolean): number {
  return budget.bands.reduce(
    (total, band) =>
      (deployed ? band.poweredDeployed : band.poweredRetracted)
        ? total
        : total + (deployed ? band.deployed : band.retracted),
    0,
  );
}

function projectBand(
  band: PowerBand,
  deployed: boolean,
  available: number,
  scale: number,
): PowerBandView {
  const cumulativeDraw = deployed ? band.deployedTotal : band.retractedTotal;
  const draw = deployed ? band.deployed : band.retracted;

  return {
    priority: band.priority,
    draw,
    cumulativeDraw,
    cumulativeShare: available > 0 ? cumulativeDraw / available : null,
    // A ship with no plant and nothing fitted draws an empty track rather than
    // a division by nothing, exactly as the rail's own bar does.
    precedingShare: scale > 0 ? (cumulativeDraw - draw) / scale : 0,
    ownShare: scale > 0 ? draw / scale : 0,
    powered: deployed ? band.poweredDeployed : band.poweredRetracted,
  };
}

/**
 * `DRAW BY MODULE`, heaviest first, as canvases 1c and 1d list it.
 *
 * The canvas writes one line per *kind* of consumer rather than per mount:
 * three multi-cannons in three mounts are `Multi-Cannons x3` on one line, at
 * what the three of them draw together. Mounts of the same module in different
 * priority groups stay apart, because the group is part of what the line says.
 * A consumer the package gave no symbol cannot be told apart from another, so
 * each keeps its own line.
 *
 * Nothing is dropped, and every line states what it draws *now*. A module
 * switched off in the outfitting panel and a weapon whose hardpoints are stowed
 * both draw nothing in the state being read, so both are listed at zero and
 * marked — the package leaves both out of that state's total, and a line
 * carrying a draw the total does not contain would be a third figure nobody
 * asked for. The list is the package's participants, which is only the
 * consumers it was given: a passive fitting is absent rather than present at
 * zero.
 */
function projectModuleDraws(budget: PowerBudget, deployed: boolean): readonly ModuleDrawRow[] {
  const dark = new Set(
    budget.bands
      .filter((band) => !(deployed ? band.poweredDeployed : band.poweredRetracted))
      .map((band) => band.priority),
  );

  const rows = new Map<string, { row: ModuleDrawRow; ordinal: number }>();
  budget.consumers.forEach((consumer, ordinal) => {
    // A consumer with no symbol is aggregated with nothing, so its key is its
    // own position: two unnamed rows are two rows. Switched-off mounts keep
    // their own line as well, because the line says which of the two states its
    // mounts are in and one line cannot say both.
    const key =
      consumer.symbol === undefined
        ? `ordinal:${ordinal}`
        : `symbol:${consumer.symbol}:${consumer.priority}:${String(consumer.enabled)}`;
    const seen = rows.get(key);
    const draw = drawNow(consumer, deployed);

    if (seen === undefined) {
      rows.set(key, {
        ordinal,
        row: {
          id: key,
          symbol: consumer.symbol ?? null,
          slotKey: consumer.label ?? null,
          count: 1,
          draw,
          priority: consumer.priority,
          offline: dark.has(consumer.priority),
          disabled: !consumer.enabled,
          share: 0,
        },
      });
      return;
    }

    rows.set(key, {
      ordinal: seen.ordinal,
      row: {
        ...seen.row,
        // The line no longer names one mount, so it names none: a key that
        // opened the first of three would be the wrong answer for the other two.
        slotKey: null,
        count: seen.row.count + 1,
        draw: seen.row.draw + draw,
      },
    });
  });

  const listed = [...rows.values()].sort((left, right) => {
    // Compared rather than subtracted: a difference between two draws is a
    // figure nobody publishes, and this list states none of its own.
    if (left.row.draw !== right.row.draw) {
      return left.row.draw < right.row.draw ? 1 : -1;
    }
    return left.ordinal < right.ordinal ? -1 : 1;
  });

  const heaviest = listed[0]?.row.draw ?? 0;
  return listed.map(({ row }) => ({
    ...row,
    share: heaviest > 0 ? row.draw / heaviest : 0,
  }));
}

/**
 * What one consumer draws in the state being read.
 *
 * The package's two totals already work this way: a weapon counts towards
 * `deployed` and not towards `retracted`, and a module switched off counts
 * towards neither. This says the same thing one line at a time.
 */
function drawNow(consumer: PowerConsumerResult, deployed: boolean): number {
  return !consumer.enabled || (consumer.deployedOnly && !deployed) ? 0 : consumer.draw;
}

/** The three profile facts, the four drawn scenarios, the spike and the sinks. */
function projectHeat(heat: HeatMetrics, fitted: readonly FittedModule[]): HeatView {
  const spike = shieldBankSpike(heat, fitted);
  const gauges = [
    ...HEAT_SCENARIOS.map((key) => gaugeOf(heat[key].gauge)),
    ...(spike === null ? [] : [gaugeOf(spike.level / OVERHEAT_HEAT_LEVEL)]),
  ];
  const scale = trackScale(gauges);

  return {
    efficiency: heat.heatEfficiency,
    hullHeatCapacity: heat.hullHeatCapacity,
    hullHeatDissipation: heat.hullHeatDissipation,
    scenarios: HEAT_SCENARIOS.map((key) => projectScenario(key, heat[key], scale)),
    thresholdAt: 1 / scale,
    shieldBankSpike:
      spike === null
        ? null
        : {
            thermalLoad: spike.thermalLoad,
            gauge: heatLevelValue(spike.level / OVERHEAT_HEAT_LEVEL),
            seconds: spike.seconds,
            ...barLengths(gaugeOf(spike.level / OVERHEAT_HEAT_LEVEL), scale),
          },
    heatSinks: projectHeatSinks(fitted),
  };
}

/**
 * The track canvas 1c draws its heat bars on, in gauge units.
 *
 * Its own is 1.6 — the damage threshold at 62.5% of the track — and that holds
 * unless a bar is hotter than the track is long, in which case the track is as
 * long as that bar. A level that never settles is not a length and does not
 * stretch anything.
 */
function trackScale(gauges: readonly number[]): number {
  return Math.max(CANVAS_HEAT_SCALE, ...gauges.filter((gauge) => Number.isFinite(gauge)));
}

/** `Infinity` for the level the package says never settles, the value otherwise. */
function gaugeOf(gauge: number): number {
  return Number.isFinite(gauge) ? gauge : Infinity;
}

/** One bar's two lengths against a track of `scale` gauge units. */
function barLengths(gauge: number, scale: number): HeatBarLengths {
  return {
    within: Math.min(gauge, 1) / scale,
    over: Number.isFinite(gauge) ? Math.max(0, Math.min(gauge, scale) - 1) / scale : 1 - 1 / scale,
    overheats: gauge > 1,
  };
}

/**
 * The hottest fitted bank's spike, by the package's own recipe.
 *
 * The bank's heat per activation over its spin-up is the load it adds; that load
 * is added to what the build already makes sitting still, and held for the
 * spin-up. The idle load is the base because the bank's own heat is what this
 * bar is about: measuring it from a build that is also flat out and firing would
 * be drawing two things at once and calling it one.
 *
 * `null` with no bank fitted, and `null` again where a bank states no heat or no
 * spin-up — a spike nobody published is not a spike of zero.
 */
function shieldBankSpike(
  heat: HeatMetrics,
  fitted: readonly FittedModule[],
): { thermalLoad: number; level: number; seconds: number } | null {
  let hottest: { load: number; seconds: number } | null = null;

  for (const module of fitted) {
    const spike = module.effectiveStats?.shieldBankHeat;
    const seconds = module.effectiveStats?.shieldBankSpinUp;
    if (spike === undefined || seconds === undefined || seconds <= 0) {
      continue;
    }

    const load = spike / seconds;
    if (hottest === null || load > hottest.load) {
      hottest = { load, seconds };
    }
  }

  if (hottest === null) {
    return null;
  }

  const thermalLoad = heat.idle.thermalLoad + hottest.load;

  return {
    thermalLoad,
    level: heatLevelAtTime({
      heatCapacity: heat.hullHeatCapacity,
      heatDissipation: heat.hullHeatDissipation,
      thermalLoad,
      startLevel: heat.idle.heatLevel,
      seconds: hottest.seconds,
    }),
    seconds: hottest.seconds,
  };
}

/** Every fitted heat sink launcher, and the charges they carry between them. */
function projectHeatSinks(fitted: readonly FittedModule[]): HeatSinkView {
  // Matched on the symbol because the symbol is the module's identity: the
  // package publishes no "this is a heat sink launcher" flag, and a launcher
  // recognised by its stats would also recognise anything that happened to
  // share them.
  const launchers = fitted.filter((module) => /heatsinklauncher/iu.test(module.symbol));
  const charges = launchers.map((module) => module.ammunition?.total ?? 0);
  const first = charges[0];

  return {
    launchers: launchers.length,
    charges: first !== undefined && charges.every((count) => count === first) ? first : null,
    total: charges.reduce((sum, count) => sum + count, 0),
  };
}

function projectScenario(key: HeatScenarioKey, state: HeatState, scale: number): HeatScenarioView {
  return {
    key,
    thermalLoad: state.thermalLoad,
    heatLevel: heatLevelValue(state.heatLevel),
    gauge: heatLevelValue(state.gauge),
    timeToOverheat: overheatTime(state.secondsToOverheat),
    ...barLengths(gaugeOf(state.gauge), scale),
    // The package's own verdict, kept over the one the lengths imply: it is the
    // answer to whether this scenario overheats, and a bar is a drawing.
    overheats: state.overheats,
  };
}

/**
 * SYS, ENG and WEP, in the order the canvas's table draws them.
 *
 * The pips shown are the ones the result carries, not the ones that were asked
 * for. They are the same today; reading them back is what keeps the screen
 * honest if the package ever normalises an allocation (FR-007).
 */
function projectDistributor(metrics: DistributorMetrics): DistributorView {
  return {
    capacitors: CAPACITOR_KINDS.map((kind) => ({
      kind,
      capacity: metrics[kind].capacity,
      ratedRecharge: metrics[kind].ratedRecharge,
      pips: metrics.pips[kind],
      rechargeRate: metrics[kind].rechargeRate,
    })),
  };
}
