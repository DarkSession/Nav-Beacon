import { TestBed } from '@angular/core/testing';
import {
  accountCursor,
  parseCommanderLocalState,
  recordBinding,
  remoteRevisionOf,
  type CommanderLocalState,
} from '../../domain/commander/commander-local-state';
import {
  FIXTURE_IDS,
  LOADOUT_RECORD_V2,
  MALFORMED_RECORD,
  NAMED_RECORD_V1,
  UNKNOWN_HULL_RECORD,
  WORKING_RECORD_V1,
} from '../../domain/records/fixtures/records';
import type { LocalRecord } from '../../domain/records/local-record';
import type {
  SynchronisationRequest,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';
import type { RemoteRecord, RemoteShipRecord } from '../../domain/records/remote-record';
import { toRemoteRecord } from '../../domain/records/remote-record.serializer';
import { decodeAndMigrate } from '../../domain/ships/build/record-migrations';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import {
  COMMANDER_API,
  type CommanderApiPort,
  type CommanderSessionResult,
} from '../../platform/network/commander-api';
import {
  EDNB_COMMANDER_STATE_KEY,
  EDNB_TAB_KEY,
  recordKey,
} from '../../platform/storage/storage-keys';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { AccountStore, type AccountCredentials } from '../account/account.store';
import { RecordSynchronisationStore } from './record-synchronisation.store';

const CREDENTIALS: AccountCredentials = { customerId: '900001', antiForgeryToken: 'token-1' };
const OTHER_ACCOUNT = '900002';
const ACCOUNT = { customerId: '900001', commanderName: 'CMDR Jameson' };
const REMOTE_ONLY_ID = '12121212-1212-4121-8121-121212121212';

/** A Commander service driven by a script, which records what it was asked. */
class FakeCommanderApi implements CommanderApiPort {
  readonly requests: SynchronisationRequest[] = [];
  readonly answers: SynchronisationResponse[] = [];
  session: CommanderSessionResult = { kind: 'anonymous' };
  /** Runs when a request arrives, for a browser that fails mid-response. */
  onRequest: (() => void) | null = null;

  callbackResult(): null {
    return null;
  }

  async startSignIn(): Promise<boolean> {
    return true;
  }

  async readSession(): Promise<CommanderSessionResult> {
    return this.session;
  }

  async signOut(): Promise<boolean> {
    return true;
  }

  async deleteAccount(): Promise<boolean> {
    return true;
  }

  async synchroniseRecords(request: SynchronisationRequest): Promise<SynchronisationResponse> {
    this.requests.push(request);
    this.onRequest?.();
    return this.answers.shift() ?? accepted();
  }
}

/** Identities in the order a test can predict. */
class SequentialUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `fedcba98-0000-4000-8000-${String(this.#next).padStart(12, '0')}`;
  }
}

class FixedClock {
  instant = new Date('2026-03-01T00:00:00.000Z');

  now(): Date {
    return this.instant;
  }

  timestamp(): string {
    return this.instant.toISOString();
  }
}

function accepted(changes: Partial<Extract<SynchronisationResponse, { kind: 'accepted' }>> = {}) {
  return {
    kind: 'accepted' as const,
    accountRevision: 0,
    results: [],
    records: [],
    unreadableRecords: [],
    tombstones: [],
    ...changes,
  };
}

function local(bytes: string, id: string): LocalRecord {
  const decoded = decodeAndMigrate(JSON.parse(bytes), id);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  return decoded.record;
}

function remoteOf(bytes: string, id: string): RemoteRecord {
  return toRemoteRecord(local(bytes, id));
}

/** The same build under another identity and another name. */
function renamed(id: string, name: string): RemoteShipRecord {
  const record = remoteOf(NAMED_RECORD_V1, FIXTURE_IDS.named);
  if (record.tool !== 'ship') {
    throw new Error('The ship fixture is not a ship record.');
  }
  return { ...record, id, build: { ...record.build, shipName: name } };
}

