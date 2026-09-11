import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { OwnedShipsView } from '../../application/fleet/fleet.presenter';
import { relationId } from '../../ui/a11y/text-equivalence';
import { ActionButton } from '../../ui/components/action/action-button';
import { Collection, type CollectionItem } from '../../ui/components/collection/collection';
import { FactList } from '../../ui/components/fact-list/fact-list';
import { StatusNotice } from '../../ui/components/status/status-notice';

/**
 * The ships a Commander owns, inside the stored-build layer.
 *
 * One region in one reading order at every width: what the fleet is, what
 * journal history it was read from, the ships themselves, the facts of the one
 * chosen, and what can be done — refresh, or take a copy into the builder.
 *
 * An owned ship is read-only. Nothing here edits one; the copy action asks for
 * a separate saved build with its own identity, which is the only way a fleet
 * entry reaches the planning tools (020/FR-017).
 *
 * Every state states itself in words. The tone of a notice is a second
 * rendering of the sentence and never the only one, so nothing here is carried
 * by colour (011/FR-010).
 *
 * Presentation only: it takes a finished view model and emits intent. What the
 * fleet is and what a refresh answered are decided above it (constitution III).
 */
@Component({
  selector: 'ednb-owned-ships-panel',
  imports: [ActionButton, Collection, FactList, StatusNotice],
  templateUrl: './owned-ships-panel.component.html',
  styleUrl: './owned-ships-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnedShipsPanel {
  readonly view = input.required<OwnedShipsView>();

  readonly refreshRequested = output<void>();
  readonly signInRequested = output<void>();
  readonly copyRequested = output<void>();
  /** Frontier's own ship identity, as the row carries it. */
  readonly shipChosen = output<string>();

  // Named per instance rather than by a literal. The preview catalogue renders
  // several states of this panel at once, and two elements sharing an id would
  // name one state's region from another state's heading.
  readonly headingId = relationId('fleet-heading');
  readonly refusalId = relationId('fleet-refusal');

  readonly items = computed<readonly CollectionItem[]>(() =>
    this.view().ships.map((ship) => ({
      id: ship.id,
      label: ship.label,
      detail: ship.detail,
      activatable: true,
      selected: ship.selected,
    })),
  );
}
