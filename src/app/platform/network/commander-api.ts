import { DOCUMENT } from '@angular/core';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { FleetResponse } from '../../domain/commander/fleet/fleet-answer';
import type {
  SynchronisationRequest,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';

export interface CommanderAccountIdentity {
  readonly customerId: string;
  readonly commanderName: string;
}

export type CommanderSessionResult =
  | {
      readonly kind: 'signed-in';
      readonly account: CommanderAccountIdentity;
      readonly antiForgeryToken: string;
    }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'unavailable' };

export interface CommanderApiPort {
  callbackResult(): 'signed-in' | 'fresh-sign-in-required' | null;
  startSignIn(): Promise<boolean>;
  readSession(): Promise<CommanderSessionResult>;
  signOut(antiForgeryToken: string): Promise<boolean>;
  deleteAccount(antiForgeryToken: string): Promise<boolean>;
  synchroniseRecords(
    request: SynchronisationRequest,
    antiForgeryToken: string,
  ): Promise<SynchronisationResponse>;
  readFleet(): Promise<FleetResponse>;
  refreshFleet(antiForgeryToken: string, locale: string): Promise<FleetResponse>;
}

export const COMMANDER_API = new InjectionToken<CommanderApiPort>('COMMANDER_API', {
  providedIn: 'root',
  factory: () => inject(CommanderApi),
});

@Injectable({ providedIn: 'root' })
export class CommanderApi implements CommanderApiPort {
  readonly #document = inject(DOCUMENT);

  callbackResult(): 'signed-in' | 'fresh-sign-in-required' | null {
    const view = this.#document.defaultView;
    if (view === null) {
      return null;
    }
    const address = new URL(view.location.href);
    const value = address.searchParams.get('account');
    if (value !== 'signed-in' && value !== 'fresh-sign-in-required') {
      return null;
    }
    address.searchParams.delete('account');
    view.history.replaceState(
      view.history.state,
      '',
      `${address.pathname}${address.search}${address.hash}`,
    );
    return value;
  }

  async startSignIn(): Promise<boolean> {
    const view = this.#document.defaultView;
    if (view === null) {
      return false;
    }
    try {
      const response = await this.#fetch('api/auth/frontier', { method: 'POST' });
      if (!response.ok) {
        return false;
      }
      const value: unknown = await response.json();
      const address = frontierAuthorisationAddress(value);
      if (address === null) {
        return false;
      }
      view.location.assign(address);
      return true;
    } catch {
      return false;
    }
  }

  async readSession(): Promise<CommanderSessionResult> {
    try {
      const response = await this.#fetch('api/session', { method: 'GET' });
      if (response.status === 401) {
        return { kind: 'anonymous' };
      }
      if (!response.ok) {
        return { kind: 'unavailable' };
      }
      const value: unknown = await response.json();
      const session = parseSession(value);
      return session ?? { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  async signOut(antiForgeryToken: string): Promise<boolean> {
    return this.#stateChangingRequest('api/session/sign-out', 'POST', antiForgeryToken);
  }

  async deleteAccount(antiForgeryToken: string): Promise<boolean> {
    return this.#stateChangingRequest('api/account', 'DELETE', antiForgeryToken);
  }

  /**
   * Exchanges one batch of record changes against the account revision stream.
   *
   * Everything the answer says is read here, before any caller can commit it.
   * A request that does not arrive, and an answer this browser cannot read,
   * are the same outcome: nothing was accepted, so nothing may be written
   * (020/FR-011, 020/FR-026).
   */
  async synchroniseRecords(
    request: SynchronisationRequest,
    antiForgeryToken: string,
  ): Promise<SynchronisationResponse> {
    const exchange = await this.#exchangeFormat();
    if (exchange === null) {
      return { kind: 'unavailable' };
    }

    let response: Response;
    try {
      response = await this.#fetch('api/records/synchronise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': antiForgeryToken },
        body: exchange.synchronisationBody(request),
      });
    } catch {
      return { kind: 'unavailable' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return response.ok ? { kind: 'unavailable' } : exchange.parseRefusal(response.status, null);
    }
    return response.ok
      ? exchange.parseAcceptedResponse(body)
      : exchange.parseRefusal(response.status, body);
  }

  /**
   * Reads the stored owned fleet.
   *
   * It asks Frontier for nothing and changes nothing, so it carries no
   * anti-forgery token and never answers `waiting`, `failed` or
   * `authorisation-expired`.
   */
  async readFleet(): Promise<FleetResponse> {
    return this.#fleetRequest('api/fleet', { method: 'GET' });
  }

  /**
   * Asks the service to read more journal and commit what it accepts.
   *
   * The locale travels in `Accept-Language` and is the one the application is
   * committed to rather than the one the browser was started with, because the
   * package diagnostic a refusal carries is asked for in the language the
   * Commander is reading. The service asks the package for it and answers with
   * what the package published, or with nothing; nothing here translates a
   * diagnostic (020/FR-016).
   */
  async refreshFleet(antiForgeryToken: string, locale: string): Promise<FleetResponse> {
    return this.#fleetRequest('api/fleet/refresh', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': antiForgeryToken, 'Accept-Language': locale },
    });
  }

