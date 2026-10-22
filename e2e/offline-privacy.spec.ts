import { expect, test, type Page } from '@playwright/test';
import { frameTexts, recordFirstFrameText } from './first-frame';
import {
  applyDraft,
  benchFollowedSelection,
  chooseRecipe,
  openEditor,
  revealMount,
  revealStatusRail,
} from './outfitting-surfaces';
import {
  buildStockHull,
  openFirstHullFromManifest,
  openLibrary,
  reachShellAction,
  waitForTakeover,
} from './shell';

/**
 * Offline capability and the privacy promise (US1, US2, US3).
 *
 * Runs only against a production build, because a service worker only exists
 * there. Two things are under test and they are related: what this application
 * can still do with no network, and what it never sends when it has one.
 *
 * The rule the illustration journeys are about is that artwork is decoration
 * with a text equivalent. A hull whose picture cannot be fetched can still be
 * read, compared and built from — anything else would make a Commander's
 * connection a condition of using the shipyard (FR-006).
 */

/** Waits until a service worker is actually controlling the page. */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
    timeout: 30_000,
  });
}

/** Loads a page twice, so the worker serves rather than merely installs. */
async function withWorker(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('main')).toBeVisible();
  await waitForController(page);
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
}

/** Whether the hull illustration is currently painted. */
async function illustrationLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('.artwork__image');
    return image !== null && image.complete && image.naturalWidth > 0;
  });
}

