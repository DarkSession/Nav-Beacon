import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { LibraryPresence } from './library-presence';
import { deriveBuildTitle } from '../../domain/ships/build/build-title';
import {
  isShipRecord,
  type LocalRecord,
  type StoredRecordEntry,
} from '../../domain/records/local-record';
import { ActiveBuildStore } from '../../application/active-build/active-build.store';
import { LoadoutStore } from '../../application/equipment/loadout.store';
import { TabOwnershipCoordinator } from '../../application/build-library/tab-ownership.coordinator';
import { EmptyBenchService } from '../../application/equipment/empty-bench.service';
import { BuildLibraryStore } from '../../application/build-library/build-library.store';
import { RecordInvalidationService } from '../../application/build-library/record-invalidation.service';
import { RecordOpenService } from '../../application/build-library/record-open.service';
import { LoadoutOpenService } from '../../application/equipment/loadout-open.service';
import { RetentionService } from '../../application/build-library/retention.service';
import { RecordSynchronisationCoordinator } from '../../application/synchronisation/record-synchronisation.coordinator';
import { RecordSynchronisationStore } from '../../application/synchronisation/record-synchronisation.store';
import { SynchronisationPresenter } from '../../application/synchronisation/synchronisation.presenter';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { Formatters } from '../../i18n/formatters/formatters';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { MessageService } from '../../i18n/message.service';
import { ActionButton } from '../../ui/components/action/action-button';
import { ConfirmDialog } from '../../ui/components/confirm-dialog/confirm-dialog';
import {
  RecordManager,
  type ManageableRecord,
} from '../../ui/components/record-manager/record-manager';
import { AnnouncementService } from '../../ui/announcements/announcement.service';
import {
  ResponsiveRecordList,
  type RecordColumns,
  type UnavailableRecord,
} from '../../ui/components/record-list/responsive-record-list';
import { TextField } from '../../ui/components/text-field/text-field';
import { Layer } from '../../ui/components/layer/layer';
import type { SavedBuild } from '../../ui/components/saved-build-card/saved-build-card';
import { StatusNotice } from '../../ui/components/status/status-notice';
import { SynchronisationPanel } from './synchronisation-panel.component';
import { OwnedShipsPanel } from './owned-ships-panel.component';
import { TabGroup, type TabItem } from '../../ui/components/tab-group/tab-group';
import { FleetPresenter } from '../../application/fleet/fleet.presenter';
import { FleetCopyService } from '../../application/fleet/fleet-copy.service';
import { NAVIGATION_ROUTES } from '../shared/app-navigation';
import type { ConflictChoice } from '../../domain/commander/record-conflict';

/**
 * One action the committing footer offers on the record that was chosen.
 *
 * The actions left the rows on 2026-08-25 and became shared: the reference
 * draws dense rows and commits from a footer, and a stack of buttons repeated
 * into every row is what made the built version a wall of panels rather than a
 * library (build-library design, "The library is not built to the canvas").
 * Two of them are left since 2026-08-27 — delete, and open in outfitting —
 * because naming, renaming and duplicating are the workspace's own `SAVE`
 * (FR-009, ruled 2026-08-27).
 */
interface RecordAction {
  readonly id: string;
  readonly label: string;
  readonly emphasis: 'primary' | 'secondary' | 'quiet' | 'danger';
}

/** A record awaiting a delete confirmation. */
interface PendingDelete {
  readonly recordId: string;
  readonly title: string;
  readonly hull: string;
  readonly unnamed: boolean;
}

/**
 * Everything this browser is holding for the Commander.
 *
 * A layer rather than a screen: it is raised over whatever a Commander is on,
 * takes a history entry at that same address so the back button closes it, and
 * is announced on opening. It has no address of its own — a saved build is
 * something you reach for from where you are (Commander request 2026-09-04).
 *
 * Every destructive action on this screen is confirmed, names the exact record
 * it will remove, and removes only that one key. Nothing here deletes anything
 * to make room (FR-009, FR-013).
 */
