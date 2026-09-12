import {
  parseRemoteRecord,
  parseRemoteTombstone,
  type RemoteRecord,
  type RemoteTombstone,
} from './remote-record';

/**
 * The wire contract of `POST api/records/synchronise`, read into exact values.
 *
 * The browser sends its last accepted account revision and the changes it has
 * not had answered, and the service answers with one indexed result per change
 * and every record and deletion marker above that revision. A refusal applies
 * none of the batch, so everything here is read before anything is committed
 * (020/FR-026).
 */

/** One change the browser asks the service to make. */
export type RecordChange =
  | {
      readonly type: 'write';
      readonly record: RemoteRecord;
      /** The revision this browser believes the account holds, or `null` for none. */
      readonly baseRevision: number | null;
    }
  | { readonly type: 'delete'; readonly id: string; readonly baseRevision: number | null }
  | { readonly type: 'renew'; readonly id: string };

export interface SynchronisationRequest {
  readonly sinceRevision: number;
  readonly changes: readonly RecordChange[];
}

/** What one submitted change did. */
export type ChangeOutcome = 'applied' | 'unchanged' | 'conflict' | 'refused' | 'not-applied';

/**
 * What the account holds for a conflicting change.
 *
 * `deleted` is the account's deletion marker, which is what an offline live
 * page's renewal receives. `unreadable` is a record this version of the
 * application cannot read — a newer record format, or one the pinned package no
 * longer resolves — which must never be mistaken for a deletion (020/FR-010,
 * 020/FR-012).
 */
export type RemoteVersion =
  | { readonly kind: 'record'; readonly record: RemoteRecord }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'unreadable' };

export interface ChangeResult {
  readonly index: number;
  readonly outcome: ChangeOutcome;
  /** The record the service read, where it read one. */
  readonly id: string | null;
  readonly revision: number | null;
  /** What the account holds now. Present only on a conflict. */
  readonly remote: RemoteVersion | null;
  readonly code: string | null;
}

/** One live record from the account stream. */
export interface RemoteRecordEntry {
  readonly revision: number;
  readonly record: RemoteRecord;
}

/** One streamed record this version of the application cannot read. */
export interface UnreadableRecordEntry {
  readonly revision: number;
  /** The identity, where it could be read without guessing. */
  readonly id: string | null;
}

/** The stable application error codes a refusal carries. */
export type SynchronisationErrorCode =
  | 'invalid-anti-forgery'
  | 'unauthorised'
  | 'request-too-large'
  | 'too-many-changes'
  | 'record-too-large'
  | 'invalid-request'
  | 'unsupported-record-version'
  | 'invalid-record'
  | 'validation-unavailable'
  | 'cross-account-record'
  | 'conflict'
  | 'synchronisation-failed'
  | 'unknown';

const ERROR_CODES: readonly SynchronisationErrorCode[] = [
  'invalid-anti-forgery',
  'unauthorised',
  'request-too-large',
  'too-many-changes',
  'record-too-large',
  'invalid-request',
  'unsupported-record-version',
  'invalid-record',
  'validation-unavailable',
  'cross-account-record',
  'conflict',
  'synchronisation-failed',
];

export type SynchronisationResponse =
  | {
      readonly kind: 'accepted';
      readonly accountRevision: number;
      readonly results: readonly ChangeResult[];
      readonly records: readonly RemoteRecordEntry[];
      readonly unreadableRecords: readonly UnreadableRecordEntry[];
      readonly tombstones: readonly RemoteTombstone[];
    }
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly code: SynchronisationErrorCode;
      /** The account cursor, which only 403 and 409 carry. */
      readonly accountRevision: number | null;
      readonly results: readonly ChangeResult[];
    }
  /** No answer, or an answer this browser cannot read. Nothing may be committed. */
  | { readonly kind: 'unavailable' };

/**
 * The request body, written field by field.
 *
 * The service refuses any field it does not publish, and a renewal publishes no
 * base revision at all, so each change is built from the kind rather than
 * spread from a larger value.
 */
export function synchronisationBody(request: SynchronisationRequest): string {
  return JSON.stringify({
    sinceRevision: request.sinceRevision,
    changes: request.changes.map(changeBody),
  });
}

/** One change as the service reads it. */
export function changeBody(change: RecordChange): Record<string, unknown> {
  if (change.type === 'renew') {
    return { type: 'renew', id: change.id };
  }
  const base = change.baseRevision === null ? {} : { baseRevision: change.baseRevision };
  return change.type === 'write'
    ? { type: 'write', record: change.record, ...base }
    : { type: 'delete', id: change.id, ...base };
}