test.describe('offline capability', () => {
  test('reads the shell and bundled English with no network at all', async ({ page, context }) => {
    await withWorker(page, '/ships');

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Ship Builder' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // The catalogue is installed with the package rather than fetched, so every
    // hull is still there.
    //
    // Counted after the takeover rather than during it. Since feature 015 the
    // reload is answered by a document that already draws the catalogue, and
    // the application then adopts those nodes; a takeover that rebuilt them
    // instead of adopting them would hold two catalogues at once. A retrying
    // count would sit through that and report the number it was waiting for, so
    // the wait is stated here and the count is taken once the page is the
    // application's.
    await waitForTakeover(page);
    await expect(page.locator('[data-hull-symbol]:visible')).toHaveCount(49);
    // Both compositions, and one of each: the view draws a table and a card
    // list into every document and hides one (`responsive-catalogue-view.html`).
    // Twice this is a catalogue rendered on top of a catalogue.
    await expect(page.locator('[data-hull-symbol]')).toHaveCount(96);

    await context.setOffline(false);
  });

  test('serves a returning Commander the hull they asked for, not the start page', async ({
    page,
  }) => {
    // 015/FR-014. The worker used to answer every navigation from its cache and
    // its cache held one shell, which was harmless while the shell stated
    // nothing. It is not harmless now: `index.html` is the start page's own
    // document, so a cache-first worker would have painted "Tools for
    // Commanders" under a hull's address for every Commander who had been here
    // before — the returning Commander getting a worse first frame than the
    // stranger, which is the failure `freshness` exists to prevent.
    await recordFirstFrameText(page);
    await withWorker(page, '/ships/Anaconda');

    // A third visit, so this one is answered by a worker that is installed,
    // controlling and warm.
    await page.goto('/ships/Anaconda');
    await expect(page.getByRole('main')).toBeVisible();
    await waitForTakeover(page);

    // Lower-cased by the recorder: `innerText` reports what the screen shows,
    // and half of what this application shows is set in capitals.
    const painted = await frameTexts(page);

    expect(painted.length, 'frames recorded').toBeGreaterThan(0);
    expect(painted[0], 'the hull in the first painted frame').toContain('anaconda');
    for (const [index, text] of painted.entries()) {
      expect(text, `frame ${index} carried the start page`).not.toContain('tools for commanders');
    }
  });

  test('keeps an illustration that has been seen once', async ({ page, context }) => {
    await withWorker(page, '/ships/Anaconda');
    // Ten seconds in both environments for the two illustration waits: each is
    // a fetch, from the network first and then from the worker's cache.
    await expect.poll(() => illustrationLoaded(page), { timeout: 10_000 }).toBe(true);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { level: 2, name: 'Anaconda' })).toBeVisible();
    await expect.poll(() => illustrationLoaded(page), { timeout: 10_000 }).toBe(true);

    await context.setOffline(false);
  });

  test('reads the offence analysis with no network at all', async ({ page, context }) => {
    await withWorker(page, '/ships/Anaconda');
    await buildStockHull(page, 'Build');

    await context.setOffline(true);

    // The whole capability is a synchronous read of an in-memory loadout and an
    // installed package, so opening the mode, moving the target range and
    // changing the WEP allocation all work with the network gone.
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Offence' })
      .click();
    await expect(page.locator('ednb-offence-analysis .offence')).toBeVisible();

    const shots = page.locator('ednb-offence-analysis .shots__entry');
    const before = await shots.allInnerTexts();
    await page.locator('ednb-offence-analysis input[type="range"]').fill('2000');
    await expect.poll(() => shots.allInnerTexts()).not.toEqual(before);

    await expect(page.locator('ednb-offence-analysis .bars--range .bar')).toHaveCount(4);
    const capacitor = page.locator('ednb-offence-analysis .bars--capacitor .bar');
    await expect(capacitor).toHaveCount(4);

    // The one condition this panel reads from another feature's store. Setting
    // it goes through the `POWER` mode's own control and comes back, so the
    // whole round trip is proven to need no network either.
    const recharge = capacitor.nth(1).locator('.bar__value');
    const chargedAt = await recharge.innerText();
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Power' })
      .click();
    await expect(page.locator('ednb-power-thermals')).toBeVisible();
    await page.locator('.distributor tbody tr').nth(2).locator('.pips__step').first().click();
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Offence' })
      .click();
    await expect(page.locator('ednb-offence-analysis .offence')).toBeVisible();
    await expect.poll(() => recharge.innerText()).not.toBe(chargedAt);

    await context.setOffline(false);
  });

  test('reads the cost and material blocks with no network at all', async ({ page, context }) => {
    await withWorker(page, '/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page.locator('ednb-cost-materials .cost__row')).toHaveCount(4);

    await context.setOffline(true);

    // Both blocks live in the status rail, which canvas 1d keeps behind its
    // `STATUS` segment rather than in the flow — so a compact run opens it, and
    // a wide one finds it already there. Opened with the network already gone,
    // like the modes the journey above opens, because at that width this is the
    // only way to the blocks and it is part of what has to still work.
    await revealStatusRail(page);

    // Both blocks are a synchronous read of an in-memory loadout and an
    // installed package, so they are not merely still painted with the network
    // gone — they still answer an edit. Engineering a mount is what proves it:
    // the materials block is absent for a build that crafts nothing, and it has
    // to be built from the package's consolidated result to appear at all
    // (feature 009, quickstart scenario 6).
    const credits = await page.locator('ednb-cost-materials .cost__value').allInnerTexts();
    await expect(page.locator('ednb-cost-materials .rail-material')).toHaveCount(0);

    // Its category first: at compact width a mount nobody has asked for is not
    // on the page at all (`revealMount`).
    await revealMount(page, 'FrameShiftDrive');
    const mount = page.locator('[data-slot-key="FrameShiftDrive"] button').first();
    await mount.click();
    await expect(mount).toHaveAttribute('aria-pressed', 'true');
    // The fitting has to be on screen before the editor is asked for: at the
    // compact profiles this suite also runs, the editor is behind an action
    // that only exists once a mount is marked, so asking immediately races it.
    await benchFollowedSelection(page);
    await openEditor(page);
    await chooseRecipe(page, /Increased Range/i);
    await applyDraft(page);

    // Material rows only: a Merc Coin row would sit among these and is
    // deliberately outside the footer's counts, so counting it here would
    // compare two different things and happen to agree only while this journey
    // buys no Mercenary article.
    const rows = page.locator('ednb-cost-materials .rail-material:not(.rail-material--merc-coin)');
    await expect(rows.first()).toBeVisible();

    // The footer counts the rows beside it, and it counted them here, offline.
    const footer = await page.locator('ednb-cost-materials .block__footer span').allInnerTexts();
    expect(footer).toHaveLength(2);
    expect(Number(footer[0]?.replaceAll(/\D/gu, ''))).toBe(await rows.count());

    // The credit figures are expected *not* to move: a blueprint is paid for in
    // materials, and a module's catalogue price is what it is whether or not it
    // has been engineered. Stated rather than left implicit, because a reader
    // who assumed otherwise would read the line above as a bug.
    expect(await page.locator('ednb-cost-materials .cost__value').allInnerTexts()).toEqual(credits);

    // The reading itself came from the installed package rather than from a
    // fetch: every row has a name and a count with the network gone.
    //
    // Deliberately not asserted here: that the rarity *pictures* paint. They are
    // `<img alt="">` decoration whose meaning is carried by the
    // `visually-hidden` label beside them, and `ngsw-config.json` precaches
    // `/assets/ships/**` but not `/assets/icons/**` — so offline they do not
    // load, and the row still reads. A `data-grade` assertion would say nothing
    // about it either way: that attribute is a host binding rendered from the
    // in-memory package result, present with or without a network.
    const names = await rows.locator('.game-text__value').allInnerTexts();
    const counts = await rows.locator('.rail-material__count').allInnerTexts();
    expect(names).toHaveLength(await rows.count());
    expect(counts).toHaveLength(await rows.count());
    for (const reading of [...names, ...counts]) {
      expect(reading.trim()).not.toBe('');
    }

    await context.setOffline(false);
  });

  test('reads Drives & Mass with no network at all', async ({ page, context }) => {
    await withWorker(page, '/ships/Anaconda');
    await buildStockHull(page, 'Build');

    await context.setOffline(true);

    // Every figure on both cards is a synchronous read of an in-memory loadout
    // and an installed package, so opening the mode draws the whole region with
    // the network gone — the headline mass, the three-part split, the position
    // on the curve, the five-reading envelope and the three ranges.
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Drives' })
      .click();
    await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();
    await expect(page.locator('ednb-drives-mass .drives__headline-mass')).toHaveText(/\d/u);
    await expect(page.locator('ednb-drives-mass .drives__curve-position')).toHaveText(/\d/u);
    // The thruster card's own legend, which is three rows whatever the build
    // carries. The drive card's legend beside it is not counted here: its total
    // range row is drawn only where the package states one, so a count over
    // both would turn this offline test red for a reason about the package.
    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-value'),
    ).toHaveCount(3);
    await expect(page.locator('ednb-drives-mass .drives__envelope-value')).toHaveCount(5);
    await expect(page.locator('ednb-drives-mass .drives__range')).toHaveCount(3);

    // The one condition these cards read from another feature's store. Setting
    // it goes through the `POWER` mode's own control and comes back, so the
    // whole round trip is proven to need no network either.
    const speed = page.locator('ednb-drives-mass .drives__envelope-value').first();
    const before = await speed.innerText();
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Power' })
      .click();
    await expect(page.locator('ednb-power-thermals')).toBeVisible();
    await page.locator('.distributor tbody tr').nth(1).locator('.pips__step').first().click();
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: 'Drives' })
      .click();
    await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();
    await expect.poll(() => speed.innerText()).not.toBe(before);

    await context.setOffline(false);
  });

  /*
   * Two more illustration journeys belong to this contract and live in
   * `hull-detail.spec.ts` instead: an illustration that cannot be fetched
   * blocking nothing, and recovering it on retry without a reload. Neither
   * needs a service worker, so keeping them there runs them in all ten layout
   * and engine projects rather than only in this production-only suite.
   */
});

