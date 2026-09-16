import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  BroadcastChannelAdapter,
  type PersistenceBroadcast,
} from '../../platform/browser/broadcast-channel.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { recordKey } from '../../platform/storage/storage-keys';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { newLoadout } from '../../domain/equipment/loadout/loadout-edit';
import { baselineFingerprint } from '../../domain/ships/build/build-fingerprint';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { LoadoutStore } from '../equipment/loadout.store';
import { adoptSavedRecord } from './adopt-saved-record';
import { AutosaveService } from './autosave.service';
import { RecordInvalidationService } from './record-invalidation.service';
import { TabOwnershipCoordinator } from './tab-ownership.coordinator';
import type { WorkingRecordSubject } from './working-record.port';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/** A channel two coordinators in one test can talk over. */
class FakeChannel {
  readonly sent: PersistenceBroadcast[] = [];
  readonly #listeners: ((message: PersistenceBroadcast) => void)[] = [];

  readonly available = true;

  post(message: PersistenceBroadcast): void {
    this.sent.push(message);
  }

  subscribe(listener: (message: PersistenceBroadcast) => void): () => void {
    this.#listeners.push(listener);
    return () => {};
  }

  /** Delivers a message as though another page had sent it. */
  deliver(message: PersistenceBroadcast): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}

/** Predictable identities, so a test can say which one it means. */
class CountingUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `id-${this.#next}`;
  }
}

function setup(
  session = new MemoryStorage(),
  channel = new FakeChannel(),
  storage = new MemoryStorage(),
  uuid = new CountingUuid(),
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ...provideMemoryStorage(storage, session),
      { provide: BroadcastChannelAdapter, useValue: channel },
      { provide: UuidAdapter, useValue: uuid },
    ],
  });
  return {
    coordinator: TestBed.inject(TabOwnershipCoordinator),
    active: TestBed.inject(ActiveBuildStore),
    autosave: TestBed.inject(AutosaveService),
    channel,
    session,
    storage,
  };
}

/** Puts a build in the store, held in the record the caller names. */
function hold(active: ActiveBuildStore, autosaveRecordId: string | null): void {
  active.commit({
    loadout: ShipLoadout.default('Anaconda'),
    suppliedFit: suppliedFit(ShipLoadout.default('Anaconda').shipSymbol),
    hullName: 'Anaconda',
    provenance: 'stock',
    sourceNamed: null,
    autosaveRecordId,
    baseline: null,
  });
}

/**
 * Puts a build in the store as opening a named record leaves it.
 *
 * In the record, unedited, and holding no autosave target: a named record is
 * never one, so the page writes nothing to it and forks at the first modelled
 * edit (001/FR-008). Written the way `RecordOpenService` writes it, because
 * what the claim reads is that state rather than the route to it.
 */
function openNamed(active: ActiveBuildStore, recordId: string): void {
  const loadout = ShipLoadout.default('Anaconda');
  active.commit({
    loadout,
    suppliedFit: suppliedFit(loadout.shipSymbol),
    hullName: 'Anaconda',
    provenance: 'named',
    sourceNamed: { recordId, baseRevisionId: 'revision-1' },
    autosaveRecordId: null,
    baseline: baselineFingerprint(toBuildSnapshotV1(loadout)),
  });
}

/**
 * Makes one modelled decision on the build a page holds.
 *
 * The priority tells two pages' builds apart, so a record taken for one is
 * never a match for the other's.
 */
function decide(active: ActiveBuildStore, priority: number): void {
  active.loadout()!.setModulePriority('FrameShiftDrive', priority);
  active.touch();
}

/** A second tool tracking here, as the port describes one. */
function otherTool(recordId: string | null): WorkingRecordSubject {
  const held = signal<string | null>(recordId);
  return {
    tool: 'equipment',
    revision: signal(0),
    fingerprint: signal<string | null>('a-loadout'),
    dirty: signal(true),
    atDefault: signal(false),
    autosaveRecordId: held.asReadonly(),
    sourceNamed: signal(null),
    payload: () => null,
    setAutosaveRecordId: (id) => held.set(id),
    markSaved: () => {},
    setPersistence: () => {},
  };
}

