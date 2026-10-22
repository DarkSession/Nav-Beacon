import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { ZOOM_400 } from './accessibility';
import { expectNoDocumentOverflow } from './accessibility/assertions';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  MEASURED,
  type Frame,
  frames,
  framesSinceTheDocumentWasAlone,
  markTheDocumentsLastFrame,
  openBeforeTheBundleArrives,
  openOnceTheTypefaceHasArrived,
  openWithADelayedBundle,
  openWithoutTheBundle,
  recordFrames,
  theTypefaceHasArrived,
} from './first-frame';
import { PRODUCT_URL } from './servers';
import { shapeOf } from './served-document';
import {
  holdEveryChunk,
  waitForTakeover,
  waitingStatement,
  watchForTheStatementFromStart,
} from './shell';

/**
 * The frame a Commander is given before the application exists, and what the
 * takeover is allowed to do to it.
 *
 * `search-published.spec.ts` reads the documents the build wrote as files. This
 * journey opens them in a browser, which is the other half of the same promise:
 * a document that states everything and then gets blanked, moved or re-composed
 * a second later is a worse first frame than the empty shell this feature
 * replaced, and only a browser can catch that (FR-008 through FR-012, SC-003,
 * SC-004).
 *
 * The last journey is about the other document the same output serves: the one
 * with no rendered body, where the takeover starts from an empty shell.
 *
 * It needs the production output for the same reason its sibling does — a
 * development server has no generated documents — so it runs under
 * `pnpm run e2e:offline`, across all ten projects (`playwright.config.ts`,
 * `NEVER_IN_A_DEVELOPMENT_RUN`).
 */

/** The three screens this feature renders, and the subject each address is about. */
const SCREENS = [
  // The start page's own line, not the shell's product name: the shell is on
  // every address, and a subject that appears on all three proves nothing about
  // any of them.
  { path: '/', subject: 'Tools for Commanders' },
  { path: '/ships', subject: 'Anaconda' },
  { path: '/ships/Anaconda', subject: 'Anaconda' },
] as const;

/**
 * The shape of the screen's content, ignoring every word in it, with the notes
 * a non-English reading adds taken back out.
 *
 * Element names in document order, inside `main` alone. The shell is left out
 * on purpose: the session layers it owns are drawn only where there is a
 * Commander to use them, so they legitimately appear at the takeover and would
 * read here as the page being rebuilt.
 *
 * The disclosures come out because of FR-011a, and taking them out is the only
 * way to compare two readings at all: a game name shown in its original
 * language is disclosed as such beside itself, and English has nothing to
 * disclose because English is the original. So the German page carries one extra
 * span inside every `ednb-game-text` and the English one carries none.
 */
function outlineWithoutDisclosures(page: Page): Promise<string> {
  return page.evaluate(() => {
    const disclosed = new Set(document.querySelectorAll('main .game-text__disclosure'));
    return [...(document.querySelector('main')?.querySelectorAll('*') ?? [])]
      .filter((element) => !disclosed.has(element))
      .map((element) => element.tagName.toLowerCase())
      .join(',');
  });
}

/** How many game names are disclosed as being in their original language. */
function disclosures(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('main .game-text__disclosure').length);
}

/**
 * The list, frame by frame, as the shape a Commander could describe.
 *
 * How many hulls are on screen and which one is at the top: between them they
 * name a filter and an order, which is the whole of what a stored catalogue
 * view can change (FR-009a). Recorded alongside whether the takeover has
 * finished, because the requirement is not merely that the stored view is
 * applied — it is that it is applied *in* the takeover frame rather than a
 * frame after it, and only the pair can tell those apart.
 */
interface ListFrame {
  readonly shape: string;
  readonly takenOver: boolean;
}

/**
 * Recorded only once the document has finished arriving.
 *
 * The catalogue document is a quarter of a megabyte and the browser paints it
 * while it is still reading it, so the list genuinely passes through 18 rows
 * and 30 rows on its way to the 49 the document states. Those are not shapes
 * the application composed; they are the document not being all there yet, and
 * counting them would make every run report a list that changed several times
 * before anything had run at all.
 */
async function recordList(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const list: unknown[] = [];
    (window as unknown as { __list: unknown[] }).__list = list;
    const record = () => {
      const rows = [...document.querySelectorAll('[data-hull-symbol]')].filter(
        (row) => (row as HTMLElement).offsetParent !== null,
      );
      if (rows.length > 0 && document.readyState !== 'loading') {
        list.push({
          shape: `${rows.length}:${rows[0].getAttribute('data-hull-symbol')}`,
          takenOver: document.querySelectorAll('[jsaction]').length === 0,
        });
      }
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
}

async function listFrames(page: Page): Promise<readonly ListFrame[]> {
  return page.evaluate(() => (window as unknown as { __list: ListFrame[] }).__list ?? []);
}

/** A stored catalogue view, written the way the application writes it. */
async function storeCatalogueView(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'ednb:catalogue',
      JSON.stringify({
        version: 2,
        filters: { query: '', sizes: ['large'] },
        sort: { field: 'name', direction: 'descending' },
        anchor: null,
      }),
    );
  });
}

/**
 * Asserts that every frame sits where the first one did.
 *
 * Compared box by box and named, rather than deep-compared as an array: a
 * `toEqual` failure prints four rectangles of numbers and leaves the reader to
 * work out which selector each one was, and the answer to "what moved" is the
 * whole value of the assertion.
 */
function nothingMovedAcross(window: readonly Frame[], path: string): void {
  const first = window[0];
  for (const [index, frame] of window.entries()) {
    const moved = frame.boxes
      .map((box, at) => ({ box, at }))
      .filter(({ box, at }) => JSON.stringify(box) !== JSON.stringify(first.boxes[at]))
      .map(
        ({ box, at }) =>
          `${MEASURED[at]}: ${JSON.stringify(first.boxes[at])} → ${JSON.stringify(box)}`,
      );

    expect(
      moved,
      `${path} moved ${index} frame(s) into the takeover, of ${window.length}` +
        ` (taken over: ${frame.takenOver}, typeface: ${frame.dressed})`,
    ).toEqual([]);
  }
}

