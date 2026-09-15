import { TestBed } from '@angular/core/testing';
import { SUITS } from '@elite-dangerous-almanac/core/equipment/suits';
import { newLoadout } from '../../domain/equipment/loadout/loadout-edit';
import { NamedRecordService } from '../build-library/named-record.service';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { LoadoutStore } from './loadout.store';
import { loadoutFingerprint } from '../../domain/equipment/loadout/loadout-fingerprint';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';

const RIFLE = 'wpn_m_assaultrifle_plasma_fauto';

/** A loadout arriving from somewhere else, as `open` takes one. */
function worn(suitFamily: string): EquipmentLoadout {
  return {
    suitFamily,
    suitGrade: 1,
    suitModifications: [null, null, null, null],
    weapons: [null, null, null],
  } as EquipmentLoadout;
}

describe('LoadoutStore', () => {
  const store = (): LoadoutStore => TestBed.inject(LoadoutStore);

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('starts empty, pointing at the suit, with nothing to undo', () => {
    expect(store().loadout()).toBeNull();
    expect(store().hasLoadout()).toBe(false);
    // Canvas 2a marks the suit row while it is still a choice: it is the row
    // the gate beside it is asking about.
    expect(store().selected()).toBe('suit');
    expect(store().canUndo()).toBe(false);
    expect(store().mounts()).toEqual([]);
  });

  it('starts a loadout when a suit is chosen on an empty bench', () => {
    expect(store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' })).toBe(true);

    expect(store().loadout()?.suitFamily).toBe('tacticalsuit');
    expect(store().selected()).toBe('suit');
    // Starting the bench is not a choice there is anything behind to undo.
    expect(store().canUndo()).toBe(false);
  });

  it('takes no other choice on an empty bench', () => {
    expect(store().dispatch({ kind: 'setSuitGrade', grade: 3 })).toBe(false);
    expect(store().loadout()).toBeNull();
  });

  it('spends no revision and no history frame on a refused choice', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    const revision = store().revision();

    // A rifle does not go on the secondary mount.
    expect(store().dispatch({ kind: 'fitWeapon', mount: 'SecondaryWeapon', symbol: RIFLE })).toBe(
      false,
    );
    expect(store().revision()).toBe(revision);
    expect(store().canUndo()).toBe(false);
  });

  it('undoes and redoes every outfitting choice', () => {
    // Suit, grade, weapon, weapon grade, modification and clearing a slot are
    // all one kind of thing to the tape: a committed loadout (FR-022).
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().dispatch({ kind: 'setSuitGrade', grade: 5 });
    store().dispatch({ kind: 'fitWeapon', mount: 'PrimaryWeapon1', symbol: RIFLE });
    store().dispatch({ kind: 'setWeaponGrade', mount: 'PrimaryWeapon1', grade: 5 });
    store().dispatch({
      kind: 'fitModification',
      target: 'PrimaryWeapon1',
      slot: 0,
      symbol: 'weapon_clipsize',
    });
    const assembled = store().loadout();

    store().dispatch({ kind: 'clearSlot', target: 'PrimaryWeapon1', slot: 0 });
    expect(store().loadout()?.weapons[0]?.modifications[0]).toBeNull();

    expect(store().undo()).toBe(true);
    expect(store().loadout()).toEqual(assembled);
    expect(store().redo()).toBe(true);
    expect(store().loadout()?.weapons[0]?.modifications[0]).toBeNull();
  });

  it('reports when there is nothing left to undo or redo', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().dispatch({ kind: 'setSuitGrade', grade: 4 });

    expect(store().undo()).toBe(true);
    expect(store().undo()).toBe(false);
    expect(store().redo()).toBe(true);
    expect(store().redo()).toBe(false);
  });

  it('states what each catalogue mount is to the worn suit', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().dispatch({ kind: 'fitWeapon', mount: 'PrimaryWeapon2', symbol: RIFLE });
    store().dispatch({ kind: 'selectSuit', suitFamily: 'utilitysuit' });

    // The Maverick carries one primary mount, so the weapon on the second is
    // held: retained, named, and counted in nothing (FR-007).
    expect(store().mounts()).toEqual(['offered', 'held', 'offered']);
    expect(store().loadout()?.weapons[1]?.symbol).toBe(RIFLE);
  });

  it('opens a loadout from elsewhere without a tape behind it', () => {
    // Opening a saved loadout or a link is not an edit. Undoing onto the
    // loadout that was open before would restore something the Commander never
    // had on this bench.
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().dispatch({ kind: 'setSuitGrade', grade: 5 });
    expect(store().canUndo()).toBe(true);

    const opened: EquipmentLoadout = {
      suitFamily: 'utilitysuit',
      suitGrade: 2,
      suitModifications: [null, null, null, null],
      weapons: [null, null, null],
    };
    store().open(opened);

    expect(store().loadout()).toEqual(opened);
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
  });

  it('empties the bench when nothing is opened', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().open(null);

    expect(store().loadout()).toBeNull();
    expect(store().selected()).toBe('suit');
    expect(store().undo()).toBe(false);
  });

  it('keeps the selection out of the loadout', () => {
    // Which item the item view shows is workflow. It is never saved, encoded
    // into a link or exported.
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    const loadout = store().loadout();

    store().select('SecondaryWeapon');

    expect(store().selected()).toBe('SecondaryWeapon');
    expect(store().loadout()).toBe(loadout);
    expect(store().revision()).toBe(1);
  });
});

