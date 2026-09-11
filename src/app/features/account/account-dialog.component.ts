import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type {
  AccountDialogAction,
  AccountDialogView,
} from '../../application/account/account.presenter';
import { ActionButton } from '../../ui/components/action/action-button';
import { ConfirmDialog } from '../../ui/components/confirm-dialog/confirm-dialog';
import { Layer } from '../../ui/components/layer/layer';
import { StatusNotice } from '../../ui/components/status/status-notice';

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
}
