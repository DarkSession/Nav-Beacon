import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { GameTextPresentation } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import { GameText } from '../components/game-text/game-text';
import { relationId } from '../a11y/text-equivalence';

/** The value the explicit no-effect option carries. */
export const NO_EFFECT_CHOICE = '';

/** One experimental effect the package offers this mount. */
export interface ExperimentalEffectView {
  readonly fdname: string;
  readonly name: GameTextPresentation;
  /** The package's own description of what it does. May be unavailable. */
  readonly description: GameTextPresentation;
  readonly applied: boolean;
}

/**
 * Which experimental effect to apply — including none.
 *
 * Both canvases open the list with `None — remove effect`, and that option is
 * the whole route to removing one. Choosing it and applying preserves the
 * blueprint and grade underneath, because it dispatches the package's
 * effect-only operation rather than re-applying the recipe (FR-012).
 *
 * Unlike the blueprint list, each option here *does* carry a description: the
 * Almanac publishes one per effect, so the canvas's `−3% ENEMY HULL RESIST ·
 * −20% AMMO` line is package text rather than a claim of ours. Where the
 * package has none, the row draws the name alone: a stand-in line would state
 * an absence rather than describe the effect (Commander request 2026-08-26).
 *
 * Two shapes, and the menu is the application's own rather than the platform's.
 * A native option holds one run of text, so a description could only be joined
 * onto the name, and the menu became thirteen sentences (Commander request
 * 2026-08-30). The menu draws the two lines the card list draws, at the same
 * two steps, and states its own roles: a button that names the chosen effect
 * and says whether its list is open, over a listbox whose options each say
 * whether they are the selected one.
 */
@Component({
  selector: 'ednb-experimental-effect-list',
  imports: [GameText],
  templateUrl: './experimental-effect-list.html',
  styleUrl: './experimental-effect-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // A press anywhere else shuts the menu. `pointerdown` rather than `click`,
    // so the press that lands on the trigger while the menu is open is seen
    // here first, found to be inside, and left for the trigger's own toggle —
    // which would otherwise re-open what this had just shut.
    '(document:pointerdown)': 'dismissOutside($event)',
    // And focus leaving shuts it too, which is the same rule for the other way
    // out: `Tab` from the list belongs to the page, so the focus goes on and
    // the list would otherwise stay drawn over the attribute table behind it.
    '(focusout)': 'dismissOnFocusOut($event)',
  },
})
export class ExperimentalEffectList {
  readonly #messages = inject(MessageService);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly effects = input.required<readonly ExperimentalEffectView[]>();

  /**
   * True where the editor has room for canvas 1c's menu rather than cards.
   *
   * Named for the shape the editor is asking for rather than for the control
   * that answers, which is what lets the editor set this and the recipe list's
   * own input from one expression. The recipe list answers with the platform's
   * dropdown; this one answers with the menu below, for the reason
   * `design/engineering-editor.md` gives in "The effect menu is the
   * application's own control".
   */
  readonly asDropdown = input(false);

  /** The selected effect `fdname`, or `null` for the explicit no-effect. */
  readonly selected = input<string | null>(null);

  /** Emits the chosen `fdname`, or `null` for no effect. */
  readonly chosen = output<string | null>();

  readonly noEffect = NO_EFFECT_CHOICE;

  readonly groupName = relationId('effect-choice');
  readonly labelId = relationId('effect-menu-label');
  readonly triggerId = relationId('effect-menu-trigger');
  readonly listId = relationId('effect-menu-list');

  /**
   * What names the trigger: the control's own label, then the effect on it.
   *
   * Both, because either alone is half the answer — the label says which choice
   * this is and the value says what it currently holds.
   */
  readonly triggerNameIds = `${this.labelId} ${this.triggerId}`;

  readonly legend = this.#messages.messageSignal('outfitting.engineering.effect.legend');
  readonly noneLabel = this.#messages.messageSignal('outfitting.engineering.effect.none');
  readonly appliedLabel = this.#messages.messageSignal('outfitting.engineering.applied');

  readonly #open = signal(false);

  /** Whether the menu's list is drawn. Only the menu shape has one. */
  readonly open = this.#open.asReadonly();

  /**
   * Which option the keyboard is on, as an index into {@link rows}.
   *
   * The list keeps the focus and names the option it is on through
   * `aria-activedescendant`, rather than moving focus onto the options
   * themselves. Either pattern is a listbox; this one keeps the scroll box the
   * one thing in the tab order, which is what the trigger says it controls.
   */
  readonly #activeIndex = signal(0);