test.describe('the first frame of a generated document', () => {
  for (const { path, subject } of SCREENS) {
    test(`states ${path} to a reader that runs no script`, async ({ page }) => {
      // The claim this whole feature exists to make, in the form it is made to
      // a crawler: the served document, with nothing else, is about its address
      // (FR-008). Nothing here is timed, because nothing here is a race — this
      // is the page as a file.
      await openWithoutTheBundle(page, path);
      await expect(page.getByRole('main')).toBeVisible();

      const text = (await page.locator('body').innerText()).toLowerCase();

      expect(text, `${path} stated its subject`).toContain(subject.toLowerCase());
    });

    test(`states ${path} before the application exists`, async ({ page }) => {
      // SC-004's measurement, taken as a frame ordering rather than as a
      // duration: the subject is painted in a frame the application has not
      // reached yet. Before this feature the subject's first frame was the one
      // after the application had booted; now the order is the other way round,
      // and the order is the whole of what changed.
      //
      // The subject's frame is not asserted to be sample 0. A generated document
      // is up to a quarter of a megabyte and the browser paints while it is
      // still reading it, so the earliest samples can hold a banner and the
      // first few rows of a table. That is the document arriving, and it is
      // still the document rather than the application: a module script does not
      // run until the parse is done, so every partial frame is by construction a
      // frame the application has not touched.
      await recordFrames(page, subject);
      await openWithADelayedBundle(page, path);
      await waitForTakeover(page);

      const recorded = await frames(page);
      const stated = recorded.filter((frame) => frame.subject && !frame.takenOver);

      expect(recorded.length, 'frames recorded').toBeGreaterThan(0);
      expect(
        stated.length,
        `${path} never stated its subject in a frame the application had not reached`,
      ).toBeGreaterThan(0);
      expect(stated[0].length, `${path} text before the application existed`).toBeGreaterThan(0);
    });

    test(`keeps ${path} whole across the takeover`, async ({ page }) => {
      // FR-009 and the second half of SC-003. Nothing here is about how long
      // the takeover takes; it is about whether any frame in the middle of it
      // is worse than the frame before. A wipe-and-rebuild shows up as a
      // collapse in length and as the subject going false, and both are read
      // frame by frame rather than as a before-and-after pair, because a page
      // that blanks and comes back looks identical at the ends.
      await recordFrames(page, subject);
      await page.goto(`${PRODUCT_URL}${path}`);
      await waitForTakeover(page);

      // From the frame the document finished arriving in, for the reason
      // `Frame.parsed` gives: a page that is still being read is shorter than
      // the page being served, and that is the download rather than the
      // takeover.
      const recorded = (await frames(page)).filter((frame) => frame.parsed);
      const lost = recorded.findIndex((frame) => !frame.subject);

      expect(recorded.length, `${path} finished arriving`).toBeGreaterThan(0);
      expect(lost, `${path} left the screen at frame ${lost}`).toBe(-1);

      // Length is allowed to grow — a label the application resolves once it can
      // measure — and not to fall. Compared against the running maximum rather
      // than the neighbour, so a dip that recovers within one frame is still a
      // dip.
      let tallest = 0;
      recorded.forEach((frame, index) => {
        expect(frame.length, `${path} shrank at frame ${index}`).toBeGreaterThanOrEqual(tallest);
        tallest = Math.max(tallest, frame.length);
      });
    });

    test(`moves nothing on ${path} across the takeover`, async ({ page }) => {
      // SC-003's first half, measured as boxes rather than as a layout-shift
      // score: `layout-shift` entries are Chromium-only, and half the matrix is
      // Firefox. Four boxes, because they answer four different questions —
      // where the shell's bar sits, where the screen's content begins, where the
      // screen itself sits, and where the page ends (`MEASURED`). A composition
      // corrected after the fact moves at least one of them.
      //
      // Opened with the bundle held until the page is wearing the typeface it
      // asked for, which is what makes the measurement below about the
      // application at all. Two things settle a page before any of this
      // application exists: a quarter-megabyte document paints while it is
      // still being read, and a face that arrives after the paint it is wanted
      // for swaps in under `font-display: swap` — Firefox at 1112px is ten
      // pixels taller in the fallback than in Barlow.
      // Neither is the takeover, both happen to a page whose bundle never
      // arrives, and holding the bundle until after them is simpler and more
      // honest than trying to tell their frames apart afterwards.
      await recordFrames(page, subject);
      await openOnceTheTypefaceHasArrived(page, path);
      await waitForTakeover(page);

      // Measured from the last frame the document had to itself, through every
      // frame after it. That is SC-003's sentence exactly — what a Commander was
      // reading when the application arrived is where it stays — and it is the
      // reading that does not depend on knowing which of the earlier frames were
      // the page settling and which were something moving.
      //
      // A wipe-and-rebuild cannot hide in the gap: the frames are consecutive
      // samples, so a blanked or re-composed frame is itself one of the frames
      // compared. Measured on `/ships/Anaconda` before the blocking initial
      // navigation shipped, `main` went from 1029 pixels to 4857 between two of
      // them.
      const parsed = (await frames(page)).filter((frame) => frame.parsed);
      const arrival = parsed.findIndex((frame) => frame.takenOver);

      expect(parsed.length, `${path} finished arriving`).toBeGreaterThan(0);
      expect(
        arrival,
        `${path} was taken over before it was ever recorded on its own`,
      ).toBeGreaterThan(0);

      nothingMovedAcross(parsed.slice(arrival - 1), path);
    });
  }

  test('applies a stored catalogue view in the takeover frame, not a frame later', async ({
    page,
  }) => {
    // FR-009a, the one content change FR-009 permits besides the language. The
    // build knows no session, so it renders the catalogue in default order with
    // no filter; a Commander who left a filter behind gets it back when the
    // application arrives. What must not happen is a Commander watching the
    // full list arrive and then narrow, which is content changing under them.
    await storeCatalogueView(page);
    await recordList(page);
    await page.goto(`${PRODUCT_URL}/ships`);
    await waitForTakeover(page);
    await expect(page.getByRole('main')).toBeVisible();

    const recorded = await listFrames(page);
    const shapes = [...new Set(recorded.map((frame) => frame.shape))];

    // Two shapes and no more: the document's, then the Commander's. A third
    // would be the application composing the list twice.
    expect(shapes.length, `list shapes: ${shapes.join(' → ')}`).toBe(2);

    // And the second one is already there in the first frame the takeover has
    // finished in. A stored view applied a frame late shows the document's
    // shape here.
    const first = recorded.find((frame) => frame.takenOver);

    expect(first, 'a frame after the takeover').toBeDefined();
    expect(first?.shape, 'the stored view in the takeover frame').toBe(shapes[1]);
  });

  test('changes nothing at all for a Commander with no stored view', async ({ page }) => {
    // The common case, and the one FR-009 holds in full. The exception above
    // exists for a Commander who left a filter behind; everybody else must see
    // the list the document painted and go on seeing it.
    await recordList(page);
    await page.goto(`${PRODUCT_URL}/ships`);
    await waitForTakeover(page);
    await expect(page.getByRole('main')).toBeVisible();

    const shapes = [...new Set((await listFrames(page)).map((frame) => frame.shape))];

    expect(shapes, 'the list changed with no stored view to apply').toHaveLength(1);
  });

  test('leaves a readable page when the bundle never arrives', async ({ page }) => {
    // FR-012. The document is not a placeholder for the application: it is what
    // a Commander is left with when the application cannot load, so it has to
    // stand on its own.
    await openWithoutTheBundle(page, '/ships/Anaconda');

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('Anaconda');

    // Lower-cased and run together, because `innerText` reports what the screen
    // shows: this screen sets its figures in capitals, and it puts each value on
    // its own line from its unit. What is under test is that the hull's facts
    // are in the document, not how they are typeset.
    const text = (await page.locator('body').innerText()).toLowerCase().replace(/\s+/g, ' ');

    expect(text).toContain('faulcon delacy');
    expect(text).toContain('180 m/s');
    expect(text).toContain('350 mj');
  });

  for (const { path } of SCREENS) {
    test(`scans ${path}'s first frame for accessibility violations`, async ({ page }, testInfo) => {
      // FR-019 and SC-005. The generated frame is a frame a Commander sees, so
      // it carries the same obligation as every other one — WCAG 2.2 AA less
      // the eight criteria the constitution excludes, which is what
      // `expectNoAccessibilityViolations` scans everywhere else.
      //
      // What is new is *when*. Every other scan in this suite runs against the
      // settled page, which is a state the application composed. This one runs
      // against a state the build composed and the application has never
      // touched.
      await openWithoutTheBundle(page, path);
      await expect(page.getByRole('main')).toBeVisible();

      await expectNoAccessibilityViolations(page, testInfo, { label: `first frame of ${path}` });
    });
  }
});

