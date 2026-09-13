import { TestBed } from '@angular/core/testing';
import {
  FIXTURE_IDS,
  LOADOUT_RECORD_V2,
  MALFORMED_RECORD,
  NAMED_RECORD_V1,
  NAMED_RECORD_V2,
  UNKNOWN_HULL_RECORD,
  UNKNOWN_SUIT_RECORD,
  UNSUPPORTED_NEWER_RECORD,
  WORKING_RECORD_V1,
} from '../../domain/records/fixtures/records';
import { isShipRecord } from '../../domain/records/local-record';
import { CommanderStateRepository } from './commander-state.repository';
import { LocalRecordRepository } from './local-record.repository';
import { RecordMigrationService } from './record-migration.service';
import { MemoryStorage, provideMemoryStorage, quotaError } from './storage.spec-helpers';
import { EDNB_COMMANDER_STATE_KEY, recordKey } from './storage-keys';

function setup(seed: (storage: MemoryStorage) => void = () => {}): {
  service: RecordMigrationService;
  storage: MemoryStorage;
} {
  const storage = new MemoryStorage();
  seed(storage);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [...provideMemoryStorage(storage)] });
  return { service: TestBed.inject(RecordMigrationService), storage };
}

describe('opening a stored record', () => {
  it('opens a current record without rewriting it', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V2),
    );
    const before = storage.entries.get(recordKey(FIXTURE_IDS.named));

    const opened = service.open(FIXTURE_IDS.named);

    expect(opened.ok).toBe(true);
    expect(storage.entries.get(recordKey(FIXTURE_IDS.named))).toBe(before);
  });

  it('migrates a version-1 record on open, and only then rewrites it', () => {
    // Every record written before the bench existed is a ship's, whether or not
    // it says so. The migration is what makes that claim explicit, and it is
    // written back only once the build has been rebuilt through the package
    // (013 contracts/loadout-persistence.md).
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );

    const opened = service.open(FIXTURE_IDS.named);

    expect(opened.ok && opened.record.tool).toBe('ship');
    const rewritten: unknown = JSON.parse(storage.entries.get(recordKey(FIXTURE_IDS.named))!);
    expect(rewritten).toMatchObject({ version: 2, tool: 'ship', hullSymbol: 'Anaconda' });
  });

  it('opens a stored loadout, holding what a suit does not carry (FR-018a)', () => {
    const { service } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.loadout), LOADOUT_RECORD_V2),
    );

    const opened = service.open(FIXTURE_IDS.loadout);

    expect(opened.ok && opened.record.tool).toBe('equipment');
    expect(opened.ok && !isShipRecord(opened.record) && opened.record.loadout.weapons[1]).toEqual({
      symbol: 'wpn_m_sniper_plasma_charged',
      grade: 2,
      modifications: [null, null, null, null],
    });
  });

  it('refuses a loadout naming a suit the package does not carry, leaving it stored', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.unknownSuit), UNKNOWN_SUIT_RECORD),
    );

    const opened = service.open(FIXTURE_IDS.unknownSuit);

    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toContain('nonexistentsuit');
    expect(storage.entries.get(recordKey(FIXTURE_IDS.unknownSuit))).toBe(UNKNOWN_SUIT_RECORD);
  });

  it('refuses a record naming a hull the package does not carry, leaving it stored', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.unknownHull), UNKNOWN_HULL_RECORD),
    );

    const opened = service.open(FIXTURE_IDS.unknownHull);

    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toContain('Nonexistent_Hull');
    // Stored but unopened: the bytes are untouched (FR-014).
    expect(storage.entries.get(recordKey(FIXTURE_IDS.unknownHull))).toBe(UNKNOWN_HULL_RECORD);
  });

  it('refuses an unsupported newer record and leaves it byte-for-byte', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.unsupported), UNSUPPORTED_NEWER_RECORD),
    );

    expect(service.open(FIXTURE_IDS.unsupported).ok).toBe(false);
    expect(storage.entries.get(recordKey(FIXTURE_IDS.unsupported))).toBe(UNSUPPORTED_NEWER_RECORD);
  });

  it('refuses a malformed record without repairing or removing it', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey('broken'), MALFORMED_RECORD),
    );

    expect(service.open('broken').ok).toBe(false);
    expect(storage.entries.get(recordKey('broken'))).toBe(MALFORMED_RECORD);
  });

  it('says so when there is nothing stored under that identity', () => {
    expect(setup().service.open('never-written').ok).toBe(false);
  });

  it('reports a blocked store as a read failure rather than as a missing record', () => {
    const { service, storage } = setup();
    storage.accessError = new DOMException('denied', 'SecurityError');

    const opened = service.open(FIXTURE_IDS.named);

    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toContain('blocked');
  });

  it('attempts no write where nothing needed migrating', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V2),
    );
    const writes = vi.spyOn(storage, 'setItem');

    expect(service.open(FIXTURE_IDS.named).ok).toBe(true);
    expect(writes).not.toHaveBeenCalled();
  });

  it('keeps a full store from turning a successful open into a failure', () => {
    const { service, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );
    storage.writeError = quotaError();

    // The rewrite fails, the open stands, and the older bytes stay readable for
    // the next attempt (persistence contract).
    expect(service.open(FIXTURE_IDS.named).ok).toBe(true);
    expect(storage.entries.get(recordKey(FIXTURE_IDS.named))).toBe(NAMED_RECORD_V1);
  });
});