  /**
   * The way out, then the package's own effects: the options in drawn order.
   *
   * One list, so the keyboard walks exactly what the eye sees and the `None`
   * row is reached the same way as the rest. `null` is the no-effect choice,
   * which is the value {@link choose} already takes for it.
   */
  readonly rows = computed<readonly (string | null)[]>(() => [
    null,
    ...this.effects().map((effect) => effect.fdname),
  ]);

  readonly activeIndex = computed<number>(() => {
    const rows = this.rows();
    const index = this.#activeIndex();
    // Clamped rather than trusted: the package's menu is rebuilt whenever the
    // recipe changes, and an index kept across that would name a row that is no
    // longer there.
    return Math.min(Math.max(index, 0), Math.max(rows.length - 1, 0));
  });

  /** The `id` of the option the keyboard is on, for `aria-activedescendant`. */
  readonly activeOptionId = computed<string>(() => this.optionId(this.activeIndex()));

  /** One stable `id` per option, so the list can name the one it is on. */
  optionId(index: number): string {
    return `${this.listId}-option-${index}`;
  }

  /**
   * The chosen effect, for the trigger. `null` where nothing is chosen, which
   * the trigger reads as `None` — an application string rather than game text.
   *
   * The name is handed over as the package presented it, so the trigger draws
   * it through `ednb-game-text` exactly as the options below it do: an effect
   * the catalogue has no translation for is disclosed as untranslated and
   * carries the language it is actually in, rather than being presented as a
   * translation (constitution VI, FR-020). Printing `name.text` here would have
   * been the one place in this control where that disclosure was dropped.
   *
   * An effect that is not among the ones offered is `null` too. The draft only
   * ever selects from that list — a selection that has fallen off the package's
   * menu is no selection — so this is a floor rather than a case, and the floor
   * is `None` rather than the raw symbol, which is never a display name.
   */
  readonly triggerEffect = computed<ExperimentalEffectView | null>(() => {
    const selected = this.selected();
    if (selected === null) {
      return null;
    }
    return this.effects().find((candidate) => candidate.fdname === selected) ?? null;
  });

  /**
   * The list itself, which takes the focus while it is drawn.
   *
   * `private` rather than `#private`, which Angular's compiler does not accept
   * on a signal query.
   */
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // The list is drawn in the menu shape alone, so a menu left open while the
    // editor changed shape would come back open when the shape came back. It
    // holds no selection of its own — choosing an option is the edit — so
    // shutting it is the whole reset.
    effect(() => {
      this.asDropdown();
      this.#open.set(false);
    });

