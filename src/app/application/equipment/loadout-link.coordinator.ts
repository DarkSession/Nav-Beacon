import { Injectable, Injector, effect, inject, signal, untracked } from '@angular/core';
import {
  decodeEquipmentLinkFragment,
  encodeEquipmentLinkFragment,
} from '../../domain/equipment/loadout-link/equipment-link-codec-loader';
import type { EquipmentLoadout } from '../../domain/equipment/loadout-link/equipment-loadout';
import { reconstructLoadout } from '../../domain/equipment/loadout/loadout-reconstructor';
import { toStoredLoadout } from '../../domain/equipment/loadout/stored-loadout.serializer';
import { HistoryLocationAdapter } from '../../platform/browser/history-location.adapter';
import {
  MAX_BUILD_LINK_LENGTH,
  recognizeEquipmentLinkFragment,
} from '../build-link/fragment-recognizer';
import { LinkErrorMapper, type LinkFailure } from '../build-link/link-error.mapper';
import { equipmentLinkPayloadSource } from '../build-link/link-payload.allowlist';
import { LoadoutStore } from './loadout.store';

/** What the bench's own link is doing, as the export layer states it. */
export type LoadoutLinkState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'published'; readonly fragment: string }
  | { readonly kind: 'refused'; readonly failure: LinkFailure };

/** How an incoming fragment was dealt with. */
export type LoadoutIngressResult =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly failure: LinkFailure }
  | { readonly kind: 'opened' };

