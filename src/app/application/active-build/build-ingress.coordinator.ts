import { Injectable, inject } from '@angular/core';
import { ActiveBuildStore } from './active-build.store';
import type { BuildCandidate } from './active-build.models';
import type { CommitSink } from './commit-sinks.port';

/** What a construction attempt produced. */
export type CandidateOutcome =
  | { readonly ok: true; readonly candidate: BuildCandidate }
  | { readonly ok: false; readonly reason: string };

/** How one commit attempt ended. */
export type CommitResult =
  | { readonly kind: 'committed'; readonly candidate: BuildCandidate }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * The single path by which the active build is replaced.
 *
 * Four things reach it — creating a stock build, opening a record, loading a
 * link, importing a SLEF file — and all four go through the same three steps:
 * construct a detached candidate, let it fail if it is going to, and commit
 * exactly once. One boundary rather than four is the reason no ingress path can
 * half-replace a build (plan, "Complexity Tracking").
 *
 * **Revised 2026-08-25.** This was `BuildIngressCoordinator`, and its fourth step
 * was asking the Commander whether unsaved work could be discarded. Nothing asks
 * now, because there is nothing to lose: a build that carries a decision is in
 * the record autosave keeps it in, so it is on the library's list rather than
 * gone, and a build still at its hull's package default is in no record because
 * selecting the hull reaches it again (024/FR-001, FR-008, FR-009). A question
 * whose only honest answer is
 * "nothing will be lost either way" is a question worth withdrawing.
 *
 * The request token is what makes concurrency safe: a decode that finishes
 * after a newer navigation has started is discarded rather than committed, so
 * a slow paste cannot overwrite the build a Commander opened afterwards.
 */
@Injectable({ providedIn: 'root' })
export class BuildIngressCoordinator {
  readonly #store = inject(ActiveBuildStore);

  #token = 0;
  readonly #sinks: CommitSink[] = [];

  /** Registers something that runs after each successful commit. */
  addSink(sink: CommitSink): () => void {
    this.#sinks.push(sink);
    return () => {
      const index = this.#sinks.indexOf(sink);
      if (index >= 0) {
        this.#sinks.splice(index, 1);
      }
    };
  }

  /**
   * Constructs, validates and commits — in that order, or not at all.
   *
   * `construct` is given the whole job of producing a candidate, including
   * asking the package for it. Nothing it does touches active state; the store
   * is written on exactly one line of this method.
   */
  async commit(
    construct: () => CandidateOutcome | Promise<CandidateOutcome>,
  ): Promise<CommitResult> {
    this.#token += 1;
    const token = this.#token;

    let outcome: CandidateOutcome;
    try {
      outcome = await construct();
    } catch (error) {
      return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }

    if (token !== this.#token) {
      return { kind: 'superseded' };
    }
    if (!outcome.ok) {
      return { kind: 'failed', reason: outcome.reason };
    }

    this.#store.commit(outcome.candidate);
    for (const sink of this.#sinks) {
      sink.onCommitted(outcome.candidate);
    }
    return { kind: 'committed', candidate: outcome.candidate };
  }
}
