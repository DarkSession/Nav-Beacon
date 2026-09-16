import { TestBed } from '@angular/core/testing';
import { newLoadout } from '../../domain/equipment/loadout/loadout-edit';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';
import { provideLocalization } from '../../i18n/i18n.providers';
import { TabOwnershipCoordinator } from '../build-library/tab-ownership.coordinator';
import { EmptyBenchService } from './empty-bench.service';
import { LoadoutAutosaveService } from './loadout-autosave.service';
import { LoadoutLinkCoordinator } from './loadout-link.coordinator';
import { LoadoutStore } from './loadout.store';

/** A location that remembers what was written to it, without a browser. */
class MemoryLocation {
  fragmentValue = '';
  /** How many times the fragment was replaced, so a test can count entries. */
  replacements = 0;

  fragment(): string {
    return this.fragmentValue;
  }

  currentDocument(): string {
    return '/equipment';
  }

  urlWithFragment(value: string): string {
    return `https://navbeacon.test/equipment#${value}`;
  }

  replaceFragment(value: string | null): void {
    this.replacements += 1;
    this.fragmentValue = value ?? '';
  }
}

class SilentLifecycle {
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

function setup() {
  const location = new MemoryLocation();
  const storage = new MemoryStorage();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideMemoryStorage(storage),
      { provide: HistoryLocationAdapter, useValue: location },
      { provide: PageLifecycleAdapter, useValue: new SilentLifecycle() },
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
    ],
  });
  return {
    location,
    storage,
    bench: TestBed.inject(EmptyBenchService),
    store: TestBed.inject(LoadoutStore),
    links: TestBed.inject(LoadoutLinkCoordinator),
    records: TestBed.inject(LocalRecordRepository),
    autosave: TestBed.inject(LoadoutAutosaveService),
    tab: TestBed.inject(TabDescriptorRepository),
    ownership: TestBed.inject(TabOwnershipCoordinator),
  };
}

/**
 * A bench carrying one choice, so a record is owed for the loadout on it.
 *
 * A loadout still at its suit's default takes no record, which is its own case
 * below: it is the loadout that leaves nothing behind (024/FR-002).
 */
function chosen(store: LoadoutStore, suitFamily = 'tacticalsuit'): void {
  store.dispatch({ kind: 'selectSuit', suitFamily });
  store.dispatch({ kind: 'setSuitGrade', grade: 5 });
}

/** The records this browser is holding, as the saved list reads them. */
function stored(records: LocalRecordRepository) {
  const listed = records.list();
  return listed.ok ? listed.value.filter((entry) => entry.available) : [];
}

