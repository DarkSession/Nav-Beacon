import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  accountCursor,
  canSynchroniseRecord,
  recordBinding,
  remoteRevisionOf,
  type CommanderLocalState,
  type PendingOperationKind,
} from '../../domain/commander/commander-local-state';
import type {
  ConflictChoice,
  ConflictResolution,
  RecordConflict,
} from '../../domain/commander/record-conflict';
import type { LocalRecord } from '../../domain/records/local-record';
import { copyLocalRecord, isReconstructable } from '../../domain/records/record-draft';
import { adoptRemoteRecord } from '../../domain/records/remote-record.adopter';
import { remoteRecordsEqual } from '../../domain/records/remote-record.equality';
import { toRemoteRecord } from '../../domain/records/remote-record.serializer';
import type {
  ChangeResult,
  SynchronisationErrorCode,
  SynchronisationResponse,
} from '../../domain/records/record-synchronisation';
import {
  planSynchronisationBatch,
  type BatchPlan,
  type ChangeCandidate,
} from '../../domain/records/synchronisation-batch';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { COMMANDER_API } from '../../platform/network/commander-api';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { TabDescriptorRepository } from '../../platform/storage/tab-descriptor.repository';
import { AccountStore, type AccountCredentials } from '../account/account.store';
import { PausedRecords } from './paused-records';

/** Which bound one refused request exceeded. */
export type ExceededBound = 'record-too-large' | 'too-many-changes' | 'request-too-large';

/** Why one exchange did not leave this browser current. */
export type SynchronisationFailure =
  /** The service could not be reached, or answered something unreadable. */
  | { readonly reason: 'offline' }
  /** The session has gone. Local work is untouched and a fresh sign-in resumes it. */
  | { readonly reason: 'signed-out' }
  /** The service refused for its own reasons, and the same request may be retried. */
  | { readonly reason: 'service' }
  /** Browser storage refused the local half, so nothing was committed. */
  | { readonly reason: 'storage' }
  /** One named change cannot be sent as it stands. */
  | {
      readonly reason: 'refused';
      readonly code: SynchronisationErrorCode;
      readonly recordId: string | null;
    }
  /** A published size bound stopped the request. */
  | { readonly reason: 'bound'; readonly bound: ExceededBound; readonly recordId: string | null };

/**
 * What this browser can say about the account's records right now.
 *
 * Nothing here claims a device is current until the service has confirmed it,
 * which is why `current` carries the instant it was confirmed at and every
 * other state carries what is still owed (020/FR-011).
 */
export type SynchronisationStatus =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'synchronising' }
  | { readonly kind: 'pending'; readonly changes: number }
  | { readonly kind: 'current'; readonly at: string }
  | { readonly kind: 'conflicted'; readonly conflicts: number }
  | { readonly kind: 'failed'; readonly failure: SynchronisationFailure; readonly changes: number };

/**
 * The account's records, as one exchange at a time.
 *
 * Everything a Commander's records do across devices passes through here: the
 * first merge after a sign-in, the exchange after a save, a deletion or an
 * explicit retry, the daily protection renewal a live page owes, and the three
 * answers to a conflict. It is one store because the rules are one rule — a
 * complete response commits at once, or nothing does (020/FR-026).
 *
 * Three things are never done here. A local record is never removed because
 * the account no longer holds it while a live page still has it open or this
 * browser still owes it a write. A local-only record is never taken back into
 * an account. And the cursor never moves before the records the response
 * carried are in browser storage (020/FR-010, 020/FR-024, 020/FR-026).
 *
 * The interface states, the save paths and the renewal timer are elsewhere.
 * This holds the state they read and the operations they call.
 *
 * Reached through `record-synchronisation.loader.ts` rather than imported, so
 * the rules for an account's records arrive with the session that has records
 * to exchange rather than in the first payload of every page.
 */
@Injectable({ providedIn: 'root' })
export class RecordSynchronisationStore {
  readonly #api = inject(COMMANDER_API);
  readonly #account = inject(AccountStore);
  readonly #state = inject(CommanderStateRepository);
  readonly #records = inject(LocalRecordRepository);
  readonly #tab = inject(TabDescriptorRepository);
  readonly #uuid = inject(UuidAdapter);
  readonly #clock = inject(ClockAdapter);

