import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { SlotKind } from '@elite-dangerous-almanac/core/ships/slots';
import { engineeringSummary } from '../../../../application/outfitting/engineering-summary';
import { OutfittingStore } from '../../../../application/outfitting/outfitting.store';
import type { SlotView } from '../../../../application/outfitting/slot-view';
import { slotCapabilities } from '../../../../application/outfitting/slot-capabilities';
import { NO_SLOT_CAPABILITIES } from '../../../../application/outfitting/outfitting-state';
import type { MessageKey } from '../../../../i18n/locale-registry';
import { GameTextPresenter } from '../../../../i18n/game-text.presenter';
import { MessageService } from '../../../../i18n/message.service';
import { HISTORY_REDO_MARK, HISTORY_UNDO_MARK, ScreenChrome } from '../../../shared/screen-chrome';
import type { IdentityCommit, IdentityField } from '../../../../ui/outfitting/ship-identity-fields';
import { relationId } from '../../../../ui/a11y/text-equivalence';
import { observeComposition } from '../../../../ui/outfitting/composition';
import { ActiveBuildStore } from '../../../../application/active-build/active-build.store';
import { LibraryPresence } from '../../../build-library/library-presence';
import { EditRefusalNotice } from '../../../../ui/outfitting/edit-refusal-notice';
import { IngressRefusalNotice } from '../../../../ui/outfitting/ingress-refusal-notice';
import { SlotCard, type SlotCardIntent } from '../../../../ui/outfitting/slot-card';
import { SlotGroup, type SlotGroupView } from '../../../../ui/outfitting/slot-group';
import { BuildStatus } from '../build-status/build-status';
import { CostMaterials } from '../cost-materials/cost-materials';
import { CapacitySummary } from '../capacity-summary/capacity-summary';
import { DefenceSummary } from '../defence-summary/defence-summary';
import { DrivesSummary } from '../drives-summary/drives-summary';
import { PowerBadge } from '../power-badge/power-badge';
import { OffenceSummary } from '../offence-summary/offence-summary';
import { PowerShedStatements } from '../power-shed-statements/power-shed-statements';
import { PowerSummary } from '../power-summary/power-summary';
import { EngineeringEditor } from '../engineering-editor/engineering-editor';
import { HullAnatomy, type AnatomyGuestMode } from '../hull-anatomy/hull-anatomy';
import { ModuleReplacement } from '../module-replacement/module-replacement';

/** The category controls the canvas draws above the ledger. */
type Category = 'all' | SlotKind;

/**
 * Which mount kinds one category lists.
 *
 * `core` lists three. Canvas 1c counts `CORE 8` on an Anaconda whose seven core
 * internals are followed by its cargo hatch, and canvas 1d's `CORE` panel draws
 * that hatch as its last row — so the hatch is a core internal as far as both
 * artboards are concerned, whatever the package's own `SlotKind` calls it.
 * Armour joins it for the same reason and one more: without `ALL` there is no
 * other tab it could be reached from (Commander request 2026-08-26).
 */
export const CATEGORY_KINDS: Readonly<Record<SlotKind, SlotKind>> = {
  hardpoint: 'hardpoint',
  utility: 'utility',
  optional: 'optional',
  core: 'core',
  armour: 'core',
  cargoHatch: 'core',
};

/** The strip segment that opens the status rail at compact width. */
const STATUS_MODE = 'status';

/**
 * The kinds a Commander can narrow the ledger to, in the order the ledger draws
 * them. It is the order in which the kinds first appear in `ShipLoadout.slots()`
 * for every hull, and a unit test walks the catalogue to hold the two together.
 * Canvas 1d offers these with no `ALL`.
 */
export const COMPACT_CATEGORIES = ['hardpoint', 'utility', 'core', 'optional'] as const;

/** Canvas 1c's chips: `ALL`, then the same kinds in the same order. */
const WIDE_CATEGORIES = ['all', ...COMPACT_CATEGORIES] as const;

