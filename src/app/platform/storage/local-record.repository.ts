import { Injectable, inject, signal } from '@angular/core';
import { decodeAndMigrate } from '../../domain/ships/build/record-migrations';
import {
  serializeLocalRecord,
  type RecordDraft,
} from '../../domain/records/local-record.serializer';
import {
  isEquipmentRecord,
  isShipRecord,
  type LocalRecord,
  type RecordTool,
  type StoredRecordEntry,
} from '../../domain/records/local-record';
import { EDNB_RECORD_KEY_PREFIX, recordIdFromKey, recordKey } from './storage-keys';
import { LOCAL_STORAGE_PORT, type StorageFailureCode } from './web-storage.port';

/** How a record operation ended. */
export type RepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StorageFailureCode };

/** One record read back, with whether it had to be migrated to be readable. */
export interface ReadRecord {
  readonly record: LocalRecord;
  readonly migrated: boolean;
}

/**
 * Every local record, one key at a time.
 *
 * Three decisions shape this, all of them about not losing a Commander's work:
 *
 *   * **one key per record, no index.** An index plus a record is two writes
 *     that can tear apart, and an autosave would rewrite the index — and so
 *     every build's neighbour — on every keystroke;
 *   * **serialize completely, then write once.** `setItem` replaces one value
 *     atomically, so a failure leaves the previous bytes intact rather than
 *     half of the new ones;
 *   * **validate every record independently.** One unreadable record must not
 *     make its neighbours unopenable, so listing decodes each on its own and
 *     reports the failures as entries rather than throwing them.
 */
@Injectable({ providedIn: 'root' })
export class LocalRecordRepository {
  readonly #storage = inject(LOCAL_STORAGE_PORT);

  /**
   * Counts the record writes and removals this page has made.
   *
   * Storage stays the authority on what is stored, so nothing here caches a
   * listing. This says only that one moved, which is what lets a screen that
   * counts records rather than drawing them read again after a save or a
   * deletion made anywhere in this page. Another page's writes are not counted
   * here: they arrive as invalidations, which `RecordInvalidationService`
   * publishes.
   */
  readonly #revision = signal(0);

  readonly revision = this.#revision.asReadonly();

  /** Whether the browser is letting this application store anything at all. */
  available(): boolean {
    return this.#storage.keys(EDNB_RECORD_KEY_PREFIX).ok;
  }

  /**
   * Every owned record, readable or not.
   *
   * Unreadable ones are listed rather than hidden: a Commander whose build
   * cannot be opened is better served by seeing it there, untouched, than by
   * watching it silently vanish (persistence contract, "Failure behavior").
   */
  list(): RepositoryResult<readonly StoredRecordEntry[]> {
    const keys = this.#storage.keys(EDNB_RECORD_KEY_PREFIX);
    if (!keys.ok) {
      return keys;
    }

    const entries: StoredRecordEntry[] = [];
    for (const key of keys.value) {
      const id = recordIdFromKey(key);
      if (id === null) {
        continue;
      }
      const read = this.read(id);
      if (!read.ok) {
        continue;
      }
      entries.push(read.value);
    }

    return { ok: true, value: entries };
  }

  /**
   * The identity of every record this browser holds.
   *
   * Read from the keys alone. What asks for it — account deletion — needs to
   * know which records are retained and nothing about their content, and
   * decoding every one of them to answer that would read a Commander's whole
   * library to count it (020/FR-024).
   */
  ids(): RepositoryResult<readonly string[]> {
    const keys = this.#storage.keys(EDNB_RECORD_KEY_PREFIX);
    if (!keys.ok) {
      return keys;
    }
    const ids = keys.value
      .map((key) => recordIdFromKey(key))
      .filter((id): id is string => id !== null);
    return { ok: true, value: ids };
  }