/**
 * A Commander whose browser asks for German (FR-011, FR-011a).
 *
 * The document is bundled English, and always will be: this feature publishes
 * one document per address, not one per language, and language follows the
 * browser setting rather than the address (011/FR-017). So a German Commander
 * reads complete English while their catalogue loads and then reads German —
 * which is the behaviour the application already had. What this feature changes
 * is only which frame the English arrives in.
 *
 * The exception is named and bounded: the words may change, plus one note per
 * game name that is not published in German, and nothing else.
 */
test.describe('a document read by a Commander whose browser asks for German', () => {
  test.use({ locale: 'de-DE' });

  test('replaces the words, adds only the notes English does not need', async ({ page }) => {
    // The English shape is read from the document as it is served rather than
    // from the page before the takeover. It is the same shape either way — the
    // takeover adopts these nodes, it does not build new ones — but a page has
    // only a few hundred milliseconds of being English and a test that races
    // that window reports the language rather than the layout.
    const served = await (await page.request.get(`${PRODUCT_URL}/ships`)).text();
    const servedShape = await shapeOf(page, served);
    const before = servedShape.outline;

    expect(before, 'the served document stated a catalogue').toContain('ednb-game-text');
    expect(served, 'the served document was English').toContain(
      englishMessages['catalogue.search.label'],
    );
    expect(servedShape.disclosures, 'the served English disclosed its own nouns').toBe(0);

    await page.goto(`${PRODUCT_URL}/ships`);
    await expect(page.getByRole('main')).toBeVisible();

    await waitForTakeover(page);
    await expect(page.getByText(germanMessages['catalogue.search.label'])).toBeVisible();

    // Nothing removed, nothing reordered. Reflow is permitted and is not
    // measured here — "Schiffe oder Hersteller suchen" is not the length of
    // "Search ships or manufacturers" and cannot be made to be.
    expect(
      await outlineWithoutDisclosures(page),
      'the page was rebuilt rather than translated',
    ).toBe(before);

    // And the one thing that was added is the disclosure itself, on a page whose
    // every row names a hull the game publishes in English only. Asserted as a
    // count greater than zero rather than as a number, because the number is the
    // package's hull count and this test is not about how many hulls there are.
    expect(
      await disclosures(page),
      'German said nothing about the untranslated names',
    ).toBeGreaterThan(0);
  });
});

/**
 * The waiting statement and the documents the build writes.
 *
 * A generated document has no navigation to wait on, and a statement drawn over
 * a session's first presentation would hide content the first frame is required
 * to show and blank content across the takeover — which FR-008 and FR-009
 * forbid, the second naming the only three exceptions there are (018/FR-008).
 */
