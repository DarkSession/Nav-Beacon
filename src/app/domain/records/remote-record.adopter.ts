import { reconstructLoadout } from '../equipment/loadout/loadout-reconstructor';
import { reconstructFromSnapshot } from '../ships/build/build-snapshot.reconstructor';
import type { RecordSource } from './local-record';
import type { RecordDraft } from './local-record.serializer';
import type { RemoteRecord } from './remote-record';

/** What the browser keeps for a record the account also holds. */
export interface AdoptionContext {
  /** A fresh local revision identity for the write this adoption makes. */
  readonly revisionId: string;
  /** The note the local copy carries, which never left this browser. */
  readonly note: string | null;
  /** The named record a local working copy was opened from, where there is one. */
  readonly sourceNamed: RecordSource | null;
}

export type RemoteAdoption =
  | { readonly ok: true; readonly draft: RecordDraft }
  | { readonly ok: false; readonly reason: string };

/**
 * The local record one remote record becomes.
 *
 * The package is asked first. A record naming a hull, module, suit or weapon
 * this installation does not publish is not written: it stays remote and
 * unopened, and the application states that this version cannot open it rather
 * than storing something it cannot reconstruct (020/FR-012).
 *
 * The note and the working copy's named source are carried across rather than
 * dropped. They are local by definition, the service never saw them, and
 * taking the account's version of a record a Commander has annotated must not
 * take the annotation with it (020/FR-007).
 *
 * A ship record's name is the build's ship name, because the live contract
 * holds no second name. A named record whose ship name is absent falls back to
 * its ident and then to the hull the build names, so a record written by
 * another version is still listed under something a Commander can read.
 */
export function adoptRemoteRecord(record: RemoteRecord, context: AdoptionContext): RemoteAdoption {
  const envelope = {
    id: record.id,
    kind: record.kind,
    revisionId: context.revisionId,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
    note: context.note,
    sourceNamed: context.sourceNamed,
  } as const;

  if (record.tool === 'equipment') {
    const rebuilt = reconstructLoadout(record.loadout);
    if (!rebuilt.ok) {
      return { ok: false, reason: rebuilt.reason };
    }
    return {
      ok: true,
      draft: {
        ...envelope,
        name: record.name,
        payload: { tool: 'equipment', loadout: rebuilt.loadout },
      },
    };
  }

  const rebuilt = reconstructFromSnapshot(record.build);
  if (!rebuilt.ok) {
    return { ok: false, reason: rebuilt.reason };
  }
  const verdict = rebuilt.loadout.validation();
  return {
    ok: true,
    draft: {
      ...envelope,
      name:
        record.kind === 'named'
          ? (record.build.shipName ?? record.build.shipIdent ?? record.build.shipSymbol)
          : null,
      payload: {
        tool: 'ship',
        build: record.build,
        validation: { valid: verdict.valid, complete: verdict.complete },
      },
    },
  };
}
