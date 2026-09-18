import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import type { FittedWeaponMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import type { Convergence } from '../../../../domain/ships/offence/convergence';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { engineeringSummary } from '../../../../application/outfitting/engineering-summary';
import { hardpointCoverage } from '../../../../application/outfitting/hardpoint-coverage.adapter';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import type { SlotView } from '../../../../application/outfitting/slot-view';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  projectOffence,
  type ConventionalDamageType,
  type Endurance,
  type Offence,
} from '../../../../domain/ships/offence/offence';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { GameTextPresenter, type GameTextPresentation } from '../../../../i18n/game-text.presenter';
import type { MessageKey } from '../../../../i18n/locale-registry';
import { MessageService } from '../../../../i18n/message.service';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { ModuleIdentityBadge } from '../../../../ui/outfitting/module-identity-badge';
import { ShotConvergence } from './shot-convergence/shot-convergence';

/**
 * One weapon as the canvas's six columns.
 *
 * The row is inert, as the canvas draws it: no disclosure, no action and no
 * slot of its own (`design/canvas-contract.md`, "1. WEAPONS"). A mount is
 * reached from `HULL ANATOMY`, which is where the canvas puts that control.
 */
export interface WeaponRowView {
  /** The weapon's exact package slot key. The row's identity, and its handoff. */
  readonly id: string;
  /** The module's name in the Commander's language, with its translation state. */
  readonly name: GameTextPresentation;
  /** The canvas's `4A`: the module's class and its rating, as two package values. */
  readonly moduleClass: number | null;
  readonly rating: string | null;
  /** The mount as the package names it, for the badge to say in words. */
  readonly mount: string | null;
  /** What follows the mount on the canvas's code line: `OVERCHARGED G5`. */
  readonly engineering: string | null;
  /** The canvas's `DPS BURST` column. */
  readonly damagePerSecond: string;
  /** The canvas's `SUSTAINED` column, beside the burst figure. */
  readonly sustainedDamagePerSecond: string;
  /** The canvas's `PIERCE` column. `null` where the package returned none. */
  readonly piercing: string | null;
  /** The canvas's `RANGE` column. `null` where the package returned none. */
  readonly maximumRange: string | null;
  /** The canvas's `FALLOFF` column. `null` where the package returned none. */
  readonly falloff: string | null;
  /** Whether the weapon is switched off. Its row and its metrics stay either way. */
  readonly off: boolean;
  readonly offLabel: string;
}

/**
 * One of the canvas's label-bar-figure rows.
 *
 * `fill` is the bar, as a fraction of the largest figure the row is drawn
 * beside. It is `null` where nothing shares a scale with the row, and then no
 * track is drawn at all: an empty bar reads as a figure of nothing, which is
 * not what "there is nothing to measure this against" means.
 */
export interface BarRowView {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly fill: number | null;
  /**
   * What the value stands for, where the value is a symbol rather than words.
   *
   * `∞` is drawn and its sentence is said beside it, kept out of sight — the
   * pattern `defence.damage.unbounded` and `power.heat.does-not-settle`
   * already use. A symbol nobody can read aloud is not a reading on its own.
   */
  readonly meaning: string | null;
}

/** One segment of the canvas's stacked kinetic-against-thermal bar. */
export interface DamageSegmentView {
  readonly id: string;
  /** The canvas's legend line: `Kinetic 165.8 · 67%`. */
  readonly legend: string;
  /** The segment's width over the whole bar, in `[0, 1]`. */
  readonly width: number;
}

/**
 * The damage types the stacked bar can carry, as message keys.
 *
 * Written out rather than composed from the field name, because `MessageKey` is
 * the catalogue's own key union — a template-built key would compile without
 * ever proving the message exists. The `satisfies` is what holds the set
 * complete: a conventional type added to the package appears here as a
 * compilation failure rather than as a segment nobody can name.
 */
const DAMAGE_TYPE_LABELS = {
  kinetic: 'offence.damage.type.kinetic',
  thermal: 'offence.damage.type.thermal',
  explosive: 'offence.damage.type.explosive',
  caustic: 'offence.damage.type.caustic',
  absolute: 'offence.damage.type.absolute',
  unclassified: 'offence.damage.type.unclassified',
} as const satisfies Record<ConventionalDamageType, MessageKey>;

