import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { ModuleMount } from '@elite-dangerous-almanac/core/ships/modules';
import {
  convergenceAt,
  TARGET_RANGE,
  type Convergence,
  type ConvergenceView,
} from '../../../../../domain/ships/offence/convergence';
import { Formatters } from '../../../../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../../../../i18n/game-text.presenter';
import { MessageService } from '../../../../../i18n/message.service';
import { RangeField } from '../../../../../ui/components/range-field/range-field';

/**
 * One of the hull's hardpoints, placed on the gunsight plate.
 *
 * One mark, and one only: a dot where the shot lands (Commander request
 * 2026-08-27). The hardpoint numeral beside it is withdrawn, and with it the
 * placement arithmetic, the leaders and the ring a crowded plate used to put
 * them out on — a plate 172px across carrying eight numerals was a page of
 * digits over a diagram, and every one of them was already the first word of
 * that mount's own sentence beside the plate.
 *
 * What each mark carries — whether a weapon is on it, and whether it is the
 * mount the workspace currently has selected — is drawn as three inks and
 * written out in the mark's own sentence, because a colour is not a reading
 * (011 FR-010). How the weapon aims is in that sentence and nowhere else: the
 * canvas's own second ink is spent on selection here
 * (`design/canvas-contract.md`, review note 17).
 */
export interface ShotView {
  readonly id: string;
  /** Percentages from the plate's leading and top edges — where the shot lands. */
  readonly left: number;
  readonly top: number;
  /**
   * Whether this mount is drawn on the plate at all.
   *
   * A shot further off-axis than the plate shows is left off it rather than
   * pinned to the frame (Commander request 2026-08-27): a row of dots along the
   * edge reported a spread no build has. At the track's shortest range that is
   * three of the reference hull's eight mounts, and nothing at all on
   * thirty-six of the package's forty-nine hulls. The mount keeps its sentence below either way, and
   * that sentence carries the offset and the angle it really has, so the
   * reading is the same whether or not the plate can show the mark (FR-011).
   */
  readonly onPlate: boolean;
  /**
   * Whether a weapon is fitted here.
   *
   * An empty hardpoint is drawn as the mount it is — the offset is the hull's,
   * not the weapon's — in the stale amber that says the mount is there and
   * nothing is on it, and its sentence says it is empty rather than naming a
   * weapon.
   */
  readonly armed: boolean;
  /**
   * Whether this is the mount the outfitting workspace currently has selected.
   *
   * The same selection the hull schematics mark and the ledger row carries, so
   * a Commander working on one hardpoint can see which mark on the plate is
   * theirs. It takes the plate's third ink, and nothing else: neither a ring
   * nor an outline is drawn around any mark, so the three states are three
   * fills of one shape. Both facts are written out in the mark's own sentence,
   * which is what keeps them off colour alone.
   */
  readonly selected: boolean;
  /** The whole mark in words, for a reader who is not looking at the diagram. */
  readonly statement: string;
}

/** Mount offsets to one place, which is the place canvas 1c's `9.8 m` sets. */
const OFFSET_DIGITS = 1;
/** Half the plate, as a percentage — the middle, from which a shot is offset. */
const HALF_PLATE_PERCENT = 50;

/**
 * `SHOT CONVERGENCE`: where this build's shots land at a chosen range.
 *
 * Canvas 1c draws it beneath the `WEAPONS` and `DAMAGE PROFILE` pair, in a
 * block of its own that stops at 508px rather than running the panel's width:
 * a gunsight plate and, beside it, the range it is drawn at. It is its own
 * component because it is its own block — the plate, its marks and the range
 * share nothing with the two blocks above but the panel ground they sit on.
 *
 * The geometry arrives already projected: `src/app/domain/ships/offence/convergence.ts`
 * is the only place that asks the package where a hull's hardpoints are and
 * where they point at a distance. This component places those answers on a
 * plate, names them and does no arithmetic of its own.
 */
