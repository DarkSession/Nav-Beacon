import { changeBody, type RecordChange } from './record-synchronisation';

/** The fixed bounds 020/FR-026 publishes, in bytes of UTF-8 JSON. */
export const MAXIMUM_RECORD_BYTES = 65_536;
export const MAXIMUM_REQUEST_BYTES = 1_048_576;
export const MAXIMUM_CHANGES = 100;

/** One pending operation, with the change it would send. */
export interface ChangeCandidate {
  readonly operationId: string;
  readonly recordId: string;
  readonly change: RecordChange;
}

/** What one request will carry, and what has to wait. */
export interface BatchPlan {
  readonly changes: readonly RecordChange[];
  /** The operation behind each change, aligned with `changes` by index. */
  readonly operationIds: readonly string[];
  /** The record behind each change, aligned with `changes` by index. */
  readonly recordIds: readonly string[];
  /** Operations a later request will carry, because this one is full. */
  readonly deferred: readonly ChangeCandidate[];
  /** Records no request can carry, because one record is over its own bound. */
  readonly oversized: readonly ChangeCandidate[];
}

/**
 * Fills one request up to the bounds the service publishes, and no further.
 *
 * The bounds are inclusive, and they are checked here rather than waited for:
 * an over-limit request is refused whole, so a batch that grew one change too
 * long would leave every change in it pending rather than just the one that
 * did not fit (020/FR-026).
 *
 * A record over its own 64 KiB bound is set aside rather than deferred. It
 * cannot be made to fit by waiting, and leaving it at the head of the queue
 * would stop every other record behind it from ever being sent. It stays
 * pending and is named, so the application can state which bound it exceeded.
 */
export function planSynchronisationBatch(
  candidates: readonly ChangeCandidate[],
  sinceRevision: number,
): BatchPlan {
  const changes: RecordChange[] = [];
  const operationIds: string[] = [];
  const recordIds: string[] = [];
  const deferred: ChangeCandidate[] = [];
  const oversized: ChangeCandidate[] = [];

  let bytes = utf8Length(JSON.stringify({ sinceRevision, changes: [] }));
  let full = false;

  for (const candidate of candidates) {
    if (full) {
      deferred.push(candidate);
      continue;
    }

    const body = JSON.stringify(changeBody(candidate.change));
    if (candidate.change.type === 'write' && recordBytes(candidate.change) > MAXIMUM_RECORD_BYTES) {
      oversized.push(candidate);
      continue;
    }

    const separator = changes.length === 0 ? 0 : 1;
    const grown = bytes + utf8Length(body) + separator;
    if (changes.length === MAXIMUM_CHANGES || grown > MAXIMUM_REQUEST_BYTES) {
      full = true;
      deferred.push(candidate);
      continue;
    }

    bytes = grown;
    changes.push(candidate.change);
    operationIds.push(candidate.operationId);
    recordIds.push(candidate.recordId);
  }

  return { changes, operationIds, recordIds, deferred, oversized };
}

/** One record's own size, which is bounded separately from the request. */
export function recordBytes(change: RecordChange): number {
  return change.type === 'write' ? utf8Length(JSON.stringify(change.record)) : 0;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}
