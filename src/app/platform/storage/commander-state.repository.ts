import { Injectable, inject } from '@angular/core';
import {
  emptyCommanderLocalState,
  parseCommanderLocalState,
  withPendingOperation,
  withRecordBound,
  withRecordForgotten,
  withRecordLocalOnly,
  withSynchronisationCommitted,
  type CachedCommanderAccount,
  type CommanderLocalState,
  type PendingRemoteOperation,
  type SynchronisationCommit,
} from '../../domain/commander/commander-local-state';
import { EDNB_COMMANDER_STATE_KEY } from './storage-keys';
import { LOCAL_STORAGE_PORT, type StorageFailureCode } from './web-storage.port';

export type CommanderStateWriteResult =
  { readonly ok: true } | { readonly ok: false; readonly code: StorageFailureCode };

/**
 * The account side of browser storage, as one value under one key.
 *
 * Every change is read, changed and written whole, so a value that fails to
 * write leaves the previous one intact. What decides a record's account — its
 * binding, the remote revision it accepted, the operations waiting to be sent
 * and the account cursor — is in that one value together, which is what lets a
 * complete response commit at once (020/FR-026).
 *
 * Notes and device claim identities are not here and are not sent. They belong
 * to the record's own key and to the live page (020/FR-007).
 */
@Injectable({ providedIn: 'root' })
export class CommanderStateRepository {
  readonly #storage = inject(LOCAL_STORAGE_PORT);

  read(): CommanderLocalState {
    const result = this.#storage.read(EDNB_COMMANDER_STATE_KEY);
    if (!result.ok || result.value === null) {
      return emptyCommanderLocalState();
    }
    try {
      return parseCommanderLocalState(JSON.parse(result.value)) ?? emptyCommanderLocalState();
    } catch {
      return emptyCommanderLocalState();
    }
  }

  storeAccount(account: CachedCommanderAccount): CommanderStateWriteResult {
    return this.#write({ ...this.read(), account });
  }

  clearSession(): CommanderStateWriteResult {
    // The session ends; the account's records, cursor and queued work stay, so
    // the same Commander signing in again carries on where they stopped.
    return this.#write({ ...this.read(), account: null, fleetCache: [] });
  }

  prepareAccountDeletion(): CommanderStateWriteResult {
    const current = this.read();
    return this.#write({
      ...current,
      account: null,
      fleetCache: [],
      accountCursors: {},
      pendingOperations: [],
      recordBindings: Object.fromEntries(
        Object.keys(current.recordBindings).map((recordId) => [recordId, 'local-only']),
      ),
      recordRevisions: {},
    });
  }

  /** Binds one record to the signed-in Commander. */
  bindRecord(recordId: string, customerId: string): CommanderStateWriteResult {
    return this.#write(withRecordBound(this.read(), recordId, customerId));
  }

  /** Marks one record local-only and clears what it had queued. */
  markRecordLocalOnly(recordId: string): CommanderStateWriteResult {
    return this.#write(withRecordLocalOnly(this.read(), recordId));
  }

  /** Drops what this browser knew about one record's remote copy. */
  forgetRecord(recordId: string): CommanderStateWriteResult {
    return this.#write(withRecordForgotten(this.read(), recordId));
  }

  /** Queues one remote operation, so a change made offline survives a reload. */
  queueOperation(operation: PendingRemoteOperation): CommanderStateWriteResult {
    return this.#write(withPendingOperation(this.read(), operation));
  }

  /**
   * Commits one complete synchronisation response.
   *
   * The cursor advances and the answered operations go in this write and no
   * earlier one. A write that fails leaves both where they were, and the
   * service answers the retry as a no-op (020/FR-026).
   */
  commitSynchronisation(commit: SynchronisationCommit): CommanderStateWriteResult {
    return this.#write(withSynchronisationCommitted(this.read(), commit));
  }

  #write(value: CommanderLocalState): CommanderStateWriteResult {
    const result = this.#storage.write(EDNB_COMMANDER_STATE_KEY, JSON.stringify(value));
    return result.ok ? { ok: true } : result;
  }
}
