import type { RecordInvalidationService } from './record-invalidation.service';
import type { WorkingRecordSubject } from './working-record.port';

/** What a save produced, and what it was made from. */
export interface SavedRecord {
  readonly recordId: string;
  readonly revisionId: string;
  /** The unnamed record the work was autosaved into, or `null`. */
  readonly held: string | null;
}

/**
 * Takes up the named record a save produced, and lets go of the unnamed one.
 *
 * Letting go is the part that matters. The tool now holds a named record, and
 * autosave has no path to one — so the id it was writing to is cleared and the
 * next change forks a fresh unnamed record, rather than autosave going idle
 * against a record it is no longer allowed to touch (001/FR-008, 017/FR-007,
 * persistence contract, "Autosaved records").
 *
 * The state says the work is in a record again. A page paused on a record
 * another tab discarded moves off it by saving as much as by opening another,
 * and the notice about the discarded one would otherwise stand with nothing
 * left to resume (001/FR-012, 017/FR-008).
 *
 * The unnamed record is announced as gone because the save consumed it, not
 * because anybody deleted it: a list open on another page is still showing it,
 * and the page that had it open is this one (001/FR-009, 013/FR-016).
 *
 * The tab's claim follows from the same two writes. It names the record the
 * work can be opened from again, which is the one the save produced and not
 * always the one autosave held: a save without Web Locks mints a fresh record,
 * and an overwrite writes an existing named one. Both consume the record
 * autosave was writing to, and a claim left on a consumed record restores
 * nothing (017/FR-010).
 *
 * One function for both tools, because it is one rule. Two copies in two page
 * components is the rule written twice, in the two files least likely to be
 * read together.
 */
export function adoptSavedRecord(
  subject: WorkingRecordSubject,
  invalidation: RecordInvalidationService,
  saved: SavedRecord,
): void {
  subject.markSaved({ recordId: saved.recordId, baseRevisionId: saved.revisionId });
  subject.setAutosaveRecordId(null);
  subject.setPersistence('saved');
  invalidation.announceWrite(saved.recordId, saved.revisionId);

  if (saved.held !== null && saved.held !== saved.recordId) {
    invalidation.announceDelete(saved.held);
  }
}
