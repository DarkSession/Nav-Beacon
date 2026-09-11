import type { StoredLoadoutV1 } from '../equipment/loadout/stored-loadout.serializer';
import { parseStoredLoadout } from '../equipment/loadout/stored-loadout.serializer';
import { reconstructLoadout } from '../equipment/loadout/loadout-reconstructor';
import type { BuildSnapshotV1 } from '../ships/build/build-snapshot';
import { parseBuildSnapshotV1 } from '../ships/build/build-snapshot.parser';
import {
  fittedAsStored,
  reconstructFromSnapshot,
} from '../ships/build/build-snapshot.reconstructor';
import type { LocalRecordKind } from './local-record';

export const REMOTE_RECORD_FORMAT = 'ednb.remote-record';
export const REMOTE_RECORD_VERSION = 1;

interface RemoteRecordEnvelope {
  readonly format: typeof REMOTE_RECORD_FORMAT;
  readonly version: typeof REMOTE_RECORD_VERSION;
  readonly id: string;
  readonly kind: LocalRecordKind;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

export interface RemoteShipRecord extends RemoteRecordEnvelope {
  readonly tool: 'ship';
  readonly build: BuildSnapshotV1;
}

export interface RemoteEquipmentRecord extends RemoteRecordEnvelope {
  readonly tool: 'equipment';
  readonly name: string | null;
  readonly loadout: StoredLoadoutV1;
}

export type RemoteRecord = RemoteShipRecord | RemoteEquipmentRecord;

export interface RemoteTombstone {
  readonly id: string;
  readonly revision: number;
}

export type RemoteRecordParseResult =
  | { readonly ok: true; readonly record: RemoteRecord }
  | { readonly ok: false; readonly reason: string };

const SHIP_KEYS = [
  'format',
  'version',
  'id',
  'tool',
  'kind',
  'createdAt',
  'modifiedAt',
  'build',
] as const;
const EQUIPMENT_KEYS = [
  'format',
  'version',
  'id',
  'tool',
  'kind',
  'name',
  'createdAt',
  'modifiedAt',
  'loadout',
] as const;
const BUILD_KEYS = ['format', 'version', 'shipSymbol', 'shipName', 'shipIdent', 'modules'] as const;
const MODULE_KEYS = [
  'slot',
  'symbol',
  'enabled',
  'priority',
  'preEngineered',
  'engineering',
] as const;
const PRE_ENGINEERED_KEYS = [
  'symbol',
  'blueprint',
  'grade',
  'acquisition',
  'experimental',
] as const;
const ENGINEERING_KEYS = ['blueprint', 'grade', 'quality', 'experimental'] as const;
const LOADOUT_KEYS = [
  'format',
  'version',
  'suitFamily',
  'suitGrade',
  'suitModifications',
  'weapons',
] as const;
const WEAPON_KEYS = ['symbol', 'grade', 'modifications'] as const;

/** Reads and reconstructs one exact remote live-record contract. */
export function parseRemoteRecord(value: unknown): RemoteRecordParseResult {
  if (!isRecord(value)) return failed('The remote record is not an object.');

  const tool = value['tool'];
  const keys = tool === 'ship' ? SHIP_KEYS : tool === 'equipment' ? EQUIPMENT_KEYS : null;
  if (keys === null || !hasExactKeys(value, keys)) {
    return failed('The remote record has an unknown, missing or invalid field.');
  }
  if (value['format'] !== REMOTE_RECORD_FORMAT || value['version'] !== REMOTE_RECORD_VERSION) {
    return failed('The remote record format or version is not supported.');
  }
  if (!isUuid(value['id'])) return failed('The remote record identity is not a UUID.');
  if (value['kind'] !== 'working' && value['kind'] !== 'named') {
    return failed('The remote record kind is invalid.');
  }
  if (!isInstant(value['createdAt']) || !isInstant(value['modifiedAt'])) {
    return failed('The remote record timestamp is invalid.');
  }

  const envelope = {
    format: REMOTE_RECORD_FORMAT,
    version: REMOTE_RECORD_VERSION,
    id: value['id'],
    kind: value['kind'],
    createdAt: value['createdAt'],
    modifiedAt: value['modifiedAt'],
  } as const;

  if (tool === 'ship') {
    if (!isExactBuild(value['build'])) return failed('The remote build shape is invalid.');
    const parsed = parseBuildSnapshotV1(value['build']);
    if (!parsed.ok) return failed(parsed.reason);
    if (
      parsed.snapshot.modules.some(
        (module) => module.engineering?.quality !== undefined && module.engineering.quality !== 1,
      )
    ) {
      return failed('Remote engineering quality must be complete.');
    }
    const rebuilt = reconstructFromSnapshot(parsed.snapshot);
    if (!rebuilt.ok) return failed(rebuilt.reason);
    if (!fittedAsStored(parsed.snapshot, rebuilt.loadout)) {
      return failed('The package did not accept the remote hull-slot combination.');
    }
    return { ok: true, record: { ...envelope, tool, build: parsed.snapshot } };
  }

  if (typeof value['name'] !== 'string' && value['name'] !== null) {
    return failed('The equipment record name is neither text nor null.');
  }
  if (!isExactLoadout(value['loadout'])) return failed('The remote loadout shape is invalid.');
  const parsed = parseStoredLoadout(value['loadout']);
  if (!parsed.ok) return failed(parsed.reason);
  const rebuilt = reconstructLoadout(value['loadout']);
  if (!rebuilt.ok) return failed(rebuilt.reason);
  return {
    ok: true,
    record: { ...envelope, tool: 'equipment', name: value['name'], loadout: value['loadout'] },
  };
}

/** Reads the exact two-field tombstone returned inside one authenticated account stream. */
export function parseRemoteTombstone(value: unknown): RemoteTombstone | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'revision'])) return null;
  return isUuid(value['id']) && isPositiveInteger(value['revision'])
    ? { id: value['id'], revision: value['revision'] }
    : null;
}

function isExactBuild(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, BUILD_KEYS) || !Array.isArray(value['modules'])) {
    return false;
  }
  return value['modules'].every(
    (module) =>
      isRecord(module) &&
      hasExactKeys(module, MODULE_KEYS) &&
      isExactNullableObject(module['preEngineered'], PRE_ENGINEERED_KEYS) &&
      isExactNullableObject(module['engineering'], ENGINEERING_KEYS),
  );
}

function isExactLoadout(value: unknown): value is StoredLoadoutV1 {
  if (!isRecord(value) || !hasExactKeys(value, LOADOUT_KEYS) || !Array.isArray(value['weapons'])) {
    return false;
  }
  return value['weapons'].every(
    (weapon) => weapon === null || (isRecord(weapon) && hasExactKeys(weapon, WEAPON_KEYS)),
  );
}

function isExactNullableObject(value: unknown, keys: readonly string[]): boolean {
  return value === null || (isRecord(value) && hasExactKeys(value, keys));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function failed(reason: string): RemoteRecordParseResult {
  return { ok: false, reason };
}
