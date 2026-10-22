import { afterEach, vi } from 'vitest';
import {
  BuildMetrics,
  type StandardLoadInputs,
} from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { CalculationIssue } from '@elite-dangerous-almanac/core/ships/loadout-calculations';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import { getShipBySymbol } from '@elite-dangerous-almanac/core/ships/ships';
import { projectMobilityAndJump, STANDARD_LOADS, type StandardLoad } from './mobility-jump';

/**
 * A package issue shaped like the ones the guard path carries.
 *
 * The unusable-drive states are not reachable from the installed catalogue, so
 * the guard tests reach them by making the package say what it would say.
 */
const BLOCKING_ISSUE: CalculationIssue = {
  field: 'frameShiftDrive',
  reason: 'missing',
  message: 'No usable frame shift drive is fitted.',
};

/** A stock hull is enough: every reading here is the package's own. */
function build(symbol = 'Anaconda'): ShipLoadout {
  return ShipLoadout.default(symbol);
}

/**
 * What one of the package's three loads carries, unwrapped.
 *
 * The stock hulls these tests build always resolve all three; unwrapping here
 * keeps the expectations reading as the one package answer they compare against.
 */
function standardLoad(loadout: ShipLoadout, load: StandardLoad): StandardLoadInputs {
  const result = BuildMetrics.of(loadout).standardLoadResult(load);
  if (!result.complete) {
    throw new Error(`The installed package no longer weighs a stock hull at its ${load} load.`);
  }
  return result.value;
}

/** What the load the card is read at carries, unwrapped. */
function envelopeLoad(loadout: ShipLoadout): StandardLoadInputs {
  return standardLoad(loadout, 'unladen');
}

