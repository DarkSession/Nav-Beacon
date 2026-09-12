import { TestBed } from '@angular/core/testing';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { BUNDLED_ENGLISH, interpolate } from '../../i18n/locale-registry';
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
  modelOf,
  ownedShipPayload,
} from './fleet.spec-helpers';
import { FleetPresenter } from './fleet.presenter';
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

/**
 * One payload the package rebuilds and then refuses in its own words.
 *
 * The laser belongs in no utility mount, and the package leaves it where the
 * journal put it with a diagnostic against it, so the refusal carries package
 * text rather than a finding of this application's.
 */
function misfittedPayload(shipId: number): Record<string, unknown> {
  const anaconda = ShipLoadout.default('Anaconda');
  const model = modelOf(anaconda);

  return {
    shipId,
    sourceDate: '2026-09-01',
    sourceLine: shipId,
    model: {
      ...model,
      modules: [
        ...model.modules,
        {
          slot: anaconda.slots('utility')[0]!.key,
          symbol: 'Hpt_PulseLaser_Fixed_Large',
          enabled: null,
          priority: null,
          preEngineered: null,
          engineering: null,
        },
      ],
    },
  };
}

/** Lets every exchange already in flight finish before the next assertion. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    TestBed.tick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('FleetPresenter', () => {
  let api: FakeFleetApi;
  let storage: MemoryStorage;
  let presenter: FleetPresenter;
  let store: FleetStore;

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

  async function signIn(): Promise<void> {
    api.session = { kind: 'signed-in', account: FLEET_ACCOUNT, antiForgeryToken: ANTI_FORGERY };
    await TestBed.inject(AccountStore).refreshSession();
    await settle();
  }

  beforeEach(() => {
    api = new FakeFleetApi();
    storage = new MemoryStorage();

    TestBed.configureTestingModule({
      providers: [
        provideMemoryStorage(storage),
        { provide: COMMANDER_API, useValue: api },
        { provide: ClockAdapter, useValue: new FixedClock() },
      ],
    });
    store = TestBed.inject(FleetStore);
    presenter = TestBed.inject(FleetPresenter);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('asks for a sign-in, and for nothing else, while there is no account', () => {
    const view = presenter.view();

    expect(view.state).toBe('sign-in-required');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.sign-in-required']);
    expect(view.signIn).toBe(BUNDLED_ENGLISH['account.sign-in']);
    expect(view.refresh).toBeNull();
    expect(view.ships).toEqual([]);
  });

  it('says the fleet is current, and names the journal it was read from', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)], coverage: coverage() as never }));
    await signIn();

    const view = presenter.view();
    expect(view.state).toBe('current');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.current']);
    expect(view.coverage).not.toBeNull();
    expect(view.ships.map((ship) => ship.id)).toEqual(['12']);
    expect(view.emptyLabel).toBeNull();
  });

  it('says a fleet read out of this browser is the last one accepted, not a current one', async () => {
    writeState({
      fleetCache: [
        {
          customerId: CUSTOMER,
          acceptedAt: '2026-09-10T08:00:00.000Z',
          result: 'current',
          ships: [ownedShipPayload(12)],
          coverage: coverage(),
        },
      ],
    });
    api.offline = true;
    await signIn();

    const view = presenter.view();
    expect(view.state).toBe('current');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.cached']);
    expect(view.ships.length).toBe(1);
  });

  it('states incomplete coverage as incomplete, and says more journal is left', async () => {
    writeState();
    api.reads.push(
      answeredFleet({
        result: 'incomplete',
        ships: [ownedShipPayload(12)],
        coverage: coverage() as never,
        pending: true,
      }),
    );
    await signIn();

    const view = presenter.view();
    expect(view.state).toBe('incomplete');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.incomplete']);
    expect(view.detail).toBe(BUNDLED_ENGLISH['fleet.detail.pending']);
  });

  it('states an empty fleet in words rather than as an empty list', async () => {
    writeState();
    api.reads.push(answeredFleet({ result: 'empty' }));
    await signIn();

    const view = presenter.view();
    expect(view.state).toBe('empty');
    expect(view.emptyLabel).toBe(BUNDLED_ENGLISH['fleet.list.empty']);
  });

  it('names when Frontier permits the next attempt, where the answer named one', async () => {
    writeState();
    api.reads.push(answeredFleet({ result: 'empty' }));
    await signIn();
    api.refreshes.push(
      answeredFleet({
        result: 'waiting',
        coverage: coverage({ nextPermittedRefreshAt: '2026-09-11T12:00:00.000Z' }) as never,
      }),
    );
    await presenter.refresh();

    const view = presenter.view();
    expect(view.state).toBe('waiting');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.waiting']);
    expect(view.detail).toContain('2026');
  });

  it('says a failed refresh left the ships already accepted where they were', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();
    api.refreshes.push(answeredFleet({ result: 'failed', failure: 'frontier-unavailable' }));
    await presenter.refresh();

    const view = presenter.view();
    expect(view.state).toBe('failed');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.failed.frontier']);
    expect(view.detail).toBe(BUNDLED_ENGLISH['fleet.detail.last-accepted']);
    expect(view.ships.length).toBe(1);
  });

  it('says a refresh that never reached the service is not a confirmed fleet', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();
    api.offline = true;

    await presenter.refresh();

    // The ships stay listed, and the refresh that never arrived is stated
    // rather than read as a completed one (020/FR-018, 020/FR-022).
    const view = presenter.view();
    expect(view.state).toBe('current');
    expect(view.status.tone).toBe('warning');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.unavailable']);
    expect(view.detail).toBe(BUNDLED_ENGLISH['fleet.detail.last-accepted']);
    expect(view.ships.length).toBe(1);
  });

  it('names this application, not Frontier, when this application refused', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();
    api.refreshes.push({ kind: 'refused', status: 500, code: 'fleet-unavailable' });

    await presenter.refresh();

    // The ships stay listed, and the sentence says what actually happened:
    // Frontier was never the party that stopped this (020/FR-018).
    const view = presenter.view();
    expect(view.state).toBe('current');
    expect(view.status.tone).toBe('warning');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.refused']);
    expect(view.status.message).not.toBe(BUNDLED_ENGLISH['fleet.status.failed.frontier']);
    expect(view.ships.length).toBe(1);
  });

  it('says a refresh the service refused is not a confirmed fleet', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();
    api.refreshes.push({ kind: 'refused', status: 401, code: 'unauthorised' });
    // The session read that answers the refusal cannot be made either, so the
    // account keeps what it holds and this test reads the fleet alone.
    api.session = { kind: 'unavailable' };

    await presenter.refresh();

    const view = presenter.view();
    expect(view.status.tone).toBe('warning');
    expect(view.status.message).toBe(BUNDLED_ENGLISH['fleet.status.session-expired']);
    expect(view.detail).toBe(BUNDLED_ENGLISH['fleet.detail.last-accepted']);
    expect(view.ships.length).toBe(1);
  });

  it('says the Frontier authorisation expired, and offers the sign-in that resumes it', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();
    api.refreshes.push(answeredFleet({ result: 'authorisation-expired' }));
    await presenter.refresh();

    expect(presenter.view().state).toBe('authorisation-expired');
    expect(presenter.view().status.message).toBe(
      BUNDLED_ENGLISH['fleet.status.authorisation-expired'],
    );
  });

  describe('what the installed game data refused', () => {
    const REFUSAL = {
      code: 'slot-unknown',
      constraint: 'slots',
      path: 'Modules[4].Slot',
    };

    async function refuseWith(message: string | null): Promise<void> {
      writeState();
      api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
      await signIn();
      api.refreshes.push(
        answeredFleet({
          result: 'failed',
          failure: 'package-refused',
          packageRefusal: { ...REFUSAL, message },
        }),
      );
      await presenter.refresh();
    }

    it('reads the package message where the package published one', async () => {
      await refuseWith('Slot Slot04_Size7 is not part of the Anaconda.');
      const refusal = presenter.view().refusal;

      expect(refusal?.message).toBe('Slot Slot04_Size7 is not part of the Anaconda.');
      expect(refusal?.absentMessage).toBeNull();
    });

    it('states the absence in its own words where the package published none', async () => {
      // The pinned package publishes a diagnostic message for English locales
      // only and documents `null` for every other one. Where none arrives, this
      // application says so rather than translating a message it never received
      // or writing one from the code (constitution II, 020/FR-016).
      await refuseWith(null);
      const refusal = presenter.view().refusal;

      expect(refusal?.message).toBeNull();
      expect(refusal?.absentMessage).toBe(BUNDLED_ENGLISH['fleet.refusal.no-message']);
    });

    it('shows the package structured answer unchanged, either way', async () => {
      for (const message of ['Slot Slot04_Size7 is not part of the Anaconda.', null]) {
        TestBed.resetTestingModule();
        api = new FakeFleetApi();
        storage = new MemoryStorage();
        TestBed.configureTestingModule({
          providers: [
            provideMemoryStorage(storage),
            { provide: COMMANDER_API, useValue: api },
            { provide: ClockAdapter, useValue: new FixedClock() },
          ],
        });
        store = TestBed.inject(FleetStore);
        presenter = TestBed.inject(FleetPresenter);
        await refuseWith(message);

        expect(presenter.view().refusal?.facts.map((fact) => fact.value)).toEqual([
          REFUSAL.code,
          REFUSAL.constraint,
          REFUSAL.path,
        ]);
      }
    });
  });

  it('lists a ship the installed package will not rebuild rather than dropping it', async () => {
    writeState();
    api.reads.push(
      answeredFleet({
        ships: [ownedShipPayload(12), { shipId: 19, sourceDate: '2026-09-01', sourceLine: 2 }],
      }),
    );
    await signIn();

    const view = presenter.view();
    expect(view.ships.length).toBe(1);
    expect(view.unresolved.length).toBe(1);
    expect(view.unresolved[0].id).toBe('refused-19');
  });

  /**
   * Two ships with no name and one hull, read from one journal day. The label
   * falls back to the hull for both, so the plate is the only thing between
   * them, and a Commander choosing one has to be able to tell which.
   */
  it('carries the plate on a row, and nothing in its place where there is none', async () => {
    writeState();
    api.reads.push(
      answeredFleet({
        ships: [
          ownedShipPayload(21, 'Anaconda', { shipName: null, shipIdent: 'BA-01' }),
          ownedShipPayload(22, 'Anaconda', { shipName: null, shipIdent: null }),
        ],
      }),
    );
    await signIn();

    const rows = presenter.view().ships;
    expect(rows[0].label).toBe(rows[1].label);
    expect(rows[0].detail).toContain('BA-01');
    expect(rows[0].detail).not.toBe(rows[1].detail);
    // Nothing stands in for a plate the journal did not state.
    expect(rows[1].detail).toBe(
      interpolate(BUNDLED_ENGLISH['fleet.row.detail'], {
        hull: rows[1].detail.split(',')[0],
        when: rows[1].detail.split('of ')[1],
      }),
    );
  });

  it('states a ship the package would not rebuild through the catalogue', async () => {
    writeState();
    api.reads.push(
      answeredFleet({ ships: [{ shipId: 19, sourceDate: '2026-09-01', sourceLine: 2 }] }),
    );
    await signIn();

    const view = presenter.view();
    expect(store.holding()?.refused[0].reason).toBeNull();
    expect(view.unresolved[0].message).toBe(BUNDLED_ENGLISH['fleet.unresolved.malformed']);
    // The whole sentence is one catalogue entry, so nothing written outside the
    // localisation layer is spliced into it (020/FR-016).
    expect(Object.values(BUNDLED_ENGLISH)).toContain(view.unresolved[0].message);
  });

  it('shows the package words where the package published them', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [misfittedPayload(19)] }));
    await signIn();

    const stated = store.holding()?.refused[0].reason ?? '';
    expect(stated.length).toBeGreaterThan(0);
    expect(presenter.view().unresolved[0].message).toBe(
      interpolate(BUNDLED_ENGLISH['fleet.unresolved.stated'], { reason: stated }),
    );
  });

  describe('the ship a Commander chose', () => {
    async function withFleet(): Promise<void> {
      writeState();
      api.reads.push(answeredFleet({ ships: [ownedShipPayload(12), ownedShipPayload(4)] }));
      await signIn();
    }

    it('offers no copy until one is chosen', async () => {
      await withFleet();

      expect(presenter.chosen()).toBeNull();
      expect(presenter.view().copy).toBeNull();
      expect(presenter.view().selectedLabel).toBeNull();
    });

    it('names it in words, states its facts and offers the copy', async () => {
      await withFleet();
      presenter.choose(12);

      const view = presenter.view();
      expect(view.copy).toBe(BUNDLED_ENGLISH['fleet.copy']);
      expect(view.ships.find((ship) => ship.id === '12')?.selected).toBe(true);
      expect(view.facts.map((fact) => fact.id)).toEqual(['hull', 'ident', 'source']);
      expect(view.selectedLabel).not.toBeNull();
    });

    it('reads every fact off the build the package rebuilt', async () => {
      await withFleet();
      presenter.choose(12);
      const ship = presenter.chosen();

      expect(presenter.view().facts[1].value).toBe(ship?.loadout.shipIdent);
    });

    it('forgets the choice where the chosen ship is no longer in the fleet', async () => {
      await withFleet();
      presenter.choose(12);
      api.refreshes.push(answeredFleet({ result: 'empty' }));
      await presenter.refresh();

      expect(presenter.chosen()).toBeNull();
      expect(presenter.view().copy).toBeNull();
    });
  });

  it('says a refresh is running while one is, without claiming it finished', async () => {
    writeState();
    api.reads.push(answeredFleet({ ships: [ownedShipPayload(12)] }));
    await signIn();

    const running = presenter.refresh();
    expect(presenter.view().refreshing).toBe(true);
    await running;
    expect(presenter.view().refreshing).toBe(false);
    expect(store.confirmedAt()).not.toBeNull();
  });
});
