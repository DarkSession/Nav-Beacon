import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LoadoutStore } from '../../application/equipment/loadout.store';
import { provideLocalization } from '../../i18n/i18n.providers';
import { LoadoutLinkCoordinator } from '../../application/equipment/loadout-link.coordinator';
import { LoadoutAutosaveService } from '../../application/equipment/loadout-autosave.service';
import { LoadoutOpenService } from '../../application/equipment/loadout-open.service';
import { EmptyBenchService } from '../../application/equipment/empty-bench.service';
import { newLoadout } from '../../domain/equipment/loadout/loadout-edit';
import { encodeEquipmentLinkFragment } from '../../domain/equipment/loadout-link/equipment-link-codec-loader';
import { isEquipmentRecord } from '../../domain/records/local-record';
import { WebLocksAdapter } from '../../platform/browser/web-locks.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordKey } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { declareMeasurement, declareResizeObserver } from '../../ui/measurement.spec-helpers';
import { BENCH_WIDE_MINIMUM_REM } from '../../ui/equipment/bench-composition';
import { LibraryPresence } from '../build-library/library-presence';
import { ScreenChrome } from '../shared/screen-chrome';
import { EquipmentBenchPage } from './equipment-bench.page';

/**
 * The bench's two arrangements.
 *
 * The renderer lays nothing out, so a spec about the wide composition says how
 * wide the bench is; without that declaration the region reports `compact`,
 * which is artboard `1b` and the one every capability has to fit into.
 */
function declareWideBench(): () => void {
  const measured = declareMeasurement({ width: BENCH_WIDE_MINIMUM_REM * 16 });
  const observed = declareResizeObserver();

  return () => {
    observed();
    measured();
  };
}

/** A lock that serializes without a browser: what is under test is the save. */
class FakeLocks {
  readonly available = true;