test.describe('the waiting statement and a generated document', () => {
  for (const { path } of SCREENS) {
    test(`is absent from the document ${path} answers with (018/FR-008)`, async ({ page }) => {
      const served = await (await page.request.get(`${PRODUCT_URL}${path}`)).text();

      expect(served, `${path} carried the waiting overlay`).not.toContain('ednb-waiting-overlay');
      expect(served, `${path} carried the waiting sentence`).not.toContain(
        englishMessages['navigation.waiting.notice'],
      );
    });

    test(`draws nothing over the first presentation of ${path} (018/FR-008)`, async ({ page }) => {
      // Watched from before the document exists to after the takeover, rather
      // than read once at the end: what is claimed is that the statement was
      // never up, not that it is down now.
      const watch = await watchForTheStatementFromStart(page);

      await page.goto(path);
      await waitForTakeover(page);

      expect(await watch.wasDrawn(), `${path} was covered by the waiting statement`).toBe(false);
    });
  }

  test.describe('the watch itself', () => {
    // No worker in this context. The application registers one immediately and
    // it claims the page it is on, and a worker answers a chunk from its cache
    // without a request being made — a request that is never made is one no
    // route can hold. The sibling journey below buys the same thing by building
    // its own context; this one needs a first navigation to succeed before the
    // navigation it holds, so it asks for the worker to be kept out instead.
    test.use({ serviceWorkers: 'block' });

    test('is watched from before the generated document, so a reading of none is a reading (018/FR-008)', async ({
      page,
    }) => {
      // Every reading above is that nothing was drawn, and a watch that never
      // attached answers exactly that. This is the lane where it could: the
      // watcher is installed before the document is parsed, and here the
      // document it is waiting for is one the build generated rather than one a
      // development server composed. So the same watch, installed the same way,
      // is asked about a statement that has to be there.
      const watch = await watchForTheStatementFromStart(page);

      await page.goto('/');
      await waitForTakeover(page);

      // Not the first presentation — a navigation the Commander asks for, with
      // its screen's code held, which is the one case that draws the statement.
      const held = await holdEveryChunk(page);
      await page.getByRole('main').getByRole('link').first().click({ noWaitAfter: true });

      await expect(waitingStatement(page)).toBeVisible({ timeout: 15_000 });
      expect(
        await watch.timesDrawn(),
        'the watch read nothing where the statement was standing',
      ).toBeGreaterThan(0);

      held.release();
    });
  });

  test('states a first navigation that failed, over the document it was served (018/FR-007, FR-008)', async ({
    browser,
    page,
  }) => {
    // The lane that has a document. `navigation-waiting.spec.ts` reads the same
    // failure on a development server, where what the Commander is left on is
    // the application's own shell; here the address answers with a written
    // document first, and the promise is that the failure is stated over it and
    // the document stays readable.
    //
    // It is also the only reading of the arrangement the built application
    // actually runs: there the first navigation blocks bootstrap, so the events
    // it raises come before any component exists. Nothing in the development
    // lane can see that.
    //
    // The screen's own code is refused and the application's is not. They are
    // told apart by asking for the screen once and remembering what that
    // fetched, because both are chunks and only the address distinguishes them.
    const screenChunks = new Set<string>();
    await page.goto('/');
    await waitForTakeover(page);
    page.on('request', (request) => {
      if (request.resourceType() === 'script') {
        screenChunks.add(request.url());
      }
    });
    await reachTheCatalogue(page);
    await expect(page.getByRole('main')).toBeVisible();

    // A context of its own, not a second page in this one. The worker
    // registered by the pass above answers a request from its cache without
    // ever reaching the network, and a request that is never made is one no
    // route can refuse. A context with no worker in it makes the fetch a real
    // one. `browser.newContext` inherits none of the project's options, so the
    // address is given again here.
    const context = await browser.newContext({ baseURL: PRODUCT_URL });
    const fresh = await context.newPage();
    await fresh.route('**/*', async (route) => {
      if (screenChunks.has(route.request().url())) {
        await route.abort('failed').catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });

    // Watched from before the document exists, rather than read once at the
    // end. A reading taken after the failure is stated cannot tell a statement
    // that was never drawn from one that was drawn and removed, and "never
    // drawn over the first presentation" is the whole of what FR-008 asks.
    const watch = await watchForTheStatementFromStart(fresh);

    await fresh.goto('/ships');

    // Stated, and stated in words that stay on the page.
    await expect(
      fresh.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible({ timeout: 30_000 });
    await expect(fresh.locator('ednb-waiting-overlay dialog[open]')).toHaveCount(0);
    expect(
      await watch.wasDrawn(),
      'the first presentation was covered by the waiting statement',
    ).toBe(false);

    // No statement was drawn over the first presentation, and the shell the
    // Commander is left on is one they can use (018/FR-008).
    await expect(fresh.getByRole('banner')).toBeVisible();
    await expect(fresh.getByRole('link', { name: 'Ship Builder' })).toBeVisible();

    // FR-007's other half, and the whole of what 023/FR-001 adds: the Commander
    // is left on the readable document that address served. `main` is read
    // rather than the page, because the banner and the tool links are the
    // shell's and stand whether or not anything was held — a reading over the
    // whole page would pass on a shell with an empty `main` under it.
    const held = (await fresh.getByRole('main').innerText()).toLowerCase();

    expect(held, 'the ship list the document served is gone from main').toContain('anaconda');
    await context.close();
  });
});

/**
 * A Commander opening `path` in a context of its own, whose screen never
 * arrives.
 *
 * The arrangement the journey above works out, in one place because ten
 * readings need it. The screen's own chunks are told from the application's by
 * asking for that screen once and remembering what it fetched — both are
 * chunks and only the address distinguishes them — and the reading itself is
 * taken in a context of its own, which starts with no worker registered in it —
 * a request a worker answers from its cache is one no route can refuse. Fresh
 * rather than blocked: a new context carries no registration, and the screen is
 * asked for once, before anything in this session could have put it in a
 * cache.
 *
 * `reach` is how the first page asks for the screen. A press rather than a
 * second `goto`: a fresh load would refetch the application's own chunks too,
 * and refusing those refuses the application rather than the screen.
 *
 * Returns the context as well as the page, because the caller has to close it.
 */
async function whereTheScreenNeverArrives(
  browser: Browser,
  page: Page,
  options: {
    readonly path: string;
    readonly reach: (page: Page) => Promise<void>;
    /** The address the learning pass opens. The entry point unless given. */
    readonly open?: string;
    readonly context?: Parameters<Browser['newContext']>[0];
    readonly prepare?: (page: Page) => Promise<void>;
    /**
     * Whether to hold the application's own code until the document has
     * settled — parsed, and wearing the faces it asked for.
     *
     * For a reading that measures frames. Without it the takeover can be over
     * before the recorder has a frame of the document on its own, and there is
     * then nothing to measure the restore against. The moment the code is let
     * go is marked as well, so such a reading knows which frame the document
     * had last (`markTheDocumentsLastFrame`).
     */
    readonly settled?: boolean;
  },
): Promise<{ context: BrowserContext; fresh: Page }> {
  const { path, reach, prepare } = options;
  const screenChunks = new Set<string>();
  // Opened somewhere other than the address under test where that address is
  // the entry point: the chunks are learnt from the presses after this one, and
  // a screen already fetched to draw this page is not asked for again.
  await page.goto(options.open ?? '/');
  await waitForTakeover(page);
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      screenChunks.add(request.url());
    }
  });
  await reach(page);
  await expect(page.getByRole('main')).toBeVisible();

  // `browser.newContext` inherits none of the project's options, and the
  // profile is what several of these readings are about — so the viewport is
  // carried over by hand, and a reading that wants another one gives its own.
  const context = await browser.newContext({
    baseURL: PRODUCT_URL,
    viewport: page.viewportSize() ?? undefined,
    ...(options.context ?? {}),
  });
  const fresh = await context.newPage();
  let marked: Promise<void> | null = null;
  await fresh.route('**/*', async (route) => {
    const url = route.request().url();
    if (screenChunks.has(url)) {
      await route.abort('failed').catch(() => {});
      return;
    }
    if ((options.settled ?? false) && /\.js(\?.*)?$/.test(url)) {
      await theTypefaceHasArrived(fresh);
      // The frame the document has had last, marked on the way past: this is
      // the moment the application is let go, and a reading that measures the
      // takeover measures from here (`markTheDocumentsLastFrame`). Marked once,
      // and awaited by every piece of code held at this point rather than by
      // the one that does the marking: a document asks for several, they clear
      // the wait above on the same tick, and one released while the mark was
      // still being set puts the boundary a frame late — which is the timing
      // this mark exists to take the window out of.
      marked ??= markTheDocumentsLastFrame(fresh);
      await marked;
    }
    await route.continue().catch(() => {});
  });
  await prepare?.(fresh);
  await fresh.goto(path);

  // The statement standing is what says the navigation is over and the
  // application is running. Waited for by its box rather than by its words,
  // because which words it carries is what one of the readings below is about.
  await expect(fresh.locator('.frame__status')).toBeVisible({ timeout: 30_000 });
  return { context, fresh };
}

