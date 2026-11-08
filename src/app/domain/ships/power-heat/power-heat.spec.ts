import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  CAPACITOR_KINDS,
  HEAT_SCENARIOS,
  projectPowerHeat,
  type DistributorPipAllocation,
  type HardpointState,
  type PowerAndHeat,
  type PowerConditions,
} from './power-heat';
import {
  distributorOffBuild,
  divergentBandBuild,
  noPlantOutputBuild,
  overheatingBankBuild,
  overheatingBuild,
  shedBandBuild,
  sustainedOverheatBuild,
  unarmedBuild,
  withinBudgetBuild,
} from './power-heat.fixtures';

const BALANCED: DistributorPipAllocation = { systems: 2, engines: 2, weapons: 2 };

function conditions(
  hardpoints: HardpointState = 'deployed',
  pips: DistributorPipAllocation = BALANCED,
): PowerConditions {
  return { hardpoints, pips };
}

function project(build: ShipLoadout, ...args: Parameters<typeof conditions>): PowerAndHeat {
  return projectPowerHeat(build, conditions(...args));
}

describe('projectPowerHeat', () => {
  // The calculations moved onto `BuildMetrics` in Almanac 0.2.0, so the seam
  // is its prototype rather than one build. A prototype stays mocked for
  // every later test in this file unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the plant summary', () => {
    it("reads the plant and each state's own total", () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();

      expect(project(build).power.available).toBe(budget.available);
      expect(project(build).power.draw).toBe(budget.deployed);
      expect(project(build, 'retracted').power.draw).toBe(budget.retracted);
    });

    it('states no headroom, utilisation or within-budget verdict at all', () => {
      // Three package fields neither canvas draws. They are not blanked, dashed
      // or zeroed here — they are not read, so nothing downstream can print one.
      const power = project(withinBudgetBuild()).power;

      expect(Object.keys(power).sort()).toEqual([
        'available',
        'bands',
        'bar',
        'draw',
        'plantShare',
        'poweredDraw',
        'unpowered',
      ]);
    });

    it('states zero plant output as a real zero beside a positive draw', () => {
      // The package reports an infinite utilisation for this build. Nothing here
      // reads that field, so there is no infinity to word, clamp or glyph: what
      // the screen gets is a plant of nothing and the whole demand unpowered.
      const power = project(noPlantOutputBuild()).power;

      expect(power.available).toBe(0);
      expect(power.draw).toBeGreaterThan(0);
      expect(power.poweredDraw).toBe(0);
      expect(power.unpowered).toBeCloseTo(power.draw, 10);

      // And no share of it. A plant of nothing has no output to take a share
      // of, so the badge that draws one has nothing to draw rather than a zero
      // percentage standing in for a division with no answer (FR-014).
      expect(power.plantShare).toBeNull();
    });

    it('states the lit draw as a share of plant output, not of the demand', () => {
      // The two are different questions and the canvas asks both: `PWR 95%` on
      // canvas 1d's badge is the lit draw over the plant, while the rail's bar
      // measures the same draw against the whole demand (FR-014). A build the
      // plant covers cannot tell them apart — the bar's track is the plant
      // there — so the one with a shed band is what separates them.
      const power = project(shedBandBuild()).power;

      expect(power.unpowered).toBeGreaterThan(0);
      expect(power.plantShare).toBeCloseTo(power.poweredDraw / power.available, 10);
      expect(power.bar.powered).toBeLessThan(power.plantShare ?? 0);
    });
  });

  describe('the priority bands', () => {
    it('returns the groups the build uses, in package order, in either state', () => {
      const build = withinBudgetBuild();
      const used = [
        ...new Set(
          BuildMetrics.of(build)
            .powerBudget()
            .consumers.map((consumer) => consumer.priority),
        ),
      ].sort((left, right) => left - right);

      for (const state of ['deployed', 'retracted'] as const) {
        const bands = project(build, state).power.bands;
        expect(bands.map((band) => band.priority)).toEqual(used);
      }
    });

    it('leaves out a group this build puts nothing in', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const used = new Set(budget.consumers.map((consumer) => consumer.priority));
      const bands = project(build).power.bands;

      // The game has five groups and the package returns five. An empty one is
      // not a reading of this build, and a row saying `0.00 MW` about a group
      // nothing is assigned to is a row about nothing.
      expect(budget.bands.length).toBeGreaterThan(bands.length);
      expect(bands.every((band) => used.has(band.priority))).toBe(true);
    });

    it('keeps a group whose mounts are all stowed or switched off', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const retracted = project(build, 'retracted').power.bands;

      // Membership is where a mount sits, not what it happens to be drawing:
      // a group that vanished when the hardpoints went in would be a group a
      // reader could not find again.
      expect(retracted.map((band) => band.priority)).toEqual(
        project(build, 'deployed').power.bands.map((band) => band.priority),
      );
      expect(budget.bands.length).toBeGreaterThanOrEqual(retracted.length);
    });

    it('takes each band’s own draw, cumulative draw and verdict from the selected state', () => {
      const build = divergentBandBuild();
      const used = new Set(
        BuildMetrics.of(build)
          .powerBudget()
          .consumers.map((consumer) => consumer.priority),
      );
      const packageBands = BuildMetrics.of(build)
        .powerBudget()
        .bands.filter((band) => used.has(band.priority));

      const deployed = project(build, 'deployed').power.bands;
      const retracted = project(build, 'retracted').power.bands;

      expect(packageBands.length).toBeGreaterThan(0);
      const budget = BuildMetrics.of(build).powerBudget();
      const available = budget.available;
      // The track both states' rows are measured on: whichever of that state's
      // whole demand and the plant's output is larger, which is the same track
      // the rail's own bar uses.
      const deployedScale = Math.max(budget.deployed, available);
      const retractedScale = Math.max(budget.retracted, available);

      packageBands.forEach((band, index) => {
        expect(deployed[index]).toEqual({
          priority: band.priority,
          draw: band.deployed,
          cumulativeDraw: band.deployedTotal,
          cumulativeShare: band.deployedTotal / available,
          precedingShare: (band.deployedTotal - band.deployed) / deployedScale,
          ownShare: band.deployed / deployedScale,
          powered: band.poweredDeployed,
        });
        expect(retracted[index]).toEqual({
          priority: band.priority,
          draw: band.retracted,
          cumulativeDraw: band.retractedTotal,
          cumulativeShare: band.retractedTotal / available,
          precedingShare: (band.retractedTotal - band.retracted) / retractedScale,
          ownShare: band.retracted / retractedScale,
          powered: band.poweredRetracted,
        });
      });
    });

    it('draws the groups additively: each row starts where the one above it ended', () => {
      const build = divergentBandBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const bands = project(build, 'deployed').power.bands;
      const scale = Math.max(budget.deployed, budget.available);

      expect(bands.length).toBeGreaterThan(1);
      expect(bands[0].precedingShare).toBe(0);

      bands.forEach((band, index) => {
        const above = bands[index - 1];
        if (above) {
          expect(band.precedingShare).toBeCloseTo(above.precedingShare + above.ownShare, 12);
        }
      });

      // The last row ends where the whole demand does, on the same track the
      // rail's bar marks the plant's output on.
      const last = bands[bands.length - 1];
      expect(last.precedingShare + last.ownShare).toBeCloseTo(budget.deployed / scale, 12);
      expect(project(build, 'deployed').power.bar.plant).toBeCloseTo(budget.available / scale, 12);
    });

    it('reports a shed band as unpowered in both states when the package does', () => {
      for (const state of ['deployed', 'retracted'] as const) {
        const bands = project(shedBandBuild(), state).power.bands;
        expect(bands.at(-1)?.powered).toBe(false);
      }
    });

    it("reads each state's own verdict on a band whose two disagree", () => {
      const build = divergentBandBuild();
      const band = BuildMetrics.of(build).powerBudget().bands.at(-1);

      expect(band?.poweredDeployed).toBe(false);
      expect(band?.poweredRetracted).toBe(true);
      for (const state of ['deployed', 'retracted'] as const) {
        const view = project(build, state).power.bands.find(
          (row) => row.priority === band?.priority,
        );
        expect(view?.powered).toBe(state === 'retracted');
      }
    });

    it('splits the draw into what the plant keeps lit and what it does not', () => {
      const build = shedBandBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const shed = budget.bands
        .filter((band) => !band.poweredDeployed)
        .reduce((total, band) => total + band.deployed, 0);
      const power = project(build, 'deployed').power;

      expect(shed).toBeGreaterThan(0);
      expect(power.unpowered).toBeCloseTo(shed, 10);
      expect(power.poweredDraw).toBeCloseTo(budget.deployed - shed, 10);
      expect(power.poweredDraw + power.unpowered).toBeCloseTo(power.draw, 10);
    });

    it('scales the rail bar to the demand where the plant cannot cover it', () => {
      const build = shedBandBuild();
      const budget = BuildMetrics.of(build).powerBudget();
      const bar = project(build, 'deployed').power.bar;

      // The artboard's `79%` amber, `21%` hatched after it and its mark at
      // `83.3%`, over the whole demand — which is what its own figures divide
      // out to.
      expect(bar.powered + bar.unpowered).toBeCloseTo(1, 10);
      expect(bar.plant).toBeCloseTo(budget.available / budget.deployed, 10);
      expect(bar.plant).toBeLessThan(1);
    });

    it('scales it to the plant where the plant is the larger', () => {
      const bar = project(withinBudgetBuild(), 'deployed').power.bar;

      // The mark reaches the end of the track rather than running off it, and
      // nothing is hatched because nothing is dark.
      expect(bar.plant).toBeCloseTo(1, 10);
      expect(bar.unpowered).toBe(0);
      expect(bar.powered).toBeLessThanOrEqual(1);
    });
  });

  describe('the module list', () => {
    it('lists one line per kind of consumer, heaviest draw first', () => {
      const rows = project(withinBudgetBuild()).modules;
      const draws = rows.map((row) => row.draw);

      expect(rows.length).toBeGreaterThan(0);
      expect(draws).toEqual([...draws].sort((left, right) => right - left));
    });

    it('gathers the mounts carrying one module in one group onto a single line', () => {
      const build = withinBudgetBuild();
      const mounted = BuildMetrics.of(build)
        .powerBudget()
        .consumers.filter((consumer) => consumer.symbol === 'Hpt_PulseLaser_Fixed_Small');
      const lasers = project(build).modules.filter(
        (row) => row.symbol === 'Hpt_PulseLaser_Fixed_Small',
      );

      expect(mounted.length).toBeGreaterThan(1);
      expect(lasers).toHaveLength(1);
      expect(lasers[0]?.count).toBe(mounted.length);
      expect(lasers[0]?.draw).toBeCloseTo(
        mounted.reduce((total, consumer) => total + consumer.draw, 0),
        10,
      );
    });

    it('names no single mount on a line that stands for several', () => {
      const rows = project(withinBudgetBuild()).modules;
      const gathered = rows.filter((row) => row.count > 1);

      expect(gathered.length).toBeGreaterThan(0);
      for (const row of gathered) {
        expect(row.slotKey).toBeNull();
      }
    });

    it('adds up to the package’s own total for the state it was read in', () => {
      const build = withinBudgetBuild();
      const budget = BuildMetrics.of(build).powerBudget();

      // Each line states what it draws in the state being read, so the list
      // comes to that state's own total — the weapons count towards one of them
      // and not the other, exactly as the package counts them.
      for (const [state, total] of [
        ['deployed', budget.deployed],
        ['retracted', budget.retracted],
      ] as const) {
        const listed = project(build, state).modules.reduce((sum, row) => sum + row.draw, 0);
        expect(listed).toBeCloseTo(total, 10);
      }
    });

    it('keeps a switched-off module on the list, at the nothing it draws', () => {
      const row = project(distributorOffBuild()).modules.find(
        (entry) => entry.slotKey === 'PowerDistributor',
      );

      // Listed rather than dropped, because a mount that disappears when it is
      // switched off is a mount a reader cannot find to switch back on; and at
      // zero, because zero is what the package counts it as.
      expect(row).toBeDefined();
      expect(row?.disabled).toBe(true);
      expect(row?.draw).toBe(0);
    });

    it('lists a stowed hardpoint at zero rather than at what it would draw', () => {
      const build = withinBudgetBuild();
      const deployed = project(build, 'deployed').modules;
      const retracted = project(build, 'retracted').modules;
      const stowed = retracted.filter((row) => row.draw === 0);

      // The same lines in both states, and the weapons among them reading zero
      // with the hardpoints in: the package counts them the same way.
      expect(retracted).toHaveLength(deployed.length);
      expect(stowed.length).toBeGreaterThan(0);
      expect(stowed.every((row) => row.share === 0)).toBe(true);
    });

    it('draws every bar against the heaviest line rather than against the plant', () => {
      const rows = project(withinBudgetBuild()).modules;
      const heaviest = rows[0];

      expect(heaviest?.share).toBe(1);
      for (const row of rows) {
        expect(row.share).toBeCloseTo(row.draw / (heaviest?.draw ?? 1), 10);
      }
    });

    it('marks the lines the plant leaves dark, and only those', () => {
      const build = shedBandBuild();
      const dark = new Set(
        BuildMetrics.of(build)
          .powerBudget()
          .bands.filter((band) => !band.poweredDeployed)
          .map((band) => band.priority),
      );

      expect(dark.size).toBeGreaterThan(0);
      for (const row of project(build).modules) {
        expect(row.offline).toBe(dark.has(row.priority));
      }
    });

    it('re-reads which lines are dark when the hardpoints change state', () => {
      const build = divergentBandBuild();
      const deployed = project(build).modules.map((row) => row.offline);
      const retracted = project(build, 'retracted').modules.map((row) => row.offline);

      expect(deployed).not.toEqual(retracted);
    });
  });

  describe('the distributor', () => {
    it('returns the three capacitors in SYS, ENG, WEP order with every field', () => {
      const build = withinBudgetBuild();
      const metrics = BuildMetrics.of(build).distributorMetricsResult({
        systemsPips: 2,
        enginesPips: 2,
        weaponsPips: 2,
      }).value;
      const capacitors = project(build).distributor?.capacitors ?? [];

      expect(capacitors.map((bank) => bank.kind)).toEqual([...CAPACITOR_KINDS]);
      capacitors.forEach((bank) => {
        expect(bank.capacity).toBe(metrics?.[bank.kind].capacity);
        expect(bank.ratedRecharge).toBe(metrics?.[bank.kind].ratedRecharge);
        expect(bank.rechargeRate).toBe(metrics?.[bank.kind].rechargeRate);
        expect(bank.pips).toBe(metrics?.pips[bank.kind]);
      });
    });

    it('passes each whole allocation through and displays the returned one', () => {
      const allocation = { systems: 3, engines: 1, weapons: 2 };
      const capacitors =
        project(withinBudgetBuild(), 'deployed', allocation).distributor?.capacitors ?? [];

      expect(capacitors.map((bank) => bank.pips)).toEqual([3, 1, 2]);
    });

    it('reports zero pips as a genuine zero recharge beside a real capacity', () => {
      const zeroed = { systems: 0, engines: 4, weapons: 4 };
      const systems = project(withinBudgetBuild(), 'deployed', zeroed).distributor?.capacitors[0];

      expect(systems?.rechargeRate).toBe(0);
      expect(systems?.capacity).toBeGreaterThan(0);
    });

    it('moves recharge and nothing else when the allocation changes', () => {
      const build = withinBudgetBuild();
      const four = project(build, 'deployed', { systems: 4, engines: 2, weapons: 2 });
      const none = project(build, 'deployed', { systems: 0, engines: 2, weapons: 2 });

      expect(none.distributor?.capacitors[0].capacity).toBe(
        four.distributor?.capacitors[0].capacity,
      );
      expect(none.distributor?.capacitors[0].ratedRecharge).toBe(
        four.distributor?.capacitors[0].ratedRecharge,
      );
      expect(none.distributor?.capacitors[0].rechargeRate).not.toBe(
        four.distributor?.capacitors[0].rechargeRate,
      );
      expect(none.heat).toEqual(four.heat);
      expect(none.power).toEqual(four.power);
    });

    it('stays unavailable, with no capacitor figures, when the package returns null', () => {
      const power = project(distributorOffBuild());

      expect(power.distributor).toBeNull();
      // And nothing else goes with it.
      expect(power.heat).not.toBeNull();
      expect(power.power.bands.length).toBeGreaterThan(0);
    });
  });

  describe('the heat profile', () => {
    it('returns the three profile facts and the four drawn scenarios in order', () => {
      const build = withinBudgetBuild();
      const heat = BuildMetrics.of(build).heatMetricsResult().value;
      const view = project(build).heat;

      expect(view?.efficiency).toBe(heat?.heatEfficiency);
      expect(view?.hullHeatCapacity).toBe(heat?.hullHeatCapacity);
      expect(view?.hullHeatDissipation).toBe(heat?.hullHeatDissipation);
      expect(view?.scenarios.map((scenario) => scenario.key)).toEqual([
        'idle',
        'thrusters',
        'fsdCharging',
        'firingSustained',
      ]);
      expect([...HEAT_SCENARIOS]).not.toContain('firingDrained');
    });

    it('states the shield cell bank spike beside the four scenarios, not as one of them', () => {
      const view = project(overheatingBankBuild()).heat;

      // The spike is its own field, so the four scenarios stay four and the
      // panel draws the bank's bar after them.
      expect(view?.scenarios.map((scenario) => scenario.key)).toEqual([...HEAT_SCENARIOS]);
      expect(view?.shieldBankSpike).not.toBeNull();
      expect(view?.shieldBankSpike?.overheats).toBe(true);
    });

    it('reads every field of every scenario from the package', () => {
      const build = withinBudgetBuild();
      const heat = BuildMetrics.of(build).heatMetricsResult().value;

      for (const scenario of project(build).heat?.scenarios ?? []) {
        const state = heat?.[scenario.key];
        expect(scenario.thermalLoad).toBe(state?.thermalLoad);
        expect(scenario.heatLevel).toEqual({ kind: 'level', value: state?.heatLevel });
        expect(scenario.gauge).toEqual({ kind: 'level', value: state?.gauge });
        expect(scenario.overheats).toBe(state?.overheats);
        expect(scenario.timeToOverheat).toEqual({ kind: 'neverOverheats' });
      }
    });

    it('states a non-settling scenario as such on its level and its gauge alone', () => {
      const sustained = project(sustainedOverheatBuild()).heat?.scenarios[3];

      expect(sustained?.key).toBe('firingSustained');
      expect(sustained?.heatLevel).toEqual({ kind: 'doesNotSettle' });
      expect(sustained?.gauge).toEqual({ kind: 'doesNotSettle' });
      expect(sustained?.overheats).toBe(true);
      expect(sustained?.timeToOverheat.kind).toBe('seconds');
    });

    it('leaves the settling scenarios of the same build finite', () => {
      const sustained = project(overheatingBuild()).heat?.scenarios[3];

      expect(sustained?.key).toBe('firingSustained');
      expect(sustained?.heatLevel.kind).toBe('level');
      expect(sustained?.timeToOverheat).toEqual({ kind: 'neverOverheats' });
    });

    it('draws every bar on the canvas’s own track until a build outgrows it', () => {
      const view = project(withinBudgetBuild()).heat;

      // 62.5% of the track, which is the canvas's own threshold position.
      expect(view?.thresholdAt).toBeCloseTo(0.625, 10);
      for (const scenario of view?.scenarios ?? []) {
        if (scenario.gauge.kind !== 'level') {
          continue;
        }
        expect(scenario.within).toBeCloseTo(Math.min(scenario.gauge.value, 1) / 1.6, 10);
        expect(scenario.over).toBeCloseTo(Math.max(0, scenario.gauge.value - 1) / 1.6, 10);
        expect(scenario.overheats).toBe(scenario.gauge.value > 1);
      }
    });

    it('runs a bar that never settles to the end of the track', () => {
      const view = project(sustainedOverheatBuild()).heat;
      const sustained = view?.scenarios[3];

      expect(sustained?.gauge.kind).toBe('doesNotSettle');
      expect((sustained?.within ?? 0) + (sustained?.over ?? 0)).toBeCloseTo(1, 10);
    });

    it('sets the track by the four drawn scenarios, never by the drained capacitor', () => {
      // The package answer for a real build, with the drained-capacitor
      // scenario given the largest load of all and sustained fire the largest
      // of the four drawn ones. Both are past the canvas's own track, so the
      // track has to grow, and only a drawn bar may grow it.
      const build = withinBudgetBuild();
      const real = BuildMetrics.of(build).heatMetricsResult();
      const package_ = real.value;
      expect(package_).not.toBeNull();
      if (package_ === null) {
        return;
      }
      const heat = {
        ...package_,
        firingSustained: { ...package_.firingSustained, gauge: 2, overheats: true },
        firingDrained: {
          ...package_.firingDrained,
          thermalLoad: package_.firingSustained.thermalLoad * 10,
          heatLevel: 3,
          gauge: 3,
          overheats: true,
        },
      };
      vi.spyOn(BuildMetrics.prototype, 'heatMetricsResult').mockReturnValue({
        ...real,
        value: heat,
      });

      const view = project(build).heat;
      const largest = Math.max(
        ...(view?.scenarios ?? []).map((scenario) =>
          scenario.gauge.kind === 'level' ? scenario.gauge.value : 0,
        ),
      );

      // A build with no bank, so nothing but the four scenarios can set it.
      expect(view?.shieldBankSpike).toBeNull();
      expect(largest).toBe(2);
      expect(view?.thresholdAt).toBeCloseTo(1 / largest, 10);
    });

    it('keeps the sustained-fire scenario on a build with no weapons, as the package states it', () => {
      const build = unarmedBuild();
      expect(BuildMetrics.of(build).weaponMetrics().weapons).toEqual([]);
      const state = BuildMetrics.of(build).heatMetricsResult().value?.firingSustained;
      const view = project(build).heat;
      const sustained = view?.scenarios.find((scenario) => scenario.key === 'firingSustained');

      // The package still returns the scenario, and the projection carries it
      // as returned: no absent state stands in for a build that cannot fire.
      expect(view).not.toBeNull();
      expect(state).toBeDefined();
      expect(sustained?.thermalLoad).toBe(state?.thermalLoad);
      expect(sustained?.heatLevel).toEqual({ kind: 'level', value: state?.heatLevel });
      expect(sustained?.gauge).toEqual({ kind: 'level', value: state?.gauge });
      expect(sustained?.overheats).toBe(state?.overheats);
    });

    it('states the cell bank spike the package declines to publish as a scenario', () => {
      const build = withinBudgetBuild();
      const view = project(build).heat;
      const spike = view?.shieldBankSpike;
      const bank = build
        .fittedModules()
        .find((module) => (module.effectiveStats?.shieldBankHeat ?? 0) > 0);

      if (bank === undefined) {
        // A fixture with no bank fitted has no spike, and says so.
        expect(spike).toBeNull();
        return;
      }

      const perSecond =
        (bank.effectiveStats?.shieldBankHeat ?? 0) / (bank.effectiveStats?.shieldBankSpinUp ?? 1);
      expect(spike?.seconds).toBe(bank.effectiveStats?.shieldBankSpinUp);
      expect(spike?.thermalLoad).toBeCloseTo(
        (BuildMetrics.of(build).heatMetricsResult().value?.idle.thermalLoad ?? 0) + perSecond,
        10,
      );
    });

    it('counts the heat sink launchers fitted and what they carry', () => {
      const build = withinBudgetBuild();
      const launchers = build
        .fittedModules()
        .filter((module) => /heatsinklauncher/iu.test(module.symbol));
      const sinks = project(build).heat?.heatSinks;

      expect(sinks?.launchers).toBe(launchers.length);
      expect(sinks?.total).toBe(
        launchers.reduce((total, module) => total + (module.ammunition?.total ?? 0), 0),
      );
    });

    it('is unchanged by the hardpoint state and by the allocation', () => {
      const build = withinBudgetBuild();
      const base = project(build);

      expect(project(build, 'retracted').heat).toEqual(base.heat);
      expect(project(build, 'deployed', { systems: 0, engines: 0, weapons: 4 }).heat).toEqual(
        base.heat,
      );
    });

    it('stays unavailable, with no hull fallback, when the package returns null', () => {
      const power = project(noPlantOutputBuild());

      expect(power.heat).toBeNull();
      expect(power.power.available).toBe(0);
      expect(power.modules.length).toBeGreaterThan(0);
    });
  });

  describe('the package boundary', () => {
    it('asks the package for each of the three answers exactly once', () => {
      // Counted at this projection's own boundary. `heatMetricsResult()` and
      // `distributorMetricsResult()` apply the power budget internally, so only
      // the outermost call of each is counted: one ask per answer, no
      // re-derivation and no second opinion. Since Almanac 0.2.0 the three
      // calculations are on `BuildMetrics`, so the seam is its prototype;
      // `fittedModules()` is the build's own fitting and stays on the loadout.
      const build = withinBudgetBuild();
      // One depth across all three: `heatMetricsResult()` and
      // `distributorMetricsResult()` apply the power budget internally, so a
      // per-method depth would count the package's own call into
      // `powerBudget()` as a second ask.
      let depth = 0;
      const outermost = (
        name: 'powerBudget' | 'heatMetricsResult' | 'distributorMetricsResult',
      ) => {
        let calls = 0;
        const real = BuildMetrics.prototype[name] as (...args: never[]) => unknown;
        vi.spyOn(BuildMetrics.prototype, name).mockImplementation(function (
          this: BuildMetrics,
          ...args: never[]
        ) {
          if (depth === 0) calls += 1;
          depth += 1;
          try {
            return real.apply(this, args);
          } finally {
            depth -= 1;
          }
        } as never);
        return () => calls;
      };
      const powerBudget = outermost('powerBudget');
      const heatMetrics = outermost('heatMetricsResult');
      const distributorMetrics = outermost('distributorMetricsResult');
      const fittedModules = vi.spyOn(build, 'fittedModules');

      projectPowerHeat(build, conditions());

      // The fourth is not a package answer: it is the build's own fitting, read
      // for the two readings `heatMetricsResult()` says it does not publish.
      expect({
        powerBudget: powerBudget(),
        heatMetrics: heatMetrics(),
        distributorMetrics: distributorMetrics(),
        fittedModules: fittedModules.mock.calls.length,
      }).toEqual({
        powerBudget: 1,
        heatMetrics: 1,
        distributorMetrics: 1,
        fittedModules: 1,
      });
    });

    it('hands the allocation to the package rather than scaling anything itself', () => {
      const build = withinBudgetBuild();
      const distributorMetrics = vi.spyOn(BuildMetrics.prototype, 'distributorMetricsResult');

      projectPowerHeat(build, conditions('deployed', { systems: 3, engines: 1, weapons: 2 }));

      expect(distributorMetrics).toHaveBeenCalledWith({
        systemsPips: 3,
        enginesPips: 1,
        weaponsPips: 2,
      });
    });

    it('freezes the result it publishes', () => {
      expect(Object.isFrozen(project(withinBudgetBuild()))).toBe(true);
    });
  });
});
