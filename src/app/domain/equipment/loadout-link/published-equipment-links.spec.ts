import { describe, expect, it } from 'vitest';
import { CATALOGUE_MOUNTS, mountAvailability } from '../loadout/loadout-mounts';
import type { EquipmentLinkCodecTables } from './equipment-link-codec';
import {
  createEquipmentLinkCodec,
  decodeEquipmentLinkBody,
  readPayloadTableVersion,
} from './equipment-link-codec';
import {
  CURRENT_EQUIPMENT_TABLE_VERSION,
  EQUIPMENT_CODECS_BY_TABLE_VERSION,
  decodeEquipmentLinkFragment,
  encodeEquipmentLinkFragment,
} from './equipment-link-codec-loader';
import equipmentTable1Json from './equipment-link-table-1.json';
import type { EquipmentLoadout } from './equipment-loadout';
import publishedLinks from './published-equipment-links.fixture.json';

/** One link that has been shared, and the loadout it has to keep opening. */
interface CorpusEntry {
  readonly note: string;
  readonly fragment: string;
  readonly opensTo: EquipmentLoadout;
  /** What the suit and each filled mount hold, by the name the mount is addressed under. */
  readonly modifications: Readonly<Record<string, readonly (string | null)[]>>;
}

/**
 * The table every corpus version is read against, keyed by the version a link names.
 *
 * Minting a table adds a row here and a version to the corpus. The first test below fails
 * until both arrive, which is what keeps an earlier table from quietly falling out of use.
 */
const TABLE_BY_VERSION: Readonly<Record<string, EquipmentLinkCodecTables>> = {
  1: equipmentTable1Json,
};

const corpus = Object.entries(publishedLinks as Readonly<Record<string, readonly CorpusEntry[]>>)
  .map(([version, entries]) => ({ version: Number(version), entries }))
  .sort((left, right) => left.version - right.version);

/**
 * What a loadout holds in its modification slots, read by mount rather than by position.
 *
 * The loadout compares whole, so this is the same fact a second time — and deliberately.
 * `opensTo` carries the mounts as a list, where a table that moved a mount would move a
 * weapon with it; this reads each item under the journal `SlotName` its mount is addressed
 * by, so a modification that changed mounts on the way through is named rather than matched.
 */
function modificationsOf(loadout: EquipmentLoadout): Record<string, readonly (string | null)[]> {
  const held: Record<string, readonly (string | null)[]> = { suit: loadout.suitModifications };
  CATALOGUE_MOUNTS.forEach((mount, position) => {
    const weapon = loadout.weapons[position];
    if (weapon != null) held[mount.key] = weapon.modifications;
  });
  return held;
}

/**
 * Links that have been out in the world, and the loadouts they have to keep opening.
 *
 * A loadout link is a promise with no expiry: a Commander who saved one opens it against the
 * table that wrote it, however many tables have been minted since. The corpus is how that
 * promise is tested rather than asserted — every entry is a real fragment, transcribed from
 * the run that produced it and pinned to the loadout it was shared as, and nothing removes one.
 */
describe('published equipment links', () => {
  it('holds links for every table version a link can name', () => {
    const versions = corpus.map(({ version }) => version);

    expect(versions).toEqual(
      Array.from({ length: CURRENT_EQUIPMENT_TABLE_VERSION }, (_unused, index) => index + 1),
    );
    expect(
      [...EQUIPMENT_CODECS_BY_TABLE_VERSION.keys()].sort((left, right) => left - right),
    ).toEqual(versions);
    expect(
      Object.keys(TABLE_BY_VERSION)
        .map(Number)
        .sort((left, right) => left - right),
    ).toEqual(versions);
    for (const { entries } of corpus) expect(entries.length).toBeGreaterThan(0);
  });

  it('opens every published link on the loadout it was shared as', () => {
    for (const { version, entries } of corpus) {
      // Read twice: once the way the application reads an arriving link, which picks the table
      // from the payload itself, and once against the table the corpus files the link under. The
      // second is what proves the entry is filed where it belongs, because a codec reads no
      // version but its own.
      const pinned = createEquipmentLinkCodec(version, TABLE_BY_VERSION[version]!);

      for (const { fragment, opensTo, modifications } of entries) {
        expect(readPayloadTableVersion(decodeEquipmentLinkBody(fragment))).toBe(version);

        const loadout = decodeEquipmentLinkFragment(fragment);

        expect(loadout).toEqual(opensTo);
        expect(modificationsOf(loadout)).toEqual(modifications);
        expect(pinned.decodeEquipmentLinkFragment(fragment)).toEqual(opensTo);
      }
    }
  });

  it('rewrites every published link with the current table on the same loadout', () => {
    // A link is allowed to arrive in an older format and leave in the newest one, which is what
    // the bench does the moment an older link opens. What is not allowed is the loadout moving
    // on the way through.
    const rewritten = corpus.flatMap(({ entries }) =>
      entries.map(({ fragment, opensTo, modifications }) => {
        const written = encodeEquipmentLinkFragment(decodeEquipmentLinkFragment(fragment));

        expect(readPayloadTableVersion(decodeEquipmentLinkBody(written))).toBe(
          CURRENT_EQUIPMENT_TABLE_VERSION,
        );

        const reread = decodeEquipmentLinkFragment(written);

        expect(reread).toEqual(opensTo);
        expect(modificationsOf(reread)).toEqual(modifications);
        return reread;
      }),
    );

    // A weapon on a mount its suit does not offer is the case a rewrite is likeliest to drop,
    // so the corpus carries one and this says so rather than passing over an absence.
    expect(rewritten.some((loadout) => mountAvailability(loadout).includes('held'))).toBe(true);
    expect(
      rewritten.some((loadout) =>
        Object.values(modificationsOf(loadout))
          .flat()
          .some((held) => held !== null),
      ),
    ).toBe(true);
  });
});
