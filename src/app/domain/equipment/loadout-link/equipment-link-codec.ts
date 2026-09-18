import { RawBitReader, RawBitWriter } from '../../build-link/build-link-bits';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import type { LinkEnvelope } from '../../build-link/build-link-envelope';
import { decodeLinkBody, encodeLinkBody } from '../../build-link/build-link-envelope';
import type {
  EquipmentLoadout,
  FittedPersonalWeapon,
  ModificationSlots,
} from './equipment-loadout';

/**
 * The equipment builder's link codec.
 *
 * A codec of its own, and separate for one reason: a fragment claims itself by
 * its prefix, so `e.` says which tool minted a value and a ship link is never
 * offered to this decoder or the other way round. What the two share is
 * everything below the format — the Base70 alphabet, the CRC envelope and the
 * bit packer — which lives in `domain/build-link`.
 *
 * The body is bit-packed. The ship builder codes its own arithmetically because
 * a fully engineered hull is hundreds of choices; a loadout is a suit, at most
 * three weapons and their modification slots, and packs into a handful of bytes
 * without it.
 *
 * Every identity is a position in the table the payload names, which is
 * generated from the package and pinned by content hash: an index means what
 * that table says it means, whichever release is installed
 * (`scripts/generate-equipment-link-codec-tables.mjs`). A published table is
 * immutable, so `createEquipmentLinkCodec` is called once per published
 * version and `equipment-link-codec-loader.ts` is what holds them.
 *
 * The 500-character bound is what the application will attempt to read from a
 * fragment at all, and this format uses a twentieth of it. It bounds what may
 * be tried; it is not a budget the format was drawn against.
 */
export const EQUIPMENT_LINK_ENVELOPE: LinkEnvelope = { prefix: 'e.', maxCharacters: 500 };

/**
 * The width of the table-version field, which no table moves.
 *
 * It is the first field of every payload, so the version is readable before a
 * table is chosen. That is what lets a payload name the table that decodes it.
 */
export const TABLE_VERSION_BITS = 10;

/** The identifier table one published version of the format is written against. */
export interface EquipmentLinkCodecTables {
  readonly $generated: {
    readonly tableVersion: number;
    /** SHA-256 over the table's content; a table whose hash moves is a new encoding. */
    readonly contentHash: string;
  };
  readonly SUITS: readonly string[];
  readonly SUIT_GRADES: readonly (readonly number[])[];
  readonly SUIT_SLOTS: readonly number[];
  readonly SUIT_MOUNTS: readonly (readonly number[])[];
  readonly MOUNTS: readonly string[];
  readonly MOUNT_KINDS: readonly string[];
  readonly MOUNT_SLOTS: number;
  readonly WEAPONS: readonly string[];
  readonly WEAPON_GRADES: readonly (readonly number[])[];
  readonly WEAPON_SLOTS: readonly number[];
  readonly WEAPON_MOUNTS: readonly string[];
  readonly SUIT_MODIFICATIONS: readonly string[];
  readonly WEAPON_MODIFICATIONS: readonly string[];
  readonly WEAPON_MODIFICATION_SETS: readonly (readonly number[])[];
  readonly MODIFICATION_SLOTS: number;
}

/** One published version of the format, bound to the table that states it. */
export interface EquipmentLinkCodec {
  /** The version this codec writes, and the only one it reads. */
  readonly tableVersion: number;
  encodeEquipmentLinkFragment(loadout: EquipmentLoadout): string;
  decodeEquipmentLinkFragment(fragment: string): EquipmentLoadout;
  /** Decode a body whose envelope is already verified, as the loader hands it over. */
  decodeVerifiedEquipmentLinkBody(body: Uint8Array): EquipmentLoadout;
}

/** The body of a fragment whose prefix, length and checksum are already good. */
export function decodeEquipmentLinkBody(fragment: string): Uint8Array {
  return decodeLinkBody(fragment, EQUIPMENT_LINK_ENVELOPE);
}

/** The table version a payload names, read before any table is chosen. */
export function readPayloadTableVersion(body: Uint8Array): number {
  return new RawBitReader(body).readBits(TABLE_VERSION_BITS);
}

