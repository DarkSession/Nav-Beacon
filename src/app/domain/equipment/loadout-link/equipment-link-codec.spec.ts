import { describe, expect, it } from 'vitest';
import { SUITS } from '@elite-dangerous-almanac/core/equipment/suits';
import { PERSONAL_WEAPONS } from '@elite-dangerous-almanac/core/equipment/weapons';
import { PERSONAL_MODIFICATIONS } from '@elite-dangerous-almanac/core/equipment/modifications';
import { RawBitWriter } from '../../build-link/build-link-bits';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import { encodeLinkBody } from '../../build-link/build-link-envelope';
import type { BuildLinkCodecErrorCode } from '../../build-link/build-link-codec-error';
import { decodeEquipmentLinkFragment, encodeEquipmentLinkFragment } from './equipment-link-codec';
import type { EquipmentLoadout } from './equipment-loadout';
import table from './equipment-link-table-1.json';

const EMPTY_SLOTS = [null, null, null, null];

const EMPTY_MOUNTS = [null, null, null];

const FLIGHT_SUIT: EquipmentLoadout = {
  suitFamily: 'flightsuit',
  suitGrade: 1,
  suitModifications: [null, null, null, null],
  weapons: EMPTY_MOUNTS,
};

/**
 * The Maverick, which offers one primary mount, holding a weapon on the second.
 *
 * The case the format was amended for: `PrimaryWeapon2` is outside this suit's
 * `mounts`, so the weapon on it is held. It is carried, it is refused by
 * nothing, and it comes back on a suit that offers the mount (FR-007, FR-018a).
 */
const HOLDING: EquipmentLoadout = {
  suitFamily: 'utilitysuit',
  suitGrade: 4,
  suitModifications: [null, null, null, null],
  weapons: [
    {
      symbol: 'wpn_m_assaultrifle_plasma_fauto',
      grade: 3,
      modifications: EMPTY_SLOTS,
    },
    {
      symbol: 'wpn_m_sniper_plasma_charged',
      grade: 5,
      modifications: ['weapon_range_plasma', null, null, null],
    },
    null,
  ],
};

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
    {
      symbol: 'wpn_s_pistol_kinetic_sauto',
      grade: 3,
      modifications: [null, null, null, null],
    },
  ],
};

/** Every mount filled and every modification slot held, which is the longest link. */
const MAXIMUM: EquipmentLoadout = {
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
      grade: 5,
      modifications: [
        'weapon_range_plasma',
        'weapon_headshotdamage_plasma',
        'weapon_accuracy_plasma',
        'weapon_clipsize',
      ],
    },
    {
      symbol: 'wpn_s_pistol_kinetic_sauto',
      grade: 5,
      modifications: [
        'weapon_range_kinetic',
        'weapon_headshotdamage_kinetic',
        'weapon_accuracy_kinetic',
        'weapon_clipsize',
      ],
    },
  ],
};

function expectRefusal(act: () => unknown, code: BuildLinkCodecErrorCode): BuildLinkCodecError {
  let raised: unknown;
  try {
    act();
  } catch (error: unknown) {
    raised = error;
  }
  expect(raised).toBeInstanceOf(BuildLinkCodecError);
  expect((raised as BuildLinkCodecError).code).toBe(code);
  return raised as BuildLinkCodecError;
}

/**
 * A body written by hand, checksummed the way the codec would have.
 *
 * Every refusal the decoder owns is about a payload that survived the envelope:
 * a truncation or a flipped character is caught by the CRC before the format is
 * read at all, so a test that only corrupts a fragment proves nothing about the
 * decoder. These are well-formed values that say something impossible.
 */
function craft(fields: readonly (readonly [value: number, width: number])[]): string {
  const writer = new RawBitWriter();
  for (const [value, width] of fields) writer.writeBits(value, width);
  return encodeLinkBody(writer.toUint8Array(), { prefix: 'e.', maxCharacters: 500 });
}

/** The widths the format is written in, as the table sizes them. */
const TABLE_VERSION = [1, 10] as const;
const SUIT = (index: number) => [index, 2] as const;
const GRADE = (grade: number) => [grade, 3] as const;
const SUIT_MODIFICATION = (value: number) => [value, 4] as const;
const WEAPON = (value: number) => [value, 4] as const;
const WEAPON_MODIFICATION = (value: number) => [value, 5] as const;