/** Damage rates to one place, as the canvas sets every figure in this panel. */
const DAMAGE_DIGITS = 1;
/**
 * The block's energy figures to two places, which is what canvas 1c draws its
 * `DRAW` and `RECHARGE` to. `FULL FIRE` is a duration and takes
 * {@link SECONDS_DIGITS}.
 *
 * The capacity takes this precision for being in the same block, not for being
 * drawn that way: two places is a precision the artboard never uses for a
 * capacity, which it draws as `38.4 MJ` in canvas 1c's distributor table and as
 * `CAP 61 MJ` on 1d. Feature 005 writes that same quantity to one place, and
 * the split is recorded rather than settled
 * (`openspec/changes/archive/005-power-and-heat/contracts/distributor-metrics.md`).
 */
const ENERGY_DIGITS = 2;
/** Durations to one, which is the place canvas 1c's `FULL FIRE 14.2 s` sets. */
const SECONDS_DIGITS = 1;
/** Pips to one, because the game's own allocation moves on a half step. */
const PIP_DIGITS = 1;

/**
 * `OFFENCE ANALYSIS`: what this build's weapons do.
 *
 * Canvas 1c draws it as the `OFFENCE` mode of the hull anatomy region — the
 * `WEAPONS` block against `DAMAGE PROFILE` in a `1fr 1fr` pair. Canvas 1d
 * stacks the same content. Same DOM at both widths; which arrangement appears
 * is decided in CSS from the space the region is given, so a 400% zoom picks
 * the stacked one for the same reason a phone does.
 *
 * Every figure here is a package answer selected by
 * `src/app/domain/ships/offence/offence.ts`, which is also where the canvas's shares,
 * range bands and gunsight geometry are worked out — one place, from the
 * package's own `damageFalloff` and `projectGunsight`. This component formats
 * and names those answers and does no arithmetic of its own.
 */
