import type { ComponentFixture } from '@angular/core/testing';
import {
  accessibleName,
  element,
  query,
  renderComponent,
  textOf,
  visibleTextOf,
} from '../../ui/components/ui-component.spec-helpers';
import { AccountDialog } from './account-dialog.component';
import type { AccountDialogView } from '../../application/account/account.presenter';
import { BUNDLED_ENGLISH } from '../../i18n/locale-registry';

/**
 * The five layout profiles the browser matrix runs, both orientations included.
 *
 * The same five viewports `playwright.config.ts` generates its ten projects
 * from, restated here rather than imported: a unit spec may not reach into the
 * end-to-end sources. Tablet and mobile appear twice each, once per
 * orientation, which is what makes "both orientations" a set of widths rather
 * than a setting (`e2e/coverage-ledger.ts`, LAYOUT_PROFILES).
 */
const LAYOUT_PROFILES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet portrait', width: 834, height: 1112 },
  { name: 'tablet landscape', width: 1112, height: 834 },
  { name: 'mobile portrait', width: 390, height: 844 },
  { name: 'mobile landscape', width: 844, height: 390 },
] as const;

/** The account data use every state states, in the order the dialog draws it. */
const DATA_USE = [
  BUNDLED_ENGLISH['account.data.identity'],
  BUNDLED_ENGLISH['account.data.credentials'],
  BUNDLED_ENGLISH['account.data.records'],
  BUNDLED_ENGLISH['account.data.fleet'],
  BUNDLED_ENGLISH['account.data.frontier'],
  BUNDLED_ENGLISH['account.data.destination'],
];

const COMMANDER = 'CMDR Jameson';

function view(overrides: Partial<AccountDialogView> = {}): AccountDialogView {
  return {
    title: BUNDLED_ENGLISH['account.title'],
    commanderLabel: BUNDLED_ENGLISH['account.commander.label'],
    commanderName: null,
    status: null,
    dataUseTitle: BUNDLED_ENGLISH['account.data.title'],
    dataUse: DATA_USE,
    networkNotice: BUNDLED_ENGLISH['account.network.notice'],
    actions: [],
    busyLabel: BUNDLED_ENGLISH['action.busy'],
    deletionConfirmation: false,
    deletionTitle: BUNDLED_ENGLISH['account.delete.title'],
    deletionDescription: BUNDLED_ENGLISH['account.delete.description'],
    deletionConfirm: BUNDLED_ENGLISH['account.delete.confirm'],
    deletionCancel: BUNDLED_ENGLISH['action.cancel'],
    dismiss: BUNDLED_ENGLISH['action.close'],
    ...overrides,
  };
}

const SIGN_IN = {
  label: BUNDLED_ENGLISH['account.sign-in'],
  kind: 'sign-in',
  emphasis: 'primary',
  busy: false,
} as const;

const SIGNED_IN_ACTIONS = [
  {
    label: BUNDLED_ENGLISH['account.sign-out'],
    kind: 'sign-out',
    emphasis: 'secondary',
    busy: false,
  },
  {
    label: BUNDLED_ENGLISH['account.delete.action'],
    kind: 'delete',
    emphasis: 'danger',
    busy: false,
  },
] as const;

/**
 * Every state the screen inventory gives this surface, as the dialog draws it.
 *
 * Ten rows for the ten states design decision 10 names. Each row is one view
 * the presenter can hand this layer, so the assertions below run over all of
 * them rather than over the two or three a test happens to name.
 */
