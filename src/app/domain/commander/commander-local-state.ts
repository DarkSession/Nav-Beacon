export const COMMANDER_LOCAL_STATE_FORMAT = 'ednb.commander-state';

/**
 * The published state version.
 *
 * Version 2 holds one account cursor per Frontier Customer ID, the remote
 * revision each record last accepted, and pending remote operations that name
 * the record they are for. Version 1 held a single cursor and operation
 * identities that name nothing, so the migration keeps that cursor under the
 * account it was accepted from and drops those identities: an identity on its
 * own cannot be retried, and the record bindings — the one thing another
 * account must never take over — are carried across untouched.
 */
export const COMMANDER_LOCAL_STATE_VERSION = 2;

export interface CachedCommanderAccount {
  readonly customerId: string;
  readonly commanderName: string;
}

/**
 * What a record's account state is, where it has one.
 *
 * A Customer ID binds the record to that account. `local-only` is a record that
 * stays in this browser until a Commander saves or copies it again. No entry at
 * all is an unbound record, which the first sign-in may bind and upload
 * (020/FR-024).
 */
export type RecordAccountBinding = string | 'local-only';

/** What a pending remote operation asks the service to do. */
export type PendingOperationKind = 'upload' | 'delete' | 'renew';

/**
 * One remote change this browser has made and the service has not accepted.
 *
 * The record's content is not copied here. The operation names the record, and
 * the record's own key holds what will be sent, so a retry reads the work as it
 * stands rather than a copy that has gone stale beside it — and a note cannot
 * reach a request through a second copy of the record (020/FR-007).
 */
export interface PendingRemoteOperation {
  /** This operation's own identity, stable across every retry. */
  readonly id: string;
  /** The account the change belongs to. */
  readonly customerId: string;
  readonly recordId: string;
  readonly kind: PendingOperationKind;
  /** The remote revision the change was made against, or `null` for a first upload. */
  readonly baseRevision: number | null;
  readonly queuedAt: string;
}

/**
 * Everything about an account this browser keeps between visits.
 *
 * One value under one key, because that is what makes the rule in 020/FR-026
 * true: the cursor advances and the answered operations go in the same write
 * that records what the response said. A write that never lands leaves the
 * cursor where it was and the operations pending, and the service answers the
 * retry as a no-op.
 */
export interface CommanderLocalState {
  readonly format: typeof COMMANDER_LOCAL_STATE_FORMAT;
  readonly version: typeof COMMANDER_LOCAL_STATE_VERSION;
  readonly account: CachedCommanderAccount | null;
  readonly fleetCache: readonly never[];
  /** The last accepted account revision, per Customer ID. */
  readonly accountCursors: Readonly<Record<string, number>>;
  readonly pendingOperations: readonly PendingRemoteOperation[];
  readonly recordBindings: Readonly<Record<string, RecordAccountBinding>>;
  /** The remote revision each record last accepted. */
  readonly recordRevisions: Readonly<Record<string, number>>;
}

/** What one accepted synchronisation response says about one record. */
export interface AcceptedRemoteRecord {
  readonly recordId: string;
  readonly revision: number;
}

/** One complete synchronisation response, as browser storage takes it. */
export interface SynchronisationCommit {
  readonly customerId: string;
  /** The account revision the response returned. */
  readonly cursor: number;
  /** Every record the response leaves remote, with the revision it now carries. */
  readonly accepted: readonly AcceptedRemoteRecord[];
  /** Every record the response removed, by accepted delete or by tombstone. */
  readonly removedRecordIds: readonly string[];
  /** The pending operations the response answered. */
  readonly completedOperationIds: readonly string[];
}

export function emptyCommanderLocalState(): CommanderLocalState {
  return {
    format: COMMANDER_LOCAL_STATE_FORMAT,
    version: COMMANDER_LOCAL_STATE_VERSION,
    account: null,
    fleetCache: [],
    accountCursors: {},
    pendingOperations: [],
    recordBindings: {},
    recordRevisions: {},
  };
}

/**
 * Reads the stored value as untrusted input, migrating it where it needs it.
 *
 * A field that does not read is the whole value refused, because a half-read
 * account state is one that could upload a record to the wrong account.
 */
