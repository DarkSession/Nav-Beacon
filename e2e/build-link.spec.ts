import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import { expectNoDocumentOverflow } from './accessibility/assertions';
import { buildStockHull, openFirstHullFromManifest, openLibrary, reachShellAction } from './shell';

/**
 * A build, passed to someone else.
 *
 * The link is the one thing this application produces that leaves the browser,
 * so the properties asserted here are the ones that make that safe: the payload
 * lives entirely in the fragment, it stays inside a published bound, it never
 * reaches a server, and anything unreadable is refused without touching the
 * build the Commander is already working on.
 */

/** The published bound, including the `b.` prefix and excluding the `#`. */
const MAX_LENGTH = 500;

/**
 * The hash the codec table stamps on itself.
 *
 * Chunk file names are hashed by the build, so nothing about a request tells the
 * lazily imported codec from any other lazy chunk. What is inside one does: the
 * table snapshot carries the content hash its generator wrote into it, and
 * nothing else in the bundle does. Read from the table rather than copied here,
 * so a regenerated table keeps the journey below holding its window open instead
 * of quietly stopping. Relative to the repository root, which is where the suite
 * runs from.
 */
const CODEC_TABLE_CONTENT_HASH = (
  JSON.parse(readFileSync('src/app/domain/ships/build-link/codec-table-1.json', 'utf8')) as {
    $generated: { contentHash: string };
  }
).$generated.contentHash;

/** Creates a stock build and waits for its link to be published. */
async function buildWithLink(page: Page, hull = 'Anaconda'): Promise<string> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting#b\./);
  return new URL(page.url()).hash.slice(1);
}

/**
 * Opens the export layer from the command bar and asks it for the link.
 *
 * Canvas 1c draws `EXPORT` in the bar's action row, so that is where it is
 * reached — and where the bar is folded the frame puts the same action behind
 * the named trigger, which `reachShellAction` knows about. The layer opens on the
 * format the canvas draws first, which is the payload, so the link is chosen
 * here rather than assumed.
 */
async function openShare(page: Page): Promise<void> {
  await reachShellAction(page, /^export$/i);
  const layer = page.getByRole('dialog');
  await expect(layer).toBeVisible();
  await layer.getByRole('radio', { name: /share link/i }).check();
  await expect(layer.locator('.share-link__value')).toBeVisible();
}

