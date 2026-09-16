import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { LoadoutStore } from '../equipment/loadout.store';
import { newLoadout } from '../../domain/equipment/loadout/loadout-edit';
import { adoptSavedRecord } from './adopt-saved-record';
import { RecordInvalidationService } from './record-invalidation.service';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

function setup(): { invalidation: RecordInvalidationService; deleted: string[] } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ...provideMemoryStorage(new MemoryStorage()),
      { provide: BroadcastChannelAdapter, useValue: new SilentChannel() },
    ],
  });
  const invalidation = TestBed.inject(RecordInvalidationService);
  const deleted: string[] = [];
  const announceDelete = invalidation.announceDelete.bind(invalidation);
  invalidation.announceDelete = (recordId: string) => {
    deleted.push(recordId);
    announceDelete(recordId);
  };
  return { invalidation, deleted };
}

/** The ship's store, holding a build in the record a test names. */
function shipHolding(autosaveRecordId: string | null): ActiveBuildStore {
  const active = TestBed.inject(ActiveBuildStore);
  active.commit({
    loadout: ShipLoadout.default('Anaconda'),
    suppliedFit: suppliedFit(ShipLoadout.default('Anaconda').shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId,
    baseline: null,
  });
  return active;
}

/** The bench's store, holding a loadout in the record a test names. */
function benchHolding(autosaveRecordId: string | null): LoadoutStore {
  const store = TestBed.inject(LoadoutStore);
  store.open(newLoadout('tacticalsuit'), null, { autosaveRecordId });
  return store;
}

describe('adoptSavedRecord', () => {
  it('lets go of the record autosave was writing to', () => {
    // Autosave has no path to a named record, so a page that kept the id would
    // go idle against a record it may not touch (001/FR-008, 017/FR-007).
    for (const subject of [shipSubject(), benchSubject()]) {
      const { invalidation } = subject.context;

      adoptSavedRecord(subject.store, invalidation, {
        recordId: 'named-1',
        revisionId: 'r1',
        held: 'working-1',
      });

      expect(subject.store.autosaveRecordId(), subject.store.tool).toBeNull();
      expect(subject.store.sourceNamed()?.recordId, subject.store.tool).toBe('named-1');
    }
  });

  it('says the work is in a record again', () => {
    // Saving is one of the two ways off a record another page discarded. The
    // notice about that record would otherwise stand over work that is stored,
    // with nothing left to resume (001/FR-012, 017/FR-008).
    for (const subject of [shipSubject(), benchSubject()]) {
      subject.store.setPersistence('record-deleted-externally');

      adoptSavedRecord(subject.store, subject.context.invalidation, {
        recordId: 'named-1',
        revisionId: 'r1',
        held: 'working-1',
      });

      expect(subject.store.persistence(), subject.store.tool).toBe('saved');
    }
  });

  it('says the record the save consumed is gone', () => {
    for (const subject of [shipSubject(), benchSubject()]) {
      adoptSavedRecord(subject.store, subject.context.invalidation, {
        recordId: 'named-1',
        revisionId: 'r1',
        held: 'working-1',
      });

      expect(subject.context.deleted, subject.store.tool).toEqual(['working-1']);
    }
  });

  it('says nothing is gone where the save was written into the record it held', () => {
    // Naming an unnamed record keeps the same local identity. Announcing it as
    // deleted would take a record that is still there out of every open list.
    for (const subject of [shipSubject(), benchSubject()]) {
      adoptSavedRecord(subject.store, subject.context.invalidation, {
        recordId: 'working-1',
        revisionId: 'r1',
        held: 'working-1',
      });

      expect(subject.context.deleted, subject.store.tool).toEqual([]);
    }
  });

  it('says nothing is gone where the work was in no record at all', () => {
    for (const subject of [shipSubject(), benchSubject()]) {
      adoptSavedRecord(subject.store, subject.context.invalidation, {
        recordId: 'named-1',
        revisionId: 'r1',
        held: null,
      });

      expect(subject.context.deleted, subject.store.tool).toEqual([]);
    }
  });
});

/** One rule, both tools: each case is asserted of the ship and of the bench. */
function shipSubject(): {
  store: ActiveBuildStore | LoadoutStore;
  context: ReturnType<typeof setup>;
} {
  const context = setup();
  return { store: shipHolding('working-1'), context };
}

function benchSubject(): {
  store: ActiveBuildStore | LoadoutStore;
  context: ReturnType<typeof setup>;
} {
  const context = setup();
  return { store: benchHolding('working-1'), context };
}
