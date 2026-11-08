import { afterEach, vi } from 'vitest';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { FittedWeaponMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { FittedModule } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { DamageSplit } from '@elite-dangerous-almanac/core/ships/weapons';
import {
  collectionMeaning,
  groupIdenticalWeapons,
  projectCapacitor,
  projectDamageSegments,
  projectEndurance,
  projectOffence,
  projectRangeBands,
  RANGE_BANDS,
} from './offence';
import {
  OFFENCE_COVERAGE,
  OFFENCE_DEFAULT_SLOTS,
  OFFENCE_FIXTURE_PIPS,
  allDisabledBuild,
  drainingBuild,
  everyStateBuild,
  noWeaponsBuild,
  populatedBuild,
} from './offence.fixtures';

describe('projectOffence', () => {
  // The calculations moved onto `BuildMetrics` in Almanac 0.2.0, so the seam
  // is its prototype rather than one build. A prototype stays mocked for
  // every later test in this file unless it is put back.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains the package result itself rather than a copy of it', () => {
    const loadout = populatedBuild();
    const returned = BuildMetrics.of(loadout).weaponMetrics();
    const metrics = vi.spyOn(BuildMetrics.prototype, 'weaponMetrics').mockReturnValue(returned);

    const offence = projectOffence(loadout, OFFENCE_COVERAGE.complete, OFFENCE_FIXTURE_PIPS);

    // Identity, not equality: a copy would let something between the package
    // and a screen round, re-sum or relabel a field.
    expect(offence.build).toBe(returned);
    expect(offence.weapons).toBe(returned.weapons);
    metrics.mockRestore();
  });

  it('asks the package exactly once for each of its two answers', () => {
    const loadout = populatedBuild();
    const weapons = vi.spyOn(BuildMetrics.prototype, 'weaponMetrics');
    const capacitor = vi.spyOn(BuildMetrics.prototype, 'weaponsCapacitorMetrics');

    projectOffence(loadout, OFFENCE_COVERAGE.complete, OFFENCE_FIXTURE_PIPS);

    expect(weapons).toHaveBeenCalledTimes(1);
    expect(capacitor).toHaveBeenCalledTimes(1);
    expect(capacitor).toHaveBeenCalledWith({ weaponsPips: OFFENCE_FIXTURE_PIPS });
    weapons.mockRestore();
    capacitor.mockRestore();
  });

  it('never selects the capacitor fields no canvas draws', () => {
    const offence = projectOffence(populatedBuild(), OFFENCE_COVERAGE.complete, 2);

    expect(offence.capacitor).not.toHaveProperty('netDrainRate');
    expect(offence.capacitor).not.toHaveProperty('weaponsPips');
  });

  it('keeps the package order, and neither sorts nor merges duplicate symbols', () => {
    const loadout = everyStateBuild();

    const offence = projectOffence(loadout, OFFENCE_COVERAGE.complete, OFFENCE_FIXTURE_PIPS);

    expect(offence.weapons.map((weapon) => weapon.slot)).toEqual(
      BuildMetrics.of(loadout)
        .weaponMetrics()
        .weapons.map((weapon) => weapon.slot),
    );
  });

  it('reads the capacitor at the allocation it was given, and names it', () => {
    const loadout = populatedBuild();

    const low = projectOffence(loadout, OFFENCE_COVERAGE.complete, 0);
    const high = projectOffence(loadout, OFFENCE_COVERAGE.complete, 4);

    expect(low.capacitor.allocation).toBe(0);
    expect(high.capacitor.allocation).toBe(4);
    expect(high.capacitor.rechargeRate).toBeGreaterThan(low.capacitor.rechargeRate);
    expect(low.capacitor.capacity).toBe(high.capacitor.capacity);
  });

  it('passes the half-pip step through to the package unchanged', () => {
    const offence = projectOffence(populatedBuild(), OFFENCE_COVERAGE.complete, 1.5);

    expect(offence.capacitor.allocation).toBe(1.5);
    expect(Number.isFinite(offence.capacitor.rechargeRate)).toBe(true);
  });

  it('freezes the projection it returns, though not what the package handed it', () => {
    const offence = projectOffence(populatedBuild(), OFFENCE_COVERAGE.complete, 2);

    expect(Object.isFrozen(offence)).toBe(true);

    // Shallow, and deliberately: the projection retains the package's own
    // objects unchanged, and freezing those would reach into the package's
    // state to enforce a rule of this application's.
    expect(Object.isFrozen(offence.build)).toBe(false);
  });

  it('keeps a disabled weapon in the collection beside the package total', () => {
    const loadout = allDisabledBuild();

    const offence = projectOffence(loadout, OFFENCE_COVERAGE.complete, OFFENCE_FIXTURE_PIPS);

    expect(offence.weapons).toHaveLength(OFFENCE_DEFAULT_SLOTS.length);
    expect(offence.weapons.every((weapon) => weapon.enabled)).toBe(false);
    expect(offence.build.total.damagePerSecond).toBe(0);
    expect(offence.collection).toBe('populated');
  });
});

