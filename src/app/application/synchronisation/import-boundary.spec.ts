import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { JournalFile } from '../../domain/journal/journal-scan';
import { encodeBuildLinkFragment } from '../../domain/ships/build-link/build-link-codec-loader';
import { FIXTURE_HULL } from '../../domain/ships/outfitting/outfitting.fixtures';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { WebLocksAdapter } from '../../platform/browser/web-locks.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { AutosaveService } from '../build-library/autosave.service';
import { BuildLinkCoordinator } from '../build-link/build-link.coordinator';
import { LoadoutAutosaveService } from '../equipment/loadout-autosave.service';
import { LoadoutImportCoordinator } from '../equipment/loadout-import.coordinator';
import { LoadoutImportStore } from '../equipment/loadout-import.store';
import { SlefImportCoordinator } from '../slef/slef-import.coordinator';
import { SlefStore } from '../slef/slef.store';
import {
  FakeCommanderApi,
  MovableClock,
  SequentialUuid,
  SwitchableConnectivity,
  changesOfKind,
  settle,
  signIn,
  writeCommanderState,
} from './synchronisation.spec-helpers';

class FakeLifecycle {
  onFlush(): () => void {
    return () => {};
  }
}

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

class FakeLocks {
  readonly available = true;

  async request<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

/** A journal file, in the three things the application reads one by. */
function journalFile(name: string, lines: readonly string[]): JournalFile {
  const text = lines.join('\n');
  return { name, size: text.length, text: () => Promise.resolve(text) };
}

/**
 * One ship `Loadout` line, carrying the capture-only fields a real one has.
 *
 * The extra fields are the point: a journal line holds a Commander's finances,
 * their market and their ship identity, and none of it is part of a build.
 */
function shipLine(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: '2026-09-01T10:00:00Z',
    event: 'Loadout',
    Ship: FIXTURE_HULL,
    Modules: [],
    ShipID: 7717717,
    HullValue: 4747474,
    ModulesValue: 5858585,
    Rebuy: 6969696,
    MarketID: 3228855555,
    ...fields,
  });
}

/** One suit `SuitLoadout` line, carrying the same kind of capture-only fields. */
function suitLine(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: '2026-09-01T10:00:00Z',
    event: 'SuitLoadout',
    SuitName: 'tacticalsuit_class5',
    SuitID: 8818818,
    LoadoutID: 9919919,
    LoadoutName: 'Double Trouble',
    SuitMods: ['suit_nightvision'],
    Modules: [{ SlotName: 'PrimaryWeapon1', ModuleName: 'wpn_m_launcher_rocket_sauto', Class: 5 }],
    MarketID: 3228855555,
    ...fields,
  });
}

/** The capture-only values that must never appear in a request, whatever came in. */
const CAPTURE_ONLY = [
  'ShipID',
  '7717717',
  'HullValue',
  '4747474',
  'ModulesValue',
  '5858585',
  'Rebuy',
  '6969696',
  'MarketID',
  '3228855555',
  'SuitID',
  '8818818',
  'LoadoutID',
  '9919919',
];

/** The field names a record may never carry out of this browser. */
const FORBIDDEN_FIELDS = [
  'note',
  'provenance',
  'sourceNamed',
  'validation',
  'revisionId',
  'deviceClaim',
  'event',
  'timestamp',
  'fragment',
  'file',
  'fileName',
  'line',
  'lines',
  'draft',
  'slef',
  'text',
];

/**
 * What every import must satisfy once it has been offered to the account.
 *
 * Read from the requests rather than from the stores: the constitution's
 * boundary is about what leaves the browser, so proving it means reading what
 * was sent (constitution I, 020/FR-007, 020/FR-012, 020/FR-021).
 */
function expectNothingBeyondTheRecord(api: FakeCommanderApi, sources: readonly string[]): void {
  const sent = JSON.stringify(api.requests);

  for (const source of sources) {
    expect(sent).not.toContain(source);
  }
  for (const value of CAPTURE_ONLY) {
    expect(sent).not.toContain(value);
  }
  for (const field of FORBIDDEN_FIELDS) {
    expect(sent).not.toContain(`"${field}"`);
  }
}

