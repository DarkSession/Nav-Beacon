import type { EquipmentLoadout } from './equipment-loadout';
import type { EquipmentLinkCodec } from './equipment-link-codec';
import {
  createEquipmentLinkCodec,
  decodeEquipmentLinkBody,
  readPayloadTableVersion,
} from './equipment-link-codec';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import table1 from './equipment-link-table-1.json';

/**
 * Every published equipment table, each bound to the codec that reads it.
 *
 * A published table is immutable, so a link written last year opens against the
 * table that wrote it and a new version is a new entry here rather than an edit
 * above. Adding one is the whole of what a catalogue move costs.
 *
 * Loading is synchronous where the ship builder's is asynchronous, and the
 * reason is size: `docs/equipment-link-codec.md` carries the measurement and the
 * condition on which that choice is worth revisiting.
 */
export const EQUIPMENT_CODECS_BY_TABLE_VERSION: ReadonlyMap<number, EquipmentLinkCodec> = new Map([
  [1, createEquipmentLinkCodec(1, table1)],
]);

/** The table a new link is written with, which is the newest one published. */
export const CURRENT_EQUIPMENT_TABLE_VERSION = Math.max(
  ...EQUIPMENT_CODECS_BY_TABLE_VERSION.keys(),
);

const CURRENT_CODEC = EQUIPMENT_CODECS_BY_TABLE_VERSION.get(CURRENT_EQUIPMENT_TABLE_VERSION)!;

/**
 * Encode a loadout as the fragment that restores it.
 *
 * Always the current table, whatever version the loadout arrived on, so an
 * older table is only ever read and a shared link names the version this
 * release writes.
 */
export function encodeEquipmentLinkFragment(loadout: EquipmentLoadout): string {
  return CURRENT_CODEC.encodeEquipmentLinkFragment(loadout);
}

/**
 * Restore the loadout a fragment carries, or refuse it.
 *
 * The version field is read before a table is chosen, so the payload names the
 * table that decodes it. `codecs` is the seam a suite supplies a version
 * through; nothing in the application passes it.
 */
export function decodeEquipmentLinkFragment(
  fragment: string,
  codecs: ReadonlyMap<number, EquipmentLinkCodec> = EQUIPMENT_CODECS_BY_TABLE_VERSION,
): EquipmentLoadout {
  const body = decodeEquipmentLinkBody(fragment);
  const tableVersion = readPayloadTableVersion(body);
  const codec = codecs.get(tableVersion);
  if (codec === undefined) {
    throw new BuildLinkCodecError(
      'unsupportedTableVersion',
      `Equipment-link table version ${tableVersion} is not supported; this application carries ${[...codecs.keys()].join(', ')}.`,
    );
  }
  return codec.decodeVerifiedEquipmentLinkBody(body);
}
