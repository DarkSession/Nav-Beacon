import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { newLoadout, setSuitGrade } from '../../domain/equipment/loadout/loadout-edit';
import { loadoutFingerprint } from '../../domain/equipment/loadout/loadout-fingerprint';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { LoadoutAutosaveService } from './loadout-autosave.service';
import { LoadoutStore } from './loadout.store';

/** A lifecycle adapter a test can fire on demand. */
class FakeLifecycle {
  #flush: (() => void) | null = null;

  onFlush(flush: () => void): () => void {
    this.#flush = flush;
    return () => {
      this.#flush = null;
    };
  }

  fire(): void {
    this.#flush?.();
  }
}

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

/** The record a test hands the page, standing in for one it minted itself. */
const HELD = 'held-record';

function setup() {
  const storage = new MemoryStorage();
  const lifecycle = new FakeLifecycle();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ...provideMemoryStorage(storage),
      { provide: PageLifecycleAdapter, useValue: lifecycle },
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
    ],
  });

  const autosave = TestBed.inject(LoadoutAutosaveService);
  TestBed.inject(ClockAdapter).now = () => new Date('2026-01-02T03:04:05.000Z');
  return {
    autosave,
    store: TestBed.inject(LoadoutStore),
    records: TestBed.inject(LocalRecordRepository),
    storage,
    lifecycle,
  };
}

/** A loadout on the bench, in the record a test says it arrived in. */
function benchLoadout(
  store: LoadoutStore,
  suitFamily = 'tacticalsuit',
  autosaveRecordId: string | null = HELD,
): EquipmentLoadout {
  const loadout = newLoadout(suitFamily)!;
  store.open(loadout, null, { autosaveRecordId, baseline: null });
  return loadout;
}

/**
 * A loadout carrying one choice, so a record is owed for it.
 *
 * What most of these cases are about. A loadout still at its suit's default
 * owes nothing and takes no record, which is its own pair of cases below
 * (024/FR-002).
 */
function chosenLoadout(
  store: LoadoutStore,
  suitFamily = 'tacticalsuit',
  autosaveRecordId: string | null = HELD,
): EquipmentLoadout {
  benchLoadout(store, suitFamily, autosaveRecordId);
  store.dispatch({ kind: 'setSuitGrade', grade: 3 });
  return store.loadout()!;
}

