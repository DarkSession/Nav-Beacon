import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Driving the shell the way a Commander does.
 *
 * The same action lives in two compositions: on the banner where there is room,
 * and behind the named action layer where there is not. A journey should not
 * have to know which one it is looking at — it knows which action it wants — so
 * the reach happens here, once.
 *
 * The shell publishes no actions of its own; capability features supply them.
 */

/**
 * Waits until the running application owns the document.
 *
 * Since feature 015 an advertised address answers with a document the build
 * rendered, so every control on it is drawn and named before a single line of
 * the application has run. A journey that presses one in that window is not
 * pressing the application's control: it is pressing the build's markup, and
 * the press is held by the replay contract until the takeover reaches that
 * node. Measured on this container at `/ships`, the takeover completes about
 * two seconds after `load`, so a press at 600ms opens the layer at 2.6s — well
 * inside what a Commander gets, and well outside a five-second assertion when
 * eight journeys share the machine. That is what made `help-offline` fail one
 * run in three and pass the next.
 *
 * So a journey about the *running* application says so here, once, and waits.
 * What the first frame itself offers is a different question with its own
 * journey (`prerendered-first-frame.spec.ts`), and it must not be answered by
 * accident in every other one.
 *
 * The wait is over when `main` is on the page and no control is still holding a
 * press for the takeover. Both halves are asked, because a journey meets two
 * kinds of document.
 *
 * A document with a rendered body states the screen from the first byte, `main`
 * included. There the held presses are the signal, cleared node by node as the
 * takeover reaches them.
 *
 * A document with no rendered body states neither, and three things serve one.
 * The build writes one for an advertised address whose screen has no content of
 * its own, `/outfitting` and `/equipment`. The host answers an address the build
 * wrote nothing for with `404.html`. The worker answers every navigation with
 * `index.csr.html` once the network is gone (`ngsw-config.json`,
 * `navigationRequestStrategy`). None of the three carries a control, so the
 * presses say nothing there.
 *
 * What says the application has drawn on those is `main`, painted on boot. A
 * production build resolves the route before it boots (`app.config.ts`,
 * `withEnabledBlockingInitialNavigation`), so the screen is already inside it.
 * A development build paints the frame first and the route's chunk a moment
 * later.
 *
 * Thirty seconds, because this wait spans a boot rather than a paint. On a shell
 * the application starts from nothing, and offline it reads every chunk of
 * itself from the worker's cache.
 */
export async function waitForTakeover(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector('main') !== null &&
      document.querySelectorAll('[jsaction]').length === 0,
    undefined,
    {
      timeout: 30_000,
    },
  );
}

/** The trigger that unfolds the bar's own controls, at the widths that fold them. */
const MENU = /^(menu|menü)$/i;

/**
 * The address the outfitting workspace answers to, with or without a build in
 * its fragment. Named once here because three waits in this file are about
 * having arrived at it.
 */
const WORKSPACE = /\/outfitting(#|$)/;

/**
 * Waits until the bar has decided which composition it is.
 *
 * The bar chooses between offering its controls and folding them into the menu
 * by measuring itself, and since 015/T006 that measurement is taken after the
 * first render rather than during it. So there is a moment when neither the
 * action nor the menu is on screen, and a journey that counted in that moment
 * would conclude the bar was folded when it had simply not drawn yet — then
 * wait out its whole timeout for a menu a wide screen never shows.
 */
async function waitForBar(page: Page, wanted: Locator): Promise<void> {
  await expect(wanted.or(page.getByRole('button', { name: MENU })).first()).toBeVisible();
}

/** Opens the folded action layer if the wanted action is not already visible. */
export async function reachShellAction(page: Page, name: RegExp): Promise<void> {
  await waitForTakeover(page);
  const action = page.getByRole('button', { name });

  await waitForBar(page, action);

  if ((await action.count()) === 0) {
    await openActionLayer(page);
  }

  await action.first().click();
}

/**
 * Opens the saved builds, at whichever width.
 *
 * They have no address of their own: the library is a layer over whatever
 * screen a Commander is on, raised by a shell action. So a journey lands on a
 * screen first and presses the control, which is the only way in.
 */
export async function openLibrary(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) {
    await page.goto('/ships');
  }
  // Named in whichever language the browser asked for.
  const layer = page.getByRole('dialog', {
    name: /^(Saved builds|Gespeicherte Aufbauten)/i,
  });
  // A journey that used to re-`goto` the address while the layer was already up
  // asked for the list it is looking at. Pressing the control again would reach
  // through the layer for a button the layer is covering.
  if (!(await layer.isVisible())) {
    await reachShellAction(page, /^(Open saved build|Gespeicherten Aufbau öffnen)$/);
  }
  // Waited on generously, for the same reason the catalogue's own press is
  // (`prerendered-first-frame.spec.ts`): the layer is deferred, so the press
  // asks the server for the library's code and the layer is drawn when it
  // arrives. Seventeen chunks over a server that several readings are asking
  // for a build from at once is not the ten seconds a bare expectation allows,
  // and a layer that took twelve seconds to arrive under that load is a slow
  // server rather than a library that failed to open.
  await expect(layer).toBeVisible({ timeout: 30_000 });
}

