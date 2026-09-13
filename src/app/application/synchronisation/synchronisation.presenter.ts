import { Injectable, computed, inject } from '@angular/core';
import {
  accountCursor,
  type RecordAccountBinding,
} from '../../domain/commander/commander-local-state';
import type { ConflictChoice, RecordConflict } from '../../domain/commander/record-conflict';
import { Formatters } from '../../i18n/formatters/formatters';
import type { MessageKey } from '../../i18n/locale-registry';
import { MessageService } from '../../i18n/message.service';
import { CommanderStateRepository } from '../../platform/storage/commander-state.repository';
import { LocalRecordRepository } from '../../platform/storage/local-record.repository';
import type { StatusTone } from '../../ui/components/status/status-notice';
import { AccountStore } from '../account/account.store';
import type { ExceededBound, SynchronisationFailure } from './record-synchronisation.store';
import { RecordSynchronisationStore } from './record-synchronisation.store';

/** One answer a Commander can give to a record conflict. */
export interface ConflictAnswer {
  readonly choice: ConflictChoice;
  readonly label: string;
  readonly emphasis: 'primary' | 'secondary' | 'danger';
}

/** The layer that asks about one record the account and this browser disagree on. */
export interface ConflictView {
  readonly recordId: string;
  readonly title: string;
  readonly description: string;
  /** Which record it is about, in the Commander's own words where they named it. */
  readonly recordLabel: string;
  readonly answers: readonly ConflictAnswer[];
  readonly dismiss: string;
}

/** One sentence about a set of records, drawn under the account's own state. */
export interface SynchronisationNote {
  readonly id: string;
  readonly tone: StatusTone;
  readonly message: string;
}

/** Everything the record library says about the account's own copy. */
export interface SynchronisationPanelView {
  readonly heading: string;
  readonly status: { readonly tone: StatusTone; readonly message: string };
  /** Supporting detail for the state, where the state has one. */
  readonly detail: string | null;
  /** The label of the explicit retry, or `null` where there is nothing to retry. */
  readonly retry: string | null;
  readonly notes: readonly SynchronisationNote[];
  readonly conflict: ConflictView | null;
}

/**
 * What the record libraries say about the Commander's account, in words.
 *
 * Ten states in one view model, so the library draws the same region whatever
 * the account is doing: where the records are, what is owed, what failed and
 * what needs an answer. A state with nothing to add to a region leaves the
 * region out rather than moving the ones around it.
 *
 * Presentation only. Every decision about what a record *is* belongs to the
 * synchronisation store below it (constitution III).
 *
 * Nothing here is carried by tone. Each sentence says what it means, and the
 * tone is a second rendering of it (011/FR-010).
 */
@Injectable({ providedIn: 'root' })
export class SynchronisationPresenter {
  readonly #messages = inject(MessageService);
  readonly #formatters = inject(Formatters);
  readonly #account = inject(AccountStore);
  readonly #sync = inject(RecordSynchronisationStore);
  readonly #state = inject(CommanderStateRepository);
  readonly #records = inject(LocalRecordRepository);

  readonly view = computed<SynchronisationPanelView>(() => {
    const status = this.#sync.status();
    const credentials = this.#account.credentials();
    const conflicts = this.#sync.conflicts();
    const held = this.#heldBack(this.#knownCustomerId());

    return {
      heading: this.#messages.message('sync.title'),
      // `inactive` is the whole of what this browser has nothing to say about:
      // an anonymous page, and a page whose Commander signed out or deleted the
      // account, which is what puts the status back. Holding no credentials is
      // not the same thing — a session the service ended leaves a failure whose
      // own cause emptied them, and that failure is the only statement of why
      // (020/FR-003, 020/FR-011).
      status: this.#statusOf(status.kind === 'inactive' ? null : status, held),
      detail: this.#detailOf(status),
      // Offered only where pressing it would exchange something. An exchange
      // needs credentials, so a retry without them is a control that does
      // nothing, and offering it would say a Commander can recover here when
      // what they have to do is sign in again (constitution IV).
      retry:
        status.kind === 'failed' && credentials !== null
          ? this.#messages.message('action.retry')
          : null,
      notes: this.#notes(held),
      conflict: conflicts.length === 0 ? null : this.#conflictView(conflicts[0]),
    };
  });