type Field = readonly [value: number, width: number];

/**
 * A whole flight-suit body: the suit at index 3, its four modification slots
 * and the catalogue's three mount fields.
 *
 * Whole rather than stopped at the field under test, because a body that runs
 * out is refused as a truncation — with the same code some of these guards
 * raise. A test on a short body would pass with the guard deleted.
 */
const flightSuit = (
  grade = 1,
  slots: readonly Field[] = fill(SUIT_MODIFICATION),
  secondary: readonly Field[] = [WEAPON(0)],
): readonly Field[] => [
  TABLE_VERSION,
  SUIT(3),
  GRADE(grade),
  ...slots,
  // Every loadout writes the catalogue's whole mount set, so the two primary
  // mounts the Flight Suit does not offer are still fields in the payload.
  WEAPON(0),
  WEAPON(0),
  ...secondary,
];

/** The Dominator at index 1: four modification slots at grade 5, and three empty mounts. */
const tacticalSuit = (slots: readonly Field[]): readonly Field[] => [
  TABLE_VERSION,
  SUIT(1),
  GRADE(5),
  ...slots,
  WEAPON(0),
  WEAPON(0),
  WEAPON(0),
];

/** A weapon on a mount: its index, its grade and all four of its slots. */
const fitted = (weapon: number, grade: number, ...slots: number[]): readonly Field[] => [
  WEAPON(weapon),
  GRADE(grade),
  ...fill(WEAPON_MODIFICATION, slots),
];

const fill = (field: (value: number) => Field, values: readonly number[] = []): readonly Field[] =>
  Array.from({ length: 4 }, (_, slot) => field(values[slot] ?? 0));