describe('the record synchronisation store', () => {
  let storage: MemoryStorage;
  let session: MemoryStorage;
  let api: FakeCommanderApi;
  let clock: FixedClock;
  let store: RecordSynchronisationStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    session = new MemoryStorage();
    api = new FakeCommanderApi();
    clock = new FixedClock();
    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage, session),
        { provide: COMMANDER_API, useValue: api },
        { provide: UuidAdapter, useClass: SequentialUuid },
        { provide: ClockAdapter, useValue: clock },
      ],
    });
    store = TestBed.inject(RecordSynchronisationStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function seed(bytes: string, id: string): void {
    storage.entries.set(recordKey(id), bytes);
  }

  function claim(recordId: string): void {
    session.entries.set(
      EDNB_TAB_KEY,
      JSON.stringify({ version: 2, workingRecords: { ship: recordId } }),
    );
  }

  function commanderState(): CommanderLocalState {
    const raw = storage.entries.get(EDNB_COMMANDER_STATE_KEY);
    const parsed = raw === undefined ? null : parseCommanderLocalState(JSON.parse(raw));
    if (parsed === null) {
      throw new Error('The Commander state did not read.');
    }
    return parsed;
  }

  function storedRecord(id: string): Record<string, unknown> | null {
    const raw = storage.entries.get(recordKey(id));
    return raw === undefined ? null : JSON.parse(raw);
  }

  function writeState(state: Partial<CommanderLocalState>): void {
    storage.entries.set(
      EDNB_COMMANDER_STATE_KEY,
      JSON.stringify({
        format: 'ednb.commander-state',
        version: 2,
        account: ACCOUNT,
        fleetCache: [],
        accountCursors: {},
        pendingOperations: [],
        recordBindings: {},
        recordRevisions: {},
        ...state,
      }),
    );
  }

  function lastRequest(): SynchronisationRequest {
    const request = api.requests.at(-1);
    if (request === undefined) {
      throw new Error('Nothing was sent.');
    }
    return request;
  }

  describe('the first sign-in merge', () => {
    it('offers every eligible local record and takes the account’s own', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      seed(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout);
      api.answers.push(
        accepted({
          accountRevision: 12,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 11,
              remote: null,
              code: null,
            },
            {
              index: 1,
              outcome: 'applied',
              id: FIXTURE_IDS.loadout,
              revision: 12,
              remote: null,
              code: null,
            },
          ],
          records: [{ revision: 10, record: renamed(REMOTE_ONLY_ID, 'From another device') }],
        }),
      );

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(2);
      expect(lastRequest().sinceRevision).toBe(0);
      expect(storedRecord(REMOTE_ONLY_ID)).toMatchObject({ name: 'From another device' });
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(12);
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe(CREDENTIALS.customerId);
      expect(remoteRevisionOf(commanderState(), REMOTE_ONLY_ID)).toBe(10);
      expect(commanderState().pendingOperations).toHaveLength(0);
      expect(store.status()).toMatchObject({ kind: 'current' });
    });

    it('keeps records with matching names apart, because their identities differ', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push(
        accepted({
          accountRevision: 6,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 6,
              remote: null,
              code: null,
            },
          ],
          records: [{ revision: 5, record: renamed(REMOTE_ONLY_ID, 'Anaconda explorer') }],
        }),
      );

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).toMatchObject({ name: 'Anaconda explorer' });
      expect(storedRecord(REMOTE_ONLY_ID)).toMatchObject({ name: 'Anaconda explorer' });
      expect(store.conflicts()).toHaveLength(0);
    });

    it('accepts the account’s revision for an identical record without a conflict', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      const before = storedRecord(FIXTURE_IDS.named);
      api.answers.push(
        accepted({
          accountRevision: 9,
          results: [
            {
              index: 0,
              outcome: 'unchanged',
              id: FIXTURE_IDS.named,
              revision: 7,
              remote: null,
              code: null,
            },
          ],
          records: [{ revision: 7, record: remoteOf(NAMED_RECORD_V1, FIXTURE_IDS.named) }],
        }),
      );

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(store.conflicts()).toHaveLength(0);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBe(7);
      expect(storedRecord(FIXTURE_IDS.named)).toEqual(before);
    });

    it('offers neither a local-only record nor one bound to another Commander', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      seed(WORKING_RECORD_V1, FIXTURE_IDS.working);
      seed(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout);
      writeState({
        recordBindings: {
          [FIXTURE_IDS.named]: 'local-only',
          [FIXTURE_IDS.working]: OTHER_ACCOUNT,
        },
      });

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(lastRequest().changes).toEqual([expect.objectContaining({ type: 'write' })]);
      expect(lastRequest().changes[0]).toMatchObject({
        record: expect.objectContaining({ id: FIXTURE_IDS.loadout }),
      });
    });

    it('offers no record the installed package cannot reconstruct', async () => {
      seed(UNKNOWN_HULL_RECORD, FIXTURE_IDS.unknownHull);

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
      expect(storedRecord(FIXTURE_IDS.unknownHull)).not.toBeNull();
    });

    it('offers nothing for a record this browser cannot read', async () => {
      seed(MALFORMED_RECORD, FIXTURE_IDS.named);

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
    });

    it('carries no queued upload for a record the package no longer carries', async () => {
      seed(UNKNOWN_HULL_RECORD, FIXTURE_IDS.unknownHull);
      store.queueUpload(FIXTURE_IDS.unknownHull, CREDENTIALS.customerId);

      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('states the record bound for a record no request can carry', async () => {
      const large = JSON.parse(NAMED_RECORD_V1);
      large.name = 'x'.repeat(70_000);
      seed(JSON.stringify(large), FIXTURE_IDS.named);

      await store.mergeFirstSignIn(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
      expect(store.status()).toMatchObject({
        kind: 'failed',
        failure: { reason: 'bound', bound: 'record-too-large', recordId: FIXTURE_IDS.named },
      });
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('merges once for an account, and exchanges thereafter', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 4 },
        recordBindings: { [FIXTURE_IDS.named]: CREDENTIALS.customerId },
        recordRevisions: { [FIXTURE_IDS.named]: 4 },
      });

      await store.signedIn(CREDENTIALS);

      expect(lastRequest()).toEqual({ sinceRevision: 4, changes: [] });
    });

    it('merges when the account becomes signed in', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };

      await TestBed.inject(AccountStore).refreshSession();
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(api.requests).toHaveLength(1);
      expect(lastRequest().changes).toHaveLength(1);
    });
  });

  describe('taking what the account holds', () => {
    it('writes a record only the account has, with the account’s revision', async () => {
      api.answers.push(
        accepted({
          accountRevision: 21,
          records: [{ revision: 21, record: renamed(REMOTE_ONLY_ID, 'Elsewhere') }],
        }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(REMOTE_ONLY_ID)).toMatchObject({
        name: 'Elsewhere',
        format: 'ednb.local-record',
      });
      expect(remoteRevisionOf(commanderState(), REMOTE_ONLY_ID)).toBe(21);
    });

    it('leaves a record this version cannot open remote and unopened', async () => {
      const unopenable = renamed(REMOTE_ONLY_ID, 'Unknown hull');
      api.answers.push(
        accepted({
          accountRevision: 3,
          records: [
            {
              revision: 3,
              record: {
                ...unopenable,
                build: { ...unopenable.build, shipSymbol: 'Nonexistent_Hull' },
              },
            },
          ],
        }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(REMOTE_ONLY_ID)).toBeNull();
      expect(store.unreadable()).toEqual([REMOTE_ONLY_ID]);
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(3);
    });

    it('lists a streamed record of an unsupported version without refusing the response', async () => {
      api.answers.push(
        accepted({
          accountRevision: 4,
          unreadableRecords: [{ revision: 4, id: FIXTURE_IDS.unsupported }],
        }),
      );

      await store.synchronise(CREDENTIALS);

      expect(store.unreadable()).toEqual([FIXTURE_IDS.unsupported]);
    });

    it('ignores a result no change in this request asked for', async () => {
      api.answers.push(
        accepted({
          accountRevision: 2,
          results: [
            {
              index: 4,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 2,
              remote: null,
              code: null,
            },
            {
              index: 0,
              outcome: 'not-applied',
              id: null,
              revision: null,
              remote: null,
              code: null,
            },
          ],
        }),
      );

      await store.synchronise(CREDENTIALS);

      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(2);
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBeNull();
    });

    it('never takes the account’s version of a record this browser has cancelled', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      writeState({ recordBindings: { [FIXTURE_IDS.named]: 'local-only' } });
      api.answers.push(
        accepted({
          accountRevision: 8,
          records: [{ revision: 8, record: renamed(FIXTURE_IDS.named, 'The account’s version') }],
        }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).toMatchObject({ name: 'Anaconda explorer' });
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe('local-only');
    });
  });

  describe('when the service cannot be reached', () => {
    it('keeps the local record, keeps the change pending and states the failure', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push({ kind: 'unavailable' });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(store.status()).toEqual({
        kind: 'failed',
        failure: { reason: 'offline' },
        changes: 1,
      });
      expect(commanderState().pendingOperations).toHaveLength(1);
      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(0);
    });

    it('states that a change is pending before it has been sent', () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);

      expect(store.status()).toEqual({ kind: 'pending', changes: 1 });
    });

    it('states a session that has gone without touching local work', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push({
        kind: 'refused',
        status: 401,
        code: 'unauthorised',
        accountRevision: null,
        results: [],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({ failure: { reason: 'signed-out' } });
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('states a service failure and keeps every change pending', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push({
        kind: 'refused',
        status: 500,
        code: 'synchronisation-failed',
        accountRevision: null,
        results: [],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({ failure: { reason: 'service' }, changes: 1 });
    });
  });

  describe('a response that was committed and lost', () => {
    it('retries the same write and creates no second record or revision', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push({ kind: 'unavailable' });
      api.answers.push(
        accepted({
          accountRevision: 5,
          results: [
            {
              index: 0,
              outcome: 'unchanged',
              id: FIXTURE_IDS.named,
              revision: 5,
              remote: null,
              code: null,
            },
          ],
          records: [{ revision: 5, record: remoteOf(NAMED_RECORD_V1, FIXTURE_IDS.named) }],
        }),
      );

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);
      await store.synchronise(CREDENTIALS);

      expect(api.requests).toHaveLength(2);
      expect(api.requests[0]?.changes).toEqual(api.requests[1]?.changes);
      expect(api.requests[1]?.sinceRevision).toBe(0);
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(5);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBe(5);
      expect(commanderState().pendingOperations).toHaveLength(0);
      expect(
        [...storage.entries.keys()].filter((key) => key.startsWith('ednb:record:')),
      ).toHaveLength(1);
    });
  });

  describe('a local commit that is interrupted', () => {
    it('leaves the cursor where it was when a record cannot be written', async () => {
      api.answers.push(
        accepted({
          accountRevision: 7,
          records: [{ revision: 7, record: renamed(REMOTE_ONLY_ID, 'Elsewhere') }],
        }),
      );
      api.onRequest = () => {
        storage.writeError = quotaError();
      };

      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({ failure: { reason: 'storage' } });
      expect(storage.entries.has(EDNB_COMMANDER_STATE_KEY)).toBe(false);
    });

    it('keeps the change pending when the cursor itself cannot be written', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      api.answers.push(
        accepted({
          accountRevision: 5,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 5,
              remote: null,
              code: null,
            },
          ],
        }),
      );
      api.onRequest = () => {
        storage.writeError = quotaError();
      };

      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({ failure: { reason: 'storage' } });
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(0);
      expect(commanderState().pendingOperations).toHaveLength(1);

      storage.writeError = null;
      api.answers.push(
        accepted({
          accountRevision: 5,
          results: [
            {
              index: 0,
              outcome: 'unchanged',
              id: FIXTURE_IDS.named,
              revision: 5,
              remote: null,
              code: null,
            },
          ],
        }),
      );
      api.onRequest = null;
      await store.synchronise(CREDENTIALS);

      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(5);
      expect(commanderState().pendingOperations).toHaveLength(0);
    });
  });

  describe('a stale write', () => {
    function staleConflict(): Extract<SynchronisationResponse, { kind: 'refused' }> {
      return {
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 9,
        results: [
          {
            index: 0,
            outcome: 'conflict',
            id: FIXTURE_IDS.named,
            revision: 9,
            remote: { kind: 'record', record: renamed(FIXTURE_IDS.named, 'The account’s version') },
            code: null,
          },
        ],
      };
    }

    beforeEach(() => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 4 },
        recordBindings: { [FIXTURE_IDS.named]: CREDENTIALS.customerId },
        recordRevisions: { [FIXTURE_IDS.named]: 4 },
      });
      api.answers.push(staleConflict());
    });

    async function raise(): Promise<void> {
      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);
    }

    it('offers the conflict and loses neither version', async () => {
      const refusal = staleConflict();
      api.answers.length = 0;
      api.answers.push({
        ...refusal,
        results: [
          ...refusal.results,
          { index: 1, outcome: 'not-applied', id: null, revision: null, remote: null, code: null },
        ],
      });
      await raise();

      expect(store.conflicts()).toMatchObject([
        { recordId: FIXTURE_IDS.named, kind: 'stale-write', remoteRevision: 9, claimed: false },
      ]);
      expect(store.status()).toEqual({ kind: 'conflicted', conflicts: 1 });
      expect(storedRecord(FIXTURE_IDS.named)).toMatchObject({ name: 'Anaconda explorer' });
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(4);
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('sends nothing more for a record whose conflict stands', async () => {
      await raise();
      api.answers.push(accepted({ accountRevision: 9 }));

      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
    });

    it('overwrites against the revision the account holds now', async () => {
      await raise();
      api.answers.push(
        accepted({
          accountRevision: 10,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 10,
              remote: null,
              code: null,
            },
          ],
        }),
      );

      await expect(store.resolve(FIXTURE_IDS.named, 'overwrite', CREDENTIALS)).resolves.toEqual({
        kind: 'overwritten',
        recordId: FIXTURE_IDS.named,
      });

      expect(lastRequest().changes).toEqual([
        expect.objectContaining({ type: 'write', baseRevision: 9 }),
      ]);
      expect(store.conflicts()).toHaveLength(0);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBe(10);
    });

    it('keeps both by minting an identity for this browser’s version', async () => {
      await raise();
      api.answers.push(accepted({ accountRevision: 9 }));

      const resolution = await store.resolve(FIXTURE_IDS.named, 'keep-both', CREDENTIALS);

      expect(resolution.kind).toBe('kept-both');
      const copiedTo = resolution.kind === 'kept-both' ? resolution.copiedTo : '';
      expect(copiedTo).not.toBe(FIXTURE_IDS.named);
      expect(storedRecord(copiedTo)).toMatchObject({ name: 'Anaconda explorer' });
      expect(storedRecord(FIXTURE_IDS.named)).toMatchObject({ name: 'The account’s version' });
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBe(9);
      expect(lastRequest().changes).toEqual([
        expect.objectContaining({ type: 'write', baseRevision: null }),
      ]);
      expect(store.conflicts()).toHaveLength(0);
    });

    it('cancels by keeping both versions and making the local copy local-only', async () => {
      await raise();

      await expect(store.resolve(FIXTURE_IDS.named, 'cancel', CREDENTIALS)).resolves.toEqual({
        kind: 'cancelled',
        recordId: FIXTURE_IDS.named,
      });

      expect(storedRecord(FIXTURE_IDS.named)).toMatchObject({ name: 'Anaconda explorer' });
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe('local-only');
      expect(commanderState().pendingOperations).toHaveLength(0);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBeNull();
      expect(store.conflicts()).toHaveLength(0);
    });

    it('leaves the conflict standing when a copy cannot be written', async () => {
      await raise();
      storage.writeError = quotaError();

      await expect(store.resolve(FIXTURE_IDS.named, 'keep-both', CREDENTIALS)).resolves.toEqual({
        kind: 'failed',
        recordId: FIXTURE_IDS.named,
      });
      expect(store.conflicts()).toHaveLength(1);
    });

    it('leaves the conflict standing when cancelling cannot be written', async () => {
      await raise();
      storage.writeError = quotaError();

      await expect(store.resolve(FIXTURE_IDS.named, 'cancel', CREDENTIALS)).resolves.toEqual({
        kind: 'failed',
        recordId: FIXTURE_IDS.named,
      });
      expect(store.conflicts()).toHaveLength(1);
    });

    it('answers nothing for an identity with no conflict standing', async () => {
      await expect(store.resolve(FIXTURE_IDS.working, 'overwrite', CREDENTIALS)).resolves.toEqual({
        kind: 'unknown',
      });
    });

    it('states a conflict whose remote version this browser cannot read', async () => {
      api.answers.length = 0;
      api.answers.push({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 9,
        results: [
          {
            index: 0,
            outcome: 'conflict',
            id: FIXTURE_IDS.named,
            revision: 9,
            remote: { kind: 'unreadable' },
            code: null,
          },
        ],
      });

      await raise();

      expect(store.conflicts()).toMatchObject([
        { kind: 'stale-write', remote: null, remoteUnreadable: true },
      ]);
    });
  });

  describe('a record the account no longer holds', () => {
    beforeEach(() => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 4 },
        recordBindings: { [FIXTURE_IDS.named]: CREDENTIALS.customerId },
        recordRevisions: { [FIXTURE_IDS.named]: 4 },
      });
    });

    it('removes an unchanged copy no live page claims', async () => {
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).toBeNull();
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBeNull();
      expect(store.conflicts()).toHaveLength(0);
    });

    it('removes an unchanged copy whose renewal the account refused', async () => {
      api.answers.push({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 8,
        results: [
          {
            index: 0,
            outcome: 'conflict',
            id: FIXTURE_IDS.named,
            revision: 8,
            remote: { kind: 'deleted' },
            code: null,
          },
        ],
      });

      store.renewProtection(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).toBeNull();
      expect(commanderState().pendingOperations).toHaveLength(0);
    });

    it('leaves a cancelled copy alone when the account’s marker arrives', async () => {
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 4 },
        recordBindings: { [FIXTURE_IDS.named]: 'local-only' },
      });
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe('local-only');
    });

    it('leaves the cursor where it was when a removal cannot be written', async () => {
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );
      api.onRequest = () => {
        storage.removeError = quotaError();
      };

      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({ failure: { reason: 'storage' } });
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(4);
      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
    });

    it('keeps a live page’s unchanged work, pauses its autosave and states the conflict', async () => {
      claim(FIXTURE_IDS.named);
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );

      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(store.isPaused(FIXTURE_IDS.named)).toBe(true);
      expect(store.pausedRecords()).toEqual([FIXTURE_IDS.named]);
      expect(store.conflicts()).toMatchObject([
        { kind: 'remote-deletion', remoteRevision: 8, claimed: true },
      ]);
    });

    it('restores the record under its old identity on explicit resume', async () => {
      claim(FIXTURE_IDS.named);
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );
      await store.synchronise(CREDENTIALS);
      api.answers.push(
        accepted({
          accountRevision: 9,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 9,
              remote: null,
              code: null,
            },
          ],
        }),
      );

      await expect(store.resume(FIXTURE_IDS.named, CREDENTIALS)).resolves.toMatchObject({
        kind: 'overwritten',
      });

      expect(lastRequest().changes).toEqual([
        expect.objectContaining({ type: 'write', baseRevision: 8 }),
      ]);
      expect(lastRequest().changes[0]).toMatchObject({
        record: expect.objectContaining({ id: FIXTURE_IDS.named }),
      });
      expect(store.isPaused(FIXTURE_IDS.named)).toBe(false);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.named)).toBe(9);
    });

    it('keeps a changed copy and states the conflict', async () => {
      api.answers.push({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 8,
        results: [
          {
            index: 0,
            outcome: 'conflict',
            id: FIXTURE_IDS.named,
            revision: 8,
            remote: { kind: 'deleted' },
            code: null,
          },
        ],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(store.conflicts()).toMatchObject([
        { kind: 'remote-deletion', claimed: false, remoteRevision: 8 },
      ]);
    });

    it('keeps both by leaving the marker and minting an identity', async () => {
      api.answers.push({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 8,
        results: [
          {
            index: 0,
            outcome: 'conflict',
            id: FIXTURE_IDS.named,
            revision: 8,
            remote: { kind: 'deleted' },
            code: null,
          },
        ],
      });
      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);
      api.answers.push(accepted({ accountRevision: 8 }));

      const resolution = await store.resolve(FIXTURE_IDS.named, 'keep-both', CREDENTIALS);
      const copiedTo = resolution.kind === 'kept-both' ? resolution.copiedTo : '';

      expect(storedRecord(copiedTo)).toMatchObject({ name: 'Anaconda explorer' });
      expect(storedRecord(FIXTURE_IDS.named)).toBeNull();
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBeNull();
      expect(lastRequest().changes).toEqual([
        expect.objectContaining({ type: 'write', baseRevision: null }),
      ]);
      expect(lastRequest().changes.every((change) => change.type !== 'delete')).toBe(true);
    });

    it('cancels by leaving the marker and making the local copy local-only', async () => {
      claim(FIXTURE_IDS.named);
      api.answers.push(
        accepted({ accountRevision: 8, tombstones: [{ id: FIXTURE_IDS.named, revision: 8 }] }),
      );
      await store.synchronise(CREDENTIALS);

      await expect(store.resolve(FIXTURE_IDS.named, 'cancel', CREDENTIALS)).resolves.toEqual({
        kind: 'cancelled',
        recordId: FIXTURE_IDS.named,
      });

      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe('local-only');
      expect(commanderState().pendingOperations).toHaveLength(0);
      expect(store.isPaused(FIXTURE_IDS.named)).toBe(false);
    });
  });

  describe('deleting a record', () => {
    it('sends the deletion and forgets what the account held', async () => {
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 4 },
        recordBindings: { [FIXTURE_IDS.named]: CREDENTIALS.customerId },
        recordRevisions: { [FIXTURE_IDS.named]: 4 },
      });
      api.answers.push(
        accepted({
          accountRevision: 5,
          results: [
            {
              index: 0,
              outcome: 'applied',
              id: FIXTURE_IDS.named,
              revision: 5,
              remote: null,
              code: null,
            },
          ],
          tombstones: [{ id: FIXTURE_IDS.named, revision: 5 }],
        }),
      );

      store.queueDelete(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toEqual([
        { type: 'delete', id: FIXTURE_IDS.named, baseRevision: 4 },
      ]);
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBeNull();
      expect(commanderState().pendingOperations).toHaveLength(0);
    });

    it('answers a queued upload for a record that is gone from this browser', async () => {
      writeState({
        pendingOperations: [
          {
            id: 'operation-1',
            customerId: CREDENTIALS.customerId,
            recordId: FIXTURE_IDS.named,
            kind: 'upload',
            baseRevision: null,
            queuedAt: '2026-03-01T00:00:00.000Z',
          },
        ],
      });

      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toHaveLength(0);
      expect(commanderState().pendingOperations).toHaveLength(0);
    });
  });

  describe('what the service refuses', () => {
    beforeEach(() => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
    });

    it('keeps a record another account holds local, with nothing queued', async () => {
      api.answers.push({
        kind: 'refused',
        status: 403,
        code: 'cross-account-record',
        accountRevision: 2,
        results: [
          {
            index: 0,
            outcome: 'refused',
            id: FIXTURE_IDS.named,
            revision: null,
            remote: null,
            code: 'cross-account-record',
          },
        ],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(storedRecord(FIXTURE_IDS.named)).not.toBeNull();
      expect(recordBinding(commanderState(), FIXTURE_IDS.named)).toBe('local-only');
      expect(commanderState().pendingOperations).toHaveLength(0);
      expect(store.status()).toMatchObject({
        failure: { reason: 'refused', code: 'cross-account-record', recordId: FIXTURE_IDS.named },
      });
    });

    it('states the bound a request exceeded and keeps the change pending', async () => {
      api.answers.push({
        kind: 'refused',
        status: 400,
        code: 'record-too-large',
        accountRevision: null,
        results: [
          {
            index: 0,
            outcome: 'refused',
            id: FIXTURE_IDS.named,
            revision: null,
            remote: null,
            code: 'record-too-large',
          },
        ],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({
        failure: { reason: 'bound', bound: 'record-too-large', recordId: FIXTURE_IDS.named },
        changes: 1,
      });
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('stops offering a record the service will not read, and says why', async () => {
      api.answers.push({
        kind: 'refused',
        status: 400,
        code: 'invalid-record',
        accountRevision: null,
        results: [
          {
            index: 0,
            outcome: 'refused',
            id: FIXTURE_IDS.named,
            revision: null,
            remote: null,
            code: 'invalid-record',
          },
        ],
      });

      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);
      api.answers.push(accepted());
      await store.synchronise(CREDENTIALS);

      expect(store.status()).toMatchObject({
        failure: { reason: 'refused', code: 'invalid-record' },
      });
      expect(lastRequest().changes).toHaveLength(0);
      expect(commanderState().pendingOperations).toHaveLength(1);
    });
  });

  describe('protection renewal', () => {
    beforeEach(() => {
      seed(WORKING_RECORD_V1, FIXTURE_IDS.working);
      writeState({
        accountCursors: { [CREDENTIALS.customerId]: 2 },
        recordBindings: { [FIXTURE_IDS.working]: CREDENTIALS.customerId },
        recordRevisions: { [FIXTURE_IDS.working]: 2 },
      });
    });

    it('renews once a day and no more often', async () => {
      api.answers.push(
        accepted({
          accountRevision: 2,
          results: [
            {
              index: 0,
              outcome: 'unchanged',
              id: FIXTURE_IDS.working,
              revision: 2,
              remote: null,
              code: null,
            },
          ],
        }),
      );

      store.renewProtection(FIXTURE_IDS.working, CREDENTIALS.customerId);
      store.renewProtection(FIXTURE_IDS.working, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toEqual([{ type: 'renew', id: FIXTURE_IDS.working }]);
      expect(accountCursor(commanderState(), CREDENTIALS.customerId)).toBe(2);
      expect(remoteRevisionOf(commanderState(), FIXTURE_IDS.working)).toBe(2);
    });

    it('renews again on the next day', async () => {
      store.renewProtection(FIXTURE_IDS.working, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);
      clock.instant = new Date('2026-03-02T00:00:01.000Z');

      store.renewProtection(FIXTURE_IDS.working, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      expect(lastRequest().changes).toEqual([{ type: 'renew', id: FIXTURE_IDS.working }]);
    });

    it('queues nothing for a local-only record', () => {
      writeState({ recordBindings: { [FIXTURE_IDS.working]: 'local-only' } });

      store.queueUpload(FIXTURE_IDS.working, CREDENTIALS.customerId);

      expect(commanderState().pendingOperations).toHaveLength(0);
    });
  });

  describe('the triggers a record path calls', () => {
    beforeEach(async () => {
      // Signed in first, with nothing to merge, so each trigger is the only
      // thing the exchange after it carries.
      api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
      await TestBed.inject(AccountStore).refreshSession();
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.requests.length = 0;
    });

    it('sends a saved record', async () => {
      await store.recordSaved(FIXTURE_IDS.named);

      expect(lastRequest().changes).toEqual([expect.objectContaining({ type: 'write' })]);
    });

    it('sends a deleted record', async () => {
      await store.recordDeleted(FIXTURE_IDS.named);

      expect(lastRequest().changes).toEqual([
        { type: 'delete', id: FIXTURE_IDS.named, baseRevision: null },
      ]);
    });

    it('renews a live page’s record', async () => {
      await store.recordLive(FIXTURE_IDS.named);

      expect(lastRequest().changes).toEqual([{ type: 'renew', id: FIXTURE_IDS.named }]);
    });

    it('pulls on an explicit retry', async () => {
      await store.refresh();

      expect(lastRequest().changes).toHaveLength(0);
    });
  });

  describe('while the browser is anonymous', () => {
    it('queues nothing and asks for nothing', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);

      await store.recordSaved(FIXTURE_IDS.named);
      await store.recordDeleted(FIXTURE_IDS.named);
      await store.recordLive(FIXTURE_IDS.named);
      await store.refresh();

      expect(api.requests).toHaveLength(0);
      expect(storage.entries.has(EDNB_COMMANDER_STATE_KEY)).toBe(false);
    });
  });

  describe('what this page states', () => {
    it('forgets its own state when the account goes', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      api.answers.push({ kind: 'unavailable' });
      store.queueUpload(FIXTURE_IDS.named, CREDENTIALS.customerId);
      await store.synchronise(CREDENTIALS);

      store.signedOut();

      expect(store.status()).toEqual({ kind: 'inactive' });
      expect(store.conflicts()).toHaveLength(0);
      expect(store.hasConflicts()).toBe(false);
      expect(commanderState().pendingOperations).toHaveLength(1);
    });

    it('runs one exchange at a time', async () => {
      api.answers.push(accepted({ accountRevision: 1 }));

      await Promise.all([store.synchronise(CREDENTIALS), store.synchronise(CREDENTIALS)]);

      expect(api.requests).toHaveLength(1);
    });
  });
});