describe('TabOwnershipCoordinator', () => {
  it('mints no page identity until one is needed', () => {
    // The shell reaches this coordinator to offer the bar's re-entry action,
    // and the prerender pass builds that shell in a runtime with no
    // cryptographic random source at all. Constructing it there has to cost
    // nothing, or every prerendered address fails to render.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...provideMemoryStorage(new MemoryStorage(), new MemoryStorage()),
        { provide: BroadcastChannelAdapter, useValue: new FakeChannel() },
        {
          provide: UuidAdapter,
          useValue: {
            create: () => {
              throw new Error('no cryptographic random source');
            },
          },
        },
      ],
    });

    const coordinator = TestBed.inject(TabOwnershipCoordinator);

    // Reading what this tab was working from asks for no identity of its own.
    expect(coordinator.claim('equipment')).toBeNull();
  });

  it('claims nothing for a tab that has never held a record', () => {
    // A fresh tab has no build and nothing to restore. That is the ordinary
    // state of one, not a failure, and it mints no record for a build that does
    // not exist yet (FR-008).
    expect(setup().coordinator.claim('ship')).toBeNull();
  });

  it('restores the record the same tab was working from after a reload', () => {
    const session = new MemoryStorage();
    const first = setup(session);
    hold(first.active, 'id-held');
    const stop = first.coordinator.track(first.active);
    TestBed.tick();
    stop();

    expect(setup(session).coordinator.claim('ship')).toBe('id-held');
  });

  it('lets go of one tool’s claim without touching the other tool’s', () => {
    // Starting an empty bench is where a tool stops writing to a record and
    // takes up no other. A claim left behind would restore the loadout a
    // Commander deliberately cleared, and a page holds a build and a loadout at
    // once, so only the one tool lets go (017/FR-006, FR-010).
    const session = new MemoryStorage();
    const { coordinator, active } = setup(session);
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();
    TestBed.inject(TabDescriptorRepository).write('equipment', 'a-loadout');

    coordinator.release('ship');

    expect(coordinator.claim('ship')).toBeNull();
    expect(coordinator.claim('equipment')).toBe('a-loadout');

    // And the tool is not finished: the next record it takes up is claimed the
    // way any other is.
    hold(active, 'id-next');
    TestBed.tick();

    expect(coordinator.claim('ship')).toBe('id-next');
    stop();
  });

  it('writes down a fork made for a tool whose screen is not drawn', () => {
    // Both tools are registered for the whole page, so either can be forked
    // from any screen — and a tool whose screen is not drawn has no watcher
    // running to write the new id down. A reload would then restore from the
    // record the other page is writing to (017/FR-010).
    const session = new MemoryStorage();
    const { coordinator, active, channel } = setup(session);
    hold(active, 'id-held');
    coordinator.listen();

    const next = coordinator.fork('ship');

    expect(coordinator.claim('ship')).toBe(next);
    expect(channel.sent.at(-1)).toEqual({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: next,
      pageNonce: coordinator.pageNonce,
    });
  });

  it('gives two ordinary tabs distinct records', () => {
    const first = setup();
    hold(first.active, 'first-record');
    const second = setup(new MemoryStorage());

    // Distinct sessions, so distinct autosave targets: neither can overwrite
    // the other's build.
    expect(second.coordinator.claim('ship')).toBeNull();
  });

  it('announces the record the store holds, so a duplicated tab can be detected', () => {
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');

    const stop = coordinator.track(active);
    TestBed.tick();

    expect(channel.sent).toEqual([
      {
        kind: 'working-claim',
        tool: 'ship',
        workingRecordId: 'id-held',
        pageNonce: coordinator.pageNonce,
      },
    ]);
    stop();
  });

  it('announces one record once, however often the store is read', () => {
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();

    active.touch();
    TestBed.tick();

    expect(channel.sent).toHaveLength(1);
    stop();
  });

  it('announces nothing while the page holds only a named record', () => {
    // Two pages may hold one named save open, because neither autosaves into
    // it. That is not a collision and must not be announced as one (FR-012).
    const { coordinator, active, channel } = setup();
    hold(active, null);

    const stop = coordinator.track(active);
    TestBed.tick();

    expect(channel.sent).toEqual([]);
    stop();
  });

  it('claims nothing for a tool holding no record, and leaves the other tool’s claim alone', () => {
    // A build still at the package default takes no record, so this tool holds
    // none. There is nothing to write down and nothing to announce — and the
    // loadout open beside it is unaffected, because one tool holding nothing
    // says nothing about the other (024/FR-001, 024/FR-002).
    const { coordinator, active, channel } = setup();
    hold(active, null);
    coordinator.track(active);
    coordinator.track(otherTool('the-loadout'));
    TestBed.tick();

    expect(coordinator.claim('ship')).toBeNull();
    expect(coordinator.claim('equipment')).toBe('the-loadout');
    expect(channel.sent).toEqual([
      {
        kind: 'working-claim',
        tool: 'equipment',
        workingRecordId: 'the-loadout',
        pageNonce: coordinator.pageNonce,
      },
    ]);
  });

  it('keeps the claim on the record a save produced, which holds the work now', () => {
    // A save clears the autosave target on purpose: autosave has no path to a
    // named record. The work is not in no record, though — it is in the one the
    // save produced, and that is the record a reload restores from and holds.
    // Released here, a reload would restore nothing, the fragment would open the
    // build as an arrival instead, and autosave would mint a second record for
    // work the Commander has just saved by name (001/FR-008, 017/FR-007).
    const { coordinator, active, channel } = setup();
    hold(active, 'the-build');
    coordinator.track(active);
    TestBed.tick();
    channel.sent.length = 0;

    adoptSavedRecord(active, TestBed.inject(RecordInvalidationService), {
      recordId: 'the-build',
      revisionId: 'revision-2',
      held: 'the-build',
    });
    TestBed.tick();

    expect(active.autosaveRecordId()).toBeNull();
    expect(coordinator.claim('ship')).toBe('the-build');
    expect(channel.sent).not.toContainEqual({
      kind: 'working-release',
      tool: 'ship',
      pageNonce: coordinator.pageNonce,
    });
  });

  it('claims the record a save produced when it is not the one autosave held', () => {
    // A save without Web Locks mints a fresh record and consumes the held one,
    // and an overwrite writes an existing named record and consumes it the same
    // way. Left on the id autosave had, the claim would name a record the save
    // has just deleted, and a reload would restore nothing (017/FR-010).
    const { coordinator, active } = setup();
    hold(active, 'the-working-record');
    coordinator.track(active);
    TestBed.tick();

    adoptSavedRecord(active, TestBed.inject(RecordInvalidationService), {
      recordId: 'the-named-record',
      revisionId: 'revision-2',
      held: 'the-working-record',
    });
    TestBed.tick();

    expect(coordinator.claim('ship')).toBe('the-named-record');
  });

  it('lets go of the claim a save wrote once the work moves off that record', () => {
    // The first edit after a save is work the saved record does not hold, and
    // the fork that follows puts it in an unnamed record of its own. A claim
    // left on the save would have a reload restore the saved version and lose
    // every edit made since (017/FR-010).
    const { coordinator, active } = setup();
    hold(active, 'the-working-record');
    coordinator.track(active);
    TestBed.tick();
    adoptSavedRecord(active, TestBed.inject(RecordInvalidationService), {
      recordId: 'the-named-record',
      revisionId: 'revision-2',
      held: 'the-working-record',
    });
    TestBed.tick();
    expect(coordinator.claim('ship')).toBe('the-named-record');

    decide(active, 3);
    TestBed.tick();

    expect(coordinator.claim('ship')).toBeNull();

    active.setAutosaveRecordId('the-forked-record');
    TestBed.tick();

    expect(coordinator.claim('ship')).toBe('the-forked-record');
  });

  it('lets go of the claim a save wrote once a default build takes its place', () => {
    // The build a Commander creates from the hull catalogue after saving is at
    // its hull's default, so it takes no record and none is minted to correct
    // the claim (024/FR-001). Left standing, the record the save produced is
    // what a reload opens — a build the Commander has already moved on from.
    const { coordinator, active } = setup();
    hold(active, 'the-working-record');
    coordinator.track(active);
    TestBed.tick();
    adoptSavedRecord(active, TestBed.inject(RecordInvalidationService), {
      recordId: 'the-named-record',
      revisionId: 'revision-2',
      held: 'the-working-record',
    });
    TestBed.tick();
    expect(coordinator.claim('ship')).toBe('the-named-record');

    hold(active, null);
    TestBed.tick();

    expect(coordinator.claim('ship')).toBeNull();
  });

  it('keeps the claim on a named record the page opened', () => {
    // Work opened from the saved list is in that record as surely as work a
    // save put there, and holds no autosave target either way. Released, a
    // reload would restore nothing, and the build would come back from the
    // fragment as a fresh arrival for autosave to mint a record for — a second
    // copy of a record the Commander already has (001/FR-008, 024/FR-001).
    const { coordinator, active, channel } = setup();
    hold(active, 'the-working-record');
    coordinator.track(active);
    TestBed.tick();
    channel.sent.length = 0;

    openNamed(active, 'the-opened-record');
    TestBed.tick();

    expect(coordinator.claim('ship')).toBe('the-opened-record');
    expect(channel.sent, 'a named record is not announced: neither page autosaves into it').toEqual(
      [],
    );
  });

  it('lets go of the record a tool held once it takes up work that is in none', () => {
    // A Commander autosaving into a record creates a build from the hull
    // catalogue. The new build is at its hull's default and takes no record, so
    // the claim on the old one is no longer this page's to hold: left behind,
    // a reload would restore the record the Commander stepped off and a
    // duplicated tab would fork it (024/FR-001, FR-012).
    const { coordinator, active, channel } = setup();
    hold(active, 'the-build');
    coordinator.track(active);
    TestBed.tick();
    channel.sent.length = 0;

    hold(active, null);
    TestBed.tick();

    expect(coordinator.claim('ship')).toBeNull();
    // And said out loud, so a sibling page stops protecting a record nobody is
    // writing to any more.
    expect(channel.sent).toEqual([
      { kind: 'working-release', tool: 'ship', pageNonce: coordinator.pageNonce },
    ]);
  });

  it('leaves the claim a reload is about to read where it is', () => {
    // The store is empty while the shell registers this tool, which is every
    // page's first moment. Reading that as a tool letting go would have the
    // page erase its own way back to the record it was working from (FR-012).
    const session = new MemoryStorage();
    const first = setup(session);
    hold(first.active, 'id-held');
    const stop = first.coordinator.track(first.active);
    TestBed.tick();
    stop();

    const second = setup(session);
    second.coordinator.track(second.active);
    TestBed.tick();

    expect(second.coordinator.claim('ship')).toBe('id-held');
  });

  it('forks nothing for a tool holding no record when the tab is duplicated', () => {
    // The duplicate carries a copy of the session, so it claims the same
    // loadout and that tool forks. The build is in no record in either page:
    // there is no identity to collide on and nothing to copy anywhere
    // (024/FR-001, 017/FR-010).
    const { coordinator, active, channel } = setup();
    hold(active, null);
    const loadout = otherTool('the-loadout');
    coordinator.track(active);
    coordinator.track(loadout);
    coordinator.listen();
    TestBed.tick();
    channel.sent.length = 0;

    channel.deliver({
      kind: 'working-claim',
      tool: 'equipment',
      workingRecordId: 'the-loadout',
      pageNonce: 'duplicate',
    });

    expect(loadout.autosaveRecordId()).not.toBe('the-loadout');
    expect(active.autosaveRecordId()).toBeNull();
    expect(coordinator.claim('ship')).toBeNull();
    // And nothing was said about the build, because there is nothing to say.
    expect(
      channel.sent.filter((message) => message.kind === 'working-claim' && message.tool === 'ship'),
    ).toEqual([]);
  });

  it('gives two pages holding the same default build a record each at their first edit', () => {
    // The collision this coordinator exists for never arises while both pages
    // are at the default: neither claims anything, so neither forks. Each takes
    // a record of its own at its own first edit, and the two stand side by side
    // (024/FR-001).
    const storage = new MemoryStorage();
    const uuid = new CountingUuid();
    const channel = new FakeChannel();

    const first = setup(new MemoryStorage(), channel, storage, uuid);
    hold(first.active, null);
    first.coordinator.track(first.active);
    first.coordinator.listen();
    first.autosave.flush();
    TestBed.tick();
    expect(first.active.autosaveRecordId()).toBeNull();
    expect(channel.sent).toEqual([]);

    decide(first.active, 2);
    first.autosave.flush();
    TestBed.tick();
    const firstRecord = first.active.autosaveRecordId();
    expect(firstRecord).not.toBeNull();

    const second = setup(new MemoryStorage(), channel, storage, uuid);
    hold(second.active, null);
    second.coordinator.track(second.active);
    second.coordinator.listen();
    second.autosave.flush();
    TestBed.tick();
    expect(second.active.autosaveRecordId()).toBeNull();

    decide(second.active, 3);
    second.autosave.flush();
    TestBed.tick();
    const secondRecord = second.active.autosaveRecordId();

    expect(secondRecord).not.toBe(firstRecord);
    expect(storage.entries.has(recordKey(firstRecord!))).toBe(true);
    expect(storage.entries.has(recordKey(secondRecord!))).toBe(true);
  });

  it('forks when another live page claims the record it writes to', () => {
    // And the work follows the identity. A fork that moved the claim and left
    // the fresh record empty would leave this page writing to nothing and a
    // reload with nothing to restore (001/FR-012).
    const { coordinator, active, channel, storage } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      workingRecordId: 'id-held',
      pageNonce: 'another-page',
    });

    const forked = active.autosaveRecordId();
    expect(forked).not.toBe('id-held');
    expect(storage.entries.has(recordKey(forked!))).toBe(true);
  });

  it('ignores its own claim echoing back', () => {
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      workingRecordId: 'id-held',
      pageNonce: coordinator.pageNonce,
    });

    expect(active.autosaveRecordId()).toBe('id-held');
  });

  it('ignores another page claiming a record it does not write to', () => {
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      workingRecordId: 'someone-elses-record',
      pageNonce: 'another-page',
    });

    expect(active.autosaveRecordId()).toBe('id-held');
  });

  it('knows the record it is holding is live, so the sweep leaves it alone', () => {
    const { coordinator, active } = setup();
    hold(active, 'id-held');
    coordinator.track(active);

    expect(coordinator.heldLive('id-held')).toBe(true);
    expect(coordinator.heldLive('someone-elses-record')).toBe(false);
  });

  it('knows a record another live page announced', () => {
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      workingRecordId: 'their-record',
      pageNonce: 'another-page',
    });

    expect(coordinator.heldLive('their-record')).toBe(true);
  });

  it('names the other tool’s record to a page it forks for', () => {
    // The collision moves one tool. The other tool's record is still this
    // page's, and a page heard from for the first time knows nothing about it —
    // so its sweep would remove a record this page is autosaving into
    // (001/FR-013, 017/FR-010).
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    const loadout = TestBed.inject(LoadoutStore);
    loadout.open(newLoadout('tacticalsuit'), null, { autosaveRecordId: 'a-loadout' });
    coordinator.track(loadout);
    coordinator.listen();
    TestBed.tick();

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'id-held',
      pageNonce: 'newcomer',
    });

    const claimed = channel.sent
      .filter((message) => message.kind === 'working-claim')
      .map((message) => message.workingRecordId);
    expect(claimed).toContain('a-loadout');
    // And the fork's own claim is sent once: the fork announced it, so the
    // sweep of the other tools leaves it out.
    expect(claimed.filter((id) => id === active.autosaveRecordId()).length).toBe(1);
  });

  it('forgets a record another page said it had let go of', () => {
    // A claim it never hears the end of would keep a record nobody is writing
    // to alive for as long as that page runs (001/FR-013).
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();
    channel.deliver({
      kind: 'working-claim',
      tool: 'equipment',
      workingRecordId: 'their-loadout',
      pageNonce: 'another-page',
    });
    expect(coordinator.heldLive('their-loadout')).toBe(true);

    channel.deliver({ kind: 'working-release', tool: 'equipment', pageNonce: 'another-page' });

    expect(coordinator.heldLive('their-loadout')).toBe(false);
  });

  it('says out loud that it has let a record go', () => {
    const session = new MemoryStorage();
    const { coordinator, active, channel } = setup(session);
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();

    coordinator.release('ship');

    expect(channel.sent.at(-1)).toEqual({
      kind: 'working-release',
      tool: 'ship',
      pageNonce: coordinator.pageNonce,
    });
    stop();
  });

  it('forgets a record another page has stepped off', () => {
    // Held by page, not as a growing set of ids: a page that forks stops
    // protecting the record it left behind, which is free to expire.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'first',
      pageNonce: 'them',
    });
    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'second',
      pageNonce: 'them',
    });

    expect(coordinator.heldLive('first')).toBe(false);
    expect(coordinator.heldLive('second')).toBe(true);
  });

  it('answers a page it has not heard from before, so its own record is known', () => {
    // Claims are made once, when a page takes a record. Without this answer a
    // page that started first would be invisible to one that started later, and
    // the later page's sweep would expire a record still being written.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();
    coordinator.listen();
    channel.sent.length = 0;

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'theirs',
      pageNonce: 'newcomer',
    });
    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'theirs',
      pageNonce: 'newcomer',
    });

    // Once per newly seen page, and never in answer to itself.
    expect(channel.sent).toEqual([
      {
        kind: 'working-claim',
        tool: 'ship',
        workingRecordId: 'id-held',
        pageNonce: coordinator.pageNonce,
      },
    ]);
    stop();
  });

  it('answers a collision by forking rather than by re-announcing', () => {
    // Answering first would tell the duplicate to fork as well, and both pages
    // would step off the record, leaving it held by nobody.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();
    coordinator.listen();
    channel.sent.length = 0;

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'id-held',
      pageNonce: 'duplicate',
    });
    TestBed.tick();

    expect(active.autosaveRecordId()).not.toBe('id-held');
    expect(channel.sent).toEqual([
      {
        kind: 'working-claim',
        tool: 'ship',
        workingRecordId: active.autosaveRecordId(),
        pageNonce: coordinator.pageNonce,
      },
    ]);
    stop();
  });

  it('claims, announces and forks one record per tool', () => {
    // A page holds a build and a loadout at once. A duplicated tab colliding on
    // one of them moves that one and leaves the other exactly where it is
    // (017/FR-010).
    const { coordinator, active, channel, session } = setup();
    hold(active, 'the-build');
    const loadout = otherTool('the-loadout');
    coordinator.track(active);
    coordinator.track(loadout);
    TestBed.tick();
    coordinator.listen();

    expect(JSON.parse(session.entries.get('ednb:tab')!).workingRecords).toEqual({
      ship: 'the-build',
      equipment: 'the-loadout',
    });
    expect(channel.sent.map((message) => message)).toEqual([
      {
        kind: 'working-claim',
        tool: 'ship',
        workingRecordId: 'the-build',
        pageNonce: coordinator.pageNonce,
      },
      {
        kind: 'working-claim',
        tool: 'equipment',
        workingRecordId: 'the-loadout',
        pageNonce: coordinator.pageNonce,
      },
    ]);

    channel.deliver({
      kind: 'working-claim',
      tool: 'equipment',
      workingRecordId: 'the-loadout',
      pageNonce: 'duplicate',
    });

    expect(loadout.autosaveRecordId()).not.toBe('the-loadout');
    expect(active.autosaveRecordId()).toBe('the-build');
  });

  it('protects both of this page’s records from the sweep', () => {
    const { coordinator, active } = setup();
    hold(active, 'the-build');
    coordinator.track(active);
    coordinator.track(otherTool('the-loadout'));

    expect(coordinator.heldLive('the-build')).toBe(true);
    expect(coordinator.heldLive('the-loadout')).toBe(true);
  });

  it('protects both records another live page announced', () => {
    // Held by page and tool: a page announcing its loadout must not take the
    // protection off the build it announced a moment earlier.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'their-build',
      pageNonce: 'them',
    });
    channel.deliver({
      kind: 'working-claim',
      tool: 'equipment',
      workingRecordId: 'their-loadout',
      pageNonce: 'them',
    });

    expect(coordinator.heldLive('their-build')).toBe(true);
    expect(coordinator.heldLive('their-loadout')).toBe(true);
  });

  it('reads a claim that names no tool as the ship tool’s', () => {
    // What a page running a version that held one record per tab announces. It
    // meant the build, and a claim read as being about nothing would leave two
    // pages autosaving into one record.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    coordinator.listen();

    channel.deliver({
      kind: 'working-claim',
      workingRecordId: 'id-held',
      pageNonce: 'older-page',
    });

    expect(active.autosaveRecordId()).not.toBe('id-held');
  });

  it('opens one subscription however many screens listen', () => {
    // Two screens listening would answer one claim twice: two forks for one
    // collision, and the second onto a record nothing announced.
    const { coordinator, active, channel } = setup();
    hold(active, 'id-held');
    coordinator.track(active);
    TestBed.tick();
    const stopFirst = coordinator.listen();
    const stopSecond = coordinator.listen();
    channel.sent.length = 0;

    channel.deliver({
      kind: 'working-claim',
      tool: 'ship',
      workingRecordId: 'theirs',
      pageNonce: 'newcomer',
    });

    expect(channel.sent).toHaveLength(1);
    stopFirst();
    stopSecond();
  });

  it('leaves the collided record alone rather than deleting it', () => {
    const { coordinator, active, session } = setup();
    hold(active, 'id-held');
    const stop = coordinator.track(active);
    TestBed.tick();

    coordinator.fork('ship');
    TestBed.tick();

    // The session now points at the new record; nothing removed the old one,
    // which belongs to the other page.
    expect(JSON.parse(session.entries.get('ednb:tab')!)).toMatchObject({
      workingRecords: { ship: active.autosaveRecordId() },
    });
    expect(active.autosaveRecordId()).not.toBe('id-held');
    stop();
  });
});
