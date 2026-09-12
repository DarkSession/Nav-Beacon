import { TestBed } from '@angular/core/testing';
import {
  parseCommanderLocalState,
  type PendingRemoteOperation,
} from '../../domain/commander/commander-local-state';
import { FIXTURE_IDS, NAMED_RECORD_V1 } from '../../domain/records/fixtures/records';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { EDNB_COMMANDER_STATE_KEY, recordKey } from '../../platform/storage/storage-keys';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { AccountStore } from '../account/account.store';
import { RecordSynchronisationLoader } from './record-synchronisation.loader';
import { RecordSynchronisationStore } from './record-synchronisation.store';
import {
  ACCOUNT,
  CUSTOMER,
  FakeCommanderApi,
  OTHER_CUSTOMER,
  changesOfKind,
  MovableClock,
  SequentialUuid,
  SwitchableConnectivity,
  settle,
  signIn as signInWith,
  writeCommanderState,
} from './synchronisation.spec-helpers';

/**
 * Reaching the synchronisation engine, and when.
 *
 * The engine arrives with the session rather than with the first payload of
 * every page, so what these tests read is the service: an anonymous browser
 * asks it for nothing at all, and a Commander becoming signed in is what brings
 * the engine in, from whatever page they are on (constitution I, 020/FR-007,
 * 020/FR-008).
 */