describe('projectMobilityAndJump', () => {
  // The calculations moved onto `BuildMetrics` in Almanac 0.2.0, so the seam
  // is its prototype rather than one build. A prototype stays mocked for
  // every later test in this file unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('jump performance', () => {
    it('reads all three loads from one package summary', () => {
      const loadout = build();
      const summary = BuildMetrics.of(loadout).jumpRangeSummary();
      const { profiles } = projectMobilityAndJump(loadout, 4).drive;

      // One figure a load, as the canvas draws its rows: what this build jumps
      // on that load. The whole tank is a separate reading it draws once.
      expect(profiles.map((profile) => profile.load)).toEqual([...STANDARD_LOADS]);
      expect(profiles.map((profile) => profile.range)).toEqual([
        summary.max,
        summary.unladen,
        summary.laden,
      ]);
    });

    it("reads the canvas's whole tank once, from the summary that names one", () => {
      // `Total range` / `8 JUMPS ON A FULL TANK`. The qualifier names a tank
      // and no cargo, which is the summary the package words "on one full
      // tank, empty hold" — not the one that carries a full hold too.
      const loadout = build();
      const summary = BuildMetrics.of(loadout).jumpRangeSummary();
      const { totalRange } = projectMobilityAndJump(loadout, 4).drive;

      expect(totalRange).toEqual({
        range: summary.totalUnladen.range,
        jumps: summary.totalUnladen.jumps,
      });
      expect(totalRange?.range).not.toBe(summary.totalLaden.range);
    });

    it('never confuses the maximum profile with the unladen one', () => {
      // The summary names the same three loads `max`, `unladen` and `laden`. A
      // projector that indexed it by the load key would read `undefined` for the
      // maximum profile and quietly draw a blank where the furthest jump goes.
      const { profiles } = projectMobilityAndJump(build(), 4).drive;

      for (const profile of profiles) {
        expect(Number.isFinite(profile.range)).toBe(true);
      }
      expect(profiles[0].range).not.toBe(profiles[1].range);
    });

    it("copies the drive's own post-engineering constants", () => {
      const loadout = build();
      const { drive } = projectMobilityAndJump(loadout, 4);

      expect(drive.optMass).toBe(BuildMetrics.of(loadout).frameShiftDrive().optMass);
      expect(drive.maxFuel).toBe(BuildMetrics.of(loadout).frameShiftDrive().maxFuel);
    });

    it('reads mass lock off the hull record', () => {
      const { drive } = projectMobilityAndJump(build(), 4);

      expect(drive.massLock).toBe(getShipBySymbol('Anaconda')?.masslock);
    });
  });

  describe('mobility', () => {
    it('passes the ENG allocation to the package unchanged', () => {
      // Almanac 0.2.0 took the allocation off `mobilityMetricsResult()`, which
      // is now the four-pip envelope, and gave it its own call. The allocation is the
      // capacitor's, so that is where it has to arrive unchanged.
      const loadout = build();
      const carried = envelopeLoad(loadout);

      for (const pips of [0, 0.5, 2, 4]) {
        const projected = projectMobilityAndJump(loadout, pips).thrusters.capacitor;
        expect(projected).toEqual(
          BuildMetrics.of(loadout).mobilityCapacitorMetricsResult({ ...carried, enginesPips: pips })
            .value,
        );
      }
    });

    it('leaves a rotation the game holds flat exactly as flat as the package leaves it', () => {
      // A Commander asked why roll and yaw look unaffected by the pips
      // (2026-08-27). They are not treated differently: the package
      // interpolates all four allocation-bearing readings the same way, over
      // the hull's own two ends. On 48 of the 49 hulls the catalogue carries,
      // `minRoll` equals `roll`; on 43 of them `minYaw` equals `yaw`. Where the
      // two ends are one number, every allocation lands on that number.
      //
      // So this is the guard against the fix nobody should make: a flat reading
      // is the Almanac's answer, and correcting, scaling or substituting one
      // here would be this application inventing a rotation rate the game does
      // not have (constitution II and IV).
      const anaconda = build('Anaconda');
      const idle = projectMobilityAndJump(anaconda, 0).thrusters.capacitor;
      const full = projectMobilityAndJump(anaconda, 4).thrusters.capacitor;

      expect(idle?.roll).toBe(full?.roll);
      expect(idle?.yaw).toBe(full?.yaw);
      expect(idle?.speed).not.toBe(full?.speed);
      expect(idle?.pitch).not.toBe(full?.pitch);

      // And where the game does give the two ends room, the same call moves all
      // four — which is what shows the flatness above is the data and not the
      // reading of it.
      const cobra = build('CobraMkV');
      const cobraIdle = projectMobilityAndJump(cobra, 0).thrusters.capacitor;
      const cobraFull = projectMobilityAndJump(cobra, 4).thrusters.capacitor;

      expect(cobraIdle?.roll).not.toBe(cobraFull?.roll);
      expect(cobraIdle?.yaw).not.toBe(cobraFull?.yaw);
    });

    it('leaves the four-pip envelope still whatever the allocation stands at', () => {
      const loadout = build();
      const four = projectMobilityAndJump(loadout, 4).thrusters.mobility;

      expect(projectMobilityAndJump(loadout, 0).thrusters.mobility).toEqual(four);
    });

    it('reads the envelope at the one load the card can account for', () => {
      // The canvas's headline `1,142` is exactly the three rows drawn under it
      // — `400` hull, `662` modules, `080` fuel — and there is no cargo row for
      // a fourth part to appear in. That is a full main tank over an empty
      // hold, the package's `unladen` profile, and the mass and the envelope
      // are read at it together so the card describes one ship.
      const loadout = build();
      const { thrusters } = projectMobilityAndJump(loadout, 2);
      const carried = envelopeLoad(loadout);

      expect(thrusters.envelopeLoad).toBe('unladen');
      expect(thrusters.mobility).toEqual(
        BuildMetrics.of(loadout).mobilityMetricsResult(carried).value,
      );
      expect(thrusters.mobility?.loadedMass).toBe(thrusters.mass?.total);
    });

    it('heads a mass the drawn parts account for, and not one they cannot', () => {
      // The bar draws hull, modules and fuel. At the laden load the headline
      // would carry a full hold as well, and a stock Anaconda would head
      // 1,210 t over three rows summing to 1,096 t — 114 t of cargo with no row
      // to explain it. The sum is asserted here and never computed in the
      // projector, which reads the package's own `total`.
      const loadout = build();
      const mass = projectMobilityAndJump(loadout, 4).thrusters.mass;

      expect(mass?.cargo).toBe(0);
      expect((mass?.hull ?? 0) + (mass?.modules ?? 0) + (mass?.fuel ?? 0)).toBeCloseTo(
        mass?.total ?? 0,
      );
      // The laden load genuinely differs, so the choice above is a decision and
      // not a coincidence of this hull.
      expect(
        BuildMetrics.of(loadout).buildMass(standardLoad(loadout, 'laden')).total,
      ).toBeGreaterThan(mass?.total ?? 0);
    });

    it('keeps every one of the eight returned fields', () => {
      const { mobility } = projectMobilityAndJump(build(), 4).thrusters;

      expect(Object.keys(mobility ?? {}).sort()).toEqual([
        'boost',
        'loadedMass',
        'massCurveMultiplier',
        'pitch',
        'roll',
        'rotationMassCurveMultiplier',
        'speed',
        'yaw',
      ]);
    });

    it('carries the package issues and no value when the reading is incomplete', () => {
      // The thruster mount is a fixed one the package will not let a build
      // empty, so switching it off is the reachable unavailable state.
      const loadout = build();
      loadout.setModuleEnabled('MainEngines', false);
      const { mobility, issues } = projectMobilityAndJump(loadout, 4).thrusters;

      expect(mobility).toBeNull();
      expect(issues).toEqual(
        BuildMetrics.of(loadout).mobilityMetricsResult(envelopeLoad(loadout)).issues,
      );
      expect(issues.map((issue) => issue.reason)).toEqual(['disabled']);
    });

    it('takes the reasons from whichever of the two readings withheld a figure', () => {
      // The package documents the same diagnostics for both, because they read
      // one build, so today the capacitor never fails on its own. That
      // coincidence is exactly why the guard needs its own test: without it the
      // card would go unavailable with an empty reason list the day the two
      // diverge, and the suite would stay green.
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'mobilityCapacitorMetricsResult').mockReturnValue({
        complete: false,
        value: null,
        issues: [BLOCKING_ISSUE],
      });

      const { mobility, capacitor, issues } = projectMobilityAndJump(loadout, 4).thrusters;

      expect(mobility).not.toBeNull();
      expect(capacitor).toBeNull();
      expect(issues).toEqual([BLOCKING_ISSUE]);
    });

    it('substitutes no hull speed for an unavailable reading', () => {
      const loadout = build();
      loadout.setModuleEnabled('MainEngines', false);
      const { thrusters } = projectMobilityAndJump(loadout, 4);
      const hull = getShipBySymbol('Anaconda');

      // The hull's own figures exist and are deliberately not reached for: a
      // catalogue speed is not this build's speed (FR-005).
      expect(hull?.maximumSpeed).toBeGreaterThan(0);
      expect(thrusters.mobility).toBeNull();
    });
  });

  describe('mass and capacity', () => {
    it('projects none of the three package aggregates the canvas does not draw', () => {
      const loadout = build();
      const { thrusters } = projectMobilityAndJump(loadout, 4);

      // `unladenMass`, `fuelCapacity` and `cargoCapacity` are real package
      // figures, and the canvas draws none of them: the revision of 2026-08-25
      // cut the fuel row's qualifier to the bare word `TANK`, which took the
      // last capacity off the card. A figure no canvas draws is not read, so
      // none of the three reaches the snapshot.
      expect(thrusters).not.toHaveProperty('fuelCapacity');
      expect(thrusters).not.toHaveProperty('unladenMass');
      expect(thrusters).not.toHaveProperty('cargoCapacity');
    });

    it("copies the package's own mass split, weighed at the envelope's load", () => {
      // The canvas's headline and its three bar segments are one package
      // answer — `buildMass()`, the mass counterpart of `buildCost()` — read at
      // the same load the speed envelope was read at, so the whole card is one
      // ship rather than two.
      const loadout = build();
      const carried = envelopeLoad(loadout);
      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.mass).toEqual({ ...BuildMetrics.of(loadout).buildMass(carried) });
      expect(thrusters.mass?.hull).toBeGreaterThan(0);
      expect(thrusters.mass?.modules).toBeGreaterThan(0);
    });

    it('sums nothing: the total is the package’s, not hull plus modules plus fuel', () => {
      // The parts are all here and the total is still read rather than added.
      // A projector that summed them would agree today and drift the moment the
      // package counts something this addition does not (constitution II).
      const loadout = build();
      const mass = projectMobilityAndJump(loadout, 4).thrusters.mass;

      expect(mass?.total).toBe(BuildMetrics.of(loadout).buildMass(envelopeLoad(loadout)).total);
    });

    it("takes the thruster's mass curve from the package's own getter", () => {
      // `thrusters` is the package's counterpart of `frameShiftDrive`, and it
      // decides what a complete curve is. Reassembling one here from the raw
      // stats would be this application making that call (constitution II).
      const loadout = build();
      const { curve } = projectMobilityAndJump(loadout, 4).thrusters;

      expect(curve).toEqual(BuildMetrics.of(loadout).thrusters());
      expect(curve?.optMass).toBeGreaterThan(0);
      expect(curve?.maxMass).toBeGreaterThan(curve?.optMass ?? 0);
    });

    it('keeps the curve when the thrusters are merely switched off', () => {
      // A switched-off thruster still has a mass curve: what is unavailable is
      // the build's mobility, not the module's stats. The two stay separate so
      // the marks on the mass bar do not vanish with the reading.
      const loadout = build();
      loadout.setModuleEnabled('MainEngines', false);
      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.mobility).toBeNull();
      expect(thrusters.curve).not.toBeNull();
    });
  });

  describe('the four readings the library was asked for', () => {
    it('reads the position on the thruster curve the way the package prescribes', () => {
      // The canvas's `91% OF OPTIMAL MASS`. The package publishes both operands
      // and its own `thrusters` documentation says to read one against the
      // other; this is the only division in the projector.
      const loadout = build();
      const { thrusters } = projectMobilityAndJump(loadout, 4);
      const stats = loadout.fittedModuleAt('MainEngines')?.effectiveStats;

      expect(thrusters.mobility?.loadedMass).toBeGreaterThan(0);
      expect(thrusters.massCurvePosition).toBe(
        (thrusters.mobility?.loadedMass ?? 0) / (stats?.optMass ?? 1),
      );
    });

    it('has no curve position where the package would not say', () => {
      // No mobility reading, no loaded mass to place on the curve — and a ratio
      // built from some other mass would be a figure this application invented.
      const loadout = build();
      loadout.setModuleEnabled('MainEngines', false);
      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.mobility).toBeNull();
      expect(thrusters.massCurvePosition).toBeNull();
      // The curve itself survives: the switch took the reading, not the stats.
      expect(thrusters.curve).not.toBeNull();
    });

    it('takes Supercruise Overcharge from the catalogue, never from the symbol', () => {
      // A stock Anaconda's drive is an ordinary hyperdrive, which the catalogue
      // does not mark. That is a stated `false`, not an unknown.
      const loadout = build();
      const { drive } = projectMobilityAndJump(loadout, 4);

      expect(drive.supercruiseOvercharge).toBe(false);
      expect(drive.source.symbol).toContain('Int_Hyperdrive_');
    });

    it('reports an Overcharge drive as capable once one is fitted', () => {
      const loadout = build();
      const overcharge = getModuleBySymbol('Int_Hyperdrive_Overcharge_Size6_Class5');
      if (!overcharge) {
        throw new Error('The installed package no longer carries an Overcharge drive to fit.');
      }
      loadout.setModule('FrameShiftDrive', overcharge);

      expect(projectMobilityAndJump(loadout, 4).drive.supercruiseOvercharge).toBe(true);
    });
  });

  describe('when the drive cannot be read', () => {
    it('guards the jump call rather than letting the package throw', () => {
      // `jumpRangeSummary()` throws a TypeError on a build with no usable drive
      // and `frameShiftDrive` throws on a record missing its jump constants.
      // Neither is reachable from today's catalogue, which is exactly why the
      // guard needs its own test: the suite would stay green either way.
      const loadout = build();
      const summary = vi.spyOn(BuildMetrics.prototype, 'jumpRangeSummary');
      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockImplementation((load) =>
        load === 'maximum'
          ? { complete: false, value: null, issues: [BLOCKING_ISSUE] }
          : { complete: true, value: { fuel: 0, cargo: 0, mass: 0 }, issues: [] },
      );

      const { drive } = projectMobilityAndJump(loadout, 4);

      expect(summary).not.toHaveBeenCalled();
      expect(drive.profiles).toEqual([]);
      expect(drive.issues).toEqual([BLOCKING_ISSUE]);
      expect(drive.optMass).toBeNull();
      expect(drive.maxFuel).toBeNull();
    });

    it('guards every load the summary resolves, not just the first', () => {
      // `jumpRangeSummary()` resolves the maximum, unladen and laden loads in
      // turn and throws on the first it cannot. A guard that watched only the
      // maximum load would let either of the other two throw straight out of
      // this projector and take the whole anatomy region down (FR-003).
      for (const blocked of STANDARD_LOADS) {
        // The seam is a prototype, so the previous turn's mock has to come off
        // before this one reads a real answer through it.
        vi.restoreAllMocks();
        const loadout = build();
        const summary = vi.spyOn(BuildMetrics.prototype, 'jumpRangeSummary');
        const settled = BuildMetrics.of(loadout).standardLoadResult('maximum');
        vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockImplementation((load) =>
          load === blocked ? { complete: false, value: null, issues: [BLOCKING_ISSUE] } : settled,
        );

        const { drive } = projectMobilityAndJump(loadout, 4);

        expect(summary).not.toHaveBeenCalled();
        expect(drive.profiles).toEqual([]);
        // The package's own reason for the load that failed, not a rephrasing
        // and not the reason for a load that resolved.
        expect(drive.issues).toEqual([BLOCKING_ISSUE]);
      }
    });

    it('guards the constants getter too, and shows no reasons it was not given', () => {
      // The other throw the guard is for, and the one the loads above never
      // reach: every load resolves, so the projector goes on to ask the drive
      // for its own constants, and `frameShiftDrive` throws on a record missing
      // its jump constants. A throw is not a `CalculationResult`, so there are
      // no reasons to show — and the card draws the unavailable value with no
      // "why" list beside it rather than an empty one.
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'frameShiftDrive').mockImplementation(() => {
        throw new TypeError('BuildMetrics: drive record has no jump constants');
      });

      const { drive } = projectMobilityAndJump(loadout, 4);

      expect(drive.profiles).toEqual([]);
      expect(drive.issues).toEqual([]);
      expect(drive.optMass).toBeNull();
      expect(drive.maxFuel).toBeNull();
      expect(drive.totalRange).toBeNull();
    });

    it('keeps the thruster card whole when the constants getter throws', () => {
      // The drive card loses everything; the thruster card loses nothing. The
      // envelope's own load is the one of the three that costs no jump, so it
      // never reaches the throwing getter — which is the separation FR-003 asks
      // for, holding here without either card knowing about the other.
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'frameShiftDrive').mockImplementation(() => {
        throw new TypeError('BuildMetrics: drive record has no jump constants');
      });

      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.mobility).not.toBeNull();
      expect(thrusters.mass).not.toBeNull();
      expect(thrusters.massCurvePosition).not.toBeNull();
      expect(thrusters.issues).toEqual([]);
    });

    it('leaves the thruster card whole when the drive cannot be read', () => {
      // The two cards are separate readings of separate modules. An unusable
      // drive taking the speed envelope down with it would be the opposite of
      // what the design asks for.
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockImplementation((load) =>
        load === 'maximum'
          ? { complete: false, value: null, issues: [BLOCKING_ISSUE] }
          : { complete: true, value: { fuel: 32, cargo: 0, mass: 400 }, issues: [] },
      );

      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.mobility).not.toBeNull();
      expect(thrusters.curve).not.toBeNull();
      expect(thrusters.mass?.unladen).toBeGreaterThan(0);
    });

    it('reports no jump figures rather than zeroes', () => {
      const loadout = build();
      vi.spyOn(BuildMetrics.prototype, 'standardLoadResult').mockReturnValue({
        complete: false,
        value: null,
        issues: [BLOCKING_ISSUE],
      });

      const { drive } = projectMobilityAndJump(loadout, 4);

      expect(drive.profiles).toHaveLength(0);
    });
  });

  describe('what the canvas names beside the mass', () => {
    it('carries the fitted bulkhead and how many modules are fitted', () => {
      // The canvas's `ANACONDA · MILITARY GRADE` and `22 FITTED`. The count is
      // how many rows the package returns, not a total of what they weigh.
      const loadout = build();
      const { thrusters } = projectMobilityAndJump(loadout, 4);

      expect(thrusters.bulkhead.slot).toBe('Armour');
      expect(thrusters.bulkhead.symbol).not.toBeNull();
      expect(thrusters.fittedModuleCount).toBe(loadout.fittedModules().length);
    });
  });

  describe('the source modules', () => {
    it("uses the game's own slot keys", () => {
      const view = projectMobilityAndJump(build(), 4);

      // `MainEngines`, not `Thrusters`: the key is the game's and is never
      // guessed from the module's purpose.
      expect(view.thrusters.source.slot).toBe('MainEngines');
      expect(view.drive.source.slot).toBe('FrameShiftDrive');
    });

    it('reports a switched-off mount as off rather than absent', () => {
      const loadout = build();
      loadout.setModuleEnabled('MainEngines', false);
      const { source } = projectMobilityAndJump(loadout, 4).thrusters;

      // The module is still there and still named. `off` and `absent` are
      // different states and the screen words them differently.
      expect(source.slot).toBe('MainEngines');
      expect(source.symbol).not.toBeNull();
      expect(source.on).toBe(false);
    });
  });

  it('freezes what it hands back', () => {
    const view = projectMobilityAndJump(build(), 4);

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.thrusters)).toBe(true);
    expect(Object.isFrozen(view.drive)).toBe(true);
  });
});
