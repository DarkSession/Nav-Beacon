import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import type { PersonalMountKey } from '@elite-dangerous-almanac/core/equipment/suits';
import { adoptSavedRecord } from '../../application/build-library/adopt-saved-record';
import { BuildLibraryStore } from '../../application/build-library/build-library.store';
import { LibraryPresence } from '../build-library/library-presence';
import { NamedRecordService } from '../../application/build-library/named-record.service';
import { RecordInvalidationService } from '../../application/build-library/record-invalidation.service';
import {
  SaveConflictService,
  type ConflictChoice,
} from '../../application/build-library/save-conflict.service';
import { TabOwnershipCoordinator } from '../../application/build-library/tab-ownership.coordinator';
import { LinkErrorMapper } from '../../application/build-link/link-error.mapper';
import { LoadoutAutosaveService } from '../../application/equipment/loadout-autosave.service';
import { LoadoutLinkCoordinator } from '../../application/equipment/loadout-link.coordinator';
import { LoadoutOpenService } from '../../application/equipment/loadout-open.service';
import { LoadoutPresenter } from '../../application/equipment/loadout.presenter';
import { LoadoutStore } from '../../application/equipment/loadout.store';
import type { EditTarget } from '../../domain/equipment/loadout/loadout-edit';
import { Formatters } from '../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { relationId } from '../../ui/a11y/text-equivalence';
import type { IdentityCommit, IdentityField } from '../../ui/outfitting/ship-identity-fields';
import { ChoiceDialog, type DialogChoice } from '../../ui/components/choice-dialog/choice-dialog';
import { StatusNotice } from '../../ui/components/status/status-notice';
import { TabGroup, type TabItem } from '../../ui/components/tab-group/tab-group';
import { observeBenchComposition } from '../../ui/equipment/bench-composition';
import { PersistenceStatus, type StatusActionId } from '../build-workspace/persistence-status';
import {
  SaveBuildDialog,
  type SaveRequest,
  type SaveSource,
} from '../build-workspace/save-build.dialog';
import { HISTORY_REDO_MARK, HISTORY_UNDO_MARK, ScreenChrome } from '../shared/screen-chrome';
import { CommanderStats } from './commander-stats/commander-stats';
import { ExportLoadoutDialog } from './export-loadout-layer/export-loadout.dialog';
import { ImportLoadoutDialog } from './import-loadout-layer/import-loadout.dialog';
import { ItemView } from './item-view/item-view';
import { LoadoutLedger } from './loadout-ledger/loadout-ledger';
import { MaterialRequirements } from './material-requirements/material-requirements';
import { SuitGate } from './suit-gate/suit-gate';
import { ModificationChooser } from './item-view/modification-chooser';

/** Which region the compact composition is showing. */
type BenchTab = 'loadout' | 'stats' | 'materials';

/**
 * The on-foot outfitting bench.
 *
 * The second tool the shell carries. Wide, it is artboard `1a`: the loadout
 * ledger, the item view and the commander column side by side, with the
 * choosers opening over the item view. Compact, it is artboard `1b`: a tab per
 * region — `LOADOUT`, `STATS` and `MATERIALS` — with the item view as a drill-in
 * from a ledger row and the choosers as sheets over it.
 *
 * With nothing on the bench it is artboard `2a` and `2b`: the same regions,
 * drawn and inert, with the suit gate standing in the detail column — the bench
 * is never replaced by an empty state, because what it will hold is what the
 * gate is asking about.
 *
 * Undo and redo are published into the shell's own bar, where the canvas draws
 * them and where the ship tool already puts the same pair (FR-022).
 *
 * Nothing here reaches `@elite-dangerous-almanac/core`. The bench asks the
 * presenter, the presenter asks `domain/equipment/readings`, and those ask the
 * package (constitution II and III).
 */