describe('collectionMeaning', () => {
  it('is noFittedWeapons only when feature 002 confirms the hardpoints are empty', () => {
    expect(collectionMeaning([], OFFENCE_COVERAGE.confirmedEmpty)).toBe('noFittedWeapons');
  });

  it('never reads an empty list as empty hardpoints when coverage is unavailable', () => {
    expect(collectionMeaning([], OFFENCE_COVERAGE.unavailable)).toBe('coverageUnavailable');
  });

  it('qualifies a populated collection rather than replacing it', () => {
    const weapons = BuildMetrics.of(populatedBuild()).weaponMetrics().weapons;

    expect(collectionMeaning(weapons, OFFENCE_COVERAGE.unavailable)).toBe('coverageUnavailable');
  });

  it('is populated when the package returned weapons and coverage resolved', () => {
    const weapons = BuildMetrics.of(populatedBuild()).weaponMetrics().weapons;

    expect(collectionMeaning(weapons, OFFENCE_COVERAGE.complete)).toBe('populated');
  });

  it('is populated when weapons were returned in mounts feature 002 called empty', () => {
    const weapons = BuildMetrics.of(populatedBuild()).weaponMetrics().weapons;

    expect(collectionMeaning(weapons, OFFENCE_COVERAGE.confirmedEmpty)).toBe('populated');
  });

  it('is populated for an empty list beside complete coverage', () => {
    expect(collectionMeaning([], OFFENCE_COVERAGE.complete)).toBe('populated');
  });

  it('reads a weaponless build through its coverage, not through its count', () => {
    const loadout = noWeaponsBuild();

    const confirmed = projectOffence(loadout, OFFENCE_COVERAGE.confirmedEmpty, 2);
    const unavailable = projectOffence(loadout, OFFENCE_COVERAGE.unavailable, 2);

    expect(confirmed.weapons).toEqual([]);
    expect(confirmed.collection).toBe('noFittedWeapons');
    expect(unavailable.weapons).toEqual([]);
    expect(unavailable.collection).toBe('coverageUnavailable');
  });
});

describe('projectEndurance', () => {
  it('reads a positive result as its own number of seconds', () => {
    expect(projectEndurance(9.5)).toEqual({ kind: 'finite', seconds: 9.5 });
  });

  it('reads zero as draining immediately rather than as a missing answer', () => {
    expect(projectEndurance(0)).toEqual({ kind: 'immediate' });
  });

  it('reads infinity as recharge keeping pace, and never as a number', () => {
    expect(projectEndurance(Infinity)).toEqual({ kind: 'sustained' });
  });
});