@Component({
  selector: 'ednb-shot-convergence',
  imports: [RangeField],
  templateUrl: './shot-convergence.html',
  styleUrl: './shot-convergence.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShotConvergence {
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);

  /**
   * The hull's placed hardpoints, as the projection returned them.
   *
   * Only the available case reaches here: a hull the catalogue does not place
   * is stated in words by the block above rather than drawn as a plate with
   * nothing on it, which would read as a build whose shots all converge.
   */
  readonly geometry = input.required<Extract<Convergence, { kind: 'available' }>>();

  /**
   * The slot key the outfitting workspace currently has selected, if any.
   *
   * Read in rather than reached for: the plate is handed everything it draws,
   * and the selection belongs to the workspace, not to this diagram. It is a
   * slot key and not a hardpoint number because a key is the identity the
   * package publishes and the ledger, the schematics and this plate all use —
   * the hull's own hardpoint order and the number inside a slot key disagree on
   * ten hulls, so matching on the number would mark the wrong mount on those.
   */
  readonly selectedSlot = input<string | null>(null);

  readonly plateLabel = this.#messages.messageSignal('offence.convergence.plate');
  readonly rangeLabel = this.#messages.messageSignal('offence.convergence.range');

  /**
   * The range the gunsight is drawn at, in metres.
   *
   * Component state and nothing more: it never reaches the build, storage, the
   * route, a link or SLEF. It is a question a Commander asks of a fixed
   * loadout — "where do these land at six hundred metres" — not a property of
   * the build, and the canvas starts it where the canvas's own script does.
   */
  readonly targetRange = signal<number>(TARGET_RANGE.initial);

  readonly rangeBounds = TARGET_RANGE;

  /** The projection at the range the slider is set to. */
  readonly convergence = computed<ConvergenceView>(() =>
    convergenceAt(this.geometry(), this.targetRange()),
  );

  /**
   * Each hardpoint, as a position on the plate and as a sentence.
   *
   * The plate is decorative: every mark on it is also stated in words below,
   * because a dot is a picture, and a picture is not a reading (011 FR-010).
   * That is what carries the two things the inks separate — armed against
   * empty, and the selected mount against the rest — neither of which may rest
   * on a colour alone, and it is the only place how a weapon aims is said at
   * all, and the only place a mount's hardpoint number is now printed. It is
   * also the whole of what a Commander is told about a shot the plate cannot
   * show: since 2026-08-27 a mount whose shot falls outside the frame is not
   * drawn, and its sentence — which carries the offset and the angle it
   * actually has — is then the only place that shot appears at all.
   */
  readonly shots = computed<readonly ShotView[]>(() => {
    const selectedSlot = this.selectedSlot();

    return this.convergence().points.map((point) => {
      const mount = point.mount;
      const weapon = mount.weapon;
      const selected = mount.slot === selectedSlot;
      const place = {
        hardpoint: this.#formatters.integer(point.hardpoint),
        offset: this.#formatters.metres(mount.offsetMetres, OFFSET_DIGITS),
        angle: this.#milliradians(point.milliradians),
      };
      return {
        id: mount.slot,
        left: (1 + point.horizontal) * HALF_PLATE_PERCENT,
        top: (1 - point.vertical) * HALF_PLATE_PERCENT,
        onPlate: point.onPlate,
        armed: weapon !== null,
        selected,
        // Four whole sentences rather than one with a state appended to it.
        // Which weapon, whether the mount is empty and whether it is the
        // selected one land in different places in different languages, and a
        // sentence assembled from fragments here would fix English word order
        // into the catalogue.
        statement:
          weapon === null
            ? this.#messages.message(
                selected ? 'offence.convergence.empty.selected' : 'offence.convergence.empty',
                place,
              )
            : this.#messages.message(
                selected ? 'offence.convergence.shot.selected' : 'offence.convergence.shot',
                {
                  ...place,
                  weapon: this.#gameText.moduleName(weapon.symbol).text ?? weapon.name,
                  mount: this.#mountName(weapon.mount),
                },
              ),
      };
    });
  });

  /** The canvas's two dashed rings, as fractions of the plate they are drawn on. */
  readonly rings = computed(() => this.convergence().rings);

  /** The range the plate is drawn at, as a Commander reads it. */
  readonly targetRangeText = computed(() => this.#formatters.metres(this.targetRange()));

  readonly rangeMinText = computed(() => this.#formatters.metres(TARGET_RANGE.min));
  readonly rangeMaxText = computed(() => this.#formatters.metres(TARGET_RANGE.max));

  /** Moves the plate to a new target range. Nothing about it leaves this component. */
  setTargetRange(metres: number): void {
    this.targetRange.set(metres);
  }

  /**
   * How the weapon is aimed, in a word.
   *
   * The canvas draws a fixed mount and an aimed one in different colours and
   * says nothing else about either. This plate spends that second ink on the
   * selected mount instead, so the word here is not a reinforcement of a colour
   * but the only place the mount is stated — which is where it belonged
   * anyway, a colour never having been a reading (011 FR-010). An unrecorded
   * mount is named as unstated rather than guessed from the module's symbol.
   */
  #mountName(mount: ModuleMount | null): string {
    switch (mount) {
      case 'Fixed':
        return this.#messages.message('offence.convergence.mount.fixed');
      case 'Gimballed':
        return this.#messages.message('offence.convergence.mount.gimballed');
      case 'Turreted':
        return this.#messages.message('offence.convergence.mount.turreted');
      default:
        return this.#messages.message('offence.detail.not-stated');
    }
  }

  #milliradians(value: number): string {
    return this.#messages.message('offence.format.milliradians', {
      value: this.#formatters.integer(value),
    });
  }
}
