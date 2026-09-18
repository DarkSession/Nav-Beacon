import { describe, expect, it } from 'vitest';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import { createEquipmentLinkCodec } from './equipment-link-codec';
import type { EquipmentLinkCodec } from './equipment-link-codec';
import {
  CURRENT_EQUIPMENT_TABLE_VERSION,
  EQUIPMENT_CODECS_BY_TABLE_VERSION,
  decodeEquipmentLinkFragment,
  encodeEquipmentLinkFragment,
} from './equipment-link-codec-loader';
import { testOnlyEquipmentTable } from './equipment-link-table.spec-helpers';
import type { EquipmentLoadout } from './equipment-loadout';

const DOMINATOR: EquipmentLoadout = {
  suitFamily: 'tacticalsuit',
  suitGrade: 5,
  suitModifications: [
    'suit_increasedshieldregen',
    'suit_improvedarmourrating',
    'suit_increasedbatterycapacity',
    'suit_nightvision',
  ],
  weapons: [
    {
      symbol: 'wpn_m_assaultrifle_plasma_fauto',
      grade: 5,
      modifications: ['weapon_clipsize', 'weapon_stability', 'weapon_scope', 'weapon_reloadspeed'],
    },
    {
      symbol: 'wpn_m_sniper_plasma_charged',
      grade: 4,
      modifications: ['weapon_range_plasma', null, 'weapon_headshotdamage_plasma', null],
    },
    { symbol: 'wpn_s_pistol_kinetic_sauto', grade: 3, modifications: [null, null, null, null] },
  ],
};

/** A second loadout, so a decode that picked the wrong table is a different answer. */
const FLIGHT_SUIT: EquipmentLoadout = {
  suitFamily: 'flightsuit',
  suitGrade: 1,
  suitModifications: [null, null, null, null],
  weapons: [null, null, null],
};

/** A map holding a version this application does not publish, beside the one it does. */
function withTestOnlyVersion(version: number): ReadonlyMap<number, EquipmentLinkCodec> {
  return new Map([
    ...EQUIPMENT_CODECS_BY_TABLE_VERSION,
    [version, createEquipmentLinkCodec(version, testOnlyEquipmentTable(version))],
  ]);
}

function expectRefusal(act: () => unknown): BuildLinkCodecError {
  let raised: unknown;
  try {
    act();
  } catch (error: unknown) {
    raised = error;
  }
  expect(raised).toBeInstanceOf(BuildLinkCodecError);
  return raised as BuildLinkCodecError;
}

describe('the equipment codec registry', () => {
  it('holds one codec for every published version and no other', () => {
    expect([...EQUIPMENT_CODECS_BY_TABLE_VERSION.keys()]).toEqual([1]);
    expect(EQUIPMENT_CODECS_BY_TABLE_VERSION.get(1)?.tableVersion).toBe(1);
    expect(EQUIPMENT_CODECS_BY_TABLE_VERSION.get(2)).toBeUndefined();
    expect(EQUIPMENT_CODECS_BY_TABLE_VERSION.get(0)).toBeUndefined();
  });

  it('names the newest published version as the current one', () => {
    // A current version is the registry's fact rather than any one table's: the
    // table each codec was built on stamps only itself.
    expect(CURRENT_EQUIPMENT_TABLE_VERSION).toBe(1);
    expect(EQUIPMENT_CODECS_BY_TABLE_VERSION.has(CURRENT_EQUIPMENT_TABLE_VERSION)).toBe(true);
  });
});

describe('reading a payload against the table it names', () => {
  it('decodes a current-version fragment to the loadout it was made from', () => {
    expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(DOMINATOR))).toEqual(DOMINATOR);
  });

  it('selects the codec the payload names', () => {
    // Version selection with no second table committed: the shipped function is
    // the one under test, and the map it is handed is the seam (design.md).
    //
    // The two fragments carry different loadouts, so each one opening on its own
    // is what says the payload chose the table rather than both landing on the
    // one answer a single codec would have given.
    const codecs = withTestOnlyVersion(2);
    const version2 = codecs.get(2)!.encodeEquipmentLinkFragment(FLIGHT_SUIT);
    const version1 = encodeEquipmentLinkFragment(DOMINATOR);

    expect(version2).not.toBe(codecs.get(1)!.encodeEquipmentLinkFragment(FLIGHT_SUIT));
    expect(decodeEquipmentLinkFragment(version2, codecs)).toEqual(FLIGHT_SUIT);
    expect(decodeEquipmentLinkFragment(version1, codecs)).toEqual(DOMINATOR);
  });

  it('refuses a version the map does not hold, naming what it read and what it carries', () => {
    const codecs = withTestOnlyVersion(2);
    const version3 = createEquipmentLinkCodec(
      3,
      testOnlyEquipmentTable(3),
    ).encodeEquipmentLinkFragment(DOMINATOR);

    const refusal = expectRefusal(() => decodeEquipmentLinkFragment(version3, codecs));
    expect(refusal.code).toBe('unsupportedTableVersion');
    expect(refusal.message).toContain('3');
    expect(refusal.message).toContain('1, 2');
  });

  it('refuses a version the shipped registry does not hold', () => {
    const version2 = createEquipmentLinkCodec(
      2,
      testOnlyEquipmentTable(2),
    ).encodeEquipmentLinkFragment(DOMINATOR);

    expect(expectRefusal(() => decodeEquipmentLinkFragment(version2)).code).toBe(
      'unsupportedTableVersion',
    );
  });
});

describe('writing a link', () => {
  it('names the current version whatever version was read', () => {
    // A link is written with the current table whatever version it arrived on,
    // so the version read and the version written differ here. The genuine
    // older-link assertion belongs to the change that mints table 2, which is
    // where the corpus gains a second version (design.md).
    const codecs = withTestOnlyVersion(2);
    const arrived = codecs.get(2)!.encodeEquipmentLinkFragment(DOMINATOR);
    const shared = encodeEquipmentLinkFragment(decodeEquipmentLinkFragment(arrived, codecs));

    expect(shared).toBe(encodeEquipmentLinkFragment(DOMINATOR));
    expect(decodeEquipmentLinkFragment(shared)).toEqual(DOMINATOR);
  });
});
