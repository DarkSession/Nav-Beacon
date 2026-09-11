import type { ComponentFixture } from '@angular/core/testing';
import type {
  OwnedShipsState,
  OwnedShipsView,
  PackageRefusalView,
} from '../../application/fleet/fleet.presenter';
import { routes } from '../../app.routes';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';
import GERMAN from '../../i18n/locales/de.json';
import {
  accessibleName,
  element,
  query,
  renderComponent,
  textOf,
  visibleTextOf,
} from '../../ui/components/ui-component.spec-helpers';
import { OwnedShipsPanel } from './owned-ships-panel.component';

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

const SHIP = 'Bright Anvil';
const HULL = 'Anaconda';
const DAY = '14 Aug 2026';

/** The package's own structured refusal, exactly as the service carried it. */
const PACKAGE_REFUSAL = {
  code: 'slot-unknown',
  constraint: 'slots',
  path: 'Modules[4].Slot',
} as const;

function fill(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, value),
    template,
  );
}

function ships(selected = false): OwnedShipsView['ships'] {
  return [
    {
      id: '12',
      label: SHIP,
      detail: fill(BUNDLED_ENGLISH['fleet.row.detail'], { hull: HULL, when: DAY }),
      selected,
    },
  ];
}

function facts(): OwnedShipsView['facts'] {
  return [
    { id: 'hull', label: BUNDLED_ENGLISH['fleet.fact.hull'], value: HULL, unit: '' },
    { id: 'ident', label: BUNDLED_ENGLISH['fleet.fact.ident'], value: 'BA-01', unit: '' },
    { id: 'source', label: BUNDLED_ENGLISH['fleet.fact.source'], value: DAY, unit: '' },
  ];
}

/** The refusal as one catalogue writes it, with the package's answer unchanged. */
function refusalIn(
  catalogue: Record<string, string>,
  message: string | null = null,
): PackageRefusalView {
  return {
    heading: catalogue['fleet.refusal.title'],
    message,
    absentMessage: message === null ? catalogue['fleet.refusal.no-message'] : null,
    facts: [
      { id: 'code', label: catalogue['fleet.refusal.code'], value: PACKAGE_REFUSAL.code, unit: '' },
      {
        id: 'constraint',
        label: catalogue['fleet.refusal.constraint'],
        value: PACKAGE_REFUSAL.constraint,
        unit: '',
      },
      { id: 'path', label: catalogue['fleet.refusal.path'], value: PACKAGE_REFUSAL.path, unit: '' },
    ],
  };
}

function view(overrides: Partial<OwnedShipsView> = {}): OwnedShipsView {
  return {
    state: 'current',
    heading: BUNDLED_ENGLISH['fleet.title'],
    status: { tone: 'success', message: BUNDLED_ENGLISH['fleet.status.current'] },
    detail: null,
    coverage: null,
    listLabel: BUNDLED_ENGLISH['fleet.list.label'],
    chosenLabel: BUNDLED_ENGLISH['fleet.list.chosen'],
    ships: ships(),
    emptyLabel: null,
    selectedLabel: null,
    facts: [],
    unresolved: [],
    refusal: null,
    refresh: BUNDLED_ENGLISH['fleet.refresh'],
    refreshing: false,
    signIn: null,
    copy: null,
    ...overrides,
  };
}

/**
 * Every state design decision 10 gives the owned-ships view.
 *
 * Nine rows for the nine the screen inventory names: sign-in required, loading,
 * current, incomplete coverage, no confirmed ships, waiting for Frontier,
 * failed refresh, expired authorisation and a refused package identity.
 */