/**
 * The outfitting region inside feature 001's `/outfitting`.
 *
 * Canvas 1c composes three regions at wide width — the categories and the
 * ledger, the selected mount's bench, and the status rail — and canvas 1d
 * stacks the same content with the bench as a full-screen layer. Both are the
 * same DOM in the same order; which one appears is decided in CSS from the
 * space the region is actually given, so 400% zoom and a long translation
 * select the compact composition for the same reason a narrow phone does
 * (responsive composition, "Reference and selection rule").
 *
 * The categories change what is *visible* and nothing else. They spend no
 * revision, record no history and are not part of the build — which is why the
 * ledger they filter is still the complete package ledger underneath (FR-018).
 *
 * The no-build state promises nothing. Creating and opening a build belong to
 * feature 001 and importing belongs to feature 004; this region says why it is
 * empty and stops there rather than offering an action it does not own (FR-001).
 */
@Component({
  selector: 'ednb-outfitting-workspace',
  imports: [
    NgTemplateOutlet,
    BuildStatus,
    CapacitySummary,
    CostMaterials,
    DefenceSummary,
    OffenceSummary,
    DrivesSummary,
    PowerBadge,
    PowerShedStatements,
    PowerSummary,
    EditRefusalNotice,
    HullAnatomy,
    EngineeringEditor,
    IngressRefusalNotice,
    ModuleReplacement,
    SlotCard,
    SlotGroup,
  ],
  templateUrl: './outfitting-workspace.html',
  styleUrl: './outfitting-workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutfittingWorkspace {
  readonly #messages = inject(MessageService);
  readonly #gameText = inject(GameTextPresenter);
  readonly store = inject(OutfittingStore);
  readonly active = inject(ActiveBuildStore);
  readonly #chrome = inject(ScreenChrome);
  readonly #libraryLayer = inject(LibraryPresence);

  /**
   * The category a Commander asked for, or none — nobody has asked yet.
   *
   * Held apart from what is *shown* so that a value nobody chose can never
   * outlive the offering that produced it. The composition reports `compact`
   * until the observer has measured the region for the first time, so the
   * offering a category is first read against is canvas 1d's four tabs even on
   * a desktop window — and a chosen-value-wins rule would then latch
   * `HARDPOINTS` a frame before `ALL` existed and keep it, because `HARDPOINTS`
   * is offered at both widths. Wide width would open on one eighth of the
   * ledger with `ALL` beside it unpressed.
   */
  readonly #chosenCategory = signal<Category | null>(null);

  /**
   * Which mounts are listed. Visibility only; never build or history state.
   *
   * A choice holds for as long as the width still offers it: narrowing while
   * `ALL` is shown lands on the tab canvas 1d draws selected, and widening
   * again returns to `ALL` — which nobody chose away from.
   */
  readonly category = computed<Category>(() => {
    const offered = this.categories().map((entry) => entry.value);
    const chosen = this.#chosenCategory();
    return chosen !== null && offered.includes(chosen) ? chosen : offered[0]!;
  });

  /** Shows one category. The strip's own press, and nothing else's. */
  showCategory(value: Category): void {
    this.#chosenCategory.set(value);
  }

  /**
   * Which identity field the command bar has open, if either.
   *
   * View state and nothing else: opening the field, typing in it and closing it
   * again spend no revision and record no decision. Only confirming does
   * (FR-018).
   */
  readonly editingIdentity = signal<IdentityField | null>(null);

  /**
   * Which composition this region has room for.
   *
   * Most of the arrangement is CSS. This exists for the one decision CSS
   * cannot make: whether the bench is an inline region beside the ledger or a
   * full-screen layer that makes the rest of the page inert.
   */
  readonly composition = observeComposition();

  /** True where the bench has to become a layer rather than sit inline. */
  readonly benchIsLayer = computed(() => this.composition() === 'compact');

  /**
   * Whether the ledger draws canvas 1c's dense rows.
   *
   * The two-pane and wide compositions both draw 1c's inline rail beside the
   * bench, so both draw its rows. The compact composition keeps canvas 1d's.
   */
  readonly ledgerDense = computed(() => this.composition() !== 'compact');

  /**
   * Whether the status rail is the strip's guest segment rather than a column.
   *
   * The rail is canvas 1c's third track, and only the widest arrangement draws
   * it. Below that the grid has two columns and the rail had neither: it ran
   * the full width under the bench, a tall band of readings squeezed beneath
   * the module a Commander was working on. Canvas 1d already answers this — the
   * rail is the strip's `STATUS` segment there — and the answer is the same
   * wherever there is no column for it (Commander request 2026-08-30).
   */
  readonly statusIsGuest = computed(() => this.composition() !== 'wide');

  /**
   * Which segment of the anatomy strip is open, as the strip reports it.
   *
   * The strip is the anatomy's; this is only what the workspace needs in order
   * to draw the one segment the anatomy draws nothing for.
   */
  readonly #anatomyMode = signal<string>('mounts');

  /**
   * Whether the anatomy region is showing a dashboard rather than its plates.
   *
   * The middle column bounds the plates, which are drawn at the hull's own
   * proportions and fit it. A dashboard is whatever the build has to say and
   * does not, so the column releases and the page carries it
   * (`design/outfitting-workspace.md`, "a detail panel is not bounded by the
   * column"). Read off `mounts` rather than by listing the dashboards, so a
   * mode that lands next releases the column by what it draws rather than by a
   * list somebody remembered to add it to — the same rule the region applies to
   * itself.
   */
  readonly anatomyDashboard = computed(() => {
    const mode = this.#anatomyMode();
    if (mode === 'mounts') {
      return false;
    }
    // A guest segment the strip has stopped offering is not open. The region
    // falls back to its own first mode when the mode it was asked for is a
    // guest one it no longer offers, and it does so without emitting — so a
    // reading of its own that did not fall back with it went on releasing this
    // column for a dashboard while the region was drawing plates
    // (`hull-anatomy.ts`, `#mode`). `STATUS` is the one guest segment, and
    // whether it is offered is the same question as below.
    return mode !== STATUS_MODE || this.statusIsGuest();
  });

  /**
   * Whether the bench has a mount to draw, and so releases the column too.
   *
   * The middle column bounds an anatomy of plates over an empty bench, which is
   * the arrangement it was written for. A bench with a mount in it is the other
   * thing that does not fit: the engineering editor is as tall as the
   * article has to say — around seventy attribute rows on a weapon — and it no
   * longer scrolls inside itself, so the column releases and the page carries
   * it (`design/outfitting-workspace.md`, "a bench is not bounded by the column
   * either"; FR-012b).
   *
   * Read off the selected mount rather than off the engineering panel, and the
   * two say the same thing: inline, canvas 1c draws that panel with no control
   * that opens it, so it is simply there for whichever row is marked — empty
   * mount or not — and `engineeringShown()` answers `true` for every mount
   * there is. The mount is what the region already knows about, and it is the
   * question the bench itself is drawn from.
   *
   * At layer width the bench is one of canvas 1d's full-screen views and this
   * decides nothing: the rules it feeds are the wide composition's, and a layer
   * owns the viewport rather than a column of it.
   */
  readonly benchDrawn = computed(() => this.selectedSlot() !== null);

  /**
   * Canvas 1d's sixth segment, `STATUS`, and what it opens.
   *
   * Offered only where the artboard draws it. At wide width the rail is the
   * third track of canvas 1c's grid and is on screen whatever the strip has
   * open, so there is nothing for a segment to reveal (Commander request
   * 2026-08-26). At every narrower arrangement there is no such track, and the
   * segment is how the rail is reached.
   */
  readonly anatomyGuestModes = computed<readonly AnatomyGuestMode[]>(() =>
    this.statusIsGuest()
      ? [
          {
            id: STATUS_MODE,
            label: this.statusModeLabel(),
            heading: this.statusRailLabel(),
          },
        ]
      : [],
  );

  /** Whether the strip currently has the status rail open as its guest. */
  readonly statusModeOpen = computed(
    () => this.statusIsGuest() && this.#anatomyMode() === STATUS_MODE,
  );

  /**
   * Whether the rail is on screen: its own column, or its open guest segment.
   *
   * The rail is written once and placed twice, and below wide width it is in
   * the document whether or not its segment is open — the stylesheet is what
   * withholds a closed one. Its cell band is built from this instead, because a
   * band built into a closed rail is a second live copy of every cell beside
   * the strip that is drawing them (003/FR-024).
   */
  readonly statusRailDrawn = computed(() => !this.statusIsGuest() || this.statusModeOpen());

  readonly regionHeadingId = relationId('outfitting-region');
  readonly statusRailHeadingId = relationId('status-rail');

  readonly regionLabel = this.#messages.messageSignal('outfitting.region.label');
  readonly ledgerLabel = this.#messages.messageSignal('outfitting.ledger.label');
  readonly statusRailLabel = this.#messages.messageSignal('outfitting.status-rail.label');
  readonly categoryLegend = this.#messages.messageSignal('outfitting.category.legend');
  readonly statusModeLabel = this.#messages.messageSignal('outfitting.status-rail.mode');
  readonly keyFiguresLabel = this.#messages.messageSignal('outfitting.key-figures.label');
  readonly noBuildTitle = this.#messages.messageSignal('outfitting.no-build.title');
  readonly noBuildDescription = this.#messages.messageSignal('outfitting.no-build.description');
  readonly replaceLabel = this.#messages.messageSignal('outfitting.capability.replace');
  readonly engineerLabel = this.#messages.messageSignal('outfitting.capability.engineer');
  readonly undoLabel = this.#messages.messageSignal('outfitting.history.undo');
  readonly redoLabel = this.#messages.messageSignal('outfitting.history.redo');

  /**
   * The category controls, in the order the canvas draws them.
   *
   * Four at compact width and five at wide. Canvas 1d draws `HARDPOINTS`,
   * `UTILITY`, `CORE` and `OPTIONAL` and no `ALL`: at that width the ledger is
   * one category at a time and a Commander says which, rather than being handed
   * thirty-four mounts to scroll (Commander request 2026-08-26).
   */
  readonly categories = computed(() =>
    (this.benchIsLayer() ? COMPACT_CATEGORIES : WIDE_CATEGORIES).map((value) => ({
      value: value as Category,
      label: this.#messages.message(categoryKey(value)),
      count: this.#countFor(value),
    })),
  );

  /** The visible mounts, grouped by kind in the order the ledger draws them. */
  readonly groups = computed<readonly SlotGroupView[]>(() => {
    const category = this.category();
    const groups: SlotGroupView[] = [];

    for (const slot of this.store.slots()) {
      if (category !== 'all' && CATEGORY_KINDS[slot.kind] !== category) {
        continue;
      }
      const last = groups.at(-1);
      if (last !== undefined && last.kind === slot.kind) {
        (last.slots as SlotView[]).push(slot);
      } else {
        groups.push({ kind: slot.kind, slots: [slot] });
      }
    }

    return groups;
  });

  readonly selectedSlot = this.store.selectedSlot;
  readonly failure = this.store.lastEditFailure;

  /** Why a build the Commander tried to open never became this one. */
  readonly ingressFailures = this.active.ingressFailures;

  /**
   * Whether a reader still has to be told about that refusal.
   *
   * A record carrying a roll the package cannot complete is refused from the
   * saved builds, which stand over whatever screen a Commander is on — so one
   * opened from elsewhere leaves this screen to be built with the refusal
   * already on it, and the notice has no transition of its own to watch. The
   * store saw the report and this passes on its answer, so a refusal the
   * Commander has just caused is spoken and one they were told about last visit
   * is not (011/FR-009).
   *
   * Not while the saved builds stand over this screen. The other way into this
   * refusal is opening a record from that layer, and this screen stays mounted
   * underneath it — so the notice would speak into an outlet the modal has made
   * inert and spend the mark on a sentence nobody heard. Held until the layer
   * goes, the refusal is spoken by the screen that draws every affected mount,
   * at the moment that screen is the one a reader is on. The layer says its own
   * piece meanwhile, in its own alert, over the record it could not open.
   */
  readonly ingressRefusalUnannounced = computed(
    () => this.active.ingressRefusalUnannounced() && !this.#libraryLayer.open(),
  );

  /** Says the refusal has been spoken, so returning to it says nothing more. */
  markIngressRefusalAnnounced(): void {
    this.active.markIngressRefusalAnnounced();
  }

  /**
   * The ledger's own labels, keyed by exact slot key.
   *
   * The ingress refusal names mounts, and it names them the way the ledger does
   * rather than by the game's slot key — which is the identity everything uses
   * and not something a Commander reads.
   */
  readonly slotLabels = computed<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      this.store.slots().map((slot) => [slot.key, slot.displayName.text ?? slot.canonicalName]),
    ),
  );

  /** The label the ledger draws for the selected mount, for the notices. */
  readonly selectedSlotLabel = computed(() => {
    const slot = this.selectedSlot();
    return slot === null ? null : (slot.displayName.text ?? slot.canonicalName);
  });

  /**
   * The canvas's `FITTING . HARDPOINT 1`, in the Commander's language.
   *
   * A hardpoint is named by the number the ledger draws beside it and the class
   * it takes — `Fitting · Hardpoint 1 · Huge`. The package's own slot name is
   * `Huge Hardpoint 1`, where the 1 counts huge hardpoints rather than
   * hardpoints, so on a hull with two large mounts it names a different mount
   * from the one the ledger marked (wave 6). Every other kind keeps the
   * package's name, which is the name the game uses for it.
   */
  readonly benchTitle = computed(() => {
    const slot = this.selectedSlot();
    if (slot === null) {
      return '';
    }
    const mountClass = slot.kind === 'hardpoint' ? hardpointClassKey(slot.size) : null;
    return mountClass === null
      ? this.#messages.message('outfitting.bench.title', {
          slot: slot.displayName.text ?? slot.canonicalName,
        })
      : this.#messages.message('outfitting.bench.title.hardpoint', {
          node: slot.node,
          class: this.#messages.message(mountClass),
        });
  });

  /**
   * The Almanac's reason the selected mount offers less than the others.
   *
   * Shown where an action is absent, because an action missing without a
   * reason reads as a defect rather than as a rule of the game (FR-009).
   */
  readonly benchReason = computed(() => {
    const slot = this.selectedSlot();
    if (slot === null || slot.immovableReason === null) {
      return null;
    }
    const key: MessageKey = (
      {
        cargoHatch: 'outfitting.immovable.cargoHatch',
        requiredSlot: 'outfitting.immovable.requiredSlot',
        moduleLimit: 'outfitting.immovable.moduleLimit',
      } as const
    )[slot.immovableReason];
    return this.#messages.message(key);
  });

  /**
   * What the Almanac says this mount will take, where it restricts what fits.
   *
   * On the bench and not in the ledger, for the same reason the immovable
   * reason is: the canvas's ledger row is a size, a module and a power chip,
   * and a package sentence repeated down every restricted row is noise a
   * Commander scrolls past. Here it answers the question the panel below it is
   * asking (reference review, "Per-row change/engineer/remove actions").
   */
  readonly benchRestriction = computed(() => {
    const restriction = this.selectedSlot()?.restrictionText ?? null;
    return restriction === null || restriction.text === null
      ? null
      : this.#messages.message('outfitting.slot.restriction', { restriction: restriction.text });
  });

  /**
   * Whether the fitting panel is on screen, which is two different questions.
   *
   * Inline it is not a surface that opens at all: canvas 1c draws the panel
   * under the anatomy for whichever row is marked, with no control that reveals
   * it. As a layer it is one of canvas 1d's two full-screen views, and it is on
   * screen only while a Commander has it open.
   */
  readonly replacementShown = computed(() => {
    const slot = this.selectedSlot();
    if (slot === null) {
      return false;
    }
    return this.benchIsLayer()
      ? this.store.surface() === 'replacement'
      : this.capabilitiesFor(slot).canOpenReplacement;
  });

  /** The same question for the engineering panel, answered the same way. */
  readonly engineeringShown = computed(() => {
    const slot = this.selectedSlot();
    if (slot === null) {
      return false;
    }
    // Inline, the panel is simply there for whichever row is marked: canvas 1c
    // draws no control that opens it, and a mount with nothing in it is exactly
    // the mount a Commander is asking about when they select it. Gating it on a
    // fitted module made the region come and go as the selection moved down the
    // ledger, which answers by saying nothing (wave 9's own reasoning for
    // `packageEmpty`, applied to the empty mount it left out).
    //
    // At layer width it is a screen reached by pressing `ENGINEER`, and that
    // action still needs a module to be about.
    return this.benchIsLayer() ? this.store.surface() === 'engineering' : true;
  });

  constructor() {
    // Canvas 1c draws `↶ UNDO` and `REDO ↷` in the command bar's action row;
    // canvas 1d puts the same two in the `⋮` menu. The shell already renders
    // one list in both placements, so they are published rather than drawn
    // again here — a second pair inside the region would be the same actions
    // twice, in a place neither canvas puts them (FR-016).
    // Canvas 1c and 1d both put the build's name where every other screen's
    // name goes, with the hull and the ID plate under it. The workspace owns
    // the values and what confirming one means; the shell places the block.
    effect((onCleanup) => {
      this.#chrome.setIdentity(
        this.store.hasBuild()
          ? {
              identity: {
                name: this.shipName(),
                // An unnamed build is titled by what the build calls itself,
                // the same way the library titles its row — and the hull then
                // stops being repeated on the line beneath it (FR-010, T155a).
                fallbackName: this.hullName(),
                detail: this.shipName() === null ? null : this.hullName(),
                ident: this.shipIdent(),
                editing: this.editingIdentity(),
              },
              open: (field) => this.editingIdentity.set(field),
              close: () => this.editingIdentity.set(null),
              commit: (commit) => this.#commitIdentity(commit),
            }
          : null,
      );
      onCleanup(() => this.#chrome.setIdentity(null));
    });

    effect((onCleanup) => {
      this.#chrome.setRegionActions(
        this.store.hasBuild()
          ? [
              {
                action: {
                  id: 'outfitting.undo',
                  label: this.undoLabel(),
                  mark: HISTORY_UNDO_MARK,
                  disabled: !this.store.canUndo(),
                  description: this.#named(
                    'outfitting.history.undo.named',
                    this.store.undoSummary(),
                  ),
                },
                perform: () => void this.store.undo(),
              },
              {
                action: {
                  id: 'outfitting.redo',
                  label: this.redoLabel(),
                  mark: HISTORY_REDO_MARK,
                  // `REDO ↷`, not `↷ REDO`: the canvas points each arrow
                  // the way its action travels, so this one follows its word.
                  markPosition: 'trailing' as const,
                  disabled: !this.store.canRedo(),
                  description: this.#named(
                    'outfitting.history.redo.named',
                    this.store.redoSummary(),
                  ),
                },
                perform: () => void this.store.redo(),
              },
            ]
          : [],
      );
      onCleanup(() => this.#chrome.setRegionActions([]));
    });
  }

  /** The ship's name and ID plate, re-read from the package at each revision. */
  readonly shipName = computed(() => {
    this.store.revision();
    return this.store.loadout()?.shipName ?? null;
  });

  readonly shipIdent = computed(() => {
    this.store.revision();
    return this.store.loadout()?.shipIdent ?? null;
  });

  /** The hull the canvas draws under the name, in the Commander's language. */
  readonly hullName = computed(() => {
    const symbol = this.store.loadout()?.shipSymbol ?? null;
    return symbol === null ? null : (this.#gameText.shipName(symbol).text ?? symbol);
  });

  /** One confirmed identity field, as one Commander decision (FR-019). */
  #commitIdentity(commit: IdentityCommit): void {
    this.editingIdentity.set(null);
    this.store.dispatch(
      commit.field === 'name'
        ? { kind: 'setShipName', value: commit.value }
        : { kind: 'setShipIdent', value: commit.value },
    );
  }

  /** The drawn label plus what it would step through, for a reader only. */
  #named(key: MessageKey, summary: string | null): string | undefined {
    return summary === null ? undefined : this.#messages.message(key, { summary });
  }

  /** What the package permits on one mount, re-read at the current revision. */
  capabilitiesFor(slot: SlotView) {
    this.store.revision();
    const loadout = this.store.loadout();
    return loadout === null ? NO_SLOT_CAPABILITIES : slotCapabilities(loadout, slot);
  }

  /**
   * The engineering the ledger's code line carries, as canvas 1c draws it.
   *
   * `OVERCHARGED G5` — the recipe's name in the Commander's language and the
   * grade currently applied. It is beside the engineered marker rather than
   * instead of it, because a glyph is not readable and disappears in forced
   * colours (feature 011, FR-010).
   */
  engineeringSummaryFor(slot: SlotView): string | null {
    const module = slot.module;
    return module === null ? null : engineeringSummary(module, this.#gameText, this.#messages);
  }

  handle(slot: SlotView, intent: SlotCardIntent): void {
    switch (intent.kind) {
      case 'select':
        // Selecting is not a toggle. Pressing the selected row again would
        // empty the bench a Commander is reading, which is a state nobody asked
        // for; moving to another mount is how selection changes.
        this.store.select(slot.key);
        return;
      case 'replace':
        this.store.select(slot.key);
        this.store.showSurface('replacement');
        return;
      case 'engineer':
        this.store.select(slot.key);
        this.store.showSurface('engineering');
        return;
      case 'remove':
        this.store.dispatch({ kind: 'remove', slotKey: slot.key });
        return;
      case 'setEnabled':
        this.store.dispatch({ kind: 'setEnabled', slotKey: slot.key, enabled: intent.enabled });
        return;
      case 'setPriority':
        // Power belongs to the mount it was pressed on, not to whichever one
        // happens to be selected. Nothing here selects it first: switching a
        // heat sink off is not a reason to empty the bench a Commander is
        // reading.
        this.store.dispatch({ kind: 'setPriority', slotKey: slot.key, priority: intent.priority });
        return;
    }
  }

  closeSurface(): void {
    this.store.showSurface('workspace');
  }

  /** Records which segment of the anatomy strip is open. View state only. */
  showAnatomyMode(mode: string): void {
    this.#anatomyMode.set(mode);
  }

  #countFor(category: Category): number {
    const slots = this.store.slots();
    return category === 'all'
      ? slots.length
      : slots.filter((slot) => CATEGORY_KINDS[slot.kind] === category).length;
  }
}

/** The label one category control carries. */
function categoryKey(category: Category): MessageKey {
  return (
    {
      all: 'outfitting.category.all',
      hardpoint: 'outfitting.category.hardpoint',
      core: 'outfitting.category.core',
      optional: 'outfitting.category.optional',
      utility: 'outfitting.category.utility',
      armour: 'outfitting.group.armour',
      cargoHatch: 'outfitting.group.cargoHatch',
    } as const
  )[category];
}

/**
 * The class word for a hardpoint's published size, or nothing.
 *
 * The game's four hardpoint classes are its own vocabulary for the sizes the
 * package publishes as 1 to 4. A size outside that range is a number nobody
 * has a word for, so the mount keeps the package's own name instead of being
 * given one (constitution IV).
 */
function hardpointClassKey(size: number | null): MessageKey | null {
  return (
    (
      {
        1: 'outfitting.slot.class.1',
        2: 'outfitting.slot.class.2',
        3: 'outfitting.slot.class.3',
        4: 'outfitting.slot.class.4',
      } as const
    )[size ?? 0] ?? null
  );
}
