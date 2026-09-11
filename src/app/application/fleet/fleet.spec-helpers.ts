import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { OwnedShipModel, OwnedShipModule } from '../../domain/commander/fleet/owned-ship';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import type {
  CommanderApiPort,
  CommanderSessionResult,
} from '../../platform/network/commander-api';
import type { FleetAnswer, FleetResponse } from '../../domain/commander/fleet/fleet-answer';
import type {
  SynchronisationRequest,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';

/** The account every fleet spec signs in as. */
export const CUSTOMER = '900001';
export const FLEET_ACCOUNT = { customerId: CUSTOMER, commanderName: 'CMDR Jameson' };
export const ANTI_FORGERY = 'token-1';

/**
 * The model the service stores: the package's own build, without the fields
 * 020/FR-015 excludes.
 *
 * Built from the package rather than written out by hand, so a pinned release
 * that changes a hull's stock fitting changes this fixture with it.
 */
export function modelOf(loadout: ShipLoadout): OwnedShipModel {
  const snapshot = toBuildSnapshotV1(loadout);

  return {
    hullSymbol: snapshot.shipSymbol,
    shipName: snapshot.shipName,
    shipIdent: snapshot.shipIdent,
    modules: snapshot.modules.map((module): OwnedShipModule => ({
      slot: module.slot,
      symbol: module.symbol,
      enabled: module.enabled,
      priority: module.priority,
      preEngineered: module.preEngineered,
      engineering:
        module.engineering === null
          ? null
          : {
              blueprint: module.engineering.blueprint,
              grade: module.engineering.grade,
              experimental: module.engineering.experimental,
            },
    })),
  };
}

/** One owned-ship payload, in the shape both the service and the cache carry. */
export function ownedShipPayload(
  shipId: number,
  hullSymbol = 'Anaconda',
  overrides: Partial<OwnedShipModel> = {},
): Record<string, unknown> {
  return {
    shipId,
    sourceDate: '2026-09-01',
    sourceLine: shipId,
    model: { ...modelOf(ShipLoadout.default(hullSymbol)), ...overrides },
  };
}

/** The coverage block a settled answer carries. */
export function coverage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startDate: '2026-08-18',
    cursorDate: '2026-09-02',
    cursorLine: 7,
    storedShips: { date: '2026-09-01', line: 3, complete: true },
    nextPermittedRefreshAt: null,
    ...overrides,
  };
}

/** One complete answer body, as either fleet address sends it. */
export function fleetBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    result: 'current',
    ships: [],
    coverage: coverage(),
    pending: false,
    failure: null,
    packageRefusal: null,
    ...overrides,
  };
}

/** One answer the service gave, with the settled default filled in. */
export function answeredFleet(overrides: Partial<FleetAnswer> = {}): FleetResponse {
  return {
    kind: 'answered',
    answer: {
      result: 'current',
      ships: [],
      coverage: null,
      pending: false,
      failure: null,
      packageRefusal: null,
      ...overrides,
    },
  };
}

/**
 * A Commander service whose fleet answers are scripted.
 *
 * `offline` is the browser with no network: both fleet addresses answer
 * `unavailable`, which is what a request that never arrives means to every
 * caller.
 */
export class FakeFleetApi implements CommanderApiPort {
  session: CommanderSessionResult = { kind: 'anonymous' };
  /** Answers used in order, ahead of `fleet`. */
  readonly reads: FleetResponse[] = [];
  readonly refreshes: FleetResponse[] = [];
  /** Every locale a refresh asked the package diagnostic in. */
  readonly refreshLocales: string[] = [];
  readCalls = 0;
  refreshCalls = 0;
  offline = false;

  callbackResult(): null {
    return null;
  }

  async startSignIn(): Promise<boolean> {
    return true;
  }

  async readSession(): Promise<CommanderSessionResult> {
    return this.session;
  }

  async signOut(): Promise<boolean> {
    return true;
  }

  async deleteAccount(): Promise<boolean> {
    return true;
  }

  async synchroniseRecords(_request: SynchronisationRequest): Promise<SynchronisationResponse> {
    return { kind: 'unavailable' };
  }

  async readFleet(): Promise<FleetResponse> {
    this.readCalls += 1;
    if (this.offline) {
      return { kind: 'unavailable' };
    }
    return this.reads.shift() ?? { kind: 'unavailable' };
  }

  async refreshFleet(_antiForgeryToken: string, locale: string): Promise<FleetResponse> {
    this.refreshCalls += 1;
    this.refreshLocales.push(locale);
    if (this.offline) {
      return { kind: 'unavailable' };
    }
    return this.refreshes.shift() ?? { kind: 'unavailable' };
  }
}
