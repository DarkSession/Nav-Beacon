import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  projectMobilityAndJump,
  type MobilityAndJump,
  type StandardLoad,
} from '../../../../domain/ships/mobility-jump/mobility-jump';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { GameTextPresenter, type GameTextPresentation } from '../../../../i18n/game-text.presenter';
import type { MessageKey } from '../../../../i18n/locale-registry';
import { MessageService } from '../../../../i18n/message.service';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { GameText } from '../../../../ui/components/game-text/game-text';
import { UnavailableValue } from '../../../../ui/components/unavailable-value/unavailable-value';

/** Tonnes to none: the canvas writes every mass on the bar as a whole number. */
const MASS_DIGITS = 0;
/**
 * Fuel to two, as the canvas sets every fuel figure — its `MAX FUEL 8.30 t`.
 *
 * The mass bar's own precision would not do here. A Sidewinder draws 0.6 t a
 * jump, which whole tonnes print as `1 t` — a figure this application would
 * have invented over a real quantity the package stated exactly, which is what
 * constitution IV forbids. Its 0.3 t reserve tank was the other example, until
 * the canvas revision of 2026-08-25 took every tank capacity off this card.
 */
const FUEL_DIGITS = 2;
/**
 * A jump to one decimal, as the canvas sets every `RANGE BY LOAD` row — its
 * `26.8 ly`, `23.5 ly`, `15.6 ly`.
 *
 * One decimal is coarse enough to worry about a real jump printing as `0.0 ly`,
 * so it was measured rather than assumed: over every hull in the catalogue with
 * every hyperdrive that fits it, the shortest jump any of them makes is the
 * Cutter's laden 0.17 ly on a 2E, which prints `0.2 ly`. Nothing rounds away.
 */
const RANGE_DIGITS = 1;
/**
 * The whole tank in whole light years, as the canvas sets its `214 ly`.
 *
 * A different figure from a single jump and drawn at a different precision,
 * because it is a different size: the shortest full tank in that same sweep runs
 * 11.4 ly, and a tenth of a light year on top of eleven is not a reading anyone
 * takes.
 */
const TOTAL_RANGE_DIGITS = 0;
/**
 * Speeds and rotation rates whole, as the canvas sets every one of the five —
 * `200 m/s`, `265 m/s`, `24 °/s`, `32 °/s`, `9 °/s`, and not a decimal point
 * among them.
 *
 * Measured against the same worry: the slowest of the five anything in the
 * catalogue produces is a Corvette's 7.9 °/s yaw with nothing in the engines,
 * and the slowest speed a Type-9's 40 m/s.
 */
const RATE_DIGITS = 0;

/**
 * The canvas's names for the package's three loads.
 *
 * The canvas calls them `UNLADEN`, `FUELLED` and `FULL CARGO`; the package calls
 * the same three `maximum`, `unladen` and `laden`. Written out rather than
 * composed, because `MessageKey` is the catalogue's own union and a
 * template-built key would compile without proving the message exists.
 */
const LOAD_LABELS = {
  maximum: 'drives.load.maximum',
  unladen: 'drives.load.unladen',
  laden: 'drives.load.laden',
} as const satisfies Record<StandardLoad, MessageKey>;

/** One bar of the speed envelope: what it is, how fast, and how far the bar runs. */
interface EnvelopeRowView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** How far the bar is filled, in `[0, 1]`. Decoration only. */
  readonly fill: number;
}

/** One row of `RANGE BY LOAD`: a load and its single jump. */
interface RangeRowView {
  readonly id: StandardLoad;
  readonly label: string;
  readonly range: string;
  /** How far the bar is filled, in `[0, 1]`. Decoration only. */
  readonly fill: number;
}

/**
 * One row of a legend: a swatch, a name with the canvas's qualifier run in
 * beside it, and a figure.
 *
 * The canvas draws both legends this way — the three parts of the mass bar
 * under the thruster card, the drive's three constants under the frame shift
 * card — in the same three-colour ramp and the same three columns. One shape,
 * so the two blocks cannot drift apart.
 */
