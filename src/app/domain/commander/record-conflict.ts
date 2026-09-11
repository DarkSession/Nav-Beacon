import type { RemoteRecord } from '../records/remote-record';

/**
 * Why one record's versions cannot both be the account's.
 *
 * A stale write is two live versions: this browser wrote against a revision
 * another device has already replaced. A remote deletion is one live version
 * and a deletion marker: the account no longer holds the record this browser
 * still has (020/FR-009, 020/FR-010).
 */
export type RecordConflictKind = 'stale-write' | 'remote-deletion';

/** The three answers a Commander has, for both kinds. */
export type ConflictChoice = 'overwrite' | 'keep-both' | 'cancel';

export interface RecordConflict {
  readonly recordId: string;
  readonly customerId: string;
  readonly kind: RecordConflictKind;
  /**
   * The revision the account holds now. For a deletion it is the marker's, and
   * an overwrite sent against it supersedes the marker under the same identity.
   */
  readonly remoteRevision: number;
  /** The account's version, where this browser can read it. */
  readonly remote: RemoteRecord | null;
  /** Whether the account holds a version this application version cannot read. */
  readonly remoteUnreadable: boolean;
  /** Whether a live page in this browser holds the record open. */
  readonly claimed: boolean;
}

/** What resolving one conflict did. */
export type ConflictResolution =
  | { readonly kind: 'overwritten'; readonly recordId: string }
  | {
      readonly kind: 'kept-both';
      /** The identity the account's version keeps. */
      readonly recordId: string;
      /** The fresh identity this browser's version takes. */
      readonly copiedTo: string;
    }
  | { readonly kind: 'cancelled'; readonly recordId: string }
  /** No conflict stands under that identity, so nothing was changed. */
  | { readonly kind: 'unknown' }
  /** Browser storage refused the local half, so the conflict still stands. */
  | { readonly kind: 'failed'; readonly recordId: string };