@Component({
  selector: 'ednb-equipment-bench-page',
  imports: [
    ChoiceDialog,
    CommanderStats,
    ExportLoadoutDialog,
    ImportLoadoutDialog,
    ItemView,
    LoadoutLedger,
    MaterialRequirements,
    ModificationChooser,
    PersistenceStatus,
    SaveBuildDialog,
    StatusNotice,
    SuitGate,
    TabGroup,
  ],
  templateUrl: './equipment-bench.page.html',
  styleUrl: './equipment-bench.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // What persistence is doing is state, not decoration. The workspace states it
  // the same way, and for the same reason: it is the one thing a test can read
  // to know a write has landed without reaching into storage and re-deriving
  // the rule it is checking.
  host: {
    '[attr.data-persistence]': 'store.persistence()',
  },
})
export class EquipmentBenchPage {
  readonly #messages = inject(MessageService);
  readonly #chrome = inject(ScreenChrome);
  readonly #clock = inject(ClockAdapter);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);
  readonly #library = inject(BuildLibraryStore);
  readonly #libraryLayer = inject(LibraryPresence);
  readonly #named = inject(NamedRecordService);
  readonly #conflicts = inject(SaveConflictService);
  readonly #invalidation = inject(RecordInvalidationService);
  readonly #links = inject(LoadoutLinkCoordinator);
  readonly #linkErrors = inject(LinkErrorMapper);
  readonly #ownership = inject(TabOwnershipCoordinator);
  readonly #autosave = inject(LoadoutAutosaveService);
  readonly #open = inject(LoadoutOpenService);
  readonly #location = inject(HistoryLocationAdapter);

  readonly store = inject(LoadoutStore);
  readonly presenter = inject(LoadoutPresenter);

  /** Which artboard the bench has room for, measured on its own box. */
  readonly composition = observeBenchComposition();

  readonly ledgerLabel = this.#messages.messageSignal('equipment.region.loadout');
  readonly itemLabel = this.#messages.messageSignal('equipment.region.item');
  readonly statsLabel = this.#messages.messageSignal('equipment.region.stats');
  readonly materialsLabel = this.#messages.messageSignal('equipment.region.materials');
  readonly tabsLabel = this.#messages.messageSignal('equipment.tab.group');
  readonly saveLabel = this.#messages.messageSignal('workspace.actions.save');
  readonly exportLabel = this.#messages.messageSignal('equipment.action.export');
  readonly conflictTitle = this.#messages.messageSignal('workspace.conflict.title');
  readonly dismissLabel = this.#messages.messageSignal('action.close');

  readonly loadoutPanelId = relationId('bench-loadout');
  readonly statsPanelId = relationId('bench-stats');
  readonly materialsPanelId = relationId('bench-materials');

  readonly tab = signal<BenchTab>('loadout');

  /** Whether the compact drill-in is showing the item view instead of the ledger. */
  readonly drilledIn = signal(false);

  /** Which modification slot has its chooser open, or none. */
  readonly slotOpen = signal<number | null>(null);

  /** Canvas 1b's tab strip: one tab per region, each naming the panel it opens. */
  readonly tabs = computed<readonly TabItem[]>(() => [
    {
      id: 'loadout',
      label: this.#messages.message('equipment.tab.loadout'),
      panelId: this.loadoutPanelId,
    },
    {
      id: 'stats',
      label: this.#messages.message('equipment.tab.stats'),
      panelId: this.statsPanelId,
    },
    {
      id: 'materials',
      label: this.#messages.message('equipment.tab.materials'),
      panelId: this.materialsPanelId,
    },
  ]);

  /** Wide draws every region at once; compact draws the tab that is chosen. */
  shows(tab: BenchTab): boolean {
    return this.composition() === 'wide' || this.tab() === tab;
  }

  /**
   * Compact replaces the ledger with the item view; wide draws both.
   *
   * And on an empty compact bench there is no ledger at all: canvas 2b opens
   * the `LOADOUT` tab straight onto `STEP 1 · CHOOSE A SUIT`. Every row the
   * ledger would draw there says `LOCKED` about a mount no suit has offered
   * yet, and at 390px they fill the screen the one live choice has to be on.
   * Wide keeps them, because canvas 2a has a column to keep them in.
   */
  readonly ledgerShown = computed(
    () =>
      this.shows('loadout') &&
      (this.composition() === 'wide' || (!this.drilledIn() && this.store.hasLoadout())),
  );

