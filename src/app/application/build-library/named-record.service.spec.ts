import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { isShipRecord } from '../../domain/records/local-record';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { WebLocksAdapter } from '../../platform/browser/web-locks.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { NamedRecordService, type NamedSaveRequest } from './named-record.service';

/** A lock that actually serializes, so the precondition is what is being tested. */
class FakeLocks {
  available = true;
  readonly held: string[] = [];

  async request<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.held.push(name);
    return operation();
  }
}

class CountingUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `id-${this.#next}`;
  }
}

const NOW = '2026-01-02T03:04:05.000Z';
const LATER = '2026-01-02T04:05:06.000Z';

function setup(locks = new FakeLocks()) {
  const storage = new MemoryStorage();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ...provideMemoryStorage(storage),
      { provide: WebLocksAdapter, useValue: locks },
      { provide: UuidAdapter, useValue: new CountingUuid() },
    ],
  });
  return {
    named: TestBed.inject(NamedRecordService),
    records: TestBed.inject(LocalRecordRepository),
    storage,
    locks,
  };
}

const build = () => toBuildSnapshotV1(ShipLoadout.default('Anaconda'));

/** A save request, with only the fields a test cares about spelled out. */
function request(overrides: Partial<NamedSaveRequest> = {}): NamedSaveRequest {
  return {
    recordId: null,
    expectedRevisionId: null,
    name: 'Anaconda explorer',
    note: null,
    payload: { tool: 'ship', build: build(), validation: { valid: true, complete: true } },
    now: NOW,
    ...overrides,
  };
}

/** Seeds an unnamed record, as autosave would have left one. */
function seedUnnamed(records: LocalRecordRepository, id: string, createdAt = NOW): void {
  records.write({
    id,
    kind: 'working',
    revisionId: 'rev-seed',
    createdAt,
    modifiedAt: createdAt,
    name: null,
    note: null,
    payload: { tool: 'ship', build: build(), validation: { valid: true, complete: true } },
    sourceNamed: null,
  });
}

/** Every record key this browser is holding, so "nothing left behind" is checkable. */
function recordIds(storage: MemoryStorage): string[] {
  return [...storage.entries.keys()].filter((key) => key.startsWith('ednb:record:')).sort();
}

/** The same request, narrowed to the record it is replacing. */
function overwrite(
  recordId: string,
  expectedRevisionId: string,
  overrides: Partial<NamedSaveRequest> = {},
): NamedSaveRequest & { recordId: string } {
  return { ...request({ ...overrides, recordId, expectedRevisionId }), recordId };
}