test.describe('the bench, offline', () => {
  test('assembles a loadout with no network at all (013/FR-026)', async ({ page, context }) => {
    await withWorker(page, '/equipment');
    await expect(page.locator('.gate')).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    // The whole tool is a synchronous read of an in-memory loadout and an
    // installed package: choosing a suit, fitting a weapon and reading what
    // both are worth all work with the network gone.
    await expect(page.locator('.gate')).toBeVisible();
    await page.locator('.gate__suits .choice').first().click();
    await expect(page.locator('.gate')).toHaveCount(0);

    const stats = page.locator('.bench__region--stats');
    const tab = page.getByRole('tab', { name: 'Stats' });
    if ((await tab.count()) > 0) await tab.click();
    await expect(stats.locator('.metric__number')).toHaveCount(2);
    await expect(stats.locator('ednb-resistance-bar')).toHaveCount(8);

    await context.setOffline(false);
  });
});

test.describe('the privacy promise', () => {
  test('reaches no other origin and caches nothing of a build', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(page.url() || '/', 'http://x').origin) {
        foreign.push(request.url());
      }
    });

    await withWorker(page, '/ships');
    await openFirstHullFromManifest(page);
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await openLibrary(page);

    const origin = new URL(page.url()).origin;
    expect(foreign.filter((url) => new URL(url).origin !== origin)).toEqual([]);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(request.url);
        }
      }
      return urls;
    });

    // Only same-origin static assets, and never anything carrying a build.
    expect(cached.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    expect(cached.filter((url) => url.includes('#b.') || url.includes('ednb:record'))).toEqual([]);
  });

  test('reaches no other origin from the bench, and caches no loadout', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(page.url() || '/', 'http://x').origin) {
        foreign.push(request.url());
      }
    });

    await withWorker(page, '/equipment');
    await page.locator('.gate__suits .choice').first().click();
    await expect(page.locator('.gate')).toHaveCount(0);

    const origin = new URL(page.url()).origin;
    expect(foreign.filter((url) => new URL(url).origin !== origin)).toEqual([]);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(request.url);
        }
      }
      return urls;
    });

    // The loadout link lives in the fragment, which a browser never transmits
    // and a cache never keys on. Nothing carrying one is stored either.
    expect(cached.filter((url) => url.includes('#e.'))).toEqual([]);
  });

  test('reads a journal without sending or storing any of it', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(page.url() || '/', 'http://x').origin) {
        foreign.push(request.url());
      }
    });

    await withWorker(page, '/ships');
    await reachShellAction(page, /^import build$/i);
    const layer = page.getByRole('dialog', { name: /import build/i });
    await expect(layer).toBeVisible();
    await layer
      .locator('input[type="file"]')
      .setInputFiles(['e2e/fixtures/journal/Journal.ship-multiple.log']);
    await expect(layer.getByRole('checkbox')).toHaveCount(3);
    await layer.getByRole('button', { name: /^load build$/i }).click();
    await expect(page).toHaveURL(/\/outfitting(#|$)/);

    const origin = new URL(page.url()).origin;
    expect(foreign.filter((url) => new URL(url).origin !== origin)).toEqual([]);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(request.url);
        }
      }
      return urls;
    });

    // A journal is read in the browser and never leaves it: no request carries
    // a file name, and no cache entry holds one (016/FR-001, SC-002).
    expect(cached.filter((url) => url.toLowerCase().includes('journal'))).toEqual([]);
  });
});
