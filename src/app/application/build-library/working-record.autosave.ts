import { Injector, computed, effect, signal } from '@angular/core';
import { RecordSynchronisationStore } from '../synchronisation/record-synchronisation.store';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { PageLifecycleAdapter } from '../../platform/browser/page-lifecycle.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import type { WorkingRecordSubject } from './working-record.port';

/**
 * How long edits are gathered before one write.
 *
 * Long enough that a burst of edits is one `setItem` rather than twenty, short
 * enough that a Commander who closes the tab a moment after an edit still has
 * it. The lifecycle flush covers the rest.
 */
const COALESCE_MS = 400;

/**
 * Keeping one tool's open work recoverable.
 *
 * Autosave writes to exactly one key — an unnamed record this page minted or
 * took over — and never to a named save. Naming what is open is a decision;
 * autosaving over something a Commander deliberately saved would take that
 * decision away from them, silently, which is the loss the withdrawn
 * replacement question existed to prevent (persistence contract, "Autosaved
 * records"; 001/FR-008, 017/FR-007, ruled 2026-08-25).
 *
 * Two rules follow from that and are enforced here rather than assumed. Nothing
 * is written while the subject is clean, so taking a record over does not
 * rewrite it and does not restart the seven days it is counting down. And a
 * record whose stored `kind` is `named` is refused as a target whatever this
 * page believes it is holding — a record named in another tab, or written
 * before this rule existed, cannot be reached by a coalesced edit.
 *
 * Nothing refuses a write because many records already exist. The count limit
 * that once did was replaced on 2026-08-25 by the seven-day expiry of unnamed
 * records, which removes what nobody came back to rather than refusing what a
 * Commander is working on now (001/FR-013).
 *
 * Every failure state here is a persistence state, never a state of the work: a
 * blocked store, a full one or a failed write changes what the status says and
 * changes nothing about whether the build or the loadout can be edited
 * (001/FR-014, 017/FR-008).
 *
 * One class, one subject. Each tool provides its own instance, because a page
 * holds a build and a loadout at once and neither may be written into the
 * other's record.
 */
export class WorkingRecordAutosave {
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** The record a pause is about, and whether one stands. */
  readonly #pausedOn = signal<string | null>(null);

  /**
   * Paused after the record this tab owns is discarded somewhere else.
   *
   * A pause is about one record. Once this tool holds a different one — a
   * record opened from the saved list, a loadout arriving in a link, or none at
   * all after the record was discarded here — writing recreates nothing that
   * anybody discarded, so the pause lifts on its own. Read as a computed rather
   * than kept as a flag, because a flag left standing stops every later save in
   * silence.
   */
  readonly paused = computed(() => {
    const held = this.#subject.autosaveRecordId();
    const on = this.#pausedOn();
    if (on !== null && on === held) {
      return true;
    }
    // The same pause, reached from the account rather than from another tab: a
    // synchronised device deleted the record this page holds, so the work stays
    // and nothing is written to it until the Commander answers (020/FR-010).
    return held !== null && this.#sync.pausedRecords().includes(held);
  });

  readonly #subject: WorkingRecordSubject;
  readonly #records: LocalRecordRepository;
  readonly #lifecycle: PageLifecycleAdapter;
  readonly #uuid: UuidAdapter;
  readonly #clock: ClockAdapter;
  readonly #sync: RecordSynchronisationStore;
  /** Captured at construction so `start()` can create its watcher from anywhere. */
  readonly #injector: Injector;

  protected constructor(
    subject: WorkingRecordSubject,
    records: LocalRecordRepository,
    lifecycle: PageLifecycleAdapter,
    uuid: UuidAdapter,
    clock: ClockAdapter,
    sync: RecordSynchronisationStore,
    injector: Injector,
  ) {
    this.#subject = subject;
    this.#records = records;
    this.#lifecycle = lifecycle;
    this.#uuid = uuid;
    this.#clock = clock;
    this.#sync = sync;
    this.#injector = injector;
  }

