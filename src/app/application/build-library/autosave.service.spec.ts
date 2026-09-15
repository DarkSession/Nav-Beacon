import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { OutfittingModule } from '@elite-dangerous-almanac/core/ships/modules';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { AutosaveService } from './autosave.service';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

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

function setup(seed: (storage: MemoryStorage) => void = () => {}) {
  const storage = new MemoryStorage();
  const lifecycle = new FakeLifecycle();
  seed(storage);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ...provideMemoryStorage(storage),
      { provide: PageLifecycleAdapter, useValue: lifecycle },
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
    ],
  });

  const autosave = TestBed.inject(AutosaveService);
  TestBed.inject(ClockAdapter).now = () => new Date('2026-01-02T03:04:05.000Z');
  const active = TestBed.inject(ActiveBuildStore);
  return { autosave, active, storage, lifecycle };
}

/** The record a test hands the page, standing in for one it minted itself. */
const HELD = 'held-record';

function commitBuild(
  active: ActiveBuildStore,
  symbol = 'Anaconda',
  autosaveRecordId: string | null = HELD,
): ShipLoadout {
  const loadout = ShipLoadout.default(symbol);
  active.commit({
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: symbol,
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId,
    baseline: null,
  });
  return loadout;
}

/**
 * A build carrying one decision, so a record is owed for it.
 *
 * What most of these cases are about. A build still at the package default owes
 * nothing and takes no record, which is its own pair of cases above
 * (024/FR-001).
 */
function editedBuild(
  active: ActiveBuildStore,
  symbol = 'Anaconda',
  autosaveRecordId: string | null = HELD,
): ShipLoadout {
  const loadout = commitBuild(active, symbol, autosaveRecordId);
  loadout.setModulePriority('FrameShiftDrive', 2);
  active.touch();
  return loadout;
}

/**
 * Fits another drive, and hands back the one the package had fitted.
 *
 * A reversible edit, for the cases that put a build back at the package
 * default. Changing a power priority is not one: the default carries none, and
 * a priority once set is a modelled field with a value in it.
 */
function swapDrive(active: ActiveBuildStore, loadout: ShipLoadout): OutfittingModule {
  const fitted = loadout.fittedModuleAt('FrameShiftDrive')!;
  const offered = loadout.modulesForSlot('FrameShiftDrive');
  const original = offered.find((module) => module.symbol === fitted.symbol);
  const other = offered.find((module) => module.symbol !== fitted.symbol);
  if (original === undefined || other === undefined) {
    throw new Error(
      'The installed Almanac offers one drive alone for the Anaconda. Pick a mount with a ' +
        'choice from the package rather than writing one here.',
    );
  }
  loadout.setModule('FrameShiftDrive', other);
  active.touch();
  return original;
}

/** One stored named record, as a Commander's own save. */
function storedNamedRecord(id: string): string {
  return storedWorkingRecord(id)
    .replace('"kind":"working"', '"kind":"named"')
    .replace('"name":null', '"name":"Their save"');
}

/** One stored unnamed record, in the shape the repository writes. */
function storedWorkingRecord(id: string): string {
  return JSON.stringify({
    format: 'ednb.local-record',
    version: 1,
    id,
    kind: 'working',
    revisionId: 'r',
    createdAt: '2026-01-02T03:04:05.000Z',
    modifiedAt: '2026-01-02T03:04:05.000Z',
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
  });
}