interface LegendRowView {
  readonly id: string;
  /** Which of the ramp's three the swatch takes. Decoration only. */
  readonly tone: 'strong' | 'dim' | 'deep';
  readonly label: string;
  /**
   * The canvas's qualifier beside the label — `ANACONDA · MILITARY GRADE`,
   * `22 FITTED`, `MAX DRAW AT FULL RANGE`. Package facts, or `null` where the
   * package has none to give.
   */
  readonly detail: string | null;
  /** The formatted figure, or `null` where the package could not settle it. */
  readonly value: string | null;
}

/** One part of the canvas's additive mass bar, as a share of its track. */
interface MassBarSegment {
  readonly id: string;
  /** The ramp colour this part shares with its legend row. Decoration only. */
  readonly tone: LegendRowView['tone'];
  /** How much of the track this part takes, in `[0, 1]`. Decoration only. */
  readonly size: number;
}

/**
 * The canvas's mass bar: three parts laid end to end, and the marks on the
 * scale they are laid on.
 *
 * The track runs from nothing to the thrusters' maximum supported mass, which
 * is what makes the three parts additive rather than three separate readings:
 * laid in order they measure the whole build against the one ceiling its
 * thrusters have, and the optimal mark says where on that scale the drives stop
 * performing at their best.
 */
interface MassBarView {
  readonly segments: readonly MassBarSegment[];
  /** Where the optimal mass falls on the same track, in `[0, 1]`. */
  readonly optimal: number | null;
}

/**
 * One of the two marks the canvas writes under that bar.
 *
 * `position` is where on the track the mark belongs, in `[0, 1]`: the canvas
 * centres `OPTIMAL 1,260 t` under its own tick at 66.67% and sets `MAX 1,890 t`
 * flush with the end of the track, which is where the maximum is. A mark with
 * no position on the track takes the end.
 */
interface CurveMarkView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly position: number | null;
}

/**
 * `DRIVES & MASS`: what moves the build, and what it has to move.
 *
 * Canvas 1c draws this as the `DRIVES` mode of the hull anatomy region — two
 * cards, `THRUSTER LOAD` and `FRAME SHIFT DRIVE`, side by side in the space the
 * plates leave. Canvas 1d stacks the same two. Same DOM at both widths; which
 * arrangement appears is decided in CSS from the space the region is given, so
 * a 400% zoom picks the stacked one for the same reason a phone does.
 *
 * Every figure is a package answer selected by
 * `src/app/domain/ships/mobility-jump/mobility-jump.ts`. Four of the canvas's
 * readings — the headline loaded mass, the hull/modules/fuel decomposition, the
 * position on the thruster mass curve and the `SCO` badge — once had no result
 * in `@elite-dangerous-almanac/core` and were raised against the library rather
 * than cut; the package publishes all four and they are ordinary readings now.
 * Nothing on this screen is a figure this application invented (constitution
 * IV; see the projector's module note).
 */
