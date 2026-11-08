import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { GameTextPresentation } from '../../i18n/game-text.presenter';
import { ElementSizeAdapter } from '../../platform/browser/element-size.adapter';
import { MessageService } from '../../i18n/message.service';
import { GameText } from '../components/game-text/game-text';
import { Tooltip } from '../components/tooltip/tooltip';

/**
 * What identifies one module.
 *
 * The canvas writes it as a name over a tracked mono code line —
 * `Huge Multi-Cannon` above `4A GIMBALLED` — and that is what this renders. The
 * class, the rating and the mount are three separate package values, never a
 * string parsed out of a symbol: `4A` looks like it could be read off
 * `Hpt_MultiCannon_Gimbal_Huge`, and on the Python Mk II's thrusters that habit
 * is already wrong (constitution II).
 *
 * `symbol` is shown only when `showSymbol` is set. Most module names are unique
 * enough to choose by; a few are not, and where two rows would otherwise read
 * identically the identity has to be visible rather than hidden behind an
 * ellipsis (module-replacement design, "identity ambiguity").
 */
@Component({
  selector: 'ednb-module-identity-badge',
  imports: [GameText, Tooltip],
  templateUrl: './module-identity-badge.html',
  styleUrl: './module-identity-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModuleIdentityBadge {
  readonly #messages = inject(MessageService);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #sizes = inject(ElementSizeAdapter);

  /** The package's name for the article, with its provenance. */
  readonly name = input.required<GameTextPresentation>();

  /**
   * The whole name, offered as a tip wherever the caller's rule cuts it short.
   *
   * A caller that truncates this name has to give the whole of it back, and an
   * ellipsis the browser paints cannot be reached by a thumb or a pointer. Set
   * this and the ellipsis becomes the system's own tooltip instead — drawn only
   * while the name is actually too long for the line it is on, so a name that
   * fits carries no mark at all. Left unset, nothing here truncates and there is
   * nothing to reach.
   */
  readonly nameTip = input<string | null>(null);

  /** The package identity. Rendered only where two rows would otherwise match. */
  readonly symbol = input<string | null>(null);
  readonly showSymbol = input(false);

  /** The package's own class number. Never parsed from anything. */
  readonly moduleClass = input<number | null>(null);
  readonly rating = input<string | null>(null);
  readonly mount = input<string | null>(null);

  /**
   * What else the code line carries, after the mount.
   *
   * Canvas 1d writes one line per fitted row — `4A GIMBALLED · OVERCHARGED G5 ·
   * CORROSIVE` — rather than a line for the article and another for what has
   * been done to it. Canvas 1c draws the same line with the `4A` moved to the
   * class chip.
   */
  readonly detail = input<string | null>(null);

  /**
   * Whether the name is drawn at the smaller of the canvas's two scales.
   *
   * The same identity appears where the module is the row's subject and where it
   * is one column of four, and the canvas sets those differently: `500 13px` on
   * a ledger row, `400 10.5px` in the offence panel's weapon list. A named
   * variant rather than a size passed in, so the two scales the drawing actually
   * uses stay the only two anything can ask for.
   */
  readonly compact = input(false);

  /**
   * Whether the class and rating are drawn as a chip on the name line.
   *
   * Canvas 1c draws the dense ledger row's `4A` in a hairline chip after the
   * name, and leaves the code line the mount and the engineering. Canvas 1d
   * keeps the code at the start of the code line, and so does every panel that
   * does not ask for the chip. The spoken description is the same either way.
   */
  readonly classChip = input(false);

  /** The canvas's `4A`: class and rating together, when the package has both. */
  readonly code = computed(() => {
    const moduleClass = this.moduleClass();
    const rating = this.rating();
    return moduleClass === null || rating === null ? null : `${moduleClass}${rating}`;
  });

  /** The mount, named in the Commander's language rather than as a token. */
  readonly mountLabel = computed(() => {
    const mount = this.mount();
    switch (mount) {
      case 'Fixed':
        return this.#messages.message('outfitting.mount.fixed');
      case 'Gimballed':
        return this.#messages.message('outfitting.mount.gimballed');
      case 'Turreted':
        return this.#messages.message('outfitting.mount.turreted');
      default:
        return null;
    }
  });

  /**
   * The whole code line, as one line.
   *
   * Canvas 1d writes `4A GIMBALLED · OVERCHARGED G5 · CORROSIVE` as a single
   * run of text in a single ink — not as separate chips that wrap onto lines of
   * their own. Joining here rather than in the template is what keeps the
   * separators inside the text: a `::before` on each part would be read aloud
   * as well as drawn.
   */
  readonly codeLine = computed(() => {
    // The mount is joined to the code by a space, everything else by the dot.
    // That is the canvas's own distinction and not a preference: it writes
    // `3E FIXED · STOCK`, `4A GIMBALLED · OVERCHARGED G5 · CORROSIVE` and
    // `3D GIMBALLED · LONG RANGE G5`, and never a dot between a class code and
    // a mount — while a module with no mount takes the dot straight away, as in
    // `8A · CHARGE ENHANCED G5`. The code and the mount name one thing together;
    // what follows is a second fact about it.
    const code = [this.classChip() ? null : this.code(), this.mountLabel()]
      .filter((part): part is string => part !== null && part !== '')
      .join(' ');
    const parts = [code, this.detail()].filter(
      (part): part is string => part !== null && part !== '',
    );
    if (this.showSymbol() && this.symbol()) {
      parts.push(this.symbol()!);
    }
    return parts.length === 0 ? null : parts.join(' · ');
  });

  private readonly nameText = viewChild(GameText);

  /** Whether the caller's rule is currently cutting the name short. */
  protected readonly cut = signal(false);

  /**
   * Watches the line the name is on, and asks the name whether it still fits.
   *
   * Only where a tip was offered, so the ledger pays for this and no other
   * surface does. It settles rather than oscillates: the mark only appears
   * while the name is cut, and taking a mark's width off a line that was
   * already too short cannot make the name fit.
   */
  readonly #watch = effect((onCleanup) => {
    if (this.nameTip() === null) {
      this.cut.set(false);
      return;
    }
    // Read so a new name is re-measured: a longer name in an unchanged box
    // overflows without the box ever resizing.
    this.name();
    onCleanup(
      this.#sizes.observe(this.#host.nativeElement, () =>
        this.cut.set(this.nameText()?.cut() ?? false),
      ),
    );
  });

  /** The class and rating, spelled out for anyone reading the code aloud. */
  readonly codeDescription = computed(() => {
    const moduleClass = this.moduleClass();
    const rating = this.rating();
    return moduleClass === null || rating === null
      ? null
      : this.#messages.message('outfitting.module.code', {
          class: moduleClass,
          rating,
        });
  });
}
