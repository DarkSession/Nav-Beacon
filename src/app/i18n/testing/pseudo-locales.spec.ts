import { TestBed } from '@angular/core/testing';
import { DocumentAdapter, type RootDocumentState } from '../../platform/browser/document.adapter';
import { provideIsolatedLocaleEnvironment } from './localization-harness';
import { provideLocalization } from '../i18n.providers';
import { BUNDLED_ENGLISH, MESSAGE_KEYS, SHIPPED_LOCALES } from '../locale-registry';
import { LocaleStore } from '../locale.store';
import { MessageService } from '../message.service';
import {
  PSEUDO_EXPANDED_TAG,
  PSEUDO_RTL_TAG,
  expandCopy,
  mirrorCopy,
  providePseudoLocale,
  pseudoCatalogue,
  pseudoInputs,
} from './pseudo-locales';

class RecordingDocumentAdapter {
  language = '';
  direction = '';
  title = '';

  commitRootState(state: RootDocumentState): void {
    this.language = state.language;
    this.direction = state.direction;
    this.title = state.title ?? this.title;
  }
}

function setup(mode: 'expanded-copy' | 'rtl' | null): {
  messages: MessageService;
  document: RecordingDocumentAdapter;
} {
  const document = new RecordingDocumentAdapter();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalization(),
      ...provideIsolatedLocaleEnvironment(),
      { provide: DocumentAdapter, useValue: document },
      ...providePseudoLocale(mode),
    ],
  });
  TestBed.inject(LocaleStore);
  return { messages: TestBed.inject(MessageService), document };
}

describe('expandCopy', () => {
  it('roughly doubles the length of a message', () => {
    const source = 'Save build';
    const expanded = expandCopy(source);

    expect(expanded.length).toBeGreaterThanOrEqual(source.length * 2);
  });

  it('leaves interpolation placeholders exactly as they were', () => {
    expect(expandCopy('{{page}} · {{app}}')).toContain('{{page}}');
    expect(expandCopy('{{page}} · {{app}}')).toContain('{{app}}');
  });

  it('accents the letters, so untranslated text is visible at a glance', () => {
    expect(expandCopy('Save')).not.toContain('Save');
  });

  it('leaves an empty string empty rather than padding nothing', () => {
    expect(expandCopy('')).toBe('');
  });

  it('leaves a glyph alone, because padding would give it words', () => {
    expect(expandCopy('▲')).toBe('▲');
    expect(expandCopy('+')).toBe('+');
  });
});

describe('mirrorCopy', () => {
  it('wraps the run in bidirectional override characters', () => {
    const mirrored = mirrorCopy('Save');

    expect(mirrored).toContain('Save');
    expect(mirrored).not.toBe('Save');
  });

  it('leaves interpolation placeholders outside the override', () => {
    expect(mirrorCopy('{{value}} CR')).toContain('{{value}}');
  });
});

describe('pseudoCatalogue', () => {
  it('keeps exactly the bundled key set', () => {
    const catalogue = pseudoCatalogue(BUNDLED_ENGLISH, 'expanded-copy');

    expect(Object.keys(catalogue).sort()).toEqual([...MESSAGE_KEYS].sort());
  });

  it('leaves no value blank', () => {
    const catalogue = pseudoCatalogue(BUNDLED_ENGLISH, 'rtl');

    expect(Object.values(catalogue).every((value) => value.trim().length > 0)).toBe(true);
  });

  it('returns the source untouched when nothing is applied', () => {
    expect(pseudoCatalogue(BUNDLED_ENGLISH, null)).toBe(BUNDLED_ENGLISH);
  });
});

