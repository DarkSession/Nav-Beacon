import type {
  BuildWeaponMetrics,
  FittedWeaponMetrics,
} from '@elite-dangerous-almanac/core/ships/build-metrics';
import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { damageFalloff, type DamageSplit } from '@elite-dangerous-almanac/core/ships/weapons';
import type { WeaponsCapacitorMetrics } from '@elite-dangerous-almanac/core/ships/weapons-capacitor';
import type { HardpointCoverage } from '../outfitting/hardpoint-coverage';
import { projectConvergence, type Convergence } from './convergence';

/**
 * What the build's weapons do, and how long the weapons capacitor sustains
 * them — as canvas 1c draws it in `OFFENCE ANALYSIS` and canvas 1d in the
 * mobile `OFFENCE` panel.
 *
 * One pure synchronous read of two `ShipLoadout` methods, and nothing else.
 * There is no store, no cache, no revision key and no lifecycle: the loadout is
 * already in memory, both calls are synchronous, and the signal graph memoises
 * the whole thing for the two surfaces that read it. That is the shape feature
 * 005's dashboard already ships.
 *
 * Unlike feature 005's projection, almost nothing here is *computed*. The
 * package's own results are retained whole and read where they are drawn, so a
 * figure on a screen has exactly one place it can have come from. What this
 * file does add is what the canvas draws over those results and the package
 * does not publish as a field: the shares of the stacked damage bar, the four
 * range bands, and the shot convergence. Each is a proportion of, or a package
 * call over, amounts stated on the same screen. It also names the meaning the
 * package leaves in a sentinel — an `Infinity` time-to-drain becomes a state,
 * so that no formatter is ever handed one (constitution II and IV).
 *
 * `design/canvas-contract.md` is what settles scope: the package fields no
 * canvas draws are not selected at all, so nothing downstream can blank, dash
 * or zero one.
 */
export interface Offence {
  /** The exact `weaponMetrics()` result, retained unchanged. */
  readonly build: BuildWeaponMetrics;
  /** The exact returned weapons, in package order, neither sorted nor merged. */
  readonly weapons: readonly FittedWeaponMetrics[];
  /** What the collection means. Never inferred from `weapons.length`. */
  readonly collection: CollectionMeaning;
  /** The four drawn capacitor fields, and what the duration means. */
  readonly capacitor: Capacitor;
  /** The burst total split into the shares canvas 1c's stacked bar draws. */
  readonly damageSegments: readonly DamageSegment[];
  /** What the enabled weapons land at each of the canvas's four distances. */
  readonly rangeBands: readonly RangeBand[];
  /** Where those weapons' shots go, or why the hull's gunsight could not place them. */
  readonly convergence: Convergence;
}

/**
 * One segment of the canvas's kinetic-against-thermal bar (@631446).
 *
 * The bar partitions *conventional* damage, so anti-xeno is not a segment: the
 * package documents it as an overlay on that damage rather than a share of it,
 * and a bar that gave it a slice would be describing a total nobody fires.
 * A type the build does not deal at all gets no segment, which is why the
 * canvas's sample draws two rather than six.
 */
export interface DamageSegment {
  readonly type: ConventionalDamageType;
  /** The package's own amount, in damage per second. */
  readonly amount: number;
  /** That amount over the conventional total, in `[0, 1]` — the segment's width. */
  readonly share: number;
}

/** The damage types that partition conventional damage, in the package's field order. */
export type ConventionalDamageType = Exclude<keyof DamageSplit, 'antiXeno'>;

/** One of canvas 1c's `DPS BY RANGE BAND` rows (@633215). */
export interface RangeBand {
  /** The distance to the target, in metres. */
  readonly metres: number;
  /** What the enabled weapons together land there, in damage per second. */
  readonly damagePerSecond: number;
  /**
   * That figure over the strongest band's, in `[0, 1]` — the row's bar.
   *
   * `null` where the strongest band is itself zero: there is then nothing for
   * the four to be read against, and an empty track reads as a figure of
   * nothing, which is a different statement (`spec.md`, Edge Cases).
   */
  readonly fill: number | null;
}

/**
 * What an empty — or a populated — weapon collection actually says.
 *
 * Three states and not a boolean, because "no weapons fitted" and "we could not
 * tell what is fitted" are different answers and a screen that ran them
 * together would claim something about the build that nobody checked.
 */
