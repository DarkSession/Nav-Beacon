import { DocumentAdapter } from '../../platform/browser/document.adapter';
import { LINK_CARD, absoluteAsset } from '../../platform/browser/site-address';
import { InjectionToken, Injectable, type Provider, computed, effect, inject } from '@angular/core';
import { LocaleStore } from '../locale.store';
import { type MessageCatalogue, type MessageKey } from '../locale-registry';

/**
 * Test-only pseudo-locales.
 *
 * Two conditions break more layouts than any real translation does: copy that
 * is much longer than English, and a reading direction that runs the other way.
 * Neither is observable in a build that ships only English and German, so both
 * are synthesised here (FR-014).
 *
 * These are **not shipped locales**. They are absent from `SHIPPED_LOCALES`,
 * cannot be selected by a Commander, cannot be persisted, and are reachable
 * only from the tooling-only preview application and the test suites. The
 * production registry is the single source of what can actually be chosen
 * (localization contract, "Production locale registry").
 *
 * The tags follow the conventional pseudo-locale identifiers so a reader who
 * has met them elsewhere recognises them: `en-XA` for expanded Latin copy and
 * `ar-XB` for forced right-to-left.
 */

/** The two synthetic conditions. `normal` applies nothing. */
export type PseudoLocaleMode = 'expanded-copy' | 'rtl';

/** Conventional pseudo-locale tag for expanded Latin copy. */
export const PSEUDO_EXPANDED_TAG = 'en-XA';

/** Conventional pseudo-locale tag for forced right-to-left rendering. */
export const PSEUDO_RTL_TAG = 'ar-XB';

/** The active pseudo mode, or `null` in the normal case. */
export const PSEUDO_LOCALE_MODE = new InjectionToken<PseudoLocaleMode | null>('PSEUDO_LOCALE_MODE');

/** Right-to-left override, so the run reads the way the mirrored text does. */
const RIGHT_TO_LEFT_OVERRIDE = '‮';

/** Pop directional formatting, closing the override above. */
const POP_DIRECTIONAL = '‬';

/**
 * Accented equivalents for the Latin alphabet.
 *
 * Accenting is what makes an untranslated string visible at a glance: a label
 * that still reads in plain ASCII in a pseudo-locale is a label that bypassed
 * the message facade.
 */
const ACCENTS: Readonly<Record<string, string>> = {
  a: 'ä',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ł',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: '９',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ł',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** A letter or digit: what makes a string copy rather than a glyph. */
const WORD = /[\p{L}\p{N}]/u;

/** Filler used to pad a message out to its expanded length. */
const FILLER = 'ëẋţŕä ŵöŕðš ţö ƒïłł ţĥé łïñé ';

/**
 * Interpolation placeholders are carried through untouched.
 *
 * Deliberately not `locale-registry`'s `PLACEHOLDER`: `split` needs the whole
 * placeholder captured rather than its name, and wrapping that pattern in a
 * second group would make `split` emit both. It must stay able to match
 * everything the shared one does — its inner class is a superset — so a
 * placeholder the runtime substitutes can never be pseudo-localized here.
 */
const PLACEHOLDER = /(\{\{[^}]*\}\})/g;

/**
 * Input names whose values are structure rather than something a reader reads.
 *
 * Two kinds live here: values that address an element — an id, a column key,
 * a URL — where transforming one side of a relationship silently breaks it;
 * values that select a behaviour from a fixed set — a tone, an emphasis, a
 * kind, a side — where an unrecognised string quietly turns the behaviour off.
 * A language tag is the first kind twice over: `lang="[éñ ëẋ]"` is not a
 * language, and a reader's software is entitled to say so — which is a failure
 * the pseudo-locale invented rather than one it found.
 * A schematic plate is the second kind: expand the `side` a mount is drawn on
 * or the `kind` it is, and the mount takes the wrong treatment or none. Both
 * would be a failure the pseudo-locale invented rather than one it exposed.
 */
const STRUCTURAL_KEY =
  /^(?:id|for|href|src|address|key|kind|kinds|side|sides|role|type|state|tone|urgency|variant|emphasis|presentation|direction|lang|language|locale|tag|translationState|.*Id|.*Ids|.*Key|.*Keys|.*Language|.*Locale)$/;

/**
 * Expands one string to roughly twice its length.
 *
 * Placeholders are preserved exactly, because an expanded copy that also
 * mangled `{{count}}` would fail for a reason that has nothing to do with
 * layout. The brackets mark both ends, so a string that is cut off is visibly
 * cut off rather than merely short.
 *
 * A string with no letter or digit in it — a caret, a `+` — is a glyph rather
 * than copy, and is left as it is: padded, it would gain words that the real
 * glyph never has.
 */
export function expandCopy(text: string): string {
  if (!WORD.test(text)) {
    return text;
  }

  const accented = text
    .split(PLACEHOLDER)
    .map((segment) =>
      segment.startsWith('{{')
        ? segment
        : [...segment].map((character) => ACCENTS[character] ?? character).join(''),
    )
    .join('');

  const wanted = Math.max(0, text.length * 2 - accented.length);
  const padding =
    wanted === 0
      ? ''
      : ` ${FILLER.repeat(Math.ceil(wanted / FILLER.length))
          .slice(0, wanted)
          .trim()}`;

  return `[${accented}${padding}]`;
}

/**
 * Forces one string to render right-to-left.
 *
 * The characters are unchanged; only the resolved direction of the run is. That
 * is what exercises bidi handling honestly — a Latin string reordered by a
 * right-to-left context is exactly the case an unisolated technical identifier
 * fails.
 */