  readonly #status = signal<SynchronisationStatus>({ kind: 'inactive' });
  readonly #conflicts = signal<readonly RecordConflict[]>([]);
  readonly #paused = inject(PausedRecords);
  readonly #unreadable = signal<readonly string[]>([]);

  /** Records this browser cannot send as they stand, until they change again. */
  readonly #refused = new Set<string>();
  /** Accounts this page has already merged, so a token refresh does not merge twice. */
  readonly #merged = new Set<string>();
  /** The instant each record's protection was last renewed, within this page. */
  readonly #renewedAt = new Map<string, number>();
  /** The exchange in flight, so that two triggers at once are one request. */
  #running: Promise<void> | null = null;
  /** Whether anything was queued after the exchange in flight read the queue. */
  #queuedSince = false;
  /** A record no request can carry, because it is over its own 64 KiB bound. */
  #oversized: string | null = null;
  /** Why a record this browser holds cannot be uploaded as it stands. */
  #blocked: SynchronisationFailure | null = null;
  /** Whether this page has already asked the account to read a refused session. */
  #sessionRead = false;

  readonly status = this.#status.asReadonly();
  readonly conflicts = this.#conflicts.asReadonly();
  /** Records the account holds in a form this version of the application cannot read. */
  readonly unreadable = this.#unreadable.asReadonly();
  /**
   * The records whose autosave is held.
   *
   * A live page whose record was deleted elsewhere keeps its active work and
   * stops writing to it until the Commander answers the conflict (020/FR-010).
   * Held in `PausedRecords` rather than here, because an autosave reads it
   * while it decides whether to write and this store arrives with the session.
   */
  readonly pausedRecords = this.#paused.records;
  readonly hasConflicts = computed(() => this.#conflicts().length > 0);

  constructor() {
    // The merge is the account becoming signed in, not a screen opening: a
    // Commander who signs in from any page of the application has their
    // records merged from that page (020/FR-008).
    effect(() => {
      const credentials = this.#account.credentials();
      if (credentials !== null && !this.#merged.has(credentials.customerId)) {
        this.#merged.add(credentials.customerId);
        void this.signedIn(credentials);
      }
    });
  }

  /**
   * Forgets what this page knew about an account that has gone.
   *
   * The queued operations and the cursor stay in browser storage: the same
   * Commander signing in again carries on where they stopped. What goes is what
   * this page was saying about them (020/FR-003).
   */
  signedOut(): void {
    this.#conflicts.set([]);
    this.#paused.releaseAll();
    this.#unreadable.set([]);
    this.#refused.clear();
    this.#merged.clear();
    this.#renewedAt.clear();
    this.#oversized = null;
    this.#blocked = null;
    this.#sessionRead = false;
    this.#status.set({ kind: 'inactive' });
  }

  /** Whether this record's autosave is held by an unanswered deletion conflict. */
  isPaused(recordId: string): boolean {
    return this.#paused.holds(recordId);
  }

  /** The conflict standing for one record, where there is one. */
  conflictFor(recordId: string): RecordConflict | null {
    return this.#conflicts().find((conflict) => conflict.recordId === recordId) ?? null;
  }

  /**
   * What a signed-in account does first in this browser.
   *
   * A browser that has never committed a response for this Commander merges:
   * every eligible local record is offered, and the account's own records come
   * back in the same exchange. A browser that has synchronised before simply
   * exchanges what it owes (020/FR-008).
   */
  async signedIn(credentials: AccountCredentials): Promise<void> {
    if (accountCursor(this.#state.read(), credentials.customerId) === 0) {
      await this.mergeFirstSignIn(credentials);
      return;
    }
    await this.synchronise(credentials);
  }

  /**
   * Offers every eligible local record, then exchanges.
   *
   * Only unbound records and records already bound to this Commander are
   * offered. A record bound to another Customer ID and a local-only record stay
   * where they are, and neither appears in nor uploads to this account
   * (020/FR-024).
   *
   * A record the installed package cannot reconstruct is not offered either. It
   * stays stored and unopened, and the service would refuse the whole batch it
   * travelled in (020/FR-012).
   */
  async mergeFirstSignIn(credentials: AccountCredentials): Promise<void> {
    const listed = this.#records.list();
    if (listed.ok) {
      for (const entry of listed.value) {
        if (!entry.available) {
          continue;
        }
        const state = this.#state.read();
        if (
          canSynchroniseRecord(state, entry.record.id, credentials.customerId) &&
          (await isReconstructable(entry.record))
        ) {
          this.#queue(entry.record.id, credentials.customerId, 'upload');
        }
      }
    }
    await this.synchronise(credentials);
  }

  /** Queues one record's current content for upload, after a save or autosave. */
  queueUpload(recordId: string, customerId: string): void {
    this.#queue(recordId, customerId, 'upload');
  }

  /** Queues one record's deletion, after it has been deleted locally. */
  queueDelete(recordId: string, customerId: string): void {
    this.#queue(recordId, customerId, 'delete');
  }

  /**
   * Queues a protection renewal for a live page's record, once a day.
   *
   * The service moves the deadline eight days forward and changes neither the
   * record revision nor the account revision, so a renewal never makes another
   * device's unchanged write stale (020/FR-009, 020/FR-025).
   */
  renewProtection(recordId: string, customerId: string): void {
    const now = this.#clock.now().getTime();
    const last = this.#renewedAt.get(recordId);
    if (last !== undefined && now - last < ONE_DAY) {
      return;
    }
    this.#renewedAt.set(recordId, now);
    this.#queue(recordId, customerId, 'renew');
  }

  /**
   * The triggers, for callers that hold a record rather than a session.
   *
   * Each is a local change followed by one exchange, and each does nothing at
   * all while the browser is anonymous: an anonymous tool needs no account and
   * queues nothing (constitution I, 020/FR-007).
   */
  async recordSaved(recordId: string): Promise<void> {
    await this.#triggered((customerId) => {
      this.queueUpload(recordId, customerId);
    });
  }

