import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CapacitorKind } from '../../../../domain/ships/power-heat/power-heat';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { FitText } from '../../../../ui/components/fit-text/fit-text';
import { UnavailableValue } from '../../../../ui/components/unavailable-value/unavailable-value';

/** One of the four blocks a bank's pips are drawn and set with. */
export interface PipStepView {
  readonly id: string;
  /** The pip count pressing it asks for. */
  readonly value: number;
  /** How much of this block the bank's allocation fills, in `[0, 1]`. */
  readonly fill: number;
  readonly label: string;
}

/** One `SYS` / `ENG` / `WEP` row, and the four pip blocks the canvas draws it with. */
export interface BankRowView {
  readonly kind: CapacitorKind;
  readonly name: string;
  readonly capacity: string;
  readonly ratedRecharge: string;
  readonly rechargeRate: string;
  /** The bank's allocation, said in words for a reader who cannot see the blocks. */
  readonly pipsLabel: string;
  readonly steps: readonly PipStepView[];
}

/** The five column names, already localized. */
export interface DistributorColumns {
  readonly bank: string;
  readonly capacity: string;
  readonly rated: string;
  readonly pips: string;
  readonly recharge: string;
}

/** What a press of one block asks for. */
export interface PipRequest {
  readonly bank: CapacitorKind;
  readonly step: number;
}

/**
 * `POWER DISTRIBUTOR & PIPS` — the canvas's table, and the control it carries.
 *
 * Its own component rather than a fourth block inside the dashboard's template,
 * because the table, the four pip blocks and the arrangement that stacks them
 * are a third of that panel's stylesheet and none of the other three blocks
 * touch any of it.
 *
 * Presentation-only: the rows arrive already formatted and a press leaves as
 * intent, so the one pip condition stays where it lives.
 */
@Component({
  selector: 'ednb-distributor-block',
  imports: [FitText, UnavailableValue],
  templateUrl: './distributor-block.html',
  styleUrl: './distributor-block.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DistributorBlock {
  /** `SYS`, `ENG` and `WEP`, in the canvas's order. Empty is unavailable. */
  readonly rows = input.required<readonly BankRowView[]>();

  readonly columns = input.required<DistributorColumns>();

  /** The block's own heading, and the name of its scroller. */
  readonly caption = input.required<string>();

  /** What stands in where the package returned no distributor. */
  readonly unavailableLabel = input.required<string>();

  readonly pipsRequested = output<PipRequest>();

  readonly headingId = relationId('power-distributor');

  setPips(bank: CapacitorKind, step: number): void {
    this.pipsRequested.emit({ bank, step });
  }
}