describe('starting an empty bench', () => {
  it('leaves the bench as it is before a suit is chosen', () => {
    const { bench, store } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store.dispatch({ kind: 'setSuitGrade', grade: 5 });

    bench.start();

    expect(store.hasLoadout()).toBe(false);
    // The suit gate stands, which is the row the bench points at with nothing
    // on it.
    expect(store.selected()).toBe('suit');
    // The choices before it belong to a loadout that is no longer here.
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('keeps the loadout that was on the bench, as the record it is autosaved to', () => {
    // Which is what makes the action safe to offer without asking: there is
    // nothing to lose (017/FR-006).
    const { bench, store, records } = setup();
    chosen(store);

    bench.start();

    const saved = stored(records);
    expect(saved.length).toBe(1);
    const record = saved[0]?.available === true ? saved[0].record : null;
    expect(record?.kind).toBe('working');
    expect(record !== null && record.tool === 'equipment' && record.suitFamily).toBe(
      'tacticalsuit',
    );
  });

  it('leaves a named record it was opened from exactly as it was', () => {
    const { bench, store, records, storage } = setup();
    // The save as this browser is holding it, byte for byte, before the bench
    // is ever touched.
    records.write({
      id: 'their-save',
      kind: 'named',
      revisionId: 'revision-1',
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
      name: 'Their save',
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('tacticalsuit')! },
    });
    const named = storage.entries.get(recordKey('their-save'));

    store.open(newLoadout('tacticalsuit')!, null, { autosaveRecordId: null });
    store.markSaved({ recordId: 'their-save', baseRevisionId: 'revision-1' });
    store.dispatch({ kind: 'setSuitGrade', grade: 5 });

    bench.start();

    // Autosave has no path to a named record, so what it wrote is an unnamed
    // one of its own and the save is untouched.
    expect(storage.entries.get(recordKey('their-save'))).toBe(named);
    expect(
      stored(records).some((entry) => entry.available && entry.record.kind === 'working'),
    ).toBe(true);
    expect(store.sourceNamed()).toBeNull();
  });

  it('lets go of this tab’s claim on the loadout, and keeps the record', () => {
    const { bench, store, storage, tab, ownership } = setup();
    tab.write('equipment', 'held-loadout');
    store.open(newLoadout('tacticalsuit')!, null, { autosaveRecordId: 'held-loadout' });

    bench.start();

    // The claim is what a reload reads, so a claim left behind would restore
    // the loadout that was just cleared (017/FR-006).
    expect(ownership.claim('equipment')).toBeNull();
    // The record it named is exactly what makes clearing the bench cost
    // nothing, so it stays where it is.
    expect(storage.entries.get(recordKey('held-loadout'))).toContain('"tool":"equipment"');
  });

  it('leaves the ship tool’s claim where it is', () => {
    const { bench, store, tab, ownership } = setup();
    tab.write('ship', 'a-build');
    tab.write('equipment', 'held-loadout');
    store.open(newLoadout('tacticalsuit')!, null, { autosaveRecordId: 'held-loadout' });

    bench.start();

    // A page holds a build and a loadout at once. Emptying the bench is the
    // equipment tool's action and says nothing about the build (017/FR-010).
    expect(ownership.claim('ship')).toBe('a-build');
    expect(ownership.claim('equipment')).toBeNull();
  });

  it('leaves the loadout on the bench where the store cannot hold it', () => {
    // The action is free to offer because the loadout stays as a record. Where
    // that write cannot happen, clearing the bench would lose it, so the bench
    // stays as it is and the notice on it says why (017/FR-006).
    const { bench, store, storage } = setup();
    chosen(store);
    storage.writeError = quotaError();

    bench.start();

    expect(store.hasLoadout()).toBe(true);
    expect(store.persistence()).toBe('quota-full');
  });

  it('leaves a loadout carrying a choice on the bench while saving is paused', () => {
    // Paused because the record was discarded in another tab. Nothing is
    // written until a Commander asks for it, so there is nothing to leave the
    // loadout in. The grade is the choice that makes clearing a loss: a loadout
    // still at its suit's default would be cleared here (024/FR-002).
    const { bench, store, autosave } = setup();
    store.open(newLoadout('tacticalsuit')!, null, { autosaveRecordId: 'discarded' });
    store.dispatch({ kind: 'setSuitGrade', grade: 5 });
    autosave.pauseAfterExternalDelete();

    bench.start();

    expect(store.hasLoadout()).toBe(true);
    expect(store.persistence()).toBe('record-deleted-externally');
  });

  it('leaves a loadout carrying a choice on the bench when its record was named elsewhere', () => {
    // Autosave refuses a named target, so the change on this bench is in
    // nothing. Clearing it would be the loss the action promises to avoid.
    const { bench, store, records } = setup();
    records.write({
      id: 'their-save',
      kind: 'named',
      revisionId: 'revision-1',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      name: 'Their save',
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout('utilitysuit')! },
    });
    store.open(newLoadout('tacticalsuit')!, null, { autosaveRecordId: 'their-save' });
    store.dispatch({ kind: 'setSuitGrade', grade: 5 });

    bench.start();

    expect(store.hasLoadout()).toBe(true);
    expect(store.persistence()).toBe('write-failed');
  });

  it('takes the loadout out of the address without adding a history entry', () => {
    const { bench, store, links, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    links.publish();
    expect(location.fragmentValue.startsWith('e.')).toBe(true);
    const replacements = location.replacements;

    bench.start();

    expect(location.fragmentValue).toBe('');
    // Replaced in place: a Commander pressing BACK meant to leave the bench,
    // not to walk back through the loadouts it has held.
    expect(location.replacements).toBe(replacements + 1);
    expect(links.link()).toEqual({ kind: 'absent' });
  });

  it('clears a bench holding a loadout at its suit’s default, leaving nothing behind', () => {
    // Such a loadout takes no record, and none is owed on the way out either: a
    // Commander reaches it again by choosing the suit. The bench empties all
    // the same, because there is nothing to lose (024/FR-002, 017/FR-006).
    // Nothing was claimed for it either, so the claim below is read as the end
    // state rather than as something this action let go of.
    const { bench, store, records, ownership, location } = setup();
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    expect(store.atDefault()).toBe(true);

    bench.start();

    expect(store.hasLoadout()).toBe(false);
    expect(stored(records)).toEqual([]);
    expect(ownership.claim('equipment')).toBeNull();
    expect(location.fragmentValue).toBe('');
  });

  it('leaves a loadout carrying a choice on the bench while the store is blocked', () => {
    // The store refused the write outright, so the loadout is in nothing.
    // Clearing the bench would be the loss the action promises to avoid
    // (017/FR-006, 017/FR-008).
    const { bench, store, storage } = setup();
    chosen(store);
    storage.accessError = new DOMException('denied', 'SecurityError');

    bench.start();

    expect(store.hasLoadout()).toBe(true);
    expect(store.persistence()).toBe('unavailable');
  });

  it('changes nothing at all on a bench that is already empty', () => {
    const { bench, store, location, records } = setup();
    const revision = store.revision();

    bench.start();

    expect(store.revision()).toBe(revision);
    expect(store.hasLoadout()).toBe(false);
    expect(location.replacements).toBe(0);
    expect(stored(records)).toEqual([]);
  });
});

describe('a record deleted on this page', () => {
  it('clears the bench holding it, and lets go of this tab’s claim on it', () => {
    // The opposite answer to the opposite event: a deletion made here was
    // decided here, so writing the loadout back on the next change would undo
    // what the Commander confirmed (017/FR-008).
    const { bench, store, autosave, tab, ownership } = setup();
    // What the bench does on the way in, so that the claim this asks about is
    // one something actually wrote.
    const stopTracking = ownership.track(store);
    chosen(store);
    autosave.flush();
    TestBed.tick();
    const mine = store.autosaveRecordId()!;
    expect(tab.read()?.workingRecords.equipment).toBe(mine);

    expect(bench.clearHolding(mine)).toBe(true);

    expect(store.hasLoadout()).toBe(false);
    expect(store.autosaveRecordId()).toBeNull();
    // A claim outliving the record would have the next page built in this tab
    // restore from an entry that is gone.
    expect(tab.read()?.workingRecords.equipment).toBeUndefined();
    stopTracking();
  });

  it('takes the loadout out of the address, so the link does not read it back', () => {
    const { bench, store, autosave, links, location } = setup();
    chosen(store);
    autosave.flush();
    links.publish();
    expect(location.fragmentValue.startsWith('e.')).toBe(true);

    bench.clearHolding(store.autosaveRecordId()!);

    expect(location.fragmentValue).toBe('');
    expect(links.link()).toEqual({ kind: 'absent' });
  });

  it('leaves a bench holding another record entirely alone', () => {
    const { bench, store, autosave, location } = setup();
    chosen(store);
    autosave.flush();
    const mine = store.autosaveRecordId();
    expect(mine).not.toBeNull();
    const replacements = location.replacements;

    expect(bench.clearHolding('someone-elses')).toBe(false);

    expect(store.hasLoadout()).toBe(true);
    expect(store.autosaveRecordId()).toBe(mine);
    expect(location.replacements).toBe(replacements);
  });
});