  /**
   * One fleet request, read before any caller can act on it.
   *
   * A request that does not arrive and an answer this browser cannot read are
   * the same outcome: nothing was confirmed, so nothing may be claimed. The
   * fleet this browser already accepted stays valid either way (020/FR-018,
   * 020/FR-022).
   */
  async #fleetRequest(path: string, init: RequestInit): Promise<FleetResponse> {
    // Asked for before the request goes, so the reader and the answer it reads
    // arrive together.
    const reading = this.#fleetFormat();

    let response: Response;
    try {
      response = await this.#fetch(path, init);
    } catch {
      return { kind: 'unavailable' };
    }

    const fleet = await reading;
    if (fleet === null) {
      return { kind: 'unavailable' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return response.ok ? { kind: 'unavailable' } : fleet.parseFleetRefusal(response.status, null);
    }
    if (!response.ok) {
      return fleet.parseFleetRefusal(response.status, body);
    }
    const answer = fleet.parseFleetAnswer(body);
    return answer === null ? { kind: 'unavailable' } : { kind: 'answered', answer };
  }

  /**
   * The record exchange's own format, reached when a request needs it.
   *
   * The session half of this port is on every page, because the account dialog
   * states a refused sign-in and an expired session wherever a Commander is
   * (020/FR-001, 020/FR-003). The record exchange is not: it runs for a
   * signed-in Commander, from the synchronisation engine, which is itself
   * reached through a loader (`synchronisation/record-synchronisation.loader.ts`).
   * Its format travels with it rather than with the first payload of every
   * page.
   *
   * A format that does not arrive answers as a request that does not arrive:
   * nothing was sent and nothing was accepted, so nothing may be written
   * (020/FR-011, 020/FR-026).
   */
  #exchangeFormat(): Promise<typeof import('../../domain/records/record-synchronisation') | null> {
    return import('../../domain/records/record-synchronisation').catch(() => null);
  }

  /**
   * The fleet answer's own reader, reached when a request needs it.
   *
   * The fleet is a layer a Commander opens and nothing outside it reads a fleet
   * answer, so its reader arrives with the request rather than with every page.
   * A reader that does not arrive leaves this browser unable to read the answer,
   * which is the outcome it already states for an answer it cannot read: the
   * fleet this browser already accepted stays valid, and nothing new is claimed
   * (020/FR-018, 020/FR-022).
   */
  #fleetFormat(): Promise<typeof import('../../domain/commander/fleet/fleet-answer') | null> {
    return import('../../domain/commander/fleet/fleet-answer').catch(() => null);
  }

  async #stateChangingRequest(
    path: string,
    method: 'POST' | 'DELETE',
    antiForgeryToken: string,
  ): Promise<boolean> {
    try {
      const response = await this.#fetch(path, {
        method,
        headers: { 'X-CSRF-TOKEN': antiForgeryToken },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  #fetch(path: string, init: RequestInit): Promise<Response> {
    const view = this.#document.defaultView;
    if (view === null) {
      return Promise.reject(new Error('No browser is available.'));
    }
    const address = new URL(path, this.#document.baseURI);
    if (address.origin !== view.location.origin) {
      return Promise.reject(new Error('The Commander API must use this origin.'));
    }
    return view.fetch(address, { ...init, credentials: 'same-origin', cache: 'no-store' });
  }
}

function frontierAuthorisationAddress(value: unknown): string | null {
  if (!isObject(value) || Object.keys(value).join(',') !== 'authorisationUri') {
    return null;
  }
  const candidate = value['authorisationUri'];
  if (typeof candidate !== 'string') {
    return null;
  }
  const address = URL.parse(candidate);
  return address !== null && address.protocol === 'https:' ? address.href : null;
}

function parseSession(value: unknown): CommanderSessionResult | null {
  if (
    !isObject(value) ||
    Object.keys(value).sort().join(',') !== 'antiForgeryToken,commanderName,customerId,signedIn'
  ) {
    return null;
  }
  if (value['signedIn'] !== true) {
    return null;
  }
  const customerId = value['customerId'];
  const commanderName = value['commanderName'];
  const antiForgeryToken = value['antiForgeryToken'];
  if (
    typeof customerId !== 'string' ||
    !/^[1-9]\d*$/.test(customerId) ||
    typeof commanderName !== 'string' ||
    commanderName.trim().length === 0 ||
    typeof antiForgeryToken !== 'string' ||
    antiForgeryToken.length === 0
  ) {
    return null;
  }
  return {
    kind: 'signed-in',
    account: { customerId, commanderName },
    antiForgeryToken,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
