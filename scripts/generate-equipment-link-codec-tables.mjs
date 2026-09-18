#!/usr/bin/env node
/**
 * Write the equipment-link codec table from the Almanac.
 *
 * The link names a suit, a weapon and a modification by its position in this
 * table, so the table is the contract a published link is read back through. It
 * is generated rather than written, because the catalogue behind it belongs to
 * `@elite-dangerous-almanac/core` and this repository does not keep a second
 * copy of game data (constitution II).
 *
 * The table also carries what the codec has to know to refuse a loadout that
 * cannot exist: which grades a suit and a weapon publish, every mount key the
 * catalogue offers and the kind each one takes, which kind a weapon fits, how
 * many modification slots each item ever unlocks, and the most any item unlocks.
 * Reading those from the package at decode time would make an old link's meaning
 * depend on the release that happened to be installed.
 *
 * Like the ship builder's table, a changed content hash is a new encoding and
 * belongs under the next table version. The application is published, so table 1
 * is what the `e.` links already shared name: this script refuses to write it
 * once its content has moved, and there is no flag that permits it.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SUITS } from '@elite-dangerous-almanac/core/equipment/suits';
import { PERSONAL_WEAPONS } from '@elite-dangerous-almanac/core/equipment/weapons';
import { PERSONAL_MODIFICATIONS } from '@elite-dangerous-almanac/core/equipment/modifications';
import { resolvePersonalModificationForWeapon } from '@elite-dangerous-almanac/core/equipment/modification-journal';

const TABLE_VERSION = 1;
const outputPath = fileURLToPath(
  new URL('../src/app/domain/equipment/loadout-link/equipment-link-table-1.json', import.meta.url),
);
const suits = Object.values(SUITS);
const weapons = Object.values(PERSONAL_WEAPONS);
const modifications = Object.entries(PERSONAL_MODIFICATIONS);

const grades = (item) =>
  Object.keys(item.grades)
    .map((grade) => Number(grade))
    .sort((left, right) => left - right);

/**
 * The most modification slots an item ever unlocks, over all its grades.
 *
 * Per item because the Flight Suit's only grade unlocks none: a modification on
 * it is a loadout the game cannot hold, and without this the codec has nothing
 * to refuse it by.
 */
const slotsFor = (item) =>
  Math.max(...Object.values(item.grades).map((grade) => grade.modificationSlots));

const modificationSlots = Math.max(...[...suits, ...weapons].map(slotsFor));

const weaponModifications = modifications
  .filter(([, recipe]) => recipe.target === 'weapon')
  .map(([symbol]) => symbol);

/**
 * Which of the weapon recipes each weapon can actually take.
 *
 * Greater Range, Headshot Damage and Improved Hip Fire Accuracy are three
 * recipes each, one per damage technology, and a weapon takes exactly one of
 * the three. The package settles which with
 * `resolvePersonalModificationForWeapon`, and asking it is the only way to know
 * — the pairing is the library's, not a rule this repository may restate.
 */
const weaponModificationSets = weapons.map((weapon) =>
  weaponModifications.flatMap((symbol, index) => {
    const journal = symbol.replace(/_(kinetic|laser|plasma)$/, '');
    if (journal === symbol) return [index];
    return resolvePersonalModificationForWeapon(weapon.symbol, journal) === symbol ? [index] : [];
  }),
);

/**
 * Every mount key the catalogue offers, in the game's own order.
 *
 * A loadout writes one field per entry here rather than one per mount the
 * encoded suit offers, so a weapon on a mount the selected suit has no room for
 * is held content and round-trips (013/FR-018a). The keys are Frontier's own
 * journal `SlotName`s, published on `Suit.mounts`.
 *
 * The order is merged from the suits' own lists rather than sorted, so it stays
 * the order the game lists mounts in and this file invents no comparator for
 * it: a key already seen fixes where the next new one goes.
 */