/** What a refusal names when it is about the suit itself rather than a mount. */
const SUIT_MOUNT = 'suit';

/** How many bits it takes to name one of `count` things. */
function bitsFor(count: number): number {
  let bits = 1;
  while (2 ** bits < count) bits += 1;
  return bits;
}

interface Mount {
  /** Frontier's journal `SlotName`, which is what a refusal carries. */
  readonly key: string;
  /** `PersonalWeapon.slot`: which kind of weapon this mount takes. */
  readonly kind: string;
}

/**
 * The codec for one published table version.
 *
 * Every width comes from the table rather than from the module, which is what
 * makes an earlier version readable: the table a payload names is the one that
 * says how wide its fields are, and none of those widths is the same fact twice.
 */
export function createEquipmentLinkCodec(
  tableVersion: number,
  table: EquipmentLinkCodecTables,
): EquipmentLinkCodec {
  if (
    !Number.isInteger(tableVersion) ||
    tableVersion < 1 ||
    tableVersion >= 2 ** TABLE_VERSION_BITS ||
    table.$generated.tableVersion !== tableVersion
  ) {
    throw new Error('The equipment-link codec table version is invalid.');
  }

  const MODIFICATION_SLOTS = table.MODIFICATION_SLOTS;

  /**
   * Every mount the catalogue offers, in the order the payload writes them.
   *
   * The catalogue's whole set rather than the encoded suit's, so a weapon on a
   * mount the suit does not offer is held content and round-trips (FR-018a). Each
   * mount is checked against its own kind — a rifle on `SecondaryWeapon` is still
   * refused — and never against the suit, which is what makes holding expressible.
   *
   * The key is Frontier's journal `SlotName`. It is what a refusal carries as its
   * slot, and `getPersonalMountName` is what names it before a Commander reads it.
   */
  const MOUNTS: readonly Mount[] = table.MOUNTS.map((key, index) => ({
    key,
    kind: table.MOUNT_KINDS[index]!,
  }));

  const SUIT_BITS = bitsFor(table.SUITS.length);
  const WEAPON_BITS = bitsFor(table.WEAPONS.length + 1);
  const GRADE_BITS = bitsFor(
    Math.max(...table.SUIT_GRADES.flat(), ...table.WEAPON_GRADES.flat()) + 1,
  );
  const SUIT_MODIFICATION_BITS = bitsFor(table.SUIT_MODIFICATIONS.length + 1);
  const WEAPON_MODIFICATION_BITS = bitsFor(table.WEAPON_MODIFICATIONS.length + 1);

  /** Encode a loadout as the fragment that restores it. */
  function encodeEquipmentLinkFragment(loadout: EquipmentLoadout): string {
    const suitIndex = table.SUITS.indexOf(loadout.suitFamily);
    if (suitIndex < 0) {
      throw unknownIdentity(`No suit is named ${loadout.suitFamily}.`, SUIT_MOUNT);
    }

    const writer = new RawBitWriter();
    writer.writeBits(tableVersion, TABLE_VERSION_BITS);
    writer.writeBits(suitIndex, SUIT_BITS);
    writer.writeBits(
      publishedGrade(loadout.suitGrade, table.SUIT_GRADES[suitIndex]!, SUIT_MOUNT),
      GRADE_BITS,
    );
    writeModifications(
      writer,
      loadout.suitModifications,
      table.SUIT_MODIFICATIONS.map((_, index) => index),
      SUIT_MODIFICATION_BITS,
      table.SUIT_MODIFICATIONS,
      table.SUIT_SLOTS[suitIndex]!,
      SUIT_MOUNT,
    );

    if (loadout.weapons.length !== table.MOUNT_SLOTS) {
      throw invalidPayload(
        `The catalogue offers ${table.MOUNT_SLOTS} mounts and the loadout names ${loadout.weapons.length}.`,
        null,
      );
    }

    for (const [position, mount] of MOUNTS.entries()) {
      const fitted = loadout.weapons[position] ?? null;
      if (fitted === null) {
        writer.writeBits(0, WEAPON_BITS);
        continue;
      }

      const weaponIndex = table.WEAPONS.indexOf(fitted.symbol);
      if (weaponIndex < 0) {
        throw unknownIdentity(`No handheld weapon is named ${fitted.symbol}.`, mount.key);
      }
      if (table.WEAPON_MOUNTS[weaponIndex] !== mount.kind) {
        throw invalidPayload(`${fitted.symbol} does not fit a ${mount.kind} mount.`, mount.key);
      }

      writer.writeBits(weaponIndex + 1, WEAPON_BITS);
      writer.writeBits(
        publishedGrade(fitted.grade, table.WEAPON_GRADES[weaponIndex]!, mount.key),
        GRADE_BITS,
      );
      writeModifications(
        writer,
        fitted.modifications,
        table.WEAPON_MODIFICATION_SETS[weaponIndex]!,
        WEAPON_MODIFICATION_BITS,
        table.WEAPON_MODIFICATIONS,
        table.WEAPON_SLOTS[weaponIndex]!,
        mount.key,
      );
    }

    return encodeLinkBody(writer.toUint8Array(), EQUIPMENT_LINK_ENVELOPE);
  }

  /** Restore the loadout a verified body carries, or refuse it. */
  function decodeVerifiedEquipmentLinkBody(body: Uint8Array): EquipmentLoadout {
    const reader = new RawBitReader(body);

    const payloadVersion = reader.readBits(TABLE_VERSION_BITS);
    if (payloadVersion !== tableVersion) {
      throw new BuildLinkCodecError(
        'unsupportedTableVersion',
        `Equipment-link table version ${payloadVersion} is not supported.`,
      );
    }

    const suitIndex = reader.readBits(SUIT_BITS);
    const suitFamily = table.SUITS[suitIndex];
    // Unreachable while the suit field is exactly wide enough for the table: four
    // suits in two bits leaves no index to miss on. Kept because the width and the
    // table length are free to diverge, and because the type is optional.
    if (suitFamily === undefined) {
      throw unknownIdentity('The link names a suit that is not available here.', SUIT_MOUNT);
    }
    const suitGrade = readGrade(reader, table.SUIT_GRADES[suitIndex]!, SUIT_MOUNT);
    const suitModifications = readModifications(
      reader,
      table.SUIT_MODIFICATIONS.map((_, index) => index),
      SUIT_MODIFICATION_BITS,
      table.SUIT_MODIFICATIONS,
      table.SUIT_SLOTS[suitIndex]!,
      SUIT_MOUNT,
    );

    const weapons = MOUNTS.map((mount) => readWeapon(reader, mount));

    if (!reader.done) {
      throw invalidPayload('The equipment-link payload carries trailing data.', null);
    }
    return { suitFamily, suitGrade, suitModifications, weapons };
  }

  function readWeapon(reader: RawBitReader, mount: Mount): FittedPersonalWeapon | null {
    const value = reader.readBits(WEAPON_BITS);
    if (value === 0) return null;

    const weaponIndex = value - 1;
    const symbol = table.WEAPONS[weaponIndex];
    if (symbol === undefined) {
      throw unknownIdentity(
        'The link names a handheld weapon that is not available here.',
        mount.key,
      );
    }
    if (table.WEAPON_MOUNTS[weaponIndex] !== mount.kind) {
      throw invalidPayload(`${symbol} does not fit a ${mount.kind} mount.`, mount.key);
    }
    return {
      symbol,
      grade: readGrade(reader, table.WEAPON_GRADES[weaponIndex]!, mount.key),
      modifications: readModifications(
        reader,
        table.WEAPON_MODIFICATION_SETS[weaponIndex]!,
        WEAPON_MODIFICATION_BITS,
        table.WEAPON_MODIFICATIONS,
        table.WEAPON_SLOTS[weaponIndex]!,
        mount.key,
      ),
    };
  }

  /** A grade the item publishes, refused where it does not publish it. */
  function publishedGrade(grade: number, published: readonly number[], mount: string): number {
    if (!published.includes(grade)) {
      throw invalidPayload(`Grade ${grade} is not published for this item.`, mount);
    }
    return grade;
  }

  function readGrade(reader: RawBitReader, published: readonly number[], mount: string): number {
    return publishedGrade(reader.readBits(GRADE_BITS), published, mount);
  }

  /**
   * One field per modification slot, in slot order.
   *
   * Every slot is written whether or not it holds anything, because which slot a
   * modification is in is part of what the loadout says (`equipment-loadout.ts`,
   * `ModificationSlots`). It is also what leaves the format one spelling for one
   * loadout: there is no second way to say which slot is empty.
   *
   * `available` is the recipes this item can take, which is the whole list for a
   * suit and the weapon's own set for a weapon: Greater Range, Headshot Damage
   * and Improved Hip Fire Accuracy are three recipes each, one per damage
   * technology, and the package settles which one a weapon takes. A recipe this
   * release does not publish at all is an unknown identity; one it publishes for
   * other weapons is a payload this item cannot hold, the same refusal as a rifle
   * on a sidearm mount.
   */
  function writeModifications(
    writer: RawBitWriter,
    slots: ModificationSlots,
    available: readonly number[],
    width: number,
    recipes: readonly string[],
    unlocked: number,
    mount: string,
  ): void {
    if (slots.length !== MODIFICATION_SLOTS) {
      throw invalidPayload(
        `An item has ${MODIFICATION_SLOTS} modification slots and the loadout names ${slots.length}.`,
        mount,
      );
    }

    for (const [slot, symbol] of slots.entries()) {
      if (symbol === null) {
        writer.writeBits(0, width);
        continue;
      }
      const index = recipes.indexOf(symbol);
      if (index < 0) {
        throw unknownIdentity(`No modification is named ${symbol}.`, mount);
      }
      if (!available.includes(index)) {
        throw invalidPayload(`This item does not take ${symbol}.`, mount);
      }
      refuseLockedSlot(slot, unlocked, mount);
      writer.writeBits(index + 1, width);
    }
    refuseRepeats(slots, mount);
  }

  function readModifications(
    reader: RawBitReader,
    available: readonly number[],
    width: number,
    recipes: readonly string[],
    unlocked: number,
    mount: string,
  ): ModificationSlots {
    const slots = Array.from({ length: MODIFICATION_SLOTS }, (_, slot) => {
      const value = reader.readBits(width);
      if (value === 0) return null;
      const index = value - 1;
      const symbol = recipes[index];
      if (symbol === undefined) {
        throw unknownIdentity('The link names a modification that is not available here.', mount);
      }
      if (!available.includes(index)) {
        throw invalidPayload('The link fits a modification this item does not take.', mount);
      }
      refuseLockedSlot(slot, unlocked, mount);
      return symbol;
    });
    refuseRepeats(slots, mount);
    return slots;
  }

  return {
    tableVersion,
    encodeEquipmentLinkFragment,
    decodeEquipmentLinkFragment: (fragment: string): EquipmentLoadout =>
      decodeVerifiedEquipmentLinkBody(decodeEquipmentLinkBody(fragment)),
    decodeVerifiedEquipmentLinkBody,
  };
}

/**
 * A modification in a slot no grade of this item unlocks.
 *
 * Every item reaches four slots except the Flight Suit, whose only grade unlocks
 * none, so this is the whole of what it refuses today. A slot a *lower* grade
 * has locked still holds what was fitted to it (`ModificationSlots`); this is
 * the slot that never opens at all.
 */
function refuseLockedSlot(slot: number, unlocked: number, mount: string): void {
  if (slot >= unlocked) {
    throw invalidPayload(`This item never unlocks modification slot ${slot + 1}.`, mount);
  }
}

/** One recipe is fitted once. Two slots holding it is not a loadout the game can hold. */
function refuseRepeats(slots: ModificationSlots, mount: string): void {
  const fitted = slots.filter((symbol) => symbol !== null);
  if (new Set(fitted).size !== fitted.length) {
    throw invalidPayload('An item holds the same modification twice.', mount);
  }
}

function invalidPayload(message: string, slot: string | null): BuildLinkCodecError {
  return new BuildLinkCodecError('invalidPayload', message, { slot });
}

function unknownIdentity(message: string, slot: string | null): BuildLinkCodecError {
  return new BuildLinkCodecError('unknownIdentity', message, { slot });
}
