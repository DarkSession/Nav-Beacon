import { Injectable, inject } from '@angular/core';
import { RecordSynchronisationStore } from '../synchronisation/record-synchronisation.store';
import type { LocalRecord } from '../../domain/records/local-record';
import type { RecordPayload } from '../../domain/records/local-record.serializer';
import { LocksUnavailableError, WebLocksAdapter } from '../../platform/browser/web-locks.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import { recordLockName } from '../../platform/storage/storage-keys';
import type { StorageFailureCode } from '../../platform/storage/web-storage.port';

/** What a named write is trying to do. */
export interface NamedSaveRequest {
  /** The record to replace, or `null` to create a new one. */
  readonly recordId: string | null;
  /** The revision this tab believes it is replacing. */
  readonly expectedRevisionId: string | null;
  readonly name: string;
  readonly note: string | null;
  /**
   * What the record holds: a build, or a loadout.
   *
   * The service never looks inside it. Naming, the revision precondition and
   * the lock protocol are the same protocol for both tools, so the payload
   * passes straight through to the serializer's allowlist (013
   * contracts/loadout-persistence.md).
   */
  readonly payload: RecordPayload;
  /** The instant to stamp. Passed in so the service stays clock-free. */
  readonly now: string;
}

/** How a named write ended. */
export type NamedSaveResult =
  | { readonly kind: 'saved'; readonly record: LocalRecord }
  | {
      readonly kind: 'conflict';
      readonly recordId: string;
      readonly expectedRevisionId: string | null;
      readonly observed: LocalRecord;
    }
  | { readonly kind: 'failed'; readonly code: StorageFailureCode }
  | { readonly kind: 'locks-unavailable' }
  | { readonly kind: 'missing' };

/**
 * Named saves, renames and deletes — the writes two tabs can collide over.
 *
 * Web Storage has no compare-and-swap, so the protection is two things
 * together: a short exclusive lock that keeps two pages out of each other's
 * read-then-write window, and a revision precondition inside it that decides
 * whether this page is replacing the version it actually saw.
 *
 * The revision is the part that matters. The lock narrows the window; the
 * precondition is what makes a stale write a *conflict* the Commander answers
 * rather than a version that quietly disappears (FR-012).
 *
 * No dialog is ever shown while the lock is held. A lock held across a human
 * decision blocks every other page for as long as they take to make it.
 */
@Injectable({ providedIn: 'root' })
export class NamedRecordService {
  readonly #records = inject(LocalRecordRepository);
  readonly #locks = inject(WebLocksAdapter);
  readonly #uuid = inject(UuidAdapter);
  readonly #sync = inject(RecordSynchronisationStore);

  /** Whether an in-place replacement can be made safely in this browser. */
  get canOverwrite(): boolean {
    return this.#locks.available;
  }

  /** Creates a new named record. Never replaces anything. */
  async createNamed(
    request: Omit<NamedSaveRequest, 'recordId' | 'expectedRevisionId'>,
  ): Promise<NamedSaveResult> {
    const id = this.#uuid.create();
    const record = {
      id,
      kind: 'named' as const,
      revisionId: this.#uuid.create(),
      createdAt: request.now,
      modifiedAt: request.now,
      name: request.name,
      note: request.note,
      sourceNamed: null,
      payload: request.payload,
    };

    const written = this.#records.write(record);
    if (!written.ok) {
      return { kind: 'failed', code: written.code };
    }

    const read = this.#records.open(id);
    return read.ok && read.value !== null
      ? this.#synchronised({ kind: 'saved', record: read.value.record })
      : { kind: 'failed', code: 'failed' };
  }

