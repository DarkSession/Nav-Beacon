import { Injectable, inject } from '@angular/core';
import { recordBinding, remoteRevisionOf } from '../../domain/commander/commander-local-state';
import type { LocalRecord } from '../../domain/records/local-record';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { TabOwnershipCoordinator } from './tab-ownership.coordinator';

/**
 * How long an unnamed record is kept.
 *
 * Seven days from the last modelled edit, which is long enough that a Commander
 * who comes back to a build on the following weekend still has it, and short
 * enough that a browser is not carrying a year of abandoned autosaves
 * (clarification 2026-08-25).
 *
 * Naming a record ends this outright. Named saves are deliberate and are
 * bounded by the browser's own quota rather than by a number chosen here.
 */
export const UNNAMED_RECORD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The seven-day expiry of unnamed records, and nothing else.
 *
 * **Replaced the twenty-record limit on 2026-08-25 (Commander request,
 * FR-013).** A count refused to store the twenty-first build; a clock removes
 * the ones nobody came back to. The trade is deliberate and is the one place in
 * this feature where work is removed without a Commander pressing anything, so
 * it is built as narrowly as that deserves:
 *
 *   * the deadline is **derived**, never stored. A written deadline outlives a
 *     clock change and a migration as a stale fact, while `modifiedAt` is
 *     already the instant the row displays;
 *   * the sweep runs at application start and whenever the listing is read, and
 *     is deliberately **not** a timer. A row vanishing under a Commander who is
 *     reading the library is the one removal this design cannot make visible,
 *     and seven days does not need that precision;
 *   * a named record is never touched, and neither is a record a live page is
 *     autosaving into. Both are evaluated at the moment of the sweep;
 *   * nothing is announced when it runs, and the only thing written besides the
 *     removal is what this browser knew about the record's remote copy. The
 *     remaining time each row states beforehand is the whole of the notice
 *     (FR-010).
 *
 * There is no count limit any more. Nothing refuses to store a record because
 * many already exist, and no number evicts anything.
 */
@Injectable({ providedIn: 'root' })
export class RetentionService {
  readonly #records = inject(LocalRecordRepository);
  readonly #state = inject(CommanderStateRepository);
  readonly #clock = inject(ClockAdapter);
  readonly #ownership = inject(TabOwnershipCoordinator);

  /**
   * When this record stops being recoverable, or `null` when it never does.
   *
   * A named record has no deadline. Neither does one whose stored instant
   * cannot be read as a date: a record nobody can date is not a record anyone
   * can prove is old.
   */
  expiresAt(record: LocalRecord): Date | null {
    if (record.kind !== 'working') {
      return null;
    }
    const modified = Date.parse(record.modifiedAt);
    return Number.isFinite(modified) ? new Date(modified + UNNAMED_RECORD_LIFETIME_MS) : null;
  }

  /**
   * How long this record has left, in milliseconds, or `null` for no deadline.
   *
   * Negative once the deadline has passed, which is an ordinary state: the
   * sweep runs at two moments rather than continuously, so a record can outlive
   * its deadline until one of them comes round.
   */
  remaining(record: LocalRecord): number | null {
    const deadline = this.expiresAt(record);
    return deadline === null ? null : deadline.getTime() - this.#clock.now().getTime();
  }

  /** Whether this record's seven days have run out, as of right now. */
  hasExpired(record: LocalRecord): boolean {
    const remaining = this.remaining(record);
    return remaining !== null && remaining <= 0;
  }

  /**
   * Removes every unnamed record nobody is holding whose seven days have run
   * out.
   *
   * One `removeItem` per expired key. A failure on one key stops neither the
   * others nor the listing that provoked the sweep, and leaves no partial
   * record behind — `removeItem` either removed the value or it did not.
   *
   * An unreadable record is never removed here. Its instant cannot be read, so
   * its age is a guess, and a guess is not something to delete a Commander's
   * work on: it stays listed, exactly as it stays listed everywhere else.
   *
   * Nothing is sent. A local sweep removes this browser's copy and never the
   * account's: the service runs the remote period from its own receipt time and
   * expires a remote autosave only after that period and the protection
   * deadline have both passed. A browser whose clock is days fast would
   * otherwise delete, from every one of a Commander's devices, a record none of
   * them had finished with (020/FR-025).
   */
  sweep(): void {
    const listed = this.#records.list();
    if (!listed.ok) {
      return;
    }

    for (const entry of listed.value) {
      if (!entry.available) {
        continue;
      }
      const record = entry.record;
      if (!this.hasExpired(record) || this.#ownership.heldLive(record.id)) {
        continue;
      }
      if (!this.#records.remove(record.id).ok) {
        continue;
      }
      // What this browser knew about the record's remote copy goes with it.
      // Kept, it is a binding naming a record nothing can open, which the
      // synchronisation panel counts and states as a record a Commander could
      // still save or copy (020/FR-024, constitution IV).
      //
      // After the removal, so a refused removal leaves the record and its
      // binding together: an unbound record an anonymous page later edits is
      // nobody's to upload, and it would stop reaching the account it belongs
      // to (020/FR-007).
      //
      // Only where there is something to drop. A browser that has never had an
      // account knows nothing about any record's remote copy, and writing
      // account state for it would put one there on an expiry alone
      // (constitution I).
      const known = this.#state.read();
      if (recordBinding(known, record.id) !== null || remoteRevisionOf(known, record.id) !== null) {
        this.#state.forgetRecord(record.id);
      }
    }
  }
}