describe('LoadoutAutosaveService', () => {
  it('keeps the equipment tool’s work, and says so', () => {
    expect(setup().autosave.tool).toBe('equipment');
  });

  it('writes the loadout to this page’s working record and nowhere else', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store);

    autosave.flush();

    expect([...storage.entries.keys()]).toEqual([recordKey(HELD)]);
    expect(JSON.parse(storage.entries.get(recordKey(HELD))!)).toMatchObject({
      tool: 'equipment',
      kind: 'working',
      name: null,
      // The listing reads the suit from the record rather than rebuilding the
      // loadout to find out what is on it.
      suitFamily: 'tacticalsuit',
    });
    expect(store.persistence()).toBe('saved');
  });

  it('writes on a lifecycle flush without waiting for the coalescing window', () => {
    const { autosave, store, storage, lifecycle } = setup();
    const stop = autosave.start();
    benchLoadout(store);

    lifecycle.fire();

    expect(storage.entries.has(recordKey(HELD))).toBe(true);
    stop();
  });

  it('writes nothing while the bench is empty', () => {
    const { autosave, storage } = setup();

    autosave.flush();

    expect(storage.entries.size).toBe(0);
  });

  it('writes nothing for a loadout at its suit’s default, and mints no record for it', () => {
    // Nothing a Commander decided is on it. It is the loadout the bench starts
    // when a suit is chosen, reached again by choosing the suit (024/FR-002).
    const { autosave, store, storage } = setup();
    benchLoadout(store, 'tacticalsuit', null);

    autosave.flush();

    expect(storage.entries.size).toBe(0);
    expect(store.autosaveRecordId()).toBeNull();
    expect(store.persistence()).toBe('ready');
  });

  it('writes a record at the first change to a default loadout', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store, 'tacticalsuit', null);
    autosave.flush();

    store.dispatch({ kind: 'setSuitGrade', grade: 4 });
    autosave.flush();

    const minted = store.autosaveRecordId();
    expect(minted).not.toBeNull();
    expect([...storage.entries.keys()]).toEqual([recordKey(minted!)]);
    expect(store.persistence()).toBe('saved');
  });

  it('mints a record for a loadout that arrived in none', () => {
    const { autosave, store, storage } = setup();
    chosenLoadout(store, 'tacticalsuit', null);

    autosave.flush();

    const minted = store.autosaveRecordId();
    expect(minted).not.toBeNull();
    expect([...storage.entries.keys()]).toEqual([recordKey(minted!)]);
  });

  it('takes over an unnamed record already holding this loadout, rather than storing a second copy', () => {
    const { autosave, store, storage } = setup();
    // One chosen loadout, stored once. Then the same loadout arrives again in
    // no record of its own — one link to it opened twice.
    const loadout = chosenLoadout(store);
    autosave.flush();
    const bytes = storage.entries.get(recordKey(HELD))!;

    store.open(loadout, null, { autosaveRecordId: null, baseline: null });
    autosave.flush();

    expect(store.autosaveRecordId()).toBe(HELD);
    expect([...storage.entries.keys()]).toEqual([recordKey(HELD)]);
    // Taken over, not rewritten: the bytes and the instant on them are the
    // ones the first write left.
    expect(storage.entries.get(recordKey(HELD))).toBe(bytes);
    expect(store.dirty()).toBe(false);
  });

  it('pauses after the record is discarded elsewhere, until an explicit resume', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));
    autosave.flush();

    expect(store.persistence()).toBe('record-deleted-externally');
    expect(storage.entries.has(recordKey(HELD))).toBe(false);

    autosave.resume();
    expect(storage.entries.has(recordKey(HELD))).toBe(true);
  });

  it('resumes a loadout that has not changed since the record was discarded', () => {
    // A loadout opened from a record matches what that record held, so the
    // ordinary "nothing is owed" rule would answer an explicit request with no
    // write at all — and the one action the bench offers would remove itself by
    // failing (017/FR-008).
    const { autosave, store, storage } = setup();
    const loadout = newLoadout('tacticalsuit')!;
    store.open(loadout, null, { autosaveRecordId: HELD, baseline: loadoutFingerprint(loadout) });
    expect(store.dirty()).toBe(false);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));
    autosave.resume();

    expect(storage.entries.has(recordKey(HELD))).toBe(true);
    expect(store.persistence()).toBe('saved');
  });

  it('says whether the work is in a record it can be opened from again', () => {
    // What whoever is about to let go of the loadout reads (017/FR-006).
    const { autosave, store, storage } = setup();
    benchLoadout(store);

    expect(autosave.flush()).toBe(true);

    // Nothing owed on it, so it is still where it was left.
    store.markSaved(null);
    expect(autosave.flush()).toBe(true);

    store.dispatch({ kind: 'setSuitGrade', grade: 4 });
    storage.writeError = quotaError();
    expect(autosave.flush()).toBe(false);
  });

  it('says the work is nowhere when the record it holds is named elsewhere', () => {
    // Named in another tab while this page was on another screen, so no fork
    // was heard. Autosave refuses a named target, which leaves the change on
    // this page in nothing (001/FR-008, 017/FR-007).
    const { autosave, store, records } = setup();
    records.write({
      id: HELD,
      kind: 'named',
      revisionId: 'r',
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
      name: 'Their save',
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('utilitysuit')! },
    });
    benchLoadout(store);

    expect(autosave.flush()).toBe(false);
    // And said, rather than refused in silence: a screen that still read
    // "saved" would be stating something untrue.
    expect(store.persistence()).toBe('write-failed');
  });

  it('saves again once the bench holds a record nobody discarded', () => {
    // The pause is about one record. A Commander who opens another loadout, or
    // pastes a link, is not asking to recreate what they discarded elsewhere —
    // and a pause left standing would stop every later save in silence.
    const { autosave, store, storage } = setup();
    benchLoadout(store);
    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));

    store.open(newLoadout('utilitysuit')!, null, { autosaveRecordId: 'another-record' });
    autosave.flush();

    expect(autosave.paused()).toBe(false);
    expect(storage.entries.has(recordKey('another-record'))).toBe(true);
    // And the record that was discarded stays discarded.
    expect(storage.entries.has(recordKey(HELD))).toBe(false);
  });

  it('stamps a record it is handed with that record’s own creation instant', () => {
    // The bench writes to whatever record it is handed, and a Commander opening
    // a second unnamed loadout hands it another. An instant remembered from the
    // first would be stamped onto the second (001/FR-013, 017/SC-003).
    const { autosave, store, records, storage } = setup();
    records.write({
      id: 'second',
      kind: 'working',
      revisionId: 'r',
      createdAt: '2025-11-01T00:00:00.000Z',
      modifiedAt: '2025-11-01T00:00:00.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('utilitysuit')! },
    });

    // A first record, written under this page's own instant.
    benchLoadout(store);
    autosave.flush();

    // Then the second, opened from the saved list and changed.
    store.open(newLoadout('utilitysuit')!, null, { autosaveRecordId: 'second' });
    store.dispatch({ kind: 'setSuitGrade', grade: 3 });
    autosave.flush();

    expect(JSON.parse(storage.entries.get(recordKey('second'))!)).toMatchObject({
      createdAt: '2025-11-01T00:00:00.000Z',
    });
  });

  it('never takes over a record of the other tool (017/FR-007, 017/FR-010)', () => {
    // The one record this browser holds is a build's. A loadout minting its own
    // rather than writing into it is the whole rule: the two hold different
    // content and are never the same state.
    const { autosave, store, records, storage } = setup();
    records.write({
      id: 'a-build',
      kind: 'working',
      revisionId: 'r',
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: {
        tool: 'ship',
        build: toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
        validation: { valid: true, complete: true },
      },
    });

    chosenLoadout(store, 'tacticalsuit', null);
    autosave.flush();

    expect(store.autosaveRecordId()).not.toBe('a-build');
    expect(storage.entries.size).toBe(2);
    expect(storage.entries.get(recordKey('a-build'))).toContain('"tool":"ship"');
  });

  it('keeps the instant a record it takes over was created', () => {
    // Taking over is not creating. Stamping the entry with now would have it
    // state a moment that did not happen (constitution IV).
    const { autosave, store, records, storage } = setup();
    // Carrying a choice, because a loadout at its suit's default takes no
    // record at all and has nothing to take over (024/FR-002).
    const loadout = setSuitGrade(newLoadout('utilitysuit')!, 3);
    records.write({
      id: 'older',
      kind: 'working',
      revisionId: 'r',
      createdAt: '2025-12-01T00:00:00.000Z',
      modifiedAt: '2025-12-01T00:00:00.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout },
    });

    // A page that has already written a record of its own, so its own instant
    // is the one it would otherwise carry over.
    chosenLoadout(store);
    autosave.flush();
    // Then the same loadout the stored record holds, arriving in no record.
    store.open(loadout, null, {});
    autosave.flush();
    expect(store.autosaveRecordId()).toBe('older');

    store.dispatch({ kind: 'setSuitGrade', grade: 4 });
    autosave.flush();

    expect(JSON.parse(storage.entries.get(recordKey('older'))!)).toMatchObject({
      createdAt: '2025-12-01T00:00:00.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('writes nothing while the loadout matches what its record already holds', () => {
    // A flush with nothing owed is not a write. If it were, `modifiedAt` would
    // move and the seven days the entry is counting down would restart
    // (001/FR-013, 017/SC-003).
    const { autosave, store, storage } = setup();
    benchLoadout(store);
    autosave.flush();
    store.markSaved(null);
    const written = storage.entries.get(recordKey(HELD))!;

    autosave.flush();

    expect(storage.entries.get(recordKey(HELD))).toBe(written);
  });

  it('refuses a named record as a target, whatever the page believes it holds', () => {
    // The check reads the stored record rather than this page's belief about
    // it, so a record named in another tab is covered too (001/FR-008,
    // 017/FR-007).
    const { autosave, store, records, storage } = setup();
    records.write({
      id: HELD,
      kind: 'named',
      revisionId: 'r',
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
      name: 'Their save',
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('utilitysuit')! },
    });
    const named = storage.entries.get(recordKey(HELD))!;
    benchLoadout(store);

    autosave.flush();

    expect(storage.entries.get(recordKey(HELD))).toBe(named);
    expect(store.loadout()).not.toBeNull();
  });

  it('leaves an unnamed record already holding the default state where it is', () => {
    // Stored by an earlier version, or left by a loadout since changed back. It
    // is not taken over, because a default loadout takes no record at all — it
    // is an ordinary unnamed entry running out its own seven days (024/FR-002).
    const { autosave, store, records, storage } = setup();
    records.write({
      id: 'older',
      kind: 'working',
      revisionId: 'r',
      createdAt: '2025-12-01T00:00:00.000Z',
      modifiedAt: '2025-12-01T00:00:00.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('tacticalsuit')! },
    });
    const bytes = storage.entries.get(recordKey('older'))!;
    benchLoadout(store, 'tacticalsuit', null);

    autosave.flush();

    expect(store.autosaveRecordId()).toBeNull();
    expect(storage.entries.get(recordKey('older'))).toBe(bytes);
    expect([...storage.entries.keys()]).toEqual([recordKey('older')]);
  });

  it('writes on an explicit resume even where the loadout is at its suit’s default', () => {
    // Resuming is a Commander asking for the loadout to be kept, and it takes a
    // record as a manual save does. The record it already holds is the one it
    // is written back into (017/FR-008, 024/FR-002).
    const { autosave, store, storage } = setup();
    chosenLoadout(store);
    autosave.flush();
    store.markSaved(null);
    store.dispatch({ kind: 'setSuitGrade', grade: 1 });
    expect(store.atDefault()).toBe(true);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));
    autosave.resume();

    expect(storage.entries.has(recordKey(HELD))).toBe(true);
    expect(store.persistence()).toBe('saved');
  });

  it('keeps the record a loadout changed back to its suit’s default already holds', () => {
    // A record is removed by a confirmed deletion, by the manual save that
    // consumes it, or by expiry, and by nothing else. Changing back to the
    // default is none of those (024/FR-002).
    const { autosave, store, storage } = setup();
    chosenLoadout(store);
    autosave.flush();
    store.markSaved(null);

    store.dispatch({ kind: 'setSuitGrade', grade: 1 });
    autosave.flush();

    expect(store.atDefault()).toBe(true);
    expect(store.autosaveRecordId()).toBe(HELD);
    expect(JSON.parse(storage.entries.get(recordKey(HELD))!)).toMatchObject({
      loadout: newLoadout('tacticalsuit')!,
    });
  });

  it('opens a loadout from the address into no record, after its record was deleted here', () => {
    // A deletion confirmed on this page clears the bench, and the address
    // behind it still carries the loadout. It opens again from there, because
    // what was deleted is the record and not the address — and a loadout at its
    // suit's default opens into no record, as it does by every other route. The
    // record stays deleted either way (017/FR-008, 024/FR-002).
    const { autosave, store, records, storage } = setup();
    // Chosen, stored, then changed back, so the record the Commander deletes is
    // one holding a loadout at its suit's default.
    chosenLoadout(store);
    autosave.flush();
    store.markSaved(null);
    store.dispatch({ kind: 'setSuitGrade', grade: 1 });
    autosave.flush();
    expect(storage.entries.has(recordKey(HELD))).toBe(true);

    records.remove(HELD);
    expect(store.clearIfHolding(HELD)).toBe(true);

    // Back at the address, which carries the loadout and no record.
    store.open(newLoadout('tacticalsuit')!, null);
    autosave.flush();

    expect(store.hasLoadout()).toBe(true);
    expect(store.atDefault()).toBe(true);
    expect(store.autosaveRecordId()).toBeNull();
    expect(storage.entries.size).toBe(0);
    expect(store.persistence()).toBe('ready');
  });

  it('wakes no timer for an untouched default loadout, and one at its first choice', () => {
    // A bench left open on a chosen suit stays open. A timeout every 400 ms
    // across that would be work spent deciding the same thing again
    // (024/FR-002).
    vi.useFakeTimers();
    try {
      const { autosave, store, storage } = setup();
      const stop = autosave.start();
      benchLoadout(store, 'tacticalsuit', null);

      store.select('PrimaryWeapon1');
      store.select('suit');
      TestBed.tick();
      vi.advanceTimersByTime(2_000);
      expect(storage.entries.size).toBe(0);

      store.dispatch({ kind: 'setSuitGrade', grade: 3 });
      TestBed.tick();
      vi.advanceTimersByTime(600);

      expect(storage.entries.size).toBe(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the loadout editable when the store is full', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store);
    storage.writeError = quotaError();

    autosave.flush();

    expect(store.persistence()).toBe('quota-full');
    expect(store.loadout()).not.toBeNull();
  });

  it('keeps the loadout editable when the store is blocked', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store);
    storage.accessError = new DOMException('denied', 'SecurityError');

    autosave.flush();

    expect(store.persistence()).toBe('unavailable');
    expect(store.loadout()).not.toBeNull();
  });

  it('reports a generic failure without losing the loadout', () => {
    const { autosave, store, storage } = setup();
    benchLoadout(store);
    storage.writeError = new Error('disk on fire');

    autosave.flush();

    expect(store.persistence()).toBe('write-failed');
    expect(store.loadout()).not.toBeNull();
  });

  it('coalesces a burst of choices into one write', async () => {
    const { autosave, store, storage } = setup();
    const stop = autosave.start();
    benchLoadout(store);

    for (const grade of [2, 3, 4, 5]) {
      store.dispatch({ kind: 'setSuitGrade', grade });
    }
    TestBed.tick();
    expect(storage.entries.has(recordKey(HELD))).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(storage.entries.has(recordKey(HELD))).toBe(true);
    stop();
  });
});
