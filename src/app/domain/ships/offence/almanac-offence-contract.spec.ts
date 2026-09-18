import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { HARDPOINT_MODULES } from '@elite-dangerous-almanac/core/ships/modules-hardpoint';
import { weaponMetrics } from '@elite-dangerous-almanac/core/ships/weapons';
import {
  OFFENCE_DEFAULT_SLOTS,
  OFFENCE_STATE_SLOTS,
  OFFENCE_WEAPONS,
  allDisabledBuild,
  drainingBuild,
  everyStateBuild,
  noWeaponsBuild,
  partlyDisabledBuild,
  populatedBuild,
} from './offence.fixtures';

/**
 * The package contract this feature projects.
 *
 * Narrow on purpose. This is not a characterization of the Almanac — that is
 * the package's own suite's job. What is pinned here is the handful of shapes
 * feature 007 would silently misread if a release changed them: which fields
 * exist, which of them mean "there is nothing to say", and which sentinel
 * carries that meaning. An absent `unclassified` amount, an undefined range or
 * piercing member and an `Infinity` time-to-drain are all different, and a
 * screen that confused any two would say something the package did not. No
 * article in the pinned catalogue deals unclassified damage, so the absence is
 * all this suite can pin about it.
 *
 * Only fields this feature reads are pinned. Ammunition and the projectile
 * boundaries are on the list no canvas draws, so nothing here can misread
 * them, and holding a release to their shape would fail this build over a
 * change that cannot reach a screen.
 */