export function mirrorCopy(text: string): string {
  if (text.length === 0) {
    return text;
  }

  return text
    .split(PLACEHOLDER)
    .map((segment) =>
      segment.startsWith('{{') ? segment : `${RIGHT_TO_LEFT_OVERRIDE}${segment}${POP_DIRECTIONAL}`,
    )
    .join('');
}

/** The transform one mode applies to a single string. */
export function pseudoText(text: string, mode: PseudoLocaleMode | null): string {
  if (mode === 'expanded-copy') {
    return expandCopy(text);
  }
  if (mode === 'rtl') {
    return mirrorCopy(text);
  }
  return text;
}

/** The direction one mode reads in. */
export function pseudoDirection(mode: PseudoLocaleMode | null): 'ltr' | 'rtl' {
  return mode === 'rtl' ? 'rtl' : 'ltr';
}

/** The synthetic tag one mode publishes, or `null` when nothing is applied. */
export function pseudoTag(mode: PseudoLocaleMode | null): string | null {
  if (mode === 'expanded-copy') {
    return PSEUDO_EXPANDED_TAG;
  }
  if (mode === 'rtl') {
    return PSEUDO_RTL_TAG;
  }
  return null;
}

/** A complete catalogue with every value transformed and every key intact. */
export function pseudoCatalogue(
  source: MessageCatalogue,
  mode: PseudoLocaleMode | null,
): MessageCatalogue {
  if (mode === null) {
    return source;
  }

  const entries = Object.entries(source).map(([key, value]) => [key, pseudoText(value, mode)]);
  return Object.fromEntries(entries) as Record<MessageKey, string>;
}

/**
 * Component inputs with their display strings transformed.
 *
 * Preview fixtures pass display text to components directly rather than through
 * the catalogue — that is what makes a component presentation-only — so the
 * pseudo-locale has to reach them here as well, or a catalogue-only transform
 * would leave the rendered components in plain English.
 *
 * Values that are structure rather than language are left alone: expanding an
 * id breaks the relationship it exists to express, and expanding a tone turns
 * the behaviour it selects off.
 */
export function pseudoInputs(
  inputs: Readonly<Record<string, unknown>>,
  mode: PseudoLocaleMode | null,
): Record<string, unknown> {
  if (mode === null) {
    return { ...inputs };
  }

  // A string that repeats its sibling `label` — an action label that names the
  // visible label beside it — keeps the label as the label renders, the way a
  // message keeps a placeholder. Expanded apart, each would gain its own filler,
  // and the accessible name would stop containing the visible label: a failure
  // the pseudo-locale invented rather than one it found.
  const record = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const label = fields['label'];
    const quotable = typeof label === 'string' && WORD.test(label) ? label : null;

    return Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (
          quotable === null ||
          key === 'label' ||
          typeof value !== 'string' ||
          value === quotable ||
          STRUCTURAL_KEY.test(key)
        ) {
          return [key, transform(key, value)];
        }
        const parts = value.split(wholeWord(quotable));
        if (parts.length === 1) {
          return [key, transform(key, value)];
        }
        const marker = '{{label}}';
        return [
          key,
          pseudoText(parts.join(marker), mode).replaceAll(marker, pseudoText(quotable, mode)),
        ];
      }),
    );
  };

  const transform = (key: string, value: unknown): unknown => {
    if (STRUCTURAL_KEY.test(key)) {
      return value;
    }
    if (typeof value === 'string') {
      return pseudoText(value, mode);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => transform(key, entry));
    }
    if (typeof value === 'object' && value !== null) {
      return record(value as Record<string, unknown>);
    }
    return value;
  };

  return record(inputs);
}

/** Every occurrence of `words` that is not part of a longer word. */
function wholeWord(words: string): RegExp {
  const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}

/**
 * A locale store that publishes a pseudo-locale over whatever was committed.
 *
 * It overrides only what a reader observes — the catalogue, the direction and
 * the published tag — and leaves selection, validation and the atomic commit
 * exactly as the production store implements them. That is deliberate: the
 * point of a pseudo-locale run is to exercise the real commit path, not a
 * parallel one that might not have the same behaviour.
 */
@Injectable()
export class PseudoLocaleStore extends LocaleStore {
  readonly #mode = inject(PSEUDO_LOCALE_MODE);
  readonly #root = inject(DocumentAdapter);

  override readonly catalogue = computed<MessageCatalogue>(() =>
    pseudoCatalogue(this.snapshot().catalogue, this.#mode),
  );

  override readonly direction = computed<'ltr' | 'rtl'>(() => pseudoDirection(this.#mode));

  override readonly effectiveLocale = computed<string>(
    () => pseudoTag(this.#mode) ?? this.snapshot().effectiveLocale,
  );

  constructor() {
    super();

    // Root `lang` and `dir` are document-level: setting direction on a
    // container alone leaves the scrollbar, the caret and every ancestor box
    // reading the other way, which is not the condition under test.
    effect(() => {
      this.#root.commitRootState({
        language: this.effectiveLocale(),
        direction: this.direction(),
        title: this.catalogue()['app.document-title.default'],
        description: this.catalogue()['app.description'],
        canonical: this.canonical(),
        image: absoluteAsset(LINK_CARD),
        imageAlt: this.catalogue()['app.document-title.default'],
      });
    });
  }
}

/**
 * Providers applying one pseudo-locale.
 *
 * Returns nothing for the normal case, so a caller can pass the variant through
 * unconditionally without branching. Registered only by the preview application
 * and by tests; no production configuration references it.
 */
export function providePseudoLocale(mode: PseudoLocaleMode | null): Provider[] {
  if (mode === null) {
    return [];
  }

  return [
    { provide: PSEUDO_LOCALE_MODE, useValue: mode },
    { provide: LocaleStore, useClass: PseudoLocaleStore },
  ];
}
