import { TestBed } from '@angular/core/testing';
import { AccountStore } from './account.store';
import {
  COMMANDER_API,
  type CommanderApiPort,
  type CommanderSessionResult,
} from '../../platform/network/commander-api';
import type { FleetResponse } from '../../domain/commander/fleet/fleet-answer';
import type { SynchronisationResponse } from '../../domain/records/record-synchronisation';
import {
  COMMANDER_LOCAL_STATE_FORMAT,
  COMMANDER_LOCAL_STATE_VERSION,
  type CommanderLocalState,
} from '../../domain/commander/commander-local-state';
import { EDNB_COMMANDER_STATE_KEY, recordKey } from '../../platform/storage/storage-keys';
import {
  MemoryStorage,
  provideMemoryStorage,
  quotaError,
} from '../../platform/storage/storage.spec-helpers';

const ACCOUNT = { customerId: '900001', commanderName: 'CMDR Jameson' };
/** A second Commander, whose records this browser also holds. */
const OTHER_CUSTOMER = '900002';

const SIGNED_IN: CommanderSessionResult = {
  kind: 'signed-in',
  account: ACCOUNT,
  antiForgeryToken: 'token-1',
};

/**
 * A Commander service that answers from a script rather than a network.
 *
 * Every call is recorded, because the order of the calls is the thing under
 * test: the local transaction commits before the deletion is sent, and a
 * refused transaction sends nothing at all (020/FR-006).
 */
class FakeCommanderApi implements CommanderApiPort {
  callback: 'signed-in' | 'fresh-sign-in-required' | null = null;
  session: CommanderSessionResult = { kind: 'anonymous' };
  signInStarts = true;
  signOutSucceeds = true;
  /** What the deletion answers, or `null` for a response that never arrives. */
  deletionAnswer: boolean | null = true;

  readonly calls: string[] = [];
  /** The stored Commander state as it stood when the deletion was sent. */
  storedAtDeletion: string | null = null;
  #storage: MemoryStorage | null = null;

  watch(storage: MemoryStorage): void {
    this.#storage = storage;
  }

  callbackResult(): 'signed-in' | 'fresh-sign-in-required' | null {
    return this.callback;
  }

  async startSignIn(): Promise<boolean> {
    this.calls.push('start-sign-in');
    return this.signInStarts;
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
    this.calls.push('read-session');
    return this.session;
  }

  async signOut(): Promise<boolean> {
    this.calls.push('sign-out');
    return this.signOutSucceeds;
  }

  async deleteAccount(): Promise<boolean> {
    this.calls.push('delete-account');
    this.storedAtDeletion = this.#storage?.getItem(EDNB_COMMANDER_STATE_KEY) ?? null;
    if (this.deletionAnswer === null) {
      // A response that is lost rather than refused: the request left, and
      // nothing came back.
      throw new TypeError('Failed to fetch');
    }
    return this.deletionAnswer;
  }

  async synchroniseRecords(): Promise<SynchronisationResponse> {
    this.calls.push('synchronise-records');
    return { kind: 'unavailable' };
  }
}

/** A browser that has been signed in, with records bound and work pending. */
function storedState(): CommanderLocalState {
  return {
    format: COMMANDER_LOCAL_STATE_FORMAT,
    version: COMMANDER_LOCAL_STATE_VERSION,
    account: ACCOUNT,
    fleetCache: [],
    accountCursors: { [ACCOUNT.customerId]: 42 },
    pendingOperations: [
      {
        id: 'operation-1',
        customerId: ACCOUNT.customerId,
        recordId: 'record-1',
        kind: 'upload',
        baseRevision: null,
        queuedAt: '2026-01-02T03:04:05.000Z',
      },
    ],
    recordBindings: { 'record-1': ACCOUNT.customerId, 'record-2': 'local-only' },
    recordRevisions: { 'record-1': 41 },
  };
}

