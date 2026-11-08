import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ElementSizeAdapter } from '../../../platform/browser/element-size.adapter';
import { Tooltip } from '../tooltip/tooltip';

/**
 * A label that the caller can hold on one line, cut with a reachable `…`.
 *
 * It draws `text` in full. The caller holds it on one line from its own
 * stylesheet by setting `white-space: nowrap` on this element or on an
 * ancestor, usually inside a container query at its own step. `white-space` is
 * inherited, so no input and no class is needed. Below the step, the caller
 * leaves `white-space` as it is and the text wraps.
 *
 * Where the text wraps, it wraps between words, and a word is never broken. A
 * word too long for the box is cut like a line that does not fit. Where the
 * text is held on one line and does not fit, the drawing stops at the edge of
 * the box and a `…` follows it. The browser's `text-overflow` ellipsis is not used, because
 * a pointer or a thumb cannot ask a painted ellipsis what it stands for. The
 * `…` is the presentational `ednb-tooltip` the ledger uses for a cut module
 * name: it shows the whole text on hover and on a press, and it is drawn only
 * while the text is cut.
 *
 * The whole text stays in the document, so a screen reader reads it whole. The
 * `…` is `aria-hidden`, because it says nothing that the text does not. Where
 * `text` is empty there is nothing for a tip to show, and the `…` is a plain
 * mark.
 *
 * A caller can project content to draw in place of `text`, for example a game
 * text that keeps its own language and disclosure, or a tooltip trigger. `text`
 * is then the tip, and the projected content is what is measured and cut. A
 * projected element that sets its own `overflow-wrap` keeps it, so its caller
 * sets `overflow-wrap: normal` on it to keep its words whole.
 *
 * The host is `inline-flex`, never wider than its container, and can shrink to
 * nothing in a flex or grid row. A grid track that holds it must be able to
 * shrink too (`minmax(0, …)`).
 */
@Component({
  selector: 'ednb-fit-text',
  imports: [Tooltip],
  templateUrl: './fit-text.html',
  styleUrl: './fit-text.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Tells the clipped-text checks that this cut is handed back by the `…`.
    '[attr.data-text-reachable]': 'cut() ? "" : null',
  },
})
export class FitText {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #sizes = inject(ElementSizeAdapter);

  /** The whole text. It is drawn, read and given as the tip in full. */
  readonly text = input.required<string>();

  /**
   * Whether the `…` is a tooltip that shows the whole text.
   *
   * Set it to `false` where the caller hands back the whole text in a tip of
   * its own, for example a label that is already the trigger of its own gloss.
   * The `…` is then a plain mark, so no second tooltip is drawn. The text is
   * still cut, and `cut` still says so.
   */
  readonly tipped = input(true);

  readonly #cut = signal(false);

  /**
   * Whether the text is cut now.
   *
   * Public for a caller that hands back the whole text in a gloss of its own,
   * for example a label that is already a tooltip trigger. Read it through a
   * `viewChild(FitText)`.
   */
  readonly cut = this.#cut.asReadonly();

  private readonly value = viewChild.required<ElementRef<HTMLElement>>('value');

  /**
   * Measures the text against its box on each resize and on each new text.
   *
   * The whole text is compared with the host's content box, not with the
   * box the text has left beside the `…`. So the `…` goes away as soon as the
   * text fits without it, and cannot hold itself in place. A pixel of slack
   * for sub-pixel layout, which the two engines round differently.
   */
  readonly #watch = effect((onCleanup) => {
    // Read so a new text is measured again: a longer text in an unchanged box
    // overflows without the box resizing.
    this.text();
    onCleanup(
      this.#sizes.observe(this.#host.nativeElement, ({ width }) =>
        this.#cut.set(this.value().nativeElement.scrollWidth - width > 1),
      ),
    );
  });
}