  /** Whether anything on this surface is waiting for the Commander. */
  readonly hasConflict = computed(() => this.#sync.hasConflicts());

  /**
   * Whose records these are, or `null` where this browser cannot say.
   *
   * Read from the account state rather than from the credentials, because the
   * two part company: an unreachable service empties the credentials and leaves
   * the cached account where it is, and the records bound to that account are
   * still that Commander's (020/FR-022, 020/FR-024).
   */
  readonly #knownCustomerId = computed(() => {
    const state = this.#account.state();
    return 'account' in state && state.account !== null ? state.account.customerId : null;
  });

  /**
   * Whether this browser has an account here that it could not reach.
   *
   * Read from the account state's own word for it rather than from empty
   * credentials, because several states empty those and only this one is the
   * service being unreachable. A local write that would not commit, and a
   * session the service ended, are different situations with different answers
   * (020/FR-003, 020/FR-022).
   */
  readonly #accountUnreachable = computed(() => {
    const state = this.#account.state();
    return state.kind === 'offline' && state.account !== null;
  });

  /**
   * The records on this device that this account does not hold.
   *
   * One read, because the status sentence and the notes are two statements
   * about the same set and a Commander reads them together. Counted from the
   * stored bindings, which is where a record's account state lives; the read is
   * not a signal, so it is taken again whenever the exchange state or the
   * session changes — which is when a binding can have changed (020/FR-024).
   */
  #heldBack(customerId: string | null): HeldBackRecords {
    const bindings: Readonly<Record<string, RecordAccountBinding>> =
      this.#state.read().recordBindings;
    const values = Object.values(bindings);

    return {
      localOnly: values.filter((binding) => binding === 'local-only').length,
      // Only where this browser knows whose account it has. Without a Customer
      // ID nothing here is another Commander's rather than this one's, and every
      // bound record would be counted as somebody else's — which is what a
      // Commander reads after a sign-out, when the bindings deliberately stay
      // (020/FR-003, constitution IV).
      elsewhere:
        customerId === null
          ? 0
          : values.filter((binding) => binding !== 'local-only' && binding !== customerId).length,
    };
  }

  #statusOf(
    status: ReturnType<RecordSynchronisationStore['status']> | null,
    held: HeldBackRecords,
  ): SynchronisationPanelView['status'] {
    if (status === null) {
      // A browser that knows whose records these are and could not reach the
      // account is not a browser with nobody signed in. Telling that Commander
      // to sign in states something untrue about their session and offers them
      // nothing they can do, while the frame beside this panel is drawing their
      // name (020/FR-022, constitution IV).
      if (this.#accountUnreachable()) {
        return { tone: 'warning', message: this.#messages.message('sync.status.unreachable') };
      }
      // Anonymous, or signed in with no exchange attempted yet. Both are the
      // same sentence: the records are in this browser and nowhere else
      // (020/FR-007).
      return { tone: 'info', message: this.#messages.message('sync.status.local-only') };
    }
    switch (status.kind) {
      case 'synchronising':
        return {
          tone: 'loading',
          message: this.#messages.message(
            this.#firstMerge() ? 'sync.status.merging' : 'sync.status.synchronising',
          ),
        };
      case 'current':
        return {
          tone: 'success',
          message: this.#messages.message(
            // A record kept in this browser only, and a record belonging to
            // another Commander, are both on this device and neither is in this
            // account. Saying the account has every record on this device over
            // a note that names one it does not have states two different
            // things about one library, and the sentence is the one that is
            // wrong (020/FR-011, 020/FR-024, constitution IV).
            held.localOnly + held.elsewhere > 0
              ? 'sync.status.current.partial'
              : 'sync.status.current',
            { when: this.#instant(status.at) },
          ),
        };
      case 'pending':
        return { tone: 'warning', message: this.#counted('sync.status.pending', status.changes) };
      case 'conflicted':
        return {
          tone: 'warning',
          message: this.#counted('sync.status.conflicted', status.conflicts),
        };
      case 'failed':
        return { tone: 'error', message: this.#messages.message(failureKey(status.failure)) };
      default:
        return { tone: 'info', message: this.#messages.message('sync.status.local-only') };
    }
  }

  /**
   * What is still owed, beside a failure that says why.
   *
   * A failed exchange never claims the device is current, and it says how much
   * is still waiting rather than leaving the count to be guessed (020/FR-011).
   */
  #detailOf(status: ReturnType<RecordSynchronisationStore['status']>): string | null {
    if (status.kind !== 'failed' || status.changes === 0) {
      return null;
    }
    return this.#counted('sync.status.failed.pending', status.changes);
  }

  /** Whether the account has never accepted a response in this browser. */
  #firstMerge(): boolean {
    const customerId = this.#account.credentials()?.customerId ?? null;
    return customerId !== null && accountCursor(this.#state.read(), customerId) === 0;
  }

  /**
   * The sentences about sets of records, rather than about the exchange.
   *
   * The two counts arrive already taken, because the status sentence above them
   * is decided by the same two and the panel must not state one set twice
   * (020/FR-024).
   */
  #notes(held: HeldBackRecords): readonly SynchronisationNote[] {
    const notes: SynchronisationNote[] = [];

    if (held.localOnly > 0) {
      notes.push({
        id: 'local-only',
        tone: 'info',
        message: this.#counted('sync.note.local-only', held.localOnly),
      });
    }

    if (held.elsewhere > 0) {
      notes.push({
        id: 'account-bound',
        tone: 'info',
        message: this.#counted('sync.note.account-bound', held.elsewhere),
      });
    }

    const unreadable = this.#sync.unreadable().length;
    if (unreadable > 0) {
      notes.push({
        id: 'unsupported-version',
        tone: 'warning',
        message: this.#counted('sync.note.unsupported-version', unreadable),
      });
    }

    return notes;
  }

  #conflictView(conflict: RecordConflict): ConflictView {
    const deletion = conflict.kind === 'remote-deletion';
    return {
      recordId: conflict.recordId,
      title: this.#messages.message(
        deletion ? 'sync.conflict.deleted.title' : 'sync.conflict.stale.title',
      ),
      description: this.#messages.message(
        deletion ? 'sync.conflict.deleted.description' : 'sync.conflict.stale.description',
      ),
      recordLabel: this.#messages.message('sync.conflict.record', {
        name: this.#recordName(conflict.recordId),
      }),
      answers: [
        {
          choice: 'overwrite',
          label: this.#messages.message('sync.conflict.overwrite'),
          emphasis: 'primary',
        },
        {
          choice: 'keep-both',
          label: this.#messages.message('sync.conflict.keep-both'),
          emphasis: 'secondary',
        },
        {
          choice: 'cancel',
          label: this.#messages.message('sync.conflict.cancel'),
          emphasis: 'secondary',
        },
      ],
      dismiss: this.#messages.message('action.close'),
    };
  }

  /** The Commander's own name for the record, or what an unnamed one is called. */
  #recordName(recordId: string): string {
    const opened = this.#records.open(recordId);
    const name = opened.ok ? (opened.value?.record.name ?? null) : null;
    return name ?? this.#messages.message('library.record.unnamed');
  }

  /**
   * One of a sentence's two forms, chosen by the count it carries.
   *
   * Every one of these counts is a filtered length with no bound, so a single
   * form would read "2 record is kept in this browser only" to the second
   * record a Commander keeps. The two catalogues carry `.one` and `.many` for
   * each, as every other counted sentence in the application does, and the
   * singular form spells the one out rather than interpolating it
   * (constitution VI).
   */
  #counted(stem: CountedMessageStem, count: number): string {
    return count === 1
      ? this.#messages.message(`${stem}.one`)
      : this.#messages.message(`${stem}.many`, { count: this.#formatters.integer(count) });
  }

  /**
   * One stored instant, as a Commander reads it.
   *
   * A value this browser cannot read stands as it is rather than being replaced
   * by the current moment. The sentence it goes into says when the account last
   * confirmed this device, and printing now in its place would state a
   * confirmation that did not happen then (constitution IV).
   */
  #instant(iso: string): string {
    const parsed = new Date(iso);
    return Number.isFinite(parsed.getTime()) ? this.#formatters.dateTime(parsed) : iso;
  }
}

