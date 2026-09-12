import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type {
  FleetAnswer,
  FleetCoverage,
  FleetFailure,
  FleetResponse,
  PackageRefusal,
} from '../../domain/commander/fleet/fleet-answer';
import {
  isSettledFleetResult,
  type CachedFleet,
  type SettledFleetResult,
} from '../../domain/commander/fleet/fleet-cache';
import {
  mapOwnedShip,
  type OwnedShip,
  type OwnedShipMappingFailure,
} from '../../domain/commander/fleet/owned-ship';
import { LocaleStore } from '../../i18n/locale.store';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { AccountStore } from '../account/account.store';

/**
 * One owned ship the installed package would not rebuild.
 *
 * The service accepted it, and this browser's package cannot resolve it — a
 * pinned version behind the one the projection was made with, or an identity
 * this installation does not carry. It is listed rather than dropped and
 * nothing is substituted for it: an owned ship is a statement about a
 * Commander's real ship (020/FR-016).
 */
export interface RefusedOwnedShip {
  /** Frontier's own identity, where the payload carried a readable one. */
  readonly shipId: number | null;
  readonly failure: OwnedShipMappingFailure;
  /** The package's own words. Never a translation and never invented. */
  readonly reason: string;
}

/** The last accepted owned fleet, as this browser holds it. */
export interface FleetHolding {
  readonly result: SettledFleetResult;
  readonly ships: readonly OwnedShip[];
  readonly refused: readonly RefusedOwnedShip[];
  readonly coverage: FleetCoverage | null;
  /** `true` while journal is left to read before the fleet is current. */
  readonly pending: boolean;
  /** When this browser accepted it. */
  readonly acceptedAt: string;
  /**
   * Whether this was read out of browser storage rather than confirmed now.
   *
   * The one thing a Commander offline has to be able to tell: these are the
   * ships they already had, not a fleet anything has just checked
   * (020/FR-022).
   */
  readonly fromCache: boolean;
}

/**
 * What the last exchange with the fleet service said.
 *
 * Nothing here claims a refresh completed unless the service answered one.
 * `unavailable` is both the request that never arrived and the answer this
 * browser could not read, because they mean the same thing: the fleet already
 * held still stands and nothing new was confirmed (020/FR-018, 020/FR-022).
 */
export type FleetExchange =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'refreshing' }
  /** The service answered a settled fleet, at this instant. */
  | { readonly kind: 'confirmed'; readonly at: string }
  /** Frontier or another refresh of this account holds the next attempt. */
  | { readonly kind: 'waiting'; readonly until: string | null }
  | {
      readonly kind: 'failed';
      readonly failure: FleetFailure;
      /** The package's own refusal, where the failure is one. */
      readonly refusal: PackageRefusal | null;
    }
  | { readonly kind: 'authorisation-expired' }
  /** The session has gone; a fresh sign-in resumes it and local work is untouched. */
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'unavailable' };

/**
 * The Commander's owned fleet, as one exchange at a time.
 *
 * Two things reach the service: reading the fleet it already holds, and asking
 * it to read more journal. Everything else here is about what may be claimed
 * from what came back. The fleet this browser last accepted is kept under the
 * account's own key and read first, so a Commander who has loaded the
 * application once can read their ships with no network at all — and a refresh
 * that does not arrive says so rather than emptying the list (020/FR-018,
 * 020/FR-022).
 *
 * An owned ship is read-only. Nothing here writes to one, and the copy a
 * Commander takes into the planning tools is a separate record with its own
 * identity (020/FR-017, `FleetCopyService`).
 *
 * No rendering, so it is testable without a component (constitution III).
 */
@Injectable({ providedIn: 'root' })
export class FleetStore {
  readonly #api = inject(COMMANDER_API);
  readonly #account = inject(AccountStore);
  readonly #state = inject(CommanderStateRepository);
  readonly #clock = inject(ClockAdapter);
  readonly #locale = inject(LocaleStore);

  readonly #holding = signal<FleetHolding | null>(null);
  readonly #exchange = signal<FleetExchange>({ kind: 'idle' });
  readonly #confirmedAt = signal<string | null>(null);

  /** The fleet this browser holds, from the service or from its own storage. */
  readonly holding = this.#holding.asReadonly();
  readonly exchange = this.#exchange.asReadonly();

  /**
   * When the service last confirmed this fleet, within this page.
   *
   * `null` until a service answer has actually been read. A fleet restored from
   * browser storage leaves it `null`, which is what stops an offline page from
   * saying a refresh completed.
   */
  readonly confirmedAt = this.#confirmedAt.asReadonly();