/**
 * Follows one of the tools the bar offers, at whichever width.
 *
 * Canvas 4c puts them on the tool deck; canvas 1d folds the bar's own controls
 * into the `⋮` menu beneath it. A journey knows only which tool it wants.
 */
export async function reachShellLink(page: Page, name: RegExp | string): Promise<void> {
  await waitForTakeover(page);
  const link = page.getByRole('link', { name });

  await waitForBar(page, link);

  if ((await link.count()) === 0) {
    await openActionLayer(page);
  }

  await link.first().click();
}

/**
 * Opens the folded bar's menu.
 *
 * The trigger carries visible text rather than the reference's unlabelled
 * ellipsis, so it is found by name like everything else.
 */
export async function openActionLayer(page: Page): Promise<void> {
  await waitForTakeover(page);
  await page.getByRole('button', { name: MENU }).first().click();
}

/**
 * Waits until the working build has been written to this browser.
 *
 * Read from the workspace's own state attribute rather than from a banner. No
 * canvas draws a "saved" notice — the reference reports problems and is silent
 * otherwise — so a journey that waited for one was waiting on a screen the
 * design does not have (canvas 1c, "Build status").
 */
/**
 * Opens a stored record from the library, as the surface now offers it.
 *
 * Since 2026-08-25 the library commits from a footer that acts on the row it
 * has chosen, so opening a record is two presses: choose the row, then open it.
 * Retried as one unit, because the listing re-reads storage after any write and
 * the row a press was aimed at can be replaced a frame later.
 *
 * Both presses are scoped to the library's own layer, and a retry that finds the
 * workspace already open simply stops. Without either, a retry after a
 * navigation that has already landed would press the workspace's own title —
 * which is a button too, and carries the same name as the row.
 */
