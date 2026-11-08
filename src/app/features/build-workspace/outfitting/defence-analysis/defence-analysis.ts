import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { PowerConditionsStore } from '../../../../application/power-heat/power-conditions.store';
import {
  projectDefence,
  type CalculationIssueView,
  type CellBankView,
  type Defence,
  type DamageDefenceValue,
  type DamageType,
  type DefenceRole,
  type DefenceRoleGroup,
  type ModuleIdentity,
} from '../../../../domain/ships/defence/defence';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { GameTextPresenter, type GameTextPresentation } from '../../../../i18n/game-text.presenter';
import type { MessageKey } from '../../../../i18n/locale-registry';
import { MessageService } from '../../../../i18n/message.service';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { GameText } from '../../../../ui/components/game-text/game-text';
import type { Metric } from '../../../../ui/components/metric-group/metric-group';
import { MetricGroup } from '../../../../ui/components/metric-group/metric-group';
import { TabGroup, type TabItem } from '../../../../ui/components/tab-group/tab-group';
import { ModuleIdentityBadge } from '../../../../ui/outfitting/module-identity-badge';

/** One damage line: `KINETIC`, its bar, `41%` and `3,122`, in that order. */
interface DamageRowView {
  readonly id: string;
  readonly label: string;
  /** The signed package resistance, formatted. A weakness keeps its minus. */
  readonly resistance: string;
  /** The pool at that resistance, or `null` where the package returned no bound. */
  readonly pool: string | null;
  /**
   * The same pool read at the standing SYS allocation, on the shield only.
   *
   * `undefined` on a table that has no such column — the hull, which pips do
   * not reach. `null` inside a table that has one carries the same meaning
   * {@link pool}'s `null` does: the package published no bound.
   */
  readonly poolAtPips?: string | null;
  /** The symbol drawn in place of an unbounded pool. */
  readonly unbounded: string;
  /** What that symbol stands for, in words. */
  readonly unboundedMeaning: string;
  /** Where the bar starts, in `[0, 1]` of the track. Decoration only. */
  readonly barStart: number;
  /** How far it runs from there, in `[0, 1]` of the track. Decoration only. */
  readonly barLength: number;
  /** A resistance below zero, which the canvas draws in the danger ink and hatched. */
  readonly weakness: boolean;
  /** That state in words, so the hatch is never the only thing that says it. */
  readonly weaknessLabel: string | null;
}

/**
 * The fifth column's heading, on the two lines the canvas sets it in.
 *
 * The unit is the reading and the allocation is the condition it was read at,
 * so the canvas prints the unit and then the allocation under it, smaller. It
 * is one heading either way — a reader is given `MJ × 2 SYS PIPS`, because the
 * condition is not optional: a figure that moves with a condition shown without
 * that condition is the misleading number constitution IV forbids (FR-002).
 */
interface PipColumnView {
  readonly unit: string;
  readonly atPips: string;
}

/**
 * One card's four damage lines and the track they are all drawn on.
 *
 * The track ends at `100%`, where the package stops publishing a bound, and
 * begins at whichever resistance in the table is lowest: `0%` where none of
 * them is a weakness, and below it where one is. The shields, all positive,
 * start their bars at the leading edge. The hull, with a weakness among them,
 * carries a zero line inside the track with the weakness running back from it.
 */
interface DamageTableView {
  readonly rows: readonly DamageRowView[];
  /** The fifth column's heading, or `null` for a table without one. */
  readonly pipColumn: PipColumnView | null;
  /** Where zero sits on the track, in `[0, 1]`. `0` with nothing below it. */
  readonly zeroAt: number;
  /** Whether the track reaches below zero at all, which draws the zero line. */
  readonly signed: boolean;
}

/** One source row: what is fitted in a role, and what the package credits the role with. */
interface SourceRowView {
  readonly id: string;
  /** The package's name for the module, where every mount in the row holds one. */
  readonly name: GameTextPresentation | null;
  /** The role, named, where the mounts in the row hold different modules. */
  readonly roleLabel: string | null;
  /** The canvas's `×4`, on a row standing for more than one mount. */
  readonly count: string | null;
  /** The canvas's `7C`, drawn from the package's own class and rating. */
  readonly moduleClass: number | null;
  readonly rating: string | null;
  /** What has been done to it: `THERMAL RESIST G5`, `PRE-ENGINEERED`. */
  readonly detail: string | null;
  /** The package aggregate for the whole role, as a bare number. The list head states the unit. */
  readonly contribution: string;
  /** The unit of {@link contribution}, read with the figure but not drawn beside it. */
  readonly unit: string;
  /** How far the bar runs, in `[0, 1]` of the row carrying the most. Decoration only. */
  readonly fill: number;
}