export type CollectionMeaning = 'populated' | 'noFittedWeapons' | 'coverageUnavailable';

/**
 * The weapons capacitor, at the allocation it was read under.
 *
 * Four of the six returned fields, because four is what the canvases draw.
 * `netDrainRate` and the package's echoed `weaponsPips` are not selected at
 * all — the rule feature 005 set for `headroom`, `utilisation` and
 * `withinBudget`.
 */
export interface Capacitor {
  /**
   * Megajoules, which the screen writes `MW` after.
   *
   * The projection carries the package's figure and its real unit; the block
   * that draws it takes the game's unit for a capacitor pool instead, so that
   * this reading and the outfitting panel's agree (ruled 2026-08-27,
   * `spec.md` FR-006). Nothing is converted on the way — the two units name
   * one number.
   */
  readonly capacity: number;
  /** Megajoules per second at the read allocation. */
  readonly rechargeRate: number;
  /** Megajoules per second the firing load sustains. */
  readonly sustainedEnergyPerSecond: number;
  /** What `timeToDrain` means. */
  readonly endurance: Endurance;
  /** The WEP allocation the four figures above were read at. */
  readonly allocation: number;
  /**
   * The draw and the recharge over the larger of the two, in `[0, 1]`.
   *
   * The canvas gives those two rows a bar each and the other two none: draw
   * and recharge are the same quantity in the same unit and which is larger is
   * the question the block answers, while a stored capacity and a duration
   * share a scale with nothing beside them.
   *
   * `null` for both where the larger is itself zero — a nothing-against-nothing
   * track reads as a figure of nothing, which is a different statement — and
   * worked out here rather than on the screen, because a fill is two package
   * figures divided and the projection is the one place allowed to do that
   * (FR-009, `design/canvas-contract.md`, review note 6).
   */
  readonly drawFill: number | null;
  readonly rechargeFill: number | null;
}

/**
 * What `timeToDrain` means, so that `Infinity` never leaves this file as a
 * number.
 *
 * `sustained` says the recharge keeps pace. It does not claim the weapons can
 * fire, and it is not a duration.
 */
export type Endurance =
  | { readonly kind: 'finite'; readonly seconds: number }
  | { readonly kind: 'immediate' }
  | { readonly kind: 'sustained' };

/**
 * Read the build's weapon output and weapons capacitor, once.
 *
 * `weaponsPips` is feature 005's WEP allocation, passed to the package
 * unchanged: that store already holds pips on the game's own half step in the
 * package's `[0, 4]` range, so there is nothing to convert and nothing to get
 * wrong.
 */
export function projectOffence(
  loadout: ShipLoadout,
  coverage: HardpointCoverage,
  weaponsPips: number,
): Offence {
  const metrics = BuildMetrics.of(loadout);
  const build = metrics.weaponMetrics();
  const capacitor = metrics.weaponsCapacitorMetrics({ weaponsPips });
  return Object.freeze({
    build,
    weapons: build.weapons,
    collection: collectionMeaning(build.weapons, coverage),
    capacitor: projectCapacitor(capacitor, weaponsPips),
    damageSegments: projectDamageSegments(build.total.damageByType),
    rangeBands: projectRangeBands(build.weapons),
    convergence: projectConvergence(loadout.shipSymbol, build.weapons),
  });
}

/**
 * The distances both canvases head their range-band rows with.
 *
 * Four fixed distances, in metres, exactly as the canvas draws them. They are a
 * property of the drawing rather than of the build — the canvas asks what this
 * loadout does at these four ranges, and every hull is asked the same four.
 *
 * Re-read from the 2026-08-26 revision, which heads the rows `500 m`,
 * `1,000 m`, `2,000 m` and `3,000 m` in canvas 1c and canvas 1d alike. The
 * earlier `1,200`/`1,800` pair was read off the revision before it.
 */
export const RANGE_BANDS = [500, 1000, 2000, 3000] as const;

/** The types that partition conventional damage, in the package's own field order. */
const CONVENTIONAL_DAMAGE_TYPES = [
  'kinetic',
  'thermal',
  'explosive',
  'caustic',
  'absolute',
  'unclassified',
] as const satisfies readonly ConventionalDamageType[];

