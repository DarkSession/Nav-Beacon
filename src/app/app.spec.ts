import { Location } from '@angular/common';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { ACCOUNT_ACTION, App, HELP_ACTION } from './app';
import { routes } from './app.routes';
import { EquipmentBenchPage } from './features/equipment/equipment-bench.page';
import { LoadoutStore } from './application/equipment/loadout.store';
import { NAVIGATION_ROUTES } from './features/shared/app-navigation';
import { WORKSPACE_EXPORT_ACTION } from './features/shared/screen-chrome';
import { ActiveBuildStore } from './application/active-build/active-build.store';
import { SlefStore } from './application/slef/slef.store';
import { FIXTURE_HULL } from './domain/ships/outfitting/outfitting.fixtures';
import {
  ApplicationUpdateAdapter,
  type VersionEvent,
} from './platform/browser/application-update.adapter';
import { provideLocalization } from './i18n/i18n.providers';
import { BUNDLED_ENGLISH, type MessageCatalogue } from './i18n/locale-registry';
import germanCatalogue from './i18n/locales/de.json';
import { LocaleStore } from './i18n/locale.store';
import { AnnouncementService } from './ui/announcements/announcement.service';
import { AccountPresenter } from './application/account/account.presenter';
import { HelpPresenter } from './application/help/help.presenter';
import { HELP_MANIFEST } from './platform/build/help-manifest.generated';
import {
  COMMANDER_API,
  type CommanderApiPort,
  type CommanderSessionResult,
} from './platform/network/commander-api';
import type { FleetResponse } from './domain/commander/fleet/fleet-answer';
import type { SynchronisationResponse } from './domain/records/record-synchronisation';
import { EDNB_UPDATE_APPLIED_KEY } from './platform/storage/storage-keys';
import { MemoryStorage, provideMemoryStorage } from './platform/storage/storage.spec-helpers';

/**
 * A Commander service that is simply not there.
 *
 * The shell reads the account state once when a browser session starts, and a
 * unit test has no origin to read it from. Answering "unavailable" here is what
 * that request means in this environment, and it keeps the shell's own tests
 * off the network.
 */
class AbsentCommanderApi implements CommanderApiPort {
  callbackResult(): null {
    return null;
  }

  async startSignIn(): Promise<boolean> {
    return false;
  }

  /**
   * The fleet is not what these tests are about.
   *
   * Unavailable is the honest answer for a test with no origin to read from,
   * and it is the one answer that lets the fleet store claim nothing.
   */
  async readFleet(): Promise<FleetResponse> {
    return { kind: 'unavailable' };
  }

  async refreshFleet(): Promise<FleetResponse> {
    return { kind: 'unavailable' };
  }

  async readSession(): Promise<CommanderSessionResult> {
    return { kind: 'unavailable' };
  }

  async signOut(): Promise<boolean> {
    return false;
  }

  async deleteAccount(): Promise<boolean> {
    return false;
  }

