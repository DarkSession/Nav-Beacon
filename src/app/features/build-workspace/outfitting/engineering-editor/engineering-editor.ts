import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  HIGHER_IS_BETTER,
  NO_BLUEPRINT,
  draftIsStale,
  engineeringIntent,
  openEngineeringDraft,
  openingSelection,
  withBlueprint,
  withEffect,
  withGrade,
  type AttributeComparison as ComparedRow,
  type EngineeringDraft,
  type EngineeringSelection,
} from '../../../../application/outfitting/engineering-draft';
import { engineeringView } from '../../../../application/outfitting/engineering-view';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import type { SlotView } from '../../../../application/outfitting/slot-view';
import { Formatters } from '../../../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../../../i18n/game-text.presenter';
import { MessageService } from '../../../../i18n/message.service';
import { Layer } from '../../../../ui/components/layer/layer';
import {
  AttributeComparison,
  type AttributeComparisonRow,
} from '../../../../ui/outfitting/attribute-comparison';
import {
  BlueprintChoiceList,
  NO_BLUEPRINT_CHOICE,
  type BlueprintChoiceView,
} from '../../../../ui/outfitting/blueprint-choice-list';
import {
  ExperimentalEffectList,
  type ExperimentalEffectView,
} from '../../../../ui/outfitting/experimental-effect-list';
import { FixedExperimentalEffect } from '../../../../ui/outfitting/fixed-experimental-effect';
import { GradeSelector } from '../../../../ui/outfitting/grade-selector';

/** What the editor is showing, as one value. */
export type EngineeringState =
  'noModule' | 'packageEmpty' | 'final' | 'stale' | 'refused' | 'ready';

/**
 * Choosing what one module is engineered with.
 *
 * The reference draws the wide editor as a two-column panel inside the bench
 * and the compact one as a full-screen view over an inert background. Both are
 * this component; the arrangement comes from the space the region was given,
 * never from a device label — which is also why 400% zoom and a long German
 * translation select the compact composition for the same reason a phone does.
 *
 * Nothing here mutates the build. The draft holds selection, the preview runs
 * on a detached candidate, and exactly one explicit action commits — so a
 * Commander can price a grade 5, look at what it would do, and walk away having
 * spent no revision and recorded no history (FR-018).
 *
 * There is no clear control. Canvas 1c's wide-only `CLEAR ✕` was withdrawn as
 * duplicative: both canvases already open the blueprint list with `None — stock
 * module`, so the clear route exists identically at both widths and needs no
 * second confirmation — choosing it and applying is one Commander decision and
 * one history frame, like every other apply (engineering editor design,
 * "Clearing engineering").
 */
