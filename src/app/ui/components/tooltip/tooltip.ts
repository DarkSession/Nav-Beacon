import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { relationId } from '../../a11y/text-equivalence';

/** The bubble is drawn in the top layer rather than in its own row. */
const FLOATING = 'tooltip__tip--floating';

/** It is drawn over its trigger, because there was no room under it. */
const ABOVE = 'tooltip__tip--above';

/**
 * A scroll anywhere, not only the page's own.
 *
 * A `scroll` event does not bubble, and every list this mark is drawn in is a
 * scroller of its own: without the capture phase a bubble raised out of a
 * manifest row would stand still while the manifest moved under it.
 */
const ANY_SCROLLER = { capture: true, passive: true } as const;

/**
 * A spacing token, in the pixels a Commander's own text size makes of it.
 *
 * The token layer states its measures in `rem` and `getComputedStyle` resolves
 * a custom property to the token's own value rather than to pixels, so the unit
 * is converted here against the root text size — read fresh, exactly as the
 * short-viewport threshold reads it, so a text-scale change moves the distance
 * with it. The measure itself is still the token's: nothing about how far this
 * stands from an edge is decided in TypeScript.
 */
function pixels(declared: string, root: HTMLElement): number {
  const measure = Number.parseFloat(declared);
  if (!Number.isFinite(measure)) {
    return 0;
  }
  if (!declared.trim().endsWith('rem')) {
    return measure;
  }
  return measure * (Number.parseFloat(getComputedStyle(root).fontSize) || 16);
}

/**
 * A short gloss on the word beside it, drawn when a reader asks for it.
 *
 * The reference canvases hang this kind of gloss on a `title` attribute or a
 * `data-tip`. Neither is built here. A `title` cannot be styled, cannot be
 * reached by touch, is announced inconsistently and disappears the moment the
 * pointer moves — it is not a tooltip so much as the absence of one. This is
 * the system's own: a real element, drawn from the token layer, reachable by
 * every input the application supports.
 *
 * ## Why the gloss is never actually hidden
 *
 * The tip is in the accessibility tree at all times, related to its trigger by
 * `aria-describedby`, whether or not it is currently drawn. So what the control
 * governs is whether the gloss is *drawn*, never whether it is *available*:
 * hover-only meaning is unreachable by touch (011 FR-006), and a reader who is
 * told the interface rather than shown it never has to find a control to hear
 * this. `aria-expanded` says which of the two the trigger is in, so the visual
 * state is programmatically determinable rather than carried by visibility
 * alone (011 FR-010).
 *
 * The native `button` role and that permanent description are also what carry
 * the fact that there is more here to read. The dotted rule under the word is
 * an affordance and nothing more — a line style cannot be the sole carrier of
 * meaning any more than a colour can (011 FR-010, and the semantics contract's
 * "line style" clause).
 *
 * ## How it opens, and how it closes
 *
 * A hover, a focus, and a press. A press because touch has no hover at all, and
 * a tip only a mouse could reach would be exactly the `title` this component
 * exists to replace. Hover is admitted only from a real mouse (`pointerType`):
 * a tap fires `pointerenter` too, and admitting it would open the tip and let
 * the `click` that follows shut it again, so a touch could never open one.
 *
 * A hover and a focus last exactly as long as they do. A press *pins*, and
 * clears the other two so that it is pinning rather than racing them — so a
 * press opens a closed tip, keeps a hovered one after the pointer moves on, and
 * a second press puts it away, whichever pointer it came from.
 *
 * ## Dismissible, hoverable, persistent
 *
 * Success criterion 1.4.13, which is not one of the seven keyboard criteria the
 * constitution excludes and so applies in full. Each of its three parts is a
 * decision here rather than a consequence:
 *
 * - **dismissible.** `Escape` is listened for on the *document*, not on this
 *   host. A tip opened by hover alone leaves the focus wherever it was, so a
 *   host listener would never see the key — the one case the criterion exists
 *   for. {@link dismiss} ignores the key unless this tip is the one on screen,
 *   so a tooltip elsewhere on the page is not quietly poisoned by it.
 * - **hoverable.** The bubble stands off the trigger by a gap, and the gap is
 *   bridged by the bubble's own `::before` — see the stylesheet. Being a child
 *   of the host is not enough on its own: `pointerleave` fires on geometry, not
 *   on parentage, so an unbridged gap collapses the tip just as the pointer
 *   sets off to read it.
 * - **persistent.** Nothing times out. It closes when the pointer leaves, when
 *   focus leaves, on the second press, or on `Escape`.
 *
 * ## Why the bubble is raised out of the row it belongs to
 *
 * A tip drawn in place is drawn inside whatever the row it is on happens to be,
 * and the rows these marks are on are boxes that cut their content. A manifest
 * row declares `content-visibility: auto`, so the rows a Commander has not
 * reached are not laid out — that is paint containment, and paint containment
 * clips every descendant to the row's own box, whatever the descendant's
 * `z-index` says. The identity cell cuts a name too long for its column with
 * `overflow: hidden`, and cuts the bubble with it. The manifest's pane is a
 * scroller, and cuts whatever reaches its edges. Measured on the fitting
 * manifest at 1440x900: the bubble was drawn, at full size, at the right
 * coordinates, and none of it reached the screen — hovering a route mark
 * appeared to do nothing at all (Commander request 2026-08-29).
 *
 * So while it is drawn the bubble is raised into the **top layer**, by the
 * platform's own `popover`, which is outside all three. `manual` rather than
 * `auto`: this component already governs when the tip closes, and an `auto`
 * popover would also close every other one that is open and answer `Escape`
 * behind {@link dismiss}'s back.
 *
 * It is raised without moving: the element stays the child of this host that it
 * always was, so `aria-describedby` still resolves to it, and a pointer that
 * travels from the trigger on to the bubble still has not left the host — which
 * is what keeps "hoverable" above true. The top layer is where it is *painted*,
 * not where it lives.
 *
 * Where the platform has no `popover` — the unit suite's DOM is one — nothing
 * is raised and the bubble is drawn where it is written, which is what every
 * placement outside a cutting box gets anyway.
 */
