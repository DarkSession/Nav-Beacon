import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  CAPACITOR_KINDS,
  projectPowerHeat,
  type CapacitorKind,
  type HardpointState,
  type HeatScenarioKey,
  type HeatLevelValue,
  type ModuleDrawRow,
  type PowerAndHeat,
} from '../../../../domain/ships/power-heat/power-heat';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { GameTextPresenter, type GameTextPresentation } from '../../../../i18n/game-text.presenter';
import type { MessageKey } from '../../../../i18n/locale-registry';
import { MessageService } from '../../../../i18n/message.service';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { FitText } from '../../../../ui/components/fit-text/fit-text';
import { GameText } from '../../../../ui/components/game-text/game-text';
import type { Metric } from '../../../../ui/components/metric-group/metric-group';
import { MetricGroup } from '../../../../ui/components/metric-group/metric-group';
import { TabGroup, type TabItem } from '../../../../ui/components/tab-group/tab-group';
import { Tooltip } from '../../../../ui/components/tooltip/tooltip';
import { TOTAL_PIPS } from '../../../../application/power-heat/power-conditions.store';
import { UnavailableValue } from '../../../../ui/components/unavailable-value/unavailable-value';
import { DistributorBlock, type BankRowView } from '../distributor-block/distributor-block';

/** One line of `DRAW BY MODULE`: what it is, what it draws, and how far. */
interface ModuleRowView {
  readonly id: string;
  readonly name: GameTextPresentation | null;
  /** Stands in when the package published no symbol to name the row by. */
  readonly fallbackName: string | null;
  /** The canvas's `x2`, or `null` on a line that stands for one mount. */
  readonly count: string | null;
  /** The canvas's `. GRP 4`, drawn only where the plant leaves the group dark. */
  readonly group: string | null;
  /** `Off`, on a line whose mounts are switched off in the outfitting panel. */
  readonly state: string | null;
  readonly draw: string;
  readonly offline: boolean;
  /** How far the bar is filled, in `[0, 1]`. Decoration only. */
  readonly fill: number;
}

/** One priority group as the canvas draws it: figures, a state and a bar. */
interface BandRowView {
  readonly id: string;
  /** The canvas's `GRP 1`. */
  readonly group: string;
  /** This group's own draw, already formatted. */
  readonly draw: string;
  /** Cumulative draw as a percentage of plant, or `null` where none is drawn. */
  readonly share: string | null;
  /** Whether the plant leaves this group dark, which the canvas words. */
  readonly offline: boolean;
  /** Where this group's own length starts on the track, in `[0, 1]`. */
  readonly preceding: number;
  /** How much of the track that length takes, in `[0, 1]`. Decoration only. */
  readonly own: number;
}

/** One bar of `HEAT PROFILE`: what it is, how hot it gets, and how far. */
interface HeatBarView {
  readonly id: string;
  readonly label: string;
  /** What the scenario's name is shorthand for, glossed on the name itself. */
  readonly description: string;
  /** The whole name before the gloss, drawn in the gloss where the name is cut. */
  readonly wholeTip: string;
  /** The gauge reading, or the symbol for the level that never settles. */
  readonly level: string;
  /** What that symbol stands for, in words. `null` on a level that settles. */
  readonly levelMeaning: string | null;
  /** How far the bar runs before the threshold, in `[0, 1]` of the track. */
  readonly within: number;
  /** How far it runs past it, in `[0, 1]` of the track. `0` where it does not. */
  readonly over: number;
  readonly overheats: boolean;
}

/**
 * The scenario names, as message keys.
 *
 * Written out rather than composed from the scenario key, because `MessageKey`
 * is the catalogue's own key union — a template-built key would compile without
 * ever proving the message exists.
 */
const SCENARIO_LABELS = {
  idle: 'power.heat.scenario.idle',
  thrusters: 'power.heat.scenario.thrusters',
  fsdCharging: 'power.heat.scenario.fsd-charging',
  firingSustained: 'power.heat.scenario.firing-sustained',
} as const satisfies Record<HeatScenarioKey, MessageKey>;

/**
 * What each scenario name is shorthand for, likewise written out.
 *
 * The canvas hangs these on a `data-tip`, and so does this — on the design
 * system's own `ednb-tooltip` rather than on a `title`, which opens by press as
 * well as by hover and carries the gloss on `aria-describedby` whether it is
 * drawn or not. Hover-only meaning would still be unreachable by touch
 * (011 FR-006); this is not hover-only.
 */