const STATES: readonly { readonly name: OwnedShipsState; readonly view: OwnedShipsView }[] = [
  {
    name: 'sign-in-required',
    view: view({
      state: 'sign-in-required',
      status: { tone: 'info', message: BUNDLED_ENGLISH['fleet.status.sign-in-required'] },
      ships: [],
      refresh: null,
      signIn: BUNDLED_ENGLISH['account.sign-in'],
    }),
  },
  {
    name: 'loading',
    view: view({
      state: 'loading',
      status: { tone: 'loading', message: BUNDLED_ENGLISH['fleet.status.loading'] },
      ships: [],
      emptyLabel: BUNDLED_ENGLISH['fleet.list.empty'],
    }),
  },
  {
    name: 'current',
    view: view({
      coverage: fill(BUNDLED_ENGLISH['fleet.coverage'], { from: '01 Jul 2026', to: DAY }),
      ships: ships(true),
      selectedLabel: fill(BUNDLED_ENGLISH['fleet.facts.label'], { ship: SHIP }),
      facts: facts(),
      copy: BUNDLED_ENGLISH['fleet.copy'],
    }),
  },
  {
    name: 'incomplete',
    view: view({
      state: 'incomplete',
      status: { tone: 'warning', message: BUNDLED_ENGLISH['fleet.status.incomplete'] },
      detail: BUNDLED_ENGLISH['fleet.detail.pending'],
      coverage: fill(BUNDLED_ENGLISH['fleet.coverage'], { from: '01 Jul 2026', to: DAY }),
      unresolved: [
        {
          id: 'refused-19',
          message: fill(BUNDLED_ENGLISH['fleet.unresolved'], {
            reason: 'Unknown module symbol Int_Powerplant_Size9_Class6.',
          }),
        },
      ],
    }),
  },
  {
    name: 'empty',
    view: view({
      state: 'empty',
      status: { tone: 'info', message: BUNDLED_ENGLISH['fleet.status.empty'] },
      ships: [],
      emptyLabel: BUNDLED_ENGLISH['fleet.list.empty'],
    }),
  },
  {
    name: 'waiting',
    view: view({
      state: 'waiting',
      status: { tone: 'warning', message: BUNDLED_ENGLISH['fleet.status.waiting'] },
      detail: fill(BUNDLED_ENGLISH['fleet.detail.waiting.until'], {
        when: '14 Aug 2026, 09:41',
      }),
    }),
  },
  {
    name: 'failed',
    view: view({
      state: 'failed',
      status: { tone: 'error', message: BUNDLED_ENGLISH['fleet.status.failed.frontier'] },
      detail: BUNDLED_ENGLISH['fleet.detail.last-accepted'],
    }),
  },
  {
    name: 'authorisation-expired',
    view: view({
      state: 'authorisation-expired',
      status: { tone: 'error', message: BUNDLED_ENGLISH['fleet.status.authorisation-expired'] },
      detail: BUNDLED_ENGLISH['fleet.detail.last-accepted'],
    }),
  },
  {
    name: 'package-refused',
    view: view({
      state: 'package-refused',
      status: { tone: 'error', message: BUNDLED_ENGLISH['fleet.status.package-refused'] },
      detail: BUNDLED_ENGLISH['fleet.detail.last-accepted'],
      refusal: refusalIn(BUNDLED_ENGLISH),
    }),
  },
];

function render(state: OwnedShipsView): ComponentFixture<OwnedShipsPanel> {
  return renderComponent(OwnedShipsPanel, { view: state });
}

function region(fixture: ComponentFixture<OwnedShipsPanel>): HTMLElement {
  return query(fixture, '.fleet');
}

/** Every control a Commander can press in this state. */
function controls(fixture: ComponentFixture<OwnedShipsPanel>): readonly HTMLElement[] {
  return [...region(fixture).querySelectorAll<HTMLElement>('button, [role="button"]')];
}

/** Every sentence the state puts on screen. */
function said(fixture: ComponentFixture<OwnedShipsPanel>): string {
  return textOf(region(fixture));
}