export function parseCommanderLocalState(value: unknown): CommanderLocalState | null {
  if (!isObject(value) || value['format'] !== COMMANDER_LOCAL_STATE_FORMAT) {
    return null;
  }
  const stored = migrateToCurrentVersion(value);
  if (stored === null) {
    return null;
  }

  const account = parseAccount(stored['account']);
  const fleetCache = stored['fleetCache'];
  if (account === undefined || !Array.isArray(fleetCache) || fleetCache.length > 0) {
    return null;
  }

  const accountCursors = readCursors(stored['accountCursors']);
  const pendingOperations = readOperations(stored['pendingOperations']);
  const recordRevisions = readRevisions(stored['recordRevisions']);
  if (accountCursors === null || pendingOperations === null || recordRevisions === null) {
    return null;
  }
  const recordBindings = stored['recordBindings'];
  if (!isBindings(recordBindings)) {
    return null;
  }

  return {
    format: COMMANDER_LOCAL_STATE_FORMAT,
    version: COMMANDER_LOCAL_STATE_VERSION,
    account,
    fleetCache: [],
    accountCursors,
    pendingOperations,
    recordBindings,
    recordRevisions,
  };
}

/** The account revision this browser last accepted for one Commander. */
export function accountCursor(state: CommanderLocalState, customerId: string): number {
  return state.accountCursors[customerId] ?? 0;
}

/** One record's binding, or `null` where the record is unbound. */
export function recordBinding(
  state: CommanderLocalState,
  recordId: string,
): RecordAccountBinding | null {
  return state.recordBindings[recordId] ?? null;
}

/** The remote revision one record last accepted, or `null` where it has none. */
export function remoteRevisionOf(state: CommanderLocalState, recordId: string): number | null {
  return state.recordRevisions[recordId] ?? null;
}

/**
 * Whether one record may enter this account.
 *
 * Unbound and already bound to this Commander are the two eligible states.
 * A record bound to another Customer ID stays local, and a local-only record
 * needs an explicit new save or copy first (020/FR-024).
 */
export function canSynchroniseRecord(
  state: CommanderLocalState,
  recordId: string,
  customerId: string,
): boolean {
  const binding = recordBinding(state, recordId);
  return binding === null || binding === customerId;
}

/** Binds one record to one Commander. */
export function withRecordBound(
  state: CommanderLocalState,
  recordId: string,
  customerId: string,
): CommanderLocalState {
  return { ...state, recordBindings: { ...state.recordBindings, [recordId]: customerId } };
}

/**
 * Marks one record local-only and clears what it had queued.
 *
 * This is what cancelling a conflict leaves behind: both versions keep their
 * content, this browser's copy stops being the account's, and nothing is
 * waiting to send it (020/FR-009, 020/FR-010).
 */
export function withRecordLocalOnly(
  state: CommanderLocalState,
  recordId: string,
): CommanderLocalState {
  return {
    ...state,
    recordBindings: { ...state.recordBindings, [recordId]: 'local-only' },
    recordRevisions: without(state.recordRevisions, [recordId]),
    pendingOperations: state.pendingOperations.filter(
      (operation) => operation.recordId !== recordId,
    ),
  };
}

/**
 * Drops what this browser knows about one record's remote copy.
 *
 * A queued operation stays: a record deleted here leaves a pending delete that
 * names it, and that delete carries the revision it was made against.
 */
export function withRecordForgotten(
  state: CommanderLocalState,
  recordId: string,
): CommanderLocalState {
  return {
    ...state,
    recordBindings: without(state.recordBindings, [recordId]),
    recordRevisions: without(state.recordRevisions, [recordId]),
  };
}

/**
 * Queues one remote operation.
 *
 * One record holds one operation per account: a second upload replaces the
 * first, because the record's own key already holds what both would send. A
 * renewal only asks the service to keep an unchanged record, which anything
 * already queued for that record answers, so it waits rather than displacing
 * work.
 */
export function withPendingOperation(
  state: CommanderLocalState,
  operation: PendingRemoteOperation,
): CommanderLocalState {
  const forRecord = (pending: PendingRemoteOperation): boolean =>
    pending.recordId === operation.recordId && pending.customerId === operation.customerId;

  if (operation.kind === 'renew' && state.pendingOperations.some(forRecord)) {
    return state;
  }
  return {
    ...state,
    pendingOperations: [
      ...state.pendingOperations.filter((pending) => !forRecord(pending)),
      operation,
    ],
  };
}