@Component({
  selector: 'ednb-build-library-page',
  imports: [
    ActionButton,
    ConfirmDialog,
    Layer,
    RecordManager,
    ResponsiveRecordList,
    StatusNotice,
    OwnedShipsPanel,
    SynchronisationPanel,
    TabGroup,
    TextField,
  ],
  templateUrl: './build-library.page.html',
  styleUrl: './build-library.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BuildLibraryPage {
  readonly #library = inject(BuildLibraryStore);
  readonly #open = inject(RecordOpenService);
  readonly #openLoadout = inject(LoadoutOpenService);
  readonly #invalidation = inject(RecordInvalidationService);
  readonly #records = inject(LocalRecordRepository);
  readonly #retention = inject(RetentionService);
  readonly #clock = inject(ClockAdapter);
  readonly #announcements = inject(AnnouncementService);
  readonly #active = inject(ActiveBuildStore);
  readonly #loadout = inject(LoadoutStore);
  readonly #bench = inject(EmptyBenchService);
  readonly #ownership = inject(TabOwnershipCoordinator);
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #gameText = inject(GameTextPresenter);
  readonly #router = inject(Router);
  readonly #presence = inject(LibraryPresence);
  readonly #sync = inject(RecordSynchronisationStore);
  readonly #synchronisation = inject(RecordSynchronisationCoordinator);
  readonly #syncPresenter = inject(SynchronisationPresenter);
  readonly #fleetPresenter = inject(FleetPresenter);
  readonly #fleetCopy = inject(FleetCopyService);

  /**
   * Conflicts the Commander has waved away for this visit.
   *
   * Dismissing the question is not one of the three answers. The conflict
   * stands, both versions stay exactly as they are, and the account's own state
   * still says how many records are waiting — what is set aside is the layer,
   * not the decision (020/FR-009, 020/FR-010).
   */
  readonly #setAside = signal<readonly string[]>([]);

  /**
   * What this browser can say about the account's copy of these records.
   *
   * The library is one of the moments the design synchronises at, so the
   * exchange is asked for when the layer is raised and what it answers is
   * stated here (020/FR-011, design decision 6).
   */
  readonly syncView = computed(() => {
    const view = this.#syncPresenter.view();
    const conflict = view.conflict;
    return conflict !== null && this.#setAside().includes(conflict.recordId)
      ? { ...view, conflict: null }
      : view;
  });

  /**
   * What a journal import stored, when one opened this layer.
   *
   * `null` at every other moment. The sentence belongs to the import that made
   * these records, and this is the surface a Commander reads it on because it
   * is the surface they were taken to (016/FR-010, 016/FR-017). It arrives with
   * the raise rather than being fetched from the feature that composed it, so
   * one list can carry either tool's import without knowing about either.
   */
  readonly importNotice = this.#presence.notice;

  readonly emptyTitle = this.#messages.messageSignal('library.empty.title');
  readonly emptyDescription = this.#messages.messageSignal('library.empty.description');
  readonly unavailableLabel = this.#messages.messageSignal('library.unavailable.label');
  readonly listLabel = this.#messages.messageSignal('library.title');
  readonly dismissLabel = this.#messages.messageSignal('action.close');
  readonly deleteConfirmLabel = this.#messages.messageSignal('library.delete.confirm');
  readonly deleteCancelLabel = this.#messages.messageSignal('library.delete.cancel');
  readonly searchLabel = this.#messages.messageSignal('library.search.label');
  readonly nothingChosen = this.#messages.messageSignal('library.chosen.none');
  readonly viewsLabel = this.#messages.messageSignal('library.view.label');

  /**
   * Which of the layer's two views is showing.
   *
   * The stored builds are what this layer has always been, so they are what it
   * opens on. The fleet is the other thing a Commander keeps ships in, and it
   * is reached from here rather than from an address of its own: the layer has
   * none, and the ships behind it are one account's, so an address would resolve
   * to a different fleet for every Commander who opened it (design decision 10).
   */
  readonly #shownView = signal<'records' | 'ships'>('records');
  readonly shownView = this.#shownView.asReadonly();

  readonly views = computed<readonly TabItem[]>(() => [
    { id: 'records', label: this.#messages.message('library.title') },
    { id: 'ships', label: this.#messages.message('fleet.title') },
  ]);

  /** The chosen view said in words, so the choice is not a tint alone. */
  readonly viewChosenLabel = computed(
    () => this.views().find((view) => view.id === this.shownView())?.label ?? '',
  );

  /** Everything the owned-ships view draws. */
  readonly fleetView = this.#fleetPresenter.view;

  readonly isEmpty = this.#library.isEmpty;
  readonly status = this.#library.status;

  readonly #search = signal('');
  readonly #chosen = signal<string | null>(null);
  readonly #pendingDelete = signal<PendingDelete | null>(null);
  readonly #failure = signal<string | null>(null);

  readonly search = this.#search.asReadonly();
  readonly pendingDelete = this.#pendingDelete.asReadonly();
  readonly failure = this.#failure.asReadonly();

  /**
   * The count the header carries: how many are shown, and of how many.
   *
   * The reference draws it beside the search field, so it is the one number
   * that answers "did my search find anything" without a reader having to
   * count rows (canvas 1a, "Header row").
   */
  readonly countText = computed(() => {
    const total = this.#library.total();
    const shown = this.matchCount();
    return shown === total
      ? this.#messages.message('library.count', { count: this.#formatters.integer(total) })
      : this.#messages.message('library.count.matching', {
          count: this.#formatters.integer(shown),
          total: this.#formatters.integer(total),
        });
  });

  /** The reference's column headers, drawn once over the body. */
  readonly columns = computed<RecordColumns>(() => ({
    build: this.#messages.message('library.column.build'),
    hull: this.#messages.message('library.column.hull'),
    modified: this.#messages.message('library.column.modified'),
  }));

  /**
   * How many records the current search leaves listed.
   *
   * Records this version cannot open count too. They are listed, they occupy a
   * row, and a header that said "3 of 4" while four rows were on screen would be
   * counting something a Commander cannot see (FR-010).
   */
  readonly matchCount = computed(() => this.builds().length + this.unavailable().length);

  /** True when there are records but the search matches none of them. */
  readonly noMatch = computed(
    () => !this.#library.isEmpty() && this.matchCount() === 0 && this.#query().length > 0,
  );

  readonly noMatchText = computed(() =>
    this.#messages.message('library.no-match', { query: this.#search().trim() }),
  );

  /** The record the footer's actions act on, when one has been chosen. */
  readonly chosen = computed(() => {
    const chosen = this.#chosen() ?? this.#currentRecordId();
    return chosen !== null && this.#library.find(chosen) !== null ? chosen : null;
  });

  /**
   * What the footer commits on the record that was chosen.
   *
   * The canvas's two, and nothing else. Naming, renaming and saving a copy were
   * here until 2026-08-27 and are the workspace's own `SAVE` now: a library
   * answers "which of these builds", and what should become of one is asked
   * where a Commander is working in it. Nothing they could do is gone — a
   * record is renamed by opening it and saving it over the save it came from,
   * and copied by opening it and saving it as a new build (FR-009).
   *
   * Each is named for what it does and not for the build it does it to, as the
   * canvas draws them: `DELETE` and `OPEN IN OUTFITTING`. The build is the row
   * the Commander pressed, which is the pressed row in the list above and is
   * where they are looking; repeating its name into the buttons made the same
   * word the longest thing on the plate and moved it whenever the choice moved.
   */
  readonly chosenActions = computed<readonly RecordAction[]>(() => {
    if (this.chosen() === null) {
      return [];
    }

    return [
      {
        id: 'delete',
        label: this.#messages.message('library.action.delete'),
        emphasis: 'danger' as const,
      },
      {
        id: 'open',
        label: this.#messages.message('library.action.open'),
        emphasis: 'primary' as const,
      },
    ];
  });

  readonly storageNotice = computed(() =>
    this.#library.status() === 'unavailable'
      ? this.#messages.message('persistence.unavailable')
      : null,
  );

  /**
   * Every readable record the search leaves listed, newest first.
   *
   * One list. `Unnamed builds` and `Named builds` were two headings saying what
   * each row beneath them already says in its own title, and they split one
   * order into two — so the build edited most recently was not reliably the row
   * at the top (FR-010, clarification 2026-08-27).
   */
  readonly builds = computed<readonly SavedBuild[]>(() => this.#listed(this.#library.records()));

  readonly unavailable = computed<readonly UnavailableRecord[]>(() => {
    const query = this.#query();
    return (
      this.#library
        .unavailable()
        .map((entry) => {
          if (entry.available) {
            return { id: 'unknown', explanation: '', detail: null };
          }
          return {
            id: entry.id,
            explanation: this.#messages.message(
              entry.reason === 'unsupported-version'
                ? 'library.unavailable.unsupported'
                : 'library.unavailable.malformed',
            ),
            detail: entry.name ?? entry.hullSymbol,
          };
        })
        // Narrowed over what its own row shows, the same as every other row: a
        // record that cannot be opened is still a record a Commander is looking
        // for by name or by hull.
        .filter((entry) => query.length === 0 || this.#contains(entry.detail, query))
    );
  });

  readonly deleteTitle = computed(() => {
    const pending = this.#pendingDelete();
    if (pending === null) {
      return '';
    }
    return this.#messages.message(
      pending.unnamed ? 'library.discard.title' : 'library.delete.title',
      { name: pending.title },
    );
  });

  readonly deleteDescription = computed(() => {
    const pending = this.#pendingDelete();
    if (pending === null) {
      return null;
    }
    return this.#messages.message(
      pending.unnamed ? 'library.discard.description' : 'library.delete.description',
      { hull: pending.hull },
    );
  });

  readonly manageableRecords = computed<readonly ManageableRecord[]>(() =>
    this.#library
      .working()
      .map((entry) =>
        entry.available
          ? {
              id: entry.record.id,
              label: entry.record.name ?? this.#messages.message('library.record.unnamed'),
              detail: `${this.#subjectName(entry.record)} · ${this.#instant(entry.record.modifiedAt)}`,
            }
          : null,
      )
      .filter(present),
  );

  /**
   * Why the Commander is being offered the list to choose from.
   *
   * Only ever a full browser store. The count limit that also raised this was
   * withdrawn on 2026-08-25, and expiry never raises it: expiry is not a way out
   * of a full quota, and offering it as one would suggest the application had
   * removed something to make room (FR-013).
   *
   * Asked of both tools, because either can be the one that could not write and
   * either can be the screen this layer was raised from. The words name the
   * work the Commander was doing when the store refused it; a store full for
   * both is stated in the ship tool's, which is what the list opens on
   * (017/FR-008).
   */
  readonly manageReason = computed(() => {
    if (this.#active.persistence() === 'quota-full') {
      return this.#messages.message('persistence.quota-full');
    }
    return this.#loadout.persistence() === 'quota-full'
      ? this.#messages.message('persistence.loadout.quota-full')
      : null;
  });

  readonly #selectedForDiscard = signal<readonly string[]>([]);
  readonly selectedForDiscard = this.#selectedForDiscard.asReadonly();

  constructor() {
    // The count left the command bar on 2026-08-25: the reference draws it in
    // this surface's own header row, beside the search that changes it, and one
    // number in two places is one number that can disagree with itself (T158).
    //
    // The narrowed count is the one thing that changes without a Commander
    // looking at it, so it is the one thing announced — politely, each time
    // their search moves it in either direction, and never on the first run,
    // where it is initial content already in reading order (011/FR-009).
    //
    // The count is the effect's only dependency, and announcing is read in
    // `untracked` because resolving a message reads the catalogue. Tracked, a
    // committed locale would republish a narrowing that already happened.
    let opened = false;
    effect(() => {
      const shown = this.matchCount();
      if (!opened) {
        opened = true;
        return;
      }
      untracked(() =>
        this.#announcements.announce({
          kind: 'library.match-count',
          urgency: 'polite',
          messageKey: 'library.count.matching',
          params: {
            count: this.#formatters.integer(shown),
            total: this.#formatters.integer(this.#library.total()),
          },
        }),
      );
    });

    // Any change made by another page invalidates the listing, and the answer
    // is always to re-read storage rather than to patch what is on screen.
    inject(DestroyRef).onDestroy(this.#library.follow());

    effect(() => {
      this.#invalidation.revision();
      this.#library.refresh();
    });

    // A record library opening is one of the moments the account exchanges at.
    // It does nothing at all while the browser is anonymous, and it never makes
    // the list wait on a network (020/FR-011, design decision 6).
    void this.#synchronisation.refresh();
  }

  /** An explicit retry of an exchange that did not leave this browser current. */
  retrySynchronisation(): void {
    void this.#synchronisation.refresh();
  }

  /** The Commander's answer to the conflict the panel is asking about. */
  answerConflict(choice: ConflictChoice): void {
    const conflict = this.syncView().conflict;
    if (conflict !== null) {
      void this.#synchronisation.resolve(conflict.recordId, choice);
    }
  }

  /**
   * Leaves the conflict standing.
   *
   * Dismissal is not one of the three answers. Both versions stay exactly as
   * they are and the question is asked again the next time the library is
   * opened (020/FR-009, 020/FR-010).
   */
  dismissConflict(): void {
    const conflict = this.syncView().conflict;
    if (conflict !== null) {
      this.#setAside.update((standing) => [...standing, conflict.recordId]);
    }
  }

  /**
   * Dismisses the library, returning to the screen it was opened over.
   *
   * The canvas draws this surface as a layer over an inert originating screen,
   * and a layer that is dismissed puts a Commander back where they were. It
   * used to send everyone to the shipyard, which took a Commander who glanced
   * at their saved builds out of the build they were working in — a screen they
   * had chosen nothing to leave (Commander request 2026-08-27).
   *
   * The browser's own back does this already; this is the same journey under
   * the dismiss the canvas draws.
   */
  close(): void {
    this.#presence.lower();
  }

  /** Narrows the list. Changes no record, no order and nothing stored. */
  changeSearch(query: string): void {
    this.#search.set(query);
  }

  /** Chooses the row the footer's actions act on. */
  chooseRecord(recordId: string): void {
    this.#chosen.set(recordId);
    this.#failure.set(null);
  }

  /** Commits one footer action on the record that was chosen. */
  commit(actionId: string): void {
    const recordId = this.chosen();
    if (recordId === null) {
      return;
    }
    void this.selectAction({ recordId, actionId });
  }

  async selectAction({
    recordId,
    actionId,
  }: {
    recordId: string;
    actionId: string;
  }): Promise<void> {
    this.#failure.set(null);
    const record = this.#library.find(recordId);

    switch (actionId) {
      case 'open': {
        // One list, two tools. Which one opens the row is the record's own
        // claim, so a loadout is never handed to the ship tool's open path
        // (013 contracts/loadout-persistence.md).
        if (record !== null && !isShipRecord(record)) {
          const opened = this.#openLoadout.open(recordId);
          if (!opened.ok) {
            this.#failure.set(
              this.#messages.message('library.open.failed', { reason: opened.reason }),
            );
            return;
          }
          void this.#leaveThrough(NAVIGATION_ROUTES.equipment);
          return;
        }

        const result = await this.#open.open(recordId);
        if (result.kind === 'failed') {
          this.#failure.set(
            this.#messages.message('library.open.failed', { reason: result.reason }),
          );
          return;
        }
        if (result.kind === 'committed') {
          void this.#leaveThrough(NAVIGATION_ROUTES.outfitting);
        }
        return;
      }

      case 'delete': {
        if (record === null) {
          return;
        }
        this.#pendingDelete.set({
          recordId,
          title: record.name ?? this.#messages.message('library.record.unnamed'),
          hull: this.#subjectName(record),
          unnamed: record.kind === 'working',
        });
        return;
      }

      default:
        return;
    }
  }

  confirmDelete(): void {
    const pending = this.#pendingDelete();
    if (pending === null) {
      return;
    }

    const removed = this.#records.remove(pending.recordId);
    this.#pendingDelete.set(null);

    if (!removed.ok) {
      this.#failure.set(this.#messages.message('persistence.write-failed'));
      return;
    }

    // If that was the record this page is autosaving into, the tool it belongs
    // to goes back to holding nothing. The library stays open on the rest of
    // the list: the current-record marker simply has nowhere to sit (001/FR-009,
    // 017/FR-008).
    this.#letGoOf(pending.recordId);

    // A deletion the Commander confirmed is a deletion of the account's copy
    // too. Nothing is queued while the browser is anonymous, and the local
    // removal has already happened (020/FR-010, 020/FR-011).
    void this.#sync.recordDeleted(pending.recordId);

    this.#invalidation.announceDelete(pending.recordId);
    this.#library.refresh();
  }

  cancelDelete(): void {
    this.#pendingDelete.set(null);
  }

  changeDiscardSelection(ids: readonly string[]): void {
    this.#selectedForDiscard.set(ids);
  }

  /** Removes exactly the records the Commander selected, and nothing else. */
  discardSelected(ids: readonly string[]): void {
    for (const id of ids) {
      const removed = this.#records.remove(id);
      if (removed.ok) {
        // Selected deliberately, one by one, so the same rule applies as to a
        // single confirmed deletion.
        this.#letGoOf(id);
        void this.#sync.recordDeleted(id);
        this.#invalidation.announceDelete(id);
      }
    }
    this.#selectedForDiscard.set([]);
    this.#library.refresh();
  }

  /**
   * Has whichever tool was autosaving into a deleted record let go of it.
   *
   * The library stands over either screen, so the record a Commander deletes
   * here can be the build's or the loadout's. A tool told nothing would write
   * the record back on its next edit, which undoes a deletion they confirmed
   * (001/FR-009, 017/FR-008) — and this tab's claim on it would outlive the
   * record itself (017/FR-010).
   */
  #letGoOf(recordId: string): void {
    if (this.#active.clearIfHolding(recordId)) {
      this.#ownership.release('ship');
    }
    this.#bench.clearHolding(recordId);
  }

  #toSavedBuild(entry: StoredRecordEntry): SavedBuild | null {
    if (!entry.available) {
      return null;
    }
    const record = entry.record;
    const title = record.name ?? this.#derivedTitle(record);

    return {
      id: record.id,
      title,
      named: record.name !== null,
      toolLabel: this.#messages.message(isShipRecord(record) ? 'tools.ship' : 'tools.equipment'),
      subject: isShipRecord(record)
        ? this.#gameText.shipName(record.hullSymbol)
        : this.#gameText.suitName(record.suitFamily),
      modified: this.#howLongAgo(record.modifiedAt),
      modifiedExact: this.#messages.message('library.record.modified.exact', {
        instant: this.#instant(record.modifiedAt),
      }),
      // A loadout records no verdict of its own: it is a set of chosen
      // identities, and the equipment library publishes no validity for one.
      validation: isShipRecord(record) ? this.#validationOf(record.validation) : null,
      issues: isShipRecord(record) ? this.#issuesOf(record.validation) : null,
      remaining: this.#remainingLife(record),
      current: record.id === this.#currentRecordId(),
      currentLabel: this.#messages.message('library.record.current'),
      note: this.#noteFor(record),
    };
  }

  /**
   * What the workspace is holding, as a record identity.
   *
   * Its own unnamed record where it has forked one; the named record it was
   * opened from where it has not. Both are "the build I am in", which is the
   * first question a Commander opening this list has (FR-010).
   */
  #currentRecordId(): string | null {
    return this.#active.autosaveRecordId() ?? this.#active.sourceNamed()?.recordId ?? null;
  }

  /**
   * A title for a record nobody has named.
   *
   * The build's own ship name, else its ident, else the hull — read from the
   * build each time the row is drawn and never written onto the record, so it
   * follows the build rather than becoming a stale name of its own. Set apart
   * from a Commander's name by the row rather than passed off as one (FR-010,
   * clarification 2026-08-25).
   */
  #derivedTitle(record: LocalRecord): string {
    return isShipRecord(record)
      ? deriveBuildTitle(
          record.build,
          this.#hullName(record.hullSymbol),
          this.#messages.message('library.record.unnamed'),
        )
      : // A loadout has no name of its own to fall back to — no ship name, no
        // ident — so the suit it is built on is what the row is called.
        this.#subjectName(record);
  }

  /** The hull for a ship build, the suit for a loadout, in the reading language. */
  #subjectName(record: LocalRecord): string {
    return isShipRecord(record)
      ? this.#hullName(record.hullSymbol)
      : (this.#gameText.suitName(record.suitFamily).text ?? record.suitFamily);
  }

  /**
   * How long this record has left, in the reader's own words.
   *
   * Only an unnamed one has a deadline, and stating it on the row is the whole
   * of the notice: nothing announces the removal afterwards, because a message
   * about a build already gone offers nothing to act on (FR-010, FR-013).
   */
  #remainingLife(record: LocalRecord): string | null {
    const deadline = this.#retention.expiresAt(record);
    return deadline === null
      ? null
      : this.#messages.message('library.record.expires', {
          when: this.#formatters.relativeTime(deadline, this.#clock.now()),
        });
  }

  /**
   * The issue count the reference draws on its warm plate, with its own words.
   *
   * A count, not a colour, and never a count of nothing: a valid and complete
   * build carries no badge at all (FR-010).
   */
  #issuesOf(validation: { valid: boolean; complete: boolean }): SavedBuild['issues'] {
    const issues = (validation.valid ? 0 : 1) + (validation.complete ? 0 : 1);
    if (issues === 0) {
      return null;
    }
    const count = this.#formatters.integer(issues);
    return { count, label: this.#messages.message('library.record.issues', { count }) };
  }

  /** The rows the library draws, narrowed by whatever is being searched for. */
  #listed(entries: readonly StoredRecordEntry[]): readonly SavedBuild[] {
    const query = this.#query();
    return entries
      .map((entry) => this.#toSavedBuild(entry))
      .filter(present)
      .filter((build) => query.length === 0 || this.#matches(build, query));
  }

  /** The search text, normalized once so every row is compared the same way. */
  #query(): string {
    return this.#search().trim().toLocaleLowerCase(this.#formatters.locale);
  }

  /**
   * Whether a row matches what is being searched for.
   *
   * Over the fields the row itself shows — its title, its one line of note and
   * its hull — because a search that matched something invisible would be a
   * list a Commander could not explain (build-library design, "Searched").
   */
  #matches(build: SavedBuild, query: string): boolean {
    return [build.title, build.note, build.subject.text].some((part) =>
      this.#contains(part ?? null, query),
    );
  }

  /** Whether one field a row shows contains what is being searched for. */
  #contains(value: string | null, query: string): boolean {
    return value !== null && value.toLocaleLowerCase(this.#formatters.locale).includes(query);
  }

  /**
   * The line beneath a row's name.
   *
   * A Commander's own note where they wrote one. Failing that, and only for an
   * unnamed record forked from a save, the save it came from: "unsaved edits to
   * X" is what that record is, and a row that did not say so would look like a
   * second copy of X (FR-010, T155).
   */
  #noteFor(record: LocalRecord): string | null {
    if (record.note !== null) {
      return record.note;
    }
    if (record.kind !== 'working' || record.sourceNamed === null) {
      return null;
    }

    const source = this.#records.read(record.sourceNamed.recordId);
    const name = source.ok && source.value.available ? source.value.record.name : null;
    return name === null ? null : this.#messages.message('library.record.forked-from', { name });
  }

  #validationOf(validation: { valid: boolean; complete: boolean }): SavedBuild['validation'] {
    if (!validation.valid) {
      return { label: this.#messages.message('library.record.invalid'), tone: 'error' };
    }
    if (!validation.complete) {
      return { label: this.#messages.message('library.record.incomplete'), tone: 'warning' };
    }
    return { label: this.#messages.message('library.record.valid'), tone: 'success' };
  }

  #instant(iso: string): string {
    return this.#formatters.dateTime(new Date(iso));
  }

  /**
   * How long ago the record was last edited, in the reader's own words.
   *
   * What the column is read for. `19 Aug 2026, 14:32` makes a reader do the
   * arithmetic on every row to find the build they were last in; `3 weeks ago`
   * is the answer, and the canvas draws exactly that (FR-010, clarification
   * 2026-08-27). The instant itself is kept beside it, unread by the eye and
   * available to a reader who needs it exactly.
   */
  #howLongAgo(iso: string): string {
    return this.#formatters.relativeTime(new Date(iso), this.#clock.now());
  }

  #hullName(symbol: string): string {
    return this.#gameText.shipName(symbol).text ?? symbol;
  }

  /** Shows the stored builds, or the ships the Commander owns. */
  chooseView(id: string): void {
    this.#failure.set(null);
    this.#shownView.set(id === 'ships' ? 'ships' : 'records');
  }

  /** Chooses the owned ship the facts and the copy action are about. */
  chooseShip(shipId: string): void {
    const parsed = Number(shipId);
    if (!Number.isInteger(parsed)) {
      return;
    }
    this.#fleetPresenter.choose(parsed);
  }

  /** Asks the account's fleet service to read more journal. */
  refreshFleet(): void {
    void this.#fleetPresenter.refresh();
  }

  /** Opens the account panel, which is where a sign-in is asked for. */
  signInForFleet(): void {
    this.#fleetPresenter.signIn();
  }

  /**
   * Takes a copy of the chosen owned ship into the builder.
   *
   * A copy, with a record identity of its own. The owned ship is read-only and
   * nothing here writes to it: what the builder receives is a separate build a
   * Commander may rename, edit and delete with the fleet entry untouched
   * (020/FR-017).
   */
  async copyOwnedShip(): Promise<void> {
    this.#failure.set(null);
    const ship = this.#fleetPresenter.chosen();
    if (ship === null) {
      return;
    }

    const result = await this.#fleetCopy.copy(ship);
    if (result.kind === 'failed') {
      this.#failure.set(this.#messages.message('library.open.failed', { reason: result.reason }));
      return;
    }
    if (result.kind === 'committed') {
      await this.#leaveThrough(NAVIGATION_ROUTES.outfitting);
    }
  }

  /**
   * Leaves through the layer rather than closing it.
   *
   * The navigation runs first and the layer comes down when it lands. Closing
   * first uncovers a screen that is still live under the Commander's pointer,
   * and the shipyard writes its own address whenever a pointer rests on a hull
   * row — exactly where the press that opened the record left it. Uncovered a
   * frame early, that write lands after this navigation and strands the
   * Commander on `/ships/<hull>` with the build never opened, which is what
   * turned CI red on firefox (2026-09-04).
   *
   * The layer is `inert` while it stands, so nothing underneath can answer a
   * pointer until the navigation it is waiting for has already happened.
   */
  async #leaveThrough(target: string): Promise<void> {
    await this.#router.navigateByUrl(target);
    this.#presence.lowerForNavigation();
  }
}

/** Narrows away the entries a listing could not present. */
function present<T>(value: T | null): value is T {
  return value !== null;
}