  async request<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

describe('EquipmentBenchPage', () => {
  let store: LoadoutStore;
  let records: LocalRecordRepository;
  let storage: MemoryStorage;

  beforeEach(async () => {
    // The bench publishes the loadout it holds into the address, and the
    // document's address outlives one test. A fragment left by an earlier one
    // is a loadout this bench would open on creation, so each test starts from
    // an address carrying nothing.
    history.replaceState(null, '', location.pathname);

    await TestBed.configureTestingModule({
      imports: [EquipmentBenchPage],
      providers: [
        provideLocalization(),
        provideRouter([]),
        // The bench saves into the one record library, so it reaches storage
        // the moment it is created.
        ...provideMemoryStorage((storage = new MemoryStorage())),
        { provide: WebLocksAdapter, useValue: new FakeLocks() },
      ],
    }).compileComponents();
    store = TestBed.inject(LoadoutStore);
    records = TestBed.inject(LocalRecordRepository);
  });

  const render = (): HTMLElement => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const wear = (): void => {
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
  };

  /**
   * One choice on the loadout, so there is a record to write.
   *
   * The loadout the bench starts for a suit holds nothing a Commander decided
   * and is stored nowhere, so every case here about a record makes a choice
   * first (024/FR-002).
   */
  const choose = (): void => {
    store.dispatch({ kind: 'setSuitGrade', grade: 3 });
  };

  it('opens an empty compact bench straight onto the chooser', () => {
    // Canvas 2b draws no ledger at all: the `LOADOUT` tab opens on `STEP 1 ·
    // CHOOSE A SUIT`. Every row a ledger would draw there says `LOCKED` about a
    // mount no suit has offered yet, and at 390px they fill the screen the one
    // live choice has to be on. The gate keeps its heading for a reader, which
    // is what names the region (US1 scenario 1).
    const bench = render();

    expect(bench.querySelector('.bench__region--loadout')).toBeNull();
    expect(bench.querySelector('ednb-suit-gate')).not.toBeNull();
    expect(bench.querySelector('ednb-item-view')).toBeNull();
    expect(bench.querySelector('.gate__title')?.textContent?.trim()).toBe(
      BUNDLED_ENGLISH['equipment.gate.title'],
    );
  });

  it('draws the gate where the item view goes once a suit is on the bench', () => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    fixture.componentInstance.chooseFirstSuit('tacticalsuit');
    fixture.detectChanges();

    const bench = fixture.nativeElement as HTMLElement;
    expect(bench.querySelector('ednb-suit-gate')).toBeNull();
    expect(store.selected()).toBe('suit');
  });

  it('draws the ledger, the item view and the commander column where there is room', () => {
    const restore = declareWideBench();
    try {
      wear();
      const named = [...render().querySelectorAll('.bench__region')].map((region) =>
        region.getAttribute('aria-label'),
      );

      // Canvas 1a's three columns, with the materials block under the stats.
      expect(named).toEqual([
        BUNDLED_ENGLISH['equipment.region.loadout'],
        BUNDLED_ENGLISH['equipment.region.item'],
        BUNDLED_ENGLISH['equipment.region.stats'],
        BUNDLED_ENGLISH['equipment.region.materials'],
      ]);
    } finally {
      restore();
    }
  });

  it('draws one tab at a time where there is not, the ledger first', () => {
    wear();
    const bench = render();

    expect(bench.querySelector('ednb-tab-group')).not.toBeNull();
    expect(bench.querySelector('.bench__region--loadout')).not.toBeNull();
    expect(bench.querySelector('.bench__region--stats')).toBeNull();
  });

  it('gives the materials a tab of their own where the columns do not fit', () => {
    wear();
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    const bench = fixture.nativeElement as HTMLElement;
    expect(bench.querySelector('.bench__region--materials')).toBeNull();

    fixture.componentInstance.showTab('materials');
    fixture.detectChanges();

    expect(bench.querySelector('.bench__region--materials')).not.toBeNull();
    expect(bench.querySelector('.bench__region--stats')).toBeNull();
  });

  it('replaces the compact ledger with the item it was asked to open, and goes back', () => {
    wear();
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    const page = fixture.componentInstance;

    page.open('suit');
    fixture.detectChanges();
    const bench = fixture.nativeElement as HTMLElement;
    expect(bench.querySelector('.bench__region--loadout')).toBeNull();
    expect(bench.querySelector('.bench__region--item')).not.toBeNull();

    page.closeItem();
    fixture.detectChanges();
    expect(bench.querySelector('.bench__region--loadout')).not.toBeNull();
  });

  it('draws every action on an empty bench, and refuses the two that need a loadout', () => {
    // Canvas 2a keeps `↶ UNDO REDO ↷ | OPEN BUILD IMPORT EXPORT SAVE ?` with
    // export and save dimmed. A control that vanishes takes with it the fact
    // that it exists (FR-022).
    const chrome = TestBed.inject(ScreenChrome);
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    expect(chrome.actions().map((action) => action.id)).toEqual([
      'equipment.undo',
      'equipment.redo',
      'equipment.export',
      'equipment.save',
    ]);
    expect(chrome.actions().every((action) => action.disabled === true)).toBe(true);
  });

  it('publishes its actions to the shell rather than drawing its own bar (FR-022)', () => {
    const chrome = TestBed.inject(ScreenChrome);
    wear();
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    // The history pair leads, ahead of the shell's own actions, which is where
    // both canvases draw them and where the ship tool already publishes its.
    expect(chrome.actions().map((action) => action.id)).toEqual([
      'equipment.undo',
      'equipment.redo',
      'equipment.export',
      'equipment.save',
    ]);
    // Starting a loadout is not an edit — there is nothing behind it to undo.
    // Exporting and saving are drawn and refused on an empty bench rather than
    // taken away, so this loadout can use both.
    expect(chrome.actions().map((action) => action.disabled)).toEqual([true, true, false, false]);

    fixture.destroy();
    expect(chrome.actions()).toEqual([]);
  });

  it('saves the open loadout into the one record library, and holds what it saved', async () => {
    // The loadout is what is stored — identities only — and the bench now
    // belongs to the save, so the layer can offer to replace it (FR-016).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();

    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });

    const listed = records.list();
    const saved = listed.ok ? listed.value.filter((entry) => entry.available) : [];
    expect(saved.length).toBe(1);
    const record = saved[0]?.available === true ? saved[0].record : null;
    expect(record?.name).toBe('Silent Entry');
    expect(record !== null && isEquipmentRecord(record) && record.loadout.suitFamily).toBe(
      'tacticalsuit',
    );
    expect(store.sourceNamed()?.recordId).toBe(record?.id);
  });

  it('opens a saved loadout back onto the bench, exactly as it was saved', async () => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    store.dispatch({ kind: 'setSuitGrade', grade: 3 });
    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });
    const recordId = store.sourceNamed()!.recordId;

    store.open(null);
    expect(store.hasLoadout()).toBe(false);

    expect(TestBed.inject(LoadoutOpenService).open(recordId).ok).toBe(true);
    expect(store.loadout()?.suitFamily).toBe('tacticalsuit');
    expect(store.loadout()?.suitGrade).toBe(3);
  });

  it('holds a saved loadout without autosaving into it (017/FR-007)', async () => {
    // A Commander who named a loadout said which version they want kept, so the
    // bench holds that record rather than writing to it, and holds it clean:
    // opening is not an edit, so there is nothing to write and the save stays
    // exactly where they put it. The first change forks a record of its own.
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });
    const recordId = store.sourceNamed()!.recordId;
    store.open(null);

    expect(TestBed.inject(LoadoutOpenService).open(recordId).ok).toBe(true);

    expect(store.autosaveRecordId()).toBeNull();
    expect(store.dirty()).toBe(false);
    // And nothing lands even when autosave is given its chance: a second record
    // here would be a copy of the Commander's save that they never asked for.
    TestBed.inject(LoadoutAutosaveService).flush();
    const listed = records.list();
    expect(listed.ok && listed.value.length).toBe(1);
    expect(storage.entries.has(recordKey(recordId))).toBe(true);
  });

  it('says why a loadout link was refused, in the library’s words (FR-021)', () => {
    const links = TestBed.inject(LoadoutLinkCoordinator);
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    const before = store.loadout();

    links.ingest('e.notaloadoutatall');
    fixture.detectChanges();

    const notice = (fixture.nativeElement as HTMLElement).querySelector('ednb-status-notice');
    expect(notice?.textContent).toContain('could not be read');
    // Never Frontier's journal key, and never the bench's own loadout.
    expect(notice?.textContent).not.toContain('PrimaryWeapon');
    expect(store.loadout()).toBe(before);
  });

  /**
   * A page that was autosaving a loadout before a reload: the record, and this
   * tab's claim on it.
   */
  const heldRecord = (suitFamily: string, id = 'working-loadout'): string => {
    // Written now, because an unnamed record is swept once its seven days have
    // run out and the library sweeps as the page is built.
    const now = new Date().toISOString();
    records.write({
      id,
      kind: 'working',
      revisionId: 'revision-1',
      createdAt: now,
      modifiedAt: now,
      name: null,
      note: null,
      sourceNamed: null,
      payload: { tool: 'equipment', loadout: newLoadout(suitFamily)! },
    });
    TestBed.inject(TabDescriptorRepository).write('equipment', id);
    return id;
  };

  /** The same, holding the named save the loadout was forked from. */
  const heldForkOf = (suitFamily: string, named: string): string => {
    const now = new Date().toISOString();
    const id = 'forked-loadout';
    records.write({
      id,
      kind: 'working',
      revisionId: 'revision-1',
      createdAt: now,
      modifiedAt: now,
      name: null,
      note: null,
      sourceNamed: { recordId: named, baseRevisionId: 'revision-0' },
      payload: { tool: 'equipment', loadout: newLoadout(suitFamily)! },
    });
    TestBed.inject(TabDescriptorRepository).write('equipment', id);
    return id;
  };

  /** An address carrying this fragment, as a Commander would have arrived on. */
  const arriveOn = (fragment: string): void => {
    history.replaceState(null, '', `${location.pathname}#${fragment}`);
  };

  it('restores the loadout it was autosaving before a reload (017/FR-007)', () => {
    const id = heldRecord('tacticalsuit');

    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    expect(store.loadout()?.suitFamily).toBe('tacticalsuit');
    // Taken over rather than copied, and nothing is owed on it: opening a
    // record does not restart the seven days it is counting down.
    expect(store.autosaveRecordId()).toBe(id);
    expect(store.dirty()).toBe(false);
    fixture.destroy();
  });

  it('restores the named save the loadout was forked from (017/FR-007)', () => {
    // A loadout forked from a save is still that save's, so the bench offers to
    // replace it after a reload as it did before one. The record carries where
    // the work came from; restoring the loadout without it would turn a replace
    // into a second save under the same name.
    const id = heldForkOf('tacticalsuit', 'their-save');

    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    expect(store.autosaveRecordId()).toBe(id);
    expect(store.sourceNamed()?.recordId).toBe('their-save');
    fixture.destroy();
  });

  it('stays empty when the page is built again after the bench was cleared (017/FR-006)', () => {
    const id = heldRecord('tacticalsuit');
    const first = TestBed.createComponent(EquipmentBenchPage);
    first.detectChanges();
    expect(store.loadout()?.suitFamily).toBe('tacticalsuit');

    TestBed.inject(EmptyBenchService).start();
    first.destroy();

    const second = TestBed.createComponent(EquipmentBenchPage);
    second.detectChanges();

    // A claim left behind would restore the loadout a Commander deliberately
    // cleared, which is the one thing emptying the bench has to be trusted not
    // to do. The record it named is still there, which is what makes the action
    // free to offer.
    expect(store.hasLoadout()).toBe(false);
    expect(
      TestBed.inject(TabDescriptorRepository).read()?.workingRecords.equipment,
    ).toBeUndefined();
    const kept = records.open(id);
    expect(kept.ok && kept.value !== null).toBe(true);
    second.destroy();
  });

  it('opens the loadout in the address over the one it restored (017/FR-009)', () => {
    heldRecord('tacticalsuit');
    arriveOn(encodeEquipmentLinkFragment(newLoadout('utilitysuit')!));

    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    expect(store.loadout()?.suitFamily).toBe('utilitysuit');
    // A link is nobody's record: the restored one is left where it is rather
    // than written over with what the address carried.
    expect(store.autosaveRecordId()).toBeNull();
    fixture.destroy();
  });

  it('keeps the restored loadout when the address carries a link it cannot read', () => {
    heldRecord('tacticalsuit');
    arriveOn('e.notaloadoutatall');

    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();

    expect(store.loadout()?.suitFamily).toBe('tacticalsuit');
    const notice = (fixture.nativeElement as HTMLElement).querySelector('ednb-status-notice');
    expect(notice?.textContent).toContain('could not be read');
    fixture.destroy();
  });

  it('writes the loadout on the way out, so leaving the bench costs no choice', () => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    choose();

    // Before the coalescing window closes: leaving is what makes the write due.
    fixture.destroy();

    const listed = records.list();
    const stored = listed.ok ? listed.value.filter((entry) => entry.available) : [];
    expect(stored.length).toBe(1);
    expect(stored[0]?.available === true && stored[0].record.kind).toBe('working');
  });

  it('pauses saving and keeps the loadout when another page deletes its record', () => {
    // Nobody at this page decided anything, so the bench is not cleared and
    // nothing is recreated behind the Commander's back (017/FR-008).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    choose();
    TestBed.inject(LoadoutAutosaveService).flush();
    const mine = store.autosaveRecordId()!;

    window.dispatchEvent(new StorageEvent('storage', { key: recordKey(mine), newValue: null }));
    fixture.detectChanges();

    expect(store.persistence()).toBe('record-deleted-externally');
    expect(store.hasLoadout()).toBe(true);
    fixture.destroy();
  });

  it('leaves no unnamed record behind the loadout it saved under a name', async () => {
    // The save consumes the record the changes were autosaved into: a Commander
    // who saved once has one loadout to find again, not a save and the working
    // copy it was made from (013/FR-016, 017/FR-007).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    choose();
    TestBed.inject(LoadoutAutosaveService).flush();
    expect(store.autosaveRecordId()).not.toBeNull();

    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });

    const listed = records.list();
    const saved = listed.ok ? listed.value.filter((entry) => entry.available) : [];
    expect(saved.length).toBe(1);
    expect(saved[0]?.available === true && saved[0].record.kind).toBe('named');
    fixture.destroy();
  });

  it('removes the record it was autosaved into when it replaces a saved loadout', async () => {
    // The other half of the same rule: written into the record it replaced, the
    // unnamed one it came from goes (013/FR-016, 017/FR-007).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });
    store.dispatch({ kind: 'setSuitGrade', grade: 3 });
    TestBed.inject(LoadoutAutosaveService).flush();
    const held = store.autosaveRecordId();
    expect(held).not.toBeNull();

    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: true,
    });

    const listed = records.list();
    const saved = listed.ok ? listed.value.filter((entry) => entry.available) : [];
    expect(saved.map((entry) => (entry.available === true ? entry.record.id : ''))).not.toContain(
      held,
    );
    expect(saved.length).toBe(1);
    fixture.destroy();
  });

  it('stops stating a record another page discarded once the loadout is saved', async () => {
    // Saving is the other way off the discarded record. The notice about it
    // would otherwise stand over a loadout that is in a record again, with
    // nothing left to resume (017/FR-008).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    TestBed.inject(LoadoutAutosaveService).flush();
    const mine = store.autosaveRecordId()!;
    window.dispatchEvent(new StorageEvent('storage', { key: recordKey(mine), newValue: null }));
    fixture.detectChanges();

    await fixture.componentInstance.requestSave({
      name: 'Silent Entry',
      note: null,
      overwrite: false,
    });

    expect(store.persistence()).toBe('saved');
    fixture.destroy();
  });

  it('draws what persistence is doing where the workspace draws it', () => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    store.setPersistence('quota-full');
    fixture.detectChanges();

    const status = (fixture.nativeElement as HTMLElement).querySelector('ednb-persistence-status');
    // The bench's own words, not the ship tool's: what a Commander is asked to
    // discard is a loadout (017/FR-008).
    expect(status?.textContent).toContain('discard a loadout');
    fixture.destroy();
  });

  it('resumes saving when the Commander asks it to', () => {
    // The component says which control was pressed; reaching the autosave is
    // the screen's own work, and a resume that reached nothing would leave a
    // Commander pressing a control that reads as broken (017/FR-008).
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    choose();
    const autosave = TestBed.inject(LoadoutAutosaveService);
    autosave.flush();
    const mine = store.autosaveRecordId()!;
    // Gone from the store as well as announced, so that the record standing
    // afterwards is one the resume wrote rather than the one it was told about.
    storage.entries.delete(recordKey(mine));
    window.dispatchEvent(new StorageEvent('storage', { key: recordKey(mine), newValue: null }));
    fixture.detectChanges();
    expect(autosave.paused()).toBe(true);
    expect(storage.entries.has(recordKey(mine))).toBe(false);

    fixture.componentInstance.actOnPersistence('resume');

    expect(autosave.paused()).toBe(false);
    // Asked of the stored bytes. `open` answers whether the store could be
    // reached, and says `ok` for a record that is not there at all.
    expect(storage.entries.has(recordKey(mine))).toBe(true);
    fixture.destroy();
  });

  it('writes again when the Commander asks to retry', () => {
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();
    choose();

    fixture.componentInstance.actOnPersistence('retry');

    expect(store.autosaveRecordId()).not.toBeNull();
    expect(storage.entries.has(recordKey(store.autosaveRecordId()!))).toBe(true);
    fixture.destroy();
  });

  it('raises the saved records layer when asked to choose what to discard', () => {
    // The action the full-store notice offers. Choosing what to discard is the
    // layer's own work, so the bench raises it rather than drawing a list of
    // its own — and a control that did nothing would read as a broken one.
    const fixture = TestBed.createComponent(EquipmentBenchPage);
    fixture.detectChanges();
    wear();

    fixture.componentInstance.actOnPersistence('manage');

    expect(TestBed.inject(LibraryPresence).open()).toBe(true);
    fixture.destroy();
  });

  it('synthesizes no heading of its own', () => {
    // Neither artboard draws one, and the shell draws none either.
    expect(render().querySelectorAll('h1').length).toBe(0);
  });
});
