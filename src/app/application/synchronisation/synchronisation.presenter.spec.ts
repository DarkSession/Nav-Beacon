import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FIXTURE_IDS,
  NAMED_RECORD_V1,
  WORKING_RECORD_V1,
} from '../../domain/records/fixtures/records';
import type { LocalRecord } from '../../domain/records/local-record';
import type {
  ChangeResult,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';
import { toRemoteRecord } from '../../domain/records/remote-record.serializer';
import { decodeAndMigrate } from '../../domain/ships/build/record-migrations';
import { provideLocalization } from '../../i18n/i18n.providers';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { recordKey } from '../../platform/storage/storage-keys';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { AccountStore } from '../account/account.store';
import { RecordInvalidationService } from '../build-library/record-invalidation.service';
import { RetentionService } from '../build-library/retention.service';
import { RecordSynchronisationStore } from './record-synchronisation.store';
import { SynchronisationPresenter } from './synchronisation.presenter';
import {
  ACCOUNT,
  CUSTOMER,
  FakeCommanderApi,
  MovableClock,
  OTHER_CUSTOMER,
  SequentialUuid,
  SwitchableConnectivity,
  settle,
  signIn,
  writeCommanderState,
} from './synchronisation.spec-helpers';

/**
 * The two settled sentences, up to the instant each of them carries.
 *
 * Read from the catalogue and compared by their opening words, so a test states
 * which of the two the panel chose rather than restating either one here. Both
 * begin the same way, which is why the whole-device sentence is checked for as
 * well as against (020/FR-011).
 */
function partialSentence(): string {
  return BUNDLED_ENGLISH['sync.status.current.partial'].split('{{when}}')[0];
}

function wholeSentence(): string {
  return BUNDLED_ENGLISH['sync.status.current'].split('{{when}}')[0];
}

/** One refusal that names a record the account no longer holds. */
function deletionConflict(): SynchronisationResponse {
  return conflictRefusal({ kind: 'deleted' });
}

/**
 * One refusal that names a record both sides changed.
 *
 * The account's copy comes back with the refusal, which is what makes this a
 * stale write rather than a deletion: there are two versions to choose between
 * (020/FR-010).
 */
function staleConflict(): SynchronisationResponse {
  const account = toRemoteRecord(decoded(NAMED_RECORD_V1, FIXTURE_IDS.named));
  return conflictRefusal({
    kind: 'record',
    record:
      account.tool === 'ship'
        ? { ...account, build: { ...account.build, shipName: 'The account\u2019s version' } }
        : account,
  });
}

/** The refusal both conflicts arrive in, differing only in what the account holds. */
function conflictRefusal(remote: ChangeResult['remote']): SynchronisationResponse {
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
        remote,
        code: null,
      },
    ],
  };
}

/** One fixture, decoded, so a remote copy of it can be built. */
function decoded(bytes: string, id: string): LocalRecord {
  const result = decodeAndMigrate(JSON.parse(bytes), id);
  if (!result.ok) {
    throw new Error('The fixture did not decode.');
  }
  return result.record;
}

/**
 * What the record libraries say about the account, in the Commander's language.
 *
 * Read through the real store, so each sentence is the one an actual exchange
 * produces rather than one a fixture asserts into place (020/FR-011).
 */
