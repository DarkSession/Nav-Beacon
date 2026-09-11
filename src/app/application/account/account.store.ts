import { Injectable, inject, signal } from '@angular/core';
import type { CachedCommanderAccount } from '../../domain/commander/commander-local-state';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';

export type AccountState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'redirect-pending' }
  | { readonly kind: 'correlation-refused' }
  | { readonly kind: 'signed-in'; readonly account: CachedCommanderAccount }
  | { readonly kind: 'offline'; readonly account: CachedCommanderAccount | null }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'authorisation-expired'; readonly account: CachedCommanderAccount }
  | { readonly kind: 'signing-out'; readonly account: CachedCommanderAccount }
  | { readonly kind: 'sign-out-failed'; readonly account: CachedCommanderAccount }
  | { readonly kind: 'delete-confirmation'; readonly account: CachedCommanderAccount }
  | { readonly kind: 'deleting' }
  | { readonly kind: 'delete-local-failed'; readonly account: CachedCommanderAccount };

@Injectable({ providedIn: 'root' })
export class AccountStore {
  readonly #api = inject(COMMANDER_API);
  readonly #local = inject(CommanderStateRepository);
  readonly #state = signal<AccountState>({ kind: 'loading' });
  readonly #open = signal(false);
  #antiForgeryToken: string | null = null;

  readonly state = this.#state.asReadonly();
  readonly open = this.#open.asReadonly();

  async initialise(): Promise<void> {
    const callback = this.#api.callbackResult();
    if (callback === 'fresh-sign-in-required') {
      this.#state.set({ kind: 'correlation-refused' });
      this.#open.set(true);
      return;
    }
    await this.refreshSession(false);
    if (callback === 'signed-in') {
      this.#open.set(true);
    }
  }

  async refreshSession(expiryOnAnonymous = true): Promise<void> {
    const result = await this.#api.readSession();
    if (result.kind === 'signed-in') {
      this.#antiForgeryToken = result.antiForgeryToken;
      this.#local.storeAccount(result.account);
      this.#state.set({ kind: 'signed-in', account: result.account });
      return;
    }
    this.#antiForgeryToken = null;
    if (result.kind === 'unavailable') {
      this.#state.set({ kind: 'offline', account: this.#local.read().account });
      return;
    }
    this.#local.clearSession();
    this.#state.set(expiryOnAnonymous ? { kind: 'session-expired' } : { kind: 'anonymous' });
  }

  openDialog(): void {
    this.#open.set(true);
  }

  closeDialog(): void {
    this.#open.set(false);
    if (this.#state().kind === 'correlation-refused' || this.#state().kind === 'session-expired') {
      this.#state.set({ kind: 'anonymous' });
    }
  }

  async startSignIn(): Promise<void> {
    this.#state.set({ kind: 'redirect-pending' });
    if (!(await this.#api.startSignIn())) {
      this.#state.set({ kind: 'offline', account: this.#local.read().account });
    }
  }

  async signOut(): Promise<void> {
    const current = accountFrom(this.#state());
    if (current === null || this.#antiForgeryToken === null) {
      return;
    }
    this.#state.set({ kind: 'signing-out', account: current });
    if (!(await this.#api.signOut(this.#antiForgeryToken))) {
      this.#state.set({ kind: 'sign-out-failed', account: current });
      return;
    }
    this.#antiForgeryToken = null;
    this.#local.clearSession();
    this.#state.set({ kind: 'anonymous' });
    this.#open.set(false);
  }

  requestDeletion(): void {
    const account = accountFrom(this.#state());
    if (account !== null) {
      this.#state.set({ kind: 'delete-confirmation', account });
    }
  }

  cancelDeletion(): void {
    const account = accountFrom(this.#state());
    if (account !== null) {
      this.#state.set({ kind: 'signed-in', account });
    }
  }

  async deleteAccount(): Promise<void> {
    const account = accountFrom(this.#state());
    if (account === null || this.#antiForgeryToken === null) {
      return;
    }
    const cleanup = this.#local.prepareAccountDeletion();
    if (!cleanup.ok) {
      this.#state.set({ kind: 'delete-local-failed', account });
      return;
    }
    const token = this.#antiForgeryToken;
    this.#antiForgeryToken = null;
    this.#state.set({ kind: 'deleting' });
    await this.#api.deleteAccount(token);
    this.#state.set({ kind: 'anonymous' });
    this.#open.set(false);
  }

  markAuthorisationExpired(): void {
    const account = accountFrom(this.#state());
    if (account !== null) {
      this.#state.set({ kind: 'authorisation-expired', account });
      this.#open.set(true);
    }
  }
}

function accountFrom(state: AccountState): CachedCommanderAccount | null {
  return 'account' in state ? state.account : null;
}