export async function openRecordFromLibrary(page: Page, title: string): Promise<void> {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const surface = page.getByRole('dialog', { name: /^saved builds$/i });
  const row = surface.getByRole('button', { name: new RegExp(`^${escaped}\\b`, 'i') });
  // The footer's action is named for what it does rather than for the build it
  // does it to, as the canvas names it (canvas 1a, "SAVED BUILDS").
  const open = surface.getByRole('button', { name: 'Open in outfitting', exact: true });

  await expect(async () => {
    // Already in the workspace with nothing standing over it. The address alone
    // no longer answers this: the library is a layer with no address of its own
    // (2026-09-04), so it can be open on top of `/outfitting` and the record has
    // still not been opened.
    if (WORKSPACE.test(page.url()) && !(await surface.isVisible())) {
      return;
    }
    await row.click({ timeout: 5_000 });
    await open.click({ timeout: 5_000 });
    await expect(page).toHaveURL(WORKSPACE, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });

  await expect(page).toHaveURL(WORKSPACE);
}

export async function savedToBrowser(page: Page | Locator): Promise<void> {
  await expect(page.locator('ednb-build-workspace-page')).toHaveAttribute(
    'data-persistence',
    'saved',
  );
}

/** How many records this browser is holding, whatever tool wrote them. */
export async function recordCount(page: Page): Promise<number> {
  return page.evaluate(
    () => Object.keys(localStorage).filter((key) => key.startsWith('ednb:record:')).length,
  );
}

/**
 * Waits until this browser holds exactly this many records.
 *
 * Polled rather than read once wherever the count answers something the journey
 * has just pressed. Autosave coalesces its writes, so the store is written after
 * the layer has closed and after the status line has changed, and a bare read is
 * a verdict on whichever instant it landed in. A count that states that nothing
 * changed is read once instead: it holds from the first attempt, so polling it
 * proves nothing the read does not.
 */
export async function expectRecords(page: Page, count: number): Promise<void> {
  await expect.poll(() => recordCount(page)).toBe(count);
}

/**
 * Opens a hull's detail from the manifest, however this device does it.
 *
 * Where the manifest can be hovered, resting on a row is what shows the hull
 * and pressing it starts a stock build of it; where it cannot — a touch screen
 * has no resting — the press is still the way in. A journey wanting the detail
 * should not have to know which of the two it is looking at, so the question is
 * asked here, once, in the stylesheets' own words.
 */
export async function openHullFromManifest(page: Page, name: string): Promise<void> {
  await reachHull(
    page,
    page.getByRole('button', { name: new RegExp(`(view|build a stock) ${name}\\b`, 'i') }).first(),
  );
}

/** The same, for a journey that only needs a hull rather than a named one. */
export async function openFirstHullFromManifest(page: Page): Promise<void> {
  await reachHull(
    page,
    page
      .locator('[data-hull-symbol]:visible')
      .first()
      .getByRole('button', { name: /(view|build a stock) /i })
      .first(),
  );
}

/**
 * Starts a stock build for the hull the detail screen is showing.
 *
 * Canvas 1b's sheet pins a `Build` action to its footer plate. Canvas 1a's rail
 * draws none: the manifest is beside the inspector at that width and a row's own
 * press is the build, so a second control a centimetre away would be the same
 * transaction reached twice (`hull-detail.page.scss`, "The commitment"). The
 * rail keeps the action on a device that cannot hover, because there a row press
 * opens the detail rather than building.
 *
 * A journey wanting a build should not have to know which of the two it is
 * looking at, so the question is asked here, once, by looking for the action
 * rather than by measuring the viewport. Both candidates are waited for before
 * either is pressed: a journey reaches here straight off a `goto`, which
 * resolves on `load` — before the route's own chunk has drawn anything — and a
 * question asked then is answered "the sheet has no action" on a composition
 * where it has one.
 *
 * Which hull is asked for is taken from the screen rather than passed in, so no
 * journey has to spell a symbol twice and none of them has to spell it the
 * package's way.
 *
 * Returns once the address is the workspace's, which is where the press lands.
 * What that screen goes on to draw is each journey's own wait.
 */
export async function buildStockHull(page: Page, label: string): Promise<void> {
  await test.step('setup: stock hull', async () => {
    // Before any of it, because the retry below would otherwise press a control
    // the build drew and press it again after the takeover, which is one
    // commitment made twice.
    await waitForTakeover(page);
    const action = page.getByRole('button', { name: label, exact: true });
    const row = manifestBuildControl(page);

    // Longer than the default, because the wait here spans a route's first paint:
    // every journey reaches this straight off a navigation.
    await expect(action.or(row).first()).toBeVisible({ timeout: 15_000 });

    // Asked again on every attempt, and answered in favour of the action.
    //
    // A journey arrives here mid-navigation, where the screen being left still
    // answers the question: the manifest row of the hull just opened is in the
    // document a moment longer than the route that is going. Asked once, the
    // answer can be that row — and by the time it is pressed the row is gone,
    // which is a thirty-second wait on a control that will never appear. The two
    // are not interchangeable either, so the pair cannot simply be pressed
    // together: a document holds both, and the first of them in document order is
    // the manifest's, not the screen's.
    await expect(async () => {
      const target = (await action.first().isVisible()) ? action.first() : row;
      await target.click({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // The press is not finished until the address is the workspace's.
    //
    // The landing belongs to the press: no caller presses this control to stay
    // where it is, and one statement here is a budget about the work the wait
    // spans rather than one added to whichever assertion failed last.
    //
    // The first press in a document spans a fetch, which is the case the budget
    // is written for. The commitment reaches the store first, and the router
    // publishes `/outfitting` only once it has loaded that screen's own chunk —
    // `/outfitting` is lazy like every other route here (`app.routes.ts`).
    // Angular writes the address just before it activates the routes, so the wait
    // ends at the chunk rather than at the screen, and what the screen then draws
    // is the caller's own wait.
    //
    // A fetch is one of the reasons the verification contract's assertion ruling
    // gives for stating a budget instead of taking the run's allowance, which is
    // ten seconds on CI. Fifteen is the figure this file already states for a
    // route arriving, above; it is a ceiling with margin rather than a
    // measurement, since this wait spans no more than that one does.
    await expect(page).toHaveURL(WORKSPACE, { timeout: 15_000 });
  });
}

/**
 * The manifest's own control for the hull whose detail is open, which at a
 * hovering width is the build itself: a rested pointer opens a hull and the
 * press after it flies its stock loadout, so the row's button reads
 * `Build a stock <hull>` rather than `View <hull>`
 * (`responsive-catalogue-view.ts`, `openActionLabel`).
 *
 * Found by the hull's own hook rather than by the name on the control, which is
 * game text in the reader's language — `Federation_Corvette` is drawn `Federal
 * Corvette`, and the whole sentence is German on a German journey.
 *
 * Two ways to the same row, because a hull is reached two ways. A hull opened
 * from the manifest leaves its row marked current, and that mark is the answer
 * while the address is still catching up with the press that opened it. A hull
 * loaded at its own address marks no row, so there the address names it —
 * matched without regard to case, since the route accepts `Sidewinder` for a
 * hull the package calls `SideWinder`.
 *
 * `:visible` sits on the control rather than on the row, because the manifest is
 * drawn twice — a table and a card list, one of them hidden at any width.
 */
export function manifestBuildControl(page: Page): Locator {
  const symbol = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
  return page
    .locator('[data-hull-symbol][aria-current="true"] button:visible')
    .or(page.locator(`[data-hull-symbol="${symbol}" i] button:visible`))
    .first();
}

/**
 * Whether resting a pointer on a manifest row reads the hull it names.
 *
 * The application's own question, asked the application's way: the device has
 * to be able to rest a pointer somewhere, and the rail that reading appears in
 * has to be drawn. Below the rail's width a rest reads nothing at every device,
 * so a journey that hovered there would wait on a navigation that never comes
 * (`src/app/ui/wide-composition.ts`, `observeRestingReads`).
 */
export function restsToRead(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(hover: hover) and (min-width: 64rem)').matches);
}

async function reachHull(page: Page, row: Locator): Promise<void> {
  await waitForTakeover(page);
  if (await restsToRead(page)) {
    await row.hover();
  } else {
    await row.click();
  }
}

/**
 * Holds every chunk the browser asks for from here on.
 *
 * Every screen is its own code, fetched on the navigation that first asks for
 * it, so a journey about what a Commander is told while they wait has to be
 * able to make them wait. Held by resource type rather than by file name: a
 * development server and a production build name their chunks differently, and
 * a journey that knew which would be a journey that runs in one lane.
 *
 * Arm it after the takeover, so the only script left to ask for is the one the
 * next navigation needs. The gate is read when each request is answered rather
 * than awaited once, so a request already waiting is answered by whatever the
 * journey decides afterwards.
 */
export interface HeldChunks {
  /** Lets every held chunk through, and every one asked for after it. */
  release(): void;
  /** Refuses them, the way a connection that drops does. */
  refuse(): void;
  /**
   * How many separate pieces of code have been asked for since the gate was
   * armed.
   *
   * What a navigation that has begun looks like from outside the application: a
   * screen it has not opened before is a `loadComponent`, so it asks for that
   * screen's code before it can present it. Read where a journey has to know
   * that the navigation taking over has started and cannot ask the application
   * — the address does not move until the screen is presented, and the screen
   * is what the gate is holding back. The chunk's own name says nothing: a
   * build hashes it.
   */
  timesAsked(): number;
}

export async function holdEveryChunk(page: Page): Promise<HeldChunks> {
  let gate: 'hold' | 'release' | 'refuse' = 'hold';
  const asked = new Set<string>();

  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') {
      asked.add(route.request().url());
    }
    if (route.request().resourceType() !== 'script') {
      // A page that navigates away disposes the routes it left waiting, and a
      // disposed route is not an outcome worth failing a journey over.
      await route.continue().catch(() => {});
      return;
    }
    while (gate === 'hold') {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (gate === 'refuse') {
      await route.abort('failed').catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });

  return {
    release: () => {
      gate = 'release';
    },
    refuse: () => {
      gate = 'refuse';
    },
    timesAsked: () => asked.size,
  };
}

/** The waiting statement, while it stands. */
export function waitingStatement(page: Page): Locator {
  return page.locator('ednb-waiting-overlay dialog[open]');
}

/**
 * A watch on the waiting statement, counting every time it is drawn and taken
 * down.
 *
 * A reading taken once a navigation is over cannot tell a statement that was
 * never drawn from one that was drawn and removed, and it cannot see a
 * statement taken down and put back inside one frame either. Both are what the
 * threshold and the handover between two navigations exist to prevent, so this
 * watches the `open` attribute itself rather than sampling: a mutation observer
 * is called for every change to it, where a frame callback looks once every
 * sixteen milliseconds and the threshold is ten. It compares state when it is
 * called, so a statement closed and reopened inside one task reads as no change
 * — which is not the case being read, because a statement taken down and drawn
 * again is drawn a threshold later, a task or more away.
 */
export interface StatementWatch {
  /** Whether the statement stood at any point since the watch was set. */
  wasDrawn(): Promise<boolean>;
  /** How many separate times it was drawn. One handover is still one. */
  timesDrawn(): Promise<number>;
  /**
   * How many separate times it was taken down.
   *
   * Read where the end state cannot be: a screen whose code is held from
   * arriving leaves the application asking for it again, so what stands a
   * second later is a later navigation's answer rather than this one's. Whether
   * a statement was taken down, and when, is the reading — not what happens to
   * stand afterwards.
   */
  timesRemoved(): Promise<number>;
}

/** The watcher itself, held apart because it is installed in two ways. */
const WATCH_THE_STATEMENT = () => {
  const window_ = window as unknown as { __waitingDrawn?: number; __waitingRemoved?: number };
  let standing = false;
  const look = (): void => {
    const now = document.querySelector('ednb-waiting-overlay dialog[open]') !== null;
    if (now && !standing) {
      window_.__waitingDrawn = (window_.__waitingDrawn ?? 0) + 1;
    }
    if (!now && standing) {
      window_.__waitingRemoved = (window_.__waitingRemoved ?? 0) + 1;
    }
    standing = now;
  };

  // The document itself, not its root element. This watcher is also installed
  // before the document exists, where the root element has not been parsed yet
  // and `observe` would be handed nothing — an exception a browser raises into
  // a page nobody is reading, leaving a watch that answers zero for ever. A
  // `Document` is always there, and `subtree` reaches everything under it.
  //
  // Watched first, counted second. The counters are what a reading is taken
  // from, and an install that threw here leaves them unwritten, which is how a
  // watch that was never installed tells itself apart from one that saw
  // nothing. A callback cannot arrive before they are written: it is a
  // microtask, and the next two lines are this one's own turn.
  new MutationObserver(look).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open'],
  });
  window_.__waitingDrawn = 0;
  window_.__waitingRemoved = 0;
  look();
};

function readTheWatch(page: Page): StatementWatch {
  // A count the watcher never wrote is not a count of none. Almost every
  // reading taken through this watch is that the statement was never drawn, and
  // a watcher that failed to install answers that too — quietly, and for ever.
  // So the absent counter is an error rather than a zero.
  const count = async (name: '__waitingDrawn' | '__waitingRemoved'): Promise<number> => {
    const read = await page.evaluate(
      (key) => (window as unknown as Record<string, number | undefined>)[key],
      name,
    );
    if (read === undefined) {
      throw new Error(
        `The statement watch is not on this page: it holds no ${name}. Either the watch ` +
          'never installed, or the document it was installed in has been replaced since.',
      );
    }
    return read;
  };
  const drawn = (): Promise<number> => count('__waitingDrawn');
  const removed = (): Promise<number> => count('__waitingRemoved');
  return {
    wasDrawn: async () => (await drawn()) > 0,
    timesDrawn: drawn,
    timesRemoved: removed,
  };
}

/** Starts watching the page as it stands, without reloading it. */
export async function watchForTheStatement(page: Page): Promise<StatementWatch> {
  await page.evaluate(WATCH_THE_STATEMENT);
  return readTheWatch(page);
}

/**
 * The same, from before the document exists.
 *
 * What a session's first presentation is covered by can only be watched from
 * before there is a page to watch, so this one is installed for the next
 * navigation rather than run on this one.
 */
export async function watchForTheStatementFromStart(page: Page): Promise<StatementWatch> {
  await page.addInitScript(WATCH_THE_STATEMENT);
  return readTheWatch(page);
}