  async synchroniseRecords(): Promise<SynchronisationResponse> {
    return { kind: 'unavailable' };
  }
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // The shell holds the update store, which reads the session area for the
      // marker a restart leaves behind. In-memory here, so a test never sees a
      // marker another test wrote.
      providers: [
        provideLocalization(),
        ...provideMemoryStorage(new MemoryStorage()),
        { provide: COMMANDER_API, useValue: new AbsentCommanderApi() },
      ],
    }).compileComponents();
  });

  // The shell seeds itself from the address it was loaded at, so a test that
  // sets one is writing real history. Put it back, or every test declared after
  // it builds the shell somewhere other than the shipyard.
  afterEach(() => {
    TestBed.inject(Location).go('/');
  });

  it('creates the application root', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders inside the shared application frame', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('ednb-app-frame')).not.toBeNull();
    expect(element.querySelector('header')).not.toBeNull();
    expect(element.querySelector('main')).not.toBeNull();
  });

  it('synthesizes no heading of its own, leaving the h1 to the route', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    // A shell-owned h1 would name every screen the same thing, so the shell
    // owns none: the route inside `main` supplies it.
    expect(element.querySelectorAll('h1').length).toBe(0);
    expect(element.querySelector('header')?.querySelector('h1') ?? null).toBeNull();
  });

  it('offers the saved builds as an action, from every screen', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const named = (selector: string) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)].map((control) =>
        control.textContent?.trim(),
      );

    // A control and not a chip. The library has no address of its own
    // (Commander request 2026-09-04, `build-library/library-presence.ts`), so
    // the one entry the bar's navigation ever held became a shell action, and
    // the row it was the only occupant of went with it.
    //
    // Both compositions, because the folded bar is where a Commander reaches it
    // at narrow widths: the frame renders the wide row and the `⋮` layer
    // together and lets a media query present one of them.
    expect(named('.frame__actions .action__label')).toContain(
      BUNDLED_ENGLISH['navigation.library'],
    );
    expect(named('.action-layer__panel .action__label')).toContain(
      BUNDLED_ENGLISH['navigation.library'],
    );

    // Nothing links to it, at either width — an `href` here would point at an
    // address the route table no longer serves.
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a[href]')].map(
      (link) => link.getAttribute('href'),
    );
    expect(links).not.toContain('/builds');
  });

  it('carries the way to the entry point on the bar\u2019s own insignia', () => {
    // The shell reads the address it was loaded at rather than waiting for the
    // router's first navigation, so the address has to be set before the
    // component reads it (Commander request 2026-09-04).
    TestBed.inject(Location).go(NAVIGATION_ROUTES.outfitting);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const insignia = element.querySelector('.frame__flag-home');
    const named = insignia?.textContent?.trim();

    // The 2026-08-26 revision puts the mark where the `SHIPYARD` word used to
    // be, so the mark is the control and the word is not drawn twice. It is a
    // link, so it opens in a new tab and copies like any other address, and it
    // says where it goes for a reader who cannot see the mark.
    expect(insignia?.getAttribute('href')).toBe(NAVIGATION_ROUTES.start);
    expect(insignia?.textContent?.trim()).toBe(BUNDLED_ENGLISH['navigation.start']);

    // The mark is inside the link rather than being it, so the press keeps the
    // target baseline while the insignia keeps the size the canvas draws it.
    expect(insignia?.querySelector('.frame__flag')).not.toBeNull();

    // The same answer from every screen, however deep in a tool it is asked
    // from: one way back, in one place (017/FR-001).
    for (const path of [
      NAVIGATION_ROUTES.catalogue,
      `${NAVIGATION_ROUTES.catalogue}/Anaconda`,
      NAVIGATION_ROUTES.equipment,
    ]) {
      TestBed.inject(Location).go(path);
      const opened = TestBed.createComponent(App);
      opened.detectChanges();
      const mark = (opened.nativeElement as HTMLElement).querySelector('.frame__flag-home');

      expect(mark?.getAttribute('href'), path).toBe(NAVIGATION_ROUTES.start);
      expect(mark?.textContent?.trim(), path).toBe(named);
      opened.destroy();
    }
  });

  it('draws the insignia as a control on the entry point too, and answers with nothing', () => {
    // A control that went missing where it leads would move every other item on
    // the deck, so it is drawn and a plain click is answered with nothing. The
    // address is still an address: a new tab opens it and it copies
    // (017/FR-001, FR-002).
    TestBed.inject(Location).go(NAVIGATION_ROUTES.start);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const insignia = (fixture.nativeElement as HTMLElement).querySelector('.frame__flag-home');
    expect(insignia?.getAttribute('href')).toBe(NAVIGATION_ROUTES.start);

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl');
    const click = new MouseEvent('click', { button: 0, cancelable: true });
    insignia?.dispatchEvent(click);

    expect(travelled).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('leaves a modified click on the insignia to the browser', () => {
    // A new tab is what the reader asked for, on the entry point as anywhere
    // else. The shell takes no part in it, so the event reaches the browser
    // unanswered.
    TestBed.inject(Location).go(NAVIGATION_ROUTES.start);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const insignia = (fixture.nativeElement as HTMLElement).querySelector('.frame__flag-home');
    const click = new MouseEvent('click', { button: 0, cancelable: true, metaKey: true });
    insignia?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });

  it('opens the list of ships from the tool a Commander is already in', () => {
    // A build is in the ship tool, and its tab is how a Commander gets back to
    // the ships. Nothing about the build changes: the workspace keeps it, and
    // the record it autosaves into keeps it after that (017/FR-004).
    TestBed.inject(Location).go(NAVIGATION_ROUTES.outfitting);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.frame__tool'),
    ];
    tabs[0].dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));

    expect(travelled).toHaveBeenCalledWith(NAVIGATION_ROUTES.catalogue);
  });

  it('opens the list of ships from a hull, which is inside the ship tool too', () => {
    // A hull's own address is the ship tool's, so its tab is current there and
    // leads back to the list. It is not the address the tab names, so the click
    // is followed rather than answered with nothing (017/FR-004).
    TestBed.inject(Location).go(`${NAVIGATION_ROUTES.catalogue}/Anaconda`);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.frame__tool'),
    ];
    tabs[0].dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));

    expect(travelled).toHaveBeenCalledWith(NAVIGATION_ROUTES.catalogue);
  });

  it('answers the ship tool\u2019s tab with nothing where the list of ships is open', () => {
    // The tab is drawn and reads as a link — the browser states where it goes
    // and a new tab opens it — and a plain click on the screen it leads to is
    // answered with nothing rather than with a history entry (017/FR-005).
    TestBed.inject(Location).go(NAVIGATION_ROUTES.catalogue);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.frame__tool'),
    ];
    const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    tabs[0].dispatchEvent(click);

    expect(travelled).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('opens a tool a Commander is not in at its own address', () => {
    TestBed.inject(Location).go(NAVIGATION_ROUTES.catalogue);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.frame__tool'),
    ];
    tabs[1].dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));

    expect(travelled).toHaveBeenCalledWith(NAVIGATION_ROUTES.equipment);
  });

  it('starts an empty bench when the equipment tool’s tab is pressed on the bench', () => {
    // The tab a Commander is already in re-enters the tool by the action the
    // registry declares beside it, and the bench's is an empty bench for the
    // next loadout (017/FR-003, 017/FR-006).
    TestBed.inject(Location).go(NAVIGATION_ROUTES.equipment);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const store = TestBed.inject(LoadoutStore);
    store.dispatch({ kind: 'selectSuit', suitFamily: 'tacticalsuit' });

    const router = TestBed.inject(Router);
    const travelled = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.frame__tool'),
    ];
    const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    tabs[1].dispatchEvent(click);

    expect(store.hasLoadout()).toBe(false);
    // Nowhere to go: the bench is where the Commander already is.
    expect(travelled).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('resolves its text through the message facade', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain(BUNDLED_ENGLISH['navigation.library']);
    expect(text).not.toMatch(/\{\{/);
  });

  it('offers exactly one way to help, from the frame and from nowhere else', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const help = fixture.componentInstance.actions().filter(({ id }) => id === HELP_ACTION);

    // One entry, named and described in words a Commander reads. The wide bar
    // draws it as the reference's own `?`, but the mark never becomes the name:
    // the label is what a reader is told at either width, and it is a word
    // rather than a glyph the frame would have to explain (012/FR-002,
    // 012/FR-011).
    expect(help.length).toBe(1);
    expect(help[0].label).toBe(BUNDLED_ENGLISH['help.action.label']);
    expect(help[0].symbol).toBe(BUNDLED_ENGLISH['help.action.symbol']);
    expect(help[0].description).toBe(BUNDLED_ENGLISH['help.action.description']);
    expect(help[0].label).not.toBe(help[0].symbol);

    // And it is the only action drawn as a mark. Every other entry on the bar
    // is its own words, which is what keeps the mark readable as "the help one"
    // rather than as one of a row of glyphs.
    const marked = fixture.componentInstance.actions().filter(({ symbol }) => symbol);
    expect(marked.map(({ id }) => id)).toEqual([HELP_ACTION]);
  });

  it('offers the Commander account from the frame, at both widths', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const account = fixture.componentInstance.actions().filter(({ id }) => id === ACCOUNT_ACTION);

    // One entry, named in words and described for a reader. An account belongs
    // to the session rather than to a screen, so the frame carries the one way
    // to it and no capability draws a second (024/FR-001).
    expect(account.length).toBe(1);
    expect(account[0].label).toBe(BUNDLED_ENGLISH['account.action']);
    expect(account[0].description).toBe(BUNDLED_ENGLISH['account.action.description']);
    expect(account[0].symbol).toBeUndefined();

    const named = (selector: string) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)].map((control) =>
        control.textContent?.trim(),
      );

    // Both compositions: the wide row and the folded layer a narrow bar draws.
    expect(named('.frame__actions .action__label')).toContain(BUNDLED_ENGLISH['account.action']);
    expect(named('.action-layer__panel .action__label')).toContain(
      BUNDLED_ENGLISH['account.action'],
    );
  });

  it('opens the account modal when the frame reports the account action', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const account = TestBed.inject(AccountPresenter);

    // Beside the frame, like help, rather than inside a capability — and
    // fetched with the session rather than drawn with it, so a session that
    // never opens an account draws no layer at all (`app.html`).
    expect((fixture.nativeElement as HTMLElement).querySelector('ednb-account-dialog')).toBeNull();
    expect(account.open()).toBe(false);

    fixture.componentInstance.selectAction('nothing.claims.this');
    expect(account.open()).toBe(false);

    fixture.componentInstance.selectAction(ACCOUNT_ACTION);
    expect(account.open()).toBe(true);

    // And the layer itself arrives, which is the half the state alone does not
    // say: a modal a Commander asked for and never receives is the same to them
    // as one that was never offered (024/FR-001).
    //
    // Opening it reaches the native modal methods, which jsdom does not
    // implement. The prototype is shared with every other file in the run, so
    // the stub goes back on the way out whatever happens here.
    const prototype = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    const original = { showModal: prototype['showModal'], close: prototype['close'] };
    prototype['showModal'] = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    prototype['close'] = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    try {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('ednb-account-dialog'),
      ).not.toBeNull();
    } finally {
      prototype['showModal'] = original.showModal;
      prototype['close'] = original.close;
    }
  });

  it('opens the modal when the frame reports the help action, and nothing else', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const help = TestBed.inject(HelpPresenter);

    expect(help.open()).toBe(false);

    // A shell action nobody claims must not open it: the frame publishes one
    // list for every capability, and the root dispatches by id.
    fixture.componentInstance.selectAction('nothing.claims.this');
    expect(help.open()).toBe(false);

    fixture.componentInstance.selectAction(HELP_ACTION);
    expect(help.open()).toBe(true);
  });

  it('lets the shell handle a published action that has no screen handler', () => {
    const fixture = TestBed.createComponent(App);
    const help = TestBed.inject(HelpPresenter);
    fixture.componentInstance.chrome.setActions([
      { action: { id: HELP_ACTION, label: 'Help test action' } },
    ]);

    fixture.componentInstance.selectAction(HELP_ACTION);

    expect(help.open()).toBe(true);
  });

  it('connects the workspace export action to the exchange layer', () => {
    const fixture = TestBed.createComponent(App);
    const active = TestBed.inject(ActiveBuildStore);
    const slef = TestBed.inject(SlefStore);
    slef.selectExportMode('link');

    fixture.componentInstance.selectAction(WORKSPACE_EXPORT_ACTION);
    expect(slef.layer()).toBe('none');

    active.commit({
      loadout: ShipLoadout.default(FIXTURE_HULL),
      hullName: 'Anaconda',
      provenance: 'working',
      sourceNamed: null,
      autosaveRecordId: null,
      baseline: null,
    });
    fixture.componentInstance.selectAction(WORKSPACE_EXPORT_ACTION);

    expect(slef.layer()).toBe('export');
    expect(slef.exportMode()).toBe('link');

    slef.closeLayer();
    active.setLink({ kind: 'refused', code: 'tooLong', slot: null });
    fixture.componentInstance.selectAction(WORKSPACE_EXPORT_ACTION);

    expect(slef.layer()).toBe('export');
    expect(slef.exportMode()).toBe('slef');
  });

  it('mounts exactly one assertive and one polite announcement outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('[data-announcement-outlet="assertive"]').length).toBe(1);
    expect(element.querySelectorAll('[data-announcement-outlet="polite"]').length).toBe(1);
    expect(element.querySelectorAll('[aria-live]').length).toBe(2);
  });
});

