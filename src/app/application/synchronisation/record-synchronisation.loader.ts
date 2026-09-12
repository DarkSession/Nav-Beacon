import { Injectable, Injector, effect, inject } from '@angular/core';
import {
  canSynchroniseRecord,
  remoteRevisionOf,
  type PendingOperationKind,
} from '../../domain/commander/commander-local-state';
import type { ConflictResolution } from '../../domain/commander/record-conflict';
import { ClockAdapter } from '../../platform/browser/clock.adapter';
import { UuidAdapter } from '../../platform/browser/uuid.adapter';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { AccountStore } from '../account/account.store';
import { PausedRecords } from './paused-records';
import type { RecordSynchronisationCoordinator } from './record-synchronisation.coordinator';
import type { RecordSynchronisationStore } from './record-synchronisation.store';

/** The engine's two halves, once its code has arrived. */
interface RecordSynchronisationEngine {
  readonly store: RecordSynchronisationStore;
  readonly coordinator: RecordSynchronisationCoordinator;
}

/**
 * The synchronisation engine, reached without carrying it in the first payload.
 *
 * Every answer here is the store's own and the coordinator's own, unchanged.
 * What this adds is when the code behind them arrives, and the one write that
 * cannot wait for it: a record path that changes a record while the engine's
 * chunk is still on its way queues what that owes the account here
 * (020/FR-011). The engine is the rules
 * for every record an account holds — the batch plan, the conflict answers, the
 * remote record format and the local state they are committed against — and it
 * is reached from the shell rather than from a screen, so importing it puts all
 * of that in the first payload of every page.
 *
 * It arrives with the session instead. Nothing here queues, sends or exchanges
 * anything while the browser is anonymous, because an anonymous tool needs no
 * account (constitution I, 020/FR-007) — so an anonymous page never fetches the
 * engine at all, and a Commander who signs in pays for it once, from whatever
 * page they signed in on. That is the shape `build-link-codec-loader.ts` and
 * `build/build-snapshot.reconstructor-loader.ts` already use.
 *
 * The account dialog is the opposite case and stays eager (`app.html`): it is
 * where a refused sign-in and an expired session are stated, which are the
 * moments the network is the thing that failed. The engine has nothing to say
 * at that moment, and it has a session to work with only because the network
 * answered.
 *
 * One part of the engine's surface is synchronous, and it is not here but in
 * `PausedRecords`, which the store writes into and every autosave reads.
 */
@Injectable({ providedIn: 'root' })
export class RecordSynchronisationLoader {
  readonly #account = inject(AccountStore);
  readonly #paused = inject(PausedRecords);
  readonly #state = inject(CommanderStateRepository);
  readonly #uuid = inject(UuidAdapter);
  readonly #clock = inject(ClockAdapter);
  readonly #injector = inject(Injector);

  /** The engine, from the first thing that asked for it. */
  #engine: Promise<RecordSynchronisationEngine | null> | null = null;
  /** The engine once it is here, so a caller can tell without waiting for it. */
  #here: RecordSynchronisationEngine | null = null;
  /** Whether the application has asked for the renewal watch. */
  #wanted = false;
  /** How the engine's own watch stops, once one is running. */
  #stopWatch: (() => void) | null = null;

  /**
   * The records whose autosave is held.
   *
   * Read while an autosave decides whether to write, so it is answered from the
   * eager holder rather than from a chunk that may still be on its way
   * (020/FR-010).
   */
  readonly pausedRecords = this.#paused.records;