  /**
   * Wide draws the detail column always; compact draws it in place of the ledger
   * while a row is drilled into — and on its own while the bench is empty, which
   * is the whole of what canvas 2b's `LOADOUT` tab holds.
   */
  readonly itemShown = computed(
    () =>
      this.composition() === 'wide' ||
      (this.tab() === 'loadout' && (this.drilledIn() || !this.store.hasLoadout())),
  );

  constructor() {
    // Ownership first, then restoration, then saving, then the address. The
    // order is the workspace's, and it is the same order for the same reasons:
    // this page has to know which record is its own before it can restore from
    // it, and has to have restored before a loadout in the address can outrank
    // what was restored (017/FR-009).
    const heldRecordId = this.#ownership.claim('equipment');

    // A page with no record behind it has nothing to restore, which is the
    // ordinary state of a fresh tab rather than a failure. Opening the record
    // decides whether it becomes this page's autosave target: an unnamed one is
    // taken over, a named one is only held (001/FR-008).
    if (!this.store.hasLoadout() && heldRecordId !== null) {
      this.#open.open(heldRecordId);
    }

    const stopTracking = this.#ownership.track(this.store);
    const stopOwnership = this.#ownership.listen();
    const stopAutosave = this.#autosave.start();
    const stopInvalidation = this.#invalidation.listen();

    // Read the address before publishing to it: a Commander who arrived on a
    // loadout link gets that loadout, and the bench then keeps the fragment
    // showing whatever is actually on it (FR-020, 013
    // contracts/equipment-loadout-link.md). A link that is refused leaves the
    // restored loadout where it is and says why (017/FR-009).
    this.#links.ingest(this.#location.fragment());
    const stopListening = this.#links.listen();
    const stopPublishing = this.#links.start();

    inject(DestroyRef).onDestroy(() => {
      // A last best-effort write on the way out, so leaving the bench for
      // another screen cannot cost a choice.
      this.#autosave.flush();
      stopPublishing();
      stopListening();
      stopAutosave();
      stopInvalidation();
      stopOwnership();
      stopTracking();
    });

    // A record discarded in another tab pauses this page's saving rather than
    // being silently recreated by the next autosave. The loadout stays on the
    // bench: nobody here decided anything (017/FR-008).
    effect(() => {
      const deleted = this.#invalidation.deleted();
      const mine = this.store.autosaveRecordId();
      if (mine !== null && deleted.includes(mine)) {
        this.#autosave.pauseAfterExternalDelete();
        this.#invalidation.acknowledgeDeleted(mine);
      }
    });

    // Canvas 1a and 1b put the loadout's own name where every screen's name
    // goes, over the suit and grade it is built on. The shell places the block;
    // the bench owns what it says and what renaming it means.
    effect((onCleanup) => {
      this.#chrome.setIdentity({
        identity: {
          name: this.loadoutName(),
          fallbackName: this.#messages.message('equipment.identity.untitled'),
          nameEditLabel: this.#messages.message('equipment.identity.rename'),
          detail: this.loadoutDetail(),
          // A loadout carries no ID plate. The game registers a ship, not a
          // Commander's kit, so there is no second field to draw.
          ident: null,
          identField: false,
          editing: this.editingIdentity(),
        },
        open: (field) => this.editingIdentity.set(field),
        close: () => this.editingIdentity.set(null),
        commit: (commit) => this.#commitIdentity(commit),
      });
      onCleanup(() => this.#chrome.setIdentity(null));
    });