/**
 * Takes one complete synchronisation response.
 *
 * Every part of it lands together: the records the response accepted, the
 * records it removed, the operations it answered and the account cursor. The
 * cursor never moves backwards, so a response that arrives out of order cannot
 * ask this browser to read a stretch of the stream twice (020/FR-026).
 *
 * A local-only record stays local-only. Only an explicit new save or copy takes
 * one back into an account, and a response can name a record this browser has
 * since cancelled (020/FR-024).
 */
export function withSynchronisationCommitted(
  state: CommanderLocalState,
  commit: SynchronisationCommit,
): CommanderLocalState {
  const bindings = { ...without(state.recordBindings, commit.removedRecordIds) };
  const revisions = { ...without(state.recordRevisions, commit.removedRecordIds) };
  for (const record of commit.accepted) {
    if (bindings[record.recordId] === 'local-only') {
      continue;
    }
    bindings[record.recordId] = commit.customerId;
    revisions[record.recordId] = record.revision;
  }

  const answered = new Set(commit.completedOperationIds);
  return {
    ...state,
    accountCursors: {
      ...state.accountCursors,
      [commit.customerId]: Math.max(accountCursor(state, commit.customerId), commit.cursor),
    },
    pendingOperations: state.pendingOperations.filter((operation) => !answered.has(operation.id)),
    recordBindings: bindings,
    recordRevisions: revisions,
  };
}

/**
 * Version 1 of this value, read as version 2.
 *
 * Its one cursor belongs to the account it was accepted from, and its operation
 * identities name no record, so nothing can retry them.
 */
function migrateToCurrentVersion(value: Record<string, unknown>): Record<string, unknown> | null {
  if (value['version'] === COMMANDER_LOCAL_STATE_VERSION) {
    return value;
  }
  if (value['version'] !== 1) {
    return null;
  }
  const account = parseAccount(value['account']);
  const cursor = value['syncRevision'];
  return {
    ...value,
    version: COMMANDER_LOCAL_STATE_VERSION,
    accountCursors:
      account === undefined || account === null || !isRevision(cursor) || cursor === 0
        ? {}
        : { [account.customerId]: cursor },
    pendingOperations: [],
    recordRevisions: {},
  };
}

function parseAccount(value: unknown): CachedCommanderAccount | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'commanderName,customerId') {
    return undefined;
  }
  const customerId = value['customerId'];
  const commanderName = value['commanderName'];
  if (
    !isCustomerId(customerId) ||
    typeof commanderName !== 'string' ||
    commanderName.trim().length === 0
  ) {
    return undefined;
  }
  return { customerId, commanderName };
}

function readCursors(value: unknown): Readonly<Record<string, number>> | null {
  if (!isObject(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (!entries.every(([customerId, cursor]) => isCustomerId(customerId) && isRevision(cursor))) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function readRevisions(value: unknown): Readonly<Record<string, number>> | null {
  if (!isObject(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (!entries.every(([recordId, revision]) => recordId.length > 0 && isRevision(revision))) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function readOperations(value: unknown): readonly PendingRemoteOperation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const operations: PendingRemoteOperation[] = [];
  for (const entry of value) {
    const operation = readOperation(entry);
    if (operation === null) {
      return null;
    }
    operations.push(operation);
  }
  return operations;
}

function readOperation(value: unknown): PendingRemoteOperation | null {
  if (!isObject(value)) {
    return null;
  }
  const { id, customerId, recordId, kind, baseRevision, queuedAt } = value;
  if (typeof id !== 'string' || id.length === 0 || !isCustomerId(customerId)) {
    return null;
  }
  if (typeof recordId !== 'string' || recordId.length === 0) {
    return null;
  }
  if (kind !== 'upload' && kind !== 'delete' && kind !== 'renew') {
    return null;
  }
  if (baseRevision !== null && !isRevision(baseRevision)) {
    return null;
  }
  if (typeof queuedAt !== 'string' || Number.isNaN(Date.parse(queuedAt))) {
    return null;
  }
  return { id, customerId, recordId, kind, baseRevision, queuedAt };
}

function isBindings(value: unknown): value is Readonly<Record<string, RecordAccountBinding>> {
  return (
    isObject(value) &&
    Object.values(value).every((binding) => binding === 'local-only' || isCustomerId(binding))
  );
}

function without<T>(
  source: Readonly<Record<string, T>>,
  keys: readonly string[],
): Record<string, T> {
  const dropped = new Set(keys);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !dropped.has(key)));
}

function isCustomerId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
