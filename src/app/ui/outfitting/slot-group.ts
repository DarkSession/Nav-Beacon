import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { SlotView } from '../../application/outfitting/slot-view';
import type { MessageKey } from '../../i18n/locale-registry';
import { MessageService } from '../../i18n/message.service';
import { relationId } from '../a11y/text-equivalence';

/** One kind of mount, and the mounts of that kind, in package order. */
export interface SlotGroupView {
  readonly kind: SlotView['kind'];
  readonly slots: readonly SlotView[];
}

/**
 * The ledger's kind headings and the lists beneath them.
 *
 * The canvas rules a heading across the region — `HARDPOINTS`, `CORE
 * INTERNALS`, `OPTIONAL INTERNALS` — with the mount count at its trailing edge,
 * and lists the mounts below it. This is that, as a heading and a real list,
 * because a reader moving by heading and by list item is exactly the movement
 * the visual grouping affords a sighted one.
 *
 * Order is never touched here. The groups arrive in the order the ledger built
 * them, which is the package's own outfitting order with the cargo hatch moved
 * above the optional mounts (002/FR-002a).
 */
@Component({
  selector: 'ednb-slot-group',
  templateUrl: './slot-group.html',
  styleUrl: './slot-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlotGroup {
  readonly #messages = inject(MessageService);

  readonly group = input.required<SlotGroupView>();

  /**
   * Whether the group's rows are canvas 1c's dense rows.
   *
   * The rule then stands 4 pixels clear of its first row and is inset 14
   * pixels, the dense rows' own inset. Canvas 1c draws `0 14px 5px`, and the
   * spacing scale has no 5.
   */
  readonly dense = input(false);

  readonly headingId = relationId('slot-group-heading');

  readonly heading = computed(() => this.#messages.message(headingKey(this.group().kind)));

  readonly count = computed(() =>
    this.#messages.message('outfitting.category.count', { count: this.group().slots.length }),
  );

  /** The canvas's `SIZE · NODE NO.`, on the one group whose rows carry both. */
  readonly columns = computed(() =>
    this.group().kind === 'hardpoint'
      ? this.#messages.message('outfitting.column.size-node')
      : null,
  );
}

/** The heading one mount kind sits under. */
function headingKey(kind: SlotView['kind']): MessageKey {
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