  /** Which tool's work this keeps. Read by whoever asks about a record. */
  get tool(): WorkingRecordSubject['tool'] {
    return this.#subject.tool;
  }

  /**
   * Starts saving this tab's work.
   *
   * Returns an unsubscribe, because the lifecycle listener outlives any one
   * screen and a second registration would flush twice.
   */
  start(): () => void {
    const stopLifecycle = this.#lifecycle.onFlush(() => this.flush());

    const watcher = effect(
      () => {
        // Reading the fingerprint is what subscribes: it is derived from the
        // revision and from the work itself, which is edited in place, so the
        // object reference alone would never change.
        this.#subject.revision();
        this.#subject.fingerprint();
        this.#schedule();
      },
      { injector: this.#injector },
    );

    // A pause that arrives from the account rather than from another tab is
    // still a pause this page has to state: the work is usable, nothing is
    // being written to it, and the Commander resumes it deliberately
    // (020/FR-010).
    const remotePause = effect(
      () => {
        const held = this.#subject.autosaveRecordId();
        if (held !== null && this.#sync.pausedRecords().includes(held)) {
          this.#clearTimer();
          this.#subject.setPersistence('record-deleted-externally');
        }
      },
      { injector: this.#injector },
    );

    return () => {
      stopLifecycle();
      watcher.destroy();
      remotePause.destroy();
      this.#clearTimer();
    };
  }

  /**
   * Pauses saving because the record was discarded elsewhere.
   *
   * Deliberately requires an explicit resume. A Commander who discarded work in
   * another tab meant it; recreating it here behind their back would undo a
   * decision they made on purpose.
   */
  pauseAfterExternalDelete(): void {
    this.#pausedOn.set(this.#subject.autosaveRecordId());
    this.#clearTimer();
    this.#subject.setPersistence('record-deleted-externally');
  }

  /**
   * Resumes after an explicit request, writing the current state immediately.
   *
   * The write is not conditional on the work having changed. What was paused is
   * a record another page discarded, and the state on this page matches what
   * that record held — so the ordinary "nothing is owed" rule would answer a
   * Commander's explicit request by writing nothing at all.
   */
  resume(): void {
    this.#pausedOn.set(null);
    const held = this.#subject.autosaveRecordId();
    if (held !== null) {
      // For a remote deletion, resuming is an overwrite: the work goes back
      // under the same application record identity at a revision newer than the
      // marker. The store answers nothing at all while the browser is anonymous
      // or while no conflict stands on this record (020/FR-010).
      void this.#sync.resumeRecord(held);
    }
    this.#writeNow(true);
  }

  /**
   * Writes now, rather than at the end of the coalescing window.
   *
   * Answers whether the work is in a record it can be opened from again. False
   * says the last write did not land: the store refused it, saving is paused,
   * or the record this page holds turned out to be named elsewhere. Whoever is
   * about to let go of the work reads it (017/FR-006).
   */
  flush(): boolean {
    return this.#writeNow(false);
  }

  #writeNow(force: boolean): boolean {
    this.#clearTimer();

    if (this.paused()) {
      return false;
    }

    const payload = this.#subject.payload();
    if (payload === null) {
      // No work, so nothing to keep and nothing owed on it.
      return true;
    }

    // Nothing is owed while the work matches what a record already holds. This
    // is what makes opening a record free: taking one over writes nothing, so it
    // does not restart the expiry the entry is counting down (001/FR-013,
    // 017/SC-003).
    if (!force && !this.#subject.dirty()) {
      return true;
    }

    const recordId = this.#allocate();
    if (recordId === null) {
      // Taken over: the record already holds this exact state.
      return true;
    }

    // What the record itself says, read once for the two questions the write
    // asks of it. Both are answered from the stored bytes rather than from this
    // page's belief about them.
    const opened = this.#records.open(recordId);
    const stored = opened.ok ? opened.value : null;

    // A named record is never an autosave target, whatever this page is
    // holding, so a record named in another tab is covered too (001/FR-008,
    // 017/FR-007).
    //
    // Stated rather than refused in silence: the work is in nothing, and a
    // Commander who is not told reads a screen that says it is saved
    // (001/FR-014, 017/FR-008). And let go of, so that the retry the notice
    // offers has somewhere to land: held on to, every later write would read
    // the same named record and fail the same way, and the one control on the
    // notice would do nothing however often it is pressed.
    if (stored?.record.kind === 'named') {
      this.#subject.setAutosaveRecordId(null);
      this.#subject.setPersistence('write-failed');
      return false;
    }

    this.#subject.setPersistence('saving');
    const now = this.#clock.timestamp();
    // A record that already exists keeps the instant it was created, because a
    // later write is not a creation: stamping one with now would have the
    // record state a moment that did not happen (constitution IV). A restored
    // record and a taken-over one both reach this holding an id they did not
    // mint, so both are records this has to be true of.
    //
    // Not what protects the expiry. That is counted from `modifiedAt`, which
    // this same write stamps with now whatever is done here; what keeps a
    // take-over from restarting the seven days is that a clean subject is not
    // written at all, above. What `createdAt` decides is which of several
    // identical unnamed records the take-over rule picks — the oldest.
    //
    // Read from the record on every write rather than remembered, because the
    // record this tool writes to changes under it: a loadout opened from the
    // saved list arrives holding an id of its own, and a remembered instant
    // would be stamped onto a record it does not belong to.
    const createdAt = stored?.record.createdAt ?? now;

    const written = this.#records.write({
      id: recordId,
      kind: 'working',
      revisionId: this.#uuid.create(),
      createdAt,
      modifiedAt: now,
      name: null,
      note: null,
      sourceNamed: this.#subject.sourceNamed(),
      payload,
    });