describe('the boundary an import crosses to reach an account', () => {
  let storage: MemoryStorage;
  let api: FakeCommanderApi;

  beforeEach(() => {
    storage = new MemoryStorage();
    api = new FakeCommanderApi();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'outfitting', children: [] }]),
        provideLocalization(),
        ...provideIsolatedLocaleEnvironment(),
        provideMemoryStorage(storage, new MemoryStorage()),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: new MovableClock() },
        { provide: UuidAdapter, useClass: SequentialUuid },
        { provide: ConnectivityAdapter, useValue: new SwitchableConnectivity() },
        { provide: PageLifecycleAdapter, useValue: new FakeLifecycle() },
        { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
        { provide: WebLocksAdapter, useValue: new FakeLocks() },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Every record this browser has actually persisted. */
  function persisted(): readonly string[] {
    const listed = TestBed.inject(LocalRecordRepository).list();
    return listed.ok
      ? listed.value.map((entry) => (entry.available ? entry.record.id : entry.id))
      : [];
  }

  describe('a build link', () => {
    it('sends nothing at all when an anonymous browser opens one', async () => {
      const fragment = await encodeBuildLinkFragment(ShipLoadout.default('Anaconda'));

      await TestBed.inject(BuildLinkCoordinator).ingest(fragment);
      TestBed.inject(AutosaveService).flush();
      await settle();

      expect(TestBed.inject(ActiveBuildStore).loadout()).not.toBeNull();
      expect(api.requests).toHaveLength(0);
    });

    it('offers the reconstructed record, and never the fragment', async () => {
      writeCommanderState(storage);
      await signIn(api);
      const fragment = await encodeBuildLinkFragment(ShipLoadout.default('Anaconda'));

      await TestBed.inject(BuildLinkCoordinator).ingest(fragment);
      await settle();

      // Reconstruction alone is not an offer. Nothing is sent until the record
      // exists in this browser (020/FR-007).
      expect(changesOfKind(api, 'write')).toHaveLength(0);

      TestBed.inject(AutosaveService).flush();
      await settle();

      const held = TestBed.inject(ActiveBuildStore).autosaveRecordId();
      expect(held).not.toBeNull();
      expect(storage.entries.has(recordKey(held!))).toBe(true);
      expect(changesOfKind(api, 'write')).toEqual([held]);
      expectNothingBeyondTheRecord(api, [fragment]);
    });
  });

  describe('a SLEF document', () => {
    it('offers the reconstructed record, and never the document', async () => {
      writeCommanderState(storage);
      await signIn(api);
      const document = shipLine({ ShipName: 'Bluebird' });

      TestBed.inject(SlefStore).setDraft(document);
      expect(await TestBed.inject(SlefImportCoordinator).submit()).toEqual({ kind: 'committed' });
      await settle();

      expect(changesOfKind(api, 'write')).toHaveLength(0);

      TestBed.inject(AutosaveService).flush();
      await settle();

      const held = TestBed.inject(ActiveBuildStore).autosaveRecordId();
      expect(held).not.toBeNull();
      expect(changesOfKind(api, 'write')).toEqual([held]);
      expectNothingBeyondTheRecord(api, [document]);
    });

    it('sends nothing at all while the browser is anonymous', async () => {
      TestBed.inject(SlefStore).setDraft(shipLine({ ShipName: 'Bluebird' }));
      await TestBed.inject(SlefImportCoordinator).submit();
      TestBed.inject(AutosaveService).flush();
      await settle();

      expect(api.requests).toHaveLength(0);
    });
  });

  describe('a selected journal import', () => {
    it('offers each stored ship-build record, and never the file it came from', async () => {
      writeCommanderState(storage);
      await signIn(api);
      const lines = [
        shipLine({ ShipName: 'Older', timestamp: '2026-09-01T09:00:00Z' }),
        shipLine({ ShipName: 'Newer', timestamp: '2026-09-02T09:00:00Z' }),
      ];
      const file = journalFile('Journal.2026-09-01T100000.01.log', lines);

      const store = TestBed.inject(SlefStore);
      const coordinator = TestBed.inject(SlefImportCoordinator);
      await coordinator.scanFiles([file]);
      store.setSelection(store.journalEntries().map((entry) => entry.key));

      expect(await coordinator.submit()).toMatchObject({ kind: 'stored', stored: 2 });
      await settle();

      const sent = changesOfKind(api, 'write');
      expect(sent).toHaveLength(2);
      // Every record offered is one this browser holds: the write follows the
      // persistence rather than the line it was read from (020/FR-007).
      expect(persisted()).toEqual(expect.arrayContaining([...sent]));
      expectNothingBeyondTheRecord(api, [file.name, ...lines]);
    });

    it('offers each stored equipment-loadout record, and never the file it came from', async () => {
      writeCommanderState(storage);
      await signIn(api);
      const lines = [
        suitLine({ LoadoutName: 'One', timestamp: '2026-09-01T09:00:00Z' }),
        suitLine({ LoadoutName: 'Two', timestamp: '2026-09-02T09:00:00Z' }),
      ];
      const file = journalFile('Journal.2026-09-01T100000.02.log', lines);

      const store = TestBed.inject(LoadoutImportStore);
      const coordinator = TestBed.inject(LoadoutImportCoordinator);
      await coordinator.scanFiles([file]);
      store.setSelection(store.entries().map((entry) => entry.key));

      expect(await coordinator.submit()).toMatchObject({ kind: 'stored', stored: 2 });
      await settle();

      const sent = changesOfKind(api, 'write');
      expect(sent).toHaveLength(2);
      expect(persisted()).toEqual(expect.arrayContaining([...sent]));
      expectNothingBeyondTheRecord(api, [file.name, ...lines]);
    });

    it('sends nothing at all while the browser is anonymous', async () => {
      const store = TestBed.inject(SlefStore);
      const coordinator = TestBed.inject(SlefImportCoordinator);
      await coordinator.scanFiles([
        journalFile('Journal.01.log', [
          shipLine({ ShipName: 'Older', timestamp: '2026-09-01T09:00:00Z' }),
          shipLine({ ShipName: 'Newer', timestamp: '2026-09-02T09:00:00Z' }),
        ]),
      ]);
      store.setSelection(store.journalEntries().map((entry) => entry.key));

      await coordinator.submit();
      await settle();

      expect(persisted()).toHaveLength(2);
      expect(api.requests).toHaveLength(0);
    });
  });

  describe('a loadout opened on the bench', () => {
    it('offers the reconstructed record, and never the line it came from', async () => {
      writeCommanderState(storage);
      await signIn(api);
      const line = suitLine();

      TestBed.inject(LoadoutImportStore).setDraft(line);
      expect(await TestBed.inject(LoadoutImportCoordinator).submit()).toEqual({ kind: 'opened' });
      await settle();

      expect(changesOfKind(api, 'write')).toHaveLength(0);

      TestBed.inject(LoadoutAutosaveService).flush();
      await settle();

      const sent = changesOfKind(api, 'write');
      expect(sent).toHaveLength(1);
      expect(persisted()).toEqual(expect.arrayContaining([...sent]));
      expectNothingBeyondTheRecord(api, [line]);
    });
  });
});
