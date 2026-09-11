import { TestBed } from '@angular/core/testing';
import {
  FIXTURE_IDS,
  LOADOUT_RECORD_V2,
  NAMED_RECORD_V1,
} from '../../domain/records/fixtures/records';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { EDNB_TAB_KEY, recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { AccountStore } from '../account/account.store';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { LoadoutStore } from '../equipment/loadout.store';
import { RecordSynchronisationCoordinator } from './record-synchronisation.coordinator';
import { RecordSynchronisationStore } from './record-synchronisation.store';
import {
  ACCOUNT,
  CUSTOMER,
  FakeCommanderApi,
  MovableClock,
  OTHER_CUSTOMER,
  SequentialUuid,
  SwitchableConnectivity,
  changesOfKind as changesSentTo,
  settle,
  signIn as signInWith,
  writeCommanderState,
} from './synchronisation.spec-helpers';

describe('the record synchronisation coordinator', () => {
  let storage: MemoryStorage;
  let session: MemoryStorage;
  let api: FakeCommanderApi;
  let clock: MovableClock;
  let connectivity: SwitchableConnectivity;
  let stop: (() => void) | null;

  beforeEach(() => {
    storage = new MemoryStorage();
    session = new MemoryStorage();
    api = new FakeCommanderApi();
    clock = new MovableClock();
    connectivity = new SwitchableConnectivity();
    stop = null;

    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage, session),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: clock },
        { provide: UuidAdapter, useClass: SequentialUuid },
        { provide: ConnectivityAdapter, useValue: connectivity },
      ],
    });
  });

  afterEach(() => {
    stop?.();
    TestBed.resetTestingModule();
  });

  function seed(bytes: string, id: string): void {
    storage.entries.set(recordKey(id), bytes);
  }

  function writeState(state: Record<string, unknown> = {}): void {
    writeCommanderState(storage, state);
  }

  async function signIn(): Promise<void> {
    await signInWith(api);
  }

  /** Every change of one kind the service has been sent so far. */
  function changesOfKind(type: 'renew' | 'write' | 'delete'): readonly string[] {
    return changesSentTo(api, type);
  }

  describe('the daily protection renewal', () => {
    it('renews both of a live page’s records, once each, while online', async () => {
      writeState({});
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      seed(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout);
      await signIn();

      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);
      TestBed.inject(LoadoutStore).setAutosaveRecordId(FIXTURE_IDS.loadout);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      // Asked again a moment later, which the store answers with the once-a-day
      // rule rather than a second renewal (020/FR-025).
      coordinator.renewProtection();
      await settle();

      expect([...changesOfKind('renew')].sort()).toEqual(
        [FIXTURE_IDS.loadout, FIXTURE_IDS.named].sort(),
      );
    });

    it('renews again once a day has passed', async () => {
      writeState({});
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      await signIn();
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      clock.advanceDays(1);
      coordinator.renewProtection();
      await settle();

      expect(changesOfKind('renew')).toHaveLength(2);
    });

    it('sends nothing while the browser believes it is offline', async () => {
      writeState({});
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      await signIn();
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);
      connectivity.online.set(false);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      expect(changesOfKind('renew')).toHaveLength(0);
    });

    it('sends nothing at all while the browser is anonymous', async () => {
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      expect(api.requests).toHaveLength(0);
    });

    it('never renews a record bound to another Customer ID', async () => {
      writeState({ recordBindings: { [FIXTURE_IDS.named]: OTHER_CUSTOMER } });
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      await signIn();
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      expect(changesOfKind('renew')).toHaveLength(0);
    });

    it('does not expire a remote record early when the browser clock runs fast', async () => {
      writeState({});
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      await signIn();
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(FIXTURE_IDS.named);

      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);
      stop = coordinator.start();
      await settle();

      // A browser whose clock is a year ahead renews and never deletes: the
      // service runs the remote period from its own receipt time (020/FR-025).
      clock.advanceDays(365);
      coordinator.renewProtection();
      await settle();

      expect(changesOfKind('delete')).toHaveLength(0);
      expect(changesOfKind('renew').length).toBeGreaterThan(0);
    });
  });

  describe('an account leaving this browser', () => {
    it('forgets what this page was saying after a sign-out', async () => {
      writeState({});
      await signIn();
      const store = TestBed.inject(RecordSynchronisationStore);
      TestBed.inject(RecordSynchronisationCoordinator);

      api.answers.push({ kind: 'unavailable' });
      await store.refresh();
      expect(store.status()).toMatchObject({ kind: 'failed' });

      await TestBed.inject(AccountStore).signOut();
      TestBed.tick();

      expect(store.status()).toEqual({ kind: 'inactive' });
    });

    it('forgets what this page was saying after an account deletion', async () => {
      writeState({});
      await signIn();
      const store = TestBed.inject(RecordSynchronisationStore);
      TestBed.inject(RecordSynchronisationCoordinator);

      api.answers.push({ kind: 'unavailable' });
      await store.refresh();
      expect(store.status()).toMatchObject({ kind: 'failed' });

      await TestBed.inject(AccountStore).deleteAccount();
      TestBed.tick();

      expect(store.status()).toEqual({ kind: 'inactive' });
    });
  });

  describe('keeping both versions', () => {
    it('moves a live page’s claim and record id onto the copy', async () => {
      writeState({ recordRevisions: { [FIXTURE_IDS.named]: 3 } });
      seed(NAMED_RECORD_V1, FIXTURE_IDS.named);
      session.entries.set(
        EDNB_TAB_KEY,
        JSON.stringify({ version: 2, workingRecords: { ship: FIXTURE_IDS.named } }),
      );
      await signIn();

      const build = TestBed.inject(ActiveBuildStore);
      build.setAutosaveRecordId(FIXTURE_IDS.named);

      const store = TestBed.inject(RecordSynchronisationStore);
      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);

      api.answers.push({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: null,
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
      });
      await store.recordSaved(FIXTURE_IDS.named);

      expect(store.conflictFor(FIXTURE_IDS.named)).not.toBeNull();

      const resolution = await coordinator.resolve(FIXTURE_IDS.named, 'keep-both');
      expect(resolution.kind).toBe('kept-both');
      const copiedTo = resolution.kind === 'kept-both' ? resolution.copiedTo : '';

      expect(build.autosaveRecordId()).toBe(copiedTo);
      expect(TestBed.inject(TabDescriptorRepository).read()?.workingRecords.ship).toBe(copiedTo);
    });

    it('answers nothing while the browser is anonymous', async () => {
      const coordinator = TestBed.inject(RecordSynchronisationCoordinator);

      expect(await coordinator.resolve(FIXTURE_IDS.named, 'overwrite')).toEqual({
        kind: 'unknown',
      });
      expect(api.requests).toHaveLength(0);
    });
  });
});