/**
 * The loadout link, in and out.
 *
 * The ship tool's ingress pipeline over the bench's own store: recognize the
 * `e.` prefix, bound the length, decode, rebuild through the package, and only
 * then open. Every step before the last can refuse, and a refusal costs a
 * Commander nothing — the loadout on the bench is never touched by a link that
 * turns out to be unreadable (FR-021).
 *
 * What is published comes through the payload allowlist and nothing else: not
 * the record the loadout was opened from, not which item the item view is
 * showing, not the undo tape.
 *
 * The fragment is replaced rather than assigned, for the reason the ship
 * publisher gives: one history entry per fitted weapon would bury a Commander's
 * real navigation under a hundred versions of the same page.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutLinkCoordinator {
  readonly #store = inject(LoadoutStore);
  readonly #location = inject(HistoryLocationAdapter);
  readonly #errors = inject(LinkErrorMapper);
  readonly #injector = inject(Injector);

  /**
   * How a loadout becomes a fragment, and back.
   *
   * Properties rather than direct calls, so a test can make one refuse without
   * assembling a loadout the codec would actually reject.
   */
  encode: (loadout: EquipmentLoadout) => string = encodeEquipmentLinkFragment;
  decode: (fragment: string) => EquipmentLoadout = decodeEquipmentLinkFragment;

  readonly #link = signal<LoadoutLinkState>({ kind: 'absent' });

  /** What the address bar is carrying for this bench, or why it is not. */
  readonly link = this.#link.asReadonly();

  readonly #failure = signal<LinkFailure | null>(null);

  /**
   * Why the last link was refused, or `null`.
   *
   * Kept apart from the publication state above, because the two are read in
   * different places: a link that arrives refused is not something a Commander
   * went looking for — they opened an address and nothing happened — so the
   * reason belongs where they are rather than inside a layer they would have to
   * find (FR-021).
   *
   * A loadout the current table cannot represent is refused on the way out for
   * the same reason. It is in no record while it is at its suit's default and
   * now in no fragment either, so a Commander told only inside the export layer
   * would learn on the next reload that it is gone.
   */
  readonly failure = this.#failure.asReadonly();

  /** The fragment already accounted for: published by us, or just ingested. */
  #settled: string | null = null;

  /**
   * Reads the fragment now, and again whenever it changes.
   *
   * The one way a loadout link becomes a loadout: an address a Commander
   * arrived on, a pasted one and a back navigation all arrive here, in the same
   * order, so there is no second path that could open something this one would
   * have refused.
   */
  listen(): () => void {
    const watcher = effect(
      () => {
        this.ingest(this.#location.fragment());
      },
      { injector: this.#injector },
    );

    return () => watcher.destroy();
  }

  /** Publishes after every committed choice, for as long as the bench is open. */
  start(): () => void {
    const watcher = effect(
      () => {
        // The revision is the subscription: a loadout is replaced rather than
        // edited in place, but reading the revision says the same thing for
        // both and costs nothing.
        this.#store.revision();
        this.#store.loadout();
        this.publish();
      },
      { injector: this.#injector },
    );

    return () => watcher.destroy();
  }

  /** Encodes what is on the bench and replaces the fragment with it. */
  publish(): void {
    const loadout = untracked(() => equipmentLinkPayloadSource(this.#store.loadout()));

    if (loadout === null) {
      this.#clear();
      this.#link.set({ kind: 'absent' });
      return;
    }

    let fragment: string;
    try {
      fragment = this.encode(loadout);
    } catch (error) {
      this.#refuse(this.#errors.classify(error));
      return;
    }

    // The bound is the application's promise about what it publishes, so it is
    // checked on the way out as well as on the way in.
    if (fragment.length > MAX_BUILD_LINK_LENGTH) {
      this.#refuse({ code: 'tooLong', slot: null });
      return;
    }

    this.#settled = fragment;
    this.#location.replaceFragment(fragment);
    this.#link.set({ kind: 'published', fragment });
  }

  /** The canonical shareable address for what is currently published. */
  publishedUrl(): string | null {
    const link = this.#link();
    return link.kind === 'published' ? this.#location.urlWithFragment(link.fragment) : null;
  }

  /** Handles one fragment, whatever brought it in. */
  ingest(raw: string): LoadoutIngressResult {
    const recognized = recognizeEquipmentLinkFragment(raw);

    if (recognized.kind === 'unrelated') {
      // The fragment belongs to something else — a ship link, a deep link, an
      // anchor — and this tool has no business interpreting or removing it.
      return { kind: 'ignored' };
    }

    if (recognized.kind === 'over-limit') {
      return this.#refuseIncoming({ code: 'tooLong', slot: null });
    }

    if (recognized.fragment === this.#settled) {
      return { kind: 'unchanged' };
    }

    let decoded: EquipmentLoadout;
    try {
      decoded = this.decode(recognized.fragment);
    } catch (error) {
      return this.#refuseIncoming(this.#errors.classify(error));
    }

    // The codec table and the installed package are versioned separately, so a
    // table that still carries a suit the package has dropped is possible. The
    // package is authoritative about what can be worn, and it is asked before
    // anything reaches the bench.
    const rebuilt = reconstructLoadout(toStoredLoadout(decoded));
    if (!rebuilt.ok) {
      return this.#refuseIncoming({ code: 'unknownIdentity', slot: null });
    }

    this.#settled = recognized.fragment;
    this.#failure.set(null);
    // A link is nobody's saved record, so the loadout it opens belongs to no
    // save and the next save asks for a name (013 contracts/loadout-persistence).
    this.#store.open(rebuilt.loadout, null);
    this.#link.set({ kind: 'published', fragment: recognized.fragment });
    return { kind: 'opened' };
  }

  /**
   * Refuses an incoming link, leaving the bench exactly as it was.
   *
   * The fragment stays in the address bar: it is what the Commander was handed,
   * it is not this application's output, and removing it would take away the
   * thing they would paste to someone who can read it.
   */
  #refuseIncoming(failure: LinkFailure): LoadoutIngressResult {
    this.#failure.set(failure);
    return { kind: 'refused', failure };
  }

  #refuse(failure: LinkFailure): void {
    // The loadout stays exactly as it is — one that cannot be shared is still a
    // loadout. What cannot stay is a fragment describing an earlier version.
    this.#clear();
    this.#failure.set(failure);
    this.#link.set({ kind: 'refused', failure });
  }

  #clear(): void {
    if (recognizeEquipmentLinkFragment(this.#location.fragment()).kind === 'unrelated') {
      return;
    }
    this.#settled = null;
    this.#location.replaceFragment(null);
  }
}