/**
 * Reads one accepted response.
 *
 * A record the stream carries that this version cannot read is listed rather
 * than refused: a newer browser may have written it, and it stays remote and
 * unopened here. Anything else that does not read refuses the whole response,
 * because a half-read response committed against this browser's cursor would
 * skip the part it could not read (020/FR-012, 020/FR-026).
 */
export async function parseAcceptedResponse(value: unknown): Promise<SynchronisationResponse> {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['accountRevision', 'results', 'records', 'tombstones'])
  ) {
    return { kind: 'unavailable' };
  }
  const accountRevision = value['accountRevision'];
  const results = await parseResults(value['results']);
  if (!isRevision(accountRevision) || results === null) {
    return { kind: 'unavailable' };
  }

  const stream = value['records'];
  const markers = value['tombstones'];
  if (!Array.isArray(stream) || !Array.isArray(markers)) {
    return { kind: 'unavailable' };
  }

  const records: RemoteRecordEntry[] = [];
  const unreadableRecords: UnreadableRecordEntry[] = [];
  for (const entry of stream) {
    if (!isObject(entry) || !hasExactKeys(entry, ['revision', 'record'])) {
      return { kind: 'unavailable' };
    }
    const revision = entry['revision'];
    if (!isRevision(revision)) {
      return { kind: 'unavailable' };
    }
    const parsed = await parseRemoteRecord(entry['record']);
    if (parsed.ok) {
      records.push({ revision, record: parsed.record });
    } else {
      unreadableRecords.push({ revision, id: identityOf(entry['record']) });
    }
  }

  const tombstones: RemoteTombstone[] = [];
  for (const entry of markers) {
    const tombstone = parseRemoteTombstone(entry);
    if (tombstone === null) {
      return { kind: 'unavailable' };
    }
    tombstones.push(tombstone);
  }

  return { kind: 'accepted', accountRevision, results, records, unreadableRecords, tombstones };
}

/**
 * Reads one Problem Details refusal.
 *
 * The status is kept beside the code. A body that does not read still refuses
 * the batch, and the status is what says whether the session has gone.
 */
export async function parseRefusal(
  status: number,
  value: unknown,
): Promise<SynchronisationResponse> {
  const body = isObject(value) ? value : {};
  const code = body['code'];
  const accountRevision = body['accountRevision'];
  const results = await parseResults(body['results']);
  return {
    kind: 'refused',
    status,
    code: isErrorCode(code) ? code : 'unknown',
    accountRevision: isRevision(accountRevision) ? accountRevision : null,
    results: results ?? [],
  };
}

async function parseResults(value: unknown): Promise<readonly ChangeResult[] | null> {
  if (!Array.isArray(value)) {
    return null;
  }
  const results: ChangeResult[] = [];
  for (const entry of value) {
    const result = await parseResult(entry);
    if (result === null) {
      return null;
    }
    results.push(result);
  }
  return results;
}

async function parseResult(value: unknown): Promise<ChangeResult | null> {
  if (!isObject(value)) {
    return null;
  }
  const index = value['index'];
  const outcome = value['outcome'];
  if (!isRevision(index) || !isOutcome(outcome)) {
    return null;
  }
  const id = value['id'];
  const revision = value['revision'];
  const code = value['code'];
  if (id !== undefined && typeof id !== 'string') {
    return null;
  }
  if (revision !== undefined && !isRevision(revision)) {
    return null;
  }
  if (code !== undefined && typeof code !== 'string') {
    return null;
  }
  return {
    index,
    outcome,
    id: typeof id === 'string' ? id : null,
    revision: isRevision(revision) ? revision : null,
    remote: outcome === 'conflict' ? await remoteVersion(value['record']) : null,
    code: typeof code === 'string' ? code : null,
  };
}

/**
 * What a conflict says the account holds.
 *
 * A missing `record` reads as unreadable rather than as a deletion. Removing a
 * Commander's local copy on the strength of a field that is not there is the
 * one mistake this must never make (020/FR-010).
 */
async function remoteVersion(value: unknown): Promise<RemoteVersion> {
  if (value === null) {
    return { kind: 'deleted' };
  }
  const parsed = await parseRemoteRecord(value);
  return parsed.ok ? { kind: 'record', record: parsed.record } : { kind: 'unreadable' };
}

function identityOf(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }
  const id = value['id'];
  return typeof id === 'string' ? id : null;
}

function isOutcome(value: unknown): value is ChangeOutcome {
  return (
    value === 'applied' ||
    value === 'unchanged' ||
    value === 'conflict' ||
    value === 'refused' ||
    value === 'not-applied'
  );
}

function isErrorCode(value: unknown): value is SynchronisationErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value as SynchronisationErrorCode);
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
