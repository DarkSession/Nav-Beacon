import { expect, test, type Page } from '@playwright/test';
import { PRODUCT_URL } from './servers';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { buildStockHull, openFirstHullFromManifest } from './shell';
import { SITE_ORIGIN } from '../src/app/platform/browser/site-address';

/**
 * What this application says about itself to something that is not a Commander.
 *
 * A search engine, and a chat client unfurling a pasted link, read the head and
 * never the screen. This is the journey that holds the head to the route a
 * Commander is actually on, rather than to the application in general
 * (011/FR-027, 011/SC-008).
 *
 * The static half — `robots.txt`, `sitemap.xml`, the manifest and the head as
 * `index.html` ships it — is reconciled against the route table and against
 * `SITE_ORIGIN` by the policy checker, which can compare files a browser cannot
 * see at once. What only a browser can answer is the half covered here: that
 * the tags are actually rewritten as a Commander moves between screens, in the
 * language the page is in, with the build kept out of the address.
 */

/**
 * One head value, once it has settled.
 *
 * Polled rather than read once. The tags are rewritten on the navigation the
 * route completes, which is not ordered against the frame that first paints
 * `main`; a crawler waits for a page to settle and so does this. Reading once
 * is how a passing assertion becomes an intermittent one.
 */
function head(page: Page, selector: string, attribute: string) {
  return expect.poll(() => page.locator(selector).first().getAttribute(attribute));
}

const description = (page: Page) => head(page, 'head meta[name="description"]', 'content');
const canonical = (page: Page) => head(page, 'head link[rel="canonical"]', 'href');

