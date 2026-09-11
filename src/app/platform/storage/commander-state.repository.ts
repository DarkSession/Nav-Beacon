import { Injectable, inject } from '@angular/core';
import {
  emptyCommanderLocalState,
  parseCommanderLocalState,
  type CachedCommanderAccount,
  type CommanderLocalState,
} from '../../domain/commander/commander-local-state';
import { EDNB_COMMANDER_STATE_KEY } from './storage-keys';
import { LOCAL_STORAGE_PORT, type StorageFailureCode } from './web-storage.port';

export type CommanderStateWriteResult =
  { readonly ok: true } | { readonly ok: false; readonly code: StorageFailureCode };

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
    return this.#write({ ...this.read(), account: null, fleetCache: [] });
  }

  prepareAccountDeletion(): CommanderStateWriteResult {
    const current = this.read();
    return this.#write({
      ...current,
      account: null,
      fleetCache: [],
      syncRevision: 0,
      pendingOperationIds: [],
      recordBindings: Object.fromEntries(
        Object.keys(current.recordBindings).map((recordId) => [recordId, 'local-only']),
      ),
    });
  }

  #write(value: CommanderLocalState): CommanderStateWriteResult {
    const result = this.#storage.write(EDNB_COMMANDER_STATE_KEY, JSON.stringify(value));
    return result.ok ? { ok: true } : result;
  }
}
