import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { relationId } from '../../a11y/text-equivalence';
import { FitText } from '../fit-text/fit-text';

/**
 * One measured value.
 *
 * Every field except `label` and `value` is optional, and every one of them
 * exists because a bare number is not a fact. "12.4" means nothing without its
 * unit; a jump range means nothing without knowing whether it was measured
 * laden or unladen.
 *
 * `value` is already formatted for the active locale — the component never
 * formats, because deciding precision is not a presentation concern.
 */
export interface Metric {
  readonly id: string;
  /** What is being measured. */
  readonly label: string;
  /** The formatted value, or `null` when it is unavailable. */
  readonly value: string | null;
  /** The unit the value is in. */
  readonly unit?: string;
  /** The condition it was measured under, when that changes what it means. */
  readonly condition?: string;
  /** Supporting explanation, programmatically associated with the value. */
  readonly description?: string;
  /** Shown in place of the value when it is unavailable. Never a zero. */
  readonly unavailableLabel?: string;
}

/**
 * A group of measured values.
 *
 * A description list, because that is exactly the relationship: each term names
 * something and each definition is its value. A grid of divs would lose the
 * pairing that lets a reader move term by term.
 */
@Component({
  selector: 'ednb-metric-group',
  imports: [FitText],
  templateUrl: './metric-group.html',
  styleUrl: './metric-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.metric-group--flow]': 'flow()',
    '[class.metric-group--dense]': 'dense()',
    '[class.metric-group--fit]': 'fitLabels()',
  },
})
export class MetricGroup {
  /** What the group of metrics describes. */
  readonly label = input.required<string>();
  readonly metrics = input.required<readonly Metric[]>();
  readonly emptyLabel = input<string | null>(null);

  /**
   * Whether this group's cells join a grid an ancestor owns.
   *
   * The canvas draws the status rail's cells as one grid on one hairline
   * ground, and four separate features own two, one, three and two of them. Set
   * here, the group stops laying its own grid and lets its cells fall into the
   * rail's — so they sit in one grid without any feature having to know what
   * the others contribute. The group keeps its list and its name either way:
   * a reader still meets one named group of terms and definitions per feature.
   */
  readonly flow = input(false);

  /**
   * Whether the cells are drawn at canvas 1c's tighter padding.
   *
   * The anatomy analysis panels draw their tiles 6 by 8 pixels, in place of
   * 12 all round. Nothing else about the group changes.
   */
  readonly dense = input(false);

  /**
   * Whether each label is drawn through `ednb-fit-text`.
   *
   * The caller then holds the labels on one line by setting
   * `white-space: nowrap` on this element, and a label that does not fit is cut
   * with a reachable `…`. The values and descriptions keep their own wrapping,
   * so a figure is never cut. Where the caller sets nothing, the labels wrap as
   * they do without it.
   */
  readonly fitLabels = input(false);

  readonly groupId = relationId('metric-group');

  descriptionId(id: string): string {
    return `${this.groupId}-${id}-description`;
  }

  unitId(id: string): string {
    return `${this.groupId}-${id}-unit`;
  }

  conditionId(id: string): string {
    return `${this.groupId}-${id}-condition`;
  }

  /** The ids that explain a value, so it is never a number on its own. */
  describedBy(metric: Metric): string | null {
    const ids = [
      metric.unit ? this.unitId(metric.id) : null,
      metric.condition ? this.conditionId(metric.id) : null,
      metric.description ? this.descriptionId(metric.id) : null,
    ].filter((id): id is string => id !== null);

    return ids.length > 0 ? ids.join(' ') : null;
  }
}
