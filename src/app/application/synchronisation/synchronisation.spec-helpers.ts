import { TestBed } from '@angular/core/testing';
import type {
  SynchronisationRequest,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';
import type {
  CommanderApiPort,
  CommanderSessionResult,
} from '../../platform/network/commander-api';
import type { FleetResponse } from '../../domain/commander/fleet/fleet-answer';
import { EDNB_COMMANDER_STATE_KEY } from '../../platform/storage/storage-keys';
import type { MemoryStorage } from '../../platform/storage/storage.spec-helpers';
import { AccountStore } from '../account/account.store';

/** The account every synchronisation spec signs in as. */
export const CUSTOMER = '900001';
/** Somebody else's account, for the records this browser may not send. */
export const OTHER_CUSTOMER = '900002';
export const ACCOUNT = { customerId: CUSTOMER, commanderName: 'CMDR Jameson' };

/**
 * A Commander service that keeps every request and answers as told.
 *
 * Keeping the requests is the point: the constitution's boundary is about what
 * leaves the browser, so the tests read the request rather than the store.
 */
export class FakeCommanderApi implements CommanderApiPort {
  readonly requests: SynchronisationRequest[] = [];
  /** Answers used in order, ahead of the accepting default. */
  readonly answers: SynchronisationResponse[] = [];
  session: CommanderSessionResult = { kind: 'anonymous' };
  signedOutCalls = 0;
  /**
   * Set to hold every exchange open until it settles.
   *
   * An exchange in flight is a state of its own and the panel has a sentence
   * for it, so a test that needs to read that sentence needs the exchange to
   * still be running when it reads.
   */
  held: Promise<void> | null = null;
  #revision = 0;

  callbackResult(): null {
    return null;
  }

  async startSignIn(): Promise<boolean> {
    return true;
  }

  /**
   * The fleet is not what these tests are about.
   *
   * Unavailable is the honest answer for a test with no origin to read from,
   * and it is the one answer that lets the fleet store claim nothing.
   */
  async readFleet(): Promise<FleetResponse> {
    return { kind: 'unavailable' };
  }

  async refreshFleet(): Promise<FleetResponse> {
    return { kind: 'unavailable' };
  }

  async readSession(): Promise<CommanderSessionResult> {
    return this.session;
  }

  async signOut(): Promise<boolean> {
    this.signedOutCalls += 1;
    return true;
  }

  async deleteAccount(): Promise<boolean> {
    return true;
  }

  async synchroniseRecords(request: SynchronisationRequest): Promise<SynchronisationResponse> {
    this.requests.push(request);
    if (this.held !== null) {
      await this.held;
    }
    const scripted = this.answers.shift();
    if (scripted !== undefined) {
      return scripted;
    }
    // The service answers every change it was sent, which is what lets this
    // browser stop owing it: an unanswered change stays queued and is offered
    // again on the next exchange.
    this.#revision += request.changes.length;
    return {
      kind: 'accepted',
      accountRevision: this.#revision,
      results: request.changes.map((change, index) => ({
        index,
        outcome: 'applied' as const,
        id: change.type === 'write' ? change.record.id : change.id,
        revision: change.type === 'write' ? this.#revision : null,
        remote: null,
        code: null,
      })),
      records: [],
      unreadableRecords: [],
      tombstones: [],
    };
  }
}

/** A clock a test can move, for the rules that are about elapsed days. */
export class MovableClock {
  instant = new Date('2026-03-01T00:00:00.000Z');

  now(): Date {
    return this.instant;
  }

  timestamp(): string {
    return this.instant.toISOString();
  }

  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

/** Connectivity a test can switch, in the shape the adapter is read in. */
export class SwitchableConnectivity {
  readonly online = ((): (() => boolean) & { set: (value: boolean) => void } => {
    let value = true;
    const read = (() => value) as (() => boolean) & { set: (next: boolean) => void };
    read.set = (next: boolean) => {
      value = next;
    };
    return read;
  })();

  onOnline(): () => void {
    return () => {};
  }
}

/** Identities in the order a test can predict. */
export class SequentialUuid {
  #next = 0;

  create(): string {
    this.#next += 1;
    return `fedcba98-0000-4000-8000-${String(this.#next).padStart(12, '0')}`;
  }
}

/**
 * Lets every exchange already in flight finish before the next assertion.
 *
 * An exchange is reached through loaders, and each of them fetches a module the
 * first time it is asked: the synchronisation engine itself, the format the
 * record exchange is read in, and the reconstructor a stored build is read
 * through. Loading them here first takes the unbounded waits out of the
 * exchange, so the turns that follow are the store's own and stay few and
 * fixed.
 */
export async function settle(): Promise<void> {
  await Promise.all([
    import('../../domain/ships/build/build-snapshot.reconstructor'),
    import('../../domain/records/record-synchronisation'),
    import('./record-synchronisation.store'),
    import('./record-synchronisation.coordinator'),
  ]);
  for (let turn = 0; turn < 3; turn += 1) {
    TestBed.tick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Writes the Commander state this browser would already be holding. */
export function writeCommanderState(
  storage: MemoryStorage,
  state: Record<string, unknown> = {},
): void {
  storage.entries.set(
    EDNB_COMMANDER_STATE_KEY,
    JSON.stringify({
      format: 'ednb.commander-state',
      version: 1,
      account: ACCOUNT,
      fleetCache: [],
      accountCursors: { [CUSTOMER]: 4 },
      pendingOperations: [],
      recordBindings: {},
      recordRevisions: {},
      ...state,
    }),
  );
}

/** Signs this browser in, and lets the first exchange finish. */
export async function signIn(api: FakeCommanderApi): Promise<void> {
  api.session = { kind: 'signed-in', account: ACCOUNT, antiForgeryToken: 'token-1' };
  await TestBed.inject(AccountStore).refreshSession();
  await settle();
}

/** Every change of one kind the service has been sent so far. */
export function changesOfKind(
  api: FakeCommanderApi,
  type: 'renew' | 'write' | 'delete',
): readonly string[] {
  return api.requests
    .flatMap((request) => request.changes)
    .filter((change) => change.type === type)
    .map((change) => (change.type === 'write' ? change.record.id : change.id));
}
