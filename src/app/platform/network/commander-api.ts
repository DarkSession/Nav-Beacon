import { DOCUMENT } from '@angular/core';
import { Injectable, InjectionToken, inject } from '@angular/core';

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