@Component({
  selector: 'ednb-tooltip',
  templateUrl: './tooltip.html',
  styleUrl: './tooltip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut()',
    '(document:keydown.escape)': 'dismiss()',
  },
})
export class Tooltip {
  /** The trigger's visible text — the word the tip is a gloss on. */
  readonly label = input<string>('');

  /**
   * The trigger is a mark rather than a word.
   *
   * The reference draws some of these glosses on an icon: a route mark on a
   * module row has no word under it, and the sentence saying what the mark
   * means is already on the row for a reader. So the caller projects the mark
   * as content and hides the whole control from the accessibility tree, and the
   * trigger becomes a plain `span` — these marks are projected into rows that
   * are controls themselves, where a button would be a button inside a button.
   * A tip that is only a way to *see* a sentence the row already carries needs
   * no role, no tab stop and no description of its own. The trigger takes the
   * dense target floor with it, because the mark is one of the chips the
   * reference draws small.
   */
  readonly presentational = input(false);

  /**
   * The trigger is one line of a dense list rather than a control of its own.
   *
   * It takes SC 2.5.8's 24-pixel AA floor instead of the project's 44-pixel
   * baseline, which is the same allowance the ledger's power chips and the
   * distributor's pip blocks take: the reference sets these names as plain text
   * with the gloss on a `data-tip`, so the 44 pixels are a target this
   * application added and they are what set the rows of a five-row block twenty
   * pixels apart (Commander request 2026-08-28). Only for a trigger inside such
   * a list, never for one that stands alone.
   */
  readonly dense = input(false);

  /** What that word is shorthand for. Always available; drawn on request. */
  readonly tip = input.required<string>();

  /**
   * What the bubble draws in place of `tip`, where the two differ.
   *
   * For a trigger whose caller cuts its word short: the bubble then shows the
   * whole word before the gloss. `tip` stays what a reader is told, so a screen
   * reader does not hear the word again straight after the trigger's name.
   * `null` draws `tip`.
   */
  readonly drawnTip = input<string | null>(null);

  /**
   * Drawn open from the start.
   *
   * For a preview or a test that needs the open presentation without a
   * pointer. A press still closes it, because the input seeds the state rather
   * than pinning it.
   */
  readonly open = input(false);

  readonly tipId = relationId('tooltip');

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #document = inject(DOCUMENT);