describe('AutosaveService', () => {
  it('writes the build to this tab’s working record and nowhere else', () => {
    const { autosave, active, storage } = setup();
    const id = HELD;
    commitBuild(active);

    autosave.flush();

    expect([...storage.entries.keys()]).toEqual([recordKey(id)]);
    expect(JSON.parse(storage.entries.get(recordKey(id))!)).toMatchObject({
      kind: 'working',
      name: null,
      hullSymbol: 'Anaconda',
    });
    expect(active.persistence()).toBe('saved');
  });

  it('stores package-defaulted fixed modules as ordinary build state', () => {
    const { autosave, active, storage } = setup();
    const id = HELD;
    commitBuild(active);

    autosave.flush();
    const stored = storage.entries.get(recordKey(id))!;
    const record = JSON.parse(stored) as { build: { modules: { slot: string }[] } };

    expect(record.build.modules.some((module) => module.slot === 'Armour')).toBe(true);
    expect(record.build.modules.some((module) => module.slot === 'CargoHatch')).toBe(true);
    // No source-empty, repair or defaulting provenance anywhere in the bytes.
    expect(stored).not.toMatch(/repair|defaulted|sourceEmpty|provenance/i);
  });

  it('records the package’s validation result at that revision', () => {
    const { autosave, active, storage } = setup();
    const id = HELD;
    commitBuild(active);

    autosave.flush();

    expect(JSON.parse(storage.entries.get(recordKey(id))!)).toMatchObject({
      validation: { valid: true, complete: true },
    });
  });

  it('writes on a lifecycle flush without waiting for the coalescing window', () => {
    const { autosave, active, storage, lifecycle } = setup();
    const id = HELD;
    const stop = autosave.start();
    commitBuild(active);

    lifecycle.fire();

    expect(storage.entries.has(recordKey(id))).toBe(true);
    stop();
  });

  it('writes nothing when there is no build', () => {
    const { autosave, storage } = setup();

    autosave.flush();

    expect(storage.entries.size).toBe(0);
  });

  it('writes nothing for a build at the package default, and mints no record for it', () => {
    // Nothing a Commander decided is in it. What the library would hold is an
    // entry they have to sort past, counting down seven days over a build the
    // hull catalogue hands back whole (024/FR-001).
    const { autosave, active, storage } = setup();
    commitBuild(active, 'Anaconda', null);

    autosave.flush();

    expect(storage.entries.size).toBe(0);
    expect(active.autosaveRecordId()).toBeNull();
    expect(active.persistence()).toBe('ready');
  });

  it('writes a record at the first modelled edit of a default build', () => {
    const { autosave, active, storage } = setup();
    const loadout = commitBuild(active, 'Anaconda', null);
    autosave.flush();

    loadout.setModulePriority('FrameShiftDrive', 2);
    active.touch();
    autosave.flush();

    expect(active.autosaveRecordId()).not.toBeNull();
    expect([...storage.entries.keys()]).toEqual([recordKey(active.autosaveRecordId()!)]);
    expect(active.persistence()).toBe('saved');
  });

  it('leaves an unnamed record already holding the default state where it is', () => {
    // Stored by an earlier version, or left by a build since edited back. It is
    // not taken over, because a default build takes no record at all — it is an
    // ordinary unnamed entry running out its own seven days (024/FR-001).
    const { autosave, active, storage } = setup();
    TestBed.inject(LocalRecordRepository).write({
      id: 'older',
      kind: 'working',
      revisionId: 'revision-1',
      createdAt: '2025-11-01T00:00:00.000Z',
      modifiedAt: '2025-11-01T00:00:00.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: {
        tool: 'ship',
        build: toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
        validation: { valid: true, complete: true },
      },
    });
    const bytes = storage.entries.get(recordKey('older'))!;
    commitBuild(active, 'Anaconda', null);

    autosave.flush();

    expect(active.autosaveRecordId()).toBeNull();
    expect(storage.entries.get(recordKey('older'))).toBe(bytes);
    expect([...storage.entries.keys()]).toEqual([recordKey('older')]);
  });

  it('writes on an explicit resume even where the build is at the package default', () => {
    // Resuming is a Commander asking for the build to be kept, and it takes a
    // record as a manual save does. The record it already holds is the one it
    // is written back into (001/FR-012, 024/FR-001).
    const { autosave, active, storage } = setup();
    const loadout = commitBuild(active);
    const original = swapDrive(active, loadout);
    autosave.flush();
    active.markSaved(null);
    loadout.setModule('FrameShiftDrive', original);
    active.touch();
    expect(active.atDefault()).toBe(true);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));
    autosave.resume();

    expect(storage.entries.has(recordKey(HELD))).toBe(true);
    expect(active.persistence()).toBe('saved');
  });

  it('keeps the record a build edited back to the package default already holds', () => {
    // A record is removed by a confirmed deletion, by the manual save that
    // consumes it, or by expiry, and by nothing else. Editing back to the
    // default is none of those (024/FR-001).
    const { autosave, active, storage } = setup();
    const loadout = commitBuild(active);
    const original = swapDrive(active, loadout);
    autosave.flush();
    active.markSaved(null);

    loadout.setModule('FrameShiftDrive', original);
    active.touch();
    autosave.flush();

    expect(active.atDefault()).toBe(true);
    expect(active.autosaveRecordId()).toBe(HELD);
    expect(JSON.parse(storage.entries.get(recordKey(HELD))!)).toMatchObject({
      build: toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
    });
  });

  it('wakes no timer for an untouched default build, and one at its first edit', () => {
    // An untouched build stays open for as long as a Commander is reading it.
    // A timeout every 400 ms across that would be work spent deciding the same
    // thing again (024/FR-001).
    vi.useFakeTimers();
    try {
      const { autosave, active, storage } = setup();
      const stop = autosave.start();
      const loadout = commitBuild(active, 'Anaconda', null);

      for (let index = 0; index < 5; index += 1) {
        active.touch();
      }
      TestBed.tick();

      // The timer itself, not only what it would have written. A write is
      // turned away a second time when it lands, so storage alone cannot tell
      // a timeout that never woke from one that woke and wrote nothing.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(2_000);
      expect(storage.entries.size).toBe(0);

      loadout.setModulePriority('FrameShiftDrive', 2);
      active.touch();
      TestBed.tick();

      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(600);

      expect(storage.entries.size).toBe(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the build editable when the store is full', () => {
    const { autosave, active, storage } = setup();
    commitBuild(active);
    storage.writeError = quotaError();

    autosave.flush();

    expect(active.persistence()).toBe('quota-full');
    expect(active.loadout()).not.toBeNull();
  });

  it('keeps the build editable when the store is blocked', () => {
    const { autosave, active, storage } = setup();
    commitBuild(active);
    storage.accessError = new DOMException('denied', 'SecurityError');

    autosave.flush();

    expect(active.persistence()).toBe('unavailable');
    expect(active.loadout()).not.toBeNull();
  });

  it('reports a generic failure without losing the build', () => {
    const { autosave, active, storage } = setup();
    commitBuild(active);
    storage.writeError = new Error('disk on fire');

    autosave.flush();

    expect(active.persistence()).toBe('write-failed');
    expect(active.loadout()).not.toBeNull();
  });

  it('lets another build replace one a store failure left in no record, without asking', () => {
    // Replacing is never confirmed. A build carrying a decision is in the
    // record autosave keeps it in where the store can hold it, and where the
    // store refused that write the failure is stated on the screen rather than
    // held back to be asked at the moment a Commander asks for another build
    // (024/FR-001).
    const { autosave, active, storage } = setup();
    editedBuild(active, 'Anaconda', null);
    storage.writeError = quotaError();

    expect(autosave.flush()).toBe(false);
    // On screen and in no record: the store holds nothing, so the build is
    // nowhere but the page, whatever identity the page picked for it.
    expect(active.persistence()).toBe('quota-full');
    expect(storage.entries.size).toBe(0);

    // The Commander opens another build, and gets it.
    storage.writeError = null;
    const replacement = editedBuild(active, 'Eagle', null);
    autosave.flush();

    expect(active.loadout()).toBe(replacement);
    expect(active.hullName()).toBe('Eagle');
    // One record, for the build that is on screen. The one the store never took
    // is gone rather than written late.
    expect(storage.entries.size).toBe(1);
    expect(storage.entries.values().next().value).toContain('"shipSymbol":"Eagle"');
  });

  it('writes however many records already exist, refusing nothing', () => {
    // The twenty-record limit was withdrawn on 2026-08-25: nothing refuses to
    // store a build because many are stored, and no number evicts anything. The
    // bound that replaced it is the seven-day expiry, which the sweep applies
    // and autosave knows nothing about (FR-013).
    const { autosave, active, storage } = setup((store) => {
      for (let index = 0; index < 25; index += 1) {
        store.setItem(recordKey(`existing-${index}`), storedWorkingRecord(`existing-${index}`));
      }
    });
    const before = storage.entries.size;
    commitBuild(active);

    autosave.flush();

    expect(active.persistence()).toBe('saved');
    expect(storage.entries.size).toBe(before + 1);
  });

  it('leaves the named record it came from untouched when the store is full', () => {
    // The fork has nowhere to go, and the answer is a persistence state rather
    // than a write somewhere else: the save the build was opened from is not a
    // fallback target, then or ever (FR-008, FR-013, T153b).
    const { autosave, active, storage } = setup((store) =>
      store.setItem(recordKey('their-save'), storedNamedRecord('their-save')),
    );
    const before = storage.entries.get(recordKey('their-save'));
    // A build opened from that save and then edited: it holds no record of its
    // own yet, so this write is the fork.
    const loadout = ShipLoadout.default('Anaconda');
    active.commit({
      loadout,
      suppliedFit: suppliedFit(loadout.shipSymbol),
      hullName: 'Anaconda',
      provenance: 'named',
      sourceNamed: { recordId: 'their-save', baseRevisionId: 'r' },
      autosaveRecordId: null,
      baseline: null,
    });
    loadout.setModulePriority('FrameShiftDrive', 2);
    active.touch();
    storage.writeError = quotaError();

    autosave.flush();

    expect(active.persistence()).toBe('quota-full');
    expect(storage.entries.get(recordKey('their-save'))).toBe(before);
    expect(active.loadout()).not.toBeNull();
  });

  it('keeps the instant a record it was handed was created', () => {
    // A build restored after a reload arrives holding an id it did not mint,
    // and writing to that record is not creating it. Stamping it with now would
    // have the record state a moment that did not happen (constitution IV).
    const { autosave, active, storage } = setup();
    TestBed.inject(LocalRecordRepository).write({
      id: HELD,
      kind: 'working',
      revisionId: 'revision-1',
      createdAt: '2025-11-01T00:00:00.000Z',
      modifiedAt: '2025-11-01T00:00:00.000Z',
      name: null,
      note: null,
      sourceNamed: null,
      payload: {
        tool: 'ship',
        build: toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
        validation: { valid: true, complete: true },
      },
    });
    const loadout = commitBuild(active);
    loadout.setModulePriority('FrameShiftDrive', 2);
    active.touch();

    autosave.flush();

    expect(JSON.parse(storage.entries.get(recordKey(HELD))!)).toMatchObject({
      createdAt: '2025-11-01T00:00:00.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('pauses after the record is discarded elsewhere, until an explicit resume', () => {
    const { autosave, active, storage } = setup();
    const id = HELD;
    commitBuild(active);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(id));
    autosave.flush();

    expect(active.persistence()).toBe('record-deleted-externally');
    expect(storage.entries.has(recordKey(id))).toBe(false);

    autosave.resume();
    expect(storage.entries.has(recordKey(id))).toBe(true);
  });

  it('writes the work into the record a fork moved it onto', () => {
    // A page forks the moment another one claims the record it restored or took
    // over, and a page in that state is clean. Left to the "nothing is owed"
    // rule, the fresh record would never be written and this tab's claim would
    // name a record a reload could restore nothing from (001/FR-012).
    const { autosave, active, storage } = setup();
    commitBuild(active);
    autosave.flush();
    active.markSaved(null);

    // What the coordinator does to this store when it forks.
    active.setAutosaveRecordId('forked-record');
    autosave.adoptForkedRecord();

    expect(storage.entries.has(recordKey('forked-record'))).toBe(true);
  });

  it('resumes a build that has not changed since the record was discarded', () => {
    // The state on this page is exactly what the discarded record held, so the
    // ordinary "nothing is owed" rule would answer an explicit resume by
    // writing nothing at all (001/FR-012).
    const { autosave, active, storage } = setup();
    commitBuild(active);
    autosave.flush();
    active.markSaved(null);

    autosave.pauseAfterExternalDelete();
    storage.entries.delete(recordKey(HELD));

    autosave.resume();

    expect(storage.entries.has(recordKey(HELD))).toBe(true);
  });

  it('lifts the pause once the build is written somewhere else', () => {
    // The pause is about one record. A Commander who opens another build has
    // moved off the record somebody discarded, and saving that build recreates
    // nothing anybody decided against (001/FR-012).
    const { autosave, active, storage } = setup();
    commitBuild(active);
    autosave.pauseAfterExternalDelete();

    const loadout = commitBuild(active, 'Anaconda', 'another-record');
    loadout.setModulePriority('FrameShiftDrive', 2);
    active.touch();
    autosave.flush();

    expect(autosave.paused()).toBe(false);
    expect(storage.entries.has(recordKey('another-record'))).toBe(true);
  });

  it('writes nothing while the build matches what its record already holds', () => {
    // Taking a record over is not modifying it. If this wrote, `modifiedAt`
    // would move and the seven days the entry is counting down would restart
    // (FR-013, clarification 2026-08-25).
    const { autosave, active, storage } = setup();
    const loadout = commitBuild(active);
    autosave.flush();
    const written = storage.entries.get(recordKey(HELD))!;

    active.markSaved(null);
    loadout.setModulePriority('FrameShiftDrive', 2);
    active.touch();
    active.markSaved(null);
    autosave.flush();

    expect(storage.entries.get(recordKey(HELD))).toBe(written);
  });

  it('takes over an unnamed record already holding this build, rather than storing a second copy', () => {
    const { autosave, active, storage } = setup();
    // One edited build, stored once. Then the same modelled state arrives again
    // with no record of its own — one link to it opened twice.
    editedBuild(active);
    autosave.flush();
    const first = active.autosaveRecordId();
    const bytes = storage.entries.get(recordKey(HELD))!;

    editedBuild(active, 'Anaconda', null);
    autosave.flush();

    expect(active.autosaveRecordId()).toBe(first);
    expect([...storage.entries.keys()]).toEqual([recordKey(HELD)]);
    // Taken over, not rewritten: the bytes and the instant on them are the
    // ones the first write left.
    expect(storage.entries.get(recordKey(HELD))).toBe(bytes);
    expect(active.dirty()).toBe(false);
  });

  it('mints a record when nothing stored matches, rather than taking over a different build', () => {
    const { autosave, active, storage } = setup();
    editedBuild(active);
    autosave.flush();

    editedBuild(active, 'Sidewinder', null);
    autosave.flush();

    expect(active.autosaveRecordId()).not.toBe(HELD);
    expect(storage.entries.size).toBe(2);
  });

  it('refuses a named record as a target, whatever the page believes it holds', () => {
    // The check reads the stored record rather than this page's belief about
    // it, so a record named in another tab is covered too (FR-008).
    const { autosave, active, storage } = setup((store) =>
      store.setItem(
        recordKey(HELD),
        JSON.stringify({
          format: 'ednb.local-record',
          version: 1,
          id: HELD,
          kind: 'named',
          revisionId: 'r',
          createdAt: '2026-01-02T03:04:05.000Z',
          modifiedAt: '2026-01-02T03:04:05.000Z',
          name: 'PACIFIER',
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
        }),
      ),
    );
    const named = storage.entries.get(recordKey(HELD))!;
    commitBuild(active);

    autosave.flush();

    expect(storage.entries.get(recordKey(HELD))).toBe(named);
    expect(active.loadout()).not.toBeNull();
    // And said, rather than refused in silence: the build is in nothing, and a
    // refusal that drew no notice left the Commander with nothing to answer it
    // with (001/FR-014).
    expect(active.persistence()).toBe('write-failed');
    // And let go of, so the retry the notice offers has somewhere to land.
    expect(active.autosaveRecordId()).toBeNull();
  });

  it('answers a retry after a named target with a record of its own', () => {
    // The notice draws one control. Held on to, the named record would refuse
    // every later write the same way and the control would do nothing however
    // often it is pressed (001/FR-008, 001/FR-014).
    const { autosave, active, storage } = setup((store) =>
      store.setItem(recordKey(HELD), storedNamedRecord(HELD)),
    );
    editedBuild(active);
    autosave.flush();

    autosave.flush();

    expect(active.persistence()).toBe('saved');
    const written = [...storage.entries.keys()].filter((key) => key.startsWith('ednb:record:'));
    expect(written).toHaveLength(2);
  });

  it('coalesces a burst of edits into one write', async () => {
    const { autosave, active, storage } = setup();
    const id = HELD;
    const stop = autosave.start();
    const loadout = commitBuild(active);

    for (let index = 0; index < 5; index += 1) {
      loadout.setModulePriority('FrameShiftDrive', index % 5);
      active.touch();
    }
    TestBed.tick();
    expect(storage.entries.has(recordKey(id))).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(storage.entries.has(recordKey(id))).toBe(true);
    stop();
  });
});
