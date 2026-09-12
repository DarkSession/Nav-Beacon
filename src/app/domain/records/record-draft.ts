import { reconstructLoadout } from '../equipment/loadout/loadout-reconstructor';
import { reconstructFromSnapshot } from '../ships/build/build-snapshot.reconstructor-loader';
import type { LocalRecord } from './local-record';
import type { RecordDraft } from './local-record.serializer';

/** What a copy of an existing record is given of its own. */
export interface CopyIdentity {
  readonly id: string;
  readonly revisionId: string;
}

/**
 * Whether the installed package still carries what a record names.
 *
 * Asked before a record is offered to the service. A build naming a hull this
 * installation does not publish stays stored and unopened here and is not
 * uploaded, and the service would refuse it in any case — refusing the
 * complete batch with it, and holding up every other record behind it
 * (020/FR-012).
 *
 * The build half of the answer comes through the reconstructor's loader, which
 * is what keeps the outfitting catalogue out of the shell. Record exchange
 * starts with the application rather than with a screen, so the question is
 * asked from code every visit already carries.
 */
export async function isReconstructable(record: LocalRecord): Promise<boolean> {
  return record.tool === 'ship'
    ? (await reconstructFromSnapshot(record.build)).ok
    : reconstructLoadout(record.loadout).ok;
}

/**
 * One record's content under a second identity.
 *
 * This is what keeping both versions of a conflict is made of: the local
 * version keeps every field a Commander chose, including its note, and takes a
 * new application record identity so that the account's version can keep the
 * old one (020/FR-009, 020/FR-010).
 *
 * The stored verdict travels with a build rather than being recomputed, so a
 * copy states what was true when the work was written. A loadout is rebuilt
 * through the package because that is the only form the record writer takes,
 * and a loadout the package no longer carries cannot be copied at all.
 */
export function copyLocalRecord(record: LocalRecord, identity: CopyIdentity): RecordDraft | null {
  const envelope = {
    id: identity.id,
    revisionId: identity.revisionId,
    kind: record.kind,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
    name: record.name,
    note: record.note,
    sourceNamed: record.sourceNamed,
  } as const;

  if (record.tool === 'ship') {
    return {
      ...envelope,
      payload: { tool: 'ship', build: record.build, validation: record.validation },
    };
  }

  const rebuilt = reconstructLoadout(record.loadout);
  return rebuilt.ok
    ? { ...envelope, payload: { tool: 'equipment', loadout: rebuilt.loadout } }
    : null;
}