const SCENARIO_DESCRIPTIONS = {
  idle: 'power.heat.scenario.idle.description',
  thrusters: 'power.heat.scenario.thrusters.description',
  fsdCharging: 'power.heat.scenario.fsd-charging.description',
  firingSustained: 'power.heat.scenario.firing-sustained.description',
} as const satisfies Record<HeatScenarioKey, MessageKey>;

/** The bank names, likewise written out. */
const BANK_LABELS = {
  systems: 'power.distributor.bank.systems',
  engines: 'power.distributor.bank.engines',
  weapons: 'power.distributor.bank.weapons',
} as const satisfies Record<CapacitorKind, MessageKey>;

/** The two hardpoint states, likewise written out. */
const HARDPOINT_LABELS = {
  deployed: 'power.hardpoints.deployed',
  retracted: 'power.hardpoints.retracted',
} as const satisfies Record<HardpointState, MessageKey>;

/**
 * The width at which the panel draws its four blocks in one row.
 *
 * `$container-power-row-min` in `src/styles/_responsive.scss` is the step the
 * stylesheet turns at, and the `composition-step` rule holds the two equal.
 */
export const POWER_ROW_MIN_REM = 78.5;

/** Megawatts to two places, as the canvas sets every power figure. */
const MW_DIGITS = 2;
/** The distributor table to one place, as the canvas sets every figure in it. */
const DISTRIBUTOR_DIGITS = 1;
/** Pips to one place, because half a pip is the step the ship moves in. */
const PIP_DIGITS = 1;

/**
 * The two shares of plant output the priority-group tracks are marked at.
 *
 * They name the scale the tracks are read on rather than any figure: the plant
 * is the whole of it, and the mark half way to that is half of it.
 */
const WHOLE_OUTPUT = 1;
const HALF_OF_OUTPUT = 0.5;

/**
 * How far along the track the plant's mark has to stand for both names to fit.
 *
 * The two names are centred on their own marks, half a track apart from each
 * other, so a demand that runs well past the plant pushes them together: at a
 * plant mark of a fifth they are a tenth of the track apart, which on a phone
 * is the two of them printed over each other. Half the track keeps a quarter of
 * it between them, which holds the pair apart at a doubled text size as well.
 *
 * Below it the half mark is not drawn at all rather than drawn unnamed: the
 * plant's own mark is the one a Commander is reading a track that overruns for,
 * and an unnamed second line beside it is one more thing to work out.
 */
const NAMEABLE_PLANT_MARK = 0.5;

/** The four blocks the canvas draws each bank's allocation across. */
const PIP_STEPS = [1, 2, 3, 4] as const;

/**
 * A drawn length, held inside its track.
 *
 * The projection's shares are already fractions of one track, but a bar wider
 * than the box it is in is a drawing error rather than a reading, so nothing
 * leaves this without being inside it.
 */
function clamp(share: number): number {
  return Math.min(1, Math.max(0, share));
}

/**
 * `POWER & THERMALS`: what the plant makes and what the build does with it.
 *
 * Canvas 1c draws this as the `POWER` mode of the hull anatomy region — the
 * conditions, the priority groups over their summary, the module draw list, the
 * heat profile and the distributor table, in that order. Same DOM at every
 * width; the stylesheet lays the blocks out in one row, two rows of two or one
 * column from the space the region is given, so a 400% zoom picks the column
 * for the same reason a phone does.
 *
 * Every figure here is a package answer selected by
 * `src/app/domain/ships/power-heat/power-heat.ts`. This component formats and names
 * them and does no arithmetic of its own — which is why the canvas's powered
 * and unpowered draw split, its cumulative percentages and its 79%/21% bar are
 * not on the screen: the package publishes no such fields, and a figure this
 * application divided out would be this application's claim rather than the
 * Almanac's (constitution II and IV, `design/reference-review.md`, wave 12).
 *
 * The three package sentinels each keep their own field and their own words: an
 * infinite utilisation is a build drawing with no plant output, an infinite
 * heat level is a load that never settles, and a `null` time to overheat is a
 * scenario that never gets there. None is drawn as a number.
 */