describe('projectCapacitor', () => {
  it('selects the four drawn fields, their two fills, and no others', () => {
    const metrics = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 2 });

    const capacitor = projectCapacitor(metrics, 2);

    // The four figures, the allocation they were read at, and the two fills.
    // The fills are here rather than on the screen because a fill is two
    // package amounts divided, and this is the one place allowed to do that.
    expect(Object.keys(capacitor).sort()).toEqual([
      'allocation',
      'capacity',
      'drawFill',
      'endurance',
      'rechargeFill',
      'rechargeRate',
      'sustainedEnergyPerSecond',
    ]);
  });

  it('fills the draw and the recharge against the larger of the two', () => {
    const metrics = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 2 });

    const capacitor = projectCapacitor(metrics, 2);

    const larger = Math.max(metrics.sustainedEnergyPerSecond, metrics.rechargeRate);
    expect(capacitor.drawFill).toBeCloseTo(metrics.sustainedEnergyPerSecond / larger, 9);
    expect(capacitor.rechargeFill).toBeCloseTo(metrics.rechargeRate / larger, 9);
    // Whichever is larger is the full track, which is the question the two
    // rows together answer.
    expect(Math.max(capacitor.drawFill ?? 0, capacitor.rechargeFill ?? 0)).toBeCloseTo(1, 9);
  });

  it('gives neither a fill where nothing is drawn and nothing recharges', () => {
    const capacitor = projectCapacitor(
      {
        capacity: 0,
        rechargeRate: 0,
        sustainedEnergyPerSecond: 0,
        timeToDrain: Infinity,
      } as ReturnType<BuildMetrics['weaponsCapacitorMetrics']>,
      0,
    );

    // Nothing against nothing is not a full track and not an empty one: an
    // empty track reads as a figure of nothing, which is a different statement.
    expect(capacitor.drawFill).toBeNull();
    expect(capacitor.rechargeFill).toBeNull();
  });

  it('states sustained endurance when the recharge keeps pace', () => {
    const offence = projectOffence(populatedBuild(), OFFENCE_COVERAGE.complete, 4);

    expect(offence.capacitor.endurance).toEqual({ kind: 'sustained' });
  });

  it('states a finite endurance when the firing load outruns the recharge', () => {
    const offence = projectOffence(drainingBuild(), OFFENCE_COVERAGE.complete, 0);

    expect(offence.capacitor.endurance.kind).toBe('finite');
    expect(offence.capacitor.endurance).toMatchObject({
      seconds: expect.any(Number),
    });
  });
});

describe('projectDamageSegments', () => {
  it('partitions conventional damage and leaves the anti-xeno overlay out', () => {
    const split = BuildMetrics.of(everyStateBuild()).weaponMetrics().total.damageByType;

    const segments = projectDamageSegments(split);

    expect(split.antiXeno).toBeGreaterThan(0);
    expect(segments.map((segment) => segment.type)).not.toContain('antiXeno');
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1, 9);
    for (const segment of segments) {
      expect(segment.amount).toBe(split[segment.type]);
    }
  });

  it('gives caustic its own segment, in the package\u2019s own order', () => {
    // Caustic is pinned by name and by position, because a projection that
    // silently dropped it would still divide, still sum to one and still agree
    // with the split on every segment it did keep.
    const split = BuildMetrics.of(everyStateBuild()).weaponMetrics().total.damageByType;

    const segments = projectDamageSegments(split);

    expect(split.caustic).toBeGreaterThan(0);
    expect(segments.map((segment) => segment.type)).toEqual([
      'kinetic',
      'thermal',
      'explosive',
      'caustic',
    ]);
    expect(segments.at(-1)).toMatchObject({ type: 'caustic', amount: split.caustic });
  });

  it('draws every conventional type in one fixed order', () => {
    // The catalogue deals no unclassified damage at all, and `everyStateBuild()` fits
    // no article that deals absolute, so no fixture build pins where those two sit. A
    // split written out here can: without this the last two positions could swap and
    // every suite would stay green, which is the failure the projection's own order
    // record exists to prevent.
    const split = {
      kinetic: 1,
      thermal: 2,
      explosive: 3,
      caustic: 4,
      absolute: 5,
      unclassified: 6,
      antiXeno: 7,
    } satisfies DamageSplit;

    const segments = projectDamageSegments(split);

    expect(segments.map((segment) => segment.type)).toEqual([
      'kinetic',
      'thermal',
      'explosive',
      'caustic',
      'absolute',
      'unclassified',
    ]);
  });

  it('draws no segment for a type the build does not deal', () => {
    const segments = projectDamageSegments({
      kinetic: 4,
      thermal: 0,
      explosive: 0,
      caustic: 0,
      absolute: 0,
      antiXeno: 0,
    });

    expect(segments.map((segment) => segment.type)).toEqual(['kinetic']);
    expect(segments[0]?.share).toBe(1);
  });

  it('returns nothing at all when there is no conventional damage to divide', () => {
    expect(
      projectDamageSegments({
        kinetic: 0,
        thermal: 0,
        explosive: 0,
        caustic: 0,
        absolute: 0,
        antiXeno: 9,
      }),
    ).toEqual([]);
  });
});

