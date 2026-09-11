import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountPresenter } from './account.presenter';
import { AccountStore, type AccountState } from './account.store';
import { provideLocalization } from '../../i18n/i18n.providers';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import { DocumentAdapter } from '../../platform/browser/document.adapter';
import {
  COMMANDER_API,
  type CommanderApiPort,
  type CommanderSessionResult,
} from '../../platform/network/commander-api';
import { MemoryStorage, provideMemoryStorage } from '../../platform/storage/storage.spec-helpers';

const ACCOUNT = { customerId: '900001', commanderName: 'CMDR Jameson' };

/** A service that answers nothing: the presenter is driven by state, not by it. */
class SilentCommanderApi implements CommanderApiPort {
  readonly calls: string[] = [];

  callbackResult(): null {
    return null;
  }

  async startSignIn(): Promise<boolean> {
    this.calls.push('start-sign-in');
    return true;
  }

  async readSession(): Promise<CommanderSessionResult> {
    this.calls.push('read-session');
    return { kind: 'anonymous' };
  }

  async signOut(): Promise<boolean> {
    this.calls.push('sign-out');
    return true;
  }

  async deleteAccount(): Promise<boolean> {
    this.calls.push('delete-account');
    return true;
  }
}

/** A document adapter that records nothing — this is not a locale test. */
class SilentDocumentAdapter {
  commitRootState(): void {}
}

/** Every state the store can hold, named as the screen inventory names it. */
const STATES: readonly { readonly name: string; readonly state: AccountState }[] = [
  { name: 'anonymous', state: { kind: 'anonymous' } },
  { name: 'loading', state: { kind: 'loading' } },
  { name: 'redirect pending', state: { kind: 'redirect-pending' } },
  { name: 'correlation refused', state: { kind: 'correlation-refused' } },
  { name: 'signed in', state: { kind: 'signed-in', account: ACCOUNT } },
  { name: 'offline', state: { kind: 'offline', account: ACCOUNT } },
  { name: 'expired session', state: { kind: 'session-expired' } },
  { name: 'expired authorisation', state: { kind: 'authorisation-expired', account: ACCOUNT } },
  { name: 'sign-out', state: { kind: 'signing-out', account: ACCOUNT } },
  { name: 'refused sign-out', state: { kind: 'sign-out-failed', account: ACCOUNT } },
  {
    name: 'account-deletion confirmation',
    state: { kind: 'delete-confirmation', account: ACCOUNT },
  },
  { name: 'deleting', state: { kind: 'deleting' } },
  { name: 'refused local cleanup', state: { kind: 'delete-local-failed', account: ACCOUNT } },
];

/**
 * A store held at one state.
 *
 * The presenter reads a signal, so a fake store is the smallest thing that can
 * hold every state at once, including the ones the real store only passes
 * through.
 */
class StubStore {
  readonly #state = signal<AccountState>({ kind: 'anonymous' });

  readonly state = this.#state.asReadonly();
  readonly open = signal(false).asReadonly();

  set(state: AccountState): void {
    this.#state.set(state);
  }
}

function setUp() {
  const store = new StubStore();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      { provide: DocumentAdapter, useValue: new SilentDocumentAdapter() },
      { provide: AccountStore, useValue: store },
    ],
  });
  return { store, presenter: TestBed.inject(AccountPresenter) };
}

/** The real store, for the intents the presenter forwards to it. */
function withRealStore() {
  const api = new SilentCommanderApi();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      { provide: DocumentAdapter, useValue: new SilentDocumentAdapter() },
      ...provideMemoryStorage(new MemoryStorage()),
      { provide: COMMANDER_API, useValue: api },
    ],
  });
  return { api, presenter: TestBed.inject(AccountPresenter), store: TestBed.inject(AccountStore) };
}

