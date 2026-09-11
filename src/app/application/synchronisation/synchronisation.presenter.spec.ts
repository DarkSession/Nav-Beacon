import { TestBed } from '@angular/core/testing';
import { FIXTURE_IDS, NAMED_RECORD_V1 } from '../../domain/records/fixtures/records';
import type { SynchronisationResponse } from '../../domain/records/record-synchronisation';
import { provideLocalization } from '../../i18n/i18n.providers';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
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

/** One refusal that names a record both sides changed. */
function staleConflict(): SynchronisationResponse {
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
        remote: { kind: 'deleted' },
        code: null,
      },
    ],
  };
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

  beforeEach(() => {
    storage = new MemoryStorage();
    api = new FakeCommanderApi();

    TestBed.configureTestingModule({
      providers: [
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        provideMemoryStorage(storage, new MemoryStorage()),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: new MovableClock() },
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

  it('says the records stay in this browser while nobody is signed in', () => {
    const view = presenter().view;

    expect(view().heading).toBe(BUNDLED_ENGLISH['sync.title']);
    expect(view().status.message).toBe(BUNDLED_ENGLISH['sync.status.local-only']);
    expect(view().status.tone).toBe('info');
    expect(view().retry).toBeNull();
    expect(view().conflict).toBeNull();
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

  it('asks the one question only a Commander can answer, by the record’s own name', async () => {
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

  it('states the records it keeps for nobody and the ones it keeps for another account', async () => {
    writeCommanderState(storage, {
      recordBindings: {
        [FIXTURE_IDS.named]: 'local-only',
        [FIXTURE_IDS.working]: OTHER_CUSTOMER,
      },
    });
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

  it('never names the Commander by an identifier', async () => {
    writeCommanderState(storage);
    await signIn(api);

    const view = presenter().view();
    const said = [view.heading, view.status.message, ...view.notes.map((note) => note.message)];

    expect(said.join(' ')).not.toContain(CUSTOMER);
    expect(said.join(' ')).not.toContain(ACCOUNT.customerId);
  });
});