@Component({
  selector: 'ednb-power-thermals',
  imports: [DistributorBlock, FitText, GameText, MetricGroup, TabGroup, Tooltip, UnavailableValue],
  templateUrl: './power-thermals.html',
  styleUrl: './power-thermals.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The one-row step, stated on the host so a test reads the width the
  // stylesheet turns at rather than a copy of it.
  host: { '[style.--power-row-min]': 'rowMinimum' },
})
export class PowerThermals {
  readonly rowMinimum = `${POWER_ROW_MIN_REM}rem`;
  readonly #active = inject(ActiveBuildStore);
  readonly #conditions = inject(PowerConditionsStore);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);

  readonly modulesHeadingId = relationId('power-modules');
  readonly heatHeadingId = relationId('power-heat');

  readonly hardpointsLabel = this.#messages.messageSignal('power.hardpoints.label');
  readonly bandsHeadingId = relationId('power-bands');
  readonly bandsHeading = this.#messages.messageSignal('power.bands.heading');
  readonly cumulativeLabel = this.#messages.messageSignal('power.bands.cumulative');
  readonly offlineLabel = this.#messages.messageSignal('power.bands.offline');
  readonly summaryLabel = this.#messages.messageSignal('power.summary.label');
  readonly modulesHeading = this.#messages.messageSignal('power.modules.heading');
  readonly heatCaption = this.#messages.messageSignal('power.heat.heading');
  readonly heatUnavailableLabel = this.#messages.messageSignal('power.heat.heading');
  /**
   * The words after the level of a bar past the module-damage threshold.
   *
   * The bar's colour and hatch carry the state for a reader who sees it, beside
   * the level figure. No key names them, so these words carry it for a reader
   * who is told.
   */
  readonly heatOverLabel = this.#messages.messageSignal('power.heat.over');
  readonly distributorCaption = this.#messages.messageSignal('power.distributor.heading');
  readonly distributorUnavailableLabel = this.#messages.messageSignal('power.distributor.heading');

