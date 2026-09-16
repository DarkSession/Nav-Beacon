import { Injectable, Injector, effect, inject, signal } from '@angular/core';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { getShipBySymbol } from '@elite-dangerous-almanac/core/ships/ships';
import type { BuildSnapshotV1 } from '../../domain/ships/build/build-snapshot';
import { toBuildSnapshotV1 } from '../../domain/ships/build/build-snapshot.serializer';
import { emptyFixedMounts } from '../../domain/ships/build/fixed-mounts';
import { decodeBuildLinkFragment } from '../../domain/ships/build-link/build-link-codec-loader';
import { GameTextPresenter } from '../../i18n/game-text.presenter';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import { ActiveBuildStore } from '../active-build/active-build.store';
import {
  BuildIngressCoordinator,
  type CandidateOutcome,
  type CommitResult,
} from '../active-build/build-ingress.coordinator';
import { recognizeBuildLinkFragment } from './fragment-recognizer';
import { normalizeReconstructedBuild } from '../../domain/ships/build/build-ingress-normalizer';
import { LinkErrorMapper, type LinkFailure } from './link-error.mapper';
import { suppliedFit } from '../../domain/ships/build/supplied-fit';

/** Why a decode was thrown away rather than reported. */
const SUPERSEDED = 'A newer navigation replaced this build link.';

/**
 * Why a decode was accepted and then did nothing.
 *
 * Reloading a page whose address carries the link of the build already open is
 * the ordinary case, not a replacement: asking a Commander whether to discard
 * their build in favour of an identical one is a question with no answer.
 */
const UNCHANGED = 'The build link describes the build that is already open.';

/** How an incoming fragment was dealt with. */
export type IngressResult =
  /** The fragment was not a build link, so nothing was interpreted. */
  | { readonly kind: 'ignored' }
  /** Already the active build's own published link; nothing to do. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly failure: LinkFailure }
  | { readonly kind: 'replacement'; readonly result: CommitResult };

/**
 * The one way a build link becomes a build.
 *
 * Initial app start, a pasted address, a back navigation and an in-app
 * fragment change all arrive here, at the same method, in the same order:
 * recognize, bound, decode, reconstruct, refuse or offer. Four entry points
 * with four implementations would be four chances for one of them to commit a
 * build the others would have refused (build-link contract, "Ingress
 * pipeline").
 *
 * Nothing here touches the active build. A candidate is constructed in full and
 * handed to the shared ingress coordinator, so a link that turns out to be
 * unreadable costs a Commander nothing — including the build they were already
 * editing (FR-018).
 */
@Injectable({ providedIn: 'root' })
export class BuildLinkCoordinator {
  readonly #location = inject(HistoryLocationAdapter);
  readonly #ingress = inject(BuildIngressCoordinator);
  readonly #active = inject(ActiveBuildStore);
  readonly #gameText = inject(GameTextPresenter);
  readonly #errors = inject(LinkErrorMapper);
  // Captured at construction: `listen()` is started from a promise callback,
  // once this tab's own build has been restored, and that is not an injection
  // context.
  readonly #injector = inject(Injector);

  /**
   * Guards against a decode that finishes after a newer navigation started.
   *
   * The replacement coordinator holds the token that protects the commit. This
   * one protects everything a superseded decode would otherwise still do on its
   * way to being discarded — above all reporting its failure, which would put a
   * refusal about an abandoned link on screen underneath the build that
   * replaced it.
   */
  #token = 0;

  /** The fragment already accounted for: published by us, or just ingested. */
  #settled: string | null = null;

  /**
   * How a fragment becomes a build.
   *
   * A property rather than a direct call so a test can control when a decode
   * finishes — which is the whole of what "a late decode cannot replace a newer
   * navigation" means, and is otherwise unobservable.
   */
  decode: (fragment: string) => Promise<ShipLoadout> = decodeBuildLinkFragment;

  readonly #failure = signal<LinkFailure | null>(null);

  /** Why the last incoming link was refused, or `null`. */
  readonly failure = this.#failure.asReadonly();

  /**
   * Records a fragment as this application's own output.
   *
   * Publication writes the fragment, which moves the same signal an incoming
   * link moves. Without this the application would immediately read its own
   * link back and offer to replace the build it had just encoded.
   */
  markPublished(fragment: string | null): void {
    this.#settled = fragment;
  }

