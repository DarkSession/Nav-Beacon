import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
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
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { AutosaveService } from '../build-library/autosave.service';
import { NamedRecordService, type NamedSaveRequest } from '../build-library/named-record.service';
import { RetentionService } from '../build-library/retention.service';
import { LoadoutAutosaveService } from '../equipment/loadout-autosave.service';
import { LoadoutStore } from '../equipment/loadout.store';
import { RecordSynchronisationLoader } from './record-synchronisation.loader';
import {
  FakeCommanderApi,
  MovableClock,
  OTHER_CUSTOMER,
  SequentialUuid,
  SwitchableConnectivity,
  changesOfKind,
  settle,
  signIn,
  writeCommanderState,
} from './synchronisation.spec-helpers';

/** A lifecycle adapter a test can fire on demand. */
class FakeLifecycle {
  onFlush(): () => void {
    return () => {};
  }
}

/** Locks that serialize without the browser's own, which tests do not have. */
class FakeLocks {
  readonly available = true;

  async request<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class SilentChannel {
  readonly available = false;
  post(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

const SUIT: EquipmentLoadout = {
  suitFamily: 'tacticalsuit',
  suitGrade: 3,
  suitModifications: [null, null, null, null],
  weapons: [null, null, null],
};

/**
 * Both record libraries, joined to the account's synchronisation.
 *
 * Every test here reads what the service was sent. A named save, an autosave
 * and a delete are local acts first and offers second, and the offer only
 * exists for a signed-in Commander (020/FR-007, 020/FR-008, 020/FR-024).
 */
describe('joining the record libraries to synchronisation', () => {
  let storage: MemoryStorage;
  let api: FakeCommanderApi;
  let clock: MovableClock;

  beforeEach(() => {
    storage = new MemoryStorage();
    api = new FakeCommanderApi();
    clock = new MovableClock();

    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage, new MemoryStorage()),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: clock },
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

  function shipRequest(overrides: Partial<NamedSaveRequest> = {}): NamedSaveRequest {
    return {
      recordId: null,
      expectedRevisionId: null,
      name: 'Anaconda explorer',
      note: 'Kept in this browser',
      payload: {
        tool: 'ship',
        build: toBuildSnapshotV1(ShipLoadout.default('Anaconda')),
        validation: { valid: true, complete: true },
      },
      now: clock.timestamp(),
      ...overrides,
    };
  }

  function loadoutRequest(overrides: Partial<NamedSaveRequest> = {}): NamedSaveRequest {
    return {
      recordId: null,
      expectedRevisionId: null,
      name: 'Dominator on foot',
      note: null,
      payload: { tool: 'equipment', loadout: SUIT },
      now: clock.timestamp(),
      ...overrides,
    };
  }

  /** The revision this browser holds for one record. */
  function revisionOf(id: string): string | null {
    const stored = TestBed.inject(LocalRecordRepository).open(id);
    return stored.ok && stored.value !== null ? stored.value.record.revisionId : null;
  }

  /** The one record identity a save result carries. */
  function savedId(result: { kind: string; record?: { id: string } }): string {
    expect(result.kind).toBe('saved');
    return result.record!.id;
  }

  describe('named saves', () => {
    it('offers a signed-in Commander’s ship-build save to the account', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(shipRequest()));
      await settle();

      expect(changesOfKind(api, 'write')).toContain(id);
    });

    it('offers a signed-in Commander’s equipment-loadout save to the account', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(loadoutRequest()));
      await settle();

      expect(changesOfKind(api, 'write')).toContain(id);
    });

    it('sends nothing at all while the browser is anonymous', async () => {
      const named = TestBed.inject(NamedRecordService);
      await named.createNamed(shipRequest());
      await named.createNamed(loadoutRequest());
      await settle();

      expect(api.requests).toHaveLength(0);
    });

    it('offers a rename of a record already saved', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(shipRequest()));
      await settle();
      const before = changesOfKind(api, 'write').length;

      await named.overwriteNamed({
        ...shipRequest({ name: 'Anaconda miner' }),
        recordId: id,
        expectedRevisionId: revisionOf(id),
      });
      await settle();

      expect(changesOfKind(api, 'write').length).toBeGreaterThan(before);
    });
  });

  describe('autosaves', () => {
    it('offers the ship tool’s working record once it is written', async () => {
      writeCommanderState(storage);
      await signIn(api);

      TestBed.inject(ActiveBuildStore).commit({
        loadout: ShipLoadout.default('Anaconda'),
        hullName: 'Anaconda',
        provenance: 'stock',
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      });
      TestBed.inject(AutosaveService).flush();
      await settle();

      const held = TestBed.inject(ActiveBuildStore).autosaveRecordId();
      expect(held).not.toBeNull();
      expect(storage.entries.has(recordKey(held!))).toBe(true);
      expect(changesOfKind(api, 'write')).toContain(held);
    });

    it('offers the equipment tool’s working record once it is written', async () => {
      writeCommanderState(storage);
      await signIn(api);

      TestBed.inject(LoadoutStore).open(SUIT, null, { autosaveRecordId: null });
      TestBed.inject(LoadoutAutosaveService).flush();
      await settle();

      const held = TestBed.inject(LoadoutStore).autosaveRecordId();
      expect(held).not.toBeNull();
      expect(storage.entries.has(recordKey(held!))).toBe(true);
      expect(changesOfKind(api, 'write')).toContain(held);
    });

    it('sends no autosave at all while the browser is anonymous', async () => {
      TestBed.inject(ActiveBuildStore).commit({
        loadout: ShipLoadout.default('Anaconda'),
        hullName: 'Anaconda',
        provenance: 'stock',
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      });
      TestBed.inject(AutosaveService).flush();
      TestBed.inject(LoadoutStore).open(SUIT, null, { autosaveRecordId: null });
      TestBed.inject(LoadoutAutosaveService).flush();
      await settle();

      expect(api.requests).toHaveLength(0);
    });
  });

  describe('deletes', () => {
    it('offers the deletion of a ship-build record to the account', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(shipRequest()));
      await settle();

      await named.remove(id);
      await settle();

      expect(changesOfKind(api, 'delete')).toContain(id);
    });

    it('offers the deletion of an equipment-loadout record to the account', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(loadoutRequest()));
      await settle();

      await named.remove(id);
      await settle();

      expect(changesOfKind(api, 'delete')).toContain(id);
    });

    it('sends no deletion at all while the browser is anonymous', async () => {
      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(shipRequest()));
      await named.remove(id);
      await settle();

      expect(api.requests).toHaveLength(0);
    });
  });

  describe('a live page the account paused', () => {
    it('writes the work back the moment the Commander resumes', async () => {
      writeCommanderState(storage);
      await signIn(api);

      TestBed.inject(LoadoutStore).open(SUIT, null, { autosaveRecordId: null });
      const autosave = TestBed.inject(LoadoutAutosaveService);
      autosave.flush();
      await settle();
      const held = TestBed.inject(LoadoutStore).autosaveRecordId();
      expect(held).not.toBeNull();

      // This page holds the record open, and the account no longer holds it:
      // the work stays and nothing is written to it until the Commander
      // answers (020/FR-010).
      TestBed.inject(TabDescriptorRepository).write('equipment', held!);
      api.answers.push({
        kind: 'accepted',
        accountRevision: 9,
        results: [],
        records: [],
        unreadableRecords: [],
        tombstones: [{ id: held!, revision: 9 }],
      });
      await TestBed.inject(RecordSynchronisationLoader).recordSaved(held!);
      await settle();
      expect(autosave.paused()).toBe(true);

      // An explicit resume writes at once. What it answers is a Commander's
      // own request, so it cannot wait for an exchange, or for the engine
      // that runs one, to come back.
      const before = revisionOf(held!);
      autosave.resume();

      expect(autosave.paused()).toBe(false);
      expect(revisionOf(held!)).not.toBe(before);
    });
  });

  describe('records bound to another Customer ID', () => {
    it('never offers one, however often this browser saves it', async () => {
      writeCommanderState(storage);
      await signIn(api);

      const named = TestBed.inject(NamedRecordService);
      const id = savedId(await named.createNamed(shipRequest()));
      await settle();

      // The same record, now the other account's as far as this browser knows.
      writeCommanderState(storage, { recordBindings: { [id]: OTHER_CUSTOMER } });
      const sentBefore = changesOfKind(api, 'write').length;

      await named.overwriteNamed({
        ...shipRequest({ name: 'Anaconda miner' }),
        recordId: id,
        expectedRevisionId: revisionOf(id),
      });
      await settle();
      await named.remove(id);
      await settle();

      expect(changesOfKind(api, 'write').length).toBe(sentBefore);
      expect(changesOfKind(api, 'delete')).not.toContain(id);
    });
  });

  describe('the seven-day expiry', () => {
    it('removes this browser’s copy without asking the account to delete it', async () => {
      writeCommanderState(storage);
      await signIn(api);

      TestBed.inject(ActiveBuildStore).commit({
        loadout: ShipLoadout.default('Anaconda'),
        hullName: 'Anaconda',
        provenance: 'stock',
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      });
      TestBed.inject(AutosaveService).flush();
      await settle();
      const held = TestBed.inject(ActiveBuildStore).autosaveRecordId();
      expect(held).not.toBeNull();

      // The page has taken up other work, so nothing is holding the record
      // live any more and the sweep can reach it.
      TestBed.inject(ActiveBuildStore).setAutosaveRecordId(null);

      // A browser whose clock is a year ahead sweeps its own copy away and
      // still sends no deletion: the account's period runs on the service's
      // own clock (020/FR-025).
      clock.advanceDays(365);
      TestBed.inject(RetentionService).sweep();
      await settle();

      expect(storage.entries.has(recordKey(held!))).toBe(false);
      expect(changesOfKind(api, 'delete')).toHaveLength(0);
    });
  });
});
