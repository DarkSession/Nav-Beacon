import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  FIXTURE_IDS,
  MALFORMED_RECORD,
  NAMED_RECORD_V1,
  NAMED_RECORD_V2,
  UNKNOWN_HULL_RECORD,
  UNSUPPORTED_NEWER_RECORD,
  WORKING_RECORD_V1,
} from '../../domain/records/fixtures/records';
import { provideLocalization } from '../../i18n/i18n.providers';
import { provideIsolatedLocaleEnvironment } from '../../i18n/testing/localization-harness';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import { BuildLibraryStore } from './build-library.store';
import { RecordOpenService } from './record-open.service';
import { RetentionService, UNNAMED_RECORD_LIFETIME_MS } from './retention.service';
import { ClockAdapter } from '../../platform/browser/clock.adapter';

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

class CountingUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `new-${this.#next}`;
  }
}

const NOW = '2026-01-02T03:04:05.000Z';

/** A clock a test can move, so an eight-day-old record takes no eight days. */
class FixedClock {
  instant = new Date(NOW);

  now(): Date {
    return this.instant;
  }

  timestamp(): string {
    return this.now().toISOString();
  }

  /** Moves the clock forward by whole days. */
  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

function setup(seed: (storage: MemoryStorage) => void = () => {}) {
  const storage = new MemoryStorage();
  seed(storage);
  const clock = new FixedClock();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideIsolatedLocaleEnvironment(),
      ...provideMemoryStorage(storage),
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
      { provide: UuidAdapter, useValue: new CountingUuid() },
      { provide: ClockAdapter, useValue: clock },
    ],
  });
  return {
    storage,
    clock,
    library: TestBed.inject(BuildLibraryStore),
    open: TestBed.inject(RecordOpenService),
    retention: TestBed.inject(RetentionService),
    records: TestBed.inject(LocalRecordRepository),
    active: TestBed.inject(ActiveBuildStore),
    coordinator: TestBed.inject(BuildIngressCoordinator),
    commander: TestBed.inject(CommanderStateRepository),
  };
}

/** Seeds one unnamed record per index, each stamped a second apart. */
function seedWorkingRecords(storage: MemoryStorage, count: number): void {
  for (let index = 0; index < count; index += 1) {
    storage.setItem(
      recordKey(`working-${index}`),
      JSON.stringify({
        format: 'ednb.local-record',
        version: 1,
        id: `working-${index}`,
        kind: 'working',
        revisionId: `revision-${index}`,
        createdAt: NOW,
        modifiedAt: `2026-01-02T03:04:${String(index).padStart(2, '0')}.000Z`,
        name: null,
        note: null,
        hullSymbol: 'Anaconda',
        validation: { valid: true, complete: true },
        build: {
          format: 'ednb.build',
          version: 1,
          shipSymbol: 'Anaconda',
          shipName: null,
          shipIdent: null,
          modules: [],
        },
        sourceNamed: null,
        autosaveRecordId: null,
      }),
    );
  }
}

describe('BuildLibraryStore', () => {
  it('says so when there is nothing stored', () => {
    const { library } = setup();

    expect(library.isEmpty()).toBe(true);
    expect(library.status()).toBe('ready');
  });

  it('lists named and unnamed records as one list', () => {
    // One list since 2026-08-27: the row says which it is, and two groups made
    // the most recently edited build not reliably the first row (FR-010).
    const { library } = setup((storage) => {
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
      storage.setItem(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1);
    });

    expect(library.records()).toHaveLength(2);
    expect(library.total()).toBe(2);
  });

  it('keeps the unnamed records the quota manager offers for discard', () => {
    // Not a group the library draws. A full store offers the records nothing
    // has asked to keep, which is a different question from how records list.
    const { library } = setup((storage) => {
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
      storage.setItem(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1);
    });

    expect(library.working()).toHaveLength(1);
  });

  it('orders by modified instant, newest first, with a stable tie-breaker', () => {
    const { library } = setup((storage) => seedWorkingRecords(storage, 3));

    const ids = library.working().map((entry) => (entry.available ? entry.record.id : null));

    expect(ids).toEqual(['working-2', 'working-1', 'working-0']);
    // Ordering twice gives the same answer, so an action lands on the row it
    // was aimed at.
    expect(library.working().map((entry) => (entry.available ? entry.record.id : null))).toEqual(
      ids,
    );
  });

  it('lists a record it cannot open rather than hiding it', () => {
    const { library } = setup((storage) => {
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
      storage.setItem(recordKey('broken'), MALFORMED_RECORD);
      storage.setItem(recordKey(FIXTURE_IDS.unsupported), UNSUPPORTED_NEWER_RECORD);
    });

    expect(library.unavailable()).toHaveLength(2);
    // The readable one still lists; one unreadable record never hides another.
    expect(library.records()).toHaveLength(1);
  });

  it('reports an unavailable store without pretending it is empty', () => {
    const { library, storage } = setup();
    storage.accessError = new DOMException('denied', 'SecurityError');

    library.refresh();

    expect(library.status()).toBe('unavailable');
    expect(library.failure()).toBe('blocked');
  });

  it('counts how many records already carry a display name', () => {
    const { library } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );

    expect(library.countByName('Anaconda explorer')).toBe(1);
    expect(library.countByName('anaconda EXPLORER')).toBe(1);
    expect(library.countByName('Something else')).toBe(0);
    expect(library.countByName('   ')).toBe(0);
  });
});