const STATES: readonly { readonly name: string; readonly view: AccountDialogView }[] = [
  {
    name: 'anonymous',
    view: view({
      status: { tone: 'info', message: BUNDLED_ENGLISH['account.status.anonymous'] },
      actions: [SIGN_IN],
    }),
  },
  {
    name: 'redirect pending',
    view: view({
      status: { tone: 'loading', message: BUNDLED_ENGLISH['account.status.redirect-pending'] },
    }),
  },
  {
    name: 'correlation refused',
    view: view({
      status: { tone: 'warning', message: BUNDLED_ENGLISH['account.status.correlation-refused'] },
      actions: [SIGN_IN],
    }),
  },
  {
    name: 'signed in',
    view: view({
      commanderName: COMMANDER,
      status: { tone: 'success', message: BUNDLED_ENGLISH['account.status.signed-in'] },
      actions: [...SIGNED_IN_ACTIONS],
    }),
  },
  {
    name: 'offline',
    view: view({
      commanderName: COMMANDER,
      status: { tone: 'warning', message: BUNDLED_ENGLISH['account.status.offline'] },
      actions: [
        { label: BUNDLED_ENGLISH['action.retry'], kind: 'retry', emphasis: 'primary', busy: false },
      ],
    }),
  },
  {
    name: 'expired session',
    view: view({
      status: { tone: 'warning', message: BUNDLED_ENGLISH['account.status.session-expired'] },
      actions: [SIGN_IN],
    }),
  },
  {
    name: 'expired authorisation',
    view: view({
      commanderName: COMMANDER,
      status: { tone: 'warning', message: BUNDLED_ENGLISH['account.status.authorisation-expired'] },
      actions: [SIGN_IN],
    }),
  },
  {
    name: 'sign-out',
    view: view({
      commanderName: COMMANDER,
      status: { tone: 'loading', message: BUNDLED_ENGLISH['account.status.signing-out'] },
      actions: [
        {
          label: BUNDLED_ENGLISH['account.sign-out'],
          kind: 'sign-out',
          emphasis: 'secondary',
          busy: true,
        },
      ],
    }),
  },
  {
    name: 'account-deletion confirmation',
    view: view({
      commanderName: COMMANDER,
      status: { tone: 'warning', message: BUNDLED_ENGLISH['account.status.delete-confirmation'] },
      deletionConfirmation: true,
    }),
  },
  // Last, because the rows before it are read by position. A browser that has
  // not answered yet: the layer opens on it whenever the frame action is
  // pressed before the session reads.
  {
    name: 'reading the session',
    view: view({
      status: { tone: 'loading', message: BUNDLED_ENGLISH['account.status.loading'] },
    }),
  },
];

/**
 * `<dialog>` without the native modal methods, which jsdom does not implement.
 *
 * The layer calls them the moment it opens; what these tests are about is the
 * modal's content, its reading order and the rules it is drawn under, not what
 * a browser does with a dialog element. The Playwright suite covers the real
 * one at all five profiles in both engines.
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

function render(state: AccountDialogView, open = true): ComponentFixture<AccountDialog> {
  stubNativeDialog();
  return renderComponent(AccountDialog, { open, view: state });
}

/** The panel the state's own content is drawn in, whichever layer holds it. */
function panel(fixture: ComponentFixture<AccountDialog>): HTMLElement {
  const account = element(fixture).querySelector<HTMLElement>('.account-dialog');
  return account ?? query(fixture, '.confirm__actions');
}

/** Every control a Commander can press in the open layer. */
function controls(fixture: ComponentFixture<AccountDialog>): HTMLButtonElement[] {
  return [...element(fixture).querySelectorAll<HTMLButtonElement>('dialog[open] button')];
}

/**
 * Renders one state at one viewport.
 *
 * The window is set before the component is created, so a component that read
 * the viewport in TypeScript would read this one. Nothing here does — the layer
 * resolves its presentation in CSS — and that is what these assertions are
 * evidence of: one DOM, one reading order, at every width and either
 * orientation.
 */
function atViewport(
  profile: { width: number; height: number },
  state: AccountDialogView,
): ComponentFixture<AccountDialog> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: profile.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: profile.height });
  window.dispatchEvent(new Event('resize'));
  return render(state);
}