/** The press that asks for the hull catalogue, from the entry point. */
async function reachTheCatalogue(page: Page): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('link', { name: /Ship Builder/ })
    .click();
  // Waited on generously: the address changes when the navigation resolves, and
  // what it is waiting for is the screen's chunk over a server several of these
  // readings are asking for a build from at once.
  await expect(page).toHaveURL(/\/ships$/, { timeout: 30_000 });
}

/** The press that asks for the entry point, from anywhere the flag is drawn. */
async function reachTheEntryPoint(page: Page): Promise<void> {
  await page.locator('.frame__flag-home').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

/**
 * Held content, read by a Commander whose committed locale is German.
 *
 * The document is bundled English and the application around it is German, so
 * this is the one composition where the two stand together. 015/FR-011 has the
 * committed locale replace a document's words once the catalogue arrives, and
 * this change bounds it: the replacement is applied by rendering the screen in
 * the catalogue, and the screen's code is exactly what did not arrive. There is
 * nothing that can apply it and nothing the application may write in its place
 * (015/FR-011, 015/FR-011a, constitution VI).
 *
 * Only this lane has a document to be left on, so both readings are here.
 */
test.describe('held content and a Commander reading in German', () => {
  const leftOnTheDocument = (browser: Browser, page: Page) =>
    whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
      context: { locale: 'de-DE' },
    });

  test('keeps the content in the English it was served in, with the statement in German', async ({
    browser,
    page,
  }) => {
    const { context, fresh } = await leftOnTheDocument(browser, page);

    // The sentence beside the content, first, because it is what the readings
    // under it stand on. It is the shell's own, so it is in the committed
    // locale like everything else the application says — and its being German
    // is the proof the catalogue has arrived. A page has only a few hundred
    // milliseconds of being English, and English content read inside that
    // window is evidence of nothing.
    await expect(
      fresh.locator('.frame__status').getByText(germanMessages['navigation.failed.notice']),
    ).toBeVisible();

    // Then the document's own words, untouched: the catalogue is here and the
    // content is still English, because nothing rendered the screen that would
    // have carried the German.
    //
    // Read case-insensitively: the catalogue typesets several of its own labels
    // in capitals, and what is claimed here is which language the words are in
    // rather than how the design system sets them.
    const main = (await fresh.getByRole('main').innerText()).toLowerCase();

    expect(main, 'the served English is gone from the held content').toContain(
      englishMessages['catalogue.search.label'].toLowerCase(),
    );
    expect(main, 'the held content was rewritten in German').not.toContain(
      germanMessages['catalogue.search.label'].toLowerCase(),
    );

    // And nothing was added to it either. A game name shown in its original
    // language is disclosed as such beside itself where a replacement lands;
    // here none landed, each name stands in the language of the document around
    // it, and that document says which language that is (015/FR-011a).
    expect(await disclosures(fresh), 'a disclosure was written into held content').toBe(0);
    await context.close();
  });

  test("states the language the held content is in, which is not the page's", async ({
    browser,
    page,
  }) => {
    const { context, fresh } = await leftOnTheDocument(browser, page);

    // English standing inside a German page is a part in another language, and
    // 3.1.2 is in scope: the target is WCAG 2.2 AA except eight criteria and
    // 3.1.2 is not among them. The container carries it, because the page
    // cannot — the page is German (011/FR-015, 011/FR-017).
    //
    // The page's own language is waited for rather than read once. The root
    // says English until the catalogue lands, and the application does not hold
    // the first frame for it (`src/app/i18n/i18n.providers.ts`) — so a single
    // read here is a race, and what it would report is the moment rather than
    // the language.
    await expect(fresh.locator('html')).toHaveAttribute('lang', /^de/);

    const presented = await fresh.locator('html').getAttribute('lang');
    const heldIn = await fresh.locator('.frame__held').getAttribute('lang');

    expect(heldIn, 'the held content did not say which language it is in').toBe('en');
    expect(heldIn, 'the held content claimed the language the page presents in').not.toBe(
      presented,
    );
    await context.close();
  });
});

/**
 * Asserts that every frame holds what the first one held, where it held it.
 *
 * Three of the four boxes compared as they stand: the bar, the landmark and the
 * content inside it. A statement that took space above the content moves the
 * landmark and what stands in it, which is the reading this exists for. The bar
 * is held to the same rule because a composition corrected after the fact moves
 * it too (`MEASURED`).
 *
 * The restore adds the copy and the framework's cleanup removes the served
 * nodes it was taken from, and the two overlap until the cleanup runs — the
 * landmark holding both is twice the box either would give it. No frame lands
 * there, because the cleanup is scheduled as soon as the application reports
 * itself stable, which is the same task as the render that added the copy. A
 * cleanup deferred by a task would show up here as a landmark that grew and
 * then shrank, and that is the defect rather than the reading's fault.
 *
 * The page's own box is compared differently, and only this one is. The
 * statement takes its box after the content rather than before it, so the
 * document ends lower than it did — the page is taller, and nothing in it
 * moved. What is asserted of it is what that leaves: the page begins where it
 * began, it is the width it was, and it never gets shorter (015/FR-009,
 * `openspec/changes/archive/023-served-document-held/design.md`, "The failure
 * statement does not take space above the content").
 */
function nothingTheCommanderIsReadingMoved(window: readonly Frame[]): void {
  const first = window[0];
  const page = MEASURED.indexOf('body');
  for (const [index, frame] of window.entries()) {
    const moved = frame.boxes
      .map((box, at) => ({ box, at }))
      .filter(
        ({ box, at }) => at !== page && JSON.stringify(box) !== JSON.stringify(first.boxes[at]),
      )
      .map(
        ({ box, at }) =>
          `${MEASURED[at]}: ${JSON.stringify(first.boxes[at])} → ${JSON.stringify(box)}`,
      );

    expect(moved, `the held document moved at frame ${index} of ${window.length}`).toEqual([]);

    const [x, y, width, height] = frame.boxes[page] ?? [0, 0, 0, 0];
    const [wasX, wasY, wasWidth, wasHeight] = first.boxes[page] ?? [0, 0, 0, 0];

    expect([x, y, width], `the page moved at frame ${index}`).toEqual([wasX, wasY, wasWidth]);
    expect(height, `the page got shorter at frame ${index}`).toBeGreaterThanOrEqual(wasHeight);
  }
}

/** Where two boxes meeting stops being two boxes meeting: one whole pixel. */
const A_SHARED_EDGE = 1;

/**
 * Asserts the failure statement can be read where it stands, and stands over
 * nothing the Commander was given.
 *
 * Read at the end of the scroll range, which is where both questions are
 * decided: the page is as long as the content and the statement together, so
 * this is where the statement stands, and a statement standing over the content
 * holds the last of it down there for good — there is no further scrolling that
 * could move it off.
 *
 * Read as boxes and as the document's own answer to "what is at this point",
 * because nothing else can fail on it. Playwright's visibility is geometry and a
 * style, and `innerText` reports text that is covered as readily as text that is
 * not — so a statement painted behind the page, and content standing under a
 * statement, both pass those (011/FR-011, 018/FR-007, constitution V).
 */
