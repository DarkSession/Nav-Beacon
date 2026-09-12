import { TestBed } from '@angular/core/testing';
import { parseCommanderLocalState } from '../../domain/commander/commander-local-state';
import { LocaleStore } from '../../i18n/locale.store';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { EDNB_COMMANDER_STATE_KEY } from '../../platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { AccountStore } from '../account/account.store';
import {
  ANTI_FORGERY,
  CUSTOMER,
  FLEET_ACCOUNT,
  FakeFleetApi,
  answeredFleet,
  coverage,
  ownedShipPayload,
} from './fleet.spec-helpers';
import { FleetStore } from './fleet.store';

/** A clock that does not move, so an accepted instant is a value a test can name. */
class FixedClock {
  instant = new Date('2026-09-11T10:00:00.000Z');

  now(): Date {
    return this.instant;
  }

  timestamp(): string {
    return this.instant.toISOString();
  }
}

/** Lets every exchange already in flight finish before the next assertion. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    TestBed.tick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('FleetStore', () => {
  let api: FakeFleetApi;
  let storage: MemoryStorage;
  let clock: FixedClock;
  let store: FleetStore;

  /** The Commander state this browser is already holding, cache included. */
  function writeState(state: Record<string, unknown> = {}): void {
    storage.entries.set(
      EDNB_COMMANDER_STATE_KEY,
      JSON.stringify({
        format: 'ednb.commander-state',
        version: 2,
        account: FLEET_ACCOUNT,
        fleetCache: [],
        accountCursors: { [CUSTOMER]: 4 },
        pendingOperations: [],
        recordBindings: {},
        recordRevisions: {},
        ...state,
      }),
    );
  }

  /** The fleet this browser accepted on an earlier visit. */
  function writeCachedFleet(ships: readonly Record<string, unknown>[], result = 'current'): void {
    writeState({
      fleetCache: [
        {
          customerId: CUSTOMER,
          acceptedAt: '2026-09-10T08:00:00.000Z',
          result,
          ships,
          coverage: coverage(),
        },
      ],
    });
  }

  async function signIn(): Promise<void> {
    api.session = {
      kind: 'signed-in',
      account: FLEET_ACCOUNT,
      antiForgeryToken: ANTI_FORGERY,
    };
    await TestBed.inject(AccountStore).refreshSession();
    await settle();
  }

  /** The stored Commander state, read back through its own reader. */
  function storedState() {
    return parseCommanderLocalState(
      JSON.parse(storage.entries.get(EDNB_COMMANDER_STATE_KEY) ?? '{}'),
    );
  }

  beforeEach(() => {
    api = new FakeFleetApi();
    storage = new MemoryStorage();
    clock = new FixedClock();

    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: clock },
      ],
    });
    store = TestBed.inject(FleetStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('holds nothing at all while nobody is signed in', async () => {
    await store.load();

    expect(store.signedIn()).toBe(false);
    expect(store.holding()).toBeNull();
    expect(api.readCalls).toBe(0);
  });

  it('reads the account fleet and rebuilds every ship through the package', async () => {
    writeState();
    api.reads.push(
      answeredFleet({ ships: [ownedShipPayload(12), ownedShipPayload(4, 'SideWinder')] }),
    );
    await signIn();

    const holding = store.holding();
    expect(holding?.result).toBe('current');
    // Ascending by Frontier's own identity, whatever order the answer arrived in.
    expect(holding?.ships.map((ship) => ship.shipId)).toEqual([4, 12]);
    expect(holding?.ships[0].loadout.shipSymbol).toBe('SideWinder');
    expect(holding?.fromCache).toBe(false);
    expect(store.exchange()).toEqual({ kind: 'confirmed', at: clock.timestamp() });
  });

  it('writes the accepted fleet to this browser, under the account it belongs to', async () => {
    writeState();
    api.reads.push(
      answeredFleet({ result: 'incomplete', ships: [ownedShipPayload(12)], pending: true }),
    );
    await signIn();

    const cached = storedState()?.fleetCache ?? [];
    expect(cached.length).toBe(1);
    expect(cached[0].customerId).toBe(CUSTOMER);
    expect(cached[0].result).toBe('incomplete');
    expect(cached[0].acceptedAt).toBe(clock.timestamp());
  });

  describe('with no network at all', () => {
    it('reads the last accepted fleet out of this browser', async () => {
      writeCachedFleet([ownedShipPayload(12), ownedShipPayload(4, 'SideWinder')]);
      api.offline = true;
      await signIn();

      const holding = store.holding();
      expect(holding?.ships.map((ship) => ship.shipId)).toEqual([4, 12]);
      expect(holding?.acceptedAt).toBe('2026-09-10T08:00:00.000Z');
      expect(holding?.fromCache).toBe(true);
    });

    it('cannot claim that a network refresh completed', async () => {
      writeCachedFleet([ownedShipPayload(12)]);
      api.offline = true;
      await signIn();

      await store.refresh();

      // The one thing an offline page may not say. The fleet is still there,
      // and nothing about it has been confirmed (020/FR-018, 020/FR-022).
      expect(store.exchange()).toEqual({ kind: 'unavailable' });
      expect(store.confirmedAt()).toBeNull();
      expect(store.holding()?.fromCache).toBe(true);
      expect(store.holding()?.ships.length).toBe(1);
    });

    it('leaves the stored fleet exactly as it was', async () => {
      writeCachedFleet([ownedShipPayload(12)]);
      api.offline = true;
      await signIn();
      await store.refresh();

      const cached = storedState()?.fleetCache ?? [];
      expect(cached[0].acceptedAt).toBe('2026-09-10T08:00:00.000Z');
      expect(cached[0].ships.length).toBe(1);
    });
  });

  /**
   * The harder half of the same requirement: a browser that has no network
   * from its first turn. The session read is the first thing a cold start
   * makes, and it does not arrive either, so the account stays cached and
   * there are no credentials to read a fleet with. The ships this browser
   * already accepted must still be readable — there is no later moment to
   * read them in, because nothing asks again until a session appears
   * (020/FR-022, constitution I).
   */
  describe('starting with no network at all', () => {
    async function startOffline(): Promise<void> {
      api.offline = true;
      api.session = { kind: 'unavailable' };
      await TestBed.inject(AccountStore).refreshSession();
      await settle();
    }

    it('reads the last accepted fleet out of this browser', async () => {
      writeCachedFleet([ownedShipPayload(12), ownedShipPayload(4, 'SideWinder')]);

      await startOffline();

      expect(store.signedIn()).toBe(false);
      expect(store.accountKnown()).toBe(true);
      const holding = store.holding();
      expect(holding?.ships.map((ship) => ship.shipId)).toEqual([4, 12]);
      expect(holding?.acceptedAt).toBe('2026-09-10T08:00:00.000Z');
      expect(holding?.fromCache).toBe(true);
      // Nothing was asked of a service this browser cannot reach.
      expect(api.readCalls).toBe(0);
      expect(store.confirmedAt()).toBeNull();
    });

    it('states the missing network rather than a session that ended', async () => {
      writeCachedFleet([ownedShipPayload(12)]);
      await startOffline();

      await store.refresh();

      // The session was never refused; it was never read. Saying it ended
      // would send a Commander to a sign-in that needs the same network
      // (020/FR-004, 020/FR-022).
      expect(store.exchange()).toEqual({ kind: 'unavailable' });
      expect(store.holding()?.fromCache).toBe(true);
      expect(store.holding()?.ships.length).toBe(1);
    });

    it('holds nothing for a browser that has no account cached', async () => {
      await startOffline();

      expect(store.accountKnown()).toBe(false);
      expect(store.holding()).toBeNull();
    });
  });

  describe('what a refresh answered', () => {
    beforeEach(() => {
      writeCachedFleet([ownedShipPayload(12)]);
    });

    it('confirms a settled fleet and replaces what this browser held', async () => {
      await signIn();
      api.refreshes.push(answeredFleet({ ships: [ownedShipPayload(12), ownedShipPayload(13)] }));

      await store.refresh();

      expect(store.exchange()).toEqual({ kind: 'confirmed', at: clock.timestamp() });
      expect(store.confirmedAt()).toBe(clock.timestamp());
      expect(store.holding()?.ships.length).toBe(2);
      expect(store.holding()?.fromCache).toBe(false);
    });

    it('asks for the package diagnostic in the language the Commander is reading', async () => {
      await signIn();
      api.refreshes.push(answeredFleet());

      await store.refresh();

      expect(api.refreshLocales).toEqual([TestBed.inject(LocaleStore).effectiveLocale()]);
    });

    it('states that Frontier holds the next attempt, and keeps the fleet', async () => {
      await signIn();
      api.refreshes.push(
        answeredFleet({
          result: 'waiting',
          coverage: {
            startDate: '2026-08-18',
            cursorDate: '2026-09-02',
            cursorLine: 7,
            storedShips: null,
            nextPermittedRefreshAt: '2026-09-11T11:00:00.000Z',
          },
        }),
      );

      await store.refresh();

      expect(store.exchange()).toEqual({
        kind: 'waiting',
        until: '2026-09-11T11:00:00.000Z',
      });
      expect(store.holding()?.ships.length).toBe(1);
      expect(store.confirmedAt()).toBeNull();
    });

    it('carries the package refusal verbatim and keeps the fleet', async () => {
      await signIn();
      api.refreshes.push(
        answeredFleet({
          result: 'failed',
          failure: 'package-refused',
          packageRefusal: {
            code: 'invalidLoadout',
            constraint: 'stringRequired',
            path: 'entries[0].Ship',
            message: null,
          },
        }),
      );

      await store.refresh();

      expect(store.exchange()).toEqual({
        kind: 'failed',
        failure: 'package-refused',
        refusal: {
          code: 'invalidLoadout',
          constraint: 'stringRequired',
          path: 'entries[0].Ship',
          message: null,
        },
      });
      expect(store.holding()?.ships.length).toBe(1);
    });

    it('asks the account for a fresh sign-in when Frontier authorisation is gone', async () => {
      await signIn();
      api.refreshes.push(answeredFleet({ result: 'authorisation-expired' }));

      await store.refresh();

      expect(store.exchange()).toEqual({ kind: 'authorisation-expired' });
      expect(TestBed.inject(AccountStore).state().kind).toBe('authorisation-expired');
      // The ships already accepted are still this Commander's ships. An expired
      // authorisation is a reason to sign in again, not a reason to empty the
      // fleet (020/FR-018).
      expect(store.holding()?.ships.length).toBe(1);
      expect(storedState()?.fleetCache.length).toBe(1);
    });

    it('reads a refused session as one, rather than as a failure of the fleet', async () => {
      await signIn();
      api.refreshes.push({ kind: 'refused', status: 401, code: 'unauthorised' });

      await store.refresh();

      expect(store.exchange()).toEqual({ kind: 'session-expired' });
      expect(store.holding()?.ships.length).toBe(1);
    });

    /**
     * Two of the three codes this route publishes are not Frontier's doing at
     * all: one says this application could not read the fleet, the other that
     * it would not take the request as it stands. Reading either as "Frontier
     * did not answer" sends a Commander to check a service that is working
     * (020/FR-018, constitution IV).
     */
    it.each([['fleet-unavailable', 500] as const, ['invalid-anti-forgery', 400] as const])(
      'states a %s refusal as this application’s, not Frontier’s',
      async (code, status) => {
        await signIn();
        api.refreshes.push({ kind: 'refused', status, code });

        await store.refresh();

        expect(store.exchange()).toEqual({ kind: 'refused', code });
        expect(store.holding()?.ships.length).toBe(1);
      },
    );

    it('asks the account to read the session the service refused', async () => {
      await signIn();
      api.refreshes.push({ kind: 'refused', status: 401, code: 'unauthorised' });
      // What the refusal says: the session has ended, which the account learns
      // by reading it again.
      api.session = { kind: 'anonymous' };

      await store.refresh();
      await settle();

      // Account state and the fleet cache both go, and the planning records
      // stay (020/FR-003).
      expect(TestBed.inject(AccountStore).state()).toEqual({ kind: 'session-expired' });
      expect(store.holding()).toBeNull();
      expect(storedState()?.fleetCache).toEqual([]);
    });

    it('reads a refused session once while the service goes on refusing', async () => {
      await signIn();
      const before = api.sessionReads;
      api.refreshes.push({ kind: 'refused', status: 401, code: 'unauthorised' });
      api.refreshes.push({ kind: 'refused', status: 401, code: 'unauthorised' });

      await store.refresh();
      await settle();
      await store.refresh();
      await settle();

      // A service that refuses every request while still answering the session
      // read publishes fresh credentials on each read, and the watch that
      // follows them asks for the fleet again.
      expect(api.sessionReads - before).toBe(1);
    });

    it('refuses to refresh at all while nobody is signed in', async () => {
      await store.refresh();

      expect(api.refreshCalls).toBe(0);
      expect(store.exchange()).toEqual({ kind: 'session-expired' });
    });
  });

  it('lists a ship the installed package will not rebuild, without replacing it', async () => {
    writeState();
    api.reads.push(
      answeredFleet({
        ships: [
          ownedShipPayload(12),
          ownedShipPayload(13),
          // A hull this installation does not carry. The package refuses it,
          // and nothing is put in its place.
          {
            shipId: 14,
            sourceDate: '2026-09-01',
            sourceLine: 2,
            model: {
              hullSymbol: 'NotAHull',
              shipName: null,
              shipIdent: null,
              modules: [],
            },
          },
        ],
      }),
    );
    await signIn();

    const holding = store.holding();
    expect(holding?.ships.map((ship) => ship.shipId)).toEqual([12, 13]);
    expect(holding?.refused.map((refusal) => refusal.shipId)).toEqual([14]);
    // The failure the package answered, under its own name. There is no reason
    // beside it: no package words reached this refusal, and this application
    // does not write one in their place.
    expect(holding?.refused[0].failure).toBe('unknown-hull');
    expect(holding?.refused[0].reason).toBeNull();
  });

  /**
   * A sign-out and an account deletion both clear this browser's fleet cache in
   * their own local write, and a request opened before it answers after it. The
   * answer is dropped: writing it would put the account's ships back into a
   * browser that has just taken them out, and show them to whoever is at the
   * screen (020/FR-003, 020/FR-006).
   */
  it('writes nothing a fleet answer carries once the account has left the browser', async () => {
    writeState();
    await signIn();
    let release = (): void => {};
    api.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.refreshes.push(answeredFleet({ ships: [ownedShipPayload(12)] }));

    const running = store.refresh();
    await TestBed.inject(AccountStore).signOut();
    release();
    await running;
    await settle();

    expect(store.holding()).toBeNull();
    expect(storedState()?.fleetCache).toEqual([]);
    expect(store.exchange()).toEqual({ kind: 'idle' });
  });

  it('writes nothing a fleet answer carries once the account has been deleted', async () => {
    writeState();
    await signIn();
    let release = (): void => {};
    api.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.refreshes.push(answeredFleet({ ships: [ownedShipPayload(12)] }));

    let releaseDeletion = (): void => {};
    api.holdDeletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });

    const running = store.refresh();
    // The local half of the deletion commits here and the request is still
    // open, which is the window the answer below arrives in.
    const deleting = TestBed.inject(AccountStore).deleteAccount();
    release();
    await running;
    releaseDeletion();
    await deleting;
    await settle();

    expect(store.holding()).toBeNull();
    expect(storedState()?.fleetCache).toEqual([]);
  });

  it('forgets the fleet when the account goes', async () => {
    writeCachedFleet([ownedShipPayload(12)]);
    api.offline = true;
    await signIn();
    expect(store.holding()).not.toBeNull();

    api.session = { kind: 'anonymous' };
    await TestBed.inject(AccountStore).refreshSession();
    await settle();

    expect(store.holding()).toBeNull();
    expect(store.exchange()).toEqual({ kind: 'idle' });
  });
});
