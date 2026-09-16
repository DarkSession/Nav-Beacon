import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { deriveBuildTitle } from '../../domain/ships/build/build-title';
import { isShipRecord, type LocalRecord } from '../../domain/records/local-record';
import { ActiveBuildStore } from '../../application/active-build/active-build.store';
import { BuildLinkCoordinator } from '../../application/build-link/build-link.coordinator';
import { FragmentPublisher } from '../../application/build-link/fragment-publisher';
import { LinkErrorMapper } from '../../application/build-link/link-error.mapper';
import { adoptSavedRecord } from '../../application/build-library/adopt-saved-record';
import { AutosaveService } from '../../application/build-library/autosave.service';
import { BuildLibraryStore } from '../../application/build-library/build-library.store';
import { LibraryPresence } from '../build-library/library-presence';
import { NamedRecordService } from '../../application/build-library/named-record.service';
import { RecordInvalidationService } from '../../application/build-library/record-invalidation.service';
import { RecordOpenService } from '../../application/build-library/record-open.service';
import {
  SaveConflictService,
  type ConflictChoice,
} from '../../application/build-library/save-conflict.service';
import { TabOwnershipCoordinator } from '../../application/build-library/tab-ownership.coordinator';
import { Formatters } from '../../i18n/formatters/formatters';
import { MessageService } from '../../i18n/message.service';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { NAVIGATION_ROUTES } from '../shared/app-navigation';
import { ScreenChrome, WORKSPACE_EXPORT_ACTION } from '../shared/screen-chrome';
import { ActionLink } from '../../ui/components/action/action-link';
import { ChoiceDialog, type DialogChoice } from '../../ui/components/choice-dialog/choice-dialog';
import { StatusNotice } from '../../ui/components/status/status-notice';
import { OutfittingWorkspace } from './outfitting/outfitting-workspace/outfitting-workspace';
import { PersistenceStatus, type StatusActionId } from './persistence-status';
import { SaveBuildDialog, type SaveRequest, type SaveSource } from './save-build.dialog';

/**
 * The active build's home.
 *
 * Feature 001 owns the shell: which build is open, where it came from, whether
 * it is saved, and how it is shared. The module editors and statistics that
 * fill the capability outlet arrive with later features and compose into this
 * screen rather than owning a second copy of the build.
 *
 * Provenance is stated in words, not implied by an icon or a colour: "working
 * build" and "from the saved build X" lead to different expectations about what
 * happens when the tab is closed, and a Commander has to be able to tell which
 * one they are in (build-workspace design, "States").
 */
@Component({
  selector: 'ednb-build-workspace-page',
  imports: [
    ActionLink,
    ChoiceDialog,
    OutfittingWorkspace,
    PersistenceStatus,
    SaveBuildDialog,
    StatusNotice,
    RouterLink,
  ],
  templateUrl: './build-workspace.page.html',
  styleUrl: './build-workspace.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // What persistence is doing is state, not decoration. Nothing on the canvas
  // draws it while it is working, so nothing here does either — and this is the
  // one thing a test can read to know a write has landed without reaching into
  // storage and re-deriving the rule it is checking (the same arrangement the
  // outfitting region's `data-composition` uses).
  host: {
    '[attr.data-persistence]': 'persistence()',
    '[attr.data-validation]': 'validationState()',
  },
})
export class BuildWorkspacePage {
  readonly #messages = inject(MessageService);
  readonly #active = inject(ActiveBuildStore);
  readonly #chrome = inject(ScreenChrome);
  readonly #ownership = inject(TabOwnershipCoordinator);
  readonly #autosave = inject(AutosaveService);
  readonly #open = inject(RecordOpenService);
  readonly #named = inject(NamedRecordService);
  readonly #conflicts = inject(SaveConflictService);
  readonly #library = inject(BuildLibraryStore);
  readonly #libraryLayer = inject(LibraryPresence);
  readonly #formatters = inject(Formatters);
  readonly #clock = inject(ClockAdapter);
  readonly #invalidation = inject(RecordInvalidationService);
  readonly #link = inject(BuildLinkCoordinator);
  readonly #publisher = inject(FragmentPublisher);
  readonly #linkErrors = inject(LinkErrorMapper);
  readonly #location = inject(HistoryLocationAdapter);