describe('AccountPresenter', () => {
  describe('the frame action', () => {
    it('is named for the account before a Commander signs in', () => {
      const { presenter } = setUp();

      expect(presenter.actionLabel()).toBe(BUNDLED_ENGLISH['account.action']);
      expect(presenter.actionDescription()).toBe(BUNDLED_ENGLISH['account.action.description']);
    });

    it('is named for the Commander once there is one', () => {
      const { store, presenter } = setUp();
      store.set({ kind: 'signed-in', account: ACCOUNT });

      expect(presenter.actionLabel()).toBe(ACCOUNT.commanderName);
      expect(presenter.actionDescription()).toContain(ACCOUNT.commanderName);
    });

    it('never draws the Customer ID, which a Commander did not choose to publish', () => {
      const { store, presenter } = setUp();
      store.set({ kind: 'signed-in', account: ACCOUNT });

      expect(presenter.actionLabel()).not.toContain(ACCOUNT.customerId);
      expect(presenter.actionDescription()).not.toContain(ACCOUNT.customerId);
      expect(JSON.stringify(presenter.view())).not.toContain(ACCOUNT.customerId);
    });
  });

  describe('every state', () => {
    it('says what the session is doing, in the catalogue’s own words', () => {
      const { store, presenter } = setUp();

      for (const { name, state } of STATES) {
        store.set(state);
        const status = presenter.view().status;

        expect(status?.message, name).toBe(BUNDLED_ENGLISH[`account.status.${state.kind}`]);
        expect(status?.message, name).not.toBe(BUNDLED_ENGLISH['message.unavailable']);
      }
    });

    it('states the same account data use in each of them', () => {
      const { store, presenter } = setUp();

      for (const { name, state } of STATES) {
        store.set(state);
        const view = presenter.view();

        expect(view.dataUse, name).toEqual([
          BUNDLED_ENGLISH['account.data.identity'],
          BUNDLED_ENGLISH['account.data.credentials'],
          BUNDLED_ENGLISH['account.data.records'],
          BUNDLED_ENGLISH['account.data.fleet'],
          BUNDLED_ENGLISH['account.data.frontier'],
          BUNDLED_ENGLISH['account.data.destination'],
        ]);
        expect(view.dataUseTitle, name).toBe(BUNDLED_ENGLISH['account.data.title']);
        expect(view.networkNotice, name).toBe(BUNDLED_ENGLISH['account.network.notice']);
      }
    });

    it('offers sign-in wherever signing in is what a Commander can do next', () => {
      const { store, presenter } = setUp();

      for (const kind of [
        'anonymous',
        'correlation-refused',
        'session-expired',
        'authorisation-expired',
      ] as const) {
        store.set(
          kind === 'authorisation-expired'
            ? { kind, account: ACCOUNT }
            : ({ kind } as AccountState),
        );

        expect(
          presenter.view().actions.map((action) => [action.kind, action.label]),
          kind,
        ).toEqual([['sign-in', BUNDLED_ENGLISH['account.sign-in']]]);
      }
    });

    it('offers sign-out beside deletion while there is an account to act on', () => {
      const { store, presenter } = setUp();

      for (const kind of ['signed-in', 'sign-out-failed', 'delete-local-failed'] as const) {
        store.set({ kind, account: ACCOUNT });

        expect(
          presenter.view().actions.map((action) => [action.kind, action.emphasis]),
          kind,
        ).toEqual([
          ['sign-out', 'secondary'],
          ['delete', 'danger'],
        ]);
      }
    });

    it('offers another attempt while the service cannot be reached', () => {
      const { store, presenter } = setUp();
      store.set({ kind: 'offline', account: ACCOUNT });

      expect(presenter.view().actions).toEqual([
        { kind: 'retry', label: BUNDLED_ENGLISH['action.retry'], emphasis: 'primary', busy: false },
      ]);
    });

    it('reports the running sign-out as busy without renaming it', () => {
      const { store, presenter } = setUp();
      store.set({ kind: 'signing-out', account: ACCOUNT });
      const view = presenter.view();

      expect(view.actions).toEqual([
        {
          kind: 'sign-out',
          label: BUNDLED_ENGLISH['account.sign-out'],
          emphasis: 'secondary',
          busy: true,
        },
      ]);
      expect(view.busyLabel).toBe(BUNDLED_ENGLISH['action.busy']);
    });

    it('offers nothing to press while a redirect or a deletion is under way', () => {
      const { store, presenter } = setUp();

      for (const kind of ['loading', 'redirect-pending', 'deleting'] as const) {
        store.set({ kind });

        expect(presenter.view().actions, kind).toEqual([]);
      }
    });

    it('raises the confirmation layer for the deletion question alone', () => {
      const { store, presenter } = setUp();

      for (const { name, state } of STATES) {
        store.set(state);

        expect(presenter.view().deletionConfirmation, name).toBe(
          state.kind === 'delete-confirmation',
        );
      }
    });

    it('names the Commander in every state that still has an account', () => {
      const { store, presenter } = setUp();

      for (const { name, state } of STATES) {
        store.set(state);
        const expected = 'account' in state ? ACCOUNT.commanderName : null;

        expect(presenter.view().commanderName, name).toBe(expected);
      }
    });
  });

  describe('the intents it forwards', () => {
    it('asks the store to sign in, sign out, delete and try again', async () => {
      const { api, presenter, store } = withRealStore();

      presenter.select('sign-in');
      presenter.select('retry');
      await Promise.resolve();

      expect(api.calls).toContain('start-sign-in');
      expect(api.calls).toContain('read-session');

      presenter.select('delete');
      // Nothing to delete while the browser is anonymous, so the question is
      // not asked: the store owns that decision, not the presenter.
      expect(store.state().kind).not.toBe('delete-confirmation');
    });

    it('opens and closes the dialog through the store', () => {
      const { presenter, store } = withRealStore();

      presenter.openDialog();
      expect(store.open()).toBe(true);

      presenter.closeDialog();
      expect(store.open()).toBe(false);
    });

    it('reads the session once when the session starts', async () => {
      const { api, presenter } = withRealStore();

      presenter.initialise();
      await Promise.resolve();
      await Promise.resolve();

      expect(api.calls).toEqual(['read-session']);
    });

    it('confirms and cancels the deletion through the store', async () => {
      const { presenter, store } = withRealStore();

      presenter.confirmDeletion();
      presenter.cancelDeletion();
      await Promise.resolve();

      // Both are no-ops for a browser with no account, which is the point: the
      // presenter forwards the intent and decides nothing.
      expect(store.state().kind).toBe('loading');
    });
  });
});