  /**
   * Brings the engine in for the account the session belongs to.
   *
   * Watched as a signal rather than asked once, because a Commander signs in
   * from whatever page they are on: the first merge belongs to the account
   * becoming signed in, so the engine follows the credentials rather than a
   * screen (020/FR-008). The coordinator's renewal watch starts with it, for
   * as long as the page is live (020/FR-025).
   *
   * Returns an unsubscribe, as the watch it starts does: the application runs
   * one of these for the life of the page, and a second one would put every
   * renewal twice.
   */
  start(): () => void {
    this.#wanted = true;
    const watcher = effect(
      () => {
        if (this.#account.credentials() !== null) {
          void this.#reach();
        }
      },
      { injector: this.#injector },
    );

    return () => {
      watcher.destroy();
      this.#wanted = false;
      this.#stopWatch?.();
      this.#stopWatch = null;
    };
  }

  /** One record written to browser storage, offered to the account. */
  async recordSaved(recordId: string): Promise<void> {
    await this.#changed(recordId, 'upload', (engine) => engine.store.recordSaved(recordId));
  }

  /** One record deleted from browser storage, offered to the account. */
  async recordDeleted(recordId: string): Promise<void> {
    await this.#changed(recordId, 'delete', (engine) => engine.store.recordDeleted(recordId));
  }

  /**
   * One changed record, offered to the account whether the engine is here yet.
   *
   * Where the engine is already here it queues the change itself, with its own
   * rules around it, and this waits for it.
   *
   * Where it is not, the change is queued first. Queueing is one write to
   * browser storage and needs no engine, and the engine is a chunk that can
   * fail to arrive: a change that waited for it would leave the record altered
   * here with nothing at all waiting to offer it, and nothing rescans browser
   * storage later (020/FR-011, 020/FR-026). The engine then takes up what is
   * already queued rather than queueing it a second time, which would put two
   * revisions in the account for one save.
   */
  async #changed(
    recordId: string,
    kind: PendingOperationKind,
    offer: (engine: RecordSynchronisationEngine) => Promise<void>,
  ): Promise<void> {
    const queued = this.#here === null && this.#queue(recordId, kind);
    const engine = await this.#session();
    if (engine === null) {
      return;
    }
    await (queued ? engine.store.changeQueued(recordId) : offer(engine));
  }

  /**
   * Writes one change to the queue, without the engine.
   *
   * An anonymous browser queues nothing, because an anonymous tool needs no
   * account, and neither does a record this account may not take (constitution
   * I, 020/FR-007, 020/FR-024).
   */
  #queue(recordId: string, kind: PendingOperationKind): boolean {
    const credentials = this.#account.credentials();
    if (credentials === null) {
      return false;
    }
    const state = this.#state.read();
    if (!canSynchroniseRecord(state, recordId, credentials.customerId)) {
      return false;
    }
    this.#state.queueOperation({
      id: this.#uuid.create(),
      customerId: credentials.customerId,
      recordId,
      kind,
      baseRevision: remoteRevisionOf(state, recordId),
      queuedAt: this.#clock.timestamp(),
    });
    return true;
  }

  /**
   * A live page resuming its own autosave after a deletion conflict.
   *
   * The hold is lifted here and at once, because the page writes the moment it
   * asks: a resume that waited for the engine to arrive would answer the
   * Commander's explicit request by writing nothing at all. The engine then
   * puts the work back under the same identity, at a revision newer than the
   * deletion marker (020/FR-010).
   *
   * An anonymous page resuming simply writes again, which is what the unknown
   * answer says: there is no account to put the work back into.
   */
  async resumeRecord(recordId: string): Promise<ConflictResolution> {
    this.#paused.release(recordId);
    const engine = await this.#session();
    return engine === null ? { kind: 'unknown' } : engine.store.resumeRecord(recordId);
  }

  /** The engine, where there is a session for it to exchange with. */
  async #session(): Promise<RecordSynchronisationEngine | null> {
    return this.#account.credentials() === null ? null : this.#reach();
  }

  #reach(): Promise<RecordSynchronisationEngine | null> {
    this.#engine ??= this.#load().catch(() => {
      // The chunk did not arrive, so nothing was exchanged. What the triggers
      // above queued is already in browser storage, the cursor stays where it
      // was, and the next trigger asks for the engine again (020/FR-011,
      // 020/FR-026).
      this.#engine = null;
      return null;
    });
    return this.#engine;
  }

  /**
   * Both halves at once, and the watch they carry.
   *
   * The store holds the rules and the coordinator holds the timer, the session
   * lifecycle and the one conflict answer a live page owes. A page that has the
   * engine has both, so the watch starts here rather than only from the
   * application's own initializer: an engine that arrived after a failed load
   * is still a live page owing its open records a renewal (020/FR-025).
   */
  async #load(): Promise<RecordSynchronisationEngine> {
    const [store, coordinator] = await Promise.all([
      import('./record-synchronisation.store'),
      import('./record-synchronisation.coordinator'),
    ]);
    const engine: RecordSynchronisationEngine = {
      store: this.#injector.get(store.RecordSynchronisationStore),
      coordinator: this.#injector.get(coordinator.RecordSynchronisationCoordinator),
    };
    this.#here = engine;
    if (this.#wanted && this.#stopWatch === null) {
      this.#stopWatch = engine.coordinator.start();
    }
    return engine;
  }
}
