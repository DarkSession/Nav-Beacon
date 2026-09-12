import { Injectable, signal } from '@angular/core';

/**
 * The records whose autosave is held, answered on the spot.
 *
 * A live page whose record was deleted elsewhere keeps its active work and
 * stops writing to it until the Commander answers the conflict (020/FR-010).
 * The synchronisation store is what decides that, and the store arrives with
 * the session rather than with the first payload
 * (`record-synchronisation.loader.ts`). An autosave asks this question in the
 * middle of deciding whether to write, so it needs an answer now rather than a
 * promise of one — which is why the one synchronous part of the engine's
 * surface is held here, where every caller can read it whether the engine's
 * code has arrived or not.
 *
 * Empty until the engine says otherwise, and that is the right answer for a
 * page holding nothing back: an account that has not stated a deletion conflict
 * is pausing nothing.
 */
@Injectable({ providedIn: 'root' })
export class PausedRecords {
  readonly #paused = signal<readonly string[]>([]);

  /** The records this browser holds open and writes nothing to. */
  readonly records = this.#paused.asReadonly();

  /** Whether one record's autosave is held. */
  holds(recordId: string): boolean {
    return this.#paused().includes(recordId);
  }

  /** Holds one record's autosave, from the deletion conflict a page must answer. */
  hold(recordId: string): void {
    this.#paused.update((paused) => (paused.includes(recordId) ? paused : [...paused, recordId]));
  }

  /** Lets one record's live page write again, once its conflict is answered. */
  release(recordId: string): void {
    this.#paused.update((paused) => paused.filter((entry) => entry !== recordId));
  }

  /** Lets every page write again, for an account that has gone (020/FR-003). */
  releaseAll(): void {
    this.#paused.set([]);
  }
}