describe('records in a browser that also holds account state', () => {
  /** A browser signed in once, with work bound, accepted and waiting to send. */
  const ACCOUNT_STATE = JSON.stringify({
    format: 'ednb.commander-state',
    version: 1,
    account: { customerId: '900001', commanderName: 'Hadley' },
    fleetCache: [],
    accountCursors: { '900001': 12 },
    pendingOperations: [
      {
        id: 'operation-1',
        customerId: '900001',
        recordId: FIXTURE_IDS.named,
        kind: 'upload',
        baseRevision: 11,
        queuedAt: '2026-01-02T03:04:05.000Z',
      },
    ],
    recordBindings: { [FIXTURE_IDS.named]: '900001', [FIXTURE_IDS.loadout]: 'local-only' },
    recordRevisions: { [FIXTURE_IDS.named]: 11 },
  });

  /** Every record shape a published version wrote, under its own identity. */
  const STORED: readonly (readonly [string, string, string])[] = [
    ['a version-1 named build', FIXTURE_IDS.named, NAMED_RECORD_V1],
    ['a version-1 working build', FIXTURE_IDS.working, WORKING_RECORD_V1],
    ['a version-2 loadout', FIXTURE_IDS.loadout, LOADOUT_RECORD_V2],
  ];

  const RETAINED: readonly (readonly [string, string, string])[] = [
    ['an unknown hull', FIXTURE_IDS.unknownHull, UNKNOWN_HULL_RECORD],
    ['an unknown suit', FIXTURE_IDS.unknownSuit, UNKNOWN_SUIT_RECORD],
    ['a newer version', FIXTURE_IDS.unsupported, UNSUPPORTED_NEWER_RECORD],
    ['bytes that are not a record', 'broken', MALFORMED_RECORD],
  ];

  function browser() {
    const storage = new MemoryStorage();
    storage.setItem(EDNB_COMMANDER_STATE_KEY, ACCOUNT_STATE);
    for (const [, id, bytes] of [...STORED, ...RETAINED]) {
      storage.setItem(recordKey(id), bytes);
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...provideMemoryStorage(storage)] });
    return {
      storage,
      records: TestBed.inject(LocalRecordRepository),
      migration: TestBed.inject(RecordMigrationService),
      account: TestBed.inject(CommanderStateRepository),
    };
  }

  it.each(STORED)('still opens %s', (_name, id) => {
    expect(browser().migration.open(id).ok).toBe(true);
  });

  it.each(RETAINED)('still lists %s, unopened and byte for byte', (_name, id, bytes) => {
    const { records, migration, storage } = browser();

    const listed = records.read(id);

    expect(listed.ok).toBe(true);
    expect(migration.open(id).ok).toBe(false);
    expect(storage.entries.get(recordKey(id))).toBe(bytes);
  });

  it('lists every stored record beside the account state', () => {
    const { records } = browser();

    const listed = records.list();

    expect(listed.ok && listed.value).toHaveLength(STORED.length + RETAINED.length);
  });

  it('leaves the account state alone while records are read and migrated', () => {
    const { migration, account, storage } = browser();

    for (const [, id] of STORED) {
      migration.open(id);
    }

    expect(storage.getItem(EDNB_COMMANDER_STATE_KEY)).toBe(ACCOUNT_STATE);
    const state = account.read();
    expect(state.accountCursors).toEqual({ '900001': 12 });
    expect(state.pendingOperations).toHaveLength(1);
  });
});
