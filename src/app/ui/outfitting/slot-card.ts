import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { SlotCapabilities } from '../../application/outfitting/outfitting-state';
import type { SlotView } from '../../application/outfitting/slot-view';
import type { MessageKey } from '../../i18n/locale-registry';
import { MessageService } from '../../i18n/message.service';
import { relationId } from '../a11y/text-equivalence';
import { AcquisitionBadge } from './acquisition-badge';
import { ModuleIdentityBadge } from './module-identity-badge';
import { PowerControls, type PowerIntent } from './power-controls';

/** What a card asks the workspace to do. Deciding whether it happens is not its job. */
export type SlotCardIntent =
  | { readonly kind: 'select' }
  | { readonly kind: 'replace' }
  | { readonly kind: 'engineer' }
  | { readonly kind: 'remove' }
  | PowerIntent;

/**
 * One mount in the ledger.
 *
 * The canvas draws a row: a size number, a node badge for hardpoints, the
 * module's name over its code line, an engineered marker, and a power-priority
 * control. This renders exactly that, with three changes the reference cannot
 * make for itself.
 *
 * **The row is not a control.** The canvas's row is a clickable `div` wrapped
 * around a clickable priority `div`, which is a control inside a control — a
 * reader cannot tell which one they are on and a pointer cannot reliably hit
 * the inner one. Selection, replacement and power are separate named controls
 * instead (reference review, "Interaction and semantics").
 *
 * **The slot key is not visible text.** Neither canvas draws one; they draw
 * `SIZE · NODE NO.`. The exact key is the identity everything else uses, so it
 * is carried as `visually-hidden` text and as a `data-slot-key` attribute the
 * anatomy exchanges — the invisible accessibility floor, not an addition to the
 * design (reference review, "Visible slot key").
 *
 * **The engineered marker is not an icon alone.** The canvas uses a small
 * glyph; a glyph is not readable and disappears in forced colours, so the
 * engineering is also stated in the code line where the canvas already writes
 * `OVERCHARGED G5` (FR-010 of feature 011).
 */
@Component({
  selector: 'ednb-slot-card',
  imports: [AcquisitionBadge, ModuleIdentityBadge, PowerControls],
  templateUrl: './slot-card.html',
  styleUrl: './slot-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlotCard {
  readonly #messages = inject(MessageService);

  readonly slot = input.required<SlotView>();
  readonly capabilities = input.required<SlotCapabilities>();
  readonly selected = input(false);

  /**
   * Whether the row is drawn at canvas 1c's dense measure.
   *
   * The workspace sets it where the ledger is the inline rail beside the bench.
   * A dense row is the 36-pixel target with the smaller size box and node
   * badge, and it draws the class and rating as a chip beside the name.
   */
  readonly dense = input(false);

  /** The engineering summary the code line carries, already localized. */
  readonly engineeringSummary = input<string | null>(null);

  readonly intent = output<SlotCardIntent>();

  readonly identityId = relationId('slot-identity');

  /** The drawn label: kind, size and, for a hardpoint, the node number. */
  readonly drawnLabel = computed(() => {
    const slot = this.slot();
    const kind = this.#messages.message(kindKey(slot.kind));
    const size =
      slot.size === null
        ? null
        : this.#messages.message('outfitting.slot.size', {
            size: slot.size,
          });
    // Spoken wherever it is drawn, so a reader is told the mount's number on the
    // hull anatomy for the same mounts a sighted Commander can read it off.
    const node =
      this.nodeKind() === null
        ? null
        : this.#messages.message('outfitting.slot.node', { node: slot.node });
    return [kind, size, node].filter((part): part is string => part !== null).join(' · ');
  });

  /** The exact game slot key, for assistive technology only. */
  readonly identityText = computed(() =>
    this.#messages.message('outfitting.slot.identity', { slot: this.slot().key }),
  );

  /**
   * Which mounts carry a node number, and in whose ink.
   *
   * The two kinds the hull anatomy draws on the hull, and only those: a node
   * number is a pointer at that drawing, and there is nothing on it to point at
   * for a power plant or a cargo rack.
   */
  readonly nodeKind = computed<'hardpoint' | 'utility' | null>(() => {
    const kind = this.slot().kind;
    return kind === 'hardpoint' || kind === 'utility' ? kind : null;
  });

  readonly emptyLabel = this.#messages.messageSignal('outfitting.slot.empty');
  readonly engineeredLabel = this.#messages.messageSignal('outfitting.slot.engineered');
  readonly selectedLabel = this.#messages.messageSignal('outfitting.slot.selected');
  readonly replaceLabel = this.#messages.messageSignal('outfitting.capability.replace');
  readonly engineerLabel = this.#messages.messageSignal('outfitting.capability.engineer');
  readonly removeLabel = this.#messages.messageSignal('outfitting.capability.remove');

  /**
   * The module's name, for the power controls to name what they act on.
   *
   * A ledger is forty rows of the same two controls, so "powered" on its own
   * says nothing about which module. Falls back to the mount's own label where
   * the package resolves no name, rather than to a bare symbol.
   */
  readonly moduleLabel = computed(() => this.slot().module?.displayName.text ?? this.drawnLabel());

  /**
   * True where the package offers power on this mount at all.
   *
   * A module the Almanac prices at no power draw — armour, a fuel tank — has
   * nothing to power and nothing to group, and the canvas draws no chip on one.
   * An article whose draw the Almanac does not publish keeps its controls: not
   * knowing a figure is not the same as knowing it is zero (constitution IV).
   */
  readonly showsPower = computed(() => {
    const module = this.slot().module;
    if (module === null) {
      return false;
    }

    // A module the Almanac resolves and prices at no power draw — armour, a
    // fuel tank — has nothing to power and nothing to group. An article it
    // cannot resolve at all keeps its controls: not having read a figure is
    // not the same as having read a zero (constitution IV).
    const article = module.effectiveArticle ?? module.article;
    if (article != null && !(typeof article.powerDraw === 'number' && article.powerDraw > 0)) {
      return false;
    }
    return this.capabilities().canSetEnabled || this.capabilities().canSetPriority;
  });

  emit(intent: SlotCardIntent): void {
    this.intent.emit(intent);
  }

  /**
   * Empties the mount from the row, on the secondary pointer button.
   *
   * Only the secondary button, and only where the package accepts the removal.
   * A long press reports `button` 0 rather than 2, so touch keeps its own menu
   * and no mount is emptied by a press that was meant to select it. A mount the
   * package refuses to empty, and an empty one, keep the platform's menu too.
   */
  removeFromPointer(event: MouseEvent): void {
    if (event.button !== 2 || this.slot().module === null || !this.capabilities().canRemove) {
      return;
    }
    event.preventDefault();
    this.emit({ kind: 'remove' });
  }
}

/** The heading a mount kind sits under. */
function kindKey(kind: SlotView['kind']): MessageKey {
  return (
    {
      hardpoint: 'outfitting.group.hardpoint',
      utility: 'outfitting.group.utility',
      armour: 'outfitting.group.armour',
      core: 'outfitting.group.core',
      optional: 'outfitting.group.optional',
      cargoHatch: 'outfitting.group.cargoHatch',
    } as const
  )[kind];
}