test.describe('what the head says this page is', () => {
  test('names the screen, not the product, on each addressable route', async ({ page }) => {
    await page.goto(`${PRODUCT_URL}/ships`);
    await expect(page.getByRole('main')).toBeVisible();
    await description(page).toBe(englishMessages['catalogue.description']);

    await expect
      .poll(() => page.title())
      .toBe(`${englishMessages['catalogue.title']} · ${englishMessages['app.name']}`);

    // The saved builds are not among the addressable routes: they are a layer
    // over the screen a Commander is on, with no address, no document and
    // nothing for a crawler to read (Commander request 2026-09-04).
    await page.goto(`${PRODUCT_URL}/equipment`);
    await expect(page.getByRole('main')).toBeVisible();
    await description(page).toBe(englishMessages['equipment.description']);
    await expect
      .poll(() => page.title())
      .toBe(`${englishMessages['equipment.title']} · ${englishMessages['app.name']}`);

    expect(englishMessages['catalogue.description']).not.toBe(
      englishMessages['equipment.description'],
    );
  });

  test('carries the route into the canonical address and both cards', async ({ page }) => {
    await page.goto(`${PRODUCT_URL}/equipment`);
    await expect(page.getByRole('main')).toBeVisible();

    await canonical(page).toBe(`${SITE_ORIGIN}/equipment`);
    await head(page, 'head meta[property="og:url"]', 'content').toBe(`${SITE_ORIGIN}/equipment`);
    await head(page, 'head meta[property="og:description"]', 'content').toBe(
      englishMessages['equipment.description'],
    );

    const title = await page.title();
    await head(page, 'head meta[property="og:title"]', 'content').toBe(title);
    await head(page, 'head meta[name="twitter:title"]', 'content').toBe(title);
    expect(title).toContain(englishMessages['equipment.title']);
  });

  test('names the production site rather than wherever it is being served from', async ({
    page,
  }) => {
    await page.goto(`${PRODUCT_URL}/ships`);
    await expect(page.getByRole('main')).toBeVisible();

    await canonical(page).toBe(`${SITE_ORIGIN}/ships`);
    await canonical(page).not.toContain('localhost');
  });

  test('names the hull an open address is about', async ({ page }) => {
    await page.goto(`${PRODUCT_URL}/ships`);
    // The manifest row carries the package symbol, which is what the artwork
    // directories are keyed by. The address is the hull's name (001/FR-005), so
    // the symbol is read off the row rather than out of the address bar.
    const symbol =
      (await page.locator('[data-hull-symbol]:visible').first().getAttribute('data-hull-symbol')) ??
      '';
    await openFirstHullFromManifest(page);
    await expect(page).toHaveURL(/\/ships\/[^/]+$/);

    const address = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    expect(symbol.length).toBeGreaterThan(0);

    // The hull's own name and the hull's own picture. Forty-nine addresses
    // that describe themselves identically are one address as far as a search
    // engine is concerned (011/FR-027).
    //
    // The name is read out of the title rather than out of the package: the
    // Almanac is ESM-only and this suite is loaded as CommonJS, and what is
    // under test is that the title, the description and the card all name the
    // same hull — which the title itself is enough to check.
    await expect.poll(() => page.title()).not.toBe(englishMessages['app.document-title.default']);
    const hull = (await page.title()).split(' · ')[0];
    expect(hull.length).toBeGreaterThan(0);

    await description(page).toContain(hull);
    await description(page).not.toBe(englishMessages['catalogue.description']);
    await head(page, 'head meta[property="og:image"]', 'content').toBe(
      `${SITE_ORIGIN}/assets/ships/${symbol}/illustration.png`,
    );
    await canonical(page).toBe(`${SITE_ORIGIN}/ships/${address}`);
    // The address is the hull's name with an underscore for each space, so it
    // is the title's own words and never the symbol unless the two are spelled
    // alike.
    expect(address).toBe(hull.replace(/ /g, '_'));
  });

  test('falls back to the screen it sits inside where the hull is not one', async ({ page }) => {
    // An address for a symbol the package does not carry. The title and the
    // description both interpolate the hull, so publishing them here would put
    // a sentence with a hole in it into a search result; the catalogue's own
    // identity is what the screen behind the notice is.
    await page.goto(`${PRODUCT_URL}/ships/Not_A_Hull`);
    await expect(page.getByRole('main')).toBeVisible();

    await description(page).toBe(englishMessages['catalogue.description']);
    await expect
      .poll(() => page.title())
      .toBe(`${englishMessages['catalogue.title']} · ${englishMessages['app.name']}`);
    await canonical(page).toBe(`${SITE_ORIGIN}/ships/Not_A_Hull`);
  });

  test('keeps the build out of the address, because that is where it lives', async ({ page }) => {
    await page.goto(`${PRODUCT_URL}/ships`);
    await openFirstHullFromManifest(page);
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#./);

    await canonical(page).toBe(`${SITE_ORIGIN}/outfitting`);
  });

  test('is in the language the page is in', async ({ browser, baseURL }) => {
    // The baseURL travels with the context, as it does everywhere else in the
    // suite: a context made without one answers relative navigations from
    // nowhere, and the next person to write `page.goto('/ships')` here would
    // find out the hard way.
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();

    await page.goto(`${PRODUCT_URL}/ships`);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    await description(page).toBe(germanMessages['catalogue.description']);
    await head(page, 'head meta[property="og:locale"]', 'content').toBe('de');
    await expect
      .poll(() => page.title())
      .toBe(`${germanMessages['catalogue.title']} · ${germanMessages['app.name']}`);

    // The product's own address, whose title is a phrase rather than a name and
    // so is the one title with wording of its own to translate.
    await page.goto(`${PRODUCT_URL}/`);
    await expect(page.getByRole('main')).toBeVisible();
    await expect.poll(() => page.title()).toBe(germanMessages['app.document-title.default']);

    await context.close();
  });

  test('is already in the document before anything runs', async ({ page }) => {
    // The head a reader that executes no script is served. Fetched rather than
    // navigated to, so the bundle never gets the chance to rewrite it, and
    // read for its values rather than for the presence of its tags: a head of
    // empty `content` attributes would satisfy "the tags are there" and say
    // exactly as much to a crawler as no head at all.
    const response = await page.request.get(`${PRODUCT_URL}/index.html`);
    const document = await response.text();
    const value = (pattern: RegExp): string => pattern.exec(document)?.[1] ?? '';

    expect(value(/<title>([^<]*)<\/title>/)).toBe(englishMessages['app.document-title.default']);
    expect(value(/name="description"[^>]*content="([^"]*)"/s)).toBe(
      englishMessages['app.description'],
    );
    expect(value(/property="og:description"[^>]*content="([^"]*)"/s)).toBe(
      englishMessages['app.description'],
    );
    // Both cards' titles are the document's, which at the root is the product's
    // full title rather than its bare name. Asserted tag by tag: the checker
    // holds the three descriptions equal to each other but has no title
    // equivalent, so a title tag left behind drifts in silence.
    expect(value(/property="og:title"[^>]*content="([^"]*)"/s)).toBe(
      englishMessages['app.document-title.default'],
    );
    expect(value(/name="twitter:title"[^>]*content="([^"]*)"/s)).toBe(
      englishMessages['app.document-title.default'],
    );
    expect(value(/rel="canonical"[^>]*href="([^"]*)"/)).toBe(`${SITE_ORIGIN}/`);
    expect(value(/name="twitter:card"[^>]*content="([^"]*)"/)).toBe('summary_large_image');
    expect(value(/property="og:image"[^>]*content="([^"]*)"/)).toBe(
      `${SITE_ORIGIN}/assets/link-card.png`,
    );
    // The alternative text is the document's own title, here as at runtime, so
    // the picture is described in whatever language the page is in rather than
    // in one of its own.
    expect(value(/property="og:image:alt"[^>]*content="([^"]*)"/)).toBe(
      englishMessages['app.document-title.default'],
    );
    // The site asks to be indexed. Only a preview deployment rewrites this, and
    // it rewrites its own built copy rather than the file in the repository.
    expect(value(/name="robots"[^>]*content="([^"]*)"/)).toContain('index');
    expect(value(/name="robots"[^>]*content="([^"]*)"/)).not.toContain('noindex');
    expect(document).toContain('application/ld+json');
    expect(document).toContain('rel="manifest"');
  });

  test('hands a crawler a policy, a map and a manifest that agree with it', async ({ page }) => {
    const read = async (path: string): Promise<string> =>
      (await page.request.get(`${PRODUCT_URL}${path}`)).text();

    const robots = await read('/robots.txt');
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(robots).not.toMatch(/^\s*Disallow:\s*\/\s*$/m);

    const sitemap = await read('/sitemap.xml');
    for (const route of ['/ships', '/outfitting', '/equipment']) {
      expect(sitemap).toContain(`<loc>${SITE_ORIGIN}${route}</loc>`);
    }

    // One address per hull, enumerated from the package rather than listed by
    // hand. Counted rather than named: the set belongs to the Almanac, and a
    // list of symbols here would be the private copy of package data the
    // generator exists to avoid.
    const hulls = [...sitemap.matchAll(/<loc>[^<]*\/ships\/[^<]+<\/loc>/g)];
    expect(hulls.length).toBeGreaterThan(40);

    const manifest = JSON.parse(await read('/manifest.webmanifest')) as {
      icons: { sizes?: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({
      name: englishMessages['app.name'],
      short_name: englishMessages['app.name'],
      description: englishMessages['app.description'],
      display: 'standalone',
    });

    // Installability is the icon sizes, not the presence of the member.
    for (const size of ['192x192', '512x512']) {
      expect(manifest.icons.some((icon) => icon.sizes === size)).toBe(true);
    }
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});
