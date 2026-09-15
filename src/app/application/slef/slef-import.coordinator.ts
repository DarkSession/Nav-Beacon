import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import {
  scanJournalFiles,
  type JournalEntry,
  type JournalFile,
} from '../../domain/journal/journal-scan';
import {
  SHIP_JOURNAL_READER,
  type JournalLoadoutFacts,
} from '../../domain/ships/slef/journal-loadouts';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import {
  importJournalEntry,
  importSlef,
  type SlefImportResult,
} from '../../domain/ships/slef/slef-import';
import type {
  SlefImportCandidate,
  SlefRequestToken,
} from '../../domain/ships/slef/slef-import.models';
import type { CandidateOutcome } from '../active-build/build-ingress.coordinator';
import { BuildIngressCoordinator } from '../active-build/build-ingress.coordinator';
import { BuildLibraryStore } from '../build-library/build-library.store';
import { NamedRecordService } from '../build-library/named-record.service';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { SlefStore, type SlefBatchRefusal } from './slef.store';

/**
 * How one submitted draft ended, from the layer's point of view.
 *
 * `cancelled` has had no producer since feature 001 withdrew its replacement
 * question on 2026-08-25: nothing between a valid draft and a committed build
 * asks the Commander anything any more. It is kept as an ending the layer still
 * knows how to render, because abandoning a submission is feature 004's own
 * behaviour to define and this feature does not get to delete it from here.
 */
export type SlefImportSubmission =
  | { readonly kind: 'committed' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'superseded' }
  /**
   * Several builds were stored and none was opened.
   *
   * `refused` is empty on a batch that stored everything the Commander chose,
   * and only then does the library open: a refusal carries the package's own
   * diagnostics, and those are read on the layer that was refused rather than
   * over a list of records.
   */
  | {
      readonly kind: 'stored';
      readonly stored: number;
      readonly refused: readonly SlefBatchRefusal[];
    };

/**
 * The one path from a pasted draft to an active build.
 *
 * Everything up to the handoff happens on a candidate nobody is looking at, and
 * the handoff itself is feature 001's `BuildIngressCoordinator` — the single
 * place in the application where the active build changes. Feature 004 writes
 * no active state, no record, no fragment and no history entry of its own; if
 * it did, there would be two ways to replace a build and one of them would
 * eventually skip the confirmation (import contract, steps 11 and 12).
 *
 * The request token is what makes a slow paste safe. A newer submit, a cancel,
 * a close or a route change issues a new one, and a result carrying an older
 * token is discarded rather than committed.
 */
