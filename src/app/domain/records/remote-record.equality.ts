import type { RemoteRecord } from './remote-record';

/**
 * Whether two versions of one record hold the same synchronised state.
 *
 * Equality is over every field of the live-record contract and nothing else.
 * The server revision, the server content time and the live-page protection
 * deadline are not in that contract and never enter this answer, which is what
 * lets a first sign-in accept the account's revision for a record it already
 * holds rather than offering a conflict over nothing (020/FR-008).
 *
 * Two things are compared rather than the text. Key order inside a stored
 * record is not part of the contract — the payload comes back from the
 * service's own store — so values are compared, member by member. And an
 * instant is compared as an instant: the service returns UTC to the
 * millisecond whatever offset form it was sent, and a record that came back
 * spelled differently is the same record.
 *
 * A difference anywhere, including the name and the named state, is a content
 * change and becomes a conflicting write (020/FR-008, 020/FR-009).
 */
export function remoteRecordsEqual(left: RemoteRecord, right: RemoteRecord): boolean {
  if (left.tool !== right.tool || left.id !== right.id || left.kind !== right.kind) {
    return false;
  }
  if (!sameInstant(left.createdAt, right.createdAt)) {
    return false;
  }
  if (!sameInstant(left.modifiedAt, right.modifiedAt)) {
    return false;
  }
  if (left.tool === 'ship' && right.tool === 'ship') {
    return sameValue(left.build, right.build);
  }
  if (left.tool === 'equipment' && right.tool === 'equipment') {
    return left.name === right.name && sameValue(left.loadout, right.loadout);
  }
  return false;
}

/** Two record instants that name the same moment, however they are spelled. */
function sameInstant(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const first = Date.parse(left);
  const second = Date.parse(right);
  return !Number.isNaN(first) && first === second;
}

/** Deep equality over the plain values a stored payload is made of. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    );
  }
  if (!isObject(left) || !isObject(right)) {
    return false;
  }
  const keys = Object.keys(left).sort();
  const other = Object.keys(right).sort();
  return (
    keys.length === other.length &&
    keys.every((key, index) => key === other[index]) &&
    keys.every((key) => sameValue(left[key], right[key]))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