/** The workspace has a build open when its ledger has mounts in it. */
async function buildIsOpen(page: Page): Promise<void> {
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

test.describe('publishing a build link', () => {
  test('puts the whole payload in the fragment, within the published bound', async ({ page }) => {
    const fragment = await buildWithLink(page);
    const url = new URL(page.url());

    expect(fragment.startsWith('b.')).toBe(true);
    expect(fragment.length).toBeLessThanOrEqual(MAX_LENGTH);
    // Path and query carry no build data: the fragment is the only place it is,
    // and the fragment is the one part a browser never transmits.
    //
    // Also 015/FR-017, and the reason a build address is not an advertised
    // address: a build in the path or the query would be a Commander's loadout
    // in an access log and in a Referer header, and it would give this feature
    // an address to render a document for. There is nothing to render, because
    // there is nothing outside the fragment.
    expect(url.pathname).toBe('/outfitting');
    expect(url.search).toBe('');
  });

  test('shows the canonical address as text a Commander can select', async ({ page }) => {
    const fragment = await buildWithLink(page);
    await openShare(page);

    const value = page.getByRole('dialog').locator('.share-link__value');
    await expect(value).toBeVisible();
    expect(await value.textContent()).toContain(`#${fragment}`);
  });

  test('replaces the fragment rather than growing history', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);

    await page.goBack();

    // One entry back is the hull the build was created from. If publication
    // pushed instead of replacing, this would be `/outfitting` with no fragment.
    await expect(page).toHaveURL(/\/ships\/Anaconda$/);
  });

  test('states its link again where the saved builds were raised over it', async ({
    browser,
    page,
  }) => {
    // Publication is one lazily imported chunk and one encode after the edit
    // that asked for it. The saved builds push a history entry at the same
    // address, so a layer raised inside that window takes the fragment onto its
    // own entry, and closing it goes back to the entry that never received one.
    // Holding the codec chunk opens that window deliberately rather than racing
    // for it (022/FR-001).
    test.slow();

    let releaseCodec = (): void => {};
    const codecHeld = new Promise<void>((resolve) => {
      releaseCodec = resolve;
    });
    let codecRequested = (): void => {};
    const codecReached = new Promise<void>((resolve) => {
      codecRequested = resolve;
    });

    // Only the bundle's own chunk files are read, and only their bodies tell one
    // from another. Everything else the page asks for is left alone: pulling
    // every module through the test process to look at it costs the workspace
    // more time to arrive than the route budget allows.
    await page.route(/\/chunk-[^/?]+\.js(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes(CODEC_TABLE_CONTENT_HASH)) {
        await route.fulfill({ response, body });
        return;
      }
      codecRequested();
      await codecHeld;
      await route.fulfill({ response, body });
    });

    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');

    // Capped rather than open-ended: where the chunk never arrives as a request
    // of its own, this journey fails on the assertion below, which names what
    // went wrong, rather than on a timeout waiting for a request that is not
    // coming.
    await Promise.race([codecReached, new Promise((resolve) => setTimeout(resolve, 3_000))]);

    await openLibrary(page);
    const layer = page.getByRole('dialog', { name: 'Saved builds' });
    await expect(layer).toBeVisible();

    // The window is open: the layer stands over an address carrying nothing, so
    // the publication released below lands on the layer's entry. Read here, this
    // is what stops the journey passing without ever having held the chunk.
    expect(new URL(page.url()).hash).toBe('');

    releaseCodec();

    // The publication lands while the layer is up, which is the entry it lands
    // on. Nothing here is wrong yet: that entry was pushed at this address.
    await expect(page).toHaveURL(/\/outfitting#b\./);

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(layer).toBeHidden();

    // And here, on the workspace's own entry, which the publication never
    // reached. The address describes the build that is open because the link
    // that was published is stated again.
    await expect(page).toHaveURL(/\/outfitting#b\./);
    const fragment = new URL(page.url()).hash.slice(1);

    // Read where nothing else could have supplied the build. A fresh context
    // holds no stored record, so what opens there came from the address and from
    // nowhere else. A reload in this context would not discriminate: this build
    // holds a record, and autosave restores it under 001/FR-008 whether the
    // fragment came back or not.
    const elsewhere = await browser.newContext();
    const incoming = await elsewhere.newPage();
    await incoming.goto(`/outfitting#${fragment}`);

    await expect(incoming.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    await buildIsOpen(incoming);
    await elsewhere.close();
  });

  test('is reachable and readable with no accessibility violations', async ({ page }, testInfo) => {
    await buildWithLink(page);
    await openShare(page);

    await expectNoAccessibilityViolations(page, testInfo, { label: 'share-link' });
    await expectNoDocumentOverflow(page);
  });
});

test.describe('restoring a build from a link', () => {
  test('opens as a working build from a link, with nothing saved by name', async ({ page }) => {
    const fragment = await buildWithLink(page);

    const incoming = await page.context().newPage();
    await incoming.goto(`/outfitting#${fragment}`);

    await expect(incoming.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    await buildIsOpen(incoming);

    // A link is not a save. Opening one leaves a working record whose title is
    // derived from the hull, so what matters is that nothing in the library
    // carries a name a Commander gave it.
    await openLibrary(incoming);
    await expect(incoming.locator('ednb-saved-build-card').first()).toBeVisible();
    await expect(
      incoming.locator('ednb-saved-build-card .record__title:not(.record__title--derived)'),
    ).toHaveCount(0);
    await incoming.close();
  });

  test('restores the fixed mounts a link never enumerates', async ({ page }) => {
    const fragment = await buildWithLink(page);

    const incoming = await page.context().newPage();
    await incoming.goto(`/outfitting#${fragment}`);
    await buildIsOpen(incoming);

    // The package pins fixed modules, so the payload omits them and the
    // package's own construction puts them back. Nothing here repaired
    // anything, so nothing here reports having done so.
    await expect(incoming.getByText(/defaulted|repaired|restored automatically/i)).toHaveCount(0);
    expect(new URL(incoming.url()).hash.slice(1)).toBe(fragment);
    await incoming.close();
  });

  test('re-encodes to the same canonical value it arrived as', async ({ page }) => {
    const fragment = await buildWithLink(page);

    const incoming = await page.context().newPage();
    await incoming.goto(`/outfitting#${fragment}`);
    await buildIsOpen(incoming);
    // Polled rather than waited for by a page function, so the wait takes the
    // assertion allowance: the restored build is re-encoded asynchronously, and
    // the fragment is replaced when that encode resolves.
    await expect.poll(() => incoming.evaluate(() => window.location.hash)).toBe(`#${fragment}`);
    await incoming.close();
  });
});

test.describe('a link that cannot be read', () => {
  /** Every shape of unreadable payload a browser can actually deliver. */
  const refusals = [
    { name: 'malformed', fragment: 'b.not-a-payload' },
    { name: 'truncated', fragment: 'b.A' },
    { name: 'over-limit', fragment: `b.${'A'.repeat(MAX_LENGTH)}` },
    { name: 'unsupported version', fragment: 'b.zzzzzzzzzzzzzzzz' },
  ];

  for (const refusal of refusals) {
    test(`leaves the active build untouched: ${refusal.name}`, async ({ page }) => {
      await buildWithLink(page);
      await buildIsOpen(page);

      await page.evaluate((fragment) => {
        window.location.hash = fragment;
      }, refusal.fragment);

      // The build a Commander is working on is not something a bad link may
      // cost them, whatever the link turns out to be.
      await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
      await expect(page.getByText('Anaconda').first()).toBeVisible();
      await buildIsOpen(page);
    });
  }

  test('says why, in the application’s own words', async ({ page }) => {
    await buildWithLink(page);

    await page.evaluate(() => {
      window.location.hash = 'b.not-a-payload';
    });

    const notice = page.getByText(/^This build link|^This is not a build link/);
    await expect(notice.first()).toBeVisible();
    // Never an internal exception: those name table versions and bit widths,
    // and they are not translated.
    expect(await notice.first().textContent()).not.toMatch(/codec table|bit width|envelope/i);
  });

  test('leaves a fragment that is not a build link alone', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);

    await page.evaluate(() => {
      window.location.hash = 'some-anchor';
    });

    // Not interpreted, not refused, not cleared: the fragment belongs to
    // something else and this application has no business touching it.
    await expect(page.getByText(/^This build link|^This is not a build link/)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('#some-anchor');
  });
});

test.describe('what a link never sends', () => {
  test('transmits no build data and reaches no other origin', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/ships');
    // Any hull will do — this journey is about what leaves the browser, not
    // about which ship. Whichever the manifest lists first is reachable at every
    // layout profile without opening a filter panel.
    await openFirstHullFromManifest(page);
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);
    await openShare(page);
    // The share layer comes down before the library goes up. They are both
    // layers over the same screen now — the library stopped being an address to
    // navigate to (2026-09-04) — so the second cannot be reached through the
    // first.
    await page.keyboard.press('Escape');
    await openLibrary(page);

    const origin = new URL(page.url()).origin;
    for (const request of requests) {
      // A fragment is never transmitted by a browser. This asserts nothing in
      // the application puts one somewhere that would be.
      expect(request, request).not.toContain('#b.');
      expect(request.replace(/^data:.*/, ''), request).not.toMatch(/[?&][^=]*=b\./);
      expect(request.startsWith(origin) || request.startsWith('data:'), request).toBe(true);
    }
  });
});