function setUp(
  seed: CommanderLocalState | null = storedState(),
  retained: readonly string[] = ['record-1', 'record-2'],
) {
  const storage = new MemoryStorage();
  if (seed !== null) {
    storage.setItem(EDNB_COMMANDER_STATE_KEY, JSON.stringify(seed));
  }
  for (const recordId of retained) {
    // Only the key is read from a record here. Which records this browser
    // holds is what account deletion asks, not what is in them (020/FR-024).
    storage.setItem(recordKey(recordId), '{}');
  }
  const api = new FakeCommanderApi();
  api.watch(storage);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [...provideMemoryStorage(storage), { provide: COMMANDER_API, useValue: api }],
  });

  return { api, storage, store: TestBed.inject(AccountStore) };
}

/** The Commander state as it stands in storage now. */
function stored(storage: MemoryStorage): CommanderLocalState {
  return JSON.parse(storage.getItem(EDNB_COMMANDER_STATE_KEY) ?? '{}') as CommanderLocalState;
}

/** Signs the store in, which is where every deletion test starts. */
async function signedIn(
  seed: CommanderLocalState | null = storedState(),
  retained: readonly string[] = ['record-1', 'record-2'],
) {
  const context = setUp(seed, retained);
  context.api.session = SIGNED_IN;
  await context.store.refreshSession();
  return context;
}