/** The canvas's bank line: the reserve, and the banks it is made of. */
interface BankReserveView {
  readonly label: string;
  /** Megajoules the package says every powered cell aboard restores. */
  readonly restorable: string;
  /** The reserve on the block's own scale, in `[0, 1]`. `null` with nothing to scale by. */
  readonly fill: number | null;
  /** Whether nothing aboard is switched on, which the canvas hatches. */
  readonly unpowered: boolean;
  /** One line per kind of bank aboard, in the package's own slot order. */
  readonly banks: readonly BankLineView[];
}

/**
 * One kind of bank aboard: the module, how many of it, and what each holds.
 *
 * Banks are listed apart when they differ in anything a Commander would act on
 * — the module fitted, what one activation restores, how many cells it carries,
 * whether it is switched on — because a reserve summed over a powered 5A and a
 * dead 3D describes neither of them. Identical banks in the same state collapse
 * into one line with the canvas's own `×4`.
 */
interface BankLineView {
  readonly id: string;
  readonly name: GameTextPresentation;
  /** The canvas's `5A`, drawn from the fitted record's own class and rating. */
  readonly moduleClass: number | null;
  readonly rating: string | null;
  /** The canvas's `×4`, where the line stands for more than one bank. */
  readonly count: string | null;
  /**
   * What follows the code on the bank's own line: `4 cells · UNPOWERED`.
   *
   * The state is inside the line rather than beside it because that is where
   * the canvas writes it, and because a word inside the line is read out with
   * the bank it belongs to instead of arriving as a loose label after it.
   */
  readonly detail: string;
  /** What one activation of this bank restores, formatted. The bar's own figure. */
  readonly reinforcement: string;
  /** That figure on the block's own scale, in `[0, 1]`. `null` with nothing to scale by. */
  readonly fill: number | null;
  /** Whether the plant does not feed this bank, which hatches its bar. */
  readonly unpowered: boolean;
}

/** One package issue, in the package's own words. */
interface IssueView {
  readonly id: string;
  /**
   * This capability's own sentence for the package's pair, where it has one.
   *
   * Ordinary application text, drawn as such. It carries no disclosure and no
   * language of its own: it is written in every locale this application ships,
   * so there is nothing to frame.
   */
  readonly text: string | null;
  /** The package's own wording, where this capability has no sentence. */
  readonly message: GameTextPresentation | null;
}

/** The two views each card offers: its summary, and the sources behind it. */
type DefenceView = 'summary' | 'sources';

/** The tab ids of one card's two views, unique on the page. */
type ViewIds = Readonly<Record<DefenceView, string>>;

/** The role names, written out: `MessageKey` is the catalogue's own key union. */
const ROLE_LABELS = {
  shieldGenerator: 'defence.source.shield-generator',
  shieldBooster: 'defence.source.shield-booster',
  shieldReinforcement: 'defence.source.shield-reinforcement',
  bulkhead: 'defence.source.bulkhead',
  hullReinforcement: 'defence.source.hull-reinforcement',
} as const satisfies Record<DefenceRole, MessageKey>;

/** The damage-type names, likewise. */
const DAMAGE_LABELS = {
  kinetic: 'defence.damage.kinetic',
  thermal: 'defence.damage.thermal',
  explosive: 'defence.damage.explosive',
  caustic: 'defence.damage.caustic',
} as const satisfies Record<DamageDefenceValue['type'], MessageKey>;

/** Megajoules and hull points whole, as the canvas sets every pool figure. */
const POOL_DIGITS = 0;
/** Rates to one place, as the canvas sets `2.4 MJ/s`. */
const RATE_DIGITS = 1;
/**
 * The heading's allocation, whole where the allocation is whole.
 *
 * The canvas heads the column `4 SYS PIPS`, not `4.0`. The game moves pips half
 * a step at a time, though, so a half allocation keeps its place rather than
 * being rounded to a whole one the build is not standing at.
 */
const pipDigits = (pips: number): number => (Number.isInteger(pips) ? 0 : 1);
/** Where every damage track ends: the resistance at which a pool stops being bounded. */
const RESISTANCE_CEILING = 1;

/**
 * The refusals this card states in its own words, by the package's own
 * `field` and `reason`.
 *
 * The package publishes the diagnosis twice: once as a machine-readable pair,
 * and once as an English sentence. The pair is what a surface is given to act
 * on, and this reads the pair. It does not translate the sentence, parse it, or
 * infer a reason from another result — a pair with no entry here keeps the
 * package's own words (`openspec/changes/archive/006-defence-profile/contracts/shield-profile.md`,
 * "Refusal presentation").
 *
 * Wording the pair is labelling a package result, which constitution II
 * sanctions, and it is what lets these states reach a Commander in the language
 * they chose: `getCalculationIssueMessage()` answers for English and returns
 * `null` for every other locale, whatever the reason.
 */