    // `↶ UNDO  REDO ↷` ahead of the shell's own actions, which is where the
    // canvas draws them and where the ship tool already publishes its pair.
    effect((onCleanup) => {
      this.#chrome.setRegionActions([
        {
          action: {
            id: 'equipment.undo',
            label: this.#messages.message('equipment.action.undo'),
            mark: HISTORY_UNDO_MARK,
            disabled: !this.store.canUndo(),
          },
          perform: () => void this.store.undo(),
        },
        {
          action: {
            id: 'equipment.redo',
            label: this.#messages.message('equipment.action.redo'),
            mark: HISTORY_REDO_MARK,
            // `REDO ↷`, not `↷ REDO`: each arrow points the way its action
            // travels, as the canvas draws them.
            markPosition: 'trailing' as const,
            disabled: !this.store.canRedo(),
          },
          perform: () => void this.store.redo(),
        },
      ]);
      onCleanup(() => this.#chrome.setRegionActions([]));
    });

    // Both are drawn on an empty bench and both are refused there, which is how
    // canvas 2a draws them. A control that vanishes takes the knowledge that it
    // exists with it, and a Commander cannot tell a bench that cannot export
    // from a bench that never could.
    effect((onCleanup) => {
      this.#chrome.setActions([
        {
          action: {
            id: 'equipment.export',
            label: this.#messages.message('equipment.action.export'),
            disabled: !this.store.hasLoadout(),
          },
          perform: () => this.exportOpen.set(true),
        },
        {
          action: {
            id: 'equipment.save',
            label: this.#messages.message('workspace.actions.save'),
            disabled: !this.store.hasLoadout(),
          },
          perform: () => this.openSave(),
        },
      ]);
      onCleanup(() => this.#chrome.setActions([]));
    });
  }

  /**
   * Why the last incoming loadout link was refused, in the Commander's language.
   *
   * On the bench rather than inside the export layer: a Commander who opened an
   * address and got nothing is not going to go looking in a layer for the
   * reason (FR-021). The mount is named in the library's words, never by its
   * journal key.
   */
  readonly linkFailure = computed(() => {
    const failure = this.#links.failure();
    return failure === null ? null : this.#linkErrors.describe(failure, 'equipment');
  });

  /** Whether saving is stopped until the Commander asks for it again. */
  readonly autosavePaused = this.#autosave.paused;

  /**
   * Acts on what the status offered.
   *
   * The workspace's, action for action, and for its reasons.
   */
  actOnPersistence(action: StatusActionId): void {
    if (action === 'resume') {
      this.#autosave.resume();
      return;
    }
    if (action === 'retry') {
      this.#autosave.flush();
      return;
    }
    this.#libraryLayer.raise();
  }

  /** Which identity field the command bar has open for editing, or none. */
  readonly editingIdentity = signal<IdentityField | null>(null);

  /**
   * What the bar calls this loadout: the name it was saved under, or nothing.
   *
   * Nothing rather than the suit's name — the shell draws `UNTITLED LOADOUT`
   * beneath it, and the suit is already the line under that.
   */
  readonly loadoutName = computed(() => this.saveSource()?.name ?? null);

  /**
   * Canvas 1a's crumb: the suit this is built on, its grade, and where it is worn.
   *
   * Canvas 2a and 2b write the same line on an empty bench, saying there is no
   * suit rather than leaving the bar with a name and nothing under it.
   */
  readonly loadoutDetail = computed(() => {
    const loadout = this.store.loadout();
    if (loadout === null) return this.#messages.message('equipment.identity.empty');
    return this.#messages.message('equipment.identity.detail', {
      suit: this.#gameText.suitName(loadout.suitFamily).text ?? '',
      grade: loadout.suitGrade,
    });
  });

  /**
   * Renaming from the command bar.
   *
   * A loadout's name lives on the record it was saved into, so renaming one is
   * writing that record again under the new name. With nothing saved yet there
   * is no name to change: the save layer opens instead, which is where naming
   * an unsaved loadout has always happened, rather than a rename quietly
   * putting a record in the library.
   */
  #commitIdentity(commit: IdentityCommit): void {
    this.editingIdentity.set(null);
    const name = commit.value?.trim() ?? '';
    if (name === '' || commit.field !== 'name') return;
    if (this.store.sourceNamed() === null) {
      this.#saveName.set(name);
      this.#saveOpen.set(true);
      return;
    }
    void this.requestSave({ name, note: null, overwrite: true });
  }

  /** Whether the export layer is open. */
  readonly exportOpen = signal(false);

  /** Whether the save layer is open, and whether a write is in flight. */
  readonly #saveOpen = signal(false);
  readonly saveOpen = this.#saveOpen.asReadonly();
  readonly #saving = signal(false);
  readonly saving = this.#saving.asReadonly();
  readonly #saveFailure = signal<string | null>(null);
  readonly saveFailure = this.#saveFailure.asReadonly();

  /** The name currently typed into the layer, for the duplicate-name count. */
  readonly #saveName = signal('');

  /**
   * The save this loadout was opened from, as the layer needs to state it.
   *
   * The ship tool's own save layer, unchanged: one library holds both tools'
   * records, so naming, replacing and keeping both are one behaviour rather
   * than two (013 contracts/loadout-persistence.md).
   */
  readonly saveSource = computed<SaveSource | null>(() => {
    const source = this.store.sourceNamed();
    if (source === null) return null;
    const record = this.#library.find(source.recordId);
    if (record === null || record.name === null) return null;
    return {
      name: record.name,
      lastSaved: this.#formatters.relativeTime(new Date(record.modifiedAt), this.#clock.now()),
      replaceable: this.#conflicts.canOverwrite,
    };
  });

  /**
   * The name the layer starts from.
   *
   * A loadout carries no name of its own — no ship name, no ident — so the suit
   * it is built on is what it is called until a Commander says otherwise, which
   * is the rule the library already applies to an unnamed loadout row.
   */
  readonly saveInitialName = computed(() => {
    const source = this.saveSource();
    if (source !== null) return source.name;
    const loadout = this.store.loadout();
    return loadout === null ? '' : (this.#gameText.suitName(loadout.suitFamily).text ?? '');
  });

  readonly saveDuplicateCount = computed(() => this.#library.countByName(this.#saveName()));

  /** The conflict another tab's write raised, and the answers to it. */
  readonly conflict = this.#conflicts.conflict;

  readonly conflictDescription = computed(() => {
    const conflict = this.#conflicts.conflict();
    return conflict === null
      ? null
      : this.#messages.message('workspace.conflict.description', {
          name: conflict.observed.name ?? this.saveInitialName(),
        });
  });

  readonly conflictChoices = computed<readonly DialogChoice[]>(() => {
    const choices: DialogChoice[] = [];
    if (this.#conflicts.canOverwrite) {
      choices.push({
        id: 'overwrite',
        label: this.#messages.message('workspace.conflict.overwrite'),
        outcome: this.#messages.message('workspace.conflict.overwrite.outcome'),
      });
    }
    choices.push({
      id: 'keep-both',
      label: this.#messages.message('workspace.conflict.keep-both'),
      outcome: this.#messages.message('workspace.conflict.keep-both.outcome'),
    });
    choices.push({
      id: 'cancel',
      label: this.#messages.message('workspace.conflict.cancel'),
      outcome: this.#messages.message('workspace.conflict.cancel.outcome'),
    });
    return choices;
  });

  openSave(): void {
    // Re-read before asking: the record being offered for replacement may have
    // been renamed or removed in another tab since this page last looked.
    this.#library.refresh();
    this.#saveFailure.set(null);
    this.#saveName.set(this.saveInitialName());
    this.#saveOpen.set(true);
  }

  dismissSave(): void {
    this.#saveOpen.set(false);
  }

  changeSaveName(name: string): void {
    this.#saveName.set(name);
  }

  async requestSave({ name, note, overwrite }: SaveRequest): Promise<void> {
    const loadout = this.store.loadout();
    if (this.#saving() || loadout === null) return;

    this.#saving.set(true);
    const now = this.#clock.timestamp();
    const source = this.store.sourceNamed();
    const payload = { tool: 'equipment', loadout } as const;
    // The unnamed record these changes have been autosaved into, if any. Saving
    // consumes it: replacing a saved loadout removes it once that write has
    // succeeded, and naming the loadout promotes it in place, so a save never
    // leaves a copy of itself behind (013/FR-016, 017/FR-007).
    const held = this.store.autosaveRecordId();

    const result =
      overwrite && source !== null
        ? await this.#conflicts.save(
            {
              recordId: source.recordId,
              expectedRevisionId: source.baseRevisionId,
              name,
              note,
              payload,
              now,
            },
            held,
          )
        : held !== null
          ? await this.#named.nameHeldRecord({ recordId: held, name, note, payload, now })
          : await this.#named.createNamed({ name, note, payload, now });

    this.#saving.set(false);

    // The layer closes on a save that happened and on a conflict that replaces
    // it with a question. It stays open on a write that did nothing, carrying
    // why: the bench looks the same whether a save landed or not.
    if (result.kind === 'saved' || result.kind === 'conflict') {
      this.#saveFailure.set(null);
      this.#saveOpen.set(false);
    } else {
      this.#saveFailure.set(this.#saveFailureMessage(result.kind));
    }

    if (result.kind === 'saved') {
      this.#adoptSavedRecord(result.record.id, result.record.revisionId, held);
    }

    this.#library.refresh();
  }

  async resolveConflict(choice: string): Promise<void> {
    const held = this.store.autosaveRecordId();
    const result = await this.#conflicts.resolve(choice as ConflictChoice);

    if (result?.kind === 'saved') {
      this.#adoptSavedRecord(result.record.id, result.record.revisionId, held);
    } else if (result !== null && result.kind !== 'conflict') {
      this.#saveFailure.set(this.#saveFailureMessage(result.kind));
      this.#saveName.set(this.saveInitialName());
      this.#saveOpen.set(true);
    }
    this.#library.refresh();
  }

  dismissConflict(): void {
    this.#conflicts.clear();
  }

  #saveFailureMessage(kind: 'failed' | 'locks-unavailable' | 'missing'): string {
    return this.#messages.message(
      kind === 'missing' ? 'workspace.save.failed.missing' : 'workspace.save.failed',
    );
  }

  /** The loadout on the bench now belongs to the save that was just written. */
  #adoptSavedRecord(recordId: string, revisionId: string, held: string | null): void {
    adoptSavedRecord(this.store, this.#invalidation, { recordId, revisionId, held });
  }

  showTab(tab: string): void {
    this.tab.set(tab as BenchTab);
  }

  /** The first suit, chosen from the gate rather than from a chooser layer. */
  chooseFirstSuit(family: string): void {
    this.store.dispatch({ kind: 'selectSuit', suitFamily: family });
  }

  /** Opens a ledger row in the item view, drilling in where there is no room. */
  open(target: EditTarget): void {
    this.store.select(target);
    this.slotOpen.set(null);
    // An empty bench has no item view to drill into, and canvas 2b keeps the
    // ledger and the gate on screen together.
    this.drilledIn.set(this.store.hasLoadout());
  }

  /** Fits what the modification chooser answered, into the slot it was opened for. */
  fitModification(symbol: string): void {
    const target = this.store.selected();
    const slot = this.slotOpen();
    if (target === null || slot === null) return;
    this.store.dispatch({ kind: 'fitModification', target, slot, symbol });
    this.slotOpen.set(null);
  }

  /** Empties the open slot, which is a choice made in the chooser (FR-012). */
  clearSlot(): void {
    const target = this.store.selected();
    const slot = this.slotOpen();
    if (target === null || slot === null) return;
    this.store.dispatch({ kind: 'clearSlot', target, slot });
    this.slotOpen.set(null);
  }

  /** Leaves the compact drill-in, back to the ledger it was opened from. */
  closeItem(): void {
    this.drilledIn.set(false);
  }

  setGrade(grade: number): void {
    const target = this.store.selected();
    if (target === null) return;
    this.store.dispatch(
      target === 'suit'
        ? { kind: 'setSuitGrade', grade }
        : { kind: 'setWeaponGrade', mount: target, grade },
    );
  }

  /** Fits what the chooser answered: a suit on the bench, or a weapon on a mount. */
  fit(identity: string): void {
    const target = this.store.selected();
    if (target === null) return;
    this.store.dispatch(
      target === 'suit'
        ? { kind: 'selectSuit', suitFamily: identity }
        : { kind: 'fitWeapon', mount: target as PersonalMountKey, symbol: identity },
    );
  }
}