function atViewport(
  profile: { width: number; height: number },
  state: OwnedShipsView,
): ComponentFixture<OwnedShipsPanel> {
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
    if (typeof style.selectorText === 'string' && /\.fleet\b/.test(style.selectorText)) {
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

describe('OwnedShipsPanel', () => {
  it('is one region, named by its own visible heading', () => {
    const fixture = render(view());
    const heading = region(fixture).querySelector('.fleet__heading');

    expect(heading?.tagName.toLowerCase()).toBe('h3');
    expect(textOf(heading)).toBe(BUNDLED_ENGLISH['fleet.title']);
    expect(accessibleName(region(fixture))).toBe(BUNDLED_ENGLISH['fleet.title']);
  });

  describe('every state in the screen inventory', () => {
    it('covers the nine design decision 10 names, once each', () => {
      const named: readonly OwnedShipsState[] = [
        'sign-in-required',
        'loading',
        'current',
        'incomplete',
        'empty',
        'waiting',
        'failed',
        'authorisation-expired',
        'package-refused',
      ];

      expect(STATES.map((entry) => entry.name)).toEqual(named);
    });

    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'says what %s means, in words',
      (name, state) => {
        const fixture = render(state);
        const notice = region(fixture).querySelector('ednb-status-notice');

        // The tone is a second rendering of the sentence, never the only one.
        expect(notice, name).not.toBeNull();
        expect(textOf(notice), name).toContain(state.status.message);
        if (state.detail !== null) {
          expect(said(fixture), name).toContain(state.detail);
        }
      },
    );

    it('states what journal history the fleet was read from, where there is any', () => {
      for (const { name, view: state } of STATES) {
        const drawn = element(render(state)).querySelector('.fleet__coverage');

        expect(textOf(drawn), name).toBe(state.coverage ?? '');
      }
    });

    it('lists a ship the package would not rebuild rather than dropping it', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const notices = [...region(fixture).querySelectorAll('[data-fleet-unresolved]')];

        expect(
          notices.map((notice) => notice.getAttribute('data-fleet-unresolved')),
          name,
        ).toEqual(state.unresolved.map((entry) => entry.id));
        for (const [index, notice] of notices.entries()) {
          expect(textOf(notice), name).toContain(state.unresolved[index].message);
        }
      }
    });

    it('draws a list of ships in every state but the one with no account', () => {
      for (const { name, view: state } of STATES) {
        const list = element(render(state)).querySelector('ednb-collection');

        expect(list === null, name).toBe(state.state === 'sign-in-required');
      }
    });

    it('names the chosen ship in visible text, not by a tint alone', () => {
      const fixture = render(STATES[2].view);

      // The row says it is the chosen one in words, and the facts beside it are
      // named by the ship they are about.
      expect(said(fixture)).toContain(BUNDLED_ENGLISH['fleet.list.chosen']);
      const named = fill(BUNDLED_ENGLISH['fleet.facts.label'], { ship: SHIP });
      expect(textOf(query(fixture, '.fleet__facts-heading'))).toBe(named);
      expect(accessibleName(query(fixture, '.fleet__facts dl'))).toBe(named);
    });

    it('offers the copy only where a ship is chosen, and the sign-in only where there is no account', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const drawn = controls(fixture).map((control) => visibleTextOf(control));

        expect(drawn.includes(BUNDLED_ENGLISH['fleet.copy']), `${name}: copy`).toBe(
          state.copy !== null,
        );
        expect(drawn.includes(BUNDLED_ENGLISH['account.sign-in']), `${name}: sign in`).toBe(
          state.signIn !== null,
        );
        expect(drawn.includes(BUNDLED_ENGLISH['fleet.refresh']), `${name}: refresh`).toBe(
          state.refresh !== null,
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

    it('tells the nine states apart by their words alone', () => {
      // Nothing here is carried by colour: read only the text, and the nine
      // states are still nine different sentences.
      const sentences = STATES.map((entry) => said(render(entry.view)));

      expect(new Set(sentences).size).toBe(STATES.length);
      for (const [index, sentence] of sentences.entries()) {
        expect(sentence, STATES[index].name).not.toBe('');
      }
    });
  });

  describe('what the installed game data refused, in each supported locale', () => {
    const LOCALES = [
      { name: 'English', catalogue: BUNDLED_ENGLISH as unknown as Record<string, string> },
      { name: 'German', catalogue: GERMAN as unknown as Record<string, string> },
    ] as const;

    it.each(LOCALES.map((locale) => [locale.name, locale.catalogue] as const))(
      'states the absence of a package message in %s, in this application own words',
      (name, catalogue) => {
        const fixture = render(view({ state: 'package-refused', refusal: refusalIn(catalogue) }));

        expect(said(fixture), name).toContain(catalogue['fleet.refusal.no-message']);
        expect(said(fixture), name).toContain(catalogue['fleet.refusal.title']);
      },
    );

    it('shows the package refusal unchanged, in both locales, word for word the same', () => {
      const drawn = LOCALES.map(({ catalogue }) => {
        const fixture = render(view({ state: 'package-refused', refusal: refusalIn(catalogue) }));
        const values = [
          ...query(fixture, '.fleet__refusal').querySelectorAll('ednb-fact-list dd'),
        ].map((value) => textOf(value));
        return values;
      });

      // The package's own code, constraint and path. Not translated, not
      // reworded and not reordered: what the game data answered is what is
      // shown, whichever language the sentences around it are in.
      for (const values of drawn) {
        expect(values).toContain(PACKAGE_REFUSAL.code);
        expect(values).toContain(PACKAGE_REFUSAL.constraint);
        expect(values).toContain(PACKAGE_REFUSAL.path);
      }
      expect(drawn[0]).toEqual(drawn[1]);
    });

    it('reads the package message itself where the package published one', () => {
      const message = 'Slot Slot04_Size7 is not part of the Anaconda.';
      const fixture = render(
        view({ state: 'package-refused', refusal: refusalIn(BUNDLED_ENGLISH, message) }),
      );

      expect(said(fixture)).toContain(message);
      // The application's sentence about an absent message is not drawn beside
      // one that is there: there is nothing absent to state.
      expect(said(fixture)).not.toContain(BUNDLED_ENGLISH['fleet.refusal.no-message']);
    });

    it('never draws a sentence the application wrote in place of the package message', () => {
      const german = render(
        view({
          state: 'package-refused',
          refusal: refusalIn(GERMAN as unknown as Record<string, string>),
        }),
      );
      const drawn = said(german);

      // The absence is stated as an absence. Nothing writes a reason from the
      // diagnostic code, and no English sentence of this application's own
      // reaches a German reader in its place. What is left beside the German
      // sentence is the package's structured answer, verbatim.
      expect(drawn).not.toContain(BUNDLED_ENGLISH['fleet.refusal.no-message']);
      expect(drawn).not.toContain(BUNDLED_ENGLISH['fleet.status.package-refused']);
      expect(drawn).toContain(PACKAGE_REFUSAL.code);
      expect(drawn).toContain(PACKAGE_REFUSAL.constraint);
      expect(drawn).toContain(PACKAGE_REFUSAL.path);
    });
  });

  describe('the advertised route set', () => {
    it('is exactly what it was before the fleet had a view', () => {
      // The owned ships are drawn inside the stored-build layer, which has no
      // address of its own and is reached from the screen a Commander is on.
      // The fleet adds none either: the ships belong to one account, so an
      // address would resolve to a different fleet for every Commander who
      // opened it (design decision 10).
      expect(routes.map((route) => route.path)).toEqual([
        '',
        'ships',
        'outfitting',
        'equipment',
        '**',
      ]);
      expect(JSON.stringify(routes)).not.toContain('fleet');
    });
  });

  describe('at every width, in both orientations', () => {
    function drawnAt(state: OwnedShipsView) {
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
          routes: routes.map((route) => route.path),
        };
      });
    }

    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'draws %s the same way at every profile, with the same touch-sized controls and the same addresses',
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

          expect(entry.routes, `${name} at ${entry.profile}`).toEqual([
            '',
            'ships',
            'outfitting',
            'equipment',
            '**',
          ]);

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
  });

  describe('what keeps the page from scrolling sideways', () => {
    it('states every length as a token, so nothing is pinned to a pixel box', () => {
      render(STATES[8].view);
      const declared = ownDeclarations();

      expect(declared.length).toBeGreaterThan(0);
      for (const { selector, body } of declared) {
        expect(body.replace(/\bvar\([^)]*\)/g, ''), selector).not.toMatch(
          /\b[1-9]\d*(\.\d+)?(px|pt|cm|in|pc|mm)\b/,
        );
      }
    });

    it('wraps its row of actions rather than letting it run past the panel', () => {
      expect(getComputedStyle(query(render(STATES[2].view), '.fleet__actions')).flexWrap).toBe(
        'wrap',
      );
    });

    it('wraps the long words it does not own — a package diagnostic and a ship name', () => {
      const fixture = render(STATES[8].view);

      for (const selector of ['.fleet__status', '.fleet__refusal-message']) {
        expect(getComputedStyle(query(fixture, selector)).overflowWrap, selector).toBe('anywhere');
      }
      expect(
        getComputedStyle(query(render(STATES[3].view), '.fleet__unresolved')).overflowWrap,
      ).toBe('anywhere');
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
    it('asks for a refresh rather than making one', () => {
      const fixture = render(STATES[2].view);
      let asked = 0;
      fixture.componentInstance.refreshRequested.subscribe(() => {
        asked += 1;
      });

      query(fixture, '.fleet__action--refresh button').click();

      expect(asked).toBe(1);
    });

    it('asks for a sign-in rather than starting one', () => {
      const fixture = render(STATES[0].view);
      let asked = 0;
      fixture.componentInstance.signInRequested.subscribe(() => {
        asked += 1;
      });

      query(fixture, '.fleet__action--sign-in button').click();

      expect(asked).toBe(1);
    });

    it('asks for a copy rather than making one, and writes nothing to the ship', () => {
      const fixture = render(STATES[2].view);
      const before = JSON.stringify(STATES[2].view);
      let asked = 0;
      fixture.componentInstance.copyRequested.subscribe(() => {
        asked += 1;
      });

      query(fixture, '.fleet__action--copy button').click();

      expect(asked).toBe(1);
      expect(JSON.stringify(STATES[2].view)).toBe(before);
    });

    it('names the ship a Commander chose rather than choosing it here', () => {
      const fixture = render(STATES[2].view);
      const chosen: string[] = [];
      fixture.componentInstance.shipChosen.subscribe((id) => chosen.push(id));

      query(fixture, 'ednb-collection li button, ednb-collection li [role="button"]').click();

      expect(chosen).toEqual(['12']);
    });
  });
});
