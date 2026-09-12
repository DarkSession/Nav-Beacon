import type { ComponentFixture } from '@angular/core/testing';
import type { SynchronisationPanelView } from '../../application/synchronisation/synchronisation.presenter';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import {
  accessibleName,
  element,
  query,
  renderComponent,
  textOf,
  visibleTextOf,
} from '../../ui/components/ui-component.spec-helpers';
import { SynchronisationPanel } from './synchronisation-panel.component';

/**
 * The five layout profiles the browser matrix runs, both orientations included.
 *
 * The same five viewports `playwright.config.ts` generates its ten projects
 * from, restated here rather than imported: a unit spec may not reach into the
 * end-to-end sources (`e2e/coverage-ledger.ts`, LAYOUT_PROFILES).
 */
const LAYOUT_PROFILES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet portrait', width: 834, height: 1112 },
  { name: 'tablet landscape', width: 1112, height: 834 },
  { name: 'mobile portrait', width: 390, height: 844 },
  { name: 'mobile landscape', width: 844, height: 390 },
] as const;

const INSTANT = '12 Sep 2026, 09:41';
const RECORD = 'Deep space explorer';

/**
 * One counted catalogue sentence in the form its count calls for, as the
 * presenter chooses it: the singular spells the one out, the plural carries the
 * number.
 */
function counted(stem: string, count: number): string {
  const key = `${stem}.${count === 1 ? 'one' : 'many'}` as keyof typeof BUNDLED_ENGLISH;
  return BUNDLED_ENGLISH[key].replace('{{count}}', String(count));
}

const CURRENT = {
  tone: 'success',
  message: BUNDLED_ENGLISH['sync.status.current'].replace('{{when}}', INSTANT),
} as const;

function view(overrides: Partial<SynchronisationPanelView> = {}): SynchronisationPanelView {
  return {
    heading: BUNDLED_ENGLISH['sync.title'],
    status: { tone: 'info', message: BUNDLED_ENGLISH['sync.status.local-only'] },
    detail: null,
    retry: null,
    notes: [],
    conflict: null,
    ...overrides,
  };
}

const ANSWERS = [
  {
    choice: 'overwrite',
    label: BUNDLED_ENGLISH['sync.conflict.overwrite'],
    emphasis: 'primary',
  },
  {
    choice: 'keep-both',
    label: BUNDLED_ENGLISH['sync.conflict.keep-both'],
    emphasis: 'secondary',
  },
  {
    choice: 'cancel',
    label: BUNDLED_ENGLISH['sync.conflict.cancel'],
    emphasis: 'secondary',
  },
] as const;

function conflict(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'record-1',
    title: BUNDLED_ENGLISH['sync.conflict.stale.title'],
    description: BUNDLED_ENGLISH['sync.conflict.stale.description'],
    recordLabel: BUNDLED_ENGLISH['sync.conflict.record'].replace('{{name}}', RECORD),
    answers: [...ANSWERS],
    dismiss: BUNDLED_ENGLISH['action.close'],
    ...overrides,
  } as SynchronisationPanelView['conflict'];
}

/**
 * Every state design decision 10 gives the two record libraries.
 *
 * Ten rows for the ten states the screen inventory names: local only, first
 * merge, current, pending, failed, account-bound, local-only, the two conflicts
 * and an unsupported remote version.
 */