describe('the Almanac contract for weapon output and the weapons capacitor', () => {
  describe('weaponMetrics()', () => {
    it('publishes a weapon collection beside exactly the ten build totals', () => {
      const metrics = BuildMetrics.of(populatedBuild()).weaponMetrics();

      expect(Object.keys(metrics.total).sort()).toEqual(
        [
          'damageByType',
          'damagePerSecond',
          'energyPerSecond',
          'heatPerSecond',
          'powerDraw',
          'sustainedDamageByType',
          'sustainedDamagePerSecond',
          'sustainedEnergyPerSecond',
          'sustainedHeatPerSecond',
          'thermalLoad',
        ].sort(),
      );
      expect(metrics.weapons.length).toBeGreaterThan(0);
    });

    it('returns one entry per fitted weapon, carrying its exact slot key', () => {
      const metrics = BuildMetrics.of(populatedBuild()).weaponMetrics();

      expect(metrics.weapons.map((weapon) => weapon.slot)).toEqual([...OFFENCE_DEFAULT_SLOTS]);
      for (const weapon of metrics.weapons) {
        expect(typeof weapon.symbol).toBe('string');
        expect(typeof weapon.name).toBe('string');
        expect(typeof weapon.enabled).toBe('boolean');
      }
    });

    it('publishes the fourteen per-weapon metrics, including the continuous flag', () => {
      const weapon = BuildMetrics.of(populatedBuild()).weaponMetrics().weapons[0];

      for (const field of [
        'damagePerShot',
        'rateOfFire',
        'sustainedRateOfFire',
        'damagePerSecond',
        'sustainedDamagePerSecond',
        'energyPerSecond',
        'sustainedEnergyPerSecond',
        'heatPerSecond',
        'sustainedHeatPerSecond',
        'thermalLoad',
        'powerDraw',
      ] as const) {
        expect(Number.isFinite(weapon.metrics[field])).toBe(true);
      }
      expect(typeof weapon.metrics.continuous).toBe('boolean');
      expect(weapon.metrics.damageByType).toBeDefined();
      expect(weapon.metrics.sustainedDamageByType).toBeDefined();
    });

    it('keeps a switched-off weapon in the list and out of the totals', () => {
      const stock = BuildMetrics.of(populatedBuild()).weaponMetrics();
      const metrics = BuildMetrics.of(partlyDisabledBuild()).weaponMetrics();
      const disabled = metrics.weapons.find((weapon) => weapon.slot === OFFENCE_DEFAULT_SLOTS[0]);

      expect(metrics.weapons).toHaveLength(stock.weapons.length);
      expect(disabled?.enabled).toBe(false);
      // Its own metrics are still measured — it is the totals the package omits it from.
      expect(disabled?.metrics.damagePerSecond).toBeGreaterThan(0);
      expect(metrics.total.damagePerSecond).toBeLessThan(stock.total.damagePerSecond);
    });

    it('totals an all-disabled build at exact zero, with every row still returned', () => {
      const metrics = BuildMetrics.of(allDisabledBuild()).weaponMetrics();

      expect(metrics.weapons).toHaveLength(OFFENCE_DEFAULT_SLOTS.length);
      expect(metrics.weapons.every((weapon) => weapon.enabled)).toBe(false);
      expect(metrics.total.damagePerSecond).toBe(0);
      expect(metrics.total.damageByType.thermal).toBe(0);
    });

    it('returns an empty collection and zeroed totals for a hull with no weapons', () => {
      const metrics = BuildMetrics.of(noWeaponsBuild()).weaponMetrics();

      expect(metrics.weapons).toEqual([]);
      expect(metrics.total.damagePerSecond).toBe(0);
      expect(metrics.total.sustainedDamagePerSecond).toBe(0);
    });
  });

  describe('the damage split', () => {
    it('always carries the six required amounts', () => {
      const split = BuildMetrics.of(populatedBuild()).weaponMetrics().total.damageByType;

      for (const type of [
        'kinetic',
        'thermal',
        'explosive',
        'caustic',
        'absolute',
        'antiXeno',
      ] as const) {
        expect(Number.isFinite(split[type])).toBe(true);
      }
    });

    it('omits unclassified entirely rather than reporting it as zero', () => {
      const weapon = BuildMetrics.of(populatedBuild()).weaponMetrics().weapons[0];

      expect('unclassified' in weapon.metrics.damageByType).toBe(false);
    });

    it('reports no unclassified amount anywhere in the pinned catalogue', () => {
      // The claim the comment above makes, as an assertion. The single-article
      // check above says one weapon omits the field; this says the catalogue
      // gives this suite nothing to pin an unclassified amount against, and it
      // fails loudly the day a release deals the type again.
      const dealt = HARDPOINT_MODULES.filter(
        (module) => 'unclassified' in weaponMetrics(module).damageByType,
      );

      expect(dealt.map((module) => module.symbol)).toEqual([]);
    });

    it('deals a caustic amount from exactly one article', () => {
      // Which is why one fixture carries the caustic state. If a release
      // spreads the type across more articles, the fixture stops being the
      // whole of what the catalogue says and this says so.
      const dealt = HARDPOINT_MODULES.filter(
        (module) => weaponMetrics(module).damageByType.caustic > 0,
      );

      expect(dealt.map((module) => module.symbol)).toEqual([OFFENCE_WEAPONS.caustic]);
    });

    it('carries caustic beside the explosive share of the same shot', () => {
      const weapon = weaponAt('caustic');

      expect(weapon.metrics.damageByType.caustic).toBeGreaterThan(0);
      expect(weapon.metrics.sustainedDamageByType.caustic).toBeGreaterThan(0);
      expect(weapon.metrics.damageByType.explosive).toBeGreaterThan(0);
    });

    it('carries anti-xeno beside conventional damage rather than instead of it', () => {
      const split = weaponAt('antiXeno').metrics.damageByType;

      expect(split.antiXeno).toBeGreaterThan(0);
      expect(split.kinetic).toBeGreaterThan(0);
    });
  });

  describe('the sparse per-weapon fields', () => {
    it('returns both range fields for a weapon that has them', () => {
      const weapon = weaponAt('kinetic');

      expect(weapon.maximumRange).toBeGreaterThan(0);
      expect(weapon.falloffRange).toBeGreaterThan(0);
    });

    it('leaves both range fields undefined rather than zero when there are none', () => {
      const weapon = weaponAt('explosive');

      expect(weapon.maximumRange).toBeUndefined();
      expect(weapon.falloffRange).toBeUndefined();
    });

    it('leaves armour piercing undefined rather than zero when there is none', () => {
      expect(weaponAt('noPiercing').armourPiercing).toBeUndefined();
      expect(weaponAt('kinetic').armourPiercing).toBeGreaterThan(0);
    });
  });

  describe('weaponsCapacitorMetrics()', () => {
    it('publishes six fields and echoes the allocation it was given', () => {
      const metrics = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 2 });

      expect(Object.keys(metrics).sort()).toEqual(
        [
          'capacity',
          'netDrainRate',
          'rechargeRate',
          'sustainedEnergyPerSecond',
          'timeToDrain',
          'weaponsPips',
        ].sort(),
      );
      expect(metrics.weaponsPips).toBe(2);
    });

    it('accepts the half-pip step the game and feature 005 both use', () => {
      const half = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 2.5 });
      const whole = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 2 });

      expect(half.rechargeRate).toBeGreaterThan(whole.rechargeRate);
    });

    it('rejects an allocation outside its own range rather than clamping it', () => {
      const build = populatedBuild();

      expect(() => BuildMetrics.of(build).weaponsCapacitorMetrics({ weaponsPips: -1 })).toThrow();
      expect(() => BuildMetrics.of(build).weaponsCapacitorMetrics({ weaponsPips: 5 })).toThrow();
    });

    it('reports infinite endurance, not a large number, when recharge keeps pace', () => {
      const metrics = BuildMetrics.of(populatedBuild()).weaponsCapacitorMetrics({ weaponsPips: 4 });

      expect(metrics.timeToDrain).toBe(Infinity);
      expect(metrics.netDrainRate).toBe(0);
    });

    it('reports a finite endurance when the firing load outruns recharge', () => {
      const metrics = BuildMetrics.of(drainingBuild()).weaponsCapacitorMetrics({ weaponsPips: 0 });

      expect(Number.isFinite(metrics.timeToDrain)).toBe(true);
      expect(metrics.timeToDrain).toBeGreaterThan(0);
      expect(metrics.sustainedEnergyPerSecond).toBeGreaterThan(metrics.rechargeRate);
    });

    it('still answers for a build with no weapons at all', () => {
      const metrics = BuildMetrics.of(noWeaponsBuild()).weaponsCapacitorMetrics({ weaponsPips: 2 });

      expect(metrics.capacity).toBeGreaterThan(0);
      expect(metrics.sustainedEnergyPerSecond).toBe(0);
      expect(metrics.timeToDrain).toBe(Infinity);
    });
  });
});

/** The one edge-state weapon this assertion is about, from the shared build. */
function weaponAt(state: keyof typeof OFFENCE_STATE_SLOTS) {
  const slot = OFFENCE_STATE_SLOTS[state];
  const weapon = BuildMetrics.of(everyStateBuild())
    .weaponMetrics()
    .weapons.find((entry) => entry.slot === slot);
  if (weapon === undefined) {
    throw new Error(
      `The installed Almanac no longer measures a weapon in "${slot}". The fixture for ` +
        `"${state}" needs a new article from the package.`,
    );
  }
  return weapon;
}