  /** Whether a Commander is signed in, which everything here needs. */
  readonly signedIn = computed(() => this.#account.credentials() !== null);

  /**
   * Whether this browser still knows whose fleet this is.
   *
   * Not the same question as {@link signedIn}. An expired Frontier
   * authorisation and an unreachable service both leave the account known and
   * the credentials gone, and the fleet already accepted still belongs to that
   * Commander — which is exactly the moment 020/FR-018 says the ships stay
   * readable. Only an account that has left this browser empties it.
   */
  readonly accountKnown = computed(() => {
    const state = this.#account.state();
    return 'account' in state && state.account !== null;
  });

  /** Whether Frontier authorisation is what a fresh sign-in is owed for. */
  readonly authorisationExpired = computed(
    () => this.#account.state().kind === 'authorisation-expired',
  );

  #running: Promise<void> | null = null;
  /** Whether this page has already asked the account to read a refused session. */
  #sessionRead = false;

  constructor() {
    // The account arriving is what the fleet follows. A Commander who signs in
    // from any screen has their fleet read from that screen.
    //
    // What empties this page is the account leaving the browser — a sign-out,
    // an account deletion or a session that ended — and not credentials going
    // quiet. An expired authorisation keeps the ships already accepted, because
    // they are still that Commander's ships (020/FR-018).
    let signedOut = this.#account.signedOutRevision();
    effect(() => {
      const revision = this.#account.signedOutRevision();
      const known = this.accountKnown();
      if (revision !== signedOut || !known) {
        signedOut = revision;
        this.#forget();
        return;
      }
      if (this.#account.credentials() !== null) {
        void this.load();
      }
    });
  }

  /**
   * Reads the fleet: this browser's copy first, then the service.
   *
   * The stored copy is shown before the request is made rather than after it
   * fails, so an offline Commander reads their ships immediately and a slow
   * network never empties the list (020/FR-022).
   */
  async load(): Promise<void> {
    const credentials = this.#account.credentials();
    if (credentials === null) {
      this.#forget();
      return;
    }
    this.#restore(credentials.customerId);
    await this.#exclusive(async () => {
      const departures = this.#account.signedOutRevision();
      this.#exchange.set({ kind: 'reading' });
      const response = await this.#api.readFleet();
      this.#take(response, credentials.customerId, departures);
    });
  }

  /**
   * Asks the service to read more journal and commit what it accepts.
   *
   * The answer decides what may be said. A refusal, a failure and an answer
   * that never arrived all leave the fleet already held exactly where it is,
   * and none of them is reported as a completed refresh (020/FR-018).
   */
  async refresh(): Promise<void> {
    const credentials = this.#account.credentials();
    if (credentials === null) {
      // Which of the two sign-ins is owed, said as the account states it: a
      // Frontier authorisation that expired is not the same thing as a session
      // that ended, and asking for the wrong one sends a Commander somewhere
      // that cannot help (020/FR-004).
      this.#exchange.set(
        this.authorisationExpired()
          ? { kind: 'authorisation-expired' }
          : { kind: 'session-expired' },
      );
      return;
    }
    await this.#exclusive(async () => {
      const departures = this.#account.signedOutRevision();
      this.#exchange.set({ kind: 'refreshing' });
      const response = await this.#api.refreshFleet(
        credentials.antiForgeryToken,
        this.#locale.effectiveLocale(),
      );
      this.#take(response, credentials.customerId, departures);
    });
  }

  /** One exchange at a time, so two answers cannot commit over each other. */
  async #exclusive(run: () => Promise<void>): Promise<void> {
    const running = this.#running;
    if (running !== null) {
      await running;
      return;
    }
    const attempt = run().finally(() => {
      this.#running = null;
    });
    this.#running = attempt;
    await attempt;
  }

  /**
   * Takes one answer back, for the account that is still here to take it.
   *
   * A sign-out and an account deletion both commit their own local write while
   * a request is open, and this answer arrives after it. Accepting it would
   * write that account's fleet back into a browser that has just cleared it,
   * and show it to whoever is at the screen; stating a failure for it would
   * have this page speaking for an account that has gone. The departure count
   * rising is that moment, and the answer is dropped where it has
   * (020/FR-003, 020/FR-006).
   */
  #take(response: FleetResponse, customerId: string, departures: number): void {
    if (this.#account.signedOutRevision() !== departures) {
      return;
    }
    if (response.kind === 'unavailable') {
      this.#exchange.set({ kind: 'unavailable' });
      return;
    }
    if (response.kind === 'refused') {
      if (response.code === 'unauthorised') {
        this.#exchange.set({ kind: 'session-expired' });
        this.#sessionRefused();
        return;
      }
      this.#exchange.set({ kind: 'failed', failure: 'frontier-unavailable', refusal: null });
      return;
    }
    this.#accept(response.answer, customerId);
  }

  /**
   * Takes one answer the service gave.
   *
   * A settled result replaces what this browser holds and is written to
   * storage. Every other result leaves the held fleet alone and states why the
   * refresh is not current, which is what keeps a failed refresh harmless.
   */
  #accept(answer: FleetAnswer, customerId: string): void {
    const at = this.#clock.timestamp();
    this.#sessionRead = false;

    if (isSettledFleetResult(answer.result)) {
      const cached: CachedFleet = {
        customerId,
        acceptedAt: at,
        result: answer.result,
        ships: answer.ships,
        coverage: answer.coverage,
      };
      this.#state.storeFleet(cached);
      this.#holding.set(holdingOf(cached, answer.pending, false));
      this.#confirmedAt.set(at);
      this.#exchange.set({ kind: 'confirmed', at });
      return;
    }

    switch (answer.result) {
      case 'waiting':
        this.#exchange.set({
          kind: 'waiting',
          until: answer.coverage?.nextPermittedRefreshAt ?? null,
        });
        return;
      case 'authorisation-expired':
        this.#exchange.set({ kind: 'authorisation-expired' });
        // The account is what a fresh sign-in is asked for from, and it is the
        // one surface that can ask for one (020/FR-004).
        this.#account.markAuthorisationExpired();
        return;
      default:
        this.#exchange.set({
          kind: 'failed',
          // A failed result always names its failure. A body that did not would
          // have been refused by the reader before it reached here.
          failure: answer.failure ?? 'frontier-unavailable',
          refusal: answer.packageRefusal,
        });
    }
  }

  /**
   * Asks the account to read a session the service has refused.
   *
   * The refusal says the session has ended, and this browser's account state
   * is what still says otherwise. The read clears that state and the fleet
   * cache, and leaves the planning records and the current work alone
   * (020/FR-003). It is not waited for: what this exchange owes a Commander is
   * the answer it already states.
   *
   * Once, until the service answers a fleet again. A service that refuses
   * every fleet request while still answering the session read would otherwise
   * have each refusal publish fresh credentials, and the watch that follows
   * them would ask for the fleet again.
   */
  #sessionRefused(): void {
    if (this.#sessionRead) {
      return;
    }
    this.#sessionRead = true;
    void this.#account.refreshSession();
  }

  /** Shows the fleet this browser already has, where it has one. */
  #restore(customerId: string): void {
    const cached = this.#state.readFleet(customerId);
    if (cached !== null && this.#holding() === null) {
      this.#holding.set(holdingOf(cached, false, true));
    }
  }

  /** Forgets what this page was saying about a fleet that has no account. */
  #forget(): void {
    this.#sessionRead = false;
    this.#holding.set(null);
    this.#confirmedAt.set(null);
    this.#exchange.set({ kind: 'idle' });
  }
}

/**
 * One cached fleet, rebuilt through the package.
 *
 * Every payload goes through `mapOwnedShip`, which is the one path from a
 * stored model to a build. A payload it refuses is listed with the package's
 * own reason rather than dropped or replaced (020/FR-015, 020/FR-016).
 */
function holdingOf(cached: CachedFleet, pending: boolean, fromCache: boolean): FleetHolding {
  const ships: OwnedShip[] = [];
  const refused: RefusedOwnedShip[] = [];

  for (const payload of cached.ships) {
    const mapped = mapOwnedShip(payload);
    if (mapped.ok) {
      ships.push(mapped.ship);
      continue;
    }
    refused.push({ shipId: readShipId(payload), failure: mapped.failure, reason: mapped.reason });
  }

  return {
    result: cached.result,
    ships: [...ships].sort((left, right) => left.shipId - right.shipId),
    refused,
    coverage: cached.coverage,
    pending,
    acceptedAt: cached.acceptedAt,
    fromCache,
  };
}

/** The Frontier identity of a payload that did not rebuild, where it has one. */
function readShipId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const shipId = (payload as Record<string, unknown>)['shipId'];
  return typeof shipId === 'number' && Number.isSafeInteger(shipId) ? shipId : null;
}