/**
 * A counted sentence, named without the form: both `<stem>.one` and
 * `<stem>.many` are keys of the catalogue, and which is read depends on the
 * count.
 */
type PairedStem<Key, All> = Key extends `${infer Stem}.one`
  ? `${Stem}.many` extends All
    ? Stem
    : never
  : never;

/** The records on this device that the account does not hold. */
interface HeldBackRecords {
  /** Kept in this browser only, by an answered conflict or a refused identity. */
  readonly localOnly: number;
  /** Bound to a Commander account other than the one signed in here. */
  readonly elsewhere: number;
}

type CountedMessageStem = PairedStem<MessageKey, MessageKey>;

/**
 * The sentence for each published bound, named by the bound the service refused
 * on.
 *
 * Three bounds are published and the service says which one it stopped at, so
 * one sentence for all three would tell a Commander whose batch was too long
 * that a record of theirs is too large — a statement about their own data that
 * is not true (020/FR-026, constitution IV). A table rather than a `switch`,
 * because a fourth bound then fails to compile here rather than reaching a
 * Commander as whichever sentence a `default` happened to hold.
 */
const BOUND_KEYS: Readonly<Record<ExceededBound, MessageKey>> = {
  'record-too-large': 'sync.status.failed.bound.record',
  'too-many-changes': 'sync.status.failed.bound.changes',
  'request-too-large': 'sync.status.failed.bound.request',
};

/** Why one exchange did not leave this browser current, as a message key. */
function failureKey(failure: SynchronisationFailure): MessageKey {
  switch (failure.reason) {
    case 'offline':
      return 'sync.status.failed.offline';
    case 'signed-out':
      return 'sync.status.failed.signed-out';
    case 'storage':
      return 'sync.status.failed.storage';
    case 'refused':
      return 'sync.status.failed.refused';
    case 'bound':
      return BOUND_KEYS[failure.bound];
    default:
      return 'sync.status.failed.service';
  }
}
