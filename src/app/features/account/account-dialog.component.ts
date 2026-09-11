import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type {
  AccountDialogAction,
  AccountDialogView,
} from '../../application/account/account.presenter';
import { relationId } from '../../ui/a11y/text-equivalence';
import { ActionButton } from '../../ui/components/action/action-button';
import { ConfirmDialog } from '../../ui/components/confirm-dialog/confirm-dialog';
import { Layer } from '../../ui/components/layer/layer';
import { StatusNotice } from '../../ui/components/status/status-notice';

/**
 * The one Commander account modal, opened from the frame's account action.
 *
 * Four regions in one reading order at every width: who is signed in, what the
 * session is doing, what the account holds, and what can be done about it. The
 * account-deletion question is the shared confirmation layer rather than a
 * second set of buttons in this one, so the destructive answer is behind a
 * layer of its own and a dismissal is always a cancel.
 *
 * Presentation only: it takes a finished view model and emits intent. Which
 * state the session is in and what each action means are decided above it
 * (constitution III).
 *
 * Wide and narrow are not two components. The shared layer resolves its
 * adaptive presentation in CSS, so the same DOM is a centred bounded dialog
 * where there is room and a full-width sheet where there is not, and a reader
 * meets one reading order either way.
 */
@Component({
  selector: 'ednb-account-dialog',
  imports: [ActionButton, ConfirmDialog, Layer, StatusNotice],
  templateUrl: './account-dialog.component.html',
  styleUrl: './account-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDialog {
  readonly open = input(false);
  readonly view = input.required<AccountDialogView>();

  readonly dismissed = output<void>();
  readonly actionSelected = output<AccountDialogAction['kind']>();
  readonly deletionConfirmed = output<void>();
  readonly deletionCancelled = output<void>();

  // Named per instance rather than by a literal. The preview catalogue renders
  // several states of this dialog, and two elements sharing an id would name
  // one state's list from another state's heading.
  readonly dataUseId = relationId('account-data-use');
}