describe('NamedRecordService', () => {
  it('creates a named record with fresh record and revision identities', async () => {
    const { named } = setup();

    const result = await named.createNamed(request());

    expect(result.kind).toBe('saved');
    if (result.kind !== 'saved') {
      return;
    }
    expect(result.record.kind).toBe('named');
    expect(result.record.name).toBe('Anaconda explorer');
    expect(result.record.id).not.toBe(result.record.revisionId);
  });

  it('saves work that holds no record as one named record, with nothing consumed', async () => {
    // The manual save of a build or a loadout still at its package default.
    // Such work takes no unnamed record, so there is nothing to promote and
    // nothing to leave behind: the save is a creation, and the saved list holds
    // exactly the one record a Commander asked for (024/FR-001, 024/FR-002).
    const { named, records } = setup();

    const result = await named.createNamed(request());

    expect(result.kind).toBe('saved');
    const listed = records.list();
    expect(
      listed.ok &&
        listed.value.map((entry) => (entry.available ? entry.record.kind : 'unreadable')),
    ).toEqual(['named']);
  });

  it('replaces a record when the revision is still the one this tab saw', async () => {
    const { named } = setup();
    const created = await named.createNamed(request());
    if (created.kind !== 'saved') {
      throw new Error('expected a save');
    }

    const result = await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId, { name: 'Renamed', now: LATER }),
    );

    expect(result.kind).toBe('saved');
    expect(result.kind === 'saved' && result.record.name).toBe('Renamed');
    // A fresh revision, so another tab's stale precondition can never match.
    expect(result.kind === 'saved' && result.record.revisionId).not.toBe(created.record.revisionId);
    expect(result.kind === 'saved' && result.record.createdAt).toBe(created.record.createdAt);
    expect(result.kind === 'saved' && result.record.modifiedAt).toBe(LATER);
  });

  it('reports a conflict rather than replacing a version it never saw', async () => {
    const { named } = setup();
    const created = await named.createNamed(request());
    if (created.kind !== 'saved') {
      throw new Error('expected a save');
    }
    // Another tab writes first.
    await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId, {
        name: 'From the other tab',
        now: LATER,
      }),
    );

    const result = await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId, {
        name: 'From this tab',
        now: LATER,
      }),
    );

    expect(result.kind).toBe('conflict');
    expect(result.kind === 'conflict' && result.observed.name).toBe('From the other tab');
  });

  it('writes nothing when it reports a conflict', async () => {
    const { named, records } = setup();
    const created = await named.createNamed(request());
    if (created.kind !== 'saved') {
      throw new Error('expected a save');
    }
    await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId, {
        name: 'From the other tab',
        now: LATER,
      }),
    );
    const before = records.open(created.record.id);

    await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId, {
        name: 'From this tab',
        now: LATER,
      }),
    );

    const after = records.open(created.record.id);
    expect(after.ok && after.value?.record).toEqual(before.ok ? before.value?.record : null);
  });

  it('takes the lock for exactly the record it is writing', async () => {
    const { named, locks } = setup();
    const created = await named.createNamed(request());
    if (created.kind !== 'saved') {
      throw new Error('expected a save');
    }

    await named.overwriteNamed(overwrite(created.record.id, created.record.revisionId));

    expect(locks.held).toEqual([`ednb:record:${created.record.id}`]);
  });

  it('refuses an in-place replacement when locking is unavailable', async () => {
    const locks = new FakeLocks();
    locks.available = false;
    const { named } = setup(locks);

    expect(named.canOverwrite).toBe(false);
    expect(await named.overwriteNamed(overwrite('r1', 'v1'))).toEqual({
      kind: 'locks-unavailable',
    });
  });

  it('still creates a new named record when locking is unavailable', async () => {
    const locks = new FakeLocks();
    locks.available = false;
    const { named } = setup(locks);

    // Keep-both stays available: it writes a record nobody else holds.
    expect((await named.createNamed(request())).kind).toBe('saved');
  });

  it('renames without disturbing the build or its recorded validation', async () => {
    // Renaming is a save under a different name since 2026-08-27: there is no
    // rename operation of its own, so what has to hold is that writing the same
    // build under a new name leaves the build and its recorded verdict alone.
    const { named, records } = setup();
    const created = await named.createNamed(
      request({
        payload: { tool: 'ship', build: build(), validation: { valid: false, complete: false } },
      }),
    );
    if (created.kind !== 'saved' || !isShipRecord(created.record)) {
      throw new Error('expected a saved ship record');
    }
    const saved = created.record;

    const renamed = await named.overwriteNamed(
      overwrite(saved.id, saved.revisionId, {
        name: 'A better name',
        payload: { tool: 'ship', build: saved.build, validation: saved.validation },
        now: LATER,
      }),
    );

    expect(renamed.kind).toBe('saved');
    // Read back out of storage rather than trusted from the result: what the
    // record now holds is the claim, not what the caller handed in.
    const stored = records.open(saved.id);
    const record = stored.ok ? stored.value?.record : null;
    expect(record?.name).toBe('A better name');
    expect(record && isShipRecord(record) && record.build).toEqual(saved.build);
    expect(record && isShipRecord(record) && record.validation).toEqual({
      valid: false,
      complete: false,
    });
  });

  it('says so when the record it was asked to write is gone', async () => {
    const { named } = setup();

    expect(await named.overwriteNamed(overwrite('never-written', 'v1'))).toEqual({
      kind: 'missing',
    });
  });

  it('names the record the build is already in, keeping its identity', async () => {
    // The ordinary manual save of an autosaved build. Naming is a promotion,
    // not a copy: the Commander gets one entry, not the same build twice
    // (FR-008, ruled 2026-08-25).
    const { named, records, storage } = setup();
    seedUnnamed(records, 'held');

    const result = await named.nameHeldRecord({
      ...request(),
      recordId: 'held',
      now: LATER,
    });

    expect(result.kind).toBe('saved');
    if (result.kind !== 'saved') {
      return;
    }
    expect(result.record.id).toBe('held');
    expect(result.record.kind).toBe('named');
    expect(result.record.name).toBe('Anaconda explorer');
    // A fresh revision, so a stale precondition elsewhere cannot match it.
    expect(result.record.revisionId).not.toBe('rev-seed');
    // Named just now, but not created just now: the work is older than the name.
    expect(result.record.createdAt).toBe(NOW);
    expect(result.record.modifiedAt).toBe(LATER);
    expect(recordIds(storage)).toEqual(['ednb:record:held']);
  });

  it('takes the lock of the record it is naming', async () => {
    const { named, records, locks } = setup();
    seedUnnamed(records, 'held');

    await named.nameHeldRecord({ ...request(), recordId: 'held' });

    expect(locks.held).toEqual(['ednb:record:held']);
  });

  it('mints a record rather than replacing one named while the dialog was open', async () => {
    // Another page named this record in the meantime. Promoting it would
    // replace a save nobody asked to replace, so this one is left alone.
    const { named, records, storage } = setup();
    const theirs = await named.createNamed(request({ name: 'Their save' }));
    if (theirs.kind !== 'saved') {
      throw new Error('expected a save');
    }

    const result = await named.nameHeldRecord({
      ...request({ name: 'Mine' }),
      recordId: theirs.record.id,
      now: LATER,
    });

    expect(result.kind === 'saved' && result.record.id).not.toBe(theirs.record.id);
    const kept = records.open(theirs.record.id);
    expect(kept.ok && kept.value?.record.name).toBe('Their save');
    expect(recordIds(storage)).toHaveLength(2);
  });

  it('still saves when the record it was going to name has gone', async () => {
    // Expired, or deleted in another page. The Commander asked for this build
    // to be saved, so it is saved — under a new identity.
    const { named } = setup();

    const result = await named.nameHeldRecord({ ...request(), recordId: 'never-written' });

    expect(result.kind).toBe('saved');
    expect(result.kind === 'saved' && result.record.name).toBe('Anaconda explorer');
  });

  it('names a build without a lock by writing first and removing after', async () => {
    const locks = new FakeLocks();
    locks.available = false;
    const { named, records, storage } = setup(locks);
    seedUnnamed(records, 'held');

    const result = await named.nameHeldRecord({ ...request(), recordId: 'held', now: LATER });

    // A new identity, because an unprotected read-then-write is what the
    // missing lock rules out — but still exactly one record.
    expect(result.kind).toBe('saved');
    expect(result.kind === 'saved' && result.record.id).not.toBe('held');
    expect(recordIds(storage)).toHaveLength(1);
  });

  it('removes the unnamed record once the build is written into a saved one', async () => {
    const { named, records, storage } = setup();
    const saved = await named.createNamed(request({ name: 'The save' }));
    if (saved.kind !== 'saved') {
      throw new Error('expected a save');
    }
    seedUnnamed(records, 'held');

    const result = await named.overwriteNamed(
      overwrite(saved.record.id, saved.record.revisionId, { name: 'The save', now: LATER }),
      'held',
    );

    expect(result.kind).toBe('saved');
    expect(recordIds(storage)).toEqual([`ednb:record:${saved.record.id}`]);
  });

  it('keeps the unnamed record when the write it would replace fails', async () => {
    // The order is the whole point: write, then remove. A failed write must
    // never leave the build with no copy of it anywhere.
    const { named, records, storage } = setup();
    const saved = await named.createNamed(request({ name: 'The save' }));
    if (saved.kind !== 'saved') {
      throw new Error('expected a save');
    }
    seedUnnamed(records, 'held');
    storage.writeError = quotaError();

    const result = await named.overwriteNamed(
      overwrite(saved.record.id, saved.record.revisionId, { now: LATER }),
      'held',
    );

    expect(result).toEqual({ kind: 'failed', code: 'quota' });
    const kept = records.open('held');
    expect(kept.ok && kept.value?.record.kind).toBe('working');
  });

  it('keeps the unnamed record when the save it would replace is a conflict', async () => {
    const { named, records } = setup();
    const saved = await named.createNamed(request({ name: 'The save' }));
    if (saved.kind !== 'saved') {
      throw new Error('expected a save');
    }
    // Another tab writes first, so this tab's precondition is stale.
    await named.overwriteNamed(
      overwrite(saved.record.id, saved.record.revisionId, { name: 'Theirs', now: LATER }),
    );
    seedUnnamed(records, 'held');

    const result = await named.overwriteNamed(
      overwrite(saved.record.id, saved.record.revisionId, { name: 'Mine', now: LATER }),
      'held',
    );

    expect(result.kind).toBe('conflict');
    const kept = records.open('held');
    expect(kept.ok && kept.value !== null).toBe(true);
  });

  it('reports a failed write rather than claiming a save', async () => {
    const { named, storage } = setup();
    const created = await named.createNamed(request());
    if (created.kind !== 'saved') {
      throw new Error('expected a save');
    }
    storage.writeError = quotaError();

    const result = await named.overwriteNamed(
      overwrite(created.record.id, created.record.revisionId),
    );

    expect(result).toEqual({ kind: 'failed', code: 'quota' });
  });
});