/** The shipped German catalogue, so a commit really does change the messages. */
const GERMAN: MessageCatalogue = germanCatalogue;

/** An update port a test can drive, standing in for the worker. */
class FakeUpdates {
  available = true;
  activations = 0;
  reloads = 0;

  /** Whether there is a page to start over. False stands in for no window. */
  restartable = true;

  #listener: ((event: VersionEvent) => void) | null = null;

  /**
   * The one-shot periods pending, in the order they were scheduled.
   *
   * A list rather than a slot, for the reason `application-update.store.spec.ts`
   * keeps one: the store runs two of them — the grace before a restart and the
   * arrival notice's own clock — and a slot silently loses whichever was
   * scheduled first.
   */
  readonly #pending: (() => void)[] = [];

  onVersionEvent(listener: (event: VersionEvent) => void): () => void {
    this.#listener = listener;
    return () => (this.#listener = null);
  }

  async check(): Promise<void> {}

  async activate(): Promise<void> {
    this.activations += 1;
  }

  reload(): boolean {
    this.reloads += 1;
    return this.restartable;
  }

  every(): () => void {
    return () => {};
  }

  after(_milliseconds: number, run: () => void): () => void {
    this.#pending.push(run);
    return () => {
      const index = this.#pending.indexOf(run);
      if (index >= 0) {
        this.#pending.splice(index, 1);
      }
    };
  }

  /** The worker reporting on this page's version. */
  report(event: VersionEvent): void {
    this.#listener?.(event);
  }

  /** The most recently scheduled period running out. */
  expire(): void {
    this.#pending.pop()?.();
  }
}

/**
 * `<dialog>` without the native modal methods, which jsdom does not implement.
 *
 * The overlay is a layer, and a layer calls them the moment it opens. What
 * these tests are about is what the shell decides to put up, not what a
 * browser does with a dialog element once it is up.
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

describe('App and a newly published version', () => {
  let updates: FakeUpdates;
  let sessionArea: MemoryStorage;

  beforeEach(async () => {
    stubNativeDialog();
    updates = new FakeUpdates();
    sessionArea = new MemoryStorage();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideLocalization(),
        { provide: ApplicationUpdateAdapter, useValue: updates },
        ...provideMemoryStorage(new MemoryStorage(), sessionArea),
      ],
    }).compileComponents();
  });

  /** The rendered shell, with the worker having reported `event` if it did. */
  function render(event?: VersionEvent): ComponentFixture<App> {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    if (event !== undefined) {
      updates.report(event);
      fixture.detectChanges();
    }
    return fixture;
  }