  readonly catalogueRoute = NAVIGATION_ROUTES.catalogue;

  readonly emptyTitle = this.#messages.messageSignal('workspace.empty.title');
  readonly emptyDescription = this.#messages.messageSignal('workspace.empty.description');
  readonly emptyAction = this.#messages.messageSignal('workspace.empty.action');
  readonly shareLabel = this.#messages.messageSignal('workspace.actions.share');
  readonly saveLabel = this.#messages.messageSignal('workspace.actions.save');
  readonly dismissLabel = this.#messages.messageSignal('action.close');
  readonly conflictTitle = this.#messages.messageSignal('workspace.conflict.title');

  readonly hasBuild = computed(() => this.#active.loadout() !== null);

  /** What persistence is doing, as the shared state name. */
  readonly persistence = computed(() => this.#active.persistence());

  /** Whether saving is stopped until the Commander asks for it again. */
  readonly autosavePaused = this.#autosave.paused;

  /**
   * Acts on what the status offered.
   *
   * Choosing what to discard is the saved records layer's own work, so a full
   * store raises that layer rather than drawing a list of its own.
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

  /** The package's verdict as a state name, drawn or not. */
  readonly validationState = computed(() => {
    const verdict = this.#active.validation();
    if (verdict === null) {
      return null;
    }
    if (!verdict.valid) {
      return 'invalid';
    }
    return verdict.complete ? 'valid' : 'incomplete';
  });

  /** Whether the save layer is open. */
  readonly #saveOpen = signal(false);
  readonly saveOpen = this.#saveOpen.asReadonly();

  /**
   * The name currently typed into the save layer.
   *
   * Held here rather than only in the layer because the count of stored builds
   * already using it is a question about storage, which the layer has no reach
   * into and should not grow one.
   */
  readonly #saveName = signal('');

  /**
   * The save this build was opened from, as the layer needs to state it.
   *
   * `null` for a build that came from nowhere — a stock hull, a decoded link,
   * an imported file — and for one whose source record has since been removed
   * somewhere else. Both mean the same thing to the Commander: there is nothing
   * here to replace, and saving creates a build (FR-008).
   */
  readonly saveSource = computed<SaveSource | null>(() => {
    const record = this.#sourceRecord();
    if (record === null || record.name === null) {
      return null;
    }

    return {
      name: record.name,
      lastSaved: this.#formatters.relativeTime(new Date(record.modifiedAt), this.#clock.now()),
      // Without Web Locks an in-place replacement is an unprotected
      // read-then-write, which is exactly how one tab's version disappears. The
      // layer says so and offers the save that is still safe.
      replaceable: this.#named.canOverwrite,
    };
  });

  /**
   * What the build is called where nothing has named it.
   *
   * FR-010's rule for an unnamed record, applied to the build that is open: its
   * own ship name, else its ident, else the hull. The library already titles a
   * row this way, and the two read the same rule from one place so a Commander
   * meets the same words in the layer as on the row.
   */
  readonly #derivedName = computed(() => {
    // The package mutates the loadout in place, so the revision is what says it
    // changed. Without reading it a Commander who names their ship and then
    // presses SAVE meets the name it had before.
    this.#active.revision();
    const loadout = this.#active.loadout();
    if (loadout === null) {
      return '';
    }
    return deriveBuildTitle(loadout, this.#active.hullName(), '');
  });

  /**
   * The name the layer starts from: what a refused save asked for, else the
   * record's own, else what the build is called.
   *
   * **Revised 2026-08-28 (Commander request).** It used to be nothing at all for
   * a build that came from nowhere, on the reasoning that a name the
   * application filled in is not a name a Commander gave. In front of a
   * Commander that reads as a broken layer — the common way to reach `SAVE` is
   * on a build just created from a hull, and the field was always empty there —
   * and the field is theirs to overwrite before they press anything. The ship's
   * own name is what they already call the build everywhere else it is listed.
   */
  readonly saveInitialName = computed(
    () => this.#lastRequest()?.name ?? this.saveSource()?.name ?? this.#derivedName(),
  );

  /** The note the layer starts from, on the same terms. */
  readonly saveInitialNote = computed(() => {
    const attempted = this.#lastRequest();
    return attempted === null ? (this.#sourceRecord()?.note ?? null) : attempted.note;
  });

  /**
   * The stored record this build was opened from, as the library holds it.
   *
   * Read through the library's own listing rather than straight out of storage:
   * the listing is a signal, so a record another tab renamed or removed changes
   * this as soon as the listing is re-read — which `openSave()` does before it
   * asks anything. A `localStorage` read inside a computed would be read once
   * and then never again, and the layer would go on offering to replace a save
   * under a name it no longer has.
   */
  readonly #sourceRecord = computed<LocalRecord | null>(() => {
    const source = this.#active.sourceNamed();
    return source === null ? null : this.#library.find(source.recordId);
  });

