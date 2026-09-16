import { Injectable, Injector, effect, inject } from '@angular/core';
import type { RecordTool } from '../../domain/records/local-record';
import { BroadcastChannelAdapter } from '../../platform/browser/broadcast-channel.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { LoadoutAutosaveService } from '../equipment/loadout-autosave.service';
import { LoadoutStore } from '../equipment/loadout.store';
import { AutosaveService } from './autosave.service';
import type { WorkingRecordSubject } from './working-record.port';

/**
 * Which records this page autosaves into, and nobody else does.
 *
 * A duplicated tab is the problem this exists for. `sessionStorage` is copied
 * into the duplicate, so both pages wake up believing they own the same
 * record — and both would autosave to it, each overwriting the other's work
 * with no warning and no conflict to resolve.
 *
 * The handshake is deliberately one-sided: a page announces the id it intends
 * to write to along with a nonce that exists only in memory. A page that hears
 * its own id announced by a *different* nonce knows a copy of it is live, and
 * the later claimant forks — a new id, and the current work copied into it —
 * before either page next autosaves.
 *
 * The nonce is never a record identity and is never stored. It answers exactly
 * one question: "is that other page me?"
 *
 * **Revised 2026-08-25.** The id itself belongs to the tool's own store, which
 * writes it with everything else that says where the work came from, in one
 * commit. This coordinator does not hold a second copy of it: it persists it,
 * announces it and forks it. Two signals holding one identity is two places for
 * it to disagree, and the disagreement would be about which record a
 * Commander's next keystroke lands in.
 *
 * One page, one record **per tool**. A Commander has a build and a loadout open
 * at the same time, each autosaved into an unnamed record of its own, so every
 * answer here is asked about a tool and a fork of one leaves the other where it
 * is (017/FR-010).
 *
 * Two pages holding one *named* record open is not a collision and is not
 * announced here. Neither of them autosaves into it (001/FR-012).
 */
@Injectable({ providedIn: 'root' })
export class TabOwnershipCoordinator {
  readonly #tab = inject(TabDescriptorRepository);
  readonly #channel = inject(BroadcastChannelAdapter);
  readonly #uuid = inject(UuidAdapter);
  readonly #injector = inject(Injector);
  readonly #shipAutosave = inject(AutosaveService);
  readonly #benchAutosave = inject(LoadoutAutosaveService);

  #nonce: string | null = null;

  /**
   * This page's own identity for the run. Ephemeral, by design.
   *
   * Minted where it is first needed rather than at construction. The shell
   * reaches this coordinator to offer the bar's re-entry action, and the
   * prerender pass builds that shell in a runtime with no cryptographic random
   * source — where an identity is neither available nor wanted, because nothing
   * there claims a record or hears a claim.
   */
  get pageNonce(): string {
    this.#nonce ??= this.#uuid.create();
    return this.#nonce;
  }