  /** Waits for every pending microtask, which is where the restart runs. */
  function settled(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function textIn(fixture: ComponentFixture<App>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  /** The command bar button carrying `label`, or null when none does. */
  function actionNamed(fixture: ComponentFixture<App>, label: string): HTMLElement | null {
    return (
      [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.frame__actions button',
        ),
      ].find((button) => (button.textContent ?? '').includes(label)) ?? null
    );
  }

  it('says nothing at all while the running version is the published one', () => {
    const fixture = render();

    expect(fixture.componentInstance.updateAction()).toBeNull();
    expect(fixture.componentInstance.updateStatus()).toBeNull();
    expect(textIn(fixture)).not.toContain(BUNDLED_ENGLISH['update.ready.notice']);
  });

  it('says what is about to happen on the overlay, before anything happens', () => {
    const fixture = render('ready');

    expect(fixture.componentInstance.updateOverlay()).toBe(true);
    expect(textIn(fixture)).toContain(BUNDLED_ENGLISH['update.applying.notice']);
    // Nothing has been replaced yet.
    expect(updates.activations).toBe(0);
    expect(updates.reloads).toBe(0);
  });

  it('offers nothing to press on the overlay, because the restart is not a question', () => {
    // Owner's decision, 2026-08-27. The layer is drawn with no dismiss label,
    // which takes its control, its Escape and its ground away together — a
    // time limit a Commander cannot stop, which is why constitution V names
    // WCAG 2.2.1 among the excluded criteria.
    const fixture = render('ready');
    const overlay = (fixture.nativeElement as HTMLElement).querySelectorAll('dialog[open]');

    expect(overlay.length).toBe(1);
    expect(overlay[0]?.querySelectorAll('button').length).toBe(0);
  });

  it('says the same thing once, on the overlay and not on the shell behind it', () => {
    // The shell under a modal is inert, so a notice and a control there would
    // be a second copy of this one that nobody can reach (feedback contract).
    const fixture = render('ready');

    expect(fixture.componentInstance.updateStatus()).toBeNull();
    expect(fixture.componentInstance.updateAction()).toBeNull();
  });

  it('offers the version on the shell when there was no page to start over', async () => {
    // The one path back to the shell control. A frame that may not navigate
    // itself leaves a session on the old version with the overlay down, and a
    // control it can reach is all it has left.
    updates.restartable = false;
    const fixture = render('ready');

    updates.expire();
    await settled();
    fixture.detectChanges();

    expect(fixture.componentInstance.updateOverlay()).toBe(false);
    expect(textIn(fixture)).toContain(BUNDLED_ENGLISH['update.ready.notice']);
    expect(actionNamed(fixture, BUNDLED_ENGLISH['update.ready.action'])).not.toBeNull();
  });

  it('activates the waiting version and starts over when the grace period runs out', async () => {
    render('ready');

    updates.expire();
    // The restart is asynchronous: activation has to land before the page is
    // started over, or the shell would come back asking the old version for
    // chunks the new one renamed.
    await settled();

    expect(updates.activations).toBe(1);
    expect(updates.reloads).toBe(1);
  });

  it('says the update was applied in the session that came up after the restart', () => {
    // The overlay above went with the page that drew it. This is the half a
    // Commander who looked away is certain to read, and it names the version
    // they landed on.
    sessionArea.entries.set(EDNB_UPDATE_APPLIED_KEY, '1');
    const fixture = render();

    expect(fixture.componentInstance.updateApplied()).toBe(true);
    expect(textIn(fixture)).toContain(BUNDLED_ENGLISH['update.applied.notice']);
    expect(textIn(fixture)).toContain(HELP_MANIFEST.build.applicationVersion);

    fixture.componentInstance.acknowledgeUpdate();
    fixture.detectChanges();
    expect(fixture.componentInstance.updateApplied()).toBe(false);
  });

  it('says nothing into the outlet while the overlay stands over it', () => {
    // The overlay is a modal layer, so the page behind it — the outlet
    // included, it is mounted inside the frame — is inert and out of the
    // accessibility tree. An announcement published here is one no reader is
    // ever offered, and the overlay is what speaks in that state.
    const fixture = render('ready');
    const announcements = TestBed.inject(AnnouncementService);

    expect(fixture.componentInstance.updateOverlay()).toBe(true);
    expect(announcements.polite()).toBe('');
    expect(announcements.assertive()).toBe('');
  });

  it('announces a waiting version politely, once, and says only what stays true', async () => {
    // The published version, not the restart. An announcement is spoken once
    // and cannot be taken back, so this waits for the overlay to come down on
    // a restart that could not be carried out: only then is there a reader to
    // hear it and a sentence that stays true.
    updates.restartable = false;
    const fixture = render('ready');
    const announcements = TestBed.inject(AnnouncementService);

    updates.expire();
    await settled();
    fixture.detectChanges();

    expect(announcements.polite()).toBe(BUNDLED_ENGLISH['update.ready.notice']);
    expect(announcements.assertive()).toBe('');

    // A further version behind the first is the same sentence for the same
    // revision, and the overlay going up and down again does not repeat it.
    // Asserted on what was published, not on what the outlet holds: the same
    // string written twice reads the same either way. The effect does re-run —
    // the overlay going up and coming down is a change it tracks — and the
    // shell remembering the version it announced is what refuses the second
    // publication, which is the half worth proving.
    const published = vi.spyOn(announcements, 'announce');

    updates.report('ready');
    fixture.detectChanges();
    updates.expire();
    await settled();
    fixture.detectChanges();

    expect(announcements.polite()).toBe(BUNDLED_ENGLISH['update.ready.notice']);
    expect(published.mock.calls.filter(([request]) => request.kind === 'app.update')).toEqual([]);

    // A version the shell has not announced is a second event, and is heard.
    updates.report('unusable');
    fixture.detectChanges();
    await settled();
    fixture.detectChanges();

    expect(published.mock.calls.filter(([request]) => request.kind === 'app.update')).toHaveLength(
      1,
    );
    expect(announcements.assertive()).toBe(BUNDLED_ENGLISH['update.unusable.announcement']);
  });

  it('does not republish the version event when a locale commits behind it', async () => {
    updates.restartable = false;
    const fixture = render('ready');
    const announcements = TestBed.inject(AnnouncementService);

    updates.expire();
    await settled();
    fixture.detectChanges();
    expect(announcements.polite()).toBe(BUNDLED_ENGLISH['update.ready.notice']);

    const published = vi.spyOn(announcements, 'announce');

    // Announcing resolves a message, and a message reads the catalogue. If that
    // read were tracked, this commit would re-run the version effect and put an
    // event that already happened back over whatever the outlet had moved on to.
    TestBed.inject(LocaleStore).commitCandidate(
      { requested: 'de', catalogue: GERMAN, source: 'asset', failure: null },
      'browser',
    );
    fixture.detectChanges();

    expect(published.mock.calls.filter(([request]) => request.kind === 'app.update')).toEqual([]);
  });

  it('treats a cached version that cannot be repaired as a blocking error', () => {
    const fixture = render('unusable');

    expect(fixture.componentInstance.updateStatus()?.tone).toBe('error');
    expect(textIn(fixture)).toContain(BUNDLED_ENGLISH['update.unusable.notice']);
    expect(actionNamed(fixture, BUNDLED_ENGLISH['update.unusable.action'])).not.toBeNull();
  });

  it('summarizes the blocking error in the outlet rather than repeating it', () => {
    render('unusable');
    const announcements = TestBed.inject(AnnouncementService);

    // An error notice is exposed as an alert, so it is spoken where it stands.
    // An outlet carrying the same sentence would say it to a reader twice; it
    // carries the summary instead, the way hull detail's unknown hull does.
    expect(announcements.assertive()).toBe(BUNDLED_ENGLISH['update.unusable.announcement']);
    expect(announcements.assertive()).not.toBe(BUNDLED_ENGLISH['update.unusable.notice']);
  });
});

describe('routes', () => {
  it('serves the equipment bench at its own address, lazily and named', async () => {
    // Both tools answer an address of their own, so either can be opened,
    // bookmarked and returned to without going through the other (013/FR-027).
    // Lazy, so the ship tool's initial bundle does not carry the bench.
    const bench = routes.find((route) => route.path === 'equipment');

    expect(bench?.title).toBe('equipment.title');
    expect(bench?.data?.['description']).toBe('equipment.description');
    expect(await bench?.loadComponent?.()).toBe(EquipmentBenchPage);
  });
});