async function nothingStandsOverAnythingElse(page: Page, at: string): Promise<void> {
  const [covering, held, stated] = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const notice = document.querySelector('.frame__status');
    const last = document.querySelector('.frame__held')?.lastElementChild ?? null;
    if (!notice) {
      return [-1, null, null] as const;
    }

    const box = notice.getBoundingClientRect();
    const across = [0.2, 0.5, 0.8].map((part) => box.x + box.width * part);
    const down = [0.25, 0.5, 0.75].map((part) => box.y + box.height * part);
    const blocked = across
      .flatMap((x) => down.map((y) => document.elementFromPoint(x, y)))
      .filter((found) => found === null || !found.closest('.frame__status')).length;
    const rect = (node: Element | null) =>
      node
        ? ([node.getBoundingClientRect().top, node.getBoundingClientRect().bottom] as const)
        : null;
    return [blocked, rect(last), rect(notice)] as const;
  });

  expect(stated, `the failure was never stated at ${at}`).not.toBeNull();
  expect(held, `nothing was held to read at ${at}`).not.toBeNull();
  expect(covering, `the statement cannot be read where it stands at ${at}`).toBe(0);

  // How deep the statement stands over the content, rather than whether the two
  // boxes meet. They do meet, and by construction: the content ends where the
  // statement begins, both edges at 538.046875 on Chromium at a doubled text
  // size. An engine laying the same pair out in its own fractions of a pixel
  // puts its shared edge either side of itself, and that is the edge rather
  // than a statement over anything — what 015/FR-009 is about is a sentence
  // standing over words a Commander is reading, which is lines of text.
  const over = Math.min(held![1], stated![1]) - Math.max(held![0], stated![0]);

  expect(over, `the statement stands over ${over}px of the held content at ${at}`).toBeLessThan(
    A_SHARED_EDGE,
  );
}

/**
 * The boundaries of the hold, read where it actually happens.
 *
 * What is held, what is not, and that what goes back is what was served rather
 * than a second rendering of it. Only this lane has a generated document to be
 * left on (023/FR-001).
 */
test.describe('what a takeover that presents no screen leaves standing', () => {
  test('is what the address served, node for node (023/FR-001, 015/FR-004)', async ({
    browser,
    page,
  }) => {
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
    });

    // The served document as the browser reads it, against the content
    // standing. Both are parsed by the same browser so the comparison is of
    // documents rather than of two spellings of the same markup — and what it
    // catches is a rewrite into a re-rendering: every figure here comes from
    // the pinned package and none of them is computed again on the way back.
    const served = await (await fresh.request.get(`${PRODUCT_URL}/ships`)).text();
    const [wasServed, isStanding] = await fresh.evaluate((html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return [
        parsed.querySelector('main')?.innerHTML ?? '',
        document.querySelector('.frame__held')?.innerHTML ?? '',
      ];
    }, served);

    expect(wasServed.length, 'the address served no content to compare against').toBeGreaterThan(0);
    expect(isStanding, 'what is standing is not what the address served').toBe(wasServed);
    await context.close();
  });

  test('is the shell at an address the build generates no document for (018/FR-007)', async ({
    browser,
    page,
  }) => {
    // One of the two bench addresses 015/FR-018 names, which is where a
    // production build serves documents at other addresses and a shell at this
    // one — so a reading here can fail. The development lane generates no
    // document anywhere, so its reading of the same failure passes however the
    // adapter behaves and stays where it is, in `navigation-waiting.spec.ts`.
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/equipment',
      reach: async (page) => {
        await page.getByRole('link', { name: 'Equipment Builder' }).first().click();
        await expect(page).toHaveURL(/\/equipment$/, { timeout: 30_000 });
      },
    });

    // The shell, which is what that address served. Nothing is put back over
    // it, because nothing was served to put back — one rule, not two.
    await expect(fresh.getByRole('banner')).toBeVisible();
    await expect(
      fresh.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible();
    await expect(fresh.locator('.frame__held')).toHaveCount(0);
    await context.close();
  });

  test('moves nothing the Commander can see, and never empties (015/FR-009)', async ({
    browser,
    page,
  }) => {
    // The restore measured, not only the takeover that succeeds. This change is
    // what puts the held content and the failure statement in the same frame
    // for the first time, so this is the reading a statement taking space above
    // the content fails: the boxes are compared from the last frame the
    // document had to itself, through every frame after it.
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
      prepare: (fresh) => recordFrames(fresh, 'Anaconda'),
      settled: true,
    });

    // Every frame from the one the document had to itself last, through every
    // frame after it. The marker is the journey's own, set where it lets the
    // application go: `takenOver` cannot be it, because it reads the presses
    // the document holds for replay and the held copy carries the served
    // document's own — as it must, being what the address served rather than a
    // rewriting of it — and the page's verdict on its typeface cannot be it
    // either (`markTheDocumentsLastFrame`). What that verdict was there for is
    // done before the mark is set: this journey holds the application's code
    // back until the document is wearing the faces it asked for, so the
    // settling those frames would show has already happened.
    //
    // Still cut to the frames the document had finished arriving in. A page
    // still being read is shorter than the page being served, and that is the
    // download rather than the takeover.
    const held = (await framesSinceTheDocumentWasAlone(fresh)).filter((frame) => frame.parsed);

    expect(held.length, '/ships was never recorded settled').toBeGreaterThan(1);
    expect(
      held.at(-1)?.length ?? 0,
      'the statement never arrived while frames were being recorded',
    ).toBeGreaterThan(held[0].length);
    nothingTheCommanderIsReadingMoved(held);

    // And no frame emptier than the frame before it. A restore that removed the
    // served nodes and put the copy back a pass later reads here as a dip, and
    // one that never put them back reads as the subject leaving the page.
    const lost = held.findIndex((frame) => !frame.subject);

    expect(lost, `/ships left the screen at frame ${lost} of the restore`).toBe(-1);
    let tallest = 0;
    held.forEach((frame, index) => {
      expect(frame.length, `/ships shrank at frame ${index} of the restore`).toBeGreaterThanOrEqual(
        tallest,
      );
      tallest = Math.max(tallest, frame.length);
    });
    await context.close();
  });

  test('moves nothing at the entry point, where the screen fills the shell (015/FR-009)', async ({
    browser,
    page,
  }) => {
    // The same measurement as above, at the one address whose screen is shorter
    // than the window it is drawn in. The shell is at least as tall as the
    // window, so a screen that does not fill it is stretched to the rest — and
    // the start page closes with its attribution band at the foot of that
    // stretch. The catalogue overflows every profile, so `main` is its content
    // there and takes nothing from anything: the reading above cannot fail on a
    // statement that takes space out of the box the content stands in, and this
    // one can. With the copy standing in a box measured from its own content,
    // the band stands 102 pixels above where it was served, on a page that
    // never scrolls.
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      open: '/ships',
      path: '/',
      reach: reachTheEntryPoint,
      prepare: (fresh) => recordFrames(fresh, 'Ship Builder'),
      settled: true,
    });

    // The same window as the reading above, marked the same way.
    const held = (await framesSinceTheDocumentWasAlone(fresh)).filter((frame) => frame.parsed);

    expect(held.length, '/ was never recorded settled').toBeGreaterThan(1);
    nothingTheCommanderIsReadingMoved(held);
    await context.close();
  });

  test('states the failure where it can be read, over nothing the Commander is reading', async ({
    browser,
    page,
  }) => {
    // Two readings a scan cannot make, at the address that makes both hardest:
    // the entry point's screen fills the window, so the statement and the
    // content it stands beside want the same pixels.
    //
    // Neither `toBeVisible` nor `innerText` can fail on what this is about.
    // Playwright reads a box and a style, and `innerText` reports text that is
    // covered as readily as text that is not — so a statement painted behind
    // the page and content standing under a statement both pass them. What
    // fails here is the document's own answer to "what is at this point", and
    // the boxes at the end of the page.
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      open: '/ships',
      path: '/',
      reach: reachTheEntryPoint,
    });

    await nothingStandsOverAnythingElse(fresh, 'the entry point');
    await context.close();
  });

  test('reports no accessibility violation, content and statement together', async ({
    browser,
    page,
  }, testInfo) => {
    // The composition the application draws and no catalogue cell can: the
    // frame holding content in its `main` with the failure statement beside it.
    // The existing scans reach the generated first frame and the screens the
    // application presents, and this is neither (011/FR-022, 011/SC-002).
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
    });

    await expectNoAccessibilityViolations(fresh, testInfo, {
      label: 'the held document and the statement beside it',
    });
    await context.close();
  });

  test('is complete at a doubled text size, with no horizontal page scrolling', async ({
    browser,
    page,
  }) => {
    // 011/FR-011 asks it of every capability, and neither existing reading
    // reaches this composition: 015/FR-019 scans the generated first frame,
    // where no statement stands beside the content, and the responsive journeys
    // never reach it at all.
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
      prepare: (fresh) => withRootTextScale(fresh, DOUBLED_TEXT),
    });

    const main = (await fresh.getByRole('main').innerText()).toLowerCase();

    expect(main, 'the held content is gone at a doubled text size').toContain('anaconda');
    await expect(
      fresh.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible();
    await expectNoDocumentOverflow(fresh);

    // Completeness as boxes as well as as text, and at this size rather than
    // only at the default one: a statement is a larger share of the window the
    // larger the words in it are, so this condition is where content standing
    // under one is worst.
    await nothingStandsOverAnythingElse(fresh, 'a doubled text size');
    await context.close();
  });

  test('is complete at 400% zoom, with no horizontal page scrolling', async ({ browser, page }) => {
    const { context, fresh } = await whereTheScreenNeverArrives(browser, page, {
      path: '/ships',
      reach: reachTheCatalogue,
      context: ZOOM_400,
    });

    const main = (await fresh.getByRole('main').innerText()).toLowerCase();

    expect(main, 'the held content is gone at 400% zoom').toContain('anaconda');
    await expect(
      fresh.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible();
    await expectNoDocumentOverflow(fresh);

    // And the same reading at the condition that makes it hardest. The window
    // is 320x256 here, where a statement is close to half of what a Commander
    // can see at once — so content standing under one loses most of the page
    // (constitution V).
    await nothingStandsOverAnythingElse(fresh, '400% zoom');
    await context.close();
  });
});