  /**
   * Watches the fragment for the whole lifetime of the workspace.
   *
   * Started after this tab's working record has been restored, so an initial
   * link is a replacement for a known build rather than a race with one
   * (build-link contract, "Ingress pipeline", step 6).
   */
  listen(): () => void {
    const watcher = effect(
      () => {
        void this.ingest(this.#location.fragment());
      },
      { injector: this.#injector },
    );
    return () => watcher.destroy();
  }

  /** Handles one fragment, whatever brought it in. */
  async ingest(raw: string): Promise<IngressResult> {
    const recognized = recognizeBuildLinkFragment(raw);

    if (recognized.kind === 'unrelated') {
      // Deliberately not an error and deliberately not cleared: the fragment
      // belongs to something else, and this application has no business
      // interpreting or removing it.
      return { kind: 'ignored' };
    }

    if (recognized.kind === 'over-limit') {
      this.#failure.set({ code: 'tooLong', slot: null });
      return { kind: 'refused', failure: { code: 'tooLong', slot: null } };
    }

    if (recognized.fragment === this.#settled) {
      return { kind: 'unchanged' };
    }
    this.#settled = recognized.fragment;

    this.#token += 1;
    const token = this.#token;

    const result = await this.#ingress.commit(async () =>
      this.#construct(recognized.fragment, token),
    );

    if (result.kind === 'failed' && result.reason === UNCHANGED) {
      return { kind: 'unchanged' };
    }
    if (result.kind === 'committed') {
      this.#failure.set(null);
    }
    return { kind: 'replacement', result };
  }

  async #construct(fragment: string, token: number): Promise<CandidateOutcome> {
    let loadout: ShipLoadout;
    try {
      loadout = await this.decode(fragment);
    } catch (error) {
      if (token !== this.#token) {
        return { ok: false, reason: SUPERSEDED };
      }
      const failure = this.#errors.classify(error);
      this.#failure.set(failure);
      return { ok: false, reason: `Build link refused: ${failure.code}.` };
    }

    if (token !== this.#token) {
      return { ok: false, reason: SUPERSEDED };
    }

    // The codec table and the installed package are versioned separately, so a
    // table that still carries a hull the package has dropped is possible. The
    // package is authoritative about what can be flown.
    const ship = getShipBySymbol(loadout.shipSymbol);
    if (ship === null) {
      const failure: LinkFailure = { code: 'unknownIdentity', slot: null };
      this.#failure.set(failure);
      return {
        ok: false,
        reason: `This installation carries no hull "${loadout.shipSymbol}".`,
      };
    }

    // Reconstruction came through the package's own construction boundary, so
    // every fixed mount arrives populated with its hull default. This confirms
    // it rather than repairing it: there is no second defaulting pass and no
    // provenance feedback, because nothing here defaulted anything.
    const empty = emptyFixedMounts(loadout);
    if (empty.length > 0) {
      const failure: LinkFailure = { code: 'reconstructionFailed', slot: empty[0] ?? null };
      this.#failure.set(failure);
      return {
        ok: false,
        reason: `The build link rebuilt "${ship.symbol}" with an empty fixed mount: ${empty.join(', ')}.`,
      };
    }

    // A link that describes what is already open replaces nothing. This is what
    // a reload looks like from here, and it must not become a question.
    const active = this.#active.snapshot();
    if (active !== null && linkIdentity(toBuildSnapshotV1(loadout)) === linkIdentity(active)) {
      return { ok: false, reason: UNCHANGED };
    }

    // The ingress gate, before anything is offered for activation. A link is
    // the one ingress a Commander did not author, so a partial roll encoded
    // into one is either completed by the package or the whole candidate is
    // refused with the current build untouched (contract, "Mandatory ingress
    // normalization").
    const ingress = normalizeReconstructedBuild(loadout);
    if (ingress.kind === 'unusable') {
      return { ok: false, reason: ingress.reason };
    }
    if (ingress.kind === 'refused') {
      this.#active.reportIngressRefusal(ingress.failures);
      return {
        ok: false,
        reason: `Build link refused: ${ingress.failures.length} partial engineering roll(s) the Almanac could not complete.`,
      };
    }

    return {
      ok: true,
      candidate: {
        loadout: ingress.candidate,
        hullName: this.#gameText.shipName(ship.symbol).text ?? ship.symbol,
        suppliedFit: suppliedFit(ship.symbol),
        provenance: 'link',
        sourceNamed: null,
        autosaveRecordId: null,
        // A link build is saved nowhere a Commander could get it back from, so
        // it arrives dirty and the next replacement asks before discarding it.
        baseline: null,
      },
    };
  }
}

/**
 * A build's identity for the purpose of "is this the same build?".
 *
 * Module symbols are case-insensitive identities, and the installed package
 * disagrees with itself about a few of them: a default loadout carries
 * `Int_SuperCruiseAssist` and `int_planetapproachsuite_advanced`, while the
 * codec table canonicalises both. Comparing the raw text would report a build
 * as different from itself after one round trip, and every reload would ask a
 * Commander whether to replace their build with an identical one.
 *
 * Only the symbols fold. A ship name is text a Commander typed, and two names
 * differing in capitalisation are two different names.
 */
function linkIdentity(snapshot: BuildSnapshotV1): string {
  return JSON.stringify({
    ...snapshot,
    modules: snapshot.modules.map((module) => ({
      ...module,
      symbol: module.symbol.toLowerCase(),
    })),
  });
}