describe('what the record libraries say about the account', () => {
  let storage: MemoryStorage;
  let api: FakeCommanderApi;
  let clock: MovableClock;

  beforeEach(() => {
    storage = new MemoryStorage();
    api = new FakeCommanderApi();
    clock = new MovableClock();

    TestBed.configureTestingModule({
      providers: [
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        provideMemoryStorage(storage, new MemoryStorage()),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: clock },
        { provide: UuidAdapter, useClass: SequentialUuid },
        { provide: ConnectivityAdapter, useValue: new SwitchableConnectivity() },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function presenter(): SynchronisationPresenter {
    return TestBed.inject(SynchronisationPresenter);
  }

  /**
   * Signs in with the store already listening, and lets the first merge finish.
   *
   * The store is injected first on purpose: its first-sign-in merge is an
   * exchange of its own, and a test that scripts an answer before that has run
   * would be answering the merge rather than the exchange it is about.
   */
  async function signedIn(): Promise<RecordSynchronisationStore> {
    const store = TestBed.inject(RecordSynchronisationStore);
    await signIn(api);
    await settle();
    return store;
  }

  function seedRecord(): void {
    storage.entries.set(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
  }

  /**
   * Both fixture records, for a test that counts two of them.
   *
   * The panel counts the records this browser holds, so a binding is only half
   * of what makes one countable: the record it names has to be here.
   */
  function seedTwoRecords(): void {
    seedRecord();
    storage.entries.set(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1);
  }

  it('says the records stay in this browser while nobody is signed in', () => {
    const view = presenter().view;

    expect(view().heading).toBe(BUNDLED_ENGLISH['sync.title']);
    expect(view().status.message).toBe(BUNDLED_ENGLISH['sync.status.local-only']);
    expect(view().status.tone).toBe('info');
    expect(view().retry).toBeNull();
    expect(view().conflict).toBeNull();
  });

  /**
   * A browser that knows whose records these are and could not reach the
   * account is not a browser with nobody signed in.
   *
   * The frame beside this panel is drawing the Commander's name from the cached
   * account, and the account dialog says the service is unavailable. Telling
   * that Commander to sign in contradicts both and offers them nothing they can
   * act on (020/FR-022, constitution IV).
   */
  it('says the account could not be reached rather than asking a signed-in Commander to sign in', async () => {
    writeCommanderState(storage);
    seedRecord();
    api.session = { kind: 'unavailable' };

    await TestBed.inject(AccountStore).refreshSession();
    await settle();

    const view = presenter().view();
    expect(TestBed.inject(AccountStore).state().kind).toBe('offline');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['sync.status.unreachable']);
    expect(view.status.tone).toBe('warning');
  });

  /**
   * A browser that has never had an account reads the local-only sentence, not
   * the unreachable one: there is no account here that could not be reached.
   */
  it('still says the records stay here where an unreachable service has no account to name', async () => {
    seedRecord();
    api.session = { kind: 'unavailable' };

    await TestBed.inject(AccountStore).refreshSession();
    await settle();

    expect(presenter().view().status.message).toBe(BUNDLED_ENGLISH['sync.status.local-only']);
  });

  /**
   * A record kept in this browser only is on this device and is not in the
   * account, so the sentence that says the account has every record on this
   * device is not true while the note below it names one it does not have
   * (020/FR-011, 020/FR-024, constitution IV).
   */
  it('does not claim the account has every record while one is held back', async () => {
    writeCommanderState(storage, {
      recordBindings: { [FIXTURE_IDS.named]: 'local-only' },
    });
    seedRecord();
    await signedIn();

    const view = presenter().view();
    expect(view.status.message.startsWith(partialSentence())).toBe(true);
    expect(view.status.message.startsWith(wholeSentence())).toBe(false);
    expect(view.status.tone).toBe('success');
    expect(view.notes.map((note) => note.id)).toEqual(['local-only']);
  });

  /**
   * A record the first merge could not offer is held back as surely as one a
   * Commander kept here.
   *
   * Its bytes did not read, so nothing was queued for it and it took no
   * binding. The exchange settles with nothing outstanding, and the sentence
   * that says the account has every record on this device is not true over a
   * record the account was never told about (020/FR-011, 020/FR-012,
   * constitution IV).
   */
  it('does not claim the account has every record while one was never offered', async () => {
    writeCommanderState(storage, { accountCursors: {} });
    seedRecord();
    storage.entries.set(recordKey(FIXTURE_IDS.unsupported), 'not a record this browser can read');
    await signedIn();

    const view = presenter().view();
    expect(view.status.message.startsWith(partialSentence())).toBe(true);
    expect(view.status.message.startsWith(wholeSentence())).toBe(false);
    // Nothing is said about it here. The library above lists it and says there
    // why it cannot be opened, and a Commander cannot save again what nothing
    // can open (020/FR-012, constitution IV).
    expect(view.notes).toEqual([]);
  });

  /**
   * The count follows the records, not a listing taken once.
   *
   * An unnamed record whose seven days run out leaves this browser without an
   * account state write of its own: it carried no binding and no remote
   * revision, so there is nothing about it to forget. The panel that counted it
   * has to stop (020/FR-024, 020/FR-025).
   */
  /**
   * And the same when the record leaves from another page.
   *
   * The library list beside this panel re-reads storage on every invalidation,
   * so a panel that did not would go on counting a record whose row has gone
   * from the screen it sits under (020/FR-024).
   */
  it('stops counting a record another page deleted', async () => {
    writeCommanderState(storage, {
      recordBindings: { [FIXTURE_IDS.named]: CUSTOMER, [FIXTURE_IDS.working]: 'local-only' },
    });
    seedTwoRecords();
    await signedIn();

    const view = presenter().view;
    expect(view().notes.map((note) => note.id)).toEqual(['local-only']);

    const stop = TestBed.inject(RecordInvalidationService).listen();
    storage.entries.delete(recordKey(FIXTURE_IDS.working));
    TestBed.inject(DOCUMENT).defaultView?.dispatchEvent(
      new StorageEvent('storage', { key: recordKey(FIXTURE_IDS.working), newValue: null }),
    );
    stop();

    expect(view().notes).toEqual([]);
  });

  it('stops counting a record the account never took once it expires out of this browser', async () => {
    writeCommanderState(storage, { recordBindings: { [FIXTURE_IDS.named]: CUSTOMER } });
    seedRecord();
    storage.entries.set(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1);
    await signedIn();

    const view = presenter().view;
    expect(view().status.message.startsWith(partialSentence())).toBe(true);

    clock.advanceDays(8);
    TestBed.inject(RetentionService).sweep();

    expect(view().status.message.startsWith(wholeSentence())).toBe(true);
  });

  it('names the instant the account confirmed this device at', async () => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.tone).toBe('success');
    // The sentence carries an instant rather than the word "now", and nothing
    // claims the device is current before the service has said so.
    expect(view.status.message).toContain('Your account has every record on this device, as of');
    expect(view.status.message).not.toContain('{{when}}');
    expect(view.detail).toBeNull();
    expect(view.retry).toBeNull();
  });

  it('counts what is still waiting when the account answers nothing', async () => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();
    api.answers.push({
      kind: 'accepted',
      accountRevision: 5,
      results: [],
      records: [],
      unreadableRecords: [],
      tombstones: [],
    });

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.tone).toBe('warning');
    expect(view.status.message).toContain('1');
    expect(view.status.message).toContain('waiting to reach your account');
  });

  /**
   * The plural half of two counted sentences. Every count behind them is a
   * filtered length with no bound, so a singular-only form would tell a
   * Commander with two changes owed that "2 change waiting to reach your
   * account" — the application's own words, ungrammatical in both shipped
   * languages (constitution VI).
   */
  it('reads the plural of what is owed when more than one change is waiting', async () => {
    writeCommanderState(storage);
    seedRecord();
    storage.entries.set(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1);
    const store = await signedIn();
    api.answers.push({
      kind: 'accepted',
      accountRevision: 5,
      results: [],
      records: [],
      unreadableRecords: [],
      tombstones: [],
    });

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    store.queueUpload(FIXTURE_IDS.working, CUSTOMER);
    await store.refresh();
    await settle();

    expect(presenter().view().status.message).toBe(
      BUNDLED_ENGLISH['sync.status.pending.many'].replace('{{count}}', '2'),
    );
  });

  it('reads the plural of a note when more than one record is kept here alone', async () => {
    writeCommanderState(storage, {
      recordBindings: {
        [FIXTURE_IDS.named]: 'local-only',
        [FIXTURE_IDS.working]: 'local-only',
      },
    });
    seedTwoRecords();
    await signIn(api);

    const localOnly = presenter()
      .view()
      .notes.find((note) => note.id === 'local-only');
    expect(localOnly?.message).toBe(
      BUNDLED_ENGLISH['sync.note.local-only.many'].replace('{{count}}', '2'),
    );
  });

  it('says why an exchange failed, what is owed and offers another attempt', async () => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();
    api.answers.push({ kind: 'unavailable' });

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.tone).toBe('error');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['sync.status.failed.offline']);
    expect(view.detail).toContain('1');
    expect(view.retry).toBe(BUNDLED_ENGLISH['action.retry']);
  });

  /**
   * Three bounds are published, the service says which one it refused on, and
   * each gets its own sentence. One sentence for all three would tell a
   * Commander whose batch was too long that a record of theirs is too large,
   * which is a statement about their own data that is not true (020/FR-026,
   * constitution IV).
   */
  for (const [code, key] of [
    ['record-too-large', 'sync.status.failed.bound.record'],
    ['too-many-changes', 'sync.status.failed.bound.changes'],
    ['request-too-large', 'sync.status.failed.bound.request'],
  ] as const) {
    it(`names the ${code} bound rather than whichever one is nearest`, async () => {
      writeCommanderState(storage);
      seedRecord();
      const store = await signedIn();
      api.answers.push({
        kind: 'refused',
        status: code === 'request-too-large' ? 413 : 400,
        code,
        accountRevision: null,
        results: [],
      });

      store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
      await store.refresh();
      await settle();

      const view = presenter().view();
      expect(view.status.tone).toBe('error');
      expect(view.status.message).toBe(BUNDLED_ENGLISH[key]);
      expect(view.detail).toContain('1');
    });
  }

  it('asks the one question only a Commander can answer, by the record’s own name', async () => {
    writeCommanderState(storage, {
      recordBindings: { [FIXTURE_IDS.named]: CUSTOMER },
      recordRevisions: { [FIXTURE_IDS.named]: 4 },
    });
    seedRecord();
    const store = await signedIn();
    api.answers.push(deletionConflict());

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.conflict).not.toBeNull();
    expect(view.conflict!.title).toBe(BUNDLED_ENGLISH['sync.conflict.deleted.title']);
    expect(view.conflict!.description).toBe(BUNDLED_ENGLISH['sync.conflict.deleted.description']);
    expect(view.conflict!.recordLabel).toContain('Anaconda explorer');
    expect(view.conflict!.answers.map((answer) => answer.choice)).toEqual([
      'overwrite',
      'keep-both',
      'cancel',
    ]);
    expect(view.conflict!.answers.map((answer) => answer.label)).toEqual([
      BUNDLED_ENGLISH['sync.conflict.overwrite'],
      BUNDLED_ENGLISH['sync.conflict.keep-both'],
      BUNDLED_ENGLISH['sync.conflict.cancel'],
    ]);
    expect(view.status.message).toContain('needs your answer');
  });

  it('asks a different question where both sides still hold a version', async () => {
    writeCommanderState(storage, {
      recordBindings: { [FIXTURE_IDS.named]: CUSTOMER },
      recordRevisions: { [FIXTURE_IDS.named]: 4 },
    });
    seedRecord();
    const store = await signedIn();
    api.answers.push(staleConflict());

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    // Two versions exist, so the question is which one the account keeps —
    // not what happens to a record the account has already let go. Saying the
    // deletion sentence here would describe a loss that did not happen
    // (020/FR-010, constitution IV).
    const view = presenter().view();
    expect(view.conflict).not.toBeNull();
    expect(view.conflict!.title).toBe(BUNDLED_ENGLISH['sync.conflict.stale.title']);
    expect(view.conflict!.description).toBe(BUNDLED_ENGLISH['sync.conflict.stale.description']);
    expect(view.conflict!.recordLabel).toContain('Anaconda explorer');
    expect(view.conflict!.answers.map((answer) => answer.choice)).toEqual([
      'overwrite',
      'keep-both',
      'cancel',
    ]);
  });

  it('states the records it keeps for nobody and the ones it keeps for another account', async () => {
    writeCommanderState(storage, {
      recordBindings: {
        [FIXTURE_IDS.named]: 'local-only',
        [FIXTURE_IDS.working]: OTHER_CUSTOMER,
      },
    });
    seedTwoRecords();
    await signIn(api);

    const notes = presenter().view().notes;
    expect(notes.map((note) => note.id)).toEqual(['local-only', 'account-bound']);
    for (const note of notes) {
      // Every sentence says it in words; the tone repeats it and never replaces
      // it (011/FR-010).
      expect(note.message.length).toBeGreaterThan(0);
      expect(note.message).not.toContain('{{count}}');
    }
  });

  /**
   * The bindings deliberately outlive the session (020/FR-003), so after a
   * sign-out every one of them names an account this browser can no longer
   * compare against. Counting them as another Commander's tells a Commander
   * their own saved builds are somebody else's (constitution IV).
   */
  it('claims nothing about whose records these are while no account is known', () => {
    writeCommanderState(storage, {
      recordBindings: {
        [FIXTURE_IDS.named]: CUSTOMER,
        [FIXTURE_IDS.working]: OTHER_CUSTOMER,
      },
    });

    const notes = presenter().view().notes;
    expect(notes.map((note) => note.id)).not.toContain('account-bound');
  });

  /**
   * An unreachable service empties the credentials and leaves the cached
   * account where it is, and the records bound to that account are still that
   * Commander's (020/FR-022).
   */
  it('counts only the other account’s records while the service is unreachable', async () => {
    writeCommanderState(storage, {
      recordBindings: {
        [FIXTURE_IDS.named]: CUSTOMER,
        [FIXTURE_IDS.working]: OTHER_CUSTOMER,
      },
    });
    seedTwoRecords();
    await signIn(api);
    api.session = { kind: 'unavailable' };
    await TestBed.inject(AccountStore).refreshSession();
    await settle();

    const bound = presenter()
      .view()
      .notes.find((note) => note.id === 'account-bound');
    expect(bound?.message).toBe(BUNDLED_ENGLISH['sync.note.account-bound.one']);
  });

  it('says the account holds a record this version cannot open, without removing it', async () => {
    writeCommanderState(storage);
    const store = await signedIn();
    api.answers.push({
      kind: 'accepted',
      accountRevision: 7,
      results: [],
      records: [],
      unreadableRecords: [{ revision: 7, id: 'unknown-record' }],
      tombstones: [],
    });

    await store.refresh();
    await settle();

    const notes = presenter().view().notes;
    expect(notes.map((note) => note.id)).toContain('unsupported-version');
    expect(notes.find((note) => note.id === 'unsupported-version')?.tone).toBe('warning');
  });

  /**
   * Every remaining reason an exchange can fail, each with its own sentence.
   *
   * A Commander whose session ended, whose browser would not take a write and
   * whose record the service refused are three different situations with three
   * different answers, and one sentence for all of them would tell two of the
   * three something that is not so (020/FR-011, constitution IV).
   */
  it.each([
    [
      'an ended session',
      { kind: 'refused', status: 401, code: 'unauthorised', accountRevision: null, results: [] },
      'sync.status.failed.signed-out',
    ],
    [
      'a record the service would not take',
      {
        kind: 'refused',
        status: 400,
        code: 'invalid-record',
        accountRevision: null,
        results: [],
      },
      'sync.status.failed.refused',
    ],
    [
      'a refusal this browser has no sentence for',
      { kind: 'refused', status: 500, code: 'unknown', accountRevision: null, results: [] },
      'sync.status.failed.service',
    ],
  ] as const)('says why an exchange failed on %s', async (_case, answer, key) => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();
    api.answers.push(answer as SynchronisationResponse);

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.tone).toBe('error');
    expect(view.status.message).toBe(BUNDLED_ENGLISH[key]);
  });

  /**
   * The failure whose own cause takes the credentials away still says what
   * happened.
   *
   * A 401 means the session is gone, so the session read that follows it
   * answers anonymous and this browser holds no credentials any more. The
   * sentence belongs to the exchange that just failed, and putting the one for
   * a Commander who never signed in in its place would drop the only statement
   * of why (020/FR-003, 020/FR-011, constitution IV).
   */
  it('still says the session ended once the service confirms it is gone', async () => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();
    api.session = { kind: 'anonymous' };
    api.answers.push({
      kind: 'refused',
      status: 401,
      code: 'unauthorised',
      accountRevision: null,
      results: [],
    });

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    await store.refresh();
    await settle();

    expect(TestBed.inject(AccountStore).credentials()).toBeNull();
    const view = presenter().view();
    expect(view.status.tone).toBe('error');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['sync.status.failed.signed-out']);
    expect(view.detail).toContain('1');
    // Nothing left to press: an exchange needs the credentials this browser no
    // longer holds, so an offered retry would be a button that does nothing.
    expect(view.retry).toBeNull();
  });

  /**
   * A browser that will not take the write that takes a refused record out of
   * the next batch says so, rather than naming the record the service refused.
   * The queue keeps offering that record, so the failure a Commander can act on
   * is this browser's storage (020/FR-011, 020/FR-026).
   */
  it('says the browser would not take the write when the record cannot be set aside', async () => {
    writeCommanderState(storage);
    seedRecord();
    const store = await signedIn();
    api.answers.push({
      kind: 'refused',
      status: 409,
      code: 'cross-account-record',
      accountRevision: null,
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

    store.queueUpload(FIXTURE_IDS.named, CUSTOMER);
    storage.writeError = quotaError();
    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.tone).toBe('error');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['sync.status.failed.storage']);
  });

  /**
   * The first exchange of an account in this browser brings two sets of records
   * together; every later one carries what changed since. They are different
   * enough to a Commander watching them that they are different sentences
   * (020/FR-008).
   */
  it.each([
    ['brings the two sets together on the first exchange', {}, 'sync.status.merging'],
    [
      'carries what changed on every exchange after it',
      { accountCursors: { [CUSTOMER]: 4 } },
      'sync.status.synchronising',
    ],
  ] as const)('says it %s', async (_case, cursors, key) => {
    writeCommanderState(storage, { accountCursors: {}, ...cursors });
    seedRecord();
    TestBed.inject(RecordSynchronisationStore);
    let release = (): void => {};
    api.held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await signIn(api);

    const view = presenter().view();
    expect(view.status.tone).toBe('loading');
    expect(view.status.message).toBe(BUNDLED_ENGLISH[key]);

    release();
    api.held = null;
    await settle();
  });

  /**
   * A stored instant this browser cannot read stands as it is.
   *
   * The sentence says when the account last confirmed this device. Printing the
   * current moment in its place would state a confirmation that did not happen
   * then, which is a claim about the account that is not true (constitution IV).
   */
  it('shows an unreadable confirmation instant as it stands', async () => {
    const clock = TestBed.inject(ClockAdapter) as MovableClock;
    clock.timestamp = () => 'not-an-instant';
    writeCommanderState(storage);
    const store = await signedIn();

    await store.refresh();
    await settle();

    const view = presenter().view();
    expect(view.status.message).toBe(
      BUNDLED_ENGLISH['sync.status.current'].replace('{{when}}', 'not-an-instant'),
    );
  });

  it('never names the Commander by an identifier', async () => {
    writeCommanderState(storage);
    await signIn(api);

    const view = presenter().view();
    const said = [view.heading, view.status.message, ...view.notes.map((note) => note.message)];

    expect(said.join(' ')).not.toContain(CUSTOMER);
    expect(said.join(' ')).not.toContain(ACCOUNT.customerId);
  });
});