const STATES: readonly { readonly name: string; readonly view: SynchronisationPanelView }[] = [
  { name: 'local only', view: view() },
  {
    name: 'first merge',
    view: view({
      status: { tone: 'loading', message: BUNDLED_ENGLISH['sync.status.merging'] },
    }),
  },
  { name: 'current', view: view({ status: CURRENT }) },
  {
    name: 'pending',
    view: view({
      status: { tone: 'warning', message: counted('sync.status.pending', 2) },
    }),
  },
  {
    name: 'failed',
    view: view({
      status: { tone: 'error', message: BUNDLED_ENGLISH['sync.status.failed.offline'] },
      detail: counted('sync.status.failed.pending', 2),
      retry: BUNDLED_ENGLISH['action.retry'],
    }),
  },
  {
    name: 'account-bound records',
    view: view({
      status: CURRENT,
      notes: [
        { id: 'account-bound', tone: 'info', message: counted('sync.note.account-bound', 2) },
      ],
    }),
  },
  {
    name: 'local-only records',
    view: view({
      status: CURRENT,
      notes: [{ id: 'local-only', tone: 'info', message: counted('sync.note.local-only', 3) }],
    }),
  },
  {
    name: 'unsupported remote version',
    view: view({
      status: CURRENT,
      notes: [
        {
          id: 'unsupported-version',
          tone: 'warning',
          message: counted('sync.note.unsupported-version', 1),
        },
      ],
    }),
  },
  {
    name: 'stale-write conflict',
    view: view({
      status: { tone: 'warning', message: counted('sync.status.conflicted', 1) },
      conflict: conflict(),
    }),
  },
  {
    name: 'remote deletion conflict',
    view: view({
      status: { tone: 'warning', message: counted('sync.status.conflicted', 1) },
      conflict: conflict({
        title: BUNDLED_ENGLISH['sync.conflict.deleted.title'],
        description: BUNDLED_ENGLISH['sync.conflict.deleted.description'],
      }),
    }),
  },
];

/**
 * `<dialog>` without the native modal methods, which jsdom does not implement.
 *
 * The conflict layer calls them the moment it opens. What these tests are
 * about is the content, its reading order and the rules it is drawn under; the
 * Playwright suite covers the real element at all five profiles.
 */
function stubNativeDialog(): void {
  const prototype = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  prototype['showModal'] = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  prototype['close'] = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

function render(state: SynchronisationPanelView): ComponentFixture<SynchronisationPanel> {
  stubNativeDialog();
  return renderComponent(SynchronisationPanel, { view: state });
}

/** The region itself, without the layer that may be raised over it. */
function region(fixture: ComponentFixture<SynchronisationPanel>): HTMLElement {
  return query(fixture, '.sync');
}

/** Every control a Commander can press in this state, region and layer alike. */
function controls(fixture: ComponentFixture<SynchronisationPanel>): readonly HTMLButtonElement[] {
  return [
    ...element(fixture).querySelectorAll<HTMLButtonElement>('.sync button, dialog[open] button'),
  ];
}

/** Every sentence the state puts on screen, region and layer together. */
function said(fixture: ComponentFixture<SynchronisationPanel>): string {
  const layer = element(fixture).querySelector('dialog[open]');
  return `${textOf(region(fixture))} ${layer === null ? '' : textOf(layer)}`.trim();
}

function atViewport(
  profile: { width: number; height: number },
  state: SynchronisationPanelView,
): ComponentFixture<SynchronisationPanel> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: profile.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: profile.height });
  window.dispatchEvent(new Event('resize'));
  return render(state);
}

/**
 * Every declaration this component's own stylesheet makes, media rules and all.
 *
 * Read off the rendered document rather than off the file, so it is the CSS the
 * browser was handed. The design-system parts the panel composes are left out:
 * each has its own preview and its own assertions.
 */
function ownDeclarations(): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];

  const visit = (rule: CSSRule) => {
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText === 'string' && /\.sync\b/.test(style.selectorText)) {
      found.push({ selector: style.selectorText, body: style.style.cssText });
    }
    const group = rule as CSSGroupingRule;
    if (group.cssRules) {
      for (const nested of [...group.cssRules]) {
        visit(nested);
      }
    }
  };

  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      visit(rule);
    }
  }
  return found;
}