/**
 * Split the burst total into the segments the canvas's bar draws.
 *
 * The amounts are the package's; only the widths are worked out here, and each
 * is that amount over the sum of the amounts drawn beside it. Nothing is
 * rounded and nothing is normalised against a scale of this application's
 * choosing: a bar whose segments did not add to the whole would be measuring
 * something the legend beside it does not say.
 */
export function projectDamageSegments(split: DamageSplit): readonly DamageSegment[] {
  const amounts = CONVENTIONAL_DAMAGE_TYPES.map((type) => ({ type, amount: split[type] ?? 0 }));
  const total = amounts.reduce((sum, { amount }) => sum + amount, 0);
  if (total <= 0) {
    return [];
  }
  return amounts
    .filter(({ amount }) => amount > 0)
    .map(({ type, amount }) => ({ type, amount, share: amount / total }));
}

/**
 * What the enabled weapons land at each of the canvas's four distances.
 *
 * The attenuation is the package's `damageFalloff`, asked once per weapon per
 * distance; this file multiplies that factor by the weapon's own damage per
 * second and adds the results up, which is the same addition the package
 * already performs for the build total at point-blank range. Disabled weapons
 * are left out for the reason the package leaves them out of its totals: they
 * are not firing.
 *
 * The bar beside each figure is that figure over the strongest band's, so the
 * four are read against each other rather than against a ceiling nobody stated.
 */
export function projectRangeBands(weapons: readonly FittedWeaponMetrics[]): readonly RangeBand[] {
  const firing = weapons.filter((weapon) => weapon.enabled);
  const bands = RANGE_BANDS.map((metres) => ({
    metres,
    damagePerSecond: firing.reduce(
      (total, weapon) =>
        total +
        weapon.metrics.damagePerSecond *
          damageFalloff(
            { maximumRange: weapon.maximumRange, falloffRange: weapon.falloffRange },
            metres,
          ),
      0,
    ),
  }));

  const strongest = Math.max(...bands.map((band) => band.damagePerSecond), 0);
  return bands.map((band) => ({
    ...band,
    fill: strongest > 0 ? band.damagePerSecond / strongest : null,
  }));
}

/**
 * What the returned collection says about the build.
 *
 * An empty list is only ever `noFittedWeapons` when feature 002 confirms the
 * hardpoints are empty: the package's weapon list is the set of weapons it
 * could measure, which is not the set of mounts that carry a module, so an
 * empty list on its own says nothing.
 *
 * Unavailable coverage *qualifies* a populated collection rather than replacing
 * it — the weapons the package did return are still real, and the qualification
 * says only that completeness is unknown.
 */
export function collectionMeaning(
  weapons: readonly FittedWeaponMetrics[],
  coverage: HardpointCoverage,
): CollectionMeaning {
  if (coverage.kind === 'unavailable') {
    return 'coverageUnavailable';
  }
  return weapons.length === 0 && coverage.kind === 'confirmedEmpty'
    ? 'noFittedWeapons'
    : 'populated';
}

/** The four drawn fields, the duration's meaning, and the allocation they were read at. */
export function projectCapacitor(metrics: WeaponsCapacitorMetrics, allocation: number): Capacitor {
  const load = Math.max(metrics.sustainedEnergyPerSecond, metrics.rechargeRate);
  const against = (rate: number): number | null => (load > 0 ? rate / load : null);

  return {
    capacity: metrics.capacity,
    rechargeRate: metrics.rechargeRate,
    sustainedEnergyPerSecond: metrics.sustainedEnergyPerSecond,
    endurance: projectEndurance(metrics.timeToDrain),
    allocation,
    drawFill: against(metrics.sustainedEnergyPerSecond),
    rechargeFill: against(metrics.rechargeRate),
  };
}

/**
 * Which of the three things `timeToDrain` is saying.
 *
 * Each meaning is read off the one field, and a zero is never treated as an
 * absence: the package returns `0` when a positive draw meets no capacity, and
 * that is a statement rather than a missing answer. No cause is attached to
 * either sentinel — the package documents several ways to reach one and does
 * not say which applied.
 */
export function projectEndurance(timeToDrain: number): Endurance {
  if (timeToDrain === Infinity) {
    return { kind: 'sustained' };
  }
  return timeToDrain === 0 ? { kind: 'immediate' } : { kind: 'finite', seconds: timeToDrain };
}