/**
 * A failure after a screen has been presented, which this change must not
 * answer by taking that screen away.
 *
 * The reading passes against the standing takeover in either lane, because
 * nothing is held today. What this lane buys is that only here can a wrong
 * implementation have something to put back, so only here can it fail
 * (023/FR-001, 018/FR-007).
 */
test.describe('a failure after a screen has been presented', () => {
  // No worker in this context: it answers a chunk from its cache without a
  // request being made, and a request that is never made is one no route can
  // refuse.
  test.use({ serviceWorkers: 'block' });

  test('leaves the Commander on that screen, with nothing put back over it', async ({ page }) => {
    await page.goto('/');
    await waitForTakeover(page);
    await expect(page.getByRole('main')).toContainText('Tools for Commanders');

    // Every chunk from here on, which at this point is every screen the
    // Commander has not opened yet.
    await page.route('**/*.js', async (route) => {
      await route.abort('failed').catch(() => {});
    });
    await page
      .getByRole('main')
      .getByRole('link', { name: /Ship Builder/ })
      .click({ noWaitAfter: true });

    await expect(
      page.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible({ timeout: 30_000 });

    // The entry point is still the screen they are on, and the document this
    // session was served — the entry point's own — was released when that
    // screen was presented, so there is nothing left that could land over it.
    await expect(page.getByRole('main')).toContainText('Tools for Commanders');
    await expect(page.locator('.frame__held')).toHaveCount(0);
  });
});

/**
 * The other document the production output serves: the one with no rendered
 * body, which every journey reaches `waitForTakeover` on.
 *
 * What the takeover means there, and why the wait asks a second question about
 * it, is in `shell.ts`. What is claimed here is the journey's half: when that
 * wait is over, the screen is drawn.
 */
test.describe('a document with no rendered body', () => {
  test('is not taken over until the application has drawn the screen', async ({ page }) => {
    // The host's fallback rather than the worker's, because a request the
    // worker answers never reaches the network and cannot be held.
    await openBeforeTheBundleArrives(page, '/ships/NotAShip');

    await waitForTakeover(page);

    // Read once, with no wait of its own. What the wait above covers is the
    // whole of what is measured here.
    expect(
      await page.getByRole('heading', { name: 'No such hull' }).count(),
      'the application had drawn the screen when the takeover wait was over',
    ).toBe(1);
  });
});

/**
 * The typefaces a document is drawn in, from the frame it first paints.
 *
 * A document that paints in a system face and re-paints in Barlow changes shape
 * in front of the Commander, and the two families do not measure the same, so it
 * changes height as well. Two things keep the faces in front of that paint, and
 * both live in the emitted files rather than in a screen: the stylesheet that
 * declares them is applied before the document paints, and the faces the
 * document draws with are asked for beside the document (019/FR-001).
 *
 * `check-interface-foundations.mjs` holds the same two facts over the whole
 * output. This reads them from a served address, which is the side a Commander
 * is on, and it reads the faces back out of the stylesheet the document itself
 * links rather than from a list written down here.
 */
test.describe('the faces a generated document is drawn in', () => {
  /**
   * One attribute of a tag, or null where the tag does not carry it.
   *
   * The name is anchored on whitespace, not a word boundary: a word boundary
   * also falls after the dot in `onload="this.media='all'"`, so a tag deferring
   * itself that way would have the deferral read as its own `media`.
   */
  function attribute(tag: string, name: string): string | null {
    return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2] ?? null;
  }

  /**
   * Every `<link>` a document carries with the given relationship.
   *
   * Read as whole tags and sorted by each tag's own `rel`, not matched by a
   * pattern per relationship. The deferral this journey exists to catch spells
   * the word it would look for inside `onload="this.rel='stylesheet'"`, so a
   * pattern would read a preloaded sheet as an applied one and pass the
   * document it is meant to fail.
   */
  function links(document: string, rel: string): readonly string[] {
    return (document.match(/<link\b[^>]*>/gi) ?? []).filter(
      (tag) => attribute(tag, 'rel')?.trim().toLowerCase() === rel,
    );
  }

  /** A face file's family and weight, as the stylesheet that declares it states them. */
  function faceOf(styles: string, source: string): readonly string[] {
    const rule = (styles.match(/@font-face\s*\{[^}]*\}/g) ?? []).find((block) =>
      block.includes(source),
    );
    const bare = (value: string) => value.trim().replace(/^["']|["']$/g, '');
    const family = rule === undefined ? null : /font-family\s*:\s*([^;}]+)/.exec(rule);
    const weight = rule === undefined ? null : /font-weight\s*:\s*([^;}]+)/.exec(rule);
    return family === null || weight === null ? [] : [`${bare(family[1])} ${bare(weight[1])}`];
  }

  test('asks for them beside the document, ahead of the stylesheet that declares them', async ({
    page,
  }) => {
    for (const { path } of SCREENS) {
      const document = await (await page.request.get(`${PRODUCT_URL}${path}`)).text();

      // Applied, not deferred. `all` and `screen` are the two values that leave
      // a stylesheet applied to the screen a Commander reads; behind anything
      // else — `print`, and a width query as much as a type — it lands after
      // the paint on some viewport or all of them, and the faces it declares
      // land with it.
      for (const sheet of links(document, 'stylesheet')) {
        const media = attribute(sheet, 'media');
        expect(
          media === null || /^(all|screen)$/i.test(media.trim()),
          `${path} defers a stylesheet`,
        ).toBe(true);
      }

      // Every family that stylesheet declares, read from the sheet the document
      // links rather than from a list kept here, which would go stale the first
      // time a face is added.
      const sheet = links(document, 'stylesheet')
        .map((link) => attribute(link, 'href'))
        .find((href): href is string => href !== null);
      expect(sheet, `${path} links no stylesheet`).toBeDefined();
      const styles = await (await page.request.get(`${PRODUCT_URL}/${sheet}`)).text();
      const declared = new Map(
        (styles.match(/@font-face\s*\{[^}]*\}/g) ?? []).flatMap((rule) => {
          const source = /url\(([^)]+)\)/.exec(rule);
          const family = /font-family\s*:\s*([^;}]+)/.exec(rule);
          const bare = (value: string) => value.trim().replace(/^["']|["']$/g, '');
          return source === null || family === null ? [] : [[bare(source[1]), bare(family[1])]];
        }),
      );
      expect(declared.size, `${path} applies a stylesheet declaring no face`).toBeGreaterThan(0);

      const asked = new Set<string>();
      for (const preload of links(document, 'preload')) {
        const href = attribute(preload, 'href');
        if (attribute(preload, 'as') !== 'font' || href === null) {
          continue;
        }
        // Relative, so a deployment under a sub-path reaches its own fonts, and
        // in anonymous mode, which is the only way a face is fetched at all.
        expect(href.startsWith('/'), `${path} asks for ${href} past the deployment base`).toBe(
          false,
        );
        const mode = attribute(preload, 'crossorigin');
        expect(
          /(^|\s)crossorigin([\s=>/]|$)/i.test(preload) && /^(|anonymous)$/i.test(mode ?? ''),
          `${path} does not ask for ${href} in anonymous mode`,
        ).toBe(true);
        expect(
          (await page.request.get(`${PRODUCT_URL}/${href}`)).status(),
          `${path} asks for ${href}, which the deployment does not serve`,
        ).toBe(200);

        const family = declared.get(href);
        expect(
          family,
          `${path} asks for ${href}, which its stylesheet declares no face for`,
        ).toBeDefined();
        asked.add(family as string);
      }

      for (const family of new Set(declared.values())) {
        expect([...asked], `${path} draws with ${family} and asks for no face of it`).toContain(
          family,
        );
      }
    }
  });

  test('is drawn in no face it did not ask for', async ({ page }) => {
    // The other half of the same promise, and the half a list in the head
    // cannot be trusted for: what the document is actually drawn in. The bundle
    // never arrives, so every face the browser loads is one the served markup
    // asked the browser to draw, and each one has to be a face the document
    // asked for beside itself.
    //
    // Compared by family and weight rather than by file. The two subsets of one
    // face differ only in the characters they carry, and which of them a hull's
    // name needs is a property of the name; what this holds is that the weight
    // the document draws was asked for early.
    for (const { path } of SCREENS) {
      await openWithoutTheBundle(page, path);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      // The family is unquoted on both sides before they are compared. The
      // stylesheet writes `"Barlow Condensed"` and a browser is free to report
      // the descriptor back as it was written, so a multi-word family would
      // otherwise match on one engine and not on the other.
      const drawn = await page.evaluate(() =>
        [...document.fonts]
          .filter((face) => face.status === 'loaded')
          .map((face) => `${face.family.trim().replace(/^["']|["']$/g, '')} ${face.weight}`),
      );
      expect(drawn.length, `${path} is drawn in no declared face at all`).toBeGreaterThan(0);

      const document_ = await (await page.request.get(`${PRODUCT_URL}${path}`)).text();
      const sheet = links(document_, 'stylesheet')
        .map((link) => attribute(link, 'href'))
        .find((href): href is string => href !== null);
      expect(sheet, `${path} links no stylesheet`).toBeDefined();
      const styles = await (await page.request.get(`${PRODUCT_URL}/${sheet}`)).text();
      const asked = new Set(
        links(document_, 'preload')
          .map((link) => attribute(link, 'href'))
          .flatMap((href) => (href === null ? [] : faceOf(styles, href))),
      );

      for (const face of new Set(drawn)) {
        expect([...asked], `${path} is drawn in ${face}, which it does not ask for`).toContain(
          face,
        );
      }
    }
  });
});