  /**
   * Names the unnamed record the build is already in, in place.
   *
   * This is the ordinary manual save of an autosaved build, and it is a
   * promotion rather than a copy: the same key gains a name and flips `kind`
   * to `named` under its own lock, with a fresh revision and the instant of the
   * save. Nothing is left behind, because there was never a second record —
   * which is what stops a Commander who saves their work from finding it listed
   * twice (persistence contract, "Autosaved records"; FR-008).
   *
   * Two things can have happened while the dialog was open: the record can have
   * been deleted somewhere else, and it can have been named somewhere else.
   * Neither refuses the save. Both mint a fresh named record instead, because
   * the Commander asked for this build to be saved and promoting a record that
   * is now someone else's save would replace a version nobody asked to replace.
   */
  async nameHeldRecord(
    request: Omit<NamedSaveRequest, 'expectedRevisionId'> & { recordId: string },
  ): Promise<NamedSaveResult> {
    if (!this.#locks.available) {
      // Without a lock, promoting in place is still an unprotected
      // read-then-write. Minting and then consuming reaches the same end state
      // under a new identity, and never has a moment with no copy of the build.
      return this.#mintThenConsume(request);
    }

    try {
      const promoted = await this.#locks.request(recordLockName(request.recordId), async () =>
        this.#promoteIfUnnamed(request),
      );
      return promoted ?? this.#mintThenConsume(request);
    } catch (error) {
      return error instanceof LocksUnavailableError
        ? this.#mintThenConsume(request)
        : { kind: 'failed', code: 'failed' };
    }
  }

  /**
   * Replaces an existing named record, if it is still the revision this tab saw.
   *
   * Without a lock this is refused outright rather than attempted: an
   * unprotected read-then-write is exactly how one tab's version disappears,
   * and keep-both remains available to a Commander who needs to save anyway.
   *
   * `consumes` names the unnamed record these edits were autosaved into, when
   * there is one. It is removed only after the named write has succeeded, in
   * that order and never the other way round: a write that fails leaves the
   * build in the record it was already recoverable from (persistence contract,
   * "Autosaved records").
   */
  async overwriteNamed(
    request: NamedSaveRequest & { recordId: string },
    consumes: string | null = null,
  ): Promise<NamedSaveResult> {
    if (!this.#locks.available) {
      return { kind: 'locks-unavailable' };
    }

    try {
      const result = await this.#locks.request(recordLockName(request.recordId), async () =>
        this.#writeIfCurrent(request),
      );
      if (result.kind === 'saved') {
        this.#consume(consumes, result.record.id);
      }
      return result;
    } catch (error) {
      return error instanceof LocksUnavailableError
        ? { kind: 'locks-unavailable' }
        : { kind: 'failed', code: 'failed' };
    }
  }

  /** Removes one record. Only ever called after an explicit confirmation. */
  async remove(recordId: string): Promise<NamedSaveResult> {
    const removed = this.#records.remove(recordId);
    if (!removed.ok) {
      return { kind: 'failed', code: removed.code };
    }
    // Deleting a synchronised record deletes the remote one. Nothing is queued
    // while the browser is anonymous, and the local removal has already
    // happened whatever the network does (020/FR-010, 020/FR-011).
    void this.#sync.recordDeleted(recordId);
    return { kind: 'missing' };
  }

  /**
   * Promotes one unnamed record, or reports that there was nothing to promote.
   *
   * `null` means "not an unnamed record any more" — absent, unreadable, or
   * named while the dialog was open — and is the caller's signal to mint. It is
   * deliberately not a failure: nothing has been lost, and the build still has
   * to be saved.
   */
  #promoteIfUnnamed(
    request: Omit<NamedSaveRequest, 'expectedRevisionId'> & { recordId: string },
  ): NamedSaveResult | null {
    const current = this.#records.open(request.recordId);
    if (!current.ok || current.value === null) {
      return null;
    }

    const observed = current.value.record;
    if (observed.kind === 'named') {
      return null;
    }

    const written = this.#records.write({
      id: request.recordId,
      kind: 'named',
      revisionId: this.#uuid.create(),
      // The record keeps the instant it was first written. A Commander naming
      // an hour of work has not created it just now.
      createdAt: observed.createdAt,
      modifiedAt: request.now,
      name: request.name,
      note: request.note,
      sourceNamed: observed.sourceNamed,
      payload: request.payload,
    });
    if (!written.ok) {
      return { kind: 'failed', code: written.code };
    }

    const reread = this.#records.open(request.recordId);
    return reread.ok && reread.value !== null
      ? this.#synchronised({ kind: 'saved', record: reread.value.record })
      : { kind: 'failed', code: 'failed' };
  }

  /** Creates the named record, then removes the unnamed one it replaces. */
  async #mintThenConsume(
    request: Omit<NamedSaveRequest, 'expectedRevisionId'> & { recordId: string },
  ): Promise<NamedSaveResult> {
    const created = await this.createNamed({
      name: request.name,
      note: request.note,
      payload: request.payload,
      now: request.now,
    });
    if (created.kind === 'saved') {
      this.#consume(request.recordId, created.record.id);
    }
    return created;
  }

  /**
   * Removes the unnamed record a successful save has replaced.
   *
   * Only ever an unnamed one, checked against the stored bytes rather than
   * against what the page believes it is holding: a record named in another tab
   * while this save was being made is that tab's save now, and consuming it
   * would delete a version nobody asked to remove.
   *
   * A removal that fails is not reported: the build is already stored under the
   * name the Commander gave it, and an entry left behind expires on its own
   * (FR-013). Telling them their save failed would be untrue.
   */
  #consume(recordId: string | null, savedInto: string): void {
    if (recordId === null || recordId === savedInto || this.#records.isNamed(recordId)) {
      return;
    }
    if (this.#records.remove(recordId).ok) {
      // The record the save replaced is gone from this browser, so the account
      // stops holding it too (020/FR-010).
      void this.#sync.recordDeleted(recordId);
    }
  }

  /** The read-check-write that runs inside the lock. */
  #writeIfCurrent(request: NamedSaveRequest & { recordId: string }): NamedSaveResult {
    const current = this.#records.open(request.recordId);
    if (!current.ok) {
      return { kind: 'failed', code: current.code };
    }
    if (current.value === null) {
      return { kind: 'missing' };
    }

    const observed = current.value.record;
    if (request.expectedRevisionId !== null && observed.revisionId !== request.expectedRevisionId) {
      return {
        kind: 'conflict',
        recordId: request.recordId,
        expectedRevisionId: request.expectedRevisionId,
        observed,
      };
    }

    const written = this.#records.write({
      id: request.recordId,
      kind: 'named',
      // A fresh revision per successful write, so another tab's stale
      // precondition can never match by coincidence.
      revisionId: this.#uuid.create(),
      createdAt: observed.createdAt,
      modifiedAt: request.now,
      name: request.name,
      note: request.note,
      sourceNamed: observed.sourceNamed,
      payload: request.payload,
    });
    if (!written.ok) {
      return { kind: 'failed', code: written.code };
    }

    const reread = this.#records.open(request.recordId);
    return reread.ok && reread.value !== null
      ? this.#synchronised({ kind: 'saved', record: reread.value.record })
      : { kind: 'failed', code: 'failed' };
  }

  /**
   * Offers a record browser storage has just accepted to the account.
   *
   * Every named write passes through here, and only after the bytes are stored:
   * a record the browser has not persisted may not enter a request, and a
   * fragment, a SLEF document and a journal line never become one at all
   * (020/FR-007, 020/FR-012, 020/FR-021).
   *
   * Nothing here waits on the network, and nothing here is queued while the
   * browser is anonymous (020/FR-011).
   */
  #synchronised(result: NamedSaveResult & { kind: 'saved' }): NamedSaveResult {
    void this.#sync.recordSaved(result.record.id);
    return result;
  }
}
