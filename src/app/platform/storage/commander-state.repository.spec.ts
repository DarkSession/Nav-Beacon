import { TestBed } from '@angular/core/testing';
import {
  COMMANDER_LOCAL_STATE_FORMAT,
  type CommanderLocalState,
  type PendingRemoteOperation,
} from '../../domain/commander/commander-local-state';
import { CommanderStateRepository } from './commander-state.repository';
import { MemoryStorage, provideMemoryStorage, quotaError } from './storage.spec-helpers';
import { EDNB_COMMANDER_STATE_KEY } from './storage-keys';

const OWNER = '900001';
const OTHER = '900002';

function setup(seed: unknown = null): {
  repository: CommanderStateRepository;
  storage: MemoryStorage;
} {
  const storage = new MemoryStorage();
  if (seed !== null) {
    storage.setItem(EDNB_COMMANDER_STATE_KEY, JSON.stringify(seed));
  }
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [...provideMemoryStorage(storage)] });
  return { repository: TestBed.inject(CommanderStateRepository), storage };
}

function stored(storage: MemoryStorage): CommanderLocalState {
  return JSON.parse(storage.getItem(EDNB_COMMANDER_STATE_KEY) ?? '{}') as CommanderLocalState;
}

function upload(overrides: Partial<PendingRemoteOperation> = {}): PendingRemoteOperation {
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

describe('the account side of browser storage', () => {
  it('reads an empty state from a browser that has stored nothing', () => {
    const { repository } = setup();

    expect(repository.read()).toEqual({
      format: COMMANDER_LOCAL_STATE_FORMAT,
      version: 2,
      account: null,
      fleetCache: [],
      accountCursors: {},
      pendingOperations: [],
      recordBindings: {},
      recordRevisions: {},
    });
  });

  it('reads an empty state from bytes it cannot decode', () => {
    const { repository, storage } = setup();
    storage.setItem(EDNB_COMMANDER_STATE_KEY, '{not json');

    expect(repository.read().account).toBeNull();
  });

  it('keeps a queued change across a reload', () => {
    const { repository, storage } = setup();

    expect(repository.queueOperation(upload()).ok).toBe(true);

    // The same bytes, read by the repository a reload creates.
    const reloaded = setup(stored(storage));
    expect(reloaded.repository.read().pendingOperations).toEqual([upload()]);
  });

  it('binds a record to the signed-in Commander and takes its revision', () => {
    const { repository } = setup();

    repository.bindRecord('record-1', OWNER);
    repository.commitSynchronisation({
      customerId: OWNER,
      cursor: 4,
      accepted: [{ recordId: 'record-1', revision: 4 }],
      removedRecordIds: [],
      completedOperationIds: [],
    });

    const state = repository.read();
    expect(state.recordBindings).toEqual({ 'record-1': OWNER });
    expect(state.recordRevisions).toEqual({ 'record-1': 4 });
    expect(state.accountCursors).toEqual({ [OWNER]: 4 });
  });

  it('advances the cursor and clears the queue in the write that records the response', () => {
    const { repository, storage } = setup();
    repository.queueOperation(upload());
    repository.queueOperation(upload({ id: 'operation-2', recordId: 'record-2' }));

    // Nothing has committed yet: the cursor is where it was and both changes
    // are still waiting (020/FR-026).
    expect(stored(storage).accountCursors).toEqual({});
    expect(stored(storage).pendingOperations).toHaveLength(2);

    repository.commitSynchronisation({
      customerId: OWNER,
      cursor: 9,
      accepted: [{ recordId: 'record-1', revision: 9 }],
      removedRecordIds: [],
      completedOperationIds: ['operation-1'],
    });

    const after = stored(storage);
    expect(after.accountCursors).toEqual({ [OWNER]: 9 });
    expect(after.pendingOperations.map((operation) => operation.id)).toEqual(['operation-2']);
  });

  it('leaves the cursor and the queue where they were when the write fails', () => {
    const { repository, storage } = setup();
    repository.queueOperation(upload());
    storage.writeError = quotaError();

    const result = repository.commitSynchronisation({
      customerId: OWNER,
      cursor: 9,
      accepted: [{ recordId: 'record-1', revision: 9 }],
      removedRecordIds: [],
      completedOperationIds: ['operation-1'],
    });

    expect(result).toEqual({ ok: false, code: 'quota' });
    expect(stored(storage).accountCursors).toEqual({});
    expect(stored(storage).pendingOperations).toEqual([upload()]);
  });

  it('marks a cancelled record local-only and clears what it had queued', () => {
    const { repository } = setup();
    repository.bindRecord('record-1', OWNER);
    repository.queueOperation(upload());

    repository.markRecordLocalOnly('record-1');

    const state = repository.read();
    expect(state.recordBindings['record-1']).toBe('local-only');
    expect(state.pendingOperations).toEqual([]);
  });

  it('forgets a record it no longer holds', () => {
    const { repository } = setup();
    repository.bindRecord('record-1', OWNER);

    repository.forgetRecord('record-1');

    expect(repository.read().recordBindings).toEqual({});
  });

  it('ends a session without discarding the account’s records, cursor or queue', () => {
    const { repository } = setup();
    repository.storeAccount({ customerId: OWNER, commanderName: 'Hadley' });
    repository.bindRecord('record-1', OWNER);
    repository.queueOperation(upload());

    repository.clearSession();

    const state = repository.read();
    expect(state.account).toBeNull();
    expect(state.recordBindings['record-1']).toBe(OWNER);
    expect(state.pendingOperations).toEqual([upload()]);
  });

  it('marks every retained record local-only before an account deletion', () => {
    const { repository } = setup();
    repository.storeAccount({ customerId: OWNER, commanderName: 'Hadley' });
    repository.bindRecord('record-1', OWNER);
    repository.bindRecord('record-2', OTHER);
    repository.queueOperation(upload());
    repository.commitSynchronisation({
      customerId: OWNER,
      cursor: 3,
      accepted: [{ recordId: 'record-1', revision: 3 }],
      removedRecordIds: [],
      completedOperationIds: ['operation-1'],
    });

    repository.prepareAccountDeletion();

    const state = repository.read();
    expect(state.account).toBeNull();
    expect(state.accountCursors).toEqual({});
    expect(state.pendingOperations).toEqual([]);
    expect(state.recordRevisions).toEqual({});
    expect(state.recordBindings).toEqual({ 'record-1': 'local-only', 'record-2': 'local-only' });
  });

  it('reports a store that refuses the write', () => {
    const { repository, storage } = setup();
    storage.writeError = quotaError();

    expect(repository.bindRecord('record-1', OWNER)).toEqual({
      ok: false,
      code: 'quota',
    });
  });
});