describe('SynchronisationPanel', () => {
  it('is one region, named by its own visible heading', () => {
    const fixture = render(STATES[2].view);
    const heading = region(fixture).querySelector('.sync__heading');

    expect(heading?.tagName.toLowerCase()).toBe('h3');
    expect(textOf(heading)).toBe(BUNDLED_ENGLISH['sync.title']);
    expect(accessibleName(region(fixture))).toBe(BUNDLED_ENGLISH['sync.title']);
  });

  describe('every state in the screen inventory', () => {
    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'says what %s means, in words',
      (name, state) => {
        const fixture = render(state);
        const notice = region(fixture).querySelector('ednb-status-notice');

        // The tone is a second rendering of the sentence, never the only one.
        expect(notice, name).not.toBeNull();
        expect(textOf(notice), name).toContain(state.status.message);
      },
    );

    it('draws each note as its own sentence, named by the set it is about', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const notes = [...region(fixture).querySelectorAll('[data-sync-note]')];

        expect(
          notes.map((note) => note.getAttribute('data-sync-note')),
          name,
        ).toEqual(state.notes.map((note) => note.id));
        for (const [index, note] of notes.entries()) {
          expect(textOf(note), `${name}: ${note.getAttribute('data-sync-note')}`).toContain(
            state.notes[index].message,
          );
        }
      }
    });

    it('states the supporting detail of a failure beside its sentence', () => {
      const fixture = render(STATES[4].view);

      expect(textOf(region(fixture))).toContain(counted('sync.status.failed.pending', 2));
    });

    it('offers another attempt only where there is something to retry', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const retry = region(fixture).querySelector('.sync__actions button');

        if (state.retry === null) {
          expect(retry, name).toBeNull();
        } else {
          expect(visibleTextOf(retry), name).toBe(state.retry);
        }
      }
    });

    it('raises the conflict question over the library, and only where one stands', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const open = [...element(fixture).querySelectorAll<HTMLDialogElement>('dialog[open]')];

        if (state.conflict === null) {
          expect(open.length, name).toBe(0);
          continue;
        }
        expect(open.length, name).toBe(1);
        expect(accessibleName(open[0]), name).toBe(state.conflict.title);
        expect(textOf(open[0]), name).toContain(state.conflict.description);
        expect(textOf(open[0]), name).toContain(state.conflict.recordLabel);
      }
    });

    it('offers all three answers, by their visible names, in both conflicts', () => {
      for (const state of [STATES[8].view, STATES[9].view]) {
        const fixture = render(state);
        const answers = [...element(fixture).querySelectorAll<HTMLElement>('.sync__answer button')];

        expect(answers.map((answer) => visibleTextOf(answer))).toEqual(
          ANSWERS.map((answer) => answer.label),
        );
      }
    });

    it('says the same thing on screen as it says to a reader', () => {
      for (const { name, view: state } of STATES) {
        for (const control of controls(render(state))) {
          expect(accessibleName(control), `${name}: ${control.className}`).toBe(
            visibleTextOf(control),
          );
        }
      }
    });

    it('tells the ten states apart by their words alone', () => {
      // Nothing here is carried by colour: strip every class and attribute a
      // tone could be drawn from, and the ten states are still ten sentences.
      const sentences = STATES.map((entry) => said(render(entry.view)));

      expect(new Set(sentences).size).toBe(STATES.length);
      for (const [index, sentence] of sentences.entries()) {
        expect(sentence, STATES[index].name).not.toBe('');
      }
    });
  });

  describe('at every width, in both orientations', () => {
    function drawnAt(state: SynchronisationPanelView) {
      return LAYOUT_PROFILES.map((profile) => {
        const fixture = atViewport(profile, state);
        return {
          profile: profile.name,
          // Relation ids are minted per instance, so they say which render this
          // is rather than what it drew. Everything else is compared.
          markup: element(fixture)
            .innerHTML.replace(/ id="[^"]*"/g, '')
            .replace(/ aria-labelledby="[^"]*"/g, '')
            .replace(/ aria-describedby="[^"]*"/g, ''),
          controls: controls(fixture).map((control) => ({
            name: accessibleName(control),
            target: getComputedStyle(control).minBlockSize,
          })),
        };
      });
    }

    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'draws %s the same way at every profile, with the same touch-sized controls',
      (name, state) => {
        const drawn = drawnAt(state);

        // One DOM at every profile. Nothing on this surface is decided by
        // reading the viewport in TypeScript, so the width a Commander happens
        // to be at cannot drop a control, reorder the region or say less.
        expect(new Set(drawn.map((entry) => entry.markup)).size, name).toBe(1);

        for (const entry of drawn) {
          expect(
            entry.controls.map((control) => control.name),
            `${name} at ${entry.profile}`,
          ).toEqual(drawn[0].controls.map((control) => control.name));

          for (const control of entry.controls) {
            // The baseline is a token in `rem`, so the target grows with the
            // text rather than holding a pixel box at 200% (2.75rem is 44 CSS
            // pixels at the default text size).
            expect(control.target, `${name} at ${entry.profile}: ${control.name}`).toBe(
              'var(--ednb-target-size)',
            );
          }
        }
      },
    );

    it('offers a control in every state that has one to offer', () => {
      for (const { name, view: state } of STATES) {
        const drawn = controls(render(state));
        const expected = (state.retry === null ? 0 : 1) + (state.conflict === null ? 0 : 3);

        expect(
          drawn.filter((control) => !control.classList.contains('layer__dismiss')).length,
          name,
        ).toBe(expected);
      }
    });
  });

  describe('what keeps the page from scrolling sideways', () => {
    it('states every length as a token, so nothing is pinned to a pixel box', () => {
      render(STATES[4].view);
      const declared = ownDeclarations();

      expect(declared.length).toBeGreaterThan(0);
      for (const { selector, body } of declared) {
        expect(body.replace(/\bvar\([^)]*\)/g, ''), selector).not.toMatch(
          /\b[1-9]\d*(\.\d+)?(px|pt|cm|in|pc|mm)\b/,
        );
      }
    });

    it('wraps its rows of actions rather than letting them run past the panel', () => {
      expect(getComputedStyle(query(render(STATES[4].view), '.sync__actions')).flexWrap).toBe(
        'wrap',
      );
      expect(getComputedStyle(query(render(STATES[8].view), '.sync__answers')).flexWrap).toBe(
        'wrap',
      );
    });

    it('wraps the long words it does not own — a record name and a sentence', () => {
      const fixture = render(STATES[7].view);

      for (const selector of ['.sync__status', '.sync__note']) {
        expect(getComputedStyle(query(fixture, selector)).overflowWrap, selector).toBe('anywhere');
      }
    });

    it('asks no region of its own to scroll sideways', () => {
      render(STATES[2].view);

      for (const { selector, body } of ownDeclarations()) {
        expect(body, selector).not.toContain('overflow-x');
        expect(body, selector).not.toContain('white-space: nowrap');
      }
    });
  });

  describe('at 200% text', () => {
    /** The root text size a Commander reading at 200% has set. */
    function withDoubledText<T>(read: () => T): T {
      const root = document.documentElement;
      const before = root.style.fontSize;
      root.style.fontSize = '32px';
      try {
        return read();
      } finally {
        root.style.fontSize = before;
      }
    }

    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'says everything %s said, and offers everything it offered',
      (name, state) => {
        const plain = render(state);
        const expected = {
          text: said(plain),
          controls: controls(plain).map((control) => accessibleName(control)),
        };

        const doubled = withDoubledText(() => {
          const fixture = render(state);
          return {
            text: said(fixture),
            controls: controls(fixture).map((control) => accessibleName(control)),
          };
        });

        expect(doubled, name).toEqual(expected);
      },
    );
  });

  describe('the intents it emits', () => {
    it('asks for another attempt rather than making one', () => {
      const fixture = render(STATES[4].view);
      let asked = 0;
      fixture.componentInstance.retryRequested.subscribe(() => {
        asked += 1;
      });

      query(fixture, '.sync__actions button').click();

      expect(asked).toBe(1);
    });

    it('names the answer a Commander chose rather than acting on it', () => {
      const fixture = render(STATES[8].view);
      const chosen: string[] = [];
      fixture.componentInstance.answered.subscribe((choice) => chosen.push(choice));

      for (const answer of element(fixture).querySelectorAll<HTMLElement>('.sync__answer button')) {
        answer.click();
      }

      expect(chosen).toEqual(['overwrite', 'keep-both', 'cancel']);
    });

    it('treats dismissal as no answer at all', () => {
      const fixture = render(STATES[9].view);
      const events: string[] = [];
      fixture.componentInstance.conflictDismissed.subscribe(() => events.push('dismissed'));
      fixture.componentInstance.answered.subscribe(() => events.push('answered'));

      query(fixture, '.layer__dismiss').click();

      expect(events).toEqual(['dismissed']);
    });
  });
});
