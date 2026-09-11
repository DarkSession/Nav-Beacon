import { Injectable, computed, inject } from '@angular/core';
import { MessageService } from '../../i18n/message.service';
import type { StatusTone } from '../../ui/components/status/status-notice';
import { AccountStore, type AccountState } from './account.store';

export interface AccountDialogAction {
  readonly label: string;
  readonly kind: 'sign-in' | 'sign-out' | 'delete' | 'retry';
  readonly emphasis: 'primary' | 'secondary' | 'danger';
  readonly busy: boolean;
}

export interface AccountDialogView {
  readonly title: string;
  readonly commanderLabel: string;
  readonly commanderName: string | null;
  readonly status: { readonly tone: StatusTone; readonly message: string } | null;
  readonly dataUseTitle: string;
  readonly dataUse: readonly string[];
  readonly networkNotice: string;
  readonly actions: readonly AccountDialogAction[];
  /** What a reader is told beside an action's own name while it runs. */
  readonly busyLabel: string;
  readonly deletionConfirmation: boolean;
  readonly deletionTitle: string;
  readonly deletionDescription: string;
  readonly deletionConfirm: string;
  readonly deletionCancel: string;
  readonly dismiss: string;
}

/**
 * The account dialog and its frame action, as a Commander reads them.
 *
 * One view model for eight states, so the dialog draws the same regions in the
 * same order whatever the session is doing: who is signed in, what the session
 * state is, what the account holds, what needs a network, and what can be done
 * about it. A state that has nothing to say in a region omits the region rather
 * than moving the ones around it.
 *
 * Presentation only. Every decision about what the account *is* belongs to the
 * store below it (constitution III).
 */
@Injectable({ providedIn: 'root' })
export class AccountPresenter {
  readonly #messages = inject(MessageService);
  readonly store = inject(AccountStore);

  readonly open = this.store.open;

  /**
   * What the frame action is called.
   *
   * The Commander's own name once there is one, which is what a bar carrying an
   * account says everywhere else in this application, and the account's own
   * name before that. The name is Frontier's display value and never the
   * Customer ID, which is an identifier a Commander did not choose to publish.
   */
  readonly actionLabel = computed(
    () => accountName(this.store.state()) ?? this.#messages.message('account.action'),
  );

  /** What activating it would do, said only to a reader. */
  readonly actionDescription = computed(() => {
    const name = accountName(this.store.state());
    return name === null
      ? this.#messages.message('account.action.description')
      : this.#messages.message('account.action.signed-in.description', { name });
  });

  readonly view = computed<AccountDialogView>(() => {
    const state = this.store.state();
    return {
      title: this.#messages.message('account.title'),
      commanderLabel: this.#messages.message('account.commander.label'),
      commanderName: accountName(state),
      status: this.#status(state),
      dataUseTitle: this.#messages.message('account.data.title'),
      // The exact account data use, stated where the account is offered rather
      // than in a document a Commander would have to go and find (020/FR-005).
      dataUse: [
        this.#messages.message('account.data.identity'),
        this.#messages.message('account.data.credentials'),
        this.#messages.message('account.data.records'),
        this.#messages.message('account.data.fleet'),
        this.#messages.message('account.data.frontier'),
        this.#messages.message('account.data.destination'),
      ],
      // Which of these actions need a network, said before one is pressed and
      // whether or not there is a network right now (020/FR-022).
      networkNotice: this.#messages.message('account.network.notice'),
      actions: this.#actions(state),
      busyLabel: this.#messages.message('action.busy'),
      deletionConfirmation: state.kind === 'delete-confirmation',
      deletionTitle: this.#messages.message('account.delete.title'),
      deletionDescription: this.#messages.message('account.delete.description'),
      deletionConfirm: this.#messages.message('account.delete.confirm'),
      deletionCancel: this.#messages.message('action.cancel'),
      dismiss: this.#messages.message('action.close'),
    };
  });

  /** Reads the session once, at the start of a browser session. */
  initialise(): void {
    void this.store.initialise();
  }

  openDialog(): void {
    this.store.openDialog();
  }

  closeDialog(): void {
    this.store.closeDialog();
  }

  confirmDeletion(): void {
    void this.store.deleteAccount();
  }

  cancelDeletion(): void {
    this.store.cancelDeletion();
  }

  select(kind: AccountDialogAction['kind']): void {
    if (kind === 'sign-in') {
      void this.store.startSignIn();
    } else if (kind === 'sign-out') {
      void this.store.signOut();
    } else if (kind === 'delete') {
      this.store.requestDeletion();
    } else {
      void this.store.refreshSession();
    }
  }

  #status(state: AccountState): AccountDialogView['status'] {
    const key = `account.status.${state.kind}` as const;
    return { tone: TONES[state.kind], message: this.#messages.message(key) };
  }

  #actions(state: AccountState): readonly AccountDialogAction[] {
    switch (state.kind) {
      case 'anonymous':
      case 'correlation-refused':
      case 'session-expired':
      case 'authorisation-expired':
        return [this.#action('account.sign-in', 'sign-in', 'primary')];
      case 'offline':
        return [this.#action('action.retry', 'retry', 'primary')];
      case 'signed-in':
      case 'sign-out-failed':
      case 'delete-local-failed':
        return [
          this.#action('account.sign-out', 'sign-out', 'secondary'),
          this.#action('account.delete.action', 'delete', 'danger'),
        ];
      case 'signing-out':
        return [this.#action('account.sign-out', 'sign-out', 'secondary', true)];
      default:
        return [];
    }
  }

  #action(
    label: Parameters<MessageService['message']>[0],
    kind: AccountDialogAction['kind'],
    emphasis: AccountDialogAction['emphasis'],
    busy = false,
  ): AccountDialogAction {
    return { label: this.#messages.message(label), kind, emphasis, busy };
  }
}

/**
 * The tone each state's notice carries.
 *
 * Stated once per state rather than derived, so a state added to the store has
 * to say how it reads. Tone is a second rendering of what the sentence already
 * says, never the only carrier of it (011/FR-010).
 */
const TONES: Readonly<Record<AccountState['kind'], StatusTone>> = {
  anonymous: 'info',
  loading: 'loading',
  'redirect-pending': 'loading',
  'correlation-refused': 'warning',
  'signed-in': 'success',
  offline: 'warning',
  'session-expired': 'warning',
  'authorisation-expired': 'warning',
  'signing-out': 'loading',
  'sign-out-failed': 'error',
  'delete-confirmation': 'warning',
  deleting: 'loading',
  'delete-local-failed': 'error',
};

function accountName(state: AccountState): string | null {
  return 'account' in state ? (state.account?.commanderName ?? null) : null;
}