describe('pseudoInputs', () => {
  it('transforms display strings, including nested ones', () => {
    const inputs = pseudoInputs(
      { label: 'Save', actions: [{ id: 'save', label: 'Save build' }] },
      'expanded-copy',
    );

    expect(inputs['label']).not.toBe('Save');
    const actions = inputs['actions'] as { id: string; label: string }[];
    expect(actions[0]?.label).not.toBe('Save build');
  });

  it('leaves a language tag alone, whatever the input is called', () => {
    const inputs = pseudoInputs(
      { language: 'en', reasonLanguage: 'en', sourceLocale: 'de' },
      'expanded-copy',
    );

    // An expanded `lang` is not a language, and a reader's software is right to
    // reject it — a failure the pseudo-locale would have invented.
    expect(inputs['language']).toBe('en');
    expect(inputs['reasonLanguage']).toBe('en');
    expect(inputs['sourceLocale']).toBe('de');
  });

  it('leaves values that address an element alone', () => {
    const inputs = pseudoInputs({ id: 'metric-1', href: '/builds', key: 'mass' }, 'expanded-copy');

    expect(inputs['id']).toBe('metric-1');
    expect(inputs['href']).toBe('/builds');
    expect(inputs['key']).toBe('mass');
  });

  it('leaves values that select a behaviour alone', () => {
    // Expanding one of these would not expose a layout problem — it would
    // invent one, by turning off the tone or emphasis the value selects.
    const inputs = pseudoInputs(
      { tone: 'error', emphasis: 'primary', language: 'en', tag: 'de' },
      'expanded-copy',
    );

    expect(inputs['tone']).toBe('error');
    expect(inputs['emphasis']).toBe('primary');
    // A mangled language tag would be an invalid `lang` attribute — a real
    // accessibility failure the pseudo-locale would have created itself.
    expect(inputs['language']).toBe('en');
    expect(inputs['tag']).toBe('de');
  });

  it('leaves a plate’s own structure alone, however deep it sits', () => {
    // A schematic plate reads `side` to place a mount and `kind` to treat it.
    // Expand either and the mount takes the wrong treatment or none — a failure
    // the pseudo-locale would have created rather than exposed.
    const inputs = pseudoInputs(
      {
        view: {
          side: 'top',
          hullName: 'Anaconda',
          occurrences: [
            { item: { key: 'SmallHardpoint1', kind: 'hardpoint', sides: ['top'] }, side: 'top' },
          ],
        },
      },
      'expanded-copy',
    );

    const view = inputs['view'] as {
      side: string;
      hullName: string;
      occurrences: { item: { kind: string; sides: string[] }; side: string }[];
    };
    expect(view.side).toBe('top');
    expect(view.occurrences[0]?.side).toBe('top');
    expect(view.occurrences[0]?.item.kind).toBe('hardpoint');
    expect(view.occurrences[0]?.item.sides).toEqual(['top']);
    // The hull's name is language, and still expands.
    expect(view.hullName).not.toBe('Anaconda');
  });

  it('keeps a sibling’s words as the sibling renders them', () => {
    const inputs = pseudoInputs(
      { columns: [{ label: 'Price Mcr', sortActionLabel: 'Sort by Price Mcr, ascending' }] },
      'expanded-copy',
    );

    // The accessible name still contains the visible label, filler and all.
    const [column] = inputs['columns'] as { label: string; sortActionLabel: string }[];
    expect(column?.label).toBe(expandCopy('Price Mcr'));
    expect(column?.sortActionLabel).toContain(column!.label);
  });

  it('quotes the label only as a whole word, and nothing but the label', () => {
    const inputs = pseudoInputs(
      { label: 'Size', hint: 'Sizes and sorts', mode: 'link', title: 'Share link' },
      'expanded-copy',
    );

    expect(inputs['hint']).toBe(expandCopy('Sizes and sorts'));
    expect(inputs['title']).toBe(expandCopy('Share link'));
  });

  it('leaves non-string values alone', () => {
    const inputs = pseudoInputs({ count: 3, selected: true }, 'rtl');

    expect(inputs['count']).toBe(3);
    expect(inputs['selected']).toBe(true);
  });
});

describe('providePseudoLocale', () => {
  it('provides nothing when no pseudo-locale is requested', () => {
    expect(providePseudoLocale(null)).toEqual([]);
  });

  it('publishes expanded copy through the ordinary message facade', () => {
    const { messages } = setup('expanded-copy');

    expect(messages.message('app.name')).not.toBe(BUNDLED_ENGLISH['app.name']);
    expect(messages.locale()).toBe(PSEUDO_EXPANDED_TAG);
  });

  it('publishes the right-to-left direction on the root document', () => {
    const { messages, document } = setup('rtl');

    expect(messages.direction()).toBe('rtl');
    TestBed.tick();
    expect(document.direction).toBe('rtl');
    expect(document.language).toBe(PSEUDO_RTL_TAG);
  });

  it('leaves the production locale registry alone', () => {
    // A pseudo-locale that could be selected would be a shipped locale, which
    // is precisely what these must never become (FR-017).
    const tags = SHIPPED_LOCALES.map((locale) => locale.tag);

    expect(tags).not.toContain(PSEUDO_EXPANDED_TAG);
    expect(tags).not.toContain(PSEUDO_RTL_TAG);
  });

  it('resolves ordinary English when nothing is applied', () => {
    const { messages } = setup(null);

    expect(messages.message('app.name')).toBe(BUNDLED_ENGLISH['app.name']);
  });
});