  /**
   * The bubble, which is raised while it is drawn.
   *
   * TypeScript-private rather than `#private`: a signal query cannot be
   * declared on an ES private field, which is the same allowance every other
   * queried element in this library takes.
   */
  private readonly bubble = viewChild.required<ElementRef<HTMLElement>>('bubble');

  /**
   * The bubble while it is in the top layer, and `null` while it is not.
   *
   * The element rather than a flag, because the one place this is read without
   * the bubble in hand is teardown — and a signal query is not a thing to ask
   * for after the view holding it has gone.
   */
  #raised: HTMLElement | null = null;

  /** Kept as one reference, because it is added and removed by identity. */
  readonly #follow = (): void => {
    if (this.#raised) {
      this.#place(this.#raised);
    }
  };

  constructor() {
    // After the render, not during it: the placement is read off the trigger's
    // own box and off the bubble at its drawn size, and neither is measurable
    // until the frame that draws them has been written.
    afterRenderEffect(() => {
      if (this.shown()) {
        this.#raise();
      } else {
        this.#lower();
      }
    });

    // A host taken off the page with its bubble still up leaves nothing behind:
    // the platform drops the popover with the element, but the two listeners
    // are the window's and would outlive it.
    inject(DestroyRef).onDestroy(() => this.#lower());
  }

  /**
   * A press, which is the only way in that touch has.
   *
   * Seeded from {@link open} rather than read alongside it, so that a press on
   * a tip that opened itself shuts it. Read alongside, the input would go on
   * asserting itself and the trigger would be a control that does nothing.
   */
  readonly #pressed = linkedSignal(() => this.open());
  /** A real mouse over the host or its bubble. */
  readonly #hovered = signal(false);
  /** Focus inside the host, which a press clears so the two do not fight. */
  readonly #focused = signal(false);
  /** `Escape`, until every reason this tip was open has gone. */
  readonly #dismissed = signal(false);

  /** Whether the gloss is drawn. It is readable either way. */
  readonly shown = computed(() => !this.#dismissed() && this.#wanted());

  /** Whether anything is asking for the tip, before `Escape` is considered. */
  readonly #wanted = computed(() => this.#pressed() || this.#hovered() || this.#focused());

  /**
   * The press, which pins rather than merely toggles what is on screen.
   *
   * It acts on the pin alone and clears the hover and the focus, because both
   * of those are already true by the time a press arrives — a pointer has to be
   * over the trigger to press it, and a browser focuses a button it is pressed
   * on. Read against what is *drawn*, the first press on a hovered tip would
   * therefore always be a press that closes it, and on a keyboard the tip could
   * not be closed at all.
   */
  toggle(event?: Event): void {
    // A presentational mark hands its press the event, because the row under it
    // is a control: `preventDefault` stops a wrapping `label` from activating
    // the radio it is for, and `stopPropagation` stops a ledger row's own
    // select handler. Without both, asking what a mark means changes the build.
    event?.preventDefault();
    event?.stopPropagation();

    const pinning = !this.#pressed();
    this.#dismissed.set(false);
    this.#hovered.set(false);
    this.#focused.set(false);
    this.#pressed.set(pinning);
  }

  /**
   * A mouse arrived.
   *
   * Only a mouse: a tap fires this too, and admitting it would open the tip on
   * `pointerenter` and shut it again on the `click` that follows.
   */
  onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.#hovered.set(true);
    }
  }

  /** The mouse left. */
  onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.#hovered.set(false);
      this.#settle();
    }
  }

  /**
   * Focus arrived, which is the other half of "on hover or focus".
   *
   * It fires on a press too, a moment before the `click`. That is exactly why
   * {@link toggle} clears it: what a press acts on is the pin, and a focus it
   * took itself is not a second reason to stay open.
   */
  onFocusIn(): void {
    this.#focused.set(true);
  }

  /**
   * Focus left the trigger and its bubble.
   *
   * Which is also how a tap elsewhere on the screen shuts a pressed tip: a
   * press focuses the trigger, so anything taken up next takes the focus off
   * it.
   */
  onFocusOut(): void {
    this.#focused.set(false);
    this.#pressed.set(false);
    this.#settle();
  }

  /**
   * `Escape`: 1.4.13's dismissal, without moving the pointer or the focus.
   *
   * Heard on the document, so it reaches a tip a hover opened while the focus
   * is elsewhere — and ignored by every tip that is not currently drawn, so one
   * `Escape` cannot leave a page of tooltips refusing the next hover.
   *
   * It settles afterwards because unpinning can be the last reason to go: a
   * pinned tip the pointer has already left is held open by the pin alone, so
   * clearing it leaves nothing asking and nothing on the way to ask. Without
   * this the dismissal outlives the tip it dismissed, and the next hover is
   * swallowed by an `Escape` for a tip that had already closed.
   */
  dismiss(): void {
    if (!this.shown()) {
      return;
    }
    this.#dismissed.set(true);
    this.#pressed.set(false);
    this.#settle();
  }

  /**
   * Forget an `Escape` once, and only once, nothing is asking for the tip.
   *
   * Cleared any earlier and a dismissal undoes itself: a tip dismissed while it
   * was both focused and hovered would come back on its own the moment the
   * pointer left, with the Commander having asked for nothing.
   */
  #settle(): void {
    if (!this.#wanted()) {
      this.#dismissed.set(false);
    }
  }

  /**
   * Raise the bubble into the top layer, and put it where its trigger is.
   *
   * Both halves every time it is called: the raise happens once, but a bubble
   * already up is re-placed, which is how a scroll is answered.
   */
  #raise(): void {
    const bubble = this.bubble().nativeElement;
    if (typeof bubble.showPopover !== 'function') {
      return;
    }
    if (!this.#raised) {
      this.#raised = bubble;
      bubble.setAttribute('popover', 'manual');
      bubble.classList.add(FLOATING);
      bubble.showPopover();
      const view = this.#document.defaultView;
      view?.addEventListener('scroll', this.#follow, ANY_SCROLLER);
      view?.addEventListener('resize', this.#follow);
    }
    this.#place(bubble);
  }

  /** Put the bubble back in the row, and stop following the page. */
  #lower(): void {
    const bubble = this.#raised;
    if (!bubble) {
      return;
    }
    this.#raised = null;
    const view = this.#document.defaultView;
    view?.removeEventListener('scroll', this.#follow, ANY_SCROLLER);
    view?.removeEventListener('resize', this.#follow);
    // A popover goes down with the element that carried it, so one already off
    // the page has nothing left to hide and refuses to be asked.
    if (bubble.isConnected) {
      bubble.hidePopover();
    }
    bubble.removeAttribute('popover');
    bubble.classList.remove(FLOATING, ABOVE);
    bubble.style.removeProperty('top');
    bubble.style.removeProperty('left');
  }

  /**
   * Where the raised bubble goes.
   *
   * Under the trigger's leading edge, which is where the stylesheet draws it
   * when nothing has raised it and where every canvas hangs one. Two things
   * move it, and only when they must:
   *
   * - **the far edge.** A mark at the end of a `COST` column would hang its
   *   bubble off the side of the screen, where the page would have to scroll
   *   sideways to reach it — which it never does (011 FR-011). So the bubble is
   *   held inside the viewport by the same inset the region gutter takes.
   * - **the foot.** A mark on the last row of a long list has no room under it.
   *   The bubble goes over the trigger instead, and only if there is room there:
   *   between a cramped bubble above and a cramped bubble below, the canvas's
   *   own placement wins.
   *
   * Physical `top` and `left` rather than the logical pair, because that is what
   * a client rectangle is: the leading edge is chosen for the writing direction
   * here instead, which is the one place the difference belongs.
   */
  #place(bubble: HTMLElement): void {
    const trigger = this.#host.nativeElement.querySelector<HTMLElement>('.tooltip__trigger');
    if (!trigger) {
      return;
    }
    const page = this.#document.documentElement;
    const anchor = trigger.getBoundingClientRect();
    const styles = getComputedStyle(bubble);
    const inset = pixels(styles.getPropertyValue('--ednb-space-region'), page);
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;

    const noRoomUnder = anchor.bottom + height + inset > page.clientHeight;
    const roomOver = anchor.top - height - inset >= 0;
    const above = noRoomUnder && roomOver;
    bubble.classList.toggle(ABOVE, above);

    const leading = styles.direction === 'rtl' ? anchor.right - width : anchor.left;
    const furthest = Math.max(inset, page.clientWidth - width - inset);
    bubble.style.top = `${above ? anchor.top : anchor.bottom}px`;
    bubble.style.left = `${Math.min(Math.max(inset, leading), furthest)}px`;
  }
}
