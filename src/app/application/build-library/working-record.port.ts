import type { Signal } from '@angular/core';
import type { RecordSource, RecordTool } from '../../domain/records/local-record';
import type { RecordPayload } from '../../domain/records/local-record.serializer';

/**
 * What persistence is currently doing, or currently unable to do.
 *
 * None of these states makes what a Commander has open unusable. That is the
 * point of naming them apart from the work itself: editing, calculating,
 * sharing and exporting all continue while persistence is unavailable, full or
 * failing (001/FR-014, 017/FR-008).
 */
export type PersistenceStatus =
  | 'ready'
  | 'saving'
  | 'saved'
  | 'quota-full'
  | 'unavailable'
  | 'write-failed'
  | 'record-deleted-externally';

/**
 * One tool's open work, as autosave and tab ownership read it.
 *
 * The seam that lets both tools keep their work recoverable through one
 * service. A build and a loadout are different things and are stored
 * differently, and everything around that difference is the same: the record is
 * minted or taken over the same way, a named record is refused the same way, a
 * duplicated tab forks the same way, and the seven-day sweep protects a held
 * record the same way. Two implementations of those rules would be two places
 * for one of them to be fixed (persistence contract, "Autosaved records").
 *
 * A tool implements it on the store that already holds the work, because every
 * field here is something that store is already the authority on.
 */
export interface WorkingRecordSubject {
  /**
   * Which tool's records this writes.
   *
   * The one thing autosave asks that is not a fact about the work itself. A
   * record of the other tool is never a target for one, and never a match for
   * one either.
   */
  readonly tool: RecordTool;

  /**
   * Rises once per change a Commander made.
   *
   * What autosave watches. The work itself is edited in place, so an object
   * reference alone would never change.
   */
  readonly revision: Signal<number>;

  /**
   * A fingerprint of the state a Commander decided, or `null` where the tool
   * holds nothing.
   *
   * Derived only from what is stored, never from a calculated figure: a value
   * the package recomputes after an upgrade is not a change a Commander made.
   */
  readonly fingerprint: Signal<string | null>;

  /** Whether what is open differs from the state it was last stored at. */
  readonly dirty: Signal<boolean>;

  /**
   * Whether the work is still the default the package publishes for it — the
   * hull's default loadout, or the loadout the bench starts for a suit.
   *
   * A fact about the work, answered by the store that holds it. What it means
   * for a record is autosave's to decide: nothing is owed on work a Commander
   * reaches again by selecting the hull or the suit (024/FR-001, 024/FR-002).
   *
   * `false` while the tool holds nothing, because there is no work to be at a
   * default.
   */
  readonly atDefault: Signal<boolean>;

  /** The unnamed record this page writes into, or `null` while it has none. */
  readonly autosaveRecordId: Signal<string | null>;

  /** The named record this work was forked from, or `null`. */
  readonly sourceNamed: Signal<RecordSource | null>;

  /** What to write now, or `null` where the tool holds nothing. */
  payload(): RecordPayload | null;

  setAutosaveRecordId(recordId: string | null): void;

  /**
   * Marks the current state as the stored baseline.
   *
   * Called after a successful named save or open, and after nothing else: a
   * working autosave is not a baseline, because a Commander cannot ask for the
   * previous version of it back.
   */
  markSaved(sourceNamed: RecordSource | null): void;

  setPersistence(status: PersistenceStatus): void;
}
