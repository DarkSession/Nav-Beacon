import { Injectable, Injector, effect, inject, untracked } from '@angular/core';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { encodeBuildLinkFragment } from '../../domain/ships/build-link/build-link-codec-loader';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import type { LinkFailureCode } from '../active-build/active-build.models';
import { ActiveBuildStore } from '../active-build/active-build.store';
import { BuildLinkCoordinator } from './build-link.coordinator';
import { MAX_BUILD_LINK_LENGTH, recognizeBuildLinkFragment } from './fragment-recognizer';
import { LinkErrorMapper } from './link-error.mapper';
import { linkPayloadSource } from './link-payload.allowlist';

/**
 * Keeping the address bar showing the build that is actually open.
 *
 * A published fragment is not a snapshot a Commander asked for — it is the
 * current build, continuously. That is why it is written with
 * `history.replaceState` rather than by assigning the hash: an assignment
 * pushes an entry, and one entry per edit would bury the Commander's real
 * navigation history under a hundred versions of the same page (FR-020).
 *
 * What is encoded comes through the payload allowlist and nothing else. A note,
 * a save name, a record id or a tab id cannot perturb the link, because none of
 * them is reachable from what the encoder is given.
 */
@Injectable({ providedIn: 'root' })
export class FragmentPublisher {
  readonly #active = inject(ActiveBuildStore);
  readonly #location = inject(HistoryLocationAdapter);
  readonly #ingress = inject(BuildLinkCoordinator);
  readonly #errors = inject(LinkErrorMapper);
  readonly #injector = inject(Injector);

  /** Discards an encode that finished after a newer edit started one. */
  #token = 0;

  /**
   * The document the published fragment was written onto.
   *
   * A build link belongs to the build it describes, so stating one again is
   * bounded the way publishing one is: a Commander who publishes a link and
   * then leaves the workspace must not arrive at another screen carrying it.
   * This is bookkeeping rather than something the application says about the
   * build, which is why it is here and not on `link()`.
   */
  #publishedDocument: string | null = null;

  /**
   * How a build becomes a fragment.
   *
   * A property rather than a direct call so a test can control when an encode
   * finishes or make one refuse — neither of which the real codec can be asked
   * to do on demand.
   */
  encode: (loadout: ShipLoadout) => Promise<string> = encodeBuildLinkFragment;

  /**
   * Publishes after every modelled edit, for as long as the workspace is open.
   *
   * Returns an unsubscribe: the watcher outlives no screen, and a second
   * registration would encode the same build twice per keystroke.
   */
  start(): () => void {
    const watcher = effect(
      () => {
        // The revision is the subscription. The loadout is edited in place, so
        // its reference never changes and reading it alone would publish once
        // and then never again.
        this.#active.revision();
        this.#active.loadout();
        void this.publish();
      },
      { injector: this.#injector },
    );

    // The address can lose a publication whenever history moves. Encoding is
    // one lazily imported chunk and one encode after the edit that asked for
    // it, and a layer raised inside that window pushes an entry of its own at
    // the same address: the fragment lands on the layer's entry, and closing it
    // goes back to the one that never received it. The build is safe, because
    // an absent fragment is ignored on ingest. The address is wrong, and it
    // stays wrong until the next edit — so what is published is stated again
    // whenever the address comes back carrying nothing (022/FR-001).
    const keeper = effect(
      () => {
        const fragment = this.#location.fragment();
        const link = this.#active.link();

        // Only an empty address. A fragment the address already carries is
        // left alone whichever kind it is: another build link is how a
        // Commander reaches another build, and anything else belongs to
        // whoever wrote it. Emptiness is tested here rather than asked of
        // `recognizeBuildLinkFragment`, which answers `unrelated` for an empty
        // fragment and a foreign one alike.
        if (fragment !== '' || link.kind !== 'published') {
          return;
        }
        if (this.#location.currentDocument() !== this.#publishedDocument) {
          return;
        }

        // Marked first, as publication marks it. Without the mark the
        // coordinator reads the restored fragment as an arrival, and decodes a
        // build that is already open.
        this.#ingress.markPublished(link.fragment);
        this.#location.replaceFragment(link.fragment);
      },
      { injector: this.#injector },
    );

    return () => {
      watcher.destroy();
      keeper.destroy();
    };
  }

  /** Encodes the current build and replaces the fragment with it. */
  async publish(): Promise<void> {
    const loadout = untracked(() => linkPayloadSource(this.#active.state()));

    if (loadout === null) {
      this.#clearBuildFragment();
      this.#active.setLink({ kind: 'absent' });
      return;
    }

    this.#token += 1;
    const token = this.#token;
    // Where this publication belongs. Encoding is asynchronous, and a Commander
    // who leaves the build while one is in flight must not arrive at the
    // shipyard with a build link stamped on it.
    const document = this.#location.currentDocument();
    // Read with the loadout, before the await: this is the revision the
    // fragment about to be encoded describes.
    const revision = untracked(() => this.#active.revision());
    this.#active.setLink({ kind: 'encoding' });

    let fragment: string;
    try {
      fragment = await this.encode(loadout);
    } catch (error) {
      if (token !== this.#token || this.#location.currentDocument() !== document) {
        return;
      }
      const failure = this.#errors.classify(error);
      this.#refuse(failure.code, failure.slot);
      return;
    }

    if (token !== this.#token || this.#location.currentDocument() !== document) {
      return;
    }

    // The bound is the application's promise about what it publishes, so it is
    // checked on the way out as well as on the way in. A link that exceeds it
    // is refused rather than published and truncated by something downstream.
    if (fragment.length > MAX_BUILD_LINK_LENGTH) {
      this.#refuse('tooLong', null);
      return;
    }

    this.#ingress.markPublished(fragment);
    this.#location.replaceFragment(fragment);
    this.#publishedDocument = document;
    this.#active.setLink({ kind: 'published', fragment, revision });
  }

  /** The canonical shareable address for what is currently published. */
  publishedUrl(): string | null {
    const link = this.#active.link();
    return link.kind === 'published' ? this.#location.urlWithFragment(link.fragment) : null;
  }

  /**
   * Refuses to publish, and takes the stale link down with it.
   *
   * The build stays exactly as it is — a build that cannot be shared is still a
   * build. What cannot stay is the fragment: it describes an earlier version,
   * and leaving it in the address bar would hand a Commander a link to
   * something they are no longer editing (build-link contract, "Active-edit
   * synchronization").
   */
  #refuse(code: LinkFailureCode, slot: string | null): void {
    this.#clearBuildFragment();
    this.#active.setLink({ kind: 'refused', code, slot });
  }

  #clearBuildFragment(): void {
    if (recognizeBuildLinkFragment(this.#location.fragment()).kind === 'unrelated') {
      return;
    }
    this.#ingress.markPublished(null);
    this.#location.replaceFragment(null);
  }
}