describe('AccountStore', () => {
  describe('reading the session', () => {
    it('starts anonymous without claiming a session expired', async () => {
      const { store } = setUp(null);

      await store.initialise();

      expect(store.state()).toEqual({ kind: 'anonymous' });
    });

    it('names the Commander and remembers the account for a later offline read', async () => {
      const { store, storage } = await signedIn(null);

      expect(store.state()).toEqual({ kind: 'signed-in', account: ACCOUNT });
      expect(stored(storage).account).toEqual(ACCOUNT);
    });

    it('reads the last account it accepted when the service cannot be reached', async () => {
      const { api, store } = setUp();
      api.session = { kind: 'unavailable' };

      await store.refreshSession();

      expect(store.state()).toEqual({ kind: 'offline', account: ACCOUNT });
    });

    it('clears account state and the fleet cache when the session has expired', async () => {
      const { api, store, storage } = setUp();
      api.session = { kind: 'anonymous' };

      await store.refreshSession();

      expect(store.state()).toEqual({ kind: 'session-expired' });
      expect(stored(storage).account).toBeNull();
      expect(stored(storage).fleetCache).toEqual([]);
      // Planning records are not the session's to discard (020/FR-003).
      expect(Object.keys(stored(storage).recordBindings)).toEqual(['record-1', 'record-2']);
    });

    it('states that a refused callback needs a fresh sign-in, and opens to say so', async () => {
      const { api, store } = setUp();
      api.callback = 'fresh-sign-in-required';

      await store.initialise();

      expect(store.state()).toEqual({ kind: 'correlation-refused' });
      expect(store.open()).toBe(true);
      // Nothing is read from the service on a refused callback.
      expect(api.calls).toEqual([]);
    });
  });

  describe('signing in and out', () => {
    it('reports a sign-in it could not start as an unreachable service', async () => {
      const { api, store } = setUp();
      api.signInStarts = false;

      await store.startSignIn();

      expect(store.state()).toEqual({ kind: 'offline', account: ACCOUNT });
    });

    it('ends the session without deleting the account or its records', async () => {
      const { store, storage } = await signedIn();

      await store.signOut();

      expect(store.state()).toEqual({ kind: 'anonymous' });
      expect(stored(storage).account).toBeNull();
      expect(stored(storage).fleetCache).toEqual([]);
      expect(stored(storage).recordBindings['record-1']).toBe(ACCOUNT.customerId);
    });

    it('stays open to say the browser is anonymous once the session has ended', async () => {
      const { store } = await signedIn();
      store.openDialog();

      await store.signOut();

      expect(store.open()).toBe(true);
      expect(store.state()).toEqual({ kind: 'anonymous' });
    });

    it('keeps the Commander signed in when the service refuses the sign-out', async () => {
      const context = await signedIn();
      context.api.signOutSucceeds = false;

      await context.store.signOut();

      expect(context.store.state()).toEqual({ kind: 'sign-out-failed', account: ACCOUNT });
      expect(stored(context.storage).account).toEqual(ACCOUNT);
    });
  });

  describe('deleting the account', () => {
    it('asks before it deletes, and a cancel puts the session back', async () => {
      const { store } = await signedIn();

      store.requestDeletion();
      expect(store.state()).toEqual({ kind: 'delete-confirmation', account: ACCOUNT });

      store.cancelDeletion();
      expect(store.state()).toEqual({ kind: 'signed-in', account: ACCOUNT });
    });

    /**
     * A cancel puts the question away and settles nothing else.
     *
     * The deletion is offered wherever there is an account to delete, including
     * where Frontier authorisation has expired. Answering the cancel with
     * `signed-in` would state a session in better standing than the one the
     * Commander has, and would take the fresh Frontier sign-in off the dialog
     * that was offering it (020/FR-003, 020/FR-006, constitution IV).
     */
    it('puts a cancelled deletion back to the state that offered it', async () => {
      const { store } = await signedIn();
      store.markAuthorisationExpired();

      store.requestDeletion();
      expect(store.state()).toEqual({ kind: 'delete-confirmation', account: ACCOUNT });

      store.cancelDeletion();

      expect(store.state()).toEqual({ kind: 'authorisation-expired', account: ACCOUNT });
    });

    it('commits the local transaction before it sends the deletion', async () => {
      const { api, store, storage } = await signedIn();
      store.requestDeletion();

      await store.deleteAccount();

      // The one call, and the state storage held when it was made: account
      // gone, fleet cache gone, cursor and pending operations gone, and every
      // retained record marked local-only (020/FR-006, 020/FR-024).
      expect(api.calls).toEqual(['read-session', 'delete-account']);
      const atRequest = JSON.parse(api.storedAtDeletion ?? '{}') as CommanderLocalState;
      expect(atRequest.account).toBeNull();
      expect(atRequest.fleetCache).toEqual([]);
      expect(atRequest.accountCursors).toEqual({});
      expect(atRequest.pendingOperations).toEqual([]);
      expect(atRequest.recordBindings).toEqual({
        'record-1': 'local-only',
        'record-2': 'local-only',
      });

      expect(store.state()).toEqual({ kind: 'anonymous' });
      expect(stored(storage).recordBindings['record-1']).toBe('local-only');
    });

    it('marks the retained records of this account, and no other account’s', async () => {
      const seed: CommanderLocalState = {
        ...storedState(),
        accountCursors: { [ACCOUNT.customerId]: 42, [OTHER_CUSTOMER]: 7 },
        recordBindings: { 'record-1': ACCOUNT.customerId, 'record-3': OTHER_CUSTOMER },
        recordRevisions: { 'record-1': 41, 'record-3': 9 },
      };
      // Held: the account's own record, an unbound one whose upload never
      // completed, and one belonging to another Commander.
      const context = await signedIn(seed, ['record-1', 'record-2', 'record-3']);
      context.store.requestDeletion();

      await context.store.deleteAccount();

      const state = stored(context.storage);
      expect(state.recordBindings).toEqual({
        'record-1': 'local-only',
        'record-2': 'local-only',
        'record-3': OTHER_CUSTOMER,
      });
      expect(state.recordRevisions).toEqual({ 'record-3': 9 });
      expect(state.accountCursors).toEqual({ [OTHER_CUSTOMER]: 7 });
    });

    it('deletes nothing when the browser will not say which records it holds', async () => {
      const context = await signedIn();
      context.store.requestDeletion();
      context.storage.accessError = new DOMException('denied', 'SecurityError');

      await context.store.deleteAccount();

      // Marking nothing would leave the retained records eligible for the next
      // account that signs in, so the deletion is refused instead
      // (020/FR-024).
      expect(context.api.calls).not.toContain('delete-account');
      expect(context.store.state()).toEqual({ kind: 'delete-local-failed', account: ACCOUNT });
    });

    it('keeps the local result when the response is lost', async () => {
      const context = await signedIn();
      context.api.deletionAnswer = null;
      context.store.requestDeletion();

      await context.store.deleteAccount();

      expect(context.api.calls).toContain('delete-account');
      expect(context.store.state()).toEqual({ kind: 'anonymous' });
      expect(stored(context.storage).account).toBeNull();
      expect(stored(context.storage).pendingOperations).toEqual([]);
      expect(stored(context.storage).recordBindings).toEqual({
        'record-1': 'local-only',
        'record-2': 'local-only',
      });
    });

    it('keeps the local result when the service refuses the deletion', async () => {
      const context = await signedIn();
      context.api.deletionAnswer = false;
      context.store.requestDeletion();

      await context.store.deleteAccount();

      expect(context.store.state()).toEqual({ kind: 'anonymous' });
      expect(stored(context.storage).recordBindings['record-1']).toBe('local-only');
    });

    it('sends no deletion when the local transaction is refused', async () => {
      const context = await signedIn();
      context.store.requestDeletion();
      context.storage.writeError = quotaError();

      await context.store.deleteAccount();

      expect(context.api.calls).not.toContain('delete-account');
      expect(context.store.state()).toEqual({ kind: 'delete-local-failed', account: ACCOUNT });
      // Untouched: the account and its records are both still there.
      expect(stored(context.storage).account).toEqual(ACCOUNT);
      expect(stored(context.storage).accountCursors).toEqual({ [ACCOUNT.customerId]: 42 });
      expect(stored(context.storage).pendingOperations).toHaveLength(1);
      expect(stored(context.storage).recordBindings['record-1']).toBe(ACCOUNT.customerId);
    });

    it('leaves the account available for another attempt after a refused cleanup', async () => {
      const context = await signedIn();
      context.store.requestDeletion();
      context.storage.writeError = quotaError();
      await context.store.deleteAccount();

      context.storage.writeError = null;
      context.store.requestDeletion();
      expect(context.store.state()).toEqual({ kind: 'delete-confirmation', account: ACCOUNT });

      await context.store.deleteAccount();

      expect(context.api.calls).toContain('delete-account');
      expect(context.store.state()).toEqual({ kind: 'anonymous' });
      expect(stored(context.storage).recordBindings['record-1']).toBe('local-only');
    });

    it('stays open to say the browser is anonymous once the account is gone', async () => {
      const { store } = await signedIn();
      store.openDialog();
      store.requestDeletion();

      await store.deleteAccount();

      // The outcome is stated where the question was asked. A layer that closed
      // itself would leave a Commander with nothing said about what happened.
      expect(store.open()).toBe(true);
      expect(store.state()).toEqual({ kind: 'anonymous' });
    });

    it('deletes nothing for a browser that is not signed in', async () => {
      const { api, store } = setUp(null);
      await store.initialise();

      await store.deleteAccount();

      expect(api.calls).toEqual(['read-session']);
      expect(store.state()).toEqual({ kind: 'anonymous' });
    });
  });

  describe('the dialog it opens', () => {
    it('opens and closes on request', async () => {
      const { store } = await signedIn();

      store.openDialog();
      expect(store.open()).toBe(true);

      store.closeDialog();
      expect(store.open()).toBe(false);
    });

    it('settles a refused callback back to anonymous once it has been read', async () => {
      const { api, store } = setUp();
      api.callback = 'fresh-sign-in-required';
      await store.initialise();

      store.closeDialog();

      expect(store.state()).toEqual({ kind: 'anonymous' });
    });

    it('opens itself to say that Frontier authorisation has expired', async () => {
      const { store } = await signedIn();

      store.markAuthorisationExpired();

      expect(store.state()).toEqual({ kind: 'authorisation-expired', account: ACCOUNT });
      expect(store.open()).toBe(true);
    });

    it('keeps the credentials this browser’s own service still accepts', async () => {
      const { store } = await signedIn();

      store.markAuthorisationExpired();

      // Frontier is the fleet's alone. The record exchange reaches Nav Beacon,
      // whose session and anti-forgery token both still stand, so a save made
      // now still belongs to the account (020/FR-011, constitution IV).
      expect(store.credentials()).toEqual({
        customerId: ACCOUNT.customerId,
        antiForgeryToken: 'token-1',
      });
    });

    it('empties the credentials once the session itself has ended', async () => {
      const context = await signedIn();
      context.api.session = { kind: 'anonymous' };

      await context.store.refreshSession();

      expect(context.store.credentials()).toBeNull();
    });

    it('opens itself when a sign-in comes back from Frontier', async () => {
      const { api, store } = setUp(null);
      api.callback = 'signed-in';
      api.session = SIGNED_IN;

      await store.initialise();

      expect(store.state()).toEqual({ kind: 'signed-in', account: ACCOUNT });
      expect(store.open()).toBe(true);
    });
  });
});