  /** One record by identity, decoded and migrated as far as it can be. */
  read(id: string): RepositoryResult<StoredRecordEntry> {
    const raw = this.#storage.read(recordKey(id));
    if (!raw.ok) {
      return raw;
    }
    if (raw.value === null) {
      return {
        ok: true,
        value: {
          available: false,
          id,
          reason: 'malformed',
          tool: null,
          hullSymbol: null,
          suitFamily: null,
          name: null,
        },
      };
    }

    return { ok: true, value: decodeEntry(id, raw.value) };
  }

  /** One record, only if it is fully readable. */
  open(id: string): RepositoryResult<ReadRecord | null> {
    const raw = this.#storage.read(recordKey(id));
    if (!raw.ok) {
      return raw;
    }
    if (raw.value === null) {
      return { ok: true, value: null };
    }

    const decoded = decodeAndMigrate(parseJson(raw.value), id);
    return decoded.ok
      ? { ok: true, value: { record: decoded.record, migrated: decoded.migrated } }
      : { ok: true, value: null };
  }

  /**
   * Whether the record under this id is one the Commander has named.
   *
   * Answered from the stored bytes, not from what any page believes it holds,
   * so a record named in another tab is named here too. What that is asked for
   * is `NamedRecordService`'s consuming of the record a save replaced.
   *
   * An unreadable or absent record answers `false`. It is not a named record,
   * and refusing to write on the strength of bytes that cannot be decoded would
   * make one corrupt entry stop a Commander saving anything at all.
   */
  isNamed(recordId: string): boolean {
    const opened = this.open(recordId);
    return opened.ok && opened.value !== null && opened.value.record.kind === 'named';
  }

  /**
   * The unnamed record already holding exactly this stored state, if there is
   * one.
   *
   * The comparison is the serialized payload — the same value the baseline
   * fingerprint uses — so "identical" means what a Commander would mean by it
   * and not what two object references would. Named records are excluded
   * because taking one over would make autosave write to it.
   *
   * The tool is asked for rather than inferred. A fingerprint is a build's or a
   * loadout's, the two hold different content, and a record of the other tool is
   * never a match: asking would compare a loadout to something that has none.
   *
   * Ties go to the oldest entry, so repeating an ingress lands on the record a
   * Commander has had longest rather than shuffling between duplicates.
   */
  findUnnamedMatching(fingerprint: string, tool: RecordTool): string | null {
    const listed = this.list();
    if (!listed.ok) {
      return null;
    }

    const matches = listed.value
      .filter((entry) => entry.available && entry.record.kind === 'working')
      .map((entry) => (entry.available ? entry.record : null))
      .filter((record): record is LocalRecord => record !== null)
      .filter((record) =>
        tool === 'ship'
          ? isShipRecord(record) && JSON.stringify(record.build) === fingerprint
          : isEquipmentRecord(record) && JSON.stringify(record.loadout) === fingerprint,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return matches[0]?.id ?? null;
  }

  /**
   * Writes one record as a single value.
   *
   * The whole record is serialized before storage is touched, so a serializer
   * that throws cannot leave a partial value behind.
   */
  write(draft: RecordDraft): RepositoryResult<void> {
    const json = serializeLocalRecord(draft);
    return this.#announce(this.#storage.write(recordKey(draft.id), json));
  }

  /** Removes one record. Only ever called after an explicit confirmation. */
  remove(id: string): RepositoryResult<void> {
    return this.#announce(this.#storage.remove(recordKey(id)));
  }

  /** Counts a change that landed, and passes its result back unchanged. */
  #announce(result: RepositoryResult<void>): RepositoryResult<void> {
    if (result.ok) {
      this.#revision.update((revision) => revision + 1);
    }
    return result;
  }
}

/** Decodes one stored value into a listing entry, never throwing. */
function decodeEntry(id: string, raw: string): StoredRecordEntry {
  const decoded = decodeAndMigrate(parseJson(raw), id);

  if (decoded.ok) {
    return { available: true, record: decoded.record };
  }
  return {
    available: false,
    id,
    reason: decoded.reason,
    tool: decoded.tool,
    hullSymbol: decoded.hullSymbol,
    suitFamily: decoded.suitFamily,
    name: decoded.name,
  };
}

/** `undefined` for anything that is not JSON at all, which decoding rejects. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