describe('what autosave reads from the bench', () => {
  const store = (): LoadoutStore => TestBed.inject(LoadoutStore);

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('has nothing to lose while the bench is empty', () => {
    expect(store().fingerprint()).toBeNull();
    expect(store().dirty()).toBe(false);
    expect(store().payload()).toBeNull();
    expect(store().autosaveRecordId()).toBeNull();
  });

  it('holds a loadout started here as unsaved work', () => {
    // Nothing has written it anywhere, so there is a version of it that would
    // be lost (017/FR-007).
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    expect(store().dirty()).toBe(true);
    expect(store().fingerprint()).toBe(loadoutFingerprint(store().loadout()!));
    expect(store().payload()).toEqual({ tool: 'equipment', loadout: store().loadout() });
  });

  it('reports a loadout it starts at its suit’s default, for every published suit', () => {
    // What keeps the answer tied to what the bench actually starts. A store
    // that started something else, or a comparison built against some other
    // loadout, would have every new loadout take a record again and nothing
    // would say so (024/FR-002).
    for (const suit of SUITS) {
      store().open(null);
      expect(store().dispatch({ kind: 'selectSuit', suitFamily: suit.family })).toBe(true);
      expect(store().atDefault()).toBe(true);
    }
  });

  it('reports the first choice on a started loadout as away from the default', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    store().dispatch({ kind: 'setSuitGrade', grade: 5 });

    expect(store().atDefault()).toBe(false);
  });

  it('saves a loadout holding no record as one named record', async () => {
    // A loadout still at its suit's default takes no working record, so there
    // is nothing for the manual save to promote. It mints a named record
    // instead, and the saved list holds the one record a Commander asked for
    // (024/FR-002).
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...provideMemoryStorage(new MemoryStorage())] });
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    expect(store().atDefault()).toBe(true);
    expect(store().autosaveRecordId()).toBeNull();

    const result = await TestBed.inject(NamedRecordService).createNamed({
      name: 'Ground team',
      note: null,
      payload: store().payload()!,
      now: '2026-01-02T03:04:05.000Z',
    });

    expect(result.kind).toBe('saved');
    if (result.kind !== 'saved') {
      return;
    }
    const listed = TestBed.inject(LocalRecordRepository).list();
    expect(
      listed.ok &&
        listed.value.map((entry) => (entry.available ? entry.record.kind : 'unreadable')),
    ).toEqual(['named']);

    // And the bench takes the save it was given, still holding no working
    // record: nothing was consumed to make the named one.
    store().markSaved({ recordId: result.record.id, baseRevisionId: result.record.revisionId });
    expect(store().dirty()).toBe(false);
    expect(store().autosaveRecordId()).toBeNull();
  });

  it('takes a loadout restored from the address, holding no record', () => {
    // A loadout at its suit's default takes no record, so a record is not what
    // brings it back after a reload. The address is, and the bench opens what
    // it hands over holding nothing — as it does any loadout arriving in no
    // record (024/FR-002, 024/FR-003).
    store().open(newLoadout('tacticalsuit'), null, { autosaveRecordId: null });

    expect(store().hasLoadout()).toBe(true);
    expect(store().atDefault()).toBe(true);
    expect(store().autosaveRecordId()).toBeNull();
    expect(store().sourceNamed()).toBeNull();
    // Nothing written anywhere yet, which is what sends autosave to take a
    // record at the first choice.
    expect(store().dirty()).toBe(true);
  });

  it('opens on the empty bench where the address carries nothing', () => {
    store().open(null);

    expect(store().hasLoadout()).toBe(false);
    expect(store().selected()).toBe('suit');
    expect(store().autosaveRecordId()).toBeNull();
    expect(store().payload()).toBeNull();
  });

  it('is at no default while the bench is empty', () => {
    expect(store().atDefault()).toBe(false);
  });

  it('holds a loadout opened from its own record as written already', () => {
    const opened: EquipmentLoadout = {
      suitFamily: 'utilitysuit',
      suitGrade: 2,
      suitModifications: [null, null, null, null],
      weapons: [null, null, null],
    };

    store().open(opened, null, {
      autosaveRecordId: 'working-1',
      baseline: loadoutFingerprint(opened),
    });

    expect(store().dirty()).toBe(false);
    expect(store().autosaveRecordId()).toBe('working-1');
  });

  it('has work to write again after one choice on an opened loadout', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().markSaved(null);
    expect(store().dirty()).toBe(false);

    store().dispatch({ kind: 'setSuitGrade', grade: 5 });

    expect(store().dirty()).toBe(true);
  });

  it('leaves the fingerprint where it is when only the selection moves', () => {
    // Which item the item view shows is workflow, and autosave writes nothing
    // for it.
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().markSaved(null);

    store().select('SecondaryWeapon');

    expect(store().dirty()).toBe(false);
  });

  it('starts a loadout begun on an empty bench in no record and from no save', () => {
    store().open(
      {
        suitFamily: 'utilitysuit',
        suitGrade: 2,
        suitModifications: [null, null, null, null],
        weapons: [null, null, null],
      },
      { recordId: 'record-1', baseRevisionId: 'revision-1' },
      { autosaveRecordId: 'working-1', baseline: 'whatever' },
    );

    store().open(null);
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    expect(store().sourceNamed()).toBeNull();
    expect(store().autosaveRecordId()).toBeNull();
    expect(store().dirty()).toBe(true);
  });

  it('takes the record it writes to and the save it came from as it is told', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    store().setAutosaveRecordId('working-2');
    store().markSaved({ recordId: 'record-9', baseRevisionId: 'revision-3' });

    expect(store().autosaveRecordId()).toBe('working-2');
    expect(store().sourceNamed()).toEqual({
      recordId: 'record-9',
      baseRevisionId: 'revision-3',
    });
    expect(store().dirty()).toBe(false);
  });

  it('says what persistence is doing, so the bench can state it', () => {
    store().setPersistence('quota-full');

    expect(store().persistence()).toBe('quota-full');
  });

  it('does not state a discarded record over the loadout that opens next', () => {
    // The notice was about the record another page discarded. A Commander who
    // answers it by opening another loadout has left that record behind, and
    // the notice would otherwise stand with nothing left to resume
    // (017/FR-008).
    const bench = store();
    bench.open(worn('tacticalsuit'), null, { autosaveRecordId: 'working-1' });
    bench.setPersistence('record-deleted-externally');

    bench.open(worn('flightsuit'), null, { autosaveRecordId: 'working-2' });

    expect(bench.persistence()).toBe('ready');
  });

  it('clears the bench when the record it writes to is deleted here', () => {
    // A Commander who deletes the record this bench autosaves into decided that
    // on this page. Writing it back on the next change would undo what they
    // confirmed (017/FR-008).
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().setAutosaveRecordId('working-2');

    expect(store().clearIfHolding('working-2')).toBe(true);
    expect(store().hasLoadout()).toBe(false);
    expect(store().autosaveRecordId()).toBeNull();
  });

  it('leaves the bench alone when the record deleted is somebody else’s', () => {
    store().dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });
    store().setAutosaveRecordId('working-2');

    expect(store().clearIfHolding('someone-elses')).toBe(false);
    expect(store().hasLoadout()).toBe(true);
  });
});