describe('the listing and the expiry together', () => {
  it('sweeps expired records before the listing is read', () => {
    // The two are deliberately joined: a row is gone when the list is drawn
    // rather than disappearing under a Commander reading it (FR-013).
    const { library, storage, clock } = setup((store) => seedWorkingRecords(store, 2));
    expect(library.total()).toBe(2);

    clock.advanceDays(8);
    library.refresh();

    expect(library.total()).toBe(0);
    expect([...storage.entries.keys()]).toEqual([]);
  });

  it('leaves the listing alone while nothing has expired', () => {
    const { library, clock } = setup((store) => seedWorkingRecords(store, 2));

    clock.advanceDays(6);
    library.refresh();

    expect(library.total()).toBe(2);
  });
});

describe('RetentionService', () => {
  /** The one unnamed record the expiry tests act on. */
  function seedOne(storage: MemoryStorage): void {
    seedWorkingRecords(storage, 1);
  }

  const remainingIds = (storage: MemoryStorage) =>
    [...storage.entries.keys()].filter((key) => key.startsWith('ednb:record:')).sort();

  it('gives an unnamed record seven days from the instant it was last edited', () => {
    const { retention, records } = setup(seedOne);
    const record = records.open('working-0');
    if (!record.ok || record.value === null) {
      throw new Error('expected the seeded record');
    }

    const deadline = retention.expiresAt(record.value.record);

    expect(deadline?.getTime()).toBe(
      Date.parse(record.value.record.modifiedAt) + UNNAMED_RECORD_LIFETIME_MS,
    );
  });

  it('gives a named record no deadline at all', () => {
    // Naming ends the expiry outright. Named saves are bounded by the browser's
    // own quota and by nothing this application decides (FR-013).
    const { retention, records } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );
    const record = records.open(FIXTURE_IDS.named);
    if (!record.ok || record.value === null) {
      throw new Error('expected the seeded record');
    }

    expect(retention.expiresAt(record.value.record)).toBeNull();
    expect(retention.remaining(record.value.record)).toBeNull();
    expect(retention.hasExpired(record.value.record)).toBe(false);
  });

  it('removes an unnamed record once its seven days have run out', () => {
    const { retention, storage, clock } = setup(seedOne);
    clock.advanceDays(8);

    retention.sweep();

    expect(remainingIds(storage)).toEqual([]);
  });

  /**
   * The binding is what the synchronisation panel counts. Left behind, it names
   * a record nothing can open and the panel states it as one a Commander could
   * still save or copy (020/FR-024, constitution IV).
   */
  it('forgets what it knew about the removed record’s remote copy', () => {
    const { retention, clock, commander } = setup(seedOne);
    commander.bindRecord('working-0', '900001');
    clock.advanceDays(8);

    retention.sweep();

    expect(commander.read().recordBindings).toEqual({});
  });

  it('writes no account state for a browser that never had an account', () => {
    // An anonymous tool needs no account, and an expiry is not the moment to
    // give a browser one (constitution I).
    const { retention, storage, clock } = setup(seedOne);
    clock.advanceDays(8);

    retention.sweep();

    expect([...storage.entries.keys()]).toEqual([]);
  });

  it('keeps the binding of a record it could not remove', () => {
    const { retention, storage, clock, commander } = setup(seedOne);
    commander.bindRecord('working-0', '900001');
    clock.advanceDays(8);
    storage.removeError = new DOMException('denied', 'SecurityError');

    retention.sweep();

    expect(commander.read().recordBindings).toEqual({ 'working-0': '900001' });
  });

  it('removes nothing while the deadline has not passed', () => {
    const { retention, storage, clock } = setup(seedOne);
    clock.advanceDays(6);

    retention.sweep();

    expect(remainingIds(storage)).toEqual(['ednb:record:working-0']);
  });

  it('leaves a named record alone however old it is', () => {
    const { retention, storage, clock } = setup((store) => {
      seedWorkingRecords(store, 1);
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
    });
    clock.advanceDays(400);

    retention.sweep();

    expect(remainingIds(storage)).toEqual([`ednb:record:${FIXTURE_IDS.named}`]);
  });

  it('leaves the record a live page is autosaving into', () => {
    // A build open for a week without an edit is still a build someone has
    // open. Removing the record under it is the one loss a countdown on a row
    // nobody is looking at could not warn about (FR-012, FR-013).
    const { retention, storage, clock, active } = setup(seedOne);
    active.commit({
      loadout: ShipLoadout.default('Anaconda'),
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: null,
      autosaveRecordId: 'working-0',
      baseline: null,
    });
    clock.advanceDays(30);

    retention.sweep();

    expect(remainingIds(storage)).toEqual(['ednb:record:working-0']);
  });

  it('leaves an unreadable record listed rather than removing it', () => {
    // Its instant cannot be read, so its age is a guess — and a guess is not
    // something to delete a Commander's work on.
    const { retention, storage, clock } = setup((store) =>
      store.setItem(recordKey('broken'), MALFORMED_RECORD),
    );
    clock.advanceDays(400);

    retention.sweep();

    expect(remainingIds(storage)).toEqual(['ednb:record:broken']);
  });

  it('removes nothing when storage cannot even be listed', () => {
    const { retention, storage } = setup(seedOne);
    storage.accessError = new DOMException('denied', 'SecurityError');

    expect(() => retention.sweep()).not.toThrow();

    storage.accessError = null;
    expect(remainingIds(storage)).toEqual(['ednb:record:working-0']);
  });

  it('carries on when one removal fails, and leaves that record whole', () => {
    const { retention, storage, clock } = setup((store) => seedWorkingRecords(store, 3));
    clock.advanceDays(8);
    storage.removeError = new DOMException('denied', 'SecurityError');

    expect(() => retention.sweep()).not.toThrow();

    // Nothing was half-removed: every key is either gone or exactly as it was.
    expect(remainingIds(storage)).toHaveLength(3);
    storage.removeError = null;
    retention.sweep();
    expect(remainingIds(storage)).toEqual([]);
  });

  it('does not restart the clock by reading it', () => {
    // The deadline is derived from `modifiedAt` and never written, so a sweep
    // that removes nothing leaves every record byte-identical (FR-013).
    const { retention, storage, clock } = setup((store) => seedWorkingRecords(store, 2));
    const before = new Map(storage.entries);
    clock.advanceDays(3);

    retention.sweep();

    expect([...storage.entries]).toEqual([...before]);
  });
});