  /**
   * The tools whose records this page holds, by tool.
   *
   * Registered at construction rather than when a screen mounts. The store is
   * what holds the work and it outlives every screen, and the expiry sweep runs
   * from the application root — so a coordinator that only knew about a tool
   * while its screen was drawn would let the sweep take a record out from under
   * work a Commander still has open (001/FR-013).
   */
  readonly #subjects = new Map<RecordTool, WorkingRecordSubject>([
    ['ship', inject(ActiveBuildStore)],
    ['equipment', inject(LoadoutStore)],
  ]);

  /**
   * What copies a tool's work into the record a fork moved it onto.
   *
   * Bound here rather than by a screen, for the reason `fork` states, and bound
   * to the autosave, which is what a screen would have handed over anyway.
   */
  readonly #copyOnFork = new Map<RecordTool, () => void>([
    ['ship', () => this.#shipAutosave.adoptForkedRecord()],
    ['equipment', () => this.#benchAutosave.adoptForkedRecord()],
  ]);

  /** The last id claimed for each tool, so one id is not announced twice. */
  readonly #announced = new Map<RecordTool, string>();

  /**
   * What every other live page says it is autosaving into, by page and tool.
   *
   * Kept so the expiry sweep can leave those records alone: a page that has had
   * work open for seven days without touching it is still working on it, and
   * removing the record under it would be the one loss a countdown could not
   * warn about (001/FR-013).
   *
   * By page and tool rather than as a set of ids, so a page that forks replaces
   * its own entry instead of leaving the record it stepped off protected
   * forever — and so a page holding two records has both of them protected
   * rather than whichever it announced last.
   */
  readonly #claimsElsewhere = new Map<string, string>();

  /** How many screens are listening, so one page opens one subscription. */
  #listeners = 0;
  #stopListening: (() => void) | null = null;

  /**
   * Reads back the record a tool was working from before a reload.
   *
   * It returns the id and nothing more. Whether that record becomes this page's
   * autosave target or is merely held depends on whether it turns out to be
   * named, and the record itself is the only honest answer to that — so the
   * decision belongs to whoever opens it, not to a flag written beside it here.
   */
  claim(tool: RecordTool): string | null {
    return this.#tab.read()?.workingRecords[tool] ?? null;
  }

  /**
   * Starts persisting and announcing whatever record this tool is holding.
   *
   * Returns an unsubscribe. Driven by the store rather than called at each
   * ingress, so a record taken over at commit, one minted by autosave and one
   * arrived at by forking are all announced by the same line of code.
   *
   * The subject passed here becomes the one registered for its tool, replacing
   * the store registered at construction. In the application they are the same
   * singleton; what this allows is a test standing a double in for one tool
   * while the other keeps its own.
   */
  track(subject: WorkingRecordSubject): () => void {
    this.#subjects.set(subject.tool, subject);

    const watcher = effect(
      () => {
        const id = subject.autosaveRecordId() ?? namedHome(subject);
        if (id === null) {
          // A tool whose work is in no record claims none. Reached where a tool
          // that was writing to one takes up work that is stored nowhere: a
          // build still at its hull's default (024/FR-001). A claim left behind
          // would have a reload restore the record the Commander stepped off,
          // and a duplicated tab fork it.
          if (this.#claimIsSpent(subject)) {
            this.release(subject.tool);
          }
          return;
        }
        if (id === this.#announced.get(subject.tool)) {
          return;
        }
        this.#announced.set(subject.tool, id);
        this.#tab.write(subject.tool, id);
        this.#announce(subject.tool);
      },
      { injector: this.#injector },
    );

    return () => watcher.destroy();
  }

  /**
   * Whether the claim in the tab is one this page is finished with.
   *
   * Asked of a tool whose work is in no record. What it has to tell apart is a
   * claim this page has stepped off from the claim a reload is about to read:
   * the descriptor outlives the page that wrote it — that is what makes it
   * readable after a reload — and every page registers its tools before it has
   * restored anything, holding nothing at that moment.
   *
   * A claim this page wrote in this run is its own by construction. Otherwise
   * the claim was written before this page loaded, and it is spent once this
   * tool holds work of its own: the restore that reads the claim runs only
   * while the tool holds nothing, so from there the claim describes nothing on
   * this page and nothing else will correct it. A default build mints no
   * record, so there is no later write to correct it with (024/FR-001).
   *
   * A tool claiming nothing has nothing to let go of. Answered first, so a
   * default build a Commander keeps editing does not say the same release over
   * and over.
   */
  #claimIsSpent(subject: WorkingRecordSubject): boolean {
    if (this.claim(subject.tool) === null) {
      return false;
    }
    return this.#announced.has(subject.tool) || subject.fingerprint() !== null;
  }

  /**
   * Lets go of one tool's record, without touching the other tool's.
   *
   * Called where a tool stops writing to a record and takes up no other: the
   * bench was emptied, in which case the record keeps the work, or the record
   * was deleted on this page, in which case there is nothing left to keep. The
   * claim is what a reload reads, so one left behind would restore what a
   * Commander cleared (017/FR-006), or name a record that is gone (017/FR-010).
   * What is released is the claim, never the record.
   */
  release(tool: RecordTool): void {
    this.#announced.delete(tool);
    this.#tab.release(tool);
    // And said out loud, so a sibling page stops protecting a record nobody is
    // writing to any more. A claim it never hears the end of would keep the
    // entry alive for as long as this page runs (001/FR-013).
    this.#channel.post({ kind: 'working-release', tool, pageNonce: this.pageNonce });
  }

  /** Says which record a tool is autosaving into, if it is holding one. */
  #announce(tool: RecordTool): void {
    const id = this.#subjects.get(tool)?.autosaveRecordId() ?? null;
    if (id === null) {
      return;
    }
    this.#channel.post({
      kind: 'working-claim',
      tool,
      workingRecordId: id,
      pageNonce: this.pageNonce,
    });
  }

  /**
   * Says which records this page is autosaving into.
   *
   * `except` leaves one tool out, for the tool that has just forked: the fork
   * announced the new id itself, so announcing it again would send one claim
   * twice.
   *
   * The rest are announced on purpose, and a page that answers one by forking
   * is the point rather than the hazard: whichever of the two pages steps off
   * a record copies its work into the record it steps onto, so no claim sent
   * here can cost a write.
   */
  #announceAll(except: RecordTool | null = null): void {
    for (const tool of this.#subjects.keys()) {
      if (tool !== except) {
        this.#announce(tool);
      }
    }
  }

  /**
   * Whether any live page — this one included — is autosaving into this record.
   *
   * Asked by the expiry sweep, and answered from what pages have actually said
   * rather than from what is stored: a record's own bytes cannot know that a
   * tab still has it open.
   */
  heldLive(recordId: string): boolean {
    for (const subject of this.#subjects.values()) {
      if (subject.autosaveRecordId() === recordId) {
        return true;
      }
    }
    return [...this.#claimsElsewhere.values()].includes(recordId);
  }

  /**
   * Listens for a sibling page claiming the same record. Returns an unsubscribe.
   *
   * One subscription per page however many screens ask for one: the handler
   * answers for every tool tracking here, and a second subscription would
   * answer each claim twice.
   */
  listen(): () => void {
    this.#listeners += 1;
    this.#stopListening ??= this.#subscribe();

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#listeners -= 1;
      if (this.#listeners === 0) {
        this.#stopListening?.();
        this.#stopListening = null;
      }
    };
  }

  #subscribe(): () => void {
    return this.#channel.subscribe((message) => {
      if (message.kind !== 'working-claim' && message.kind !== 'working-release') {
        return;
      }
      if (message.pageNonce === this.pageNonce) {
        return;
      }

      if (message.kind === 'working-release') {
        this.#claimsElsewhere.delete(`${message.pageNonce}:${message.tool}`);
        return;
      }

      // A claim from a page running an older version named no tool, because a
      // page held one record then and it was the ship tool's.
      const tool = message.tool ?? 'ship';
      const claimant = `${message.pageNonce}:${tool}`;
      const known = this.#claimsElsewhere.has(claimant);
      this.#claimsElsewhere.set(claimant, message.workingRecordId);

      if (message.workingRecordId === this.#subjects.get(tool)?.autosaveRecordId()) {
        // Another live page announced an id this page writes to. The page that
        // hears the announcement is the earlier one still running, so it is the
        // one that steps aside — the announcing page has just started and has
        // nothing to preserve yet. The fork announces the new id, which is also
        // how the newcomer learns this page is here. Only that tool moves: the
        // other one's record is not in question.
        this.fork(tool);

        // The other tool's record is still this page's, and a page heard from
        // for the first time knows nothing about it. Left unsaid, its sweep
        // would remove a record this page is autosaving into (001/FR-013).
        if (!known) {
          this.#announceAll(tool);
        }
        return;
      }

      if (!known) {
        // A page this one had not heard from before. Announcing again is how a
        // page that started earlier becomes known to one that started later:
        // claims are made once, so without this, only the newest page's records
        // would be protected from the sweep. Bounded by construction — a
        // re-announcement is made once per newly seen page and tool, and a page
        // never answers its own.
        this.#announceAll();
      }
    });
  }

  /**
   * Moves one tool onto a fresh record.
   *
   * The previous id is left alone: whatever is in it belongs to the other page
   * now, and nothing is deleted to make room.
   */
  fork(tool: RecordTool): string {
    const subject = this.#subjects.get(tool);
    const previous = subject?.autosaveRecordId() ?? null;
    const next = this.#uuid.create();

    subject?.setAutosaveRecordId(next);
    if (previous !== null) {
      this.#copyOnFork.get(tool)?.();
    }

    // Remembered and announced here rather than left to the watcher. Both tools
    // are registered for the whole page, so a tool is forked whether or not its
    // screen is drawn — and a tool whose screen is not drawn has no watcher
    // running to write the new id down. Without this, a reload would restore
    // from the record the other page is writing to, which is the collision the
    // fork exists to end.
    this.#announced.set(tool, next);
    this.#tab.write(tool, next);
    this.#announce(tool);

    return next;
  }
}

/**
 * The named record a tool's work can be opened from again, or `null`.
 *
 * The other half of what a tab claims. A claim is the record a reload restores
 * from, and autosave is not the only way work gets into one: a save moves the
 * work into a named record and clears the autosave target, because autosave has
 * no path to a named record (001/FR-008, 017/FR-007). Opening a named record
 * from the saved list leaves the work in the same place. Both are work that is
 * stored, in a record that is not this tool's to write.
 *
 * Read from where the work is rather than from how it got there, so a saved
 * record and an opened one are one answer. Read reactively too: the source and
 * the dirty state are signals, so work that moves off a named record wakes the
 * watcher that holds the claim. That matters under 024/FR-001, where a default
 * build allocates no record — so there is no later allocation to correct a
 * claim left standing (024/FR-001).
 *
 * Only while the work matches what the record holds. An edit puts the work
 * somewhere the record cannot be opened to, and the claim is for restoring the
 * work, not for naming where it came from. The next write mints an unnamed
 * record and claims that instead.
 */
function namedHome(subject: WorkingRecordSubject): string | null {
  const source = subject.sourceNamed();
  if (source === null || subject.dirty()) {
    return null;
  }
  return source.recordId;
}