  /**
   * The projection for the active build under the current conditions.
   *
   * `revision()` is read first because the loadout signal holds one mutable
   * package object: an edit changes what it contains without changing the
   * reference, so the revision is what actually says "this is different now".
   */
  readonly #projection = computed<PowerAndHeat | null>(() => {
    this.#active.revision();
    const loadout = this.#active.loadout();
    return loadout === null ? null : projectPowerHeat(loadout, this.#conditions.conditions());
  });

  /** Nothing is drawn without a build. The workspace already says why it is empty. */
  readonly shown = computed(() => this.#projection() !== null);

  /** The canvas's `DEPLOYED` / `RETRACTED` pair, in its order. */
  readonly hardpointChoices = computed<readonly TabItem[]>(() =>
    (['deployed', 'retracted'] as const).map((state) => ({
      id: state,
      label: this.#messages.message(HARDPOINT_LABELS[state]),
    })),
  );

  readonly hardpoints = this.#conditions.hardpoints;

  /**
   * The canvas's four columns as one row each: `GRP 1`, `18.72 MW`, `60%`, and
   * the bar the percentage fills.
   *
   * One row per group this build actually puts something in — the projection
   * leaves out the groups nothing is assigned to, because an empty group is not
   * a reading of this build. A group the plant does not keep lit says `OFFLINE`
   * in place of its percentage, which is what the canvas puts there.
   */
  readonly bandRows = computed<readonly BandRowView[]>(() =>
    (this.#projection()?.power.bands ?? []).map((band) => ({
      id: String(band.priority),
      group: this.#messages.message('power.bands.group', {
        group: this.#formatters.integer(band.priority),
      }),
      draw: this.#megawatts(band.draw),
      // `OFFLINE` replaces the percentage rather than joining it: the canvas
      // draws one thing in that column and a shed group's share of a plant that
      // is not feeding it is not a reading anybody needs.
      share:
        band.powered && band.cumulativeShare !== null
          ? this.#formatters.percent(band.cumulativeShare)
          : null,
      offline: !band.powered,
      // Two lengths on one track, as the canvas draws them: everything above
      // this group in a wash, then this group's own draw solid on the end of
      // it. Both are decoration; the figures either side are what is read.
      preceding: clamp(band.precedingShare),
      own: clamp(band.ownShare),
    })),
  );

  /**
   * Where the plant's output falls on the track the group bars are drawn on.
   *
   * The same mark the rail draws on its own bar, and the same one for every
   * row: the projection measures both on the same track, so a group whose
   * length crosses this line is the group the plant ran out on.
   */
  readonly plantMark = computed(() => this.#projection()?.power.bar.plant ?? 0);

  /**
   * Half way to the plant's mark, which is half of its output on this scale.
   *
   * A place on the track rather than a figure: the column at the end of every
   * row prints that row's share of plant output, so the plant's mark is where
   * that column reads 100% and this is where it reads 50%. Nothing is claimed
   * about the plant — a track coordinate is halved, not a megawatt.
   *
   * `0` where the projection has no mark to halve, and where the plant's mark
   * stands too near the leading edge to name a second one beside it — see
   * {@link NAMEABLE_PLANT_MARK}. Either way the mark is not drawn.
   */
  readonly halfMark = computed(() => {
    const plant = this.plantMark();
    return plant >= NAMEABLE_PLANT_MARK ? plant / 2 : 0;
  });

  /** The two marks' own names: the shares of plant output they stand at. */
  readonly halfLabel = computed(() => this.#formatters.percent(HALF_OF_OUTPUT));
  readonly plantLabel = computed(() => this.#formatters.percent(WHOLE_OUTPUT));

  /**
   * The canvas's three tiles: `PLANT OUTPUT`, `POWERED DRAW`, `UNPOWERED`.
   *
   * All three hold in either hardpoint state, so this states them in both and
   * needs no sentence about what is missing. The canvas draws no headroom, no
   * utilisation and no verdict, and neither does this.
   */
  readonly summaryMetrics = computed<readonly Metric[]>(() => {
    const power = this.#projection()?.power;
    if (power === undefined) {
      return [];
    }

    // No condition under the figures. The canvas prints the three labels and
    // nothing else, and the control that decides which state they were read in
    // stands a few lines above them in the same plate.
    return [
      {
        id: 'available',
        label: this.#messages.message('power.summary.plant'),
        value: this.#formatters.decimal(power.available, MW_DIGITS),
        unit: this.#messages.message('power.unit.megawatts'),
      },
      {
        id: 'draw',
        label: this.#messages.message('power.summary.draw'),
        value: this.#formatters.decimal(power.poweredDraw, MW_DIGITS),
        unit: this.#messages.message('power.unit.megawatts'),
      },
      {
        id: 'unpowered',
        label: this.#messages.message('power.summary.unpowered'),
        value: this.#formatters.decimal(power.unpowered, MW_DIGITS),
        unit: this.#messages.message('power.unit.megawatts'),
      },
    ];
  });

  /**
   * The list's own column names, and the name of the row that closes it.
   *
   * The 2026-08-25 canvas revision moved the header note down here: `MODULE`
   * and `MW` over the tracks the list already had, and a `TOTAL DRAW` row at
   * the foot carrying the figure the note used to carry beside the heading.
   */
  readonly moduleColumns = computed(() => ({
    name: this.#messages.message('power.modules.column.name'),
    draw: this.#messages.message('power.unit.megawatts'),
    total: this.#messages.message('power.modules.total-draw'),
  }));

  /**
   * The figure on the closing `TOTAL DRAW` row.
   *
   * The whole list's draw, the dark groups included — which is what the list
   * above it adds up to, and a different reading from the `POWERED DRAW` tile
   * beside the priority groups. The canvas states both, and so does this.
   */
  readonly modulesTotal = computed(() => {
    const power = this.#projection()?.power;
    return power === undefined ? null : this.#megawatts(power.draw);
  });

  /**
   * The canvas's list, in the order the projection put it in.
   *
   * Every reading on the line — what it stands for, what it draws, whether the
   * plant keeps it lit and how long its bar is — was worked out there, against
   * one `powerBudget()` result. This turns those into words and lengths.
   */
  readonly moduleRows = computed<readonly ModuleRowView[]>(() =>
    (this.#projection()?.modules ?? []).map((row) => this.#moduleRow(row)),
  );

  /**
   * The canvas's bars, in the order the projection put them in.
   *
   * Both lengths and the threshold they are measured against were worked out
   * there, against one `heatMetricsResult()` value; this turns them into words.
   */
  readonly heatBars = computed<readonly HeatBarView[]>(() => {
    const heat = this.#projection()?.heat ?? null;
    if (heat === null) {
      return [];
    }

    const scenarios = heat.scenarios.map((scenario) => ({
      id: scenario.key,
      ...this.#heatName(SCENARIO_LABELS[scenario.key], SCENARIO_DESCRIPTIONS[scenario.key]),
      level: this.#heatLevel(scenario.gauge),
      levelMeaning: this.#heatLevelMeaning(scenario.gauge),
      within: scenario.within,
      over: scenario.over,
      overheats: scenario.overheats,
    }));
    const spike = heat.shieldBankSpike;

    // The fifth bar only where there is a bank to spike. A build with none has
    // no cell-bank heat, which is not the same as a cell-bank heat of zero.
    return spike === null
      ? scenarios
      : [
          ...scenarios,
          {
            id: 'shieldBank',
            ...this.#heatName(
              'power.heat.scenario.shield-bank',
              'power.heat.scenario.shield-bank.description',
            ),
            level: this.#heatLevel(spike.gauge),
            levelMeaning: this.#heatLevelMeaning(spike.gauge),
            within: spike.within,
            over: spike.over,
            overheats: spike.overheats,
          },
        ];
  });

  /** A bar's name, its gloss, and the two together for a gloss under a cut name. */
  #heatName(
    labelKey: MessageKey,
    descriptionKey: MessageKey,
  ): Pick<HeatBarView, 'label' | 'description' | 'wholeTip'> {
    const label = this.#messages.message(labelKey);
    const description = this.#messages.message(descriptionKey);
    return {
      label,
      description,
      wholeTip: this.#messages.message('power.heat.scenario.whole', { label, description }),
    };
  }

  /** Where on the track the canvas draws its `100% MODULE DAMAGE` line. */
  readonly heatThreshold = computed(() => this.#projection()?.heat?.thresholdAt ?? 0);

  /**
   * The canvas's two tiles under the bars: `DISSIPATION` and `HEAT SINKS`.
   *
   * The sinks are a count of what is fitted, over the multiplication the canvas
   * writes under it.
   */
  readonly heatFacts = computed<readonly Metric[]>(() => {
    const heat = this.#projection()?.heat ?? null;
    if (heat === null) {
      return [];
    }

    const sinks = heat.heatSinks;

    return [
      {
        id: 'dissipation',
        label: this.#messages.message('power.heat.dissipation'),
        value: this.#formatters.decimal(heat.hullHeatDissipation, MW_DIGITS),
        unit: this.#messages.message('power.unit.per-second'),
      },
      {
        id: 'sinks',
        label: this.#messages.message('power.heat.sinks'),
        value: this.#formatters.integer(sinks.total),
        // The canvas's `2 x 3` under the count. Absent where the launchers do
        // not all carry the same number, because then it is not one product.
        description:
          sinks.charges === null || sinks.launchers === 0
            ? undefined
            : this.#messages.message('power.heat.sinks.breakdown', {
                launchers: this.#formatters.integer(sinks.launchers),
                charges: this.#formatters.integer(sinks.charges),
              }),
      },
    ];
  });

  readonly heatAvailable = computed(() => (this.#projection()?.heat ?? null) !== null);

  /** `SYS`, `ENG` and `WEP`, in the canvas's order, each with its own steps. */
  readonly bankRows = computed<readonly BankRowView[]>(() => {
    const capacitors = this.#projection()?.distributor?.capacitors ?? [];

    return CAPACITOR_KINDS.flatMap((kind) => {
      const capacitor = capacitors.find((entry) => entry.kind === kind);
      if (capacitor === undefined) {
        return [];
      }

      const name = this.#messages.message(BANK_LABELS[kind]);
      // The allocation the package used, not the one that was pressed.
      const pips = capacitor.pips;

      return [
        {
          kind,
          name,
          capacity: this.#capacity(capacitor.capacity),
          ratedRecharge: this.#megajoulesPerSecond(capacitor.ratedRecharge),
          rechargeRate: this.#megajoulesPerSecond(capacitor.rechargeRate),
          // The blocks carry the allocation as a picture; this carries it as a
          // reading, which is what the mobile canvas prints and what a reader
          // who cannot see four rectangles gets.
          pipsLabel: this.#messages.message('power.distributor.pips.label', {
            bank: name,
            pips: this.#formatters.decimal(pips, PIP_DIGITS),
            total: this.#formatters.integer(TOTAL_PIPS),
          }),
          steps: PIP_STEPS.map((step) => ({
            id: String(step),
            value: step,
            // A block is full once the allocation reaches it and empty until it
            // does; a half pip fills half of one, which is the step the ship
            // moves in.
            fill: Math.min(1, Math.max(0, pips - (step - 1))),
            label: this.#messages.message('power.distributor.pips.set', {
              bank: name,
              pips: this.#formatters.integer(step),
            }),
          })),
        },
      ];
    });
  });

  readonly distributorColumns = computed(() => ({
    bank: this.#messages.message('power.distributor.column.bank'),
    capacity: this.#messages.message('power.distributor.column.capacity'),
    rated: this.#messages.message('power.distributor.column.rated'),
    pips: this.#messages.message('power.distributor.column.pips'),
    recharge: this.#messages.message('power.distributor.column.recharge'),
  }));

  /** Reads the build with the hardpoints out, or stowed. Changes no build. */
  showHardpoints(state: string): void {
    this.#conditions.showHardpoints(state as HardpointState);
  }

  /** Sets one bank's pips. The package decides what that does to the recharge. */
  /**
   * Asks for that many pips in that bank. The store moves the other two.
   *
   * Pressing the block a bank already stands on steps it back one, which is the
   * only way down to none through four blocks that each name a count. Anything
   * else would need a fifth block the canvas does not draw.
   */
  setPips(bank: CapacitorKind, step: number): void {
    const standing = this.#projection()?.distributor?.capacitors.find(
      (capacitor) => capacitor.kind === bank,
    );
    this.#conditions.setPips(bank, standing?.pips === step ? step - 1 : step);
  }

  #moduleRow(row: ModuleDrawRow): ModuleRowView {
    const name = row.symbol === null ? null : this.#gameText.moduleName(row.symbol);

    return {
      id: row.id,
      name,
      // A consumer the package published no symbol for still has a line, and it
      // says so rather than being named after something nobody can identify.
      fallbackName: name === null ? this.#messages.message('power.modules.unnamed') : null,
      count:
        row.count === 1
          ? null
          : this.#messages.message('power.modules.count', {
              count: this.#formatters.integer(row.count),
            }),
      // The group is named on the lines the plant leaves dark and nowhere else,
      // which is where the canvas names it: on a lit line it would be a label
      // repeated on every row of the list, saying nothing about any of them.
      group: row.offline
        ? this.#messages.message('power.modules.group', {
            group: this.#formatters.integer(row.priority),
          })
        : null,
      // A line whose mounts are switched off reads zero like any other line
      // that is not drawing, so the reason is said in a word rather than left
      // for a reader to infer from the figure.
      state: row.disabled ? this.#messages.message('power.modules.off') : null,
      draw: this.#megawatts(row.draw),
      offline: row.offline || row.disabled,
      fill: row.share,
    };
  }

  /**
   * A gauge reading, or the symbol for a load that settles nowhere.
   *
   * The symbol is what is drawn. What it stands for is a sentence, and it is
   * carried beside it rather than instead of it — a glyph a reader has to know
   * to read is a state carried by decoration (see {@link heatLevelMeaning}).
   */
  #heatLevel(level: HeatLevelValue): string {
    return level.kind === 'level'
      ? this.#formatters.percent(level.value)
      : this.#messages.message('power.heat.does-not-settle');
  }

  /** The words behind the symbol, or `null` where the level is a number. */
  #heatLevelMeaning(level: HeatLevelValue): string | null {
    return level.kind === 'level'
      ? null
      : this.#messages.message('power.heat.does-not-settle.meaning');
  }

  #megawatts(value: number): string {
    return this.#messages.message('power.format.megawatts', {
      value: this.#formatters.decimal(value, MW_DIGITS),
    });
  }

  /**
   * A bank's capacity, in the unit the game's own panel writes after it.
   *
   * The figure is `capacity` exactly as the package returned it; what changed
   * on 2026-08-27 is the unit written after it, from the SI `MJ` this table
   * used to the `MW` the outfitting panel a Commander cross-checks it against
   * writes. The two panels disagreeing on the unit reads as two different
   * figures rather than one, and the reading a Commander is checking is the
   * game's. Nothing is scaled or converted: `MJ` and `MW` here name the same
   * number.
   *
   * The rates below keep `MJ/s`, which is the unit they are actually in and
   * the one the canvas draws. So the column that is a pool and the two that
   * are rates no longer share a unit, which is the other thing the change
   * buys: `MJ` beside `MJ/s` invited the pool to be read as a third rate.
   */
  #capacity(value: number): string {
    return this.#messages.message('power.format.megawatts', {
      value: this.#formatters.decimal(value, DISTRIBUTOR_DIGITS),
    });
  }

  #megajoulesPerSecond(value: number): string {
    return this.#messages.message('power.format.megajoules-per-second', {
      value: this.#formatters.decimal(value, DISTRIBUTOR_DIGITS),
    });
  }
}