describe('equipment link codec', () => {
  it('restores a loadout from the fragment it produced', () => {
    for (const loadout of [FLIGHT_SUIT, DOMINATOR]) {
      expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(loadout))).toEqual(loadout);
    }
  });

  it('freezes the fragments the published table produces', () => {
    // Pinned rather than round-tripped: a round trip passes just as happily when
    // both directions moved together, which is exactly what a changed table
    // does. Table 1 is published, so these values are never re-pinned: a fixture
    // that moved would mean a link already shared had changed meaning.
    expect(encodeEquipmentLinkFragment(FLIGHT_SUIT)).toBe('e.T._otnWnXKrn');
    expect(encodeEquipmentLinkFragment(DOMINATOR)).toBe('e.4f@yCeG44mGCq1hcPOnHxlG');
    // Held content, pinned as an absolute encoding rather than as a round trip:
    // the sniper on `PrimaryWeapon2` is a mount the Maverick does not offer, and
    // this is the byte-for-byte proof that the payload carries it (FR-018a).
    expect(encodeEquipmentLinkFragment(HOLDING)).toBe('e.GW0Gx@v12t0ULK6p:CuX');
    // A modification in a slot a lowered grade has locked. The Dominator at
    // grade 3 unlocks two slots and keeps what is in the other two (FR-011).
    expect(encodeEquipmentLinkFragment({ ...DOMINATOR, suitGrade: 3 })).toBe(
      'e.4J@6@/Xti903ez1c5CxVoM4',
    );
  });

  it('keeps the largest loadout the format can state well inside the bound', () => {
    // The suit with the most mounts, every mount filled, every modification slot
    // held. Indices are what keep it short: the symbols alone are more than 400
    // characters, and this is the case the bound would have to fail on.
    const symbols = [
      MAXIMUM.suitFamily,
      ...MAXIMUM.suitModifications,
      ...MAXIMUM.weapons.flatMap((weapon) => [weapon?.symbol, ...(weapon?.modifications ?? [])]),
    ].filter((symbol) => symbol !== null && symbol !== undefined);

    expect(symbols.join('').length).toBeGreaterThan(400);
    expect(encodeEquipmentLinkFragment(MAXIMUM).length).toBeLessThan(40);
    expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(MAXIMUM))).toEqual(MAXIMUM);
  });

  it('carries a modification a lowered grade has locked', () => {
    // A locked slot holds what was fitted to it, and a link that dropped it
    // would restore a different loadout from the one it was made from
    // (013/US2, acceptance scenario 2).
    const lowered: EquipmentLoadout = { ...DOMINATOR, suitGrade: 3 };

    expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(lowered))).toEqual(lowered);
  });

  it('names every mount the catalogue offers, whichever suit is worn', () => {
    // One field per catalogue mount, not per mount the encoded suit offers.
    // A loadout sized to the suit could not say a weapon is held, and the
    // encoder refuses it rather than guessing which mount was left out.
    expectRefusal(
      () => encodeEquipmentLinkFragment({ ...DOMINATOR, weapons: DOMINATOR.weapons.slice(1) }),
      'invalidPayload',
    );
    expectRefusal(
      () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, weapons: [null, null] }),
      'invalidPayload',
    );
    expectRefusal(
      () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, weapons: [...EMPTY_MOUNTS, null] }),
      'invalidPayload',
    );
  });

  it('carries a weapon on a mount the worn suit does not offer', () => {
    // The Maverick offers one primary mount. The sniper on `PrimaryWeapon2` is
    // held: it is written, it is read back on the same mount with its grade and
    // its modification, and nothing about the suit refuses it (FR-007,
    // FR-018a, SC-005).
    expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(HOLDING))).toEqual(HOLDING);
  });

  it('checks a held weapon against its mount rather than against the suit', () => {
    // Holding is what the format expresses; a loadout the game could never
    // produce is still refused. A rifle on the secondary mount is refused on the
    // Flight Suit, which offers that mount, and equally on a mount no worn suit
    // offers.
    const rifle = {
      symbol: 'wpn_m_assaultrifle_plasma_fauto',
      grade: 1,
      modifications: EMPTY_SLOTS,
    };
    const pistol = { symbol: 'wpn_s_pistol_kinetic_sauto', grade: 1, modifications: EMPTY_SLOTS };

    expect(
      expectRefusal(
        () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, weapons: [null, null, rifle] }),
        'invalidPayload',
      ).slot,
    ).toBe('SecondaryWeapon');
    expect(
      expectRefusal(
        () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, weapons: [null, pistol, null] }),
        'invalidPayload',
      ).slot,
    ).toBe('PrimaryWeapon2');
  });

  it('refuses a weapon on a mount it does not fit', () => {
    // The package says which kind each weapon takes; a rifle on the secondary
    // mount is not a loadout the game can hold.
    const misfitted: EquipmentLoadout = {
      ...FLIGHT_SUIT,
      weapons: [
        null,
        null,
        {
          symbol: 'wpn_m_assaultrifle_plasma_fauto',
          grade: 1,
          modifications: EMPTY_SLOTS,
        },
      ],
    };

    expectRefusal(() => encodeEquipmentLinkFragment(misfitted), 'invalidPayload');
  });

  it('refuses a grade the item does not publish', () => {
    expectRefusal(
      () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, suitGrade: 5 }),
      'invalidPayload',
    );
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...FLIGHT_SUIT,
          weapons: [
            null,
            null,
            { symbol: 'wpn_s_pistol_kinetic_sauto', grade: 9, modifications: EMPTY_SLOTS },
          ],
        }),
      'invalidPayload',
    );
  });

  it('refuses a loadout that names a different number of slots than an item has', () => {
    // A fifth entry, empty, so that what refuses it is the count and not what is
    // in it: an encoder that wrote the extra field would produce a fragment its
    // own decoder reads as trailing data.
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...DOMINATOR,
          suitModifications: [...DOMINATOR.suitModifications, null],
        }),
      'invalidPayload',
    );
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...DOMINATOR,
          suitModifications: DOMINATOR.suitModifications.slice(1),
        }),
      'invalidPayload',
    );
  });

  it('refuses an identity the table does not hold', () => {
    expectRefusal(
      () => encodeEquipmentLinkFragment({ ...FLIGHT_SUIT, suitFamily: 'stealthsuit' }),
      'unknownIdentity',
    );
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...FLIGHT_SUIT,
          weapons: [
            null,
            null,
            { symbol: 'wpn_s_pistol_thargoid', grade: 1, modifications: EMPTY_SLOTS },
          ],
        }),
      'unknownIdentity',
    );
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...FLIGHT_SUIT,
          suitModifications: ['suit_invisibility', null, null, null],
        }),
      'unknownIdentity',
    );
    // A weapon recipe on the suit is an identity the suit's own table does not
    // hold, which is the same refusal for the same reason.
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...FLIGHT_SUIT,
          suitModifications: ['weapon_scope', null, null, null],
        }),
      'unknownIdentity',
    );
  });

  it('claims only the fragments its own prefix opens', () => {
    // A ship link and a loadout link share the fragment, so each codec reads
    // only what its own prefix opens.
    expectRefusal(() => decodeEquipmentLinkFragment('b.vz,jdQ_4'), 'unsupportedEnvelope');
    expectRefusal(() => decodeEquipmentLinkFragment('#anchor'), 'unsupportedEnvelope');
  });

  it('accepts a leading fragment marker', () => {
    const fragment = encodeEquipmentLinkFragment(DOMINATOR);

    expect(decodeEquipmentLinkFragment(`#${fragment}`)).toEqual(DOMINATOR);
  });

  it('refuses a body that was changed after it was written', () => {
    const fragment = encodeEquipmentLinkFragment(DOMINATOR);
    const flipped = `${fragment.slice(0, 4)}${fragment[4] === 'A' ? 'B' : 'A'}${fragment.slice(5)}`;

    expectRefusal(() => decodeEquipmentLinkFragment(flipped), 'integrityCheckFailed');
    expectRefusal(() => decodeEquipmentLinkFragment('e.'), 'invalidEncoding');
    expectRefusal(() => decodeEquipmentLinkFragment('e.!!!!'), 'invalidEncoding');
  });

  it('refuses every truncation of a fragment it produced', () => {
    const fragment = encodeEquipmentLinkFragment(DOMINATOR);

    for (let length = 3; length < fragment.length; length += 1) {
      let raised: unknown;
      try {
        decodeEquipmentLinkFragment(fragment.slice(0, length));
      } catch (error: unknown) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(BuildLinkCodecError);
    }
  });

  it('restores a modification to the slot it was fitted in', () => {
    // Slot position is what a grade unlocks, so a cleared slot stays cleared and
    // what follows it does not move up into it. A list that closed up would turn
    // a locked slot's modification into an unlocked one on the way through a
    // link (013/US2, acceptance scenario 2).
    const holed: EquipmentLoadout = {
      ...DOMINATOR,
      suitModifications: [null, 'suit_nightvision', null, 'suit_improvedradar'],
    };

    expect(decodeEquipmentLinkFragment(encodeEquipmentLinkFragment(holed))).toEqual(holed);
  });

  it('refuses a modification in a slot the item never unlocks', () => {
    // The Flight Suit has one grade and it unlocks no modification slot at all,
    // so a modified Flight Suit is not a Commander the game can produce. This is
    // not the locked slot of the test above: that slot opens at a higher grade,
    // and this one never opens.
    const modified: EquipmentLoadout = {
      ...FLIGHT_SUIT,
      suitModifications: ['suit_nightvision', null, null, null],
    };

    expect(expectRefusal(() => encodeEquipmentLinkFragment(modified), 'invalidPayload').slot).toBe(
      'suit',
    );
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, fill(SUIT_MODIFICATION, [12])))),
        'invalidPayload',
      ).slot,
    ).toBe('suit');
  });

  it('refuses an item holding one modification twice', () => {
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...DOMINATOR,
          suitModifications: ['suit_nightvision', 'suit_nightvision', null, null],
        }),
      'invalidPayload',
    );
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(tacticalSuit(fill(SUIT_MODIFICATION, [1, 1])))),
        'invalidPayload',
      ).slot,
    ).toBe('suit');
  });

  it('refuses a weapon modification the weapon does not take', () => {
    // Greater Range is three recipes, one per damage technology, and the package
    // settles which one a weapon takes. A plasma rifle does not take the kinetic
    // recipe, and a link that carried one would state a loadout the game cannot
    // hold.
    expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...FLIGHT_SUIT,
          weapons: [
            null,
            null,
            {
              symbol: 'wpn_s_pistol_kinetic_sauto',
              grade: 1,
              modifications: ['weapon_range_plasma', null, null, null],
            },
          ],
        }),
      // A recipe the catalogue holds, on an item that cannot hold it: the same
      // refusal as a rifle on a sidearm mount, not an unknown identity.
      'invalidPayload',
    );
  });

  it('names the mount a refusal is about', () => {
    // A refusal a Commander reads is built from the code and the slot it names,
    // so a codec that raised the code alone could not say which mount failed
    // (013/FR-021).
    const refusal = expectRefusal(
      () =>
        encodeEquipmentLinkFragment({
          ...DOMINATOR,
          weapons: [
            DOMINATOR.weapons[0]!,
            { symbol: 'wpn_s_pistol_kinetic_sauto', grade: 1, modifications: EMPTY_SLOTS },
            DOMINATOR.weapons[2]!,
          ],
        }),
      'invalidPayload',
    );

    expect(refusal.slot).toBe('PrimaryWeapon2');
  });

  it('refuses a body that says something the catalogue cannot hold', () => {
    // A table version nothing here can read.
    expectRefusal(() => decodeEquipmentLinkFragment(craft([[2, 10]])), 'unsupportedTableVersion');
    // A grade the suit does not publish: the flight suit publishes grade 1 alone.
    expect(
      expectRefusal(() => decodeEquipmentLinkFragment(craft(flightSuit(5))), 'invalidPayload').slot,
    ).toBe('suit');
    // A modification index past the end of the suit's own recipes.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, fill(SUIT_MODIFICATION, [15])))),
        'unknownIdentity',
      ).slot,
    ).toBe('suit');
    // A weapon index past the end of the catalogue.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, undefined, fitted(12, 1)))),
        'unknownIdentity',
      ).slot,
    ).toBe('SecondaryWeapon');
    // A rifle on the mount that takes a sidearm: index 2 is a primary weapon.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, undefined, fitted(2, 1)))),
        'invalidPayload',
      ).slot,
    ).toBe('SecondaryWeapon');
    // A recipe this release does not publish at all.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, undefined, fitted(1, 1, 18)))),
        'unknownIdentity',
      ).slot,
    ).toBe('SecondaryWeapon');
    // A recipe the weapon does not take: value 5 is `weapon_range_plasma`, and
    // the weapon at index 0 is the kinetic pistol.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, undefined, fitted(1, 1, 5)))),
        'invalidPayload',
      ).slot,
    ).toBe('SecondaryWeapon');
    // A grade the weapon does not publish.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft(flightSuit(1, undefined, fitted(1, 6)))),
        'invalidPayload',
      ).slot,
    ).toBe('SecondaryWeapon');
    // A body that says everything the format asks for and then keeps going.
    expect(
      expectRefusal(
        () => decodeEquipmentLinkFragment(craft([...flightSuit(), [1, 8]])),
        'invalidPayload',
      ).slot,
    ).toBeNull();
  });

  it('refuses a body that is not exactly as long as the format it states', () => {
    // The bit reader is shared with the ship codec, which catches these by
    // re-serialising what it decoded and comparing bytes. This codec does not
    // re-serialise, so the reader's own bounds are the whole of its defence and
    // they are checked here: one loadout has one spelling, and a body that runs
    // short is refused rather than read as zeros.
    const whole = flightSuit();

    // A whole spare byte after the last field.
    expectRefusal(() => decodeEquipmentLinkFragment(craft([...whole, [0, 8]])), 'invalidPayload');
    // Ones stuffed into the five bits the last byte has spare.
    expectRefusal(() => decodeEquipmentLinkFragment(craft([...whole, [31, 5]])), 'invalidPayload');
    // A body that stops in the middle of the suit's modification slots.
    expectRefusal(
      () => decodeEquipmentLinkFragment(craft([TABLE_VERSION, SUIT(3), GRADE(1)])),
      'invalidPayload',
    );
  });

  it('describes the catalogue the package publishes', () => {
    // The table is generated, so this is the check that it still describes the
    // installed release rather than one it was generated from long ago. Every
    // column the codec refuses by is checked, not only the identities: a release
    // that moved a suit's mount count or a weapon's kind would leave the table
    // silently wrong about what it turns away.
    const suits = Object.values(SUITS);
    const weapons = Object.values(PERSONAL_WEAPONS);
    const grades = (item: { grades: Record<string, unknown> }): number[] =>
      Object.keys(item.grades)
        .map((grade) => Number(grade))
        .sort((left, right) => left - right);
    const unlockedSlots = (item: {
      grades: Record<string, { modificationSlots: number }>;
    }): number => Math.max(...Object.values(item.grades).map((grade) => grade.modificationSlots));

    expect(table.SUITS).toEqual(suits.map((suit) => suit.family));
    expect(table.SUIT_GRADES).toEqual(suits.map(grades));
    expect(table.SUIT_SLOTS).toEqual(suits.map(unlockedSlots));
    // Frontier's own journal `SlotName`s, in the order the game lists them.
    expect(table.MOUNTS).toEqual(['PrimaryWeapon1', 'PrimaryWeapon2', 'SecondaryWeapon']);
    expect(table.MOUNT_SLOTS).toBe(table.MOUNTS.length);
    expect(table.MOUNT_KINDS).toEqual(['primary', 'primary', 'secondary']);
    // Every mount any suit carries is in the set, and every entry in the set is
    // carried by some suit: a mount missing from it could not be encoded at all.
    expect(new Set(suits.flatMap((suit) => suit.mounts.map((mount) => mount.key)))).toEqual(
      new Set(table.MOUNTS),
    );
    expect(table.SUIT_MOUNTS).toEqual(
      suits.map((suit) => suit.mounts.map((mount) => table.MOUNTS.indexOf(mount.key))),
    );
    expect(table.WEAPONS).toEqual(weapons.map((weapon) => weapon.symbol));
    expect(table.WEAPON_GRADES).toEqual(weapons.map(grades));
    expect(table.WEAPON_SLOTS).toEqual(weapons.map(unlockedSlots));
    expect(table.WEAPON_MOUNTS).toEqual(weapons.map((weapon) => weapon.slot));

    const recipesFor = (target: string): string[] =>
      Object.entries(PERSONAL_MODIFICATIONS)
        .filter(([, recipe]) => recipe.target === target)
        .map(([symbol]) => symbol);

    expect(table.SUIT_MODIFICATIONS).toEqual(recipesFor('suit'));
    expect(table.WEAPON_MODIFICATIONS).toEqual(recipesFor('weapon'));
    // Which of the three technology-paired recipes each weapon takes. The
    // generator asks `resolvePersonalModificationForWeapon`; this asks the
    // weapon's own `engineeringType`, so the two agreeing is a check and not a
    // restatement.
    expect(table.WEAPON_MODIFICATION_SETS).toEqual(
      weapons.map((weapon) =>
        table.WEAPON_MODIFICATIONS.flatMap((symbol, index) => {
          const technology = /_(kinetic|laser|plasma)$/.exec(symbol)?.[1];
          return technology === undefined || technology === weapon.engineeringType ? [index] : [];
        }),
      ),
    );
    expect(table.MODIFICATION_SLOTS).toBe(
      Math.max(
        ...[...suits, ...weapons].flatMap((item) =>
          Object.values(item.grades).map((grade) => grade.modificationSlots),
        ),
      ),
    );
  });

  it('pins the published table content hash', async () => {
    // The table is published, so it is never written again: a changed hash
    // belongs under the next table number rather than over this one, and the
    // generator refuses the write. The hash is both pinned and recomputed here:
    // the literal catches a regenerated table, and the recomputation catches a
    // payload edited under a hash that was left alone.
    const { $generated, ...payload } = table;

    expect($generated.tableVersion).toBe(1);
    expect($generated.contentHash).toBe(
      '7e7b425b9eb863ebdc7f0c5954c728166f9e1d2184f88ba0d6d6798faa8b616c',
    );
    expect(await canonicalHash(payload)).toBe($generated.contentHash);
  });
});

/** Mirrors the canonicalisation in `scripts/generate-equipment-link-codec-tables.mjs`. */
async function canonicalHash(payload: unknown): Promise<string> {
  const canonicalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalise);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonicalise((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalise(payload)));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