const REFUSAL_MESSAGES: Readonly<Record<string, MessageKey | undefined>> = {
  'shieldGenerator/missing': 'defence.shield.refused.generator-missing',
  'shieldGenerator/disabled': 'defence.shield.refused.generator-disabled',
  // Both ways the plant leaves the generator unfed read alike, because the
  // shields are down for one reason either way and there is one thing to do
  // about it. They stay two package diagnoses on the projection; what a
  // Commander is told here is the thing they have in common. The plant's own
  // state is feature 005's to report.
  'shieldGenerator/shed': 'defence.shield.refused.power',
  'powerCapacity/disabled': 'defence.shield.refused.power',
};

/**
 * What makes two package issues the same diagnosis.
 *
 * Everything the package states about the issue except the `message` it states
 * it in: the field, the reason, the mount and module it names, and the values it
 * interpolates. The message is left out because it is derived from those and
 * because comparing it would be reading the English text, which nothing here
 * does. Two results carrying an issue with this key carry one reason between
 * them, and a Commander is given it once.
 */
function issueKey(issue: CalculationIssueView): string {
  // Sorted, because a key order is not a promise the package made. The values
  // are compared as well as the four identities above them: a release that
  // interpolates something the two results disagree on has told them apart, and
  // an equality ignoring it would draw two reasons as one.
  const params = Object.entries(issue.params ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .sort();
  return [issue.field, issue.reason, issue.slot ?? '', issue.symbol ?? '', ...params].join('|');
}

/**
 * `DEFENCE ANALYSIS`: what the shields hold, what the hull takes, and against what.
 *
 * Canvas 1c draws this as the `DEFENCE` mode of the hull anatomy region — two
 * equal cards, `SHIELDS` and `ARMOUR`. Each card has a head with the fitted
 * article named beside it and, where the card has sources, a choice of two
 * views. The summary holds one headline pool, the four damage lines and three
 * labelled facts. The sources hold the source rows, and on the shield the cell
 * bank reserve. Canvas 1d stacks the same two cards. Same DOM at both widths; which
 * arrangement appears is decided in CSS from the space the region is given, so
 * a 400% zoom picks the stacked one for the same reason a phone does.
 *
 * Every figure is a package answer selected by `src/app/domain/ships/defence/defence.ts`.
 * This component formats and names them and does no arithmetic of its own,
 * which is why each source row carries the package's aggregate for a whole role
 * rather than a share worked out per module: the Almanac publishes no such
 * split, and one divided out here would be this application's claim rather than
 * the Almanac's (constitution II and IV,
 * `openspec/changes/archive/006-defence-profile/design/reference-review.md`).
 *
 * Two package sentinels keep their own state and their own words rather than
 * being drawn as numbers: an unbounded effective pool is a resistance of 100%,
 * and an infinite recovery duration is a phase that never finishes at the
 * allocation being read.
 */
@Component({
  selector: 'ednb-defence-analysis',
  imports: [GameText, MetricGroup, ModuleIdentityBadge, NgTemplateOutlet, TabGroup],
  templateUrl: './defence-analysis.html',
  styleUrl: './defence-analysis.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DefenceAnalysis {
  readonly #active = inject(ActiveBuildStore);
  readonly #conditions = inject(PowerConditionsStore);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);

  readonly shieldHeadingId = relationId('defence-shield');
  readonly armourHeadingId = relationId('defence-armour');

  readonly shieldHeading = this.#messages.messageSignal('defence.shield.heading');
  readonly shieldPoolLabel = this.#messages.messageSignal('defence.shield.pool');
  readonly armourHeading = this.#messages.messageSignal('defence.armour.heading');
  readonly armourPoolLabel = this.#messages.messageSignal('defence.armour.pool');
  readonly armourFactsLabel = this.#messages.messageSignal('defence.armour.facts');
  readonly damageLabel = this.#messages.messageSignal('defence.damage.label');
  readonly typeColumn = this.#messages.messageSignal('defence.damage.column.type');
  readonly resistColumn = this.#messages.messageSignal('defence.damage.column.resist');
  readonly megajoulesColumn = this.#messages.messageSignal('defence.damage.column.megajoules');
  readonly hullPointsColumn = this.#messages.messageSignal('defence.damage.column.hull-points');
  readonly recoveryLabel = this.#messages.messageSignal('defence.recovery.label');
  readonly shieldSourceLabel = this.#messages.messageSignal('defence.source.shield');
  readonly armourSourceLabel = this.#messages.messageSignal('defence.source.armour');
  readonly shieldViewLabel = this.#messages.messageSignal('defence.view.shield');
  readonly armourViewLabel = this.#messages.messageSignal('defence.view.armour');

  readonly #shieldViewIds: ViewIds = {
    summary: relationId('defence-shield-summary'),
    sources: relationId('defence-shield-sources'),
  };
  readonly #armourViewIds: ViewIds = {
    summary: relationId('defence-armour-summary'),
    sources: relationId('defence-armour-sources'),
  };

  /**
   * The view the Commander chose for each card. Summary until a choice is made.
   *
   * The choice lives as long as the panel. Leaving the defence mode removes the
   * panel, so each card starts at its summary when the mode opens again.
   */
  readonly #shieldChoice = signal<DefenceView>('summary');
  readonly #armourChoice = signal<DefenceView>('summary');

  /**
   * The projection for the active build at the standing SYS allocation.
   *
   * `revision()` is read first because the loadout signal holds one mutable
   * package object: an edit changes what it contains without changing the
   * reference, so the revision is what actually says "this is different now".
   */
  readonly #projection = computed<Defence | null>(() => {
    this.#active.revision();
    const loadout = this.#active.loadout();
    return loadout === null
      ? null
      : projectDefence(loadout, { systemsPips: this.#conditions.pips().systems });
  });

  /** Nothing is drawn without a build. The workspace already says why it is empty. */
  readonly shown = computed(() => this.#projection() !== null);

  /** Whether the package produced a shield at all. Everything in the card follows it. */
  readonly shieldAvailable = computed(() => this.#projection()?.shield.kind === 'complete');

  /**
   * The article named beside `SHIELDS`, as the canvas names it: `BI-WEAVE 7C`.
   *
   * The generator's own row says the same thing a few lines below, and the
   * canvas draws both — the head names what is being read and the row is one
   * source among several.
   */
  readonly shieldIdentity = computed(() => this.#headIdentity('shieldGenerator', true));

  /** The article named beside `ARMOUR`. A bulkhead has no size or rating to draw. */
  readonly armourIdentity = computed(() => this.#headIdentity('bulkhead', false));

  /** The canvas's `1,842`, which is the package's own strength. */
  readonly shieldPool = computed(() => {
    const shield = this.#projection()?.shield;
    return shield === undefined || shield.kind !== 'complete'
      ? null
      : this.#formatters.decimal(shield.value.strength, POOL_DIGITS);
  });

  /** The canvas's `3,914`: the hull points the package totals for this build. */
  readonly armourPool = computed(() => {
    const armour = this.#projection()?.armour;
    return armour === undefined ? null : this.#formatters.decimal(armour.hitPoints, POOL_DIGITS);
  });

  /**
   * The shield table: the bare four columns, and the pip column beside them.
   *
   * The first four are `shieldMetricsResult()`, which is pip-free — the base
   * resistances an outfitting screen shows — and they do not move when a pip
   * moves. The fifth is `shieldCapacitorMetricsResult()` at the standing allocation,
   * and it is the only cell on the table that does (FR-002).
   */
  readonly shieldDamage = computed<DamageTableView>(() => {
    const projection = this.#projection();
    const shield = projection?.shield;
    const capacitor = projection?.capacitor;
    const table = this.#damageTable(
      shield === undefined || shield.kind !== 'complete' ? [] : shield.value.damage,
    );
    if (capacitor === undefined || capacitor.kind !== 'complete' || table.rows.length === 0) {
      return table;
    }

    // Paired by damage type rather than by position: two package records keyed
    // the same way, read key to key, with nothing derived from either.
    const atPips = new Map(capacitor.value.damage.map((row) => [row.type, row]));
    return {
      ...table,
      pipColumn: {
        unit: this.#messages.message('defence.damage.column.megajoules'),
        atPips: this.#messages.message('defence.damage.column.at-pips', {
          pips: this.#formatters.decimal(
            capacitor.value.systemsPips,
            pipDigits(capacitor.value.systemsPips),
          ),
        }),
      },
      rows: table.rows.map((row) => ({
        ...row,
        poolAtPips: this.#poolText(atPips.get(row.id as DamageType)?.effectiveHitPoints),
      })),
    };
  });

  readonly armourDamage = computed<DamageTableView>(() =>
    this.#damageTable(this.#projection()?.armour.damage ?? []),
  );

  /** Every ordered package reason the shield could not be read. */
  readonly shieldIssues = computed<readonly IssueView[]>(() => this.#issues(this.#statedIssues()));

  /**
   * The canvas's `RECHARGE` / `0→100%` / `BROKEN RESET`.
   *
   * A duration the package returns as `Infinity` is a phase that never finishes
   * at this allocation. It is drawn as the symbol for that with the meaning
   * beside it, never as a very large number of seconds.
   */
  readonly recoveryFacts = computed<readonly Metric[]>(() => {
    const recovery = this.#projection()?.recovery;
    if (recovery === undefined || recovery.kind !== 'complete') {
      return [];
    }

    const { regenRate, recoveryTime, regenTime } = recovery.value;
    return [
      {
        id: 'rate',
        label: this.#messages.message('defence.recovery.rate'),
        value: this.#messages.message('defence.format.megajoules-per-second', {
          value: this.#formatters.decimal(regenRate, RATE_DIGITS),
        }),
      },
      this.#duration('regen', 'defence.recovery.full', regenTime),
      this.#duration('broken', 'defence.recovery.broken', recoveryTime),
    ];
  });

  /**
   * Every ordered package reason the recovery could not be read, less the ones
   * the strength has already given.
   *
   * Everything that refuses the strength refuses the recovery too. Both calls
   * resolve the same generator and the same retracted power state first, and
   * the recovery reads more besides.
   *
   * So whatever stops the strength returns as the same issue here, and a card
   * drawing both lists gives a Commander one fault to read as two.
   *
   * So an issue drawn under the strength is not drawn again here. An issue this
   * result has and that one did not is drawn, because it is a reason nobody has
   * been given yet (`openspec/changes/archive/006-defence-profile/contracts/shield-profile.md`,
   * "Refusal presentation").
   */
  readonly recoveryIssues = computed<readonly IssueView[]>(() => {
    const recovery = this.#projection()?.recovery;
    if (recovery === undefined || recovery.kind !== 'unavailable') {
      return [];
    }

    const stated = new Set(this.#statedIssues().map(issueKey));
    return this.#issues(recovery.issues.filter((issue) => !stated.has(issueKey(issue))));
  });

  /**
   * Whether the card says anything about the recovery at all.
   *
   * The strength states its reasons. A recovery with no reason of its own would
   * repeat them, and its unavailable state is the second half of that
   * repetition, so both are removed together. A recovery the package produced,
   * or refused for a reason of its own, keeps its block.
   */
  readonly recoveryShown = computed(
    () => this.recoveryFacts().length > 0 || this.recoveryIssues().length > 0,
  );

  /** The issues the strength states, which nothing below it states again. */
  readonly #statedIssues = computed<readonly CalculationIssueView[]>(() => {
    const shield = this.#projection()?.shield;
    return shield === undefined || shield.kind !== 'unavailable' ? [] : shield.issues;
  });

  /** The canvas's `HARDNESS` / `MODULE PROT.` / `INTEGRITY`. */
  readonly armourFacts = computed<readonly Metric[]>(() => {
    const projection = this.#projection();
    if (projection === null) {
      return [];
    }

    return [
      {
        id: 'hardness',
        label: this.#messages.message('defence.armour.hardness'),
        value: this.#formatters.integer(projection.hardness),
      },
      {
        id: 'module-protection',
        label: this.#messages.message('defence.armour.module-protection'),
        value: this.#formatters.percent(projection.armour.moduleProtection),
      },
      {
        id: 'integrity',
        label: this.#messages.message('defence.armour.integrity'),
        value: this.#formatters.decimal(projection.armour.moduleArmour, POOL_DIGITS),
      },
    ];
  });

  readonly shieldSources = computed<readonly SourceRowView[]>(() =>
    this.#sourceRows(this.#projection()?.shieldRoles ?? [], this.megajoulesColumn()),
  );

  readonly armourSources = computed<readonly SourceRowView[]>(() =>
    this.#sourceRows(this.#projection()?.armourRoles ?? [], this.hullPointsColumn()),
  );

  /**
   * The canvas's bank line, drawn only where a bank is aboard, and the banks
   * behind it.
   *
   * The figure is the package's own `totalRestorable` — megajoules every
   * powered cell aboard puts back — and under it every kind of bank aboard is
   * named the way the canvas names the one it draws. A build with banks fitted
   * and none switched on keeps the line and says so in a word: the reserve is
   * aboard, and the package reporting zero is not the same state as carrying
   * nothing.
   *
   * Every bar in the block is drawn against the largest figure in it, which is
   * the rule the canvas's own source rows follow — its `+144` row is 13% of a
   * track its `1,090` row fills. That keeps the reserve and one activation of
   * one bank on one scale, and keeps them drawable on a build whose shield the
   * package refused.
   */
  readonly bankRow = computed<BankReserveView | null>(() => {
    const projection = this.#projection();
    if (projection === null || projection.cellBanks.kind === 'noneFitted') {
      return null;
    }

    const banks = projection.cellBanks;
    const largest = Math.max(
      banks.totalRestorable,
      ...banks.banks.map((bank) => bank.reinforcement),
    );

    return {
      label: this.#messages.message('defence.banks.label'),
      restorable: this.#megajoules(banks.totalRestorable),
      fill: this.#barLength(banks.totalRestorable, largest),
      unpowered: banks.banks.every((bank) => !bank.powered),
      banks: this.#bankLines(banks.banks, largest),
    };
  });

  /** Whether the shield has a source to show: a role contribution or a bank. */
  readonly shieldHasSources = computed(
    () => this.shieldSources().length > 0 || this.bankRow() !== null,
  );

  /** Whether the armour has a source to show: a role contribution. */
  readonly armourHasSources = computed(() => this.armourSources().length > 0);

  /**
   * The view each card shows. A card with no sources shows its summary, and
   * keeps the Commander's choice for when its sources come back.
   */
  readonly shieldView = computed<DefenceView>(() =>
    this.shieldHasSources() ? this.#shieldChoice() : 'summary',
  );
  readonly armourView = computed<DefenceView>(() =>
    this.armourHasSources() ? this.#armourChoice() : 'summary',
  );

  readonly shieldViews = computed(() => this.#viewChoices(this.#shieldViewIds));
  readonly armourViews = computed(() => this.#viewChoices(this.#armourViewIds));
  readonly shieldViewId = computed(() => this.#shieldViewIds[this.shieldView()]);
  readonly armourViewId = computed(() => this.#armourViewIds[this.armourView()]);

  /** Shows the shield view whose tab id the segmented choice gives. */
  chooseShieldView(id: string): void {
    this.#shieldChoice.set(id === this.#shieldViewIds.sources ? 'sources' : 'summary');
  }

  /** Shows the armour view whose tab id the segmented choice gives. */
  chooseArmourView(id: string): void {
    this.#armourChoice.set(id === this.#armourViewIds.sources ? 'sources' : 'summary');
  }

  /** The two choices of one card, summary first. */
  #viewChoices(ids: ViewIds): readonly TabItem[] {
    return [
      { id: ids.summary, label: this.#messages.message('defence.view.summary') },
      { id: ids.sources, label: this.#messages.message('defence.view.sources') },
    ];
  }

  /**
   * One card's damage lines, and the track all four of them are drawn on.
   *
   * The track is set before any bar is: it runs to `100%`, where the package
   * stops publishing a bound, and back to the lowest resistance in the table.
   * With nothing below zero that is the leading edge and no zero line is drawn.
   * With a weakness among them, zero moves inside the track and the weakness
   * runs back from it.
   */
  #damageTable(values: readonly DamageDefenceValue[]): DamageTableView {
    const lowest = Math.min(0, ...values.map((value) => value.resistance));
    const span = RESISTANCE_CEILING - lowest;
    const zeroAt = Math.abs(lowest) / span;

    return {
      rows: values.map((value) => this.#damageRow(value, span, zeroAt)),
      // Only the shield has one, and it adds its own after this.
      pipColumn: null,
      zeroAt,
      signed: lowest < 0,
    };
  }

  /** One damage line, with the bar beside it drawn to the resistance itself. */
  #damageRow(value: DamageDefenceValue, span: number, zeroAt: number): DamageRowView {
    const weakness = value.resistance < 0;
    const bar = this.#barSpan(value.resistance, span, zeroAt);

    return {
      id: value.type,
      label: this.#messages.message(DAMAGE_LABELS[value.type]),
      resistance: this.#formatters.percent(value.resistance),
      // A resistance of 100% leaves the package with no bound to publish. The
      // symbol for that is drawn instead of a number nobody could act on.
      pool: this.#poolText(value.effectiveHitPoints),
      unbounded: this.#messages.message('defence.damage.unbounded'),
      unboundedMeaning: this.#messages.message('defence.damage.unbounded.meaning'),
      barStart: bar.start,
      barLength: bar.length,
      weakness,
      weaknessLabel: weakness ? this.#messages.message('defence.damage.weakness') : null,
    };
  }

  /** One pool, or `null` where the package published no bound for it. */
  #poolText(hitPoints: number | undefined): string | null {
    return hitPoints !== undefined && Number.isFinite(hitPoints)
      ? this.#formatters.decimal(hitPoints, POOL_DIGITS)
      : null;
  }

  /**
   * Where one bar sits on the table's scale, in `[0, 1]` of the track.
   *
   * A resistance runs right from zero and a weakness runs left from it, which
   * is how the canvas draws the one weakness in its sample hull. Both are held
   * inside the track: the scale was built from these same values, so neither
   * can leave it, and the clamp is there for a package that one day publishes a
   * resistance past `100%` rather than for anything this table can produce.
   */
  #barSpan(
    resistance: number,
    span: number,
    zeroAt: number,
  ): { readonly start: number; readonly length: number } {
    const length = Math.max(0, Math.min(1, Math.abs(resistance) / span));
    return resistance < 0
      ? { start: Math.max(0, zeroAt - length), length: Math.min(length, zeroAt) }
      : { start: zeroAt, length: Math.min(length, 1 - zeroAt) };
  }

  /**
   * One row per role something is fitted in, and the bar each is drawn with.
   *
   * The first row carries the figure the rest add to — the generator, the
   * bulkhead — and the canvas writes the others with a leading `+` to say so.
   * The bars are measured against the largest figure in the same list, which is
   * what makes them comparable with each other and with nothing else.
   */
  #sourceRows(groups: readonly DefenceRoleGroup[], unit: string): readonly SourceRowView[] {
    const largest = Math.max(0, ...groups.map((group) => group.contribution));

    return groups.map((group, index) => {
      const shared = this.#sharedIdentity(group);
      const symbol = this.#sharedSymbol(group);

      return {
        id: group.role,
        name: symbol === null ? null : this.#gameText.moduleName(symbol),
        // A row whose mounts hold different modules cannot be named after one of
        // them, so it is named after what they do instead.
        roleLabel: symbol === null ? this.#messages.message(ROLE_LABELS[group.role]) : null,
        count:
          group.modules.length > 1
            ? this.#messages.message('defence.source.count', {
                count: this.#formatters.integer(group.modules.length),
              })
            : null,
        // The armour mount has no size or rating a Commander outfits by — every
        // hull's bulkhead is class 1 rating I — so the canvas draws none there.
        moduleClass: group.role === 'bulkhead' ? null : (shared?.size ?? null),
        rating: group.role === 'bulkhead' ? null : (shared?.rating ?? null),
        detail: shared === null ? null : this.#engineering(shared),
        contribution:
          index === 0
            ? this.#formatters.decimal(group.contribution, POOL_DIGITS)
            : this.#messages.message('defence.source.added', {
                value: this.#formatters.decimal(group.contribution, POOL_DIGITS),
              }),
        unit,
        fill: this.#barLength(group.contribution, largest) ?? 0,
      };
    });
  }

  /** The identity every mount in a row shares, or nothing where they differ. */
  #sharedIdentity(group: DefenceRoleGroup): ModuleIdentity | null {
    const [first, ...rest] = group.modules;
    if (first?.identity == null) {
      return null;
    }
    return rest.every((module) => this.#sameIdentity(module.identity, first.identity))
      ? first.identity
      : null;
  }

  /** The symbol every mount in a row shares, or nothing where they differ. */
  #sharedSymbol(group: DefenceRoleGroup): string | null {
    const [first, ...rest] = group.modules;
    if (first === undefined) {
      return null;
    }
    return rest.every((module) => module.symbol === first.symbol) ? first.symbol : null;
  }

  #sameIdentity(left: ModuleIdentity | null, right: ModuleIdentity | null): boolean {
    return (
      left !== null &&
      right !== null &&
      left.size === right.size &&
      left.rating === right.rating &&
      left.blueprint === right.blueprint &&
      left.grade === right.grade &&
      left.experimental === right.experimental
    );
  }

  /** The canvas's `THERMAL RESIST G5 · CORROSIVE`, in the package's own words. */
  #engineering(identity: ModuleIdentity): string | null {
    const parts: string[] = [];

    if (identity.blueprint !== null && identity.grade !== null) {
      parts.push(
        this.#messages.message('outfitting.slot.engineering', {
          blueprint: this.#gameText.blueprintName(identity.blueprint).text ?? identity.blueprint,
          grade: identity.grade,
        }),
      );
    }
    if (identity.experimental !== null) {
      parts.push(
        this.#gameText.experimentalEffectName(identity.experimental).text ?? identity.experimental,
      );
    }

    return parts.length === 0 ? null : parts.join(this.#separator());
  }

  /** The article named beside a card's heading: the module's name and its code. */
  #headIdentity(
    role: DefenceRole,
    withCode: boolean,
  ): {
    readonly name: GameTextPresentation;
    readonly code: string | null;
  } | null {
    const groups = [
      ...(this.#projection()?.shieldRoles ?? []),
      ...(this.#projection()?.armourRoles ?? []),
    ];
    const group = groups.find((candidate) => candidate.role === role);
    const symbol = group === undefined ? null : this.#sharedSymbol(group);
    if (group === undefined || symbol === null) {
      return null;
    }

    const identity = this.#sharedIdentity(group);
    return {
      name: this.#gameText.moduleName(symbol),
      code:
        !withCode || identity === null
          ? null
          : this.#messages.message('defence.module.code', {
              size: this.#formatters.integer(identity.size),
              rating: identity.rating,
            }),
    };
  }

  /**
   * One line per kind of bank aboard, in the package's own slot order.
   *
   * Banks are held apart by everything a Commander would act on: the module
   * fitted, what one activation restores, the cells it carries and whether it
   * is switched on. Two banks alike in all four are the same line, counted, as
   * the canvas counts its boosters; anything else is its own line, because one
   * line covering a powered 5A and a dead 3D describes neither of them.
   */
  #bankLines(banks: readonly CellBankView[], largest: number): readonly BankLineView[] {
    const lines = new Map<string, { readonly bank: CellBankView; count: number }>();

    for (const bank of banks) {
      const key = [bank.symbol, bank.cells, bank.reinforcement, bank.powered].join('|');
      const seen = lines.get(key);
      if (seen === undefined) {
        lines.set(key, { bank, count: 1 });
      } else {
        seen.count += 1;
      }
    }

    return [...lines].map(([key, { bank, count }]) => ({
      id: key,
      name: this.#gameText.moduleName(bank.symbol),
      moduleClass: bank.identity?.size ?? null,
      rating: bank.identity?.rating ?? null,
      count:
        count > 1
          ? this.#messages.message('defence.source.count', {
              count: this.#formatters.integer(count),
            })
          : null,
      detail: [
        this.#messages.message('defence.banks.detail', {
          cells: this.#formatters.integer(bank.cells),
        }),
        ...(bank.powered ? [] : [this.#messages.message('defence.banks.unpowered')]),
      ].join(this.#separator()),
      // One activation, on the block's own scale, so this length and the
      // reserve's above it can be read against each other. The package
      // publishes no per-bank restorable, and one worked out from the cells
      // here would be a figure it never gave.
      reinforcement: this.#megajoules(bank.reinforcement),
      fill: this.#barLength(bank.reinforcement, largest),
      unpowered: !bank.powered,
    }));
  }

  /** A recovery duration, or the symbol for a phase that never finishes. */
  #duration(id: string, label: MessageKey, seconds: number): Metric {
    const finished = Number.isFinite(seconds);
    return {
      id,
      label: this.#messages.message(label),
      value: finished ? this.#formatters.duration(seconds) : null,
      unavailableLabel: finished ? undefined : this.#messages.message('defence.recovery.never'),
      description: finished ? undefined : this.#messages.message('defence.recovery.never.meaning'),
    };
  }

  /**
   * Every package issue, in the order the package returned it.
   *
   * A diagnosis {@link REFUSAL_MESSAGES} words is stated in this application's
   * own language, chosen by the package's `field` and `reason` and by nothing
   * else. Every other diagnosis keeps the package's sentence through the shared
   * presenter, with its canonical language disclosed.
   */
  #issues(issues: readonly CalculationIssueView[]): readonly IssueView[] {
    return issues.map((issue, index) => {
      const worded = REFUSAL_MESSAGES[`${issue.field}/${issue.reason}`];

      return {
        id: `${issue.field}-${issue.reason}-${index}`,
        text: worded === undefined ? null : this.#messages.message(worded),
        message:
          worded === undefined ? this.#gameText.calculationIssueMessage(issue.packageIssue) : null,
      };
    });
  }

  #megajoules(value: number): string {
    return this.#messages.message('defence.format.megajoules', {
      value: this.#formatters.decimal(value, POOL_DIGITS),
    });
  }

  /**
   * How far a bar runs, in `[0, 1]` of what it is measured against.
   *
   * The one ratio this component takes, and it is decoration: every bar it
   * sizes has its own figure set beside it in words, and no length is ever read
   * as a value. `null` where there is nothing to measure against, which draws
   * no bar rather than an empty one a reader would take for zero.
   */
  #barLength(value: number, scale: number): number | null {
    return scale <= 0 ? null : Math.max(0, Math.min(1, value / scale));
  }

  #separator(): string {
    return this.#messages.message('defence.module.separator');
  }
}