describe('RecordOpenService', () => {
  it('opens a named record as a clean build with its own provenance', async () => {
    const { open, active } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );

    const result = await open.open(FIXTURE_IDS.named);

    expect(result.kind).toBe('committed');
    expect(active.provenance()).toBe('named');
    expect(active.sourceNamed()).toEqual({
      recordId: FIXTURE_IDS.named,
      baseRevisionId: '22222222-2222-4222-8222-222222222222',
    });
    // Opened at its own baseline, so it is not immediately "unsaved".
    expect(active.dirty()).toBe(false);
  });

  it('takes an unnamed record over, clean, rather than copying it', async () => {
    const { open, active } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.working), WORKING_RECORD_V1),
    );

    await open.open(FIXTURE_IDS.working);

    expect(active.provenance()).toBe('working');
    // The page autosaves into the record it opened rather than a copy beside
    // it, and it arrives clean: nothing is owed, so nothing is written, so the
    // seven days the entry is counting down do not restart (FR-008, FR-013).
    expect(active.autosaveRecordId()).toBe(FIXTURE_IDS.working);
    expect(active.dirty()).toBe(false);
  });

  it('holds a named record without making it an autosave target', async () => {
    const { open, active } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );

    await open.open(FIXTURE_IDS.named);

    // Autosave has no path to a named record. The first modelled edit forks an
    // unnamed one, and the save stays exactly where its Commander put it
    // (FR-008, ruled 2026-08-25).
    expect(active.autosaveRecordId()).toBeNull();
  });

  it('cannot replace active work with a record that fails to open', async () => {
    const { open, active } = setup((storage) => {
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1);
      storage.setItem(recordKey(FIXTURE_IDS.unknownHull), UNKNOWN_HULL_RECORD);
      storage.setItem(recordKey('broken'), MALFORMED_RECORD);
    });
    await open.open(FIXTURE_IDS.named);
    const before = active.loadout();

    for (const id of [FIXTURE_IDS.unknownHull, 'broken', 'never-written']) {
      const result = await open.open(id);
      expect(result.kind, id).toBe('failed');
    }

    expect(active.loadout()).toBe(before);
  });

  it('leaves the source record untouched when it is opened', async () => {
    const { open, storage } = setup((store) =>
      store.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V2),
    );
    const before = storage.entries.get(recordKey(FIXTURE_IDS.named));

    await open.open(FIXTURE_IDS.named);

    expect(storage.entries.get(recordKey(FIXTURE_IDS.named))).toBe(before);
  });

  it('names the hull in the Commander’s language for the replacement question', async () => {
    const { open, active } = setup((storage) =>
      storage.setItem(recordKey(FIXTURE_IDS.named), NAMED_RECORD_V1),
    );

    await open.open(FIXTURE_IDS.named);

    expect(active.hullName()).toBe('Anaconda');
  });
});