@Component({
  selector: 'ednb-drives-mass',
  imports: [GameText, UnavailableValue],
  templateUrl: './drives-mass.html',
  styleUrl: './drives-mass.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrivesMass {
  readonly #active = inject(ActiveBuildStore);
  readonly #conditions = inject(PowerConditionsStore);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);

  readonly thrustersHeadingId = relationId('drives-thrusters');
  readonly driveHeadingId = relationId('drives-fsd');

  readonly thrustersHeading = this.#messages.messageSignal('drives.thrusters.heading');
  readonly driveHeading = this.#messages.messageSignal('drives.fsd.heading');
  readonly scoLabel = this.#messages.messageSignal('drives.fsd.sco');
  readonly scoDescription = this.#messages.messageSignal('drives.fsd.sco.description');
  readonly envelopeHeading = this.#messages.messageSignal('drives.thrusters.envelope');
  /** The mass list's accessible name. Neither canvas heads that block visibly. */
  readonly massHeading = this.#messages.messageSignal('drives.thrusters.mass');
  readonly rangeHeading = this.#messages.messageSignal('drives.fsd.range-by-load');
  readonly massLockLabel = this.#messages.messageSignal('drives.fsd.mass-lock');
  readonly curveMarksLabel = this.#messages.messageSignal('drives.thrusters.curve-marks');
  readonly driveFactsLabel = this.#messages.messageSignal('drives.fsd.facts');
  readonly driveUnavailableLabel = this.#messages.messageSignal('drives.fsd.unavailable');
  readonly mobilityIssuesLabel = this.#messages.messageSignal('drives.thrusters.issues');
  readonly driveIssuesLabel = this.#messages.messageSignal('drives.fsd.issues');
  readonly mobilityUnavailableLabel = this.#messages.messageSignal('drives.thrusters.unavailable');
  readonly loadedMassLabel = this.#messages.messageSignal('drives.thrusters.loaded-mass');
  readonly offLabel = this.#messages.messageSignal('drives.source.off');

  /**
   * The projection for the active build under the current ENG allocation.
   *
   * `revision()` is read first because the loadout signal holds one mutable
   * package object: an edit changes what it contains without changing the
   * reference, so the revision is what actually says "this is different now".
   */
  readonly view = computed<MobilityAndJump | null>(() => {
    this.#active.revision();
    const loadout = this.#active.loadout();
    if (!loadout) {
      return null;
    }
    // Feature 005 owns the pips; this reads the ENG bank it settled on and
    // passes it to the package unchanged.
    return projectMobilityAndJump(loadout, this.#conditions.pips().engines);
  });

  /**
   * Whether there is a build to read.
   *
   * With no build the region draws nothing at all rather than a set of zeroes:
   * feature 001's workspace already says why the screen is empty, and a mass of
   * `0 t` is a number a Commander could act on.
   */
  readonly shown = computed(() => this.view() !== null);

  /**
   * The load the headline mass and the envelope were both read at.
   *
   * The canvas states it on the same line as the headline, above
   * `SPEED ENVELOPE AT THIS MASS`. The mass and the envelope are one reading of
   * one ship, and this is what names which of the three loads that is: without
   * it, six figures would be left to be inferred from.
   */
  readonly envelopeLoad = computed(() => {
    const load = this.view()?.thrusters.envelopeLoad;
    return load ? this.#messages.message(LOAD_LABELS[load]) : null;
  });

  /**
   * The canvas's `7A · DIRTY DRIVES G5` and `6A · INCREASED RANGE G5`.
   *
   * The module's class and rating with the blueprint worked into it, and not
   * its name: the canvas heads each card with what the module *is* — `THRUSTER
   * LOAD`, `FRAME SHIFT DRIVE` — so printing `Enhanced Performance Thrusters`
   * beside that heading says the same thing twice. What the class adds is the
   * size and grade of the one fitted, which the heading cannot say.
   */
  readonly thrusterRating = computed(() => this.#rating('thrusters'));
  readonly driveRating = computed(() => this.#rating('drive'));

  /** `Switched off`, on a mount the outfitting panel has turned off. */
  readonly thrusterOff = computed(() => this.view()?.thrusters.source.on === false);
  readonly driveOff = computed(() => this.view()?.drive.source.on === false);

  /**
   * The canvas's headline `1,142` — what the build weighs at this load.
   *
   * `buildMass(load).total`, copied. `null` on a load the package could not
   * resolve, where the headline says so rather than showing a figure.
   */
  readonly loadedMass = computed(() => {
    const total = this.view()?.thrusters.mass?.total;
    return total === undefined ? null : this.#tonnes(total);
  });

  /** The canvas's `91% OF OPTIMAL MASS`, beside the mass it qualifies. */
  readonly massCurvePosition = computed(() => {
    const position = this.view()?.thrusters.massCurvePosition;
    return position === null || position === undefined
      ? null
      : this.#messages.message('drives.thrusters.curve-position', {
          percent: this.#formatters.percent(position),
        });
  });

  /**
   * The canvas's `SCO` badge, drawn only on a drive the catalogue marks.
   *
   * An ordinary hyperdrive is not Overcharge-capable, and the canvas has no
   * badge for that — so the badge is absent rather than negated.
   */
  readonly supercruiseOvercharge = computed(
    () => this.view()?.drive.supercruiseOvercharge === true,
  );

  /**
   * The legend under the canvas's bar: hull, modules and fuel, one row each.
   *
   * All three figures come from one `buildMass()` call — the package's own
   * split, the mass counterpart of `buildCost()`. Nothing here is summed or
   * apportioned. Each row carries the swatch of the bar segment it explains, so
   * a part of the bar is identified by its position in this list as well as by
   * its colour.
   */
  readonly massSegments = computed<readonly LegendRowView[]>(() => {
    const view = this.view();
    if (!view) {
      return [];
    }
    const { mass, fittedModuleCount } = view.thrusters;

    return [
      {
        id: 'hull',
        tone: 'strong',
        label: this.#messages.message('drives.thrusters.hull'),
        // The canvas's `ANACONDA · MILITARY GRADE`: the hull this mass belongs
        // to and the bulkhead fitted to it, both package identities.
        detail: this.#hullDetail(),
        value: mass ? this.#tonnes(mass.hull) : null,
      },
      {
        id: 'modules',
        tone: 'dim',
        label: this.#messages.message('drives.thrusters.modules'),
        // The canvas's `22 FITTED`: how many rows the package returns, beside
        // what the package says they weigh together.
        detail: this.#messages.message('drives.thrusters.modules.fitted', {
          count: this.#formatters.integer(fittedModuleCount),
        }),
        value: mass ? this.#tonnes(mass.modules) : null,
      },
      {
        id: 'fuel',
        tone: 'deep',
        label: this.#messages.message('drives.thrusters.fuel'),
        // The canvas's `TANK`: which of the ship's two stores this part of the
        // mass is. The revision of 2026-08-25 cut the capacities that stood
        // beside the word, so `fuelCapacity` is no longer drawn anywhere and by
        // this project's own rule is no longer read either. The figure at the
        // row's end is untouched — it is the fuel part of the one
        // `buildMass(load)` answer the whole legend comes from, never a tank
        // capacity.
        detail: this.#messages.message('drives.thrusters.fuel.tank'),
        value: mass ? this.#tonnes(mass.fuel) : null,
      },
    ];
  });

  /**
   * The canvas's bar itself: the three parts laid end to end on one scale.
   *
   * The scale is the thrusters' maximum supported mass, which is the arithmetic
   * the canvas draws — its `400`, `662` and `80` run 21.16%, 35.03% and 4.23% of
   * a track whose end is its `MAX 1,890 t`, and its optimal mark stands at
   * 1,260 of the same 1,890. So the parts add up to what the build weighs, and
   * the length they reach is that weight measured against the one ceiling the
   * fitted thrusters have.
   *
   * Absent rather than empty on a thruster publishing no curve: without a
   * maximum there is no scale, and a bar drawn to some other end would be this
   * application choosing what the build is being measured against. The legend
   * below it keeps every figure either way.
   *
   * The three divisions here are bar lengths and nothing else. Not one of them
   * is drawn as a number, and every mass on this card is printed from the
   * package's own figure.
   */
  readonly massBar = computed<MassBarView | null>(() => {
    const thrusters = this.view()?.thrusters;
    const mass = thrusters?.mass;
    const curve = thrusters?.curve;
    if (!mass || !curve || curve.maxMass <= 0) {
      return null;
    }
    const track = curve.maxMass;
    // On the same track, so the mark lands where the optimal mass actually
    // falls against the parts beside it. Past the end of the track it is not
    // drawn at all rather than pinned to the end, which would put it where the
    // maximum is and say the two are the same.
    const drawsOptimal = curve.optMass > 0 && curve.optMass <= track;
    const optimal = curve.optMass / track; // policy-allow: SC-002 bar position

    return {
      segments: [
        { id: 'hull', tone: 'strong', size: mass.hull / track }, // policy-allow: SC-002 bar length
        { id: 'modules', tone: 'dim', size: mass.modules / track }, // policy-allow: SC-002 bar length
        { id: 'fuel', tone: 'deep', size: mass.fuel / track }, // policy-allow: SC-002 bar length
      ],
      optimal: drawsOptimal ? optimal : null,
    };
  });

  /**
   * The canvas's `ANACONDA · MILITARY GRADE`, or the hull alone.
   *
   * The bulkhead is a fixed mount the package populates, so it is normally
   * there; a build whose bulkhead the package does not name drops that half
   * rather than printing a separator with nothing after it.
   */
  #hullDetail(): string | null {
    const hull = this.#active.hullName();
    const symbol = this.view()?.thrusters.bulkhead.symbol;
    const bulkhead = symbol ? this.#gameText.moduleName(symbol).text : null;

    if (hull && bulkhead) {
      return this.#messages.message('drives.thrusters.hull.detail', { hull, bulkhead });
    }
    return hull ?? bulkhead;
  }

  /**
   * The canvas's `OPTIMAL 1,260 t` and `MAX 1,890 t`, written under the bar.
   *
   * Both are thruster stats the package publishes, and both belong to the bar
   * rather than beside it: they are the scale it is drawn on, so they are set
   * on the same block, under the positions they mark. `OPTIMAL` sits under its
   * own tick and `MAX` at the end of the track, because the end of the track is
   * where the maximum is — which is why the maximum needs no tick of its own.
   */
  readonly curveMarks = computed<readonly CurveMarkView[]>(() => {
    const curve = this.view()?.thrusters.curve;
    if (!curve) {
      return [];
    }
    const optimal = this.massBar()?.optimal ?? null;
    return [
      {
        id: 'optimal',
        label: this.#messages.message('drives.thrusters.optimal-mass'),
        value: this.#tonnes(curve.optMass),
        position: optimal,
      },
      {
        id: 'maximum',
        label: this.#messages.message('drives.thrusters.maximum-mass'),
        value: this.#tonnes(curve.maxMass),
        position: null,
      },
    ];
  });

  /**
   * `SPEED ENVELOPE AT THIS MASS`: the five readings the canvas bars.
   *
   * The bars are decoration and say so: each is scaled against the largest
   * reading in its own group, because the package publishes no maximum speed or
   * rotation rate for a build to be measured against. The number beside every
   * bar is the package's, and is what is read.
   */
  readonly envelope = computed<readonly EnvelopeRowView[]>(() => {
    const thrusters = this.view()?.thrusters;
    const mobility = thrusters?.mobility;
    const capacitor = thrusters?.capacitor;
    if (!mobility || !capacitor) {
      return [];
    }
    // Four of the five move with the ENG allocation and come from the
    // capacitor; boost ignores the allocation and the package states it on the
    // envelope itself (Almanac 0.2.0).
    const fastest = Math.max(capacitor.speed, mobility.boost) || 1;
    const quickest = Math.max(capacitor.pitch, capacitor.roll, capacitor.yaw) || 1;

    return [
      this.#speedRow('speed', 'drives.thrusters.speed', capacitor.speed, fastest),
      this.#speedRow('boost', 'drives.thrusters.boost', mobility.boost, fastest),
      this.#rotationRow('pitch', 'drives.thrusters.pitch', capacitor.pitch, quickest),
      this.#rotationRow('roll', 'drives.thrusters.roll', capacitor.roll, quickest),
      this.#rotationRow('yaw', 'drives.thrusters.yaw', capacitor.yaw, quickest),
    ];
  });

  /** The package's own reasons the mobility reading is unavailable, in its order. */
  readonly mobilityIssues = computed<readonly GameTextPresentation[]>(() => {
    const thrusters = this.view()?.thrusters;
    if (!thrusters || thrusters.mobility) {
      return [];
    }
    return thrusters.issues.map((issue) => this.#gameText.calculationIssueMessage(issue));
  });

  /**
   * The package's own reasons there is no range to draw.
   *
   * The drive is guarded before the package is asked to jump, so an unusable
   * one is a set of issues rather than a thrown error — and the thruster card
   * beside it stays whole (FR-003).
   */
  readonly driveIssues = computed<readonly GameTextPresentation[]>(() => {
    const drive = this.view()?.drive;
    if (!drive || drive.profiles.length > 0) {
      return [];
    }
    return drive.issues.map((issue) => this.#gameText.calculationIssueMessage(issue));
  });

  /**
   * The hull's mass lock factor, formatted, on the line under the drive card's
   * heading. It is the hull's own catalogue fact and answers whether or not the
   * drive can be read, so the line is drawn for every build. `null` means the
   * catalogue does not carry the hull, and the line then shows the shared
   * unavailable wording, never `0`.
   */
  readonly massLock = computed(() => {
    const massLock = this.view()?.drive.massLock ?? null;
    return massLock === null ? null : this.#formatters.integer(massLock);
  });

  /**
   * `RANGE BY LOAD`, in the canvas's order: unladen, fuelled, full cargo.
   *
   * One figure a row, as the canvas draws them. The whole tank is a reading of
   * its own that it draws once, under the ranges — see {@link driveFacts}.
   */
  readonly ranges = computed<readonly RangeRowView[]>(() => {
    const profiles = this.view()?.drive.profiles ?? [];
    const furthest = Math.max(...profiles.map((profile) => profile.range), 0) || 1;

    return profiles.map((profile) => ({
      id: profile.load,
      label: this.#messages.message(LOAD_LABELS[profile.load]),
      range: this.#formatters.lightYears(profile.range, RANGE_DIGITS),
      fill: profile.range / furthest, // policy-allow: SC-002 bar length
    }));
  });

  /**
   * The canvas's legend under `RANGE BY LOAD`: the drive's own three constants.
   *
   * `FSD optimal mass`, `Fuel per jump` and `Total range`, each with the
   * canvas's qualifier run in beside it and its figure at the end of the row —
   * the same swatch, name and figure the mass legend on the other card takes,
   * in the same three-colour ramp. The canvas draws the two blocks identically,
   * so they are one shape here.
   */
  readonly driveFacts = computed<readonly LegendRowView[]>(() => {
    const drive = this.view()?.drive;
    if (!drive) {
      return [];
    }
    const facts: LegendRowView[] = [
      {
        id: 'opt-mass',
        tone: 'strong',
        label: this.#messages.message('drives.fsd.optimal-mass'),
        // The canvas's `6A + MASS MANAGER · 658 T OF HEADROOM`: which
        // experimental effect this optimal mass is the result of, and how much
        // more the build can take on before it stops jumping the way the rows
        // above say it does. The class and rating beside them on the canvas are
        // already on the card's identity line and are not repeated.
        detail: this.#optimalMassDetail(),
        // Null on a drive the package cannot read its own constants off. The
        // row stays, and says it has no figure rather than showing a zero.
        value: drive.optMass === null ? null : this.#tonnes(drive.optMass),
      },
      {
        id: 'max-fuel',
        tone: 'dim',
        label: this.#messages.message('drives.fsd.maximum-fuel'),
        // The canvas's `MAX DRAW AT FULL RANGE`: what the figure is a maximum
        // of, which the label alone does not say.
        detail: this.#messages.message('drives.fsd.maximum-fuel.description'),
        value: drive.maxFuel === null ? null : this.#fuelTonnes(drive.maxFuel),
      },
    ];
    // The canvas's `Total range` / `8 JUMPS ON A FULL TANK`. One reading, drawn
    // once, rather than a total on each of the three rows above it.
    if (drive.totalRange) {
      facts.push({
        id: 'total-range',
        tone: 'deep',
        label: this.#messages.message('drives.fsd.total-range'),
        detail: this.#messages.message('drives.fsd.total-range.jumps', {
          jumps: this.#formatters.integer(drive.totalRange.jumps),
        }),
        value: this.#formatters.lightYears(drive.totalRange.range, TOTAL_RANGE_DIGITS),
      });
    }
    return facts;
  });

  /**
   * The canvas's qualifier beside `FSD optimal mass`.
   *
   * The drive's experimental effect and the mass this build has left under that
   * optimal, joined the way the canvas joins them, and either alone where the
   * other has nothing to say.
   */
  #optimalMassDetail(): string | null {
    const effect = this.#experimentalEffect();
    const headroom = this.#headroom();
    if (effect === null || headroom === null) {
      return effect ?? headroom;
    }
    return this.#messages.message('drives.fsd.optimal-mass.detail', { effect, headroom });
  }

  /**
   * The canvas's `658 T OF HEADROOM`: the drive's optimal mass less this load.
   *
   * Not a calculation performed on the game's behalf but the difference between
   * two package answers already on this screen — the drive's own `optMass` and
   * the `buildMass(load).total` the other card heads with — which is what a
   * headroom is. Both have to be there: a load the package could not settle
   * leaves the row with its optimal mass and no qualifier rather than a headroom
   * measured against a mass that was assumed (FR-008, constitution IV).
   *
   * A build at or over the optimal mass is told how far over instead. A negative
   * headroom is a figure with a sign in front of it rather than a sentence.
   */
  #headroom(): string | null {
    const view = this.view();
    // Named as the package names them, so the ownership rule reads this line as
    // the combination it is. A local called something else would slip past a
    // fence that is watching for these words, and a fence got past quietly is
    // worse than no fence: the marker below is the record that this crossing
    // was ruled on, and it only records anything if there was something to
    // cross (`scripts/policy/mobility-jump-ownership.mjs`).
    const optMass = view?.drive.optMass;
    const total = view?.thrusters.mass?.total;
    if (optMass === null || optMass === undefined || total === undefined) {
      return null;
    }
    const gap = optMass - total; // policy-allow: FR-008's headroom, ruled 2026-08-26
    return gap >= 0
      ? this.#messages.message('drives.fsd.optimal-mass.headroom', { mass: this.#tonnes(gap) })
      : this.#messages.message('drives.fsd.optimal-mass.over', { mass: this.#tonnes(-gap) });
  }

  /**
   * The drive's experimental effect, in the Commander's language.
   *
   * `null` on a stock drive and on an engineered one carrying no effect: both
   * are no effect, and neither is an effect named nothing.
   */
  #experimentalEffect(): string | null {
    const fdname = this.view()?.drive.source.experimental;
    if (!fdname) {
      return null;
    }
    return this.#gameText.experimentalEffectName(fdname).text ?? fdname;
  }

  #speedRow(id: string, key: MessageKey, value: number, track: number): EnvelopeRowView {
    return {
      id,
      label: this.#messages.message(key),
      value: this.#messages.message('drives.format.metres-per-second', {
        value: this.#formatters.decimal(value, RATE_DIGITS),
      }),
      fill: value / track, // policy-allow: SC-002 bar length
    };
  }

  #rotationRow(id: string, key: MessageKey, value: number, track: number): EnvelopeRowView {
    return {
      id,
      label: this.#messages.message(key),
      value: this.#messages.message('drives.format.degrees-per-second', {
        value: this.#formatters.decimal(value, RATE_DIGITS),
      }),
      fill: value / track, // policy-allow: SC-002 bar length
    };
  }

  #tonnes(value: number): string {
    return this.#messages.message('drives.format.tonnes', {
      value: this.#formatters.decimal(value, MASS_DIGITS),
    });
  }

  /** A fuel quantity, at the finer precision the canvas writes those at. */
  #fuelTonnes(value: number): string {
    return this.#messages.message('drives.format.tonnes', {
      value: this.#formatters.decimal(value, FUEL_DIGITS),
    });
  }

  #rating(card: 'thrusters' | 'drive'): string | null {
    const view = this.view();
    if (!view) {
      return null;
    }
    const source = card === 'thrusters' ? view.thrusters.source : view.drive.source;
    if (!source.rating) {
      return null;
    }
    if (!source.blueprint || source.grade === null) {
      return source.rating;
    }
    const blueprint = this.#gameText.blueprintName(source.blueprint);
    return this.#messages.message('drives.source.engineered', {
      rating: source.rating,
      blueprint: blueprint.text ?? source.blueprint,
      grade: this.#formatters.integer(source.grade),
    });
  }
}