  async recordDeleted(recordId: string): Promise<void> {
    await this.#triggered((customerId) => {
      this.queueDelete(recordId, customerId);
    });
  }

  /**
   * A change already in the queue, taken up here.
   *
   * A record path that changed a record while this chunk was still on its way
   * writes what it owes the account through the loader, because a chunk that
   * never arrives must still leave a pending operation for the next trigger to
   * send (`record-synchronisation.loader.ts`, 020/FR-011). What is left for this
   * store is what its own rules decide, and the exchange that follows. Nothing
   * is queued again here: the change is in the queue once, and offering the
   * record twice would put a second revision of it in the account for one save.
   */
  async changeQueued(recordId: string): Promise<void> {
    await this.#triggered((customerId) => {
      this.#queued(recordId, customerId);
    });
  }

  /** One live page's record, kept protected while the service is reachable. */
  async recordLive(recordId: string): Promise<void> {
    await this.#triggered((customerId) => {
      this.renewProtection(recordId, customerId);
    });
  }

  /** A record library opening, or an explicit retry by the Commander. */
  async refresh(): Promise<void> {
    await this.#triggered(() => {});
  }

  /**
   * A live page resuming its own autosave, for a caller holding no session.
   *
   * The credential-free form of `resume`, for the autosave itself: it holds a
   * record and knows nothing about accounts, and an anonymous page resuming
   * simply writes again (020/FR-010).
   */
  async resumeRecord(recordId: string): Promise<ConflictResolution> {
    const credentials = this.#account.credentials();
    return credentials === null ? { kind: 'unknown' } : this.resume(recordId, credentials);
  }

  async #triggered(change: (customerId: string) => void): Promise<void> {
    const credentials = this.#account.credentials();
    if (credentials === null) {
      return;
    }
    change(credentials.customerId);
    await this.synchronise(credentials);
  }

  /**
   * Exchanges what this browser owes, and takes what the account has.
   *
   * One exchange runs at a time, because two overlapping requests would each
   * answer half the queue and move the cursor past what the other had not
   * committed yet (020/FR-026). A trigger that arrives while one is in flight
   * therefore does not start a second request. What it queued is not dropped
   * either: the exchange already running reads the queue once more when it
   * finds that something was added after it had read it, so a record saved
   * while the last request was open is offered without waiting for some later
   * save to carry it (020/FR-007).
   */
  async synchronise(credentials: AccountCredentials): Promise<void> {
    if (this.#running !== null) {
      return this.#running;
    }
    const exchange = this.#exchanges(credentials).finally(() => {
      this.#running = null;
    });
    this.#running = exchange;
    return exchange;
  }

  /** One exchange, and another for whatever was queued while it was open. */
  async #exchanges(credentials: AccountCredentials): Promise<void> {
    do {
      this.#queuedSince = false;
      await this.#exchange(credentials);
    } while (this.#queuedSince);
  }

  /** The Commander's answer to one conflict, for both kinds of conflict. */
  async resolve(
    recordId: string,
    choice: ConflictChoice,
    credentials: AccountCredentials,
  ): Promise<ConflictResolution> {
    const conflict = this.conflictFor(recordId);
    if (conflict === null) {
      return { kind: 'unknown' };
    }
    if (choice === 'cancel') {
      return this.#cancel(conflict);
    }
    if (choice === 'keep-both') {
      return this.#keepBoth(conflict, credentials);
    }
    return this.#overwrite(conflict, credentials);
  }

  /**
   * Explicit resume from a live-page pause.
   *
   * Resuming is an overwrite: the work the page kept goes back under the same
   * application record identity, at a revision newer than the deletion marker
   * (020/FR-010).
   */
  async resume(recordId: string, credentials: AccountCredentials): Promise<ConflictResolution> {
    return this.resolve(recordId, 'overwrite', credentials);
  }

  async #overwrite(
    conflict: RecordConflict,
    credentials: AccountCredentials,
  ): Promise<ConflictResolution> {
    this.#queue(conflict.recordId, conflict.customerId, 'upload', conflict.remoteRevision);
    this.#release(conflict.recordId);
    await this.synchronise(credentials);
    return { kind: 'overwritten', recordId: conflict.recordId };
  }

  /**
   * Keeps both versions, each under its own identity.
   *
   * This browser's version takes a fresh application record identity and is
   * offered under it. The old identity is the account's: its live version is
   * taken where this browser can read it, and its deletion marker is left in
   * place where the account holds one (020/FR-009, 020/FR-010).
   */
  async #keepBoth(
    conflict: RecordConflict,
    credentials: AccountCredentials,
  ): Promise<ConflictResolution> {
    const local = this.#openRecord(conflict.recordId);
    if (local === null) {
      return { kind: 'failed', recordId: conflict.recordId };
    }
    const copyId = this.#uuid.create();
    const copy = copyLocalRecord(local, { id: copyId, revisionId: this.#uuid.create() });
    if (copy === null || !this.#records.write(copy).ok) {
      return { kind: 'failed', recordId: conflict.recordId };
    }

    const accepted: { readonly recordId: string; readonly revision: number }[] = [];
    const removed: string[] = [];
    if (conflict.kind === 'stale-write' && conflict.remote !== null) {
      const adoption = await adoptRemoteRecord(conflict.remote, {
        revisionId: this.#uuid.create(),
        note: local.note,
        sourceNamed: local.sourceNamed,
      });
      if (!adoption.ok || !this.#records.write(adoption.draft).ok) {
        return { kind: 'failed', recordId: conflict.recordId };
      }
      accepted.push({ recordId: conflict.recordId, revision: conflict.remoteRevision });
    } else if (!this.#records.remove(conflict.recordId).ok) {
      return { kind: 'failed', recordId: conflict.recordId };
    } else {
      removed.push(conflict.recordId);
    }

    this.#commitLocal(
      conflict.customerId,
      accepted,
      removed,
      this.#operationsFor(conflict.recordId),
    );
    this.#release(conflict.recordId);
    this.#queue(copyId, conflict.customerId, 'upload');
    await this.synchronise(credentials);
    return { kind: 'kept-both', recordId: conflict.recordId, copiedTo: copyId };
  }

  /**
   * Leaves both versions as they are.
   *
   * The account keeps its version or its deletion marker, this browser keeps
   * its own copy, and that copy becomes local-only with nothing queued. It
   * needs an explicit new save or copy before it can synchronise again
   * (020/FR-009, 020/FR-010, 020/FR-024).
   */
  #cancel(conflict: RecordConflict): ConflictResolution {
    if (!this.#state.markRecordLocalOnly(conflict.recordId).ok) {
      return { kind: 'failed', recordId: conflict.recordId };
    }
    this.#release(conflict.recordId);
    this.#settle(conflict.customerId);
    return { kind: 'cancelled', recordId: conflict.recordId };
  }

  async #exchange(credentials: AccountCredentials): Promise<void> {
    const customerId = credentials.customerId;
    const state = this.#state.read();
    const since = accountCursor(state, customerId);
    const { candidates, abandoned } = await this.#candidates(state, customerId);
    const plan = planSynchronisationBatch(candidates, since);

    this.#oversized = plan.oversized[0]?.recordId ?? null;
    this.#status.set({ kind: 'synchronising' });

    const response = await this.#api.synchroniseRecords(
      { sinceRevision: since, changes: plan.changes },
      credentials.antiForgeryToken,
    );

    if (response.kind === 'unavailable') {
      this.#fail(customerId, { reason: 'offline' });
      return;
    }
    if (response.kind === 'refused') {
      this.#refusal(response, plan, customerId);
      return;
    }
    await this.#accepted(response, plan, customerId, abandoned);
  }

  /**
   * What this browser owes the account, as changes.
   *
   * A record under an unanswered conflict, one the service has already refused
   * and one that belongs to another account are all left out: sending any of
   * them again would refuse the whole batch and hold up every other record in
   * it (020/FR-026).
   */
  async #candidates(
    state: CommanderLocalState,
    customerId: string,
  ): Promise<{ candidates: readonly ChangeCandidate[]; abandoned: readonly string[] }> {
    const candidates: ChangeCandidate[] = [];
    const abandoned: string[] = [];

    for (const operation of state.pendingOperations) {
      const recordId = operation.recordId;
      if (
        operation.customerId !== customerId ||
        this.#refused.has(recordId) ||
        this.conflictFor(recordId) !== null ||
        !canSynchroniseRecord(state, recordId, customerId)
      ) {
        continue;
      }

      if (operation.kind !== 'upload') {
        candidates.push({
          operationId: operation.id,
          recordId,
          change:
            operation.kind === 'delete'
              ? { type: 'delete', id: recordId, baseRevision: operation.baseRevision }
              : { type: 'renew', id: recordId },
        });
        continue;
      }

      const record = this.#openRecord(recordId);
      if (record === null) {
        // The record is gone from this browser and the queued upload has
        // nothing left to send. It is answered by the next commit rather than
        // left to be retried for ever.
        abandoned.push(operation.id);
        continue;
      }
      if (!(await isReconstructable(record))) {
        continue;
      }
      candidates.push({
        operationId: operation.id,
        recordId,
        change: {
          type: 'write',
          record: toRemoteRecord(record),
          baseRevision: operation.baseRevision,
        },
      });
    }

    return { candidates, abandoned };
  }

  /**
   * Commits one complete accepted response.
   *
   * The records and deletion markers land in browser storage first and the
   * cursor moves last, in one write with the operations the response answered.
   * A storage failure anywhere in between leaves the cursor where it was, and
   * the retry reads the same stretch of the stream again and answers as a
   * no-op (020/FR-026).
   */
  async #accepted(
    response: Extract<SynchronisationResponse, { kind: 'accepted' }>,
    plan: BatchPlan,
    customerId: string,
    abandoned: readonly string[],
  ): Promise<void> {
    this.#sessionRead = false;
    const completed = [...abandoned];
    const accepted: { readonly recordId: string; readonly revision: number }[] = [];
    const removed: string[] = [];

    for (const result of response.results) {
      const operationId = plan.operationIds[result.index];
      const recordId = plan.recordIds[result.index];
      const change = plan.changes[result.index];
      if (operationId === undefined || recordId === undefined || change === undefined) {
        continue;
      }
      if (result.outcome !== 'applied' && result.outcome !== 'unchanged') {
        continue;
      }
      completed.push(operationId);
      if (change.type === 'delete') {
        removed.push(recordId);
      } else if (change.type === 'write' && result.revision !== null && result.revision > 0) {
        accepted.push({ recordId, revision: result.revision });
      }
    }

    const answered = new Set(completed);
    const owed = (current: CommanderLocalState, recordId: string): boolean =>
      current.pendingOperations.some(
        (operation) => operation.recordId === recordId && !answered.has(operation.id),
      );
    // Reading a remote record takes a turn, and a live page writes during one:
    // an autosave is synchronous, so it writes the Commander's edit, reports it
    // saved and queues its upload while this is still reading. Both reads are
    // taken again before the write, because the version in browser storage is
    // then the Commander's own work and the account's bytes would replace it
    // without a word (020/FR-009, constitution IV).
    const changedUnderUs = (recordId: string, opened: LocalRecord | null): boolean =>
      owed(this.#state.read(), recordId) ||
      (this.#openRecord(recordId)?.revisionId ?? null) !== (opened?.revisionId ?? null);

    const unreadable = [...this.#unreadable()];
    for (const entry of response.unreadableRecords) {
      if (entry.id !== null && !unreadable.includes(entry.id)) {
        unreadable.push(entry.id);
      }
    }

    for (const entry of response.records) {
      const recordId = entry.record.id;
      // Read for each record rather than once for the response: an earlier
      // record in the same response has already taken a turn to read, and what
      // a live page did during that turn decides this one.
      const before = this.#state.read();
      if (recordBinding(before, recordId) === 'local-only' || owed(before, recordId)) {
        continue;
      }
      const local = this.#openRecord(recordId);
      if (local !== null && remoteRecordsEqual(toRemoteRecord(local), entry.record)) {
        accepted.push({ recordId, revision: entry.revision });
        continue;
      }
      const adoption = await adoptRemoteRecord(entry.record, {
        revisionId: this.#uuid.create(),
        note: local?.note ?? null,
        sourceNamed: local?.sourceNamed ?? null,
      });
      if (!adoption.ok) {
        // The account holds it, this version cannot open it, and it stays
        // remote and unopened rather than half-written here (020/FR-012).
        if (!unreadable.includes(recordId)) {
          unreadable.push(recordId);
        }
        accepted.push({ recordId, revision: entry.revision });
        continue;
      }
      if (changedUnderUs(recordId, local)) {
        // The Commander's own edit is in browser storage and queued, so this
        // browser keeps it and claims nothing about the account's revision. The
        // queued upload carries the revision it was made against, which the
        // service refuses as the conflict it is (020/FR-009).
        continue;
      }
      if (!this.#records.write(adoption.draft).ok) {
        this.#fail(customerId, { reason: 'storage' });
        return;
      }
      accepted.push({ recordId, revision: entry.revision });
    }
    this.#unreadable.set(unreadable);

    // Read again, for the same reason: the reads above took turns, and what a
    // live page did during them decides whether a deletion marker may remove a
    // record here.
    const current = this.#state.read();
    for (const tombstone of response.tombstones) {
      const recordId = tombstone.id;
      if (recordBinding(current, recordId) === 'local-only') {
        continue;
      }
      const local = this.#openRecord(recordId);
      if (local === null) {
        removed.push(recordId);
        continue;
      }
      const claimed = this.#claims().includes(recordId);
      if (claimed || owed(current, recordId)) {
        this.#raise({
          recordId,
          customerId,
          kind: 'remote-deletion',
          remoteRevision: tombstone.revision,
          remote: null,
          remoteUnreadable: false,
          claimed,
        });
        continue;
      }
      if (!this.#records.remove(recordId).ok) {
        this.#fail(customerId, { reason: 'storage' });
        return;
      }
      removed.push(recordId);
    }

    const committed = this.#state.commitSynchronisation({
      customerId,
      cursor: response.accountRevision,
      accepted,
      removedRecordIds: removed,
      completedOperationIds: completed,
    });
    if (!committed.ok) {
      this.#fail(customerId, { reason: 'storage' });
      return;
    }
    this.#settle(customerId);
  }

  /**
   * What one refusal means for the records it names.
   *
   * A refusal applies none of the batch, so every local change stays pending.
   * What changes here is only what this browser now knows: which records
   * conflict, which belong to another account and which cannot be sent as they
   * stand (020/FR-026).
   */
  #refusal(
    response: Extract<SynchronisationResponse, { kind: 'refused' }>,
    plan: BatchPlan,
    customerId: string,
  ): void {
    if (response.status === 401) {
      this.#sessionRefused();
      this.#fail(customerId, { reason: 'signed-out' });
      return;
    }
    if (response.code === 'conflict') {
      for (const result of response.results) {
        this.#conflictFrom(result, plan, customerId);
      }
      this.#settle(customerId);
      return;
    }

    const named = response.results.find((result) => result.outcome === 'refused');
    const recordId = named === undefined ? null : (plan.recordIds[named.index] ?? null);

    if (response.code === 'cross-account-record' && recordId !== null) {
      // The account holds that identity for someone else. This browser's copy
      // stays, local-only, with nothing queued (020/FR-024).
      this.#state.markRecordLocalOnly(recordId);
      this.#fail(customerId, { reason: 'refused', code: response.code, recordId });
      return;
    }
    if (
      response.code === 'record-too-large' ||
      response.code === 'too-many-changes' ||
      response.code === 'request-too-large'
    ) {
      this.#fail(customerId, { reason: 'bound', bound: response.code, recordId });
      return;
    }
    if (
      response.code === 'invalid-record' ||
      response.code === 'unsupported-record-version' ||
      response.code === 'invalid-request'
    ) {
      if (recordId !== null) {
        this.#refused.add(recordId);
      }
      // Stated until the record changes again. A request that carries it once
      // more would refuse the batch it travelled in, so the reason stands
      // rather than being replaced by a count of what is waiting (020/FR-012).
      this.#blocked = { reason: 'refused', code: response.code, recordId };
      this.#fail(customerId, this.#blocked);
      return;
    }
    this.#fail(customerId, { reason: 'service' });
  }

  /**
   * One conflicting change, read as the conflict a Commander answers.
   *
   * A deletion an unchanged copy receives is not always a conflict. A copy no
   * live page claims is simply removed once the account no longer holds it; a
   * copy a live page claims keeps its work and pauses autosave instead
   * (020/FR-010).
   */
  #conflictFrom(result: ChangeResult, plan: BatchPlan, customerId: string): void {
    if (result.outcome !== 'conflict') {
      return;
    }
    const recordId = plan.recordIds[result.index];
    const change = plan.changes[result.index];
    const operationId = plan.operationIds[result.index];
    if (recordId === undefined || change === undefined || operationId === undefined) {
      return;
    }
    const remoteRevision = result.revision ?? 0;
    const claimed = this.#claims().includes(recordId);

    if (result.remote?.kind === 'deleted') {
      if (!claimed && change.type === 'renew') {
        // A renewal carries no content change, so this copy is unchanged and
        // unclaimed: it goes when the account no longer holds it.
        if (this.#records.remove(recordId).ok) {
          this.#commitLocal(customerId, [], [recordId], [operationId]);
          return;
        }
      }
      this.#raise({
        recordId,
        customerId,
        kind: 'remote-deletion',
        remoteRevision,
        remote: null,
        remoteUnreadable: false,
        claimed,
      });
      return;
    }

    this.#raise({
      recordId,
      customerId,
      kind: 'stale-write',
      remoteRevision,
      remote: result.remote?.kind === 'record' ? result.remote.record : null,
      remoteUnreadable: result.remote?.kind !== 'record',
      claimed,
    });
  }

  #raise(conflict: RecordConflict): void {
    this.#conflicts.update((standing) => [
      ...standing.filter((entry) => entry.recordId !== conflict.recordId),
      conflict,
    ]);
    if (conflict.claimed && conflict.kind === 'remote-deletion') {
      this.#paused.hold(conflict.recordId);
    }
  }

  /** Clears one answered conflict and lets its live page write again. */
  #release(recordId: string): void {
    this.#conflicts.update((standing) => standing.filter((entry) => entry.recordId !== recordId));
    this.#paused.release(recordId);
  }

  /**
   * Writes one change to the queue, and takes up what follows it.
   *
   * Browser storage can refuse the write, and then nothing is queued: the
   * change stays in the record and nothing at all is waiting to offer it. That
   * is stated as the storage failure it is rather than settled as work the
   * account is about to receive, because settling it would let this browser
   * call itself current while a Commander's save has never left it
   * (020/FR-011, 020/FR-026).
   *
   * The reason stands rather than being replaced by a count of what is waiting,
   * as a refused record's does: the exchange that follows this trigger carries
   * everything else that was queued and would otherwise answer a Commander's
   * lost save with `current`. A later change that does reach the queue clears
   * it.
   */
  #queue(
    recordId: string,
    customerId: string,
    kind: PendingOperationKind,
    baseRevision?: number,
  ): void {
    const state = this.#state.read();
    if (!canSynchroniseRecord(state, recordId, customerId)) {
      return;
    }
    const written = this.#state.queueOperation({
      id: this.#uuid.create(),
      customerId,
      recordId,
      kind,
      baseRevision: baseRevision ?? remoteRevisionOf(state, recordId),
      queuedAt: this.#clock.timestamp(),
    });
    if (!written.ok) {
      this.#blocked = { reason: 'storage' };
      this.#fail(customerId, this.#blocked);
      return;
    }
    this.#queued(recordId, customerId);
  }

  /**
   * What follows one change entering the queue, wherever it was written.
   *
   * A record the service refused stops being refused once it has changed again.
   * An exchange already in flight read the queue before this change reached it,
   * so it is told to read it once more rather than leaving the change for some
   * later trigger to carry (020/FR-007, 020/FR-026).
   */
  #queued(recordId: string, customerId: string): void {
    this.#refused.delete(recordId);
    if (this.#refused.size === 0) {
      this.#blocked = null;
    }
    this.#queuedSince = true;
    if (this.#status().kind !== 'synchronising') {
      this.#settle(customerId);
    }
  }

  /**
   * A local-only change to what this browser knows, with the cursor untouched.
   *
   * The cursor is passed as it stands, so nothing here can move it: these
   * writes answer something the service already told this browser, not a
   * stretch of the stream it has read (020/FR-026).
   */
  #commitLocal(
    customerId: string,
    accepted: readonly { readonly recordId: string; readonly revision: number }[],
    removed: readonly string[],
    completed: readonly string[],
  ): void {
    this.#state.commitSynchronisation({
      customerId,
      cursor: accountCursor(this.#state.read(), customerId),
      accepted,
      removedRecordIds: removed,
      completedOperationIds: completed,
    });
  }

  #operationsFor(recordId: string): readonly string[] {
    return this.#state
      .read()
      .pendingOperations.filter((operation) => operation.recordId === recordId)
      .map((operation) => operation.id);
  }

  #openRecord(recordId: string): LocalRecord | null {
    const opened = this.#records.open(recordId);
    return opened.ok ? (opened.value?.record ?? null) : null;
  }

  /** The records a live page in this browser holds open, by tool. */
  #claims(): readonly string[] {
    return Object.values(this.#tab.read()?.workingRecords ?? {}).filter(
      (recordId): recordId is string => typeof recordId === 'string',
    );
  }

  #pendingCount(customerId: string): number {
    return this.#state
      .read()
      .pendingOperations.filter((operation) => operation.customerId === customerId).length;
  }

  /**
   * Asks the account to read a session the service has refused.
   *
   * The refusal says the session has ended, and this browser's account state
   * is what still says otherwise. The read clears that state and the fleet
   * cache, and leaves the planning records, the queue and the current work
   * alone (020/FR-003). It is not waited for: this exchange already knows what
   * it owes the Commander, which is the failure it states.
   *
   * Once, until the service accepts an exchange again. A session read
   * publishes fresh credentials, the renewal watch runs again on them, and a
   * service that refuses every exchange while still answering the session read
   * would otherwise be asked for a session by every refusal it causes.
   */
  #sessionRefused(): void {
    if (this.#sessionRead) {
      return;
    }
    this.#sessionRead = true;
    void this.#account.refreshSession();
  }

  #fail(customerId: string, failure: SynchronisationFailure): void {
    this.#status.set({ kind: 'failed', failure, changes: this.#pendingCount(customerId) });
  }

  /** States where the account stands once an exchange has been accounted for. */
  #settle(customerId: string): void {
    const oversized = this.#oversized;
    if (oversized !== null) {
      // The request the service accepted left this record behind, and no
      // request can carry it. The bound is named rather than the wait
      // (020/FR-026).
      this.#fail(customerId, {
        reason: 'bound',
        bound: 'record-too-large',
        recordId: oversized,
      });
      return;
    }
    const blocked = this.#blocked;
    if (blocked !== null) {
      this.#fail(customerId, blocked);
      return;
    }
    const conflicts = this.#conflicts();
    if (conflicts.length > 0) {
      this.#status.set({ kind: 'conflicted', conflicts: conflicts.length });
      return;
    }
    const pending = this.#pendingCount(customerId);
    this.#status.set(
      pending > 0
        ? { kind: 'pending', changes: pending }
        : { kind: 'current', at: this.#clock.timestamp() },
    );
  }
}

const ONE_DAY = 24 * 60 * 60 * 1000;
