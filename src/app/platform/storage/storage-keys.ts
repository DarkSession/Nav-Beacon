/**
 * The browser key space this application owns.
 *
 * Everything the application writes to a browser store is named here, so "what
 * belongs to us" is one list rather than a set of string literals scattered
 * across repositories. Enumeration filters on these prefixes: a key this
 * application did not write is never read, migrated, repaired or removed, even
 * when it looks like one of ours (persistence contract, "Ownership and key
 * space").
 */

/** Every local record key begins with this. The suffix is the record's UUID. */
export const EDNB_RECORD_KEY_PREFIX = 'ednb:record:';

/** This top-level browsing context's tab descriptor, in `sessionStorage`. */
export const EDNB_TAB_KEY = 'ednb:tab';

/**
 * The marker one restart leaves for the session that comes up after it.
 *
 * `sessionStorage`, because the restart replaces this tab and no other: a
 * Commander with four tabs open should be told about the update in the one that
 * restarted, not in all four. Written immediately before the reload and cleared
 * by the first session that reads it, so the notice is shown once
 * (011/FR-025).
 */
export const EDNB_UPDATE_APPLIED_KEY = 'ednb:update-applied';

/** Account, fleet and synchronisation state committed as one local value. */
export const EDNB_COMMANDER_STATE_KEY = 'ednb:commander-state';

/** The channel duplicated tabs negotiate working-record ownership over. */
export const EDNB_BROADCAST_CHANNEL = 'ednb.persistence.v1';

/** The storage key one local record lives under. */
export function recordKey(recordId: string): string {
  return `${EDNB_RECORD_KEY_PREFIX}${recordId}`;
}

/** The record id a key names, or `null` when the key is not one of ours. */
export function recordIdFromKey(key: string): string | null {
  if (!key.startsWith(EDNB_RECORD_KEY_PREFIX)) {
    return null;
  }
  const id = key.slice(EDNB_RECORD_KEY_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * The Web Lock guarding deliberate writes to one record.
 *
 * Scoped per record rather than globally: two Commanders' tabs saving two
 * different builds have nothing to serialize between them, and a single lock
 * would make one wait on the other for no reason.
 *
 * It guards any record, named or not: naming an unnamed one is a write to that
 * same key. A Web Locks name is held in memory for the length of one operation
 * and is never stored bytes, so it carries no compatibility of its own.
 */
export function recordLockName(recordId: string): string {
  return `ednb:record:${recordId}`;
}