describe('projectRangeBands', () => {
  it('asks the canvas\u2019s four distances, in its order', () => {
    const bands = projectRangeBands(BuildMetrics.of(everyStateBuild()).weaponMetrics().weapons);

    expect(bands.map((band) => band.metres)).toEqual([...RANGE_BANDS]);
  });

  it('equals the package total where nothing has fallen off yet', () => {
    const metrics = BuildMetrics.of(populatedBuild()).weaponMetrics();

    const bands = projectRangeBands(metrics.weapons);

    // The stock pulse lasers reach their falloff well beyond the nearest band,
    // so at that distance the build lands exactly what the package totals.
    expect(bands[0]?.damagePerSecond).toBeCloseTo(metrics.total.damagePerSecond, 9);
    expect(bands[0]?.fill).toBe(1);
  });

  it('never lands more at a longer range than at a shorter one', () => {
    const bands = projectRangeBands(BuildMetrics.of(everyStateBuild()).weaponMetrics().weapons);

    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index]?.damagePerSecond).toBeLessThanOrEqual(
        bands[index - 1]?.damagePerSecond ?? 0,
      );
    }
  });

  it('counts only the weapons that are firing', () => {
    const bands = projectRangeBands(BuildMetrics.of(allDisabledBuild()).weaponMetrics().weapons);

    for (const band of bands) {
      expect(band.damagePerSecond).toBe(0);
      // No strongest band to be read against, so no bar at all: an empty track
      // reads as a figure of nothing, which is a different statement.
      expect(band.fill).toBeNull();
    }
  });
});