  /** How many stored builds already carry the name being typed. */
  readonly saveDuplicateCount = computed(() => this.#library.countByName(this.#saveName()));

  /** Why the last save wrote nothing, until the next one is attempted. */
  readonly #saveFailure = signal<string | null>(null);
  readonly saveFailure = this.#saveFailure.asReadonly();

  /**
   * What the last save asked for, while that save has not landed.
   *
   * A failed write leaves the layer open on what the Commander typed, which
   * means the layer has to be told what that was: it resets its drafts every
   * time it opens, and a conflict answered and then refused reopens it. Cleared
   * the moment a save lands or the layer is dismissed, so the next opening
   * starts from the build rather than from an abandoned attempt.
   */
  readonly #lastRequest = signal<SaveRequest | null>(null);

  /** Whether a write is in flight, so the commit refuses a second press. */
  readonly #saving = signal(false);
  readonly saving = this.#saving.asReadonly();

  /** The record the Commander is being asked to keep, replace or duplicate. */
  readonly conflict = this.#conflicts.conflict;

  readonly conflictDescription = computed(() => {
    const conflict = this.#conflicts.conflict();
    return conflict === null
      ? null
      : this.#messages.message('workspace.conflict.description', {
          name: conflict.observed.name ?? subjectOf(conflict.observed),
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
      emphasis: 'quiet',
    });

    return choices;
  });

  constructor() {
    // Ownership first, then restoration, then saving. The order is the one the
    // workspace contract states: this tab has to know which record is its own
    // before it can restore from it, and has to have restored before an
    // incoming link is treated as a replacement for something.
    const heldRecordId = this.#ownership.claim('ship');

    // A page with no record behind it has nothing to restore, which is the
    // ordinary state of a fresh tab rather than a failure. Opening the record
    // is what decides whether it becomes this page's autosave target: an
    // unnamed one is taken over, a named one is only held (FR-008).
    const restored =
      this.#active.loadout() === null && heldRecordId !== null
        ? this.#open.open(heldRecordId)
        : Promise.resolve(null);

    const stopTracking = this.#ownership.track(this.#active);
    const stopOwnership = this.#ownership.listen();
    const stopAutosave = this.#autosave.start();
    const stopInvalidation = this.#invalidation.listen();

    // The link comes last, and it comes in this order for a reason. This tab's
    // own build has to be restored before an incoming fragment can be offered
    // as a replacement for it — otherwise the question is asked about nothing —
    // and that fragment has to be read before publication starts, because
    // publishing the restored build would overwrite the link that arrived with
    // the page (build-link contract, "Ingress pipeline", step 6).
    let stopLink: (() => void) | null = null;
    let stopPublishing: (() => void) | null = null;
    let live = true;

    void restored
      .then(() => this.#link.ingest(this.#location.fragment()))
      .then(() => {
        if (!live) {
          return;
        }
        stopLink = this.#link.listen();
        stopPublishing = this.#publisher.start();
      });

    inject(DestroyRef).onDestroy(() => {
      // A last best-effort write on the way out, so leaving the workspace for
      // another screen cannot cost an edit.
      live = false;
      this.#autosave.flush();
      stopTracking();
      stopOwnership();
      stopAutosave();
      stopInvalidation();
      stopLink?.();
      stopPublishing?.();
    });

    // Canvas 1c draws `EXPORT  SAVE` in the command bar's action row, after the
    // history pair the outfitting region publishes, with `SAVE` filled amber as
    // the one committing action of the two. They are published rather than
    // drawn in the page, for the reason the region's own pair is: the frame
    // already renders one list in both the wide row and the folded bar's menu, and a
    // button inside the page would be a second placement neither canvas has.
    effect((onCleanup) => {
      this.#chrome.setActions(
        this.hasBuild()
          ? [
              {
                action: { id: WORKSPACE_EXPORT_ACTION, label: this.shareLabel() },
              },
              {
                action: {
                  id: 'workspace.save',
                  label: this.saveLabel(),
                  emphasis: 'primary' as const,
                },
                perform: () => this.openSave(),
              },
            ]
          : [],
      );
      onCleanup(() => this.#chrome.setActions([]));
    });

    // A record discarded in another tab pauses this tab's saving rather than
    // being silently recreated by the next autosave.
    effect(() => {
      const deleted = this.#invalidation.deleted();
      const mine = this.#active.autosaveRecordId();
      if (mine !== null && deleted.includes(mine)) {
        this.#autosave.pauseAfterExternalDelete();
        this.#invalidation.acknowledgeDeleted(mine);
      }
    });
  }

  /**
   * Why the last incoming build link was refused, in the Commander's language.
   *
   * Shown on the workspace rather than inside the export layer, because a link
   * that arrives refused is not something the Commander went looking for: they
   * pasted an address and nothing happened, and the reason has to be where they
   * are (FR-018).
   */
  readonly linkFailure = computed(() => {
    const failure = this.#link.failure();
    return failure === null ? null : this.#linkErrors.describe(failure);
  });

  /**
   * The package's own verdict, where it is a problem — never this application's.
   *
   * Two states rather than three: an incomplete build is one a Commander is
   * still assembling and an invalid one is a build the game would refuse, and
   * collapsing them would tell them the wrong thing about both. A valid build
   * says nothing at all, because the canvas's build status panel reports
   * problems and stays silent otherwise (design-canvas rule).
   */
  readonly validationProblem = computed(() => {
    switch (this.validationState()) {
      case 'invalid':
        return {
          tone: 'error' as const,
          message: this.#messages.message('workspace.validation.invalid'),
        };
      case 'incomplete':
        return {
          tone: 'warning' as const,
          message: this.#messages.message('workspace.validation.incomplete'),
        };
      default:
        return null;
    }
  });

  /**
   * Opens the save layer on the build that is open.
   *
   * The name it starts from is the record's own where the build came from one,
   * and what the build is called where it did not — its ship name, its ident or
   * its hull, which is the same rule the library titles an unnamed row by
   * (FR-010, revised 2026-08-28 on Commander request).
   */
  openSave(): void {
    // Re-read before asking, not after: the name a Commander is about to type
    // is checked against what this browser is holding *now*, and the record
    // being offered for replacement may have been renamed or removed in another
    // tab since this page last looked.
    this.#library.refresh();
    this.#saveFailure.set(null);
    this.#lastRequest.set(null);
    this.#saveName.set(this.saveInitialName());
    this.#saveOpen.set(true);
  }

  dismissSave(): void {
    this.#saveFailure.set(null);
    this.#lastRequest.set(null);
    this.#saveOpen.set(false);
  }

  changeSaveName(name: string): void {
    this.#saveName.set(name);
  }

  /**
   * Writes the build under the name the Commander typed.
   *
   * Three paths, decided by what they chose and by what this page is holding —
   * never by whether the name matches something. Replacing writes the record
   * this build was opened from under its own lock and consumes the unnamed
   * record the edits were autosaved into; naming promotes that unnamed record
   * in place; and a build with no record of its own yet mints one
   * (FR-008, FR-009).
   */
  async requestSave({ name, note, overwrite }: SaveRequest): Promise<void> {
    if (this.#saving()) {
      return;
    }

    const snapshot = this.#active.snapshot();
    const validation = this.#active.validation();
    if (snapshot === null || validation === null) {
      this.#saveOpen.set(false);
      return;
    }

    this.#saving.set(true);
    this.#lastRequest.set({ name, note, overwrite });
    const now = this.#clock.timestamp();
    const source = this.#active.sourceNamed();
    // The unnamed record these edits have been autosaved into, if any. Saving
    // consumes it: replacing a saved build removes it once that write has
    // succeeded, and naming the build promotes it in place (FR-008).
    const held = this.#active.autosaveRecordId();

    const result =
      overwrite && source !== null
        ? await this.#conflicts.save(
            {
              recordId: source.recordId,
              expectedRevisionId: source.baseRevisionId,
              name,
              note,
              payload: { tool: 'ship', build: snapshot, validation },
              now,
            },
            held,
          )
        : held !== null
          ? await this.#named.nameHeldRecord({
              recordId: held,
              name,
              note,
              payload: { tool: 'ship', build: snapshot, validation },
              now,
            })
          : await this.#named.createNamed({
              name,
              note,
              payload: { tool: 'ship', build: snapshot, validation },
              now,
            });

    this.#saving.set(false);

    // The layer closes on a save that happened and on a conflict that replaces
    // it with a question. It stays open on a write that did nothing, carrying
    // why: the build on screen looks the same whether a save landed or not, so
    // closing over a failure is the one way a Commander loses work without
    // being told (FR-009).
    if (result.kind === 'saved' || result.kind === 'conflict') {
      this.#saveFailure.set(null);
      this.#saveOpen.set(false);
      if (result.kind === 'saved') {
        this.#lastRequest.set(null);
      }
    } else {
      this.#saveFailure.set(this.#saveFailureMessage(result.kind));
    }

    if (result.kind === 'saved') {
      this.#adoptSavedRecord(result.record.id, result.record.revisionId, held);
    }

    this.#library.refresh();
  }

  /**
   * Why a save wrote nothing, in the Commander's language.
   *
   * Three ways it can fail and two things to say. A record that is gone and a
   * browser that cannot take the lock are both "this save has nowhere to go",
   * and both leave the build in hand exactly as it was — which is the part that
   * needs saying either way.
   */
  #saveFailureMessage(kind: 'failed' | 'locks-unavailable' | 'missing'): string {
    return this.#messages.message(
      kind === 'missing' ? 'workspace.save.failed.missing' : 'workspace.save.failed',
    );
  }

  /**
   * Answers the conflict, and says so when the answer wrote nothing.
   *
   * A resolution can fail for the same reasons a save can — a full store, a
   * record removed while the question was on screen — and it fails just as
   * invisibly: the build on screen is the same either way. So the save layer
   * comes back carrying why, which is where a Commander can act on it.
   */
  async resolveConflict(choice: string): Promise<void> {
    const held = this.#active.autosaveRecordId();
    const result = await this.#conflicts.resolve(choice as ConflictChoice);

    if (result?.kind === 'saved') {
      this.#lastRequest.set(null);
      this.#adoptSavedRecord(result.record.id, result.record.revisionId, held);
    } else if (result !== null && result.kind !== 'conflict') {
      // Reopening resets the layer's drafts, so the attempt that was refused is
      // what it reopens on — the name and note the Commander typed before the
      // conflict, not the record's own (FR-009).
      this.#saveFailure.set(this.#saveFailureMessage(result.kind));
      this.#saveName.set(this.saveInitialName());
      this.#saveOpen.set(true);
    }
    this.#library.refresh();
  }

  dismissConflict(): void {
    this.#conflicts.clear();
  }

  /** The build now belongs to the save that was just written. */
  #adoptSavedRecord(recordId: string, revisionId: string, held: string | null): void {
    adoptSavedRecord(this.#active, this.#invalidation, { recordId, revisionId, held });
  }
}

/**
 * What to call a record that has no name.
 *
 * The library holds both tools' records, so a conflict can in principle name
 * either; the hull or the suit is the only other thing a record says about
 * itself without being rebuilt.
 */
function subjectOf(record: LocalRecord): string {
  return isShipRecord(record) ? record.hullSymbol : record.suitFamily;
}
