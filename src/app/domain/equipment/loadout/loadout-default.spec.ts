import { getSuitByFamily } from '@elite-dangerous-almanac/core/equipment/suits';
import type { EquipmentLoadout } from '../loadout-link/equipment-loadout';
import { atSuitDefault } from './loadout-default';
import { fitModification, fitWeapon, newLoadout, setSuitGrade } from './loadout-edit';

/**
 * What a record is worth keeping is decided here, as it is for a build.
 *
 * The question is asked of the loadout alone, so a loadout that reaches the
 * bench by a suit chosen at the gate, by a link or by a journal event gets the
 * same answer (024/FR-002).
 */

const RIFLE = 'wpn_m_assaultrifle_plasma_fauto';

const dominator = (): EquipmentLoadout => newLoadout('tacticalsuit')!;

/** The grades the package publishes for a suit, lowest first. */
const publishedGrades = (suitFamily: string): readonly number[] =>
  Object.keys(getSuitByFamily(suitFamily)!.grades)
    .map(Number)
    .sort((one, other) => one - other);

describe('suit default loadout', () => {
  it('reports the loadout the bench starts at its suit’s default', () => {
    // The comparison is defined as the fingerprint of `newLoadout`'s own
    // output, so this says what a default loadout holds rather than comparing
    // that function with itself: the suit at the lowest grade the package
    // publishes for it, no weapon on any mount and no modification fitted. That
    // the bench hands a Commander this loadout rather than some other one is
    // the drift `loadout.store.spec.ts` walks every published suit for.
    const started = dominator();

    expect(atSuitDefault(started)).toBe(true);
    expect(started.suitGrade).toBe(publishedGrades('tacticalsuit')[0]);
    expect(started.weapons.every((weapon) => weapon === null)).toBe(true);
    expect(started.suitModifications.every((slot) => slot === null)).toBe(true);
  });

  it('reports a fitted weapon as not at the default', () => {
    expect(atSuitDefault(fitWeapon(dominator(), 'PrimaryWeapon1', RIFLE))).toBe(false);
  });

  it('reports a fitted modification as not at the default', () => {
    expect(atSuitDefault(fitModification(dominator(), 'suit', 0, 'suit_nightvision'))).toBe(false);
  });

  it('reports a raised suit grade as not at the default', () => {
    expect(atSuitDefault(setSuitGrade(dominator(), 5))).toBe(false);
  });

  it('reports a suit family this release does not publish as not at a default', () => {
    // Answered rather than thrown: the bench starts no loadout for it, so there
    // is no default to be at and a record is owed like any other.
    const unpublished: EquipmentLoadout = { ...dominator(), suitFamily: 'stealthsuit' };

    expect(() => atSuitDefault(unpublished)).not.toThrow();
    expect(atSuitDefault(unpublished)).toBe(false);
  });
});