@Component({
  selector: 'ednb-offence-analysis',
  imports: [ModuleIdentityBadge, NgTemplateOutlet, ShotConvergence],
  templateUrl: './offence-analysis.html',
  styleUrl: './offence-analysis.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffenceAnalysis {
  readonly #active = inject(ActiveBuildStore);
  readonly #outfitting = inject(OutfittingStore);
  readonly #conditions = inject(PowerConditionsStore);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);

  readonly weaponsHeadingId = relationId('offence-weapons');
  readonly damageHeadingId = relationId('offence-damage');
  readonly convergenceHeadingId = relationId('offence-convergence');
  readonly rangeBandsHeadingId = relationId('offence-range-bands');
  readonly capacitorHeadingId = relationId('offence-capacitor');

  readonly weaponsHeading = this.#messages.messageSignal('offence.weapons.heading');
  readonly damageHeading = this.#messages.messageSignal('offence.damage.heading');
  readonly damageNote = this.#messages.messageSignal('offence.damage.note');
  readonly emptyStatement = this.#messages.messageSignal('offence.weapons.empty');
  readonly unavailableStatement = this.#messages.messageSignal('offence.weapons.unavailable');
  readonly notStated = this.#messages.messageSignal('offence.detail.not-stated');
  readonly capacitorHeading = this.#messages.messageSignal('offence.capacitor.heading');
  readonly rangeBandsHeading = this.#messages.messageSignal('offence.damage.range-bands');
  readonly convergenceHeading = this.#messages.messageSignal('offence.convergence.heading');
  readonly convergenceUnavailable = this.#messages.messageSignal('offence.convergence.unavailable');
  readonly damageBarLabel = this.#messages.messageSignal('offence.damage.bar');

  /**
   * The convergence plate, where it is drawn at all.
   *
   * Read for one figure only — the ring caption the canvas now puts on this
   * block's heading line. Nothing is pushed the other way: the plate is handed
   * its geometry as an input and decides everything else about itself.
   */
  protected readonly plate = viewChild(ShotConvergence);

  /**
   * The hardpoint the workspace currently has selected, if any.
   *
   * Handed to the convergence plate so the mount a Commander is working on is
   * marked there as it already is on the hull schematics and in the ledger row.
   * Read through rather than reached for by the plate itself: the selection
   * belongs to the workspace, and a diagram that injected the store would be a
   * component that cannot be previewed from its inputs.
   */
  readonly selectedSlot = this.#outfitting.selectedSlotKey;

  /** The canvas's six column heads, in its order. */
  readonly columns = computed(() => ({
    module: this.#messages.message('offence.column.module'),
    damagePerSecond: this.#messages.message('offence.column.dps'),
    sustainedDamagePerSecond: this.#messages.message('offence.column.sustained'),
    piercing: this.#messages.message('offence.column.pierce'),
    maximumRange: this.#messages.message('offence.column.range'),
    falloff: this.#messages.message('offence.column.falloff'),
  }));

  /**
   * The projection for the active build at feature 005's WEP allocation.
   *
   * `revision()` is read first because the loadout signal holds one mutable
   * package object: an edit changes what it contains without changing the
   * reference, so the revision is what actually says "this is different now".
   *
   * Hardpoint coverage comes from feature 002's slot views at the same
   * revision, so this panel and the ledger cannot disagree about what is
   * fitted. A weapon count is never asked instead.
   */
  readonly projection = computed<Offence | null>(() => {
    this.#active.revision();
    const loadout = this.#active.loadout();
    if (loadout === null) {
      return null;
    }
    return projectOffence(
      loadout,
      hardpointCoverage(this.#outfitting.slots()),
      this.#conditions.pips().weapons,
    );
  });

  /** Nothing is drawn without a build. The workspace already says why it is empty. */
  readonly shown = computed(() => this.projection() !== null);

  /** The canvas's `5 MOUNTED`: how many weapons the package returned. */
  readonly mounted = computed(() => {
    const offence = this.projection();
    return offence === null
      ? null
      : this.#messages.message('offence.weapons.mounted', {
          count: this.#formatters.integer(offence.weapons.length),
        });
  });

  readonly collection = computed(() => this.projection()?.collection ?? null);

  /**
   * The canvas's headline pair: `248.6` against `DPS BURST · 186.4 SUSTAINED`.
   *
   * The large figure is the burst total and the line beside it names both it
   * and the sustained total, exactly as canvas 1c sets them. Both are named in
   * full because the canvas's own two panels disagree about which of the two
   * its large figure is — 1c calls `248.6` burst and 1d calls the same number
   * sustained (`design/canvas-contract.md`, "Every sample figure").
   */
  readonly headline = computed<{ value: string; note: string } | null>(() => {
    const total = this.projection()?.build.total;
    if (total === undefined) {
      return null;
    }
    return {
      value: this.#perSecond(total.damagePerSecond),
      note: this.#messages.message('offence.weapons.headline', {
        sustained: this.#perSecond(total.sustainedDamagePerSecond),
      }),
    };
  });

  /**
   * The canvas's stacked kinetic-against-thermal bar, and the legend under it.
   *
   * The segments are the projection's: each is a package amount over the sum of
   * the amounts drawn beside it. The legend states every segment's amount and
   * its share in words, so the bar carries nothing that is not also written
   * down — a length and a colour are not a reading on their own (011 FR-010).
   */
  readonly damageSegments = computed<readonly DamageSegmentView[]>(() =>
    (this.projection()?.damageSegments ?? []).map((segment) => ({
      id: segment.type,
      legend: this.#messages.message('offence.damage.legend', {
        type: this.#messages.message(DAMAGE_TYPE_LABELS[segment.type]),
        amount: this.#perSecond(segment.amount),
        share: this.#formatters.percent(segment.share),
      }),
      width: segment.share,
    })),
  );

  /**
   * `DPS BY RANGE BAND`: what the enabled weapons land at four distances.
   *
   * The figures come from the package's own `damageFalloff`, applied per weapon
   * in the projection. Each bar is that band over the strongest band, so the
   * four are read against each other rather than against a ceiling nobody
   * stated.
   */
  readonly rangeBands = computed<readonly BarRowView[]>(() =>
    (this.projection()?.rangeBands ?? []).map((band) => ({
      id: String(band.metres),
      label: this.#formatters.metres(band.metres),
      value: this.#perSecond(band.damagePerSecond),
      fill: band.fill,
      meaning: null,
    })),
  );

  /**
   * The hull's placed hardpoints, or `null` where the catalogue does not place
   * them.
   *
   * The block decides here which of its two forms it takes, and the plate
   * itself is drawn by `ShotConvergence` from the geometry this hands it. A
   * hull whose gunsight does not line up with its hardpoints is stated in
   * words rather than drawn from part of its mounts: a diagram with nothing on
   * it reads as a build whose shots all converge, which is the opposite of
   * "we cannot place them" (FR-010).
   */
  readonly convergenceGeometry = computed<Extract<Convergence, { kind: 'available' }> | null>(
    () => {
      const geometry = this.projection()?.convergence;
      return geometry === undefined || geometry.kind === 'unavailable' ? null : geometry;
    },
  );

  /**
   * `WEAPON CAPACITOR`: the four fields a canvas draws, as the canvas's rows.
   *
   * Canvas 1c draws three rows — `DRAW`, `RECHARGE`, `FULL FIRE`, in that
   * order — and canvas 1d's `WEP CAP` chip supplies the capacity behind
   * them, so four is what the canvases between them ask for and this is the
   * arrangement they ask for it in. `netDrainRate` and the
   * package's echoed `weaponsPips` are not selected at all — the rule feature
   * 005 set for `headroom`, `utilisation` and `withinBudget`.
   *
   * Only two of the four get a bar. `DRAW` and `RECHARGE` are the same quantity
   * in the same unit, and which of them is larger is the whole question the
   * block answers, so they are drawn against the larger of the two. A stored
   * pool and a duration share a scale with nothing on the screen; the canvas
   * gives each of them a bar anyway, against a ceiling it never states, and a
   * length that measures nothing is not a reading
   * (`design/canvas-contract.md`, review note 6).
   *
   * `DRAW` and `RECHARGE` carry the package's own unit: canvas 1c labels both
   * `MW` and the package returns megajoules per second for both, so the
   * package wins. `CAPACITY` is the one exception, and it is not a package
   * unit at all — it is the game's, which writes `MW` after a capacitor pool
   * in the panel a Commander cross-checks (`contracts/capacitor-endurance.md`,
   * ruled 2026-08-27).
   *
   * Nothing here says why a figure is what it is. A zero capacity is the
   * package's own result, the package documents several ways to reach one and
   * does not say which applied, so no cause is stated, offered or placed
   * beside it (FR-007).
   */
  readonly capacitorRows = computed<readonly BarRowView[]>(() => {
    const capacitor = this.projection()?.capacitor;
    if (capacitor === undefined) {
      return [];
    }

    return [
      {
        id: 'draw',
        label: this.#messages.message('offence.capacitor.draw'),
        value: this.#megajoulesPerSecond(capacitor.sustainedEnergyPerSecond),
        fill: capacitor.drawFill,
        meaning: null,
      },
      {
        id: 'recharge',
        label: this.#messages.message('offence.capacitor.recharge'),
        value: this.#megajoulesPerSecond(capacitor.rechargeRate),
        fill: capacitor.rechargeFill,
        meaning: null,
      },
      {
        id: 'endurance',
        label: this.#messages.message('offence.capacitor.endurance'),
        ...this.#endurance(capacitor.endurance),
        fill: null,
      },
      {
        id: 'capacity',
        label: this.#messages.message('offence.capacitor.capacity'),
        value: this.#megawatts(capacitor.capacity),
        fill: null,
        meaning: null,
      },
    ];
  });

  /**
   * The WEP allocation those four figures were read at.
   *
   * Said once under the block rather than on each row. Two of the four move
   * when the allocation moves, and a figure that changes with a condition shown
   * without that condition is the misleading number constitution IV forbids. It
   * is text, not a control: the canvas draws the pip control in `POWER`, and it
   * stays there.
   */
  readonly capacitorAllocation = computed(() => {
    const capacitor = this.projection()?.capacitor;
    return capacitor === undefined
      ? null
      : this.#messages.message('offence.capacitor.allocation', {
          pips: this.#formatters.decimal(capacitor.allocation, PIP_DIGITS),
        });
  });

  /**
   * Which of the three things `timeToDrain` said, in words.
   *
   * The projection has already read the field and decided; this only names the
   * decision. Neither sentinel reaches a formatter: `Infinity` would render as
   * a symbol nobody can read aloud, and a zero would render as a duration that
   * claims the weapons fire for no time rather than that the capacitor is
   * already empty.
   */
  #endurance(endurance: Endurance): { value: string; meaning: string | null } {
    switch (endurance.kind) {
      case 'finite':
        return {
          value: this.#messages.message('offence.format.seconds', {
            value: this.#formatters.decimal(endurance.seconds, SECONDS_DIGITS),
          }),
          meaning: null,
        };
      case 'immediate':
        return {
          value: this.#messages.message('offence.capacitor.endurance.immediate'),
          meaning: null,
        };
      case 'sustained':
        // A recharge that keeps pace is drawn as the symbol and said in words
        // beside it, out of sight. The projection decided the state; neither
        // half of this re-reads the package's sentinel.
        return {
          value: this.#messages.message('offence.capacitor.endurance.sustained'),
          meaning: this.#messages.message('offence.capacitor.endurance.sustained.meaning'),
        };
    }
  }

  /**
   * The mounts of the active build, by their exact package slot key.
   *
   * Feature 002's own views, so a weapon row's name and the code line under it
   * are the ones the ledger draws for the same module rather than a second
   * rendering of the same package record.
   */
  readonly #mounts = computed<ReadonlyMap<string, SlotView>>(
    () => new Map(this.#outfitting.slots().map((slot) => [slot.key, slot])),
  );

  /**
   * One row per returned weapon, in the package's own order.
   *
   * The collection neither sorts nor merges: two mounts carrying the same
   * module are two rows, as the canvas draws them, and each is identified by
   * its exact slot key rather than by its position or its symbol.
   */
  readonly weaponRows = computed<readonly WeaponRowView[]>(() =>
    (this.projection()?.weapons ?? []).map((weapon) => this.#weaponRow(weapon)),
  );

  #weaponRow(fitted: FittedWeaponMetrics): WeaponRowView {
    const mount = this.#mounts().get(fitted.slot);
    // The ledger's own presentation where the mount resolved, and the package's
    // own symbol where it did not: a weapon the package measured in a slot the
    // hull layout does not name is still a weapon, and it keeps its identity.
    const name = mount?.module?.displayName ?? this.#gameText.moduleName(fitted.symbol);

    const article = mount?.module?.article;

    return {
      id: fitted.slot,
      name,
      // Three package values, never a code parsed back out of the symbol: `4A`
      // looks readable off `Hpt_MultiCannon_Gimbal_Huge` and that habit is
      // already wrong on some hulls (constitution II).
      moduleClass: article?.class ?? null,
      rating: article?.rating ?? null,
      mount: article?.mount ?? null,
      engineering:
        mount?.module == null
          ? null
          : engineeringSummary(mount.module, this.#gameText, this.#messages),
      damagePerSecond: this.#perSecond(fitted.metrics.damagePerSecond),
      // The canvas's `SUSTAINED` column, added by the 2026-08-29 revision
      // together with the rename of the column beside it. The package's own
      // per-weapon figure, which is what the headline above already states as a
      // build total; a continuous-fire weapon carries the same number in both
      // cells because the package returns the same number twice, not because
      // one was copied from the other.
      sustainedDamagePerSecond: this.#perSecond(fitted.metrics.sustainedDamagePerSecond),
      // The canvas's `RANGE` column, added by the 2026-08-25 revision. The
      // package's own `maximumRange`, which the projection already carries for
      // the range bands: nothing is derived from it here and nothing caps it.
      maximumRange:
        fitted.maximumRange === undefined ? null : this.#formatters.metres(fitted.maximumRange),
      // Absent is field-specific not-stated text, never a zero and never a dash
      // standing in for a number: the package returns no piercing factor for
      // some weapons and a genuine zero for others (FR-004).
      piercing:
        fitted.armourPiercing === undefined
          ? null
          : this.#formatters.integer(fitted.armourPiercing),
      falloff:
        fitted.falloffRange === undefined ? null : this.#formatters.metres(fitted.falloffRange),
      off: !fitted.enabled,
      offLabel: this.#messages.message('offence.weapon.off'),
    };
  }

  /**
   * The capacitor's capacity, in the unit the game's own panel writes after it.
   *
   * The same reading, and the same reasoning, as feature 005's distributor
   * table: the figure is the package's `capacity` untouched, and only the unit
   * after it moved from `MJ` to the `MW` the outfitting panel writes (ruled
   * 2026-08-27). The two blocks state one quantity and now state it in one
   * unit; `DRAW` and `RECHARGE` keep the `MJ/s` they are actually in.
   */
  #megawatts(value: number): string {
    return this.#messages.message('offence.format.megawatts', {
      value: this.#formatters.decimal(value, ENERGY_DIGITS),
    });
  }

  #megajoulesPerSecond(value: number): string {
    return this.#messages.message('offence.format.megajoules-per-second', {
      value: this.#formatters.decimal(value, ENERGY_DIGITS),
    });
  }

  /**
   * A damage rate, set bare as both canvases set every one of them.
   *
   * No `/s` is appended. The canvas draws `248.6` under a `DPS` head, `165.8`
   * in the legend and `248.6` in a range band, and suffixing any of them would
   * both add a character the design does not draw and say per second twice,
   * because the head above each already says `DPS`.
   */
  #perSecond(value: number): string {
    return this.#formatters.decimal(value, DAMAGE_DIGITS);
  }
}