@Component({
  selector: 'ednb-engineering-editor',
  imports: [
    AttributeComparison,
    BlueprintChoiceList,
    ExperimentalEffectList,
    FixedExperimentalEffect,
    GradeSelector,
    Layer,
    NgTemplateOutlet,
  ],
  templateUrl: './engineering-editor.html',
  styleUrl: './engineering-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EngineeringEditor {
  readonly #messages = inject(MessageService);
  readonly #gameText = inject(GameTextPresenter);
  readonly #formatters = inject(Formatters);
  readonly store = inject(OutfittingStore);

  readonly slot = input.required<SlotView>();

  /** Whether this is a full-screen layer rather than an inline panel. */
  readonly asLayer = input(false);

  readonly closed = output<void>();

  /** The Commander's choices, and the revision they were made against. */
  readonly #pick = signal<{
    readonly selection: EngineeringSelection;
    readonly revision: number;
  } | null>(null);

  /** What the module carries now, re-read at the current revision. */
  readonly current = computed(() => {
    const module = this.slot().module;
    return module === null ? null : engineeringView(module);
  });

  /** True when the choices were made against a build that has since changed. */
  readonly stale = computed(() => {
    const pick = this.#pick();
    return pick !== null && pick.revision !== this.store.revision();
  });

  /**
   * The selection the editor is working from.
   *
   * A stale pick is not carried forward. It describes menus that were true a
   * revision ago, and applying it would apply a decision to a build the
   * Commander is no longer looking at — so it falls back to what the module
   * actually carries now and the surface says the choices were rebuilt.
   */
  readonly selection = computed<EngineeringSelection>(() => {
    const pick = this.#pick();
    const current = this.current();
    return pick === null || this.stale() || current === null
      ? openingSelection(
          current ?? {
            blueprintFdname: null,
            currentGrade: null,
            quality: 1,
            effectFdname: null,
            modifiers: null,
            purchaseVariant: null,
          },
        )
      : pick.selection;
  });

  readonly draft = computed<EngineeringDraft | null>(() => {
    const loadout = this.store.loadout();
    return loadout === null
      ? null
      : openEngineeringDraft(
          loadout,
          this.slot().key,
          this.store.revision(),
          this.selection(),
          this.#gameText,
        );
  });

  readonly state = computed<EngineeringState>(() => {
    const draft = this.draft();
    if (draft === null) {
      return 'noModule';
    }
    if (draft.finalArticle) {
      return 'final';
    }
    if (draft.packageEmpty) {
      return 'packageEmpty';
    }
    if (this.stale()) {
      return 'stale';
    }
    if (this.store.lastEditFailure()?.slotKey === this.slot().key) {
      return 'refused';
    }
    return 'ready';
  });

  /** True where there are choices to make. A final article has none. */
  readonly showChoices = computed(
    () => this.state() === 'ready' || this.state() === 'refused' || this.state() === 'stale',
  );

  readonly blueprintChoices = computed<readonly BlueprintChoiceView[]>(() => {
    const draft = this.draft();
    const currentFdname = draft?.current.blueprintFdname ?? null;
    return (this.draft()?.blueprints ?? []).map((blueprint) => ({
      fdname: blueprint.blueprintSymbol,
      name: this.#gameText.blueprintName(blueprint.blueprintSymbol),
      route: blueprint.route,
      applied: sameIdentity(blueprint.blueprintSymbol, currentFdname),
    }));
  });

  readonly effectChoices = computed<readonly ExperimentalEffectView[]>(() => {
    const draft = this.draft();
    const currentEffect = draft?.current.effectFdname ?? null;
    return (draft?.effects ?? []).map((fdname) => ({
      fdname,
      name: this.#gameText.experimentalEffectName(fdname),
      description: this.#gameText.experimentalEffectDescription(fdname),
      applied: sameIdentity(fdname, currentEffect),
    }));
  });

  /**
   * True where the recipe is the article's rather than a choice.
   *
   * A Merc-Coin article and a pre-engineered reward come with theirs. Changing
   * it would stop the article being the article the Almanac recognises, so the
   * grade stays editable and the recipe is stated (wave 5, FR-012).
   */
  readonly fixedRecipe = computed(() => this.draft()?.current.purchaseVariant != null);

  /** True once a recipe is chosen. Everything under it follows from it. */
  readonly recipeChosen = computed(() => {
    const selected = this.draft()?.selectedBlueprintFdname ?? null;
    return selected !== null && selected !== NO_BLUEPRINT;
  });

  /**
   * The grades the bar runs over: one to the recipe's highest.
   *
   * A Merc-Coin article's bespoke recipe starts at the grade it was bought at,
   * so the cells below that are still drawn — the article carries them — and
   * `lowestGrade` is what makes them unselectable rather than absent. A bar
   * that started at 2 would say the article is a grade short of what it is.
   */
  readonly grades = computed<readonly number[]>(() => {
    const offered = this.#selectedDescriptor()?.grades ?? [];
    const highest = offered.at(-1);
    return highest === undefined ? [] : Array.from({ length: highest }, (_, index) => index + 1);
  });

  /** The first grade the selected recipe actually offers. */
  readonly lowestGrade = computed(() => this.#selectedDescriptor()?.grades[0] ?? null);

  readonly #selectedDescriptor = computed(() => {
    const draft = this.draft();
    const selected = draft?.selectedBlueprintFdname ?? null;
    if (draft === null || selected === null || selected === NO_BLUEPRINT) {
      return null;
    }
    return (
      (this.draft()?.blueprints ?? []).find((blueprint) =>
        sameIdentity(blueprint.blueprintSymbol, selected),
      ) ?? null
    );
  });

  readonly selectedBlueprint = computed(() => this.draft()?.selectedBlueprintFdname ?? null);
  readonly selectedGrade = computed(() => this.draft()?.selectedGrade ?? null);
  readonly selectedEffect = computed(() => this.draft()?.selectedEffectFdname ?? null);

  /** A carried effect that the package reports as fixed rather than editable. */
  readonly fixedEffect = computed(() => {
    const draft = this.draft();
    const fdname = draft?.current.effectFdname ?? null;
    return fdname !== null && draft?.effects.length === 0
      ? this.#gameText.experimentalEffectName(fdname)
      : null;
  });

  /** Whether the panel has a second column to draw. See `EngineeringPreview`. */
  readonly comparingAttributes = computed<boolean>(() => {
    const preview = this.draft()?.preview;
    return preview !== undefined && preview.kind === 'known' && preview.comparing;
  });

  readonly attributes = computed<readonly AttributeComparisonRow[]>(() => {
    const preview = this.draft()?.preview;
    if (preview === undefined || preview.kind !== 'known') {
      return [];
    }
    return preview.attributes.map((row) => ({
      key: row.attribute,
      label: this.#messages.message(`outfitting.engineering.attribute.${row.attribute}` as const),
      stock: this.#figure(row.stock),
      modified: this.#figure(row.modified),
      direction: this.#direction(row),
    }));
  });

  /**
   * What clearing would also cost, when the package would lose something by it.
   *
   * Only shown where the module is a package-identified purchase, because that
   * is the only case where clearing takes away more than the engineering: the
   * Almanac stops recognising the article as bought at all.
   */
  readonly clearConsequence = computed(() =>
    this.draft()?.current.purchaseVariant === null
      ? null
      : this.#messages.message('outfitting.engineering.clear-consequence'),
  );

  /**
   * The layer's own title: the module the screen is open on.
   *
   * Canvas 1d writes the screen's name in the bar and the module under it. A
   * Commander arriving from a ledger row already knows which screen they opened
   * and does not know which of forty mounts it landed on, so the module takes
   * the bar and the screen's name is what the region is called for a reader
   * (Commander request 2026-08-27). Where there is no module there is nothing
   * to name, so the screen's name stands.
   */
  readonly layerTitle = computed(() => {
    const module = this.slot().module;
    return module === null ? this.panelHeading() : (module.displayName.text ?? module.symbol);
  });

  /**
   * The mount, under the module and inside the bar with it.
   *
   * A core module names its own mount: `Power Plant` in the bar over
   * `Power Plant` under it is the same word twice. Every other kind is one of
   * several the module could be in, so the mount is the fact that tells them
   * apart (Commander request 2026-08-27). It sits in the title bar rather than
   * under it, in the bar's own tracked face, which is also what makes the space
   * in `Optional Internal 1 (Size 7)` legible (Commander request 2026-08-28).
   */
  readonly layerDetail = computed(() => {
    const slot = this.slot();
    return slot.module === null || slot.kind === 'core' ? null : this.#slotLabel();
  });

  readonly regionLabel = computed(() =>
    this.#messages.message('outfitting.engineering.region', { slot: this.#slotLabel() }),
  );

  /** Canvas 1c's step ③ bar, over the two cards it heads. */
  readonly panelHeading = this.#messages.messageSignal('outfitting.engineering.heading');

  /** The second card's own bar: the article's attributes. */
  readonly detailsHeading = this.#messages.messageSignal('outfitting.engineering.details.heading');

  /** The first card's own bar: the recipe, the grade and the effect. */
  readonly choicesHeading = this.#messages.messageSignal('outfitting.engineering.choices.heading');

  /**
   * The article the module was bought as, and the grade it was bought at.
   *
   * Kept beside the current grade rather than replacing it. A Mercenary article
   * bought at grade 1 and crafted to 3 is both things at once, and showing one
   * number tells a Commander the wrong thing about the other (FR-007).
   */
  readonly purchaseSummary = computed(() => {
    const variant = this.draft()?.current.purchaseVariant ?? null;
    if (variant === null) {
      return null;
    }
    return this.#messages.message('outfitting.engineering.purchase', {
      article: this.#gameText.preEngineeredVariantName(variant).text ?? variant.name,
      grade: variant.grade,
    });
  });

  readonly applyLabel = this.#messages.messageSignal('outfitting.engineering.apply');
  readonly revertLabel = this.#messages.messageSignal('outfitting.engineering.revert');
  // The layer's own header control, named the way every other layer in the
  // product names it. Two controls called `Revert` in one dialog would give a
  // reader nothing to tell them apart.
  readonly closeLabel = this.#messages.messageSignal('action.close');
  readonly packageEmptyLabel = this.#messages.messageSignal('outfitting.engineering.package-empty');
  readonly finalLabel = this.#messages.messageSignal('outfitting.engineering.final');
  readonly staleLabel = this.#messages.messageSignal('outfitting.engineering.stale');
  readonly loadingLabel = this.#messages.messageSignal('outfitting.engineering.loading');
  readonly #noModuleLabel = this.#messages.messageSignal('outfitting.engineering.no-module');

  /**
   * Why there is no draft: an empty mount, or a build not read yet.
   *
   * Both arrive as `noModule`, and they are not the same sentence. A mount with
   * nothing in it is a settled answer a Commander selected the row to get; a
   * build still loading is a wait. Only the second is a status worth
   * announcing, so only the second is one.
   */
  readonly emptyMount = computed(() => this.slot().module === null);
  readonly noModuleLabel = computed(() =>
    this.emptyMount() ? this.#noModuleLabel() : this.loadingLabel(),
  );
  /** True when applying would actually ask the Almanac for something. */
  readonly canApply = computed(() => {
    const draft = this.draft();
    return draft !== null && !this.stale() && engineeringIntent(draft) !== null;
  });

  chooseBlueprint(fdname: string): void {
    const draft = this.draft();
    if (draft === null) {
      return;
    }
    this.#choose(withBlueprint(draft, fdname === NO_BLUEPRINT_CHOICE ? NO_BLUEPRINT : fdname));
  }

  chooseGrade(grade: number): void {
    const draft = this.draft();
    if (draft !== null) {
      this.#choose(withGrade(draft, grade));
    }
  }

  chooseEffect(fdname: string | null): void {
    const draft = this.draft();
    if (draft !== null) {
      this.#choose(withEffect(draft, fdname));
    }
  }

  /** Commits the draft, as one decision. */
  apply(): void {
    const draft = this.draft();
    if (draft === null) {
      return;
    }

    if (draftIsStale(draft, this.store.revision()) || this.stale()) {
      // The choices were made against a build that no longer exists. Nothing is
      // applied and no history frame is kept; the menus rebuild from what the
      // module actually carries now.
      this.#pick.set(null);
      return;
    }

    const intent = engineeringIntent(draft);
    if (intent === null) {
      return;
    }

    const result = this.store.dispatch(intent);
    if (result.kind === 'committed' || result.kind === 'unchanged') {
      this.#pick.set(null);
      // Only the layer is a place to be taken out of. Inline the editor is the
      // panel the Commander is working in, and it stays open on the module they
      // just engineered.
      if (this.asLayer()) {
        this.closed.emit();
      }
    }
    // A refusal keeps the editor open with the choices intact. The Almanac's
    // reason is published by the workspace's refusal notice, and closing here
    // would take the Commander away from the thing the reason is about.
  }

  /** Abandons the draft. The build and the history are untouched, because only
   * draft state ever changed. */
  revert(): void {
    this.#pick.set(null);
    this.closed.emit();
  }

  #choose(selection: EngineeringSelection): void {
    this.#pick.set({ selection, revision: this.store.revision() });
    // Canvas 1c draws no apply control, so inline the choice is the decision —
    // the same rule the chooser follows one panel up. Canvas 1d's editor is a
    // screen of its own, so it keeps the bar the canvas gives it.
    if (!this.asLayer()) {
      this.apply();
    }
  }

  #slotLabel(): string {
    const slot = this.slot();
    return slot.displayName.text ?? slot.canonicalName;
  }

  /**
   * Which way the recipe moved one figure.
   *
   * The arithmetic direction against the attribute's own sense: more damage is
   * better, more heat is not. `null` where either side is unpublished, because
   * there is nothing to compare and a marker would imply there was.
   */
  #direction(row: ComparedRow): 'better' | 'worse' | 'unchanged' | null {
    if (row.stock === null || row.modified === null) {
      return null;
    }
    if (row.modified === row.stock) {
      return 'unchanged';
    }
    return row.modified > row.stock === HIGHER_IS_BETTER[row.attribute] ? 'better' : 'worse';
  }

  /** A package figure, formatted, or `null` where the package published none. */
  #figure(value: number | null): string | null {
    if (value === null) {
      return null;
    }
    // Two places for everything: the canvas draws `5.72`, `0.88`, `0.34`, and a
    // rule per attribute would be a private opinion about which figures matter.
    return Number.isInteger(value)
      ? this.#formatters.integer(value)
      : this.#formatters.decimal(value, 2);
  }
}

/** Package identities are compared the way the package matches them. */
function sameIdentity(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
