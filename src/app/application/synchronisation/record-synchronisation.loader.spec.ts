import { TestBed } from '@angular/core/testing';
import { FIXTURE_IDS } from '../../domain/records/fixtures/records';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { RecordSynchronisationLoader } from './record-synchronisation.loader';
import {
  FakeCommanderApi,
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
});
