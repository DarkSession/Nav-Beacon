import { Injectable, inject } from '@angular/core';
import { isShipRecord } from '../../domain/records/local-record';
import {
  normalizeReconstructedBuild,
  refusalReason,
} from '../../domain/ships/build/build-ingress-normalizer';
import { reconstructFromSnapshot } from '../../domain/ships/build/build-snapshot.reconstructor';
import { baselineFingerprint } from '../../domain/ships/build/build-fingerprint';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { RecordMigrationService } from '../../platform/storage/record-migration.service';
import { ActiveBuildStore } from '../active-build/active-build.store';
import type { BuildProvenance } from '../active-build/active-build.models';
import {
  BuildIngressCoordinator,
  type CandidateOutcome,
  type CommitResult,
} from '../active-build/build-ingress.coordinator';

/**
 * Opening a stored build.
 *
 * The order is what makes this safe: decode, migrate, reconstruct through the
 * package, and only then offer the candidate to the shared coordinator. A
 * record that cannot be read, cannot be migrated or names a hull the installed
 * package no longer carries fails here, with the active build untouched — the
 * Commander loses nothing by trying to open something that turns out to be
 * unopenable (build-library design, "Operation rules").
 *
 * Opening never converts or mutates the source record. The one write it can
 * make is the migration rewrite, which stores the record it has just
 * reconstructed under its own key, serialized at the latest version
 * (`RecordMigrationService`). Nothing else here writes.
 * An unnamed record is taken over, because it is already what autosave writes
 * to. A named one is only held: this page writes nothing to it, forks an
 * unnamed record at the first modelled edit, and leaves the save exactly as it
 * was until the Commander asks for it to be replaced (FR-008, ruled
 * 2026-08-25).
 */
@Injectable({ providedIn: 'root' })
export class RecordOpenService {
  readonly #migration = inject(RecordMigrationService);
  readonly #coordinator = inject(BuildIngressCoordinator);
  readonly #gameText = inject(GameTextPresenter);
  readonly #active = inject(ActiveBuildStore);

  /** Opens one record, asking about unsaved work first where there is any. */
  async open(recordId: string): Promise<CommitResult> {
    return this.#coordinator.commit(() => this.#construct(recordId));
  }

  #construct(recordId: string): CandidateOutcome {
    const opened = this.#migration.open(recordId);
    if (!opened.ok) {
      return { ok: false, reason: opened.reason };
    }

    const record = opened.record;
    // The ship tool's open path. A loadout is opened by the bench, which owns
    // the store it would go into; refusing here rather than reaching for its
    // payload keeps one record from being opened as the other kind of thing.
    if (!isShipRecord(record)) {
      return { ok: false, reason: 'This record is a loadout, and belongs to the equipment bench.' };
    }
    const rebuilt = reconstructFromSnapshot(record.build);
    if (!rebuilt.ok) {
      return { ok: false, reason: rebuilt.reason };
    }

    // The ingress gate, before anything is offered for activation. A record
    // stored before this application completed rolls — or written by an older
    // version of it — can carry a partial one, and a partial roll is either
    // completed by the package or the whole candidate is refused. There is no
    // third outcome and no repair pass here (contract, "Mandatory ingress
    // normalization").
    const ingress = normalizeReconstructedBuild(rebuilt.loadout);
    if (ingress.kind === 'unusable') {
      return { ok: false, reason: ingress.reason };
    }
    if (ingress.kind === 'refused') {
      // Published, not thrown away: the surface that names every affected mount
      // is what makes this actionable. Nothing about the current build moves.
      this.#active.reportIngressRefusal(ingress.failures);
      return { ok: false, reason: refusalReason(ingress.failures) };
    }

    // Every opened record is the state it was stored at, so every one of them
    // starts clean. A named record is clean because a save put it there; an
    // unnamed one is clean because autosave did, and rewriting it on open would
    // restart the seven days it is counting down (FR-013).
    const provenance: BuildProvenance = record.kind === 'named' ? 'named' : 'working';
    const baseline = baselineFingerprint(toBuildSnapshotV1(rebuilt.loadout));

    return {
      ok: true,
      candidate: {
        loadout: ingress.candidate,
        hullName: this.#gameText.shipName(record.hullSymbol).text ?? record.hullSymbol,
        provenance,
        sourceNamed:
          record.kind === 'named'
            ? { recordId: record.id, baseRevisionId: record.revisionId }
            : record.sourceNamed,
        // An unnamed record is already an autosave target, so opening one takes
        // it over. A named record is never one: this page holds it, writes
        // nothing to it, and forks at the first modelled edit (FR-008).
        autosaveRecordId: record.kind === 'working' ? record.id : null,
        baseline,
      },
    };
  }
}
