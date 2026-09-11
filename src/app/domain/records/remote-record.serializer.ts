import { toStoredLoadout } from '../equipment/loadout/stored-loadout.serializer';
import { copyBuildSnapshotV1 } from '../ships/build/build-snapshot.serializer';
import type { LocalRecord } from './local-record';
import { REMOTE_RECORD_FORMAT, REMOTE_RECORD_VERSION, type RemoteRecord } from './remote-record';

/**
 * The remote record one local record becomes.
 *
 * Field by field from an allowlist, for the reason the local serializer gives
 * and one more: this is the boundary where a record leaves the browser. The
 * note, the save provenance, the local revision, the device claim, the listing
 * copies and the validation snapshot have no field to land in here, so no
 * caller and no future field on `LocalRecord` can put one in a request
 * (020/FR-007, 020/FR-012).
 *
 * A ship record carries its saved name in the build's ship name, because the
 * live contract holds no second name to put it in. A working record has no name
 * and keeps the build's own (020/FR-012).
 */
export function toRemoteRecord(record: LocalRecord): RemoteRecord {
  const envelope = {
    format: REMOTE_RECORD_FORMAT,
    version: REMOTE_RECORD_VERSION,
    id: record.id,
    kind: record.kind,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
  } as const;

  if (record.tool === 'equipment') {
    return {
      ...envelope,
      tool: 'equipment',
      name: record.name,
      loadout: toStoredLoadout(record.loadout),
    };
  }

  const build = copyBuildSnapshotV1(record.build);
  return {
    ...envelope,
    tool: 'ship',
    build: { ...build, shipName: record.name ?? build.shipName },
  };
}