    if (written.ok) {
      this.#subject.setPersistence('saved');
      // The record is in browser storage, so it may now enter the account's own
      // exchange. Nothing is queued while the browser is anonymous, and nothing
      // about this write waits on the network (020/FR-007, 020/FR-011).
      void this.#sync.recordSaved(recordId);
      return true;
    }

    this.#subject.setPersistence(
      written.code === 'quota'
        ? 'quota-full'
        : written.code === 'blocked'
          ? 'unavailable'
          : 'write-failed',
    );
    return false;
  }

  /**
   * Copies the current state into a freshly forked record.
   *
   * Forced for the same reason `resume` is. A page forks the moment another one
   * claims the record it restored or took over, and a page in that state is
   * clean — so the ordinary "nothing is owed" rule would leave the fresh record
   * empty and this page's claim naming a record that was never written.
   */
  adoptForkedRecord(): void {
    this.#writeNow(true);
  }

  /**
   * The record this write belongs in, minting or taking one over if need be.
   *
   * The take-over is the whole of the reuse rule (clarification 2026-08-25): a
   * build identical to an unnamed record already stored is that record, not a
   * second copy of it. Creating the same stock hull twice, or opening one link
   * twice, therefore leaves one entry rather than two — and because the record
   * already holds this exact state, the take-over marks the work saved instead
   * of writing, so it does not touch `modifiedAt` and does not restart the
   * seven days.
   *
   * A record of the other tool is never a match. The fingerprint is a build's
   * or a loadout's, and the two hold different content.
   */
  #allocate(): string | null {
    const held = this.#subject.autosaveRecordId();
    if (held !== null) {
      return held;
    }

    const fingerprint = this.#subject.fingerprint();
    const identical =
      fingerprint === null ? null : this.#records.findUnnamedMatching(fingerprint, this.tool);
    if (identical !== null) {
      this.#subject.setAutosaveRecordId(identical);
      this.#subject.markSaved(null);
      this.#subject.setPersistence('saved');
      return null;
    }

    const minted = this.#uuid.create();
    this.#subject.setAutosaveRecordId(minted);
    return minted;
  }

  #schedule(): void {
    if (this.paused() || this.#subject.fingerprint() === null) {
      return;
    }
    this.#clearTimer();
    this.#timer = setTimeout(() => this.flush(), COALESCE_MS);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
