import { Injectable, inject } from '@angular/core';
import type { OwnedShip } from '../../domain/commander/fleet/owned-ship';
import { normalizeReconstructedBuild } from '../../domain/ships/build/build-ingress-normalizer';
import { reconstructFromSnapshot } from '../../domain/ships/build/build-snapshot.reconstructor';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { ActiveBuildStore } from '../active-build/active-build.store';
import {
  BuildIngressCoordinator,
  type CandidateOutcome,
  type CommitResult,
} from '../active-build/build-ingress.coordinator';

/**
 * Taking an owned ship into the planning tools.
 *
 * An owned ship is read-only, so what the builder receives is a copy and never
 * the fleet entry. The copy is made the way every other detached build is made:
 * the owned ship's build is serialized to a snapshot and rebuilt from it, so
 * the builder holds its own `ShipLoadout` and no edit can reach back into the
 * fleet. A build is edited in place, and handing the same object over would
 * make "copy" mean "open" (020/FR-017).
 *
 * The candidate carries no record identity at all. It arrives dirty, with no
 * named source and no autosave target, so autosave mints it a record of its own
 * at the first write — a separate saved build a Commander may rename, edit and
 * delete without any of it reaching the owned ship (020/FR-017, 001/FR-008).
 */
@Injectable({ providedIn: 'root' })
export class FleetCopyService {
  readonly #coordinator = inject(BuildIngressCoordinator);
  readonly #gameText = inject(GameTextPresenter);
  readonly #active = inject(ActiveBuildStore);

  /** Copies one owned ship into the builder. */
  async copy(ship: OwnedShip): Promise<CommitResult> {
    return this.#coordinator.commit(() => this.#construct(ship));
  }

  #construct(ship: OwnedShip): CandidateOutcome {
    const rebuilt = reconstructFromSnapshot(toBuildSnapshotV1(ship.loadout));
    if (!rebuilt.ok) {
      return { ok: false, reason: rebuilt.reason };
    }

    // The ingress gate, before anything is offered for activation. An owned
    // ship states completed rolls, so there is nothing here for the gate to
    // complete; it runs because every reconstructed build goes through it and a
    // release that changed that would be caught here rather than in a build a
    // Commander saves (contract, "Mandatory ingress normalization").
    const ingress = normalizeReconstructedBuild(rebuilt.loadout);
    if (ingress.kind === 'unusable') {
      return { ok: false, reason: ingress.reason };
    }
    if (ingress.kind === 'refused') {
      // Published, not thrown away, exactly as the record door publishes it:
      // the surface that names every affected mount is what makes this
      // actionable. Nothing about the current build moves, and nothing about
      // the owned ship moves either.
      this.#active.reportIngressRefusal(ingress.failures);
      return { ok: false, reason: refusalReason(ingress.failures) };
    }

    const symbol = ingress.candidate.shipSymbol;
    return {
      ok: true,
      candidate: {
        loadout: ingress.candidate,
        hullName: this.#gameText.shipName(symbol).text ?? symbol,
        // The same provenance an imported build carries: work that exists in
        // this tab and nowhere a Commander could get it back from.
        provenance: 'working',
        sourceNamed: null,
        autosaveRecordId: null,
        baseline: null,
      },
    };
  }
}

/**
 * Why the ingress gate refused, named mount by mount.
 *
 * No owned ship reaches it. A journal `Loadout` states completed grades and no
 * roll quality (020/FR-015), so the gate finds nothing partial to complete and
 * never answers `refused` — the same reason `#construct` gives above for
 * running the gate at all. It is written for the release that changes that:
 * the caller renders it through `library.open.failed`, where a Commander would
 * read it, so it states only what the gate answered — a count and the codes it
 * gave — and invents no cause for it (constitution IV). A door that did start
 * reaching this would owe the message layer a code rather than this sentence
 * (constitution VI, `build-ingress-normalizer.ts`).
 */
function refusalReason(failures: readonly { readonly code: string | null }[]): string {
  return `The Almanac could not complete ${failures.length} partial engineering roll(s): ${failures
    .map((failure) => failure.code ?? 'unknown')
    .join(', ')}.`;
}