describe('reaching the record synchronisation engine', () => {
  let storage: MemoryStorage;
  let api: FakeCommanderApi;
  let stop: (() => void) | null;

  beforeEach(() => {
    storage = new MemoryStorage();
    api = new FakeCommanderApi();
    stop = null;

    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage, new MemoryStorage()),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: new MovableClock() },
        { provide: UuidAdapter, useClass: SequentialUuid },
        { provide: ConnectivityAdapter, useValue: new SwitchableConnectivity() },
      ],
    });
  });

  afterEach(() => {
    stop?.();
    TestBed.resetTestingModule();
  });

  it('asks the service for nothing at all while the browser is anonymous', async () => {
    const loader = TestBed.inject(RecordSynchronisationLoader);
    stop = loader.start();

    await loader.recordSaved(FIXTURE_IDS.named);
    await loader.recordDeleted(FIXTURE_IDS.named);
    const resumed = await loader.resumeRecord(FIXTURE_IDS.named);
    await settle();

    expect(resumed).toEqual({ kind: 'unknown' });
    expect(api.requests).toHaveLength(0);
  });

  it('exchanges the account’s records from whatever page a Commander signs in on', async () => {
    writeCommanderState(storage);
    stop = TestBed.inject(RecordSynchronisationLoader).start();
    await settle();
    expect(api.requests).toHaveLength(0);

    await signInWith(api);

    expect(api.requests.length).toBeGreaterThan(0);
  });

  it('holds no record back before the engine has answered', () => {
    expect(TestBed.inject(RecordSynchronisationLoader).pausedRecords()).toEqual([]);
  });

  /**
   * Queueing is one write to browser storage and needs no engine, so a change
   * made while the engine's chunk is still on its way is written before that
   * chunk is waited for. A chunk that never arrives then leaves a real pending
   * operation for the next trigger to send; waiting for it would leave the
   * record changed here with nothing at all waiting to offer it, and nothing
   * rescans browser storage later (020/FR-011, 020/FR-026).
   */
  it.each([
    [
      'a save',
      (loader: RecordSynchronisationLoader) => loader.recordSaved(FIXTURE_IDS.named),
      'upload',
    ],
    [
      'a deletion',
      (loader: RecordSynchronisationLoader) => loader.recordDeleted(FIXTURE_IDS.named),
      'delete',
    ],
  ])(
    'queues what %s owes the account before the engine has arrived',
    async (_case, trigger, kind) => {
      writeCommanderState(storage);
      api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
      await TestBed.inject(AccountStore).refreshSession();
      const loader = TestBed.inject(RecordSynchronisationLoader);

      const triggered = trigger(loader);

      expect(pendingOperations()).toMatchObject([
        { recordId: FIXTURE_IDS.named, kind, customerId: CUSTOMER },
      ]);
      await triggered;
      await settle();
    },
  );

  /**
   * An expired Frontier authorisation stops the fleet and nothing else. The
   * record exchange reaches this browser's own service, whose session and
   * anti-forgery token both still stand, so a save made in that window is
   * still the account's — and nothing rescans browser storage later
   * (020/FR-011, constitution IV).
   */
  it('queues what a save owes while the Frontier authorisation has expired', async () => {
    writeCommanderState(storage);
    api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
    const account = TestBed.inject(AccountStore);
    await account.refreshSession();
    account.markAuthorisationExpired();

    const triggered = TestBed.inject(RecordSynchronisationLoader).recordSaved(FIXTURE_IDS.named);

    expect(pendingOperations()).toMatchObject([
      { recordId: FIXTURE_IDS.named, kind: 'upload', customerId: CUSTOMER },
    ]);
    await triggered;
    await settle();
  });

  /**
   * The engine is a chunk, and a chunk can fail to arrive. What the save owes
   * the account is already in the queue, which is what the next trigger sends.
   * A save that queued nothing would leave the record diverged from the account
   * with nothing at all to retry, and nothing rescans browser storage later
   * (020/FR-011, 020/FR-026).
   */
  it('leaves what a save owes in the queue when the engine never arrives', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RecordSynchronisationStore,
          useFactory: (): never => {
            throw new Error('The engine chunk did not arrive.');
          },
        },
      ],
    });
    writeCommanderState(storage);
    api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
    await TestBed.inject(AccountStore).refreshSession();

    await TestBed.inject(RecordSynchronisationLoader).recordSaved(FIXTURE_IDS.named);
    await settle();

    expect(pendingOperations()).toMatchObject([
      { recordId: FIXTURE_IDS.named, kind: 'upload', customerId: CUSTOMER },
    ]);
    expect(api.requests).toHaveLength(0);
  });

  /**
   * A Commander who signs out keeps planning, and that work is still the
   * account's where the account already holds the record: the binding, the
   * cursor and the queue all stay in browser storage for the same Commander to
   * carry on from. The queued operation carries the revision the record was
   * last in sync at, so another device's write or deletion meets it as the
   * conflict it is rather than replacing it without a word (020/FR-009,
   * 020/FR-010, 020/FR-011, constitution IV).
   */
  it.each([
    ['the account that has just left it', CUSTOMER],
    ['whichever Commander holds it', OTHER_CUSTOMER],
  ])('queues a save made without a session under %s', async (_case, customerId) => {
    writeCommanderState(storage, {
      account: null,
      recordBindings: { [FIXTURE_IDS.named]: customerId },
      recordRevisions: { [FIXTURE_IDS.named]: 4 },
    });
    const loader = TestBed.inject(RecordSynchronisationLoader);
    stop = loader.start();

    await loader.recordSaved(FIXTURE_IDS.named);
    await settle();

    expect(pendingOperations()).toMatchObject([
      { recordId: FIXTURE_IDS.named, kind: 'upload', customerId, baseRevision: 4 },
    ]);
    expect(api.requests).toHaveLength(0);
  });

  /**
   * Taking a record out of a Commander's account is an instruction rather than
   * work to preserve, and a browser with no session has not been given one. A
   * record no account holds and a cancelled one are nobody's to queue either
   * (constitution I, 020/FR-007, 020/FR-024).
   */
  it.each([
    [
      'a deletion made without a session',
      { recordBindings: { [FIXTURE_IDS.named]: CUSTOMER } },
      (loader: RecordSynchronisationLoader) => loader.recordDeleted(FIXTURE_IDS.named),
    ],
    [
      'a save to a record no account holds',
      {},
      (loader: RecordSynchronisationLoader) => loader.recordSaved(FIXTURE_IDS.named),
    ],
    [
      'a save to a cancelled record',
      { recordBindings: { [FIXTURE_IDS.named]: 'local-only' } },
      (loader: RecordSynchronisationLoader) => loader.recordSaved(FIXTURE_IDS.named),
    ],
  ])('queues nothing for %s', async (_case, state, trigger) => {
    writeCommanderState(storage, { account: null, ...state });
    const loader = TestBed.inject(RecordSynchronisationLoader);
    stop = loader.start();

    await trigger(loader);
    await settle();

    expect(pendingOperations()).toHaveLength(0);
    expect(api.requests).toHaveLength(0);
  });

  /**
   * Browser storage can refuse the queue write. The engine is then asked to
   * offer the record itself rather than to take up a change that is not there,
   * because taking up nothing would leave this browser saying the account holds
   * a revision it was never sent (020/FR-011, 020/FR-026).
   */
  it('does not hand the engine a change browser storage refused to queue', async () => {
    writeCommanderState(storage);
    storage.entries.set(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
    api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
    await TestBed.inject(AccountStore).refreshSession();
    storage.writeError = quotaError();

    const triggered = TestBed.inject(RecordSynchronisationLoader).recordSaved(FIXTURE_IDS.named);
    // The queue write this trigger made without the engine has already been
    // refused by here; what follows is the engine's own turn at it.
    storage.writeError = null;
    await triggered;
    await settle();

    expect(changesOfKind(api, 'write')).toContain(FIXTURE_IDS.named);
  });

  function pendingOperations(): readonly PendingRemoteOperation[] {
    const raw = storage.entries.get(EDNB_COMMANDER_STATE_KEY);
    const parsed = raw === undefined ? null : parseCommanderLocalState(JSON.parse(raw));
    if (parsed === null) {
      throw new Error('The Commander state did not read.');
    }
    return parsed.pendingOperations;
  }
});