@Injectable({ providedIn: 'root' })
export class SlefImportCoordinator {
  readonly #store = inject(SlefStore);
  readonly #ingress = inject(BuildIngressCoordinator);
  readonly #gameText = inject(GameTextPresenter);
  readonly #router = inject(Router);
  readonly #named = inject(NamedRecordService);
  readonly #clock = inject(ClockAdapter);
  readonly #injector = inject(Injector);
  /**
   * The library, resolved when there is something to tell it about.
   *
   * Not injected into a field. Constructing the store refreshes the listing,
   * which runs the expiry sweep — and the import layer is mounted in the shell,
   * so a field would run that sweep in the prerenderer, where there is no
   * Commander's library to sweep (`app.config.ts`, the sweep's own initializer;
   * 015/FR-001).
   */
  get #library(): BuildLibraryStore {
    return this.#injector.get(BuildLibraryStore);
  }

  /**
   * Reads the files a Commander chose, and offers what they hold.
   *
   * Nothing is imported here. A scan produces a list and stops: what to do with
   * it is the Commander's next decision, and a file dropped by accident costs
   * them nothing.
   *
   * Answers whether this scan settled, or a newer one replaced it first.
   */
  async scanFiles(files: readonly JournalFile[]): Promise<boolean> {
    const token = this.#store.issueToken();
    this.#store.clearScan();
    this.#store.setScanning(files.length);

    const result = await scanJournalFiles(files, SHIP_JOURNAL_READER);

    // Whether this scan is still the one the Commander is waiting for. It is
    // returned rather than kept here because the caller has something to say
    // about the outcome, and an outcome nobody is waiting for is one a reader
    // must not be told about (011/FR-009).
    if (!this.#store.isCurrent(token)) {
      return false;
    }

    this.#store.setScanning(0);
    if (!result.ok) {
      this.#store.setImportFailure(result.failure);
      return true;
    }
    this.#store.setScan(result.report, result.entries);
    return true;
  }

  /**
   * Takes what the Commander chose, whether they pasted it or scanned for it.
   *
   * A scan puts the decision in the list, so the box is not read while one
   * stands. One chosen build replaces the active build, as a paste does; several
   * are stored and none is opened.
   */
  async submit(): Promise<SlefImportSubmission> {
    if (this.#store.journalEntries().length > 0) {
      return this.#submitSelection();
    }

    const token = this.#store.issueToken();
    const text = this.#store.draft().text;
    this.#store.setImportStatus('inspecting');

    return this.#commit(importSlef(text, token), token);
  }

  async #submitSelection(): Promise<SlefImportSubmission> {
    const chosen = this.#store.selectedEntries();
    if (chosen.length === 0) {
      this.#store.setImportFailure({ kind: 'nothingSelected' });
      return { kind: 'failed' };
    }

    const [only] = chosen;
    if (chosen.length === 1 && only !== undefined) {
      const token = this.#store.issueToken();
      this.#store.setImportStatus('inspecting');
      return this.#commit(importJournalEntry(only.value.entry, token), token);
    }

    return this.#storeSelection(chosen);
  }

  /**
   * Stores every chosen build as a named record, and opens none of them.
   *
   * A refused entry costs only itself: the loop keeps going, the entry is named
   * with the package's own answer beside it, and nothing partial is written for
   * it. The build the Commander was working on is never touched — no candidate
   * reaches feature 001's gate on this path.
   */
  async #storeSelection(
    chosen: readonly JournalEntry<JournalLoadoutFacts>[],
  ): Promise<SlefImportSubmission> {
    const token = this.#store.issueToken();
    this.#store.setImportStatus('inspecting');
    const now = this.#clock.timestamp();

    let stored = 0;
    const refused: SlefBatchRefusal[] = [];

    for (const entry of chosen) {
      const result = importJournalEntry(entry.value.entry, token);
      if (!result.ok) {
        refused.push({ title: this.recordName(entry.value), failure: result.failure });
        continue;
      }

      const saved = await this.#named.createNamed({
        name: this.recordName(entry.value),
        note: null,
        payload: {
          tool: 'ship',
          build: toBuildSnapshotV1(result.candidate.loadout),
          validation: result.candidate.validation,
        },
        now,
      });

      if (saved.kind === 'saved') {
        stored += 1;
      } else {
        refused.push({ title: this.recordName(entry.value), failure: { kind: 'notStored' } });
      }
    }

    // The records exist whatever happened to the layer while they were written.
    // A token issued mid-batch supersedes a *candidate*, which is a build
    // nobody has seen yet; it cannot supersede rows already in storage, and
    // leaving the library unrefreshed would hide records a Commander asked for
    // until something else happened to reload it.
    this.#library.refresh();

    // A clean batch is finished with: the draft goes, the layer closes, and the
    // records are where the Commander goes to choose. A batch carrying a refusal
    // keeps the layer, because the refusal is read here.
    //
    // The outcome is recorded last. Clearing the draft forgets the scan, and the
    // outcome is the one thing about it that outlives the layer.
    if (refused.length === 0 && this.#store.isCurrent(token)) {
      this.#store.clearDraft();
      this.#store.closeLayer();
    } else {
      this.#store.setImportStatus('editing');
    }
    this.#store.setBatchOutcome({ stored, refused });

    return { kind: 'stored', stored, refused };
  }

  /**
   * The name a stored record takes.
   *
   * The build's own ship name, its ident where it has no name, and its hull
   * where it has neither. The first two are the Commander's own words and the
   * third is the package's; none of the three is invented here, and the hull is
   * the one route on which the application supplies a record name at all
   * (`ship-builder/build-lifecycle`, "Naming, saving and removing a record").
   */
  recordName(facts: JournalLoadoutFacts): string {
    const hull = this.#gameText.shipName(facts.hullSymbol);
    return facts.shipName ?? facts.ident ?? hull.text ?? facts.hullSymbol;
  }

  async #commit(result: SlefImportResult, token: SlefRequestToken): Promise<SlefImportSubmission> {
    if (!this.#store.isCurrent(token)) {
      return this.#settle('superseded');
    }

    if (!result.ok) {
      this.#store.setImportFailure(result.failure);
      return { kind: 'failed' };
    }

    this.#store.setImportStatus('awaitingReplacement');

    const ingress = await this.#ingress.commit((): CandidateOutcome =>
      this.#store.isCurrent(token)
        ? { ok: true, candidate: this.#candidate(result.candidate) }
        : { ok: false, reason: SUPERSEDED },
    );

    // Feature 001's answer is the last word. The token guards the handoff, not
    // what follows it: once feature 001 has committed, a token issued during the
    // handoff cannot un-commit the build, and reporting anything but `committed`
    // would describe an active build as one that never arrived. The dangerous
    // case — a slow paste landing on a build opened afterwards — is a newer
    // ingress, which feature 001's own token supersedes before it commits.
    //
    // Since 2026-08-25 the only ending here is a superseded one: nothing is
    // asked before a build is replaced, so nothing can be declined (FR-008).
    if (ingress.kind !== 'committed') {
      return this.#settle('superseded');
    }

    // The workspace, then the draft, then the layer — in that order.
    //
    // The order is the whole of it. A route change started after the layer
    // closes is a route change racing whatever the screen underneath does when
    // it is uncovered, and on the shipyard that screen replaces the URL as soon
    // as a pointer rests on a row. Moving first, while the layer still covers
    // it, is what makes the Commander land on the build they just imported
    // (import contract, step 12).
    // Compared exactly: starting with `/outfitting` is not the same thing as being
    // the workspace.
    const path = this.#router.url.split(/[?#]/)[0];
    if (path !== WORKSPACE) {
      await this.#router.navigateByUrl(WORKSPACE);
    }

    // Only now: the draft has become a build, so it has stopped being a draft.
    // Every other ending keeps it exactly as it was typed (contract,
    // "Atomicity").
    this.#store.clearDraft();
    this.#store.closeLayer();
    return { kind: 'committed' };
  }

  /**
   * Abandons whatever is in flight, without touching the draft.
   *
   * The one operation behind close, cancel and a route change alike: all three
   * mean the answer being waited for is about a question nobody is asking.
   */
  abandon(): void {
    this.#store.issueToken();
    this.#store.setImportStatus('editing');
    // A scan in flight now carries a stale token, so it will return without
    // clearing the counter it raised. Left alone, the panel reopens saying it
    // is reading a file nobody asked for and refusing to submit anything.
    this.#store.setScanning(0);
  }

  /**
   * The candidate, in feature 001's own shape.
   *
   * `working` provenance and no baseline: an imported build exists nowhere a
   * Commander could get it back from, so it arrives dirty and autosave mints it
   * a record of its own at the first write. A build that is its hull's package
   * default holds no decision, so autosave writes nothing and the address is
   * what holds it (024/FR-001). Nothing else about where it came from — the
   * producer the envelope named, the draft — goes with it: neither is build
   * state.
   *
   * A partial roll the package completed is not reported. A completed grade is
   * what the application models, so reaching one is not a decision a Commander
   * is being asked to take, and feature 004 publishes no report of its own
   * either (`openspec/changes/archive/004-slef/design/import-outcome.md`, "Divergence").
   */
  #candidate(candidate: SlefImportCandidate) {
    const symbol = candidate.loadout.shipSymbol;
    return {
      loadout: candidate.loadout,
      hullName: this.#gameText.shipName(symbol).text ?? symbol,
      provenance: 'working' as const,
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    };
  }

  #settle(kind: 'superseded'): SlefImportSubmission {
    this.#store.setImportEnding(kind);
    return { kind };
  }
}

/**
 * Why feature 001 was handed no candidate.
 *
 * A stable code rather than a sentence. Feature 004 discards it — the layer's
 * own status line says what happened, in the message layer's words — but
 * sibling features render `CommitResult.reason` directly, and an English
 * sentence written here would be an owned string that never passed through a
 * catalogue (FR-014).
 */
const SUPERSEDED = 'superseded';

/** Where an imported build is looked at. Feature 001's own workspace route. */
const WORKSPACE = '/outfitting';