describe('groupIdenticalWeapons', () => {
  /**
   * The stock build's two identical weapons and their package records.
   *
   * The variations below change one field of a real package answer, so each
   * test proves the comparison of that one field and nothing else.
   */
  function stock(): {
    first: FittedWeaponMetrics;
    second: FittedWeaponMetrics;
    records: Map<string, FittedModule>;
  } {
    const loadout = populatedBuild();
    const [first, second] = BuildMetrics.of(loadout).weaponMetrics().weapons;
    if (first === undefined || second === undefined) {
      throw new Error('The stock fixture build no longer carries two weapons.');
    }
    return {
      first,
      second,
      records: new Map(loadout.fittedModules().map((module) => [module.slot, module])),
    };
  }

  /** Changes the record of one weapon, and keeps every other record. */
  function withRecord(
    records: Map<string, FittedModule>,
    slot: string,
    change: Partial<FittedModule>,
  ): Map<string, FittedModule> {
    const record = records.get(slot);
    if (record === undefined) {
      throw new Error(`No record for ${slot}.`);
    }
    return new Map(records).set(slot, { ...record, ...change });
  }

  const slots = (groups: readonly (readonly FittedWeaponMetrics[])[]): string[][] =>
    groups.map((group) => group.map((weapon) => weapon.slot));

  it('gives two identical weapons one group, at the first one’s position', () => {
    const { first, second, records } = stock();
    expect(first.symbol).toBe(second.symbol);

    const groups = groupIdenticalWeapons([first, second], records);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.[0]).toBe(first);
    expect(groups[0]).toEqual([first, second]);
  });

  it('lists every member’s slot key in a shared group', () => {
    const { first, second, records } = stock();

    expect(slots(groupIdenticalWeapons([first, second], records))).toEqual([
      [first.slot, second.slot],
    ]);
  });

  it.each<
    [string, (records: Map<string, FittedModule>, slot: string) => Map<string, FittedModule>]
  >([
    [
      'engineering',
      (records, slot) =>
        withRecord(records, slot, {
          engineering: { BlueprintName: 'Weapon_Overcharged', Level: 5, Quality: 1 },
        }),
    ],
    ['enabled state', (records, slot) => withRecord(records, slot, { on: false })],
    [
      'pre-engineered variant',
      (records, slot) =>
        withRecord(records, slot, {
          preEngineeredVariant: {
            symbol: records.get(slot)?.symbol ?? '',
            name: 'Variant',
            blueprintSymbol: 'Weapon_Overcharged',
            grade: 5,
          } as unknown as NonNullable<FittedModule['preEngineeredVariant']>,
        }),
    ],
  ])('gives two weapons that differ only in %s two groups', (_, change) => {
    const { first, second, records } = stock();

    const groups = groupIdenticalWeapons([first, second], change(records, second.slot));

    expect(slots(groups)).toEqual([[first.slot], [second.slot]]);
  });

  it('compares engineering by value, not by reference', () => {
    const { first, second, records } = stock();
    const engineering = (): FittedModule['engineering'] => ({
      BlueprintName: 'Weapon_Overcharged',
      Level: 5,
      Quality: 1,
      Modifiers: [{ Label: 'Damage', Value: 2, OriginalValue: 1 }],
    });
    const changed = withRecord(
      withRecord(records, first.slot, { engineering: engineering() }),
      second.slot,
      { engineering: engineering() },
    );

    expect(groupIdenticalWeapons([first, second], changed)).toHaveLength(1);
  });

  it.each<[string, (weapon: FittedWeaponMetrics) => FittedWeaponMetrics]>([
    [
      'burst damage',
      (weapon) => ({
        ...weapon,
        metrics: { ...weapon.metrics, damagePerSecond: weapon.metrics.damagePerSecond + 1 },
      }),
    ],
    [
      'sustained damage',
      (weapon) => ({
        ...weapon,
        metrics: {
          ...weapon.metrics,
          sustainedDamagePerSecond: weapon.metrics.sustainedDamagePerSecond + 1,
        },
      }),
    ],
    ['armour piercing', (weapon) => ({ ...weapon, armourPiercing: undefined })],
    ['maximum range', (weapon) => ({ ...weapon, maximumRange: undefined })],
    ['falloff range', (weapon) => ({ ...weapon, falloffRange: undefined })],
  ])('gives two weapons that differ only in their %s two groups', (_, change) => {
    const { first, second, records } = stock();

    expect(slots(groupIdenticalWeapons([first, change(second)], records))).toEqual([
      [first.slot],
      [second.slot],
    ]);
  });

  it('compares the figures as returned, not as they are drawn', () => {
    const { first, second, records } = stock();
    // Both draw as one figure to one place, and they are not the same figure.
    const drawnAlike = (weapon: FittedWeaponMetrics, value: number): FittedWeaponMetrics => ({
      ...weapon,
      metrics: { ...weapon.metrics, damagePerSecond: value },
    });

    const groups = groupIdenticalWeapons(
      [drawnAlike(first, 10.01), drawnAlike(second, 10.04)],
      records,
    );

    expect(slots(groups)).toEqual([[first.slot], [second.slot]]);
  });

  it('keeps a shared group where its first member stands', () => {
    const { first, second, records } = stock();
    const other: FittedWeaponMetrics = { ...first, slot: 'MediumHardpoint1', symbol: 'Other' };
    const withOther = new Map(records).set('MediumHardpoint1', {
      ...(records.get(first.slot) as FittedModule),
      slot: 'MediumHardpoint1',
      symbol: 'Other',
    });

    const groups = groupIdenticalWeapons([first, other, second], withOther);

    expect(slots(groups)).toEqual([[first.slot, second.slot], [other.slot]]);
  });

  it('gives a weapon with no record a group of its own', () => {
    const { first, second, records } = stock();
    const without = new Map(records);
    without.delete(second.slot);

    expect(slots(groupIdenticalWeapons([first, second], without))).toEqual([
      [first.slot],
      [second.slot],
    ]);
    // And where the first weapon has no record, the second does not join it.
    const firstWithout = new Map(records);
    firstWithout.delete(first.slot);
    expect(groupIdenticalWeapons([first, second], firstWithout)).toHaveLength(2);
  });
});