const mounts = [];
for (const suit of suits) {
  let at = 0;
  for (const mount of suit.mounts) {
    const seen = mounts.findIndex((known) => known.key === mount.key);
    if (seen >= 0) {
      at = seen + 1;
      continue;
    }
    mounts.splice(at, 0, { key: mount.key, kind: mount.kind });
    at += 1;
  }
}

const payload = {
  SUITS: suits.map((suit) => suit.family),
  SUIT_GRADES: suits.map(grades),
  SUIT_SLOTS: suits.map(slotsFor),
  // Which of `MOUNTS` each suit offers, by index. The codec checks a weapon
  // against its mount rather than against this, because a weapon on a mount the
  // suit does not offer is held rather than refused; it is the catalogue fact
  // the table records at this version.
  SUIT_MOUNTS: suits.map((suit) =>
    suit.mounts.map((mount) => mounts.findIndex((known) => known.key === mount.key)),
  ),
  MOUNTS: mounts.map((mount) => mount.key),
  // Which kind of weapon each mount takes, as `PersonalWeapon.slot` names it.
  MOUNT_KINDS: mounts.map((mount) => mount.kind),
  MOUNT_SLOTS: mounts.length,
  WEAPONS: weapons.map((weapon) => weapon.symbol),
  WEAPON_GRADES: weapons.map(grades),
  WEAPON_SLOTS: weapons.map(slotsFor),
  WEAPON_MOUNTS: weapons.map((weapon) => weapon.slot),
  SUIT_MODIFICATIONS: modifications
    .filter(([, recipe]) => recipe.target === 'suit')
    .map(([symbol]) => symbol),
  WEAPON_MODIFICATIONS: weaponModifications,
  WEAPON_MODIFICATION_SETS: weaponModificationSets,
  MODIFICATION_SLOTS: modificationSlots,
};

const contentHashOf = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

const contentHash = contentHashOf(payload);
const payloadOf = (table) =>
  Object.fromEntries(Object.entries(table).filter(([key]) => key !== '$generated'));

/**
 * The committed table still holds the content its declared hash names.
 *
 * The hash the file declares is the one thing an edit can carry with it, so trusting it would
 * let a hand-edited table pass this check and be written over in silence. Hashing the payload
 * back is what makes the file itself the evidence.
 */
const previous = JSON.parse(await readFile(outputPath, 'utf8').catch(() => 'null'));

if (previous === null) {
  throw new Error(
    `Equipment codec table ${TABLE_VERSION} is missing.\nA link naming table ${TABLE_VERSION} ` +
      'has no other table that decodes it, so the file stays in the repository for as long as ' +
      'the link does.',
  );
}

const previousHash = contentHashOf(payloadOf(previous));

if (previous.$generated?.contentHash !== previousHash) {
  throw new Error(
    `Equipment codec table ${TABLE_VERSION} content does not match its declared hash\n` +
      `  declared: ${previous.$generated?.contentHash ?? '(none recorded)'}\n` +
      `  actual:   ${previousHash}\n` +
      'Refusing to replace a table whose integrity check failed.',
  );
}

if (previousHash !== contentHash) {
  throw new Error(
    `Equipment codec table ${TABLE_VERSION} content changed\n` +
      `  committed: ${previousHash}\n  generated: ${contentHash}\n` +
      'Every published link names the table version that decodes it, so a changed table is a\n' +
      'new encoding: mint the next table version and keep this one for the links already out.\n' +
      `Table ${TABLE_VERSION} is published. It is never written again, and no flag permits it.`,
  );
}

await writeFile(
  outputPath,
  `${JSON.stringify({ $generated: { tableVersion: TABLE_VERSION, contentHash }, ...payload })}\n`,
);
console.log(
  `Equipment codec table ${TABLE_VERSION} written: ${payload.SUITS.length} suits, ` +
    `${payload.MOUNT_SLOTS} mounts, ${payload.WEAPONS.length} weapons, ` +
    `${payload.SUIT_MODIFICATIONS.length + payload.WEAPON_MODIFICATIONS.length} modifications ` +
    `(${contentHash.slice(0, 12)}…).`,
);