    // Opening moves the focus onto the list, so the keys below reach it without
    // a Commander first tabbing to a box that appeared under their hands.
    effect(() => {
      this.list()?.nativeElement.focus();
    });
  }

  /**
   * Keeps the option the list is on inside the box it scrolls in.
   *
   * The list is bounded at `--ednb-layout-menu-drop` and scrolls inside itself,
   * so an option the keyboard walks to — or the applied one the menu opens on —
   * is otherwise named by `aria-activedescendant` while sitting hundreds of
   * pixels below the fold. Nothing on screen would move.
   *
   * The list's own box is scrolled rather than `scrollIntoView`, which walks
   * every scrollable ancestor up to the document and would take the panel this
   * menu is drawn over off screen to reveal a row inside it — the same reason
   * the chooser's list gives (`candidate-list.ts`, `#centreFitted`).
   *
   * Moved by the least that puts the option inside the box, rather than centred:
   * a list that re-centres on every arrow press moves the rows either side of
   * the one being read, and a Commander walking a menu is reading those too.
   */
  readonly #followActiveOption = afterRenderEffect(() => {
    const list = this.list()?.nativeElement;
    const active = list?.querySelector<HTMLElement>(`#${CSS.escape(this.activeOptionId())}`);
    if (!list || !active) {
      return;
    }
    // Placed before it is scrolled, because placing it can shorten the box.
    if (list !== this.#placed) {
      this.#placed = list;
      this.#place(list);
    }

    // `clientTop` is the scroller's own block-start border, which stands
    // between the box a rect measures from and the padding box `clientHeight`
    // describes.
    const listBox = list.getBoundingClientRect();
    const optionBox = active.getBoundingClientRect();
    const above = optionBox.top - listBox.top - list.clientTop;
    const below = above + optionBox.height - list.clientHeight;

    if (above < 0) {
      list.scrollTop += above;
    } else if (below > 0) {
      list.scrollTop += below;
    }
  });

  /** The list `#place` last measured; each opening draws a new one. */
  #placed: HTMLElement | null = null;

  /**
   * Where the drawn list goes: under the trigger, or over it.
   *
   * A trigger low on the screen would hang the list past the window's foot,
   * where its last options cannot be reached (issue #107). So, as the tooltip
   * does, the list goes over the trigger when it does not fit under it and there
   * is more room over it, and it is held to the room on whichever side it takes
   * — it scrolls inside itself, so every option stays reachable.
   */
  #place(list: HTMLElement): void {
    // The menu box, which the list hangs from: under it is under the trigger,
    // and over it is over the label too.
    const menu = list.parentElement;
    if (!menu) {
      return;
    }
    const anchor = menu.getBoundingClientRect();
    const under = list.ownerDocument.documentElement.clientHeight - anchor.bottom;
    const over = anchor.top;
    const height = list.offsetHeight;
    const above = height > under && over > under;
    list.classList.toggle('menu__list--above', above);
    const room = Math.floor(above ? over : under);
    if (height > room) {
      list.style.maxBlockSize = `${room}px`;
    }
  }

  toggle(): void {
    const opening = !this.#open();
    if (opening) {
      // Opened on the option that is applied, so the list starts where the
      // build is rather than at the top of the menu.
      this.#activeIndex.set(Math.max(this.rows().indexOf(this.selected()), 0));
    }
    this.#open.set(opening);
  }

  /** Choosing is the edit, exactly as it is in the card list beside it. */
  choose(fdname: string | null): void {
    this.#shut();
    this.chosen.emit(fdname);
  }

  /**
   * The list's own keys, which a drawn listbox has to state for itself.
   *
   * A native menu brings these from the platform. This one does not, so the
   * arrows walk the options, `Home` and `End` reach the ends, `Enter` and
   * `Space` take the one the list is on, and `Escape` leaves without taking
   * anything. Each of them is the platform menu's own behaviour, and a control
   * that opens on a press and can then only be left by a second press is a
   * control a keyboard cannot finish using.
   */
  onListKeydown(event: KeyboardEvent): void {
    const last = this.rows().length - 1;
    const index = this.activeIndex();

    switch (event.key) {
      case 'ArrowDown':
        this.#activeIndex.set(Math.min(index + 1, last));
        break;
      case 'ArrowUp':
        this.#activeIndex.set(Math.max(index - 1, 0));
        break;
      case 'Home':
        this.#activeIndex.set(0);
        break;
      case 'End':
        this.#activeIndex.set(last);
        break;
      case 'Enter':
      case ' ':
        this.choose(this.rows()[index] ?? null);
        break;
      case 'Escape':
        this.#shut();
        break;
      default:
        // Every other key is the page's, including `Tab`, which leaves the list
        // the way it leaves any other control.
        return;
    }

    // Only for the keys above: a key this control acted on is one the page must
    // not also act on, and `Space` and the arrows would otherwise scroll it.
    event.preventDefault();
  }

  /** Shuts the list and puts the focus back where it was opened from. */
  #shut(): void {
    if (!this.#open()) {
      return;
    }
    this.#open.set(false);
    // The trigger, not the document. Focus left inside a box that is no longer
    // drawn is focus a reader has to find again from the top of the page.
    this.#host.nativeElement.querySelector<HTMLElement>('.menu__trigger')?.focus();
  }

  /** Shuts the list where the focus has gone somewhere outside this control. */
  dismissOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    // `null` is focus leaving the document altogether — another window, or the
    // browser's own chrome. The menu stays open for that, because the
    // Commander has not moved on from it and will come back to it.
    if (!this.#open() || next === null || !(next instanceof Node)) {
      return;
    }
    if (!this.#host.nativeElement.contains(next)) {
      this.#open.set(false);
    }
  }

  dismissOutside(event: Event): void {
    const target = event.target;
    if (!this.#open() || !(target instanceof Node)) {
      return;
    }
    if (!this.#host.nativeElement.contains(target)) {
      // Not `#shut`: a press somewhere else is a press that is taking the focus
      // somewhere else, and pulling it back to the trigger would fight it.
      this.#open.set(false);
    }
  }

  readonly nameFor = (effect: ExperimentalEffectView): string =>
    this.#messages.message('outfitting.engineering.effect.choose', {
      effect: effect.name.text ?? effect.fdname,
    });
}
