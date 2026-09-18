import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { toStoredLoadout } from '../../domain/equipment/loadout/stored-loadout.serializer';
import { MessageService } from '../../i18n/message.service';
import { DownloadAdapter } from '../../platform/browser/download.adapter';
import { NavigatorAdapter } from '../../platform/browser/navigator.adapter';
import type {
  ShareLinkFeedback,
  ShareLinkState,
} from '../../ui/components/share-link-panel/share-link-panel';
import { LinkErrorMapper } from '../build-link/link-error.mapper';
import { LoadoutLinkCoordinator } from './loadout-link.coordinator';
import { LoadoutStore } from './loadout.store';
import { LoadoutSummary } from './loadout-summary';

/** The three formats canvas 1a's export layer offers. */
export type ExportFormat = 'json' | 'link' | 'text';

/** How long a successful copy is said on the control that did it. */
const COPIED_HOLD_MS = 1_200;

/** What each written format is called on disk, and what it is. */
const FILES: Readonly<Record<'json' | 'text', { name: string; type: string }>> = {
  json: { name: 'loadout.json', type: 'application/json' },
  text: { name: 'loadout.txt', type: 'text/plain' },
};

/**
 * Passing a loadout on: one layer, the canvas's three formats.
 *
 * The payloads are the loadout and nothing else. The JSON is the same
 * allowlisted object storage holds — identities only, no stated figure and no
 * catalogue fact — so what leaves the bench by file is what leaves it by link
 * (013 contracts/loadout-persistence.md, "No calculated value in storage").
 *
 * Every failure leaves the value on screen and selectable. Clipboard access is
 * a permission a browser can refuse and a share sheet is a thing that can
 * simply not appear; neither may be the only way a loadout gets out of here.
 */
@Injectable({ providedIn: 'root' })
export class LoadoutSharePresenter {
  readonly #store = inject(LoadoutStore);
  readonly #link = inject(LoadoutLinkCoordinator);
  readonly #summary = inject(LoadoutSummary);
  readonly #errors = inject(LinkErrorMapper);
  readonly #messages = inject(MessageService);
  readonly #navigator = inject(NavigatorAdapter);
  readonly #downloads = inject(DownloadAdapter);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#stopHolding());
  }

  readonly #format = signal<ExportFormat>('json');
  readonly #feedback = signal<ShareLinkFeedback>('idle');

  /** Which format the layer is showing. The canvas opens on the payload. */
  readonly format = this.#format.asReadonly();
  readonly feedback = this.#feedback.asReadonly();
  readonly shareAvailable = this.#navigator.canShare();

  readonly state = computed<ShareLinkState>(() => {
    const link = this.#link.link();
    return link.kind === 'refused' ? 'refused' : link.kind;
  });

  readonly url = computed(() =>
    this.#link.link().kind === 'published' ? this.#link.publishedUrl() : null,
  );

  readonly refusal = computed(() => {
    const link = this.#link.link();
    return link.kind === 'refused'
      ? this.#errors.describe(link.failure, 'equipment', 'outgoing')
      : null;
  });

  /** The whole loadout as one object, exactly as a saved record carries it. */
  readonly json = computed(() => {
    const loadout = this.#store.loadout();
    return loadout === null ? '' : JSON.stringify(toStoredLoadout(loadout), null, 2);
  });

  /** The same loadout in words, for a post rather than for a parser. */
  readonly text = computed(() => {
    const loadout = this.#store.loadout();
    return loadout === null ? '' : this.#summary.write(loadout);
  });

  /** What the field shows for the format in front of the Commander. */
  readonly payload = computed(() => (this.#format() === 'json' ? this.json() : this.text()));

  /**
   * Canvas 1a's line across from the buttons: what the format is, how much of a
   * loadout it carries, and how large it came out.
   *
   * `fmt.toUpperCase() + ' · ' + (o.weapons.length + 1) + ' ITEMS · ' + mods +
   * ' MODS · ' + (txt.length / 1024).toFixed(1) + ' KB'`. Every part is a fact
   * about the text this layer just wrote — nothing here is a figure about the
   * equipment, which is the library's to state (constitution II).
   */
  readonly meta = computed(() => {
    const loadout = this.#store.loadout();
    if (loadout === null) return null;

    // The layer draws this line beside the text a format wrote. The link format
    // draws the ship tool's own share panel instead, which has no such line and
    // no payload to count, so there is nothing here to state.
    if (this.#format() === 'link') return null;

    const written = this.payload();
    if (written.length === 0) return null;

    const weapons = loadout.weapons.filter((weapon) => weapon !== null);
    const modifications =
      loadout.suitModifications.filter((held) => held !== null).length +
      weapons.reduce(
        (total, weapon) => total + weapon.modifications.filter((held) => held !== null).length,
        0,
      );

    // The suit counts among the items, as the canvas counts it.
    const items = weapons.length + 1;

    return this.#messages.message('equipment.export.meta', {
      format: this.#messages.message(`equipment.export.mode.${this.#format()}`),
      items: this.#counted('equipment.export.items', items),
      modifications: this.#counted('equipment.export.mods', modifications),
      // Bytes rather than characters: what a Commander is about to copy or
      // download is the encoded text, and an identity outside ASCII is longer
      // than the string that holds it.
      size: (new TextEncoder().encode(written).length / 1024).toFixed(1),
    });
  });

  /** `1 item` against `4 items`, the way every other counted phrase is written. */
  #counted(key: 'equipment.export.items' | 'equipment.export.mods', count: number): string {
    return count === 1
      ? this.#messages.message(`${key}.one`)
      : this.#messages.message(`${key}.many`, { count: String(count) });
  }

  selectFormat(format: ExportFormat): void {
    this.#format.set(format);
    this.#feedback.set('idle');
  }

  /** Copies the link, or the payload the chosen format wrote. */
  async copy(): Promise<void> {
    const value = this.#format() === 'link' ? this.url() : this.payload();
    if (value === null || value.length === 0) {
      return;
    }
    // Cleared first, so a second copy flashes again rather than setting a
    // signal to the value it already holds and announcing nothing.
    this.#stopHolding();
    this.#feedback.set('idle');
    const copied = await this.#navigator.copyText(value);
    this.#feedback.set(copied ? 'copied' : 'copy-failed');
    if (copied) {
      this.#hold = setTimeout(() => {
        this.#hold = null;
        this.#feedback.set('idle');
      }, COPIED_HOLD_MS);
    }
  }

  /** Hands the payload to the browser as a file, as the canvas's `DOWNLOAD`. */
  download(): boolean {
    const format = this.#format();
    if (format === 'link') {
      return false;
    }
    const payload = this.payload();
    if (payload.length === 0) {
      return false;
    }
    const file = FILES[format];
    return this.#downloads.dispatch(payload, file.name, file.type);
  }

  async share(): Promise<void> {
    const url = this.url();
    if (url === null) {
      return;
    }
    this.#stopHolding();
    // A dismissal and a failure are the same answer for a link: it did not
    // leave this way, so the one on screen is still the way out.
    const shared =
      (await this.#navigator.shareData({
        title: this.#messages.message('equipment.export.title'),
        url,
      })) === 'shared';
    this.#feedback.set(shared ? 'idle' : 'share-failed');
  }

  /** Encodes again, for a refusal that came from something transient. */
  retry(): void {
    this.#stopHolding();
    this.#feedback.set('idle');
    this.#link.publish();
  }

  #hold: ReturnType<typeof setTimeout> | null = null;

  #stopHolding(): void {
    if (this.#hold !== null) {
      clearTimeout(this.#hold);
      this.#hold = null;
    }
  }
}
