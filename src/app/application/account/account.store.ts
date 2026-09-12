import { Injectable, computed, inject, signal } from '@angular/core';
import type { CachedCommanderAccount } from '../../domain/commander/commander-local-state';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';

/** What one authenticated request to the Commander service needs. */
export interface AccountCredentials {
  readonly customerId: string;
  readonly antiForgeryToken: string;
}

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
  readonly #records = inject(LocalRecordRepository);
  readonly #state = signal<AccountState>({ kind: 'loading' });
  readonly #open = signal(false);
  readonly #antiForgeryToken = signal<string | null>(null);
  readonly #signedOut = signal(0);

  readonly state = this.#state.asReadonly();
  readonly open = this.#open.asReadonly();

  /**
   * Rises once each time an account leaves this browser deliberately.
   *
   * Sign-out and account deletion both raise it; an expired session and an
   * unreachable service do not, because neither is a Commander saying the
   * account is done with here. Read rather than called, because what has to
   * happen next is the record synchronisation store forgetting what this page
   * was saying about the account — and this store may not reach for that store,
   * which already reads this one (020/FR-003).
   */
  readonly signedOutRevision = this.#signedOut.asReadonly();

  /**
   * What an authenticated request needs, or `null` where there is no session.
   *
   * The token stays here rather than being handed around: everything that
   * reaches the account's own API reads this, and it empties the moment the
   * session does (020/FR-004).
   *
   * An expired Frontier authorisation is not an expired Nav Beacon session.
   * Frontier is the fleet's alone; the record exchange reaches this browser's
   * own service with a session cookie and an anti-forgery token that both
   * still stand. Emptying this in that state would stop a Commander's saves
   * reaching the account they belong to, and nothing rescans browser storage
   * afterwards, so the save would be lost rather than late (020/FR-011,
   * constitution IV).
   */
  readonly credentials = computed<AccountCredentials | null>(() => {
    const state = this.#state();
    const token = this.#antiForgeryToken();
    const signed = state.kind === 'signed-in' || state.kind === 'authorisation-expired';
    return signed && token !== null
      ? { customerId: state.account.customerId, antiForgeryToken: token }
      : null;
  });

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
      this.#antiForgeryToken.set(result.antiForgeryToken);
      this.#local.storeAccount(result.account);
      this.#state.set({ kind: 'signed-in', account: result.account });
      return;
    }
    this.#antiForgeryToken.set(null);
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
    const token = this.#antiForgeryToken();
    if (current === null || token === null) {
      return;
    }
    this.#state.set({ kind: 'signing-out', account: current });
    if (!(await this.#api.signOut(token))) {
      this.#state.set({ kind: 'sign-out-failed', account: current });
      return;
    }
    this.#antiForgeryToken.set(null);
    // Account state and the fleet cache go; planning records and current work
    // stay, and remain usable without an account (020/FR-003).
    this.#local.clearSession();
    this.#state.set({ kind: 'anonymous' });
    this.#signedOut.update((revision) => revision + 1);
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

  /**
   * Deletes the account, local side first.
   *
   * The browser clears its account state, its fleet cache, its synchronisation
   * state and its pending remote operations and marks the retained planning
   * records local-only in one local transaction, and sends the authenticated
   * deletion only once that transaction has committed. The order is what makes
   * every outcome the same outcome for a Commander: a committed server deletion
   * and a lost response both leave this browser anonymous, with its planning
   * records kept and local-only, and nothing queued to upload (020/FR-006,
   * 020/FR-024).
   *
   * The records this browser holds are read first, because the account state
   * alone does not name them: a record whose upload never completed carries no
   * binding, and one bound to another Commander is not this deletion's to
   * touch (020/FR-024).
   *
   * A refused local transaction sends nothing. The failure is stated, the
   * session and its records are untouched, and deletion can be attempted again.
   * A browser that will not say which records it holds is one of those
   * failures: marking nothing would leave the retained records eligible for the
   * next account that signs in.
   */
  async deleteAccount(): Promise<void> {
    const account = accountFrom(this.#state());
    const token = this.#antiForgeryToken();
    if (account === null || token === null) {
      return;
    }
    const retained = this.#records.ids();
    if (!retained.ok) {
      this.#state.set({ kind: 'delete-local-failed', account });
      return;
    }
    const cleanup = this.#local.prepareAccountDeletion(account.customerId, retained.value);
    if (!cleanup.ok) {
      this.#state.set({ kind: 'delete-local-failed', account });
      return;
    }
    this.#antiForgeryToken.set(null);
    this.#state.set({ kind: 'deleting' });
    // The answer is not read, and a request that never comes back is not an
    // error here either. A refusal and a lost response both leave this browser
    // in the state the local transaction already committed, and a Commander who
    // signs in again gets an empty account or another chance to delete — which
    // the server decides, not this browser.
    await this.#api.deleteAccount(token).catch(() => false);
    this.#state.set({ kind: 'anonymous' });
    this.#signedOut.update((revision) => revision + 1);
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
