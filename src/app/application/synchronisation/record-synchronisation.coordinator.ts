import { Injectable, effect, inject } from '@angular/core';
import type { ConflictChoice, ConflictResolution } from '../../domain/commander/record-conflict';
import type { RecordTool } from '../../domain/records/local-record';
import { ConnectivityAdapter } from '../../platform/browser/connectivity.adapter';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { AccountStore } from '../account/account.store';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { LoadoutStore } from '../equipment/loadout.store';
import type { WorkingRecordSubject } from '../build-library/working-record.port';
import { RecordSynchronisationStore } from './record-synchronisation.store';

/**
 * How often a live page asks whether its records owe a protection renewal.
 *
 * The rule is one renewal a day and the store holds it; this is only how often
 * the question is put, so a page left open for a week renews on each of its
 * days rather than only at the moment it was opened (020/FR-025).
 */
export const PROTECTION_CHECK_MS = 60 * 60 * 1000;

/**
 * What keeps the account's records exchanging while the application runs.
 *
 * The synchronisation store holds the rules and owns no timer, no session
 * lifecycle and no interface. This is the three of them:
 *
 *   * it is what injects the store at all, so the first-sign-in merge runs from
 *     whichever page a Commander signs in on (020/FR-008);
 *   * it renews the protection deadline of the records the live page is
 *     autosaving into, once a day, while the service is reachable
 *     (020/FR-025);
 *   * it forgets the account when a Commander signs out or deletes it, which
 *     the account store states rather than calls, because that store is the one
 *     the synchronisation store already reads (020/FR-003).
 *
 * It also carries the one conflict answer that is not the store's to give. Keep
 * both mints a fresh identity for this browser's version, and a live page that
 * was holding the old identity has to follow its work onto the new one — the
 * tab claim and the tool's own record id both move, or a reload would restore
 * from a record the account keeps and this page no longer writes to
 * (020/FR-009, 020/FR-010).
 */
@Injectable({ providedIn: 'root' })
export class RecordSynchronisationCoordinator {
  readonly #store = inject(RecordSynchronisationStore);
  readonly #account = inject(AccountStore);
  readonly #connectivity = inject(ConnectivityAdapter);
  readonly #tab = inject(TabDescriptorRepository);
  readonly #build = inject(ActiveBuildStore);
  readonly #loadout = inject(LoadoutStore);

  #timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Sign-out and account deletion both leave this page with nothing to say
    // about an account. The queued operations and the cursor stay in browser
    // storage, so the same Commander signing in again carries on (020/FR-003).
    let seen = this.#account.signedOutRevision();
    effect(() => {
      const revision = this.#account.signedOutRevision();
      if (revision !== seen) {
        seen = revision;
        this.#store.signedOut();
      }
    });
  }

  /**
   * Starts renewing protection for whatever this page is autosaving into.
   *
   * Returns an unsubscribe. Called once, from the application's own
   * initializer, because the records are held by the tools rather than by a
   * screen: a Commander who leaves a build open and goes to the shipyard is
   * still a live page holding that record (020/FR-025).
   */
  start(): () => void {
    const watcher = effect(() => {
      // Read as signals, so the renewal is put again the moment the page comes
      // back online, signs in, or takes up another record.
      this.#connectivity.online();
      this.#account.credentials();
      this.#build.autosaveRecordId();
      this.#loadout.autosaveRecordId();
      this.renewProtection();
    });

    this.#timer = setInterval(() => this.renewProtection(), PROTECTION_CHECK_MS);

    return () => {
      watcher.destroy();
      if (this.#timer !== null) {
        clearInterval(this.#timer);
        this.#timer = null;
      }
    };
  }

  /**
   * Renews the remote protection of every record this page is autosaving into.
   *
   * Nothing is sent while the browser believes it is offline, and nothing at
   * all while it is anonymous. The store keeps the once-a-day rule, so putting
   * the question more often than that costs one comparison (020/FR-025).
   */
  renewProtection(): void {
    if (!this.#connectivity.online()) {
      return;
    }
    for (const recordId of this.#heldRecords()) {
      void this.#store.recordLive(recordId);
    }
  }

  /** A record library opening, or an explicit retry by the Commander. */
  async refresh(): Promise<void> {
    await this.#store.refresh();
  }

  /**
   * The Commander's answer to one conflict, and what this page owes it.
   *
   * The store decides what happens to the records. What is added here is the
   * live page: keep both puts this browser's version under a fresh identity,
   * and the tool that was writing to the old one follows it there.
   */
  async resolve(recordId: string, choice: ConflictChoice): Promise<ConflictResolution> {
    const credentials = this.#account.credentials();
    if (credentials === null) {
      return { kind: 'unknown' };
    }
    const resolution = await this.#store.resolve(recordId, choice, credentials);
    if (resolution.kind === 'kept-both') {
      this.#moveClaim(resolution.recordId, resolution.copiedTo);
    }
    return resolution;
  }

  /**
   * Moves a live page's claim from the account's identity onto the copy's.
   *
   * Both halves, and in this order. The tool's own id is what the next autosave
   * writes to; the tab claim is what a reload restores from. One without the
   * other leaves the page writing to one record and restoring from another.
   */
  #moveClaim(recordId: string, copiedTo: string): void {
    for (const subject of this.#subjects()) {
      if (subject.autosaveRecordId() !== recordId) {
        continue;
      }
      subject.setAutosaveRecordId(copiedTo);
      this.#tab.write(subject.tool, copiedTo);
    }
  }

  /** The records this page is autosaving into, by tool. */
  #heldRecords(): readonly string[] {
    return this.#subjects()
      .map((subject) => subject.autosaveRecordId())
      .filter((recordId): recordId is string => recordId !== null);
  }

  #subjects(): readonly (WorkingRecordSubject & { readonly tool: RecordTool })[] {
    return [this.#build, this.#loadout];
  }
}