/**
 * Every declaration this component's own stylesheet makes, media rules and all.
 *
 * Read off the rendered document rather than off the file, so it is the CSS the
 * browser was actually handed. The design-system parts the dialog composes are
 * left out: each of them has its own preview, its own contract and its own
 * assertions, and restating them here would check the same rule twice and let
 * a Commander's dialog pass on the strength of a button's stylesheet.
 */
function ownDeclarations(): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];

  const visit = (rule: CSSRule) => {
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText === 'string' && style.selectorText.includes('account-dialog')) {
      found.push({ selector: style.selectorText, body: style.style.cssText });
    }
    // Media and other grouping rules are walked into, so a measure declared at
    // one width is read as well as one declared at every width.
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

describe('AccountDialog', () => {
  it('is one dialog, named by its visible title', () => {
    const fixture = render(STATES[3].view);
    const dialogs = element(fixture).querySelectorAll<HTMLDialogElement>('dialog[open]');

    expect(dialogs.length).toBe(1);
    expect(accessibleName(dialogs[0])).toBe(BUNDLED_ENGLISH['account.title']);
  });

  it('raises the confirmation layer instead of the account panel, never both', () => {
    const fixture = render(STATES[8].view);
    const open = [...element(fixture).querySelectorAll<HTMLDialogElement>('dialog[open]')];

    expect(open.length).toBe(1);
    expect(accessibleName(open[0])).toBe(BUNDLED_ENGLISH['account.delete.title']);

    // The account panel is still mounted and its dialog is shut, so a reader
    // meets the question and nothing behind it.
    expect(element(fixture).querySelector('.account-dialog')?.closest('dialog[open]')).toBeNull();
  });

  it('draws nothing at all while it is closed', () => {
    const fixture = render(STATES[3].view, false);

    expect(element(fixture).querySelectorAll('dialog[open]').length).toBe(0);
  });

  describe('what it says about the account', () => {
    it('states the account data use in every state, before any action', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        if (state.deletionConfirmation) {
          continue;
        }
        const lines = [...element(fixture).querySelectorAll('.account-dialog__data-use li')];

        expect(
          lines.map((line) => textOf(line)),
          name,
        ).toEqual(DATA_USE);
      }
    });

    it('names Frontier, the records it holds and the records it never sends', () => {
      const text = textOf(query(render(STATES[0].view), '.account-dialog'));

      // A Commander reads what the account holds before they sign in, not after
      // (020/FR-005). The last of the three is the boundary itself: builds,
      // loadouts and notes never reach Frontier.
      expect(text).toContain(BUNDLED_ENGLISH['account.data.identity']);
      expect(text).toContain(BUNDLED_ENGLISH['account.data.frontier']);
      expect(text).toContain(BUNDLED_ENGLISH['account.data.destination']);
    });

    it('heads the data-use list with its own heading, and names the list by it', () => {
      const fixture = render(STATES[0].view);
      const section = query(fixture, '.account-dialog__data');
      const heading = section.querySelector('.account-dialog__heading');

      expect(heading?.tagName.toLowerCase()).toBe('h3');
      expect(accessibleName(section)).toBe(BUNDLED_ENGLISH['account.data.title']);
    });

    it('states which actions need a network, in every state', () => {
      for (const { name, view: state } of STATES) {
        if (state.deletionConfirmation) {
          continue;
        }
        const fixture = render(state);

        expect(textOf(query(fixture, '.account-dialog__network')), name).toBe(
          BUNDLED_ENGLISH['account.network.notice'],
        );
      }
    });

    it('names the Commander by the name Frontier supplies, never by an identifier', () => {
      const fixture = render(STATES[3].view);
      const commander = query(fixture, '.account-dialog__commander');

      expect(textOf(commander.querySelector('.account-dialog__commander-label'))).toBe(
        BUNDLED_ENGLISH['account.commander.label'],
      );
      expect(textOf(commander.querySelector('.account-dialog__commander-name'))).toBe(COMMANDER);
      expect(textOf(query(fixture, '.account-dialog'))).not.toMatch(/\d{5,}/);
    });

    it('draws no Commander line in a state that has no account', () => {
      const fixture = render(STATES[0].view);

      expect(element(fixture).querySelector('.account-dialog__commander')).toBeNull();
    });
  });

  describe('every state in the screen inventory', () => {
    it('says what the session is doing, in words, in each of them', () => {
      for (const { name, view: state } of STATES) {
        const fixture = render(state);
        const notice = element(fixture).querySelector('ednb-status-notice');

        // The tone is a second rendering of the sentence, never the only one:
        // the words are in the document whatever the tone (011/FR-010).
        expect(notice, name).not.toBeNull();
        expect(textOf(notice), name).toContain(state.status?.message ?? '');
      }
    });

    it('offers each state’s own actions, by their visible names', () => {
      const named = STATES.filter((entry) => !entry.view.deletionConfirmation).map((entry) => [
        entry.name,
        entry.view.actions.map((action) => action.label),
      ]);

      for (const [name, labels] of named) {
        const fixture = render(STATES.find((entry) => entry.name === name)!.view);
        const drawn = controls(fixture)
          .filter((control) => !control.classList.contains('layer__dismiss'))
          .map((control) => visibleTextOf(control));

        expect(drawn, String(name)).toEqual(labels);
      }
    });

    it('says the same thing on screen as it says to a reader', () => {
      for (const { name, view: state } of STATES) {
        // A running action is the one control whose name says more than its
        // words: the design system appends the busy text so the button does
        // not appear to become a different button mid-action. It is asserted
        // on its own below.
        const idle = controls(render(state)).filter(
          (control) => control.getAttribute('aria-busy') === null,
        );

        for (const control of idle) {
          expect(accessibleName(control), `${name}: ${control.className}`).toBe(
            visibleTextOf(control),
          );
        }
      }
    });

    it('reports a busy action as busy while keeping its name', () => {
      const fixture = render(STATES[7].view);
      const control = controls(fixture).find((node) => node.classList.contains('action'));

      expect(control?.getAttribute('aria-busy')).toBe('true');
      expect(visibleTextOf(control!)).toBe(BUNDLED_ENGLISH['account.sign-out']);
      expect(accessibleName(control!)).toBe(
        `${BUNDLED_ENGLISH['account.sign-out']} ${BUNDLED_ENGLISH['action.busy']}`,
      );
    });

    it('offers the way out of every state that is not the confirmation', () => {
      for (const { name, view: state } of STATES) {
        if (state.deletionConfirmation) {
          continue;
        }
        const fixture = render(state);

        expect(textOf(query(fixture, '.layer__dismiss')), name).toBe(
          BUNDLED_ENGLISH['action.close'],
        );
      }
    });
  });

  describe('at every width, in both orientations', () => {
    /**
     * One render per state per profile, read three ways.
     *
     * The three readings share a render because a render is a whole test bed:
     * what is asserted is a property of the drawn state at that viewport, and
     * drawing it three times would say the same thing three times over.
     */
    function drawnAt(state: AccountDialogView) {
      return LAYOUT_PROFILES.map((profile) => {
        const fixture = atViewport(profile, state);
        return {
          profile: profile.name,
          // The relation ids are minted per instance, so they say which render
          // this is rather than what it drew. Everything else is compared.
          markup: panel(fixture)
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

    // One test per state rather than one loop over them, so a state that
    // regresses is named by the test that failed.
    it.each(STATES.map((entry) => [entry.name, entry.view] as const))(
      'draws %s the same way at every profile, with the same touch-sized controls',
      (name, state) => {
        const drawn = drawnAt(state);

        // One DOM at every profile. Nothing about this surface is decided by
        // reading the viewport in TypeScript, so the width a Commander happens
        // to be at cannot drop a control, reorder a region or say less.
        expect(new Set(drawn.map((entry) => entry.markup)).size, name).toBe(1);

        for (const entry of drawn) {
          expect(
            entry.controls.map((control) => control.name),
            `${name} at ${entry.profile}`,
          ).toEqual(drawn[0].controls.map((control) => control.name));
          expect(entry.controls.length, `${name} at ${entry.profile}`).toBeGreaterThan(0);

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
      // A fixed length is what makes a panel wider than the narrowest profile
      // and what clips a doubled line at 200% text. There is none: every
      // measure this component declares comes from the token layer.
      render(STATES[3].view);
      const declared = ownDeclarations();

      expect(declared.length).toBeGreaterThan(0);
      for (const { selector, body } of declared) {
        expect(body.replace(/\bvar\([^)]*\)/g, ''), selector).not.toMatch(
          /\b[1-9]\d*(\.\d+)?(px|pt|cm|in|pc|mm)\b/,
        );
      }
    });

    it('wraps its row of actions rather than letting it run past the panel', () => {
      const fixture = render(STATES[3].view);

      expect(getComputedStyle(query(fixture, '.account-dialog__actions')).flexWrap).toBe('wrap');
    });

    it('wraps the long words it does not own — a Commander name and a sentence', () => {
      const fixture = render(STATES[3].view);
      const wrapping = [
        '.account-dialog__commander',
        '.account-dialog__data-use',
        '.account-dialog__network',
      ];

      for (const selector of wrapping) {
        expect(getComputedStyle(query(fixture, selector)).overflowWrap, selector).toBe('anywhere');
      }
    });

    it('asks no region of its own to scroll sideways', () => {
      render(STATES[3].view);

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

    it('says everything it said, and offers everything it offered', () => {
      for (const { name, view: state } of STATES) {
        const plain = render(state);
        const expected = {
          text: textOf(panel(plain)),
          controls: controls(plain).map((control) => accessibleName(control)),
        };

        const doubled = withDoubledText(() => {
          const fixture = render(state);
          return {
            text: textOf(panel(fixture)),
            controls: controls(fixture).map((control) => accessibleName(control)),
          };
        });

        expect(doubled, name).toEqual(expected);
      }
    });
  });

  describe('the intents it emits', () => {
    it('asks to be dismissed rather than dismissing itself', () => {
      const fixture = render(STATES[0].view);
      let dismissed = 0;
      fixture.componentInstance.dismissed.subscribe(() => {
        dismissed += 1;
      });

      query(fixture, '.layer__dismiss').click();

      expect(dismissed).toBe(1);
    });

    it('names the action a Commander pressed rather than acting on it', () => {
      const fixture = render(STATES[3].view);
      const selected: string[] = [];
      fixture.componentInstance.actionSelected.subscribe((kind) => selected.push(kind));

      for (const control of controls(fixture).filter((node) => node.classList.contains('action'))) {
        control.click();
      }

      expect(selected).toEqual(['sign-out', 'delete']);
    });

    it('asks before it deletes, and treats dismissal as a cancel', () => {
      const fixture = render(STATES[8].view);
      const answered: string[] = [];
      fixture.componentInstance.deletionConfirmed.subscribe(() => answered.push('confirmed'));
      fixture.componentInstance.deletionCancelled.subscribe(() => answered.push('cancelled'));

      const buttons = controls(fixture).filter((node) => node.classList.contains('action'));
      expect(buttons.map((button) => visibleTextOf(button))).toEqual([
        BUNDLED_ENGLISH['account.delete.confirm'],
        BUNDLED_ENGLISH['action.cancel'],
      ]);

      buttons[0].click();
      buttons[1].click();

      expect(answered).toEqual(['confirmed', 'cancelled']);
    });

    it('states what deletion removes and what stays on this device', () => {
      const fixture = render(STATES[8].view);

      expect(textOf(query(fixture, '.layer__description'))).toBe(
        BUNDLED_ENGLISH['account.delete.description'],
      );
    });
  });
});
