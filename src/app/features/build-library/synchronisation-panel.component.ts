import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ConflictChoice } from '../../domain/commander/record-conflict';
import type { SynchronisationPanelView } from '../../application/synchronisation/synchronisation.presenter';
import { relationId } from '../../ui/a11y/text-equivalence';
import { ActionButton } from '../../ui/components/action/action-button';
import { Layer } from '../../ui/components/layer/layer';
import { StatusNotice } from '../../ui/components/status/status-notice';

/**
 * What the record library says about the Commander's account.
 *
 * One region in one reading order at every width: where the records are, what
 * is still owed, what needs an answer — and, over the library, the layer that
 * asks the one question a Commander has to answer themselves.
 *
 * Every state states itself in words. The tone of a notice is a second
 * rendering of the sentence and never the only one, so nothing here is carried
 * by colour (011/FR-010).
 *
 * Presentation only: it takes a finished view model and emits intent. What the
 * account is doing, and what each answer means for a record, are decided above
 * it (constitution III).
 */
@Component({
  selector: 'ednb-synchronisation-panel',
  imports: [ActionButton, Layer, StatusNotice],
  templateUrl: './synchronisation-panel.component.html',
  styleUrl: './synchronisation-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SynchronisationPanel {
  readonly view = input.required<SynchronisationPanelView>();

  readonly retryRequested = output<void>();
  readonly answered = output<ConflictChoice>();
  readonly conflictDismissed = output<void>();

  // Named per instance rather than by a literal. The preview catalogue renders
  // several states of this panel at once, and two elements sharing an id would
  // name one state's region from another state's heading.
  readonly headingId = relationId('synchronisation-heading');
}
