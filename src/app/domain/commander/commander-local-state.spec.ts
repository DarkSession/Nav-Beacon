import {
  COMMANDER_LOCAL_STATE_FORMAT,
  COMMANDER_LOCAL_STATE_VERSION,
  accountCursor,
  canSynchroniseRecord,
  emptyCommanderLocalState,
  parseCommanderLocalState,
  recordBinding,
  remoteRevisionOf,
  withPendingOperation,
  withRecordBound,
  withRecordForgotten,
  withRecordLocalOnly,
  withSynchronisationCommitted,
  type CommanderLocalState,
  type PendingRemoteOperation,
} from './commander-local-state';

const OWNER = '900001';
const OTHER = '900002';

function operation(overrides: Partial<PendingRemoteOperation> = {}): PendingRemoteOperation {
  return {
    id: 'operation-1',
    customerId: OWNER,
    recordId: 'record-1',
    kind: 'upload',
    baseRevision: null,
    queuedAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<CommanderLocalState> = {}): CommanderLocalState {
  return { ...emptyCommanderLocalState(), ...overrides };
}

describe('the Commander state a browser keeps', () => {
  it('reads a complete current value back', () => {
    const stored = state({
      account: { customerId: OWNER, commanderName: 'Hadley' },
      accountCursors: { [OWNER]: 12, [OTHER]: 4 },
      pendingOperations: [operation(), operation({ id: 'operation-2', recordId: 'record-2' })],
      recordBindings: { 'record-1': OWNER, 'record-2': 'local-only', 'record-3': OTHER },
      recordRevisions: { 'record-1': 7 },
    });

    expect(parseCommanderLocalState(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  const refusals: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a value that is not this application’s', { format: 'other', version: 2 }],
    ['an unreadable account', { account: { customerId: 'not-a-customer', commanderName: 'A' } }],
    ['a cursor under something that is not a Customer ID', { accountCursors: { abc: 3 } }],
    ['a cursor that is not a whole number', { accountCursors: { [OWNER]: 1.5 } }],
    ['a revision that is not a number', { recordRevisions: { 'record-1': 'seven' } }],
    ['a binding that is neither an account nor local-only', { recordBindings: { r: 'nothing' } }],
    ['an operation naming no record', { pendingOperations: [{ ...operation(), recordId: '' }] }],
    ['an operation with an unknown kind', { pendingOperations: [{ ...operation(), kind: 'x' }] }],
    [
      'an operation with an unreadable time',
      { pendingOperations: [{ ...operation(), queuedAt: 'whenever' }] },
    ],
    ['operations that are not a list', { pendingOperations: {} }],
  ];

  it.each(refusals)('refuses %s', (_name, overrides) => {
    expect(parseCommanderLocalState({ ...state(), ...overrides })).toBeNull();
  });

  it('reads the fleet this browser accepted back, under the account it belongs to', () => {
    const fleet = {
      customerId: OWNER,
      acceptedAt: '2026-09-10T08:00:00.000Z',
      result: 'current',
      ships: [{ shipId: 12 }],
      coverage: null,
    };

    const parsed = parseCommanderLocalState({ ...state(), fleetCache: [fleet] });

    expect(parsed?.fleetCache).toEqual([fleet]);
  });

  it('drops a fleet entry it cannot read, and keeps the rest of the account state', () => {
    // The fleet is the one part of this value the browser can ask for again.
    // Everything else decides which account a record belongs to, so a half-read
    // one of those refuses the whole value and this does not.
    const parsed = parseCommanderLocalState({
      ...state({ recordBindings: { 'record-1': OWNER } }),
      fleetCache: ['a ship'],
    });

    expect(parsed?.fleetCache).toEqual([]);
    expect(parsed?.recordBindings).toEqual({ 'record-1': OWNER });
  });

  it('reads a version-1 value, keeping its bindings and its one cursor', () => {
    // Version 1 held one cursor and operation identities that name no record.
    const version1 = {
      format: COMMANDER_LOCAL_STATE_FORMAT,
      version: 1,
      account: { customerId: OWNER, commanderName: 'Hadley' },
      fleetCache: [],
      syncRevision: 42,
      pendingOperationIds: ['operation-1'],
      recordBindings: { 'record-1': OWNER, 'record-2': 'local-only' },
    };

    const parsed = parseCommanderLocalState(version1);

    expect(parsed).toEqual(
      state({
        account: { customerId: OWNER, commanderName: 'Hadley' },
        accountCursors: { [OWNER]: 42 },
        recordBindings: { 'record-1': OWNER, 'record-2': 'local-only' },
      }),
    );
    expect(parsed?.version).toBe(COMMANDER_LOCAL_STATE_VERSION);
  });

  it('reads a version-1 value that was never signed in', () => {
    const parsed = parseCommanderLocalState({
      format: COMMANDER_LOCAL_STATE_FORMAT,
      version: 1,
      account: null,
      fleetCache: [],
      syncRevision: 0,
      pendingOperationIds: [],
      recordBindings: {},
    });

    expect(parsed).toEqual(emptyCommanderLocalState());
  });

  it('refuses a version it does not publish', () => {
    expect(parseCommanderLocalState({ ...state(), version: 99 })).toBeNull();
  });
});

describe('what a record is bound to', () => {
  it('treats a record with no entry as unbound, and lets it enter any account', () => {
    expect(recordBinding(state(), 'record-1')).toBeNull();
    expect(canSynchroniseRecord(state(), 'record-1', OWNER)).toBe(true);
  });

  it('keeps a record bound to another Commander out of this account', () => {
    const bound = withRecordBound(state(), 'record-1', OTHER);

    expect(canSynchroniseRecord(bound, 'record-1', OWNER)).toBe(false);
    expect(canSynchroniseRecord(bound, 'record-1', OTHER)).toBe(true);
  });

  it('keeps a local-only record out of every account until it is saved again', () => {
    const localOnly = withRecordLocalOnly(withRecordBound(state(), 'record-1', OWNER), 'record-1');

    expect(recordBinding(localOnly, 'record-1')).toBe('local-only');
    expect(canSynchroniseRecord(localOnly, 'record-1', OWNER)).toBe(false);
  });

  it('clears what a cancelled record had queued, and the revision it accepted', () => {
    const pending = withPendingOperation(
      state({ recordRevisions: { 'record-1': 3 }, recordBindings: { 'record-1': OWNER } }),
      operation(),
    );

    const cancelled = withRecordLocalOnly(pending, 'record-1');

    expect(cancelled.pendingOperations).toEqual([]);
    expect(remoteRevisionOf(cancelled, 'record-1')).toBeNull();
  });

  it('keeps a pending delete when the record itself is forgotten', () => {
    const deleted = withRecordForgotten(
      withPendingOperation(
        state({ recordBindings: { 'record-1': OWNER }, recordRevisions: { 'record-1': 3 } }),
        operation({ kind: 'delete', baseRevision: 3 }),
      ),
      'record-1',
    );

    expect(recordBinding(deleted, 'record-1')).toBeNull();
    expect(remoteRevisionOf(deleted, 'record-1')).toBeNull();
    expect(deleted.pendingOperations).toEqual([operation({ kind: 'delete', baseRevision: 3 })]);
  });
});

describe('operations waiting to be sent', () => {
  it('holds one operation per record and account', () => {
    const queued = withPendingOperation(
      withPendingOperation(state(), operation()),
      operation({ id: 'operation-2' }),
    );

    expect(queued.pendingOperations).toEqual([operation({ id: 'operation-2' })]);
  });

  it('keeps another account’s operation for the same record', () => {
    const queued = withPendingOperation(
      withPendingOperation(state(), operation()),
      operation({ id: 'operation-2', customerId: OTHER }),
    );

    expect(queued.pendingOperations.map((pending) => pending.id)).toEqual([
      'operation-1',
      'operation-2',
    ]);
  });

  it('lets a renewal wait behind work that already sends the record', () => {
    const queued = withPendingOperation(
      withPendingOperation(state(), operation()),
      operation({ id: 'operation-2', kind: 'renew' }),
    );

    expect(queued.pendingOperations).toEqual([operation()]);
  });

  it('queues a renewal when the record has nothing waiting', () => {
    const queued = withPendingOperation(state(), operation({ kind: 'renew' }));

    expect(queued.pendingOperations).toEqual([operation({ kind: 'renew' })]);
  });
});

describe('committing one synchronisation response', () => {
  const before = state({
    accountCursors: { [OWNER]: 5 },
    pendingOperations: [operation(), operation({ id: 'operation-2', recordId: 'record-2' })],
    recordBindings: { 'record-2': OWNER, 'record-3': OWNER },
    recordRevisions: { 'record-2': 4, 'record-3': 9 },
  });

  it('takes the cursor, the revisions, the bindings and the answered work together', () => {
    const committed = withSynchronisationCommitted(before, {
      customerId: OWNER,
      cursor: 11,
      accepted: [{ recordId: 'record-1', revision: 10 }],
      removedRecordIds: ['record-3'],
      completedOperationIds: ['operation-1'],
    });

    expect(accountCursor(committed, OWNER)).toBe(11);
    expect(remoteRevisionOf(committed, 'record-1')).toBe(10);
    expect(recordBinding(committed, 'record-1')).toBe(OWNER);
    expect(recordBinding(committed, 'record-3')).toBeNull();
    expect(remoteRevisionOf(committed, 'record-3')).toBeNull();
    expect(committed.pendingOperations.map((pending) => pending.id)).toEqual(['operation-2']);
  });

  it('leaves the cursor and the queue alone when nothing commits', () => {
    // What an unwritten response leaves behind: the retry sends the same work
    // again and the service answers it as a no-op (020/FR-026).
    expect(accountCursor(before, OWNER)).toBe(5);
    expect(before.pendingOperations).toHaveLength(2);
  });

  it('leaves a local-only record local-only', () => {
    const cancelled = withRecordLocalOnly(before, 'record-2');

    const committed = withSynchronisationCommitted(cancelled, {
      customerId: OWNER,
      cursor: 11,
      accepted: [{ recordId: 'record-2', revision: 10 }],
      removedRecordIds: [],
      completedOperationIds: [],
    });

    expect(recordBinding(committed, 'record-2')).toBe('local-only');
    expect(remoteRevisionOf(committed, 'record-2')).toBeNull();
  });

  it('does not move a cursor backwards', () => {
    const committed = withSynchronisationCommitted(before, {
      customerId: OWNER,
      cursor: 2,
      accepted: [],
      removedRecordIds: [],
      completedOperationIds: [],
    });

    expect(accountCursor(committed, OWNER)).toBe(5);
  });

  /**
   * The response commits one operation while another for the same record is
   * already queued behind it. Sending the revision that one was queued against
   * would read to the service as another device's write, so a surviving
   * operation takes the revision the account has just confirmed (020/FR-009).
   */
  it('advances a surviving operation to the revision the response confirmed', () => {
    const queued = state({
      pendingOperations: [operation({ id: 'operation-2', baseRevision: 3 })],
      recordBindings: { 'record-1': OWNER },
      recordRevisions: { 'record-1': 3 },
    });

    const committed = withSynchronisationCommitted(queued, {
      customerId: OWNER,
      cursor: 4,
      accepted: [{ recordId: 'record-1', revision: 4 }],
      removedRecordIds: [],
      completedOperationIds: ['operation-1'],
    });

    expect(committed.pendingOperations).toEqual([
      operation({ id: 'operation-2', baseRevision: 4 }),
    ]);
  });

  /**
   * The answer to a conflict is queued against the revision the account holds,
   * which is ahead of the one this browser had accepted. A base only ever moves
   * forward, so the answer still overwrites what it was told to overwrite
   * (020/FR-009).
   */
  it('leaves a base revision that is already ahead where it is', () => {
    const queued = state({
      pendingOperations: [operation({ id: 'operation-2', baseRevision: 9 })],
      recordBindings: { 'record-1': OWNER },
      recordRevisions: { 'record-1': 5 },
    });

    const committed = withSynchronisationCommitted(queued, {
      customerId: OWNER,
      cursor: 6,
      accepted: [{ recordId: 'record-1', revision: 5 }],
      removedRecordIds: [],
      completedOperationIds: [],
    });

    expect(committed.pendingOperations).toEqual([
      operation({ id: 'operation-2', baseRevision: 9 }),
    ]);
  });

  it('keeps one cursor per Commander', () => {
    const committed = withSynchronisationCommitted(before, {
      customerId: OTHER,
      cursor: 3,
      accepted: [],
      removedRecordIds: [],
      completedOperationIds: [],
    });

    expect(accountCursor(committed, OWNER)).toBe(5);
    expect(accountCursor(committed, OTHER)).toBe(3);
  });
});
