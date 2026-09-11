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
  readonly commanderName: string | null;
  readonly status: { readonly tone: StatusTone; readonly message: string } | null;
  readonly dataUse: readonly string[];
  readonly actions: readonly AccountDialogAction[];
  readonly deletionConfirmation: boolean;
  readonly deletionTitle: string;
  readonly deletionDescription: string;
  readonly deletionConfirm: string;
  readonly deletionCancel: string;
  readonly dismiss: string;
}

@Injectable({ providedIn: 'root' })
export class AccountPresenter {
  readonly #messages = inject(MessageService);
  readonly store = inject(AccountStore);

  readonly open = this.store.open;
  readonly actionLabel = computed(
    () => accountName(this.store.state()) ?? this.#messages.message('account.action'),
  );
  readonly actionDescription = computed(() => this.#messages.message('account.action.description'));
  readonly view = computed<AccountDialogView>(() => {
    const state = this.store.state();
    return {
      title: this.#messages.message('account.title'),
      commanderName: accountName(state),
      status: this.#status(state),
      dataUse: [
        this.#messages.message('account.data.identity'),
        this.#messages.message('account.data.credentials'),
        this.#messages.message('account.data.records'),
        this.#messages.message('account.data.fleet'),
        this.#messages.message('account.data.frontier'),
      ],
      actions: this.#actions(state),
      deletionConfirmation: state.kind === 'delete-confirmation',
      deletionTitle: this.#messages.message('account.delete.title'),
      deletionDescription: this.#messages.message('account.delete.description'),
      deletionConfirm: this.#messages.message('account.delete.confirm'),
      deletionCancel: this.#messages.message('action.cancel'),
      dismiss: this.#messages.message('action.close'),
    };
  });

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
    const tone: StatusTone =
      state.kind === 'signed-in'
        ? 'success'
        : state.kind === 'loading' || state.kind === 'redirect-pending' || state.kind === 'deleting'
          ? 'info'
          : state.kind === 'anonymous'
            ? 'info'
            : 'warning';
    return { tone, message: this.#messages.message(key) };
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

function accountName(state: AccountState): string | null {
  return 'account' in state ? (state.account?.commanderName ?? null) : null;
}
