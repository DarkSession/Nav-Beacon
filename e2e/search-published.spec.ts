import { expect, test, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { SITE_ORIGIN } from '../src/app/platform/browser/site-address';
import { PRODUCT_URL } from './servers';
import { shapeOf } from './served-document';

/**
 * What a reader that runs no script is actually served, address by address.
 *
 * The other half of this feature's journey — `search-visibility.spec.ts` —
 * watches the application rewrite the head as a Commander moves. This half
 * never runs the application at all. It fetches the documents the build wrote
 * and reads them, because that is what a crawler and a chat client do, and
 * because the two halves fail differently: the head can be perfect in the
 * browser while every address serves a 404 with the site's own title on it.
 *
 * It needs the production output, so it runs under `pnpm run e2e:offline`
 * beside the other journeys that do (`playwright.config.ts`,
 * `NEVER_IN_A_DEVELOPMENT_RUN`). `scripts/serve-production.mjs` resolves
 * `<path>.html` before a directory, which is the order GitHub Pages resolves
 * in, so `/ships` here answers with the document the deployment publishes
 * rather than with the single-page fallback.
 */

/** One value out of a fetched document, or the empty string. */
function value(document: string, pattern: RegExp): string {
  return pattern.exec(document)?.[1] ?? '';
}

const title = (document: string) => value(document, /<title>([^<]*)<\/title>/);
const description = (document: string) =>
  value(document, /name="description"[^>]*content="([^"]*)"/s);
const canonical = (document: string) => value(document, /rel="canonical"[^>]*href="([^"]*)"/);

/**
 * A document's body as a reader that runs no script sees it: text, no markup.
 *
 * Scripts are excluded, and that is the whole point. The bundle's module
 * preloads sit in the body, so counting their contents as something a reader
 * can see would let a document that stated a hull's figures only inside a
 * script pass every assertion below while serving a crawler nothing.
 *
 * Parsed rather than pattern-matched, for the reason `served-document.ts`
 * gives at length.
 */
async function readableText(page: Page, document: string): Promise<string> {
  return (await shapeOf(page, document)).text;
}

/** Every `<h1>` a document carries, in document order. */
async function headings(page: Page, document: string): Promise<readonly string[]> {
  return (await shapeOf(page, document)).headings;
}

test.describe('the document each published address answers with', () => {
  test('answers from its own document, without a redirect', async ({ page }) => {
    // A crawler drops a 404 whatever the body says, canonical link and all, and
    // a redirect indexes the address it lands on rather than the one advertised.
    //
    // The status alone proves nothing here: this server, like the static host
    // it mirrors, answers an unpublished path with the application shell at
    // 200. What separates a published document from that fallback is the
    // canonical it carries — the shell's names the site root — so that is what
    // is read.
    for (const path of ['/ships', '/outfitting', '/equipment', '/ships/Anaconda']) {
      const response = await page.request.get(`${PRODUCT_URL}${path}`, { maxRedirects: 0 });

      expect(response.status(), path).toBe(200);
      expect(canonical(await response.text()), path).toBe(`${SITE_ORIGIN}${path}`);
    }

    // The other half of that claim: an address nobody published does fall
    // through, so the assertion above is about publication and not about the
    // server answering everything.
    const fallback = await (await page.request.get(`${PRODUCT_URL}/nothing-here`)).text();
    expect(canonical(fallback)).toBe(`${SITE_ORIGIN}/`);
  });

  test('carries the screen its address is, not the application in general', async ({ page }) => {
    // All three top-level addresses, because a mapping exchanged between two of
    // them would leave every key declared somewhere and only the pairing wrong.
    // The saved builds were a fourth until 2026-09-04, when they stopped being
    // an address at all: they are a layer over the screen a Commander is on,
    // and there is no document for a crawler to read.
    const catalogue = await (await page.request.get(`${PRODUCT_URL}/ships`)).text();
    const workspace = await (await page.request.get(`${PRODUCT_URL}/outfitting`)).text();
    const bench = await (await page.request.get(`${PRODUCT_URL}/equipment`)).text();

    expect(description(catalogue)).toBe(englishMessages['catalogue.description']);
    expect(canonical(catalogue)).toBe(`${SITE_ORIGIN}/ships`);

    expect(description(workspace)).toBe(englishMessages['workspace.description']);
    expect(title(workspace)).toBe(
      `${englishMessages['workspace.title']} · ${englishMessages['app.name']}`,
    );
    expect(canonical(workspace)).toBe(`${SITE_ORIGIN}/outfitting`);

    expect(description(bench)).toBe(englishMessages['equipment.description']);
    expect(title(bench)).toBe(
      `${englishMessages['equipment.title']} · ${englishMessages['app.name']}`,
    );
    expect(canonical(bench)).toBe(`${SITE_ORIGIN}/equipment`);
  });

  test('names the hull, and shows the hull, on a hull address', async ({ page }) => {
    // One hull by name, deliberately. The address *set* belongs to the Almanac
    // and is counted rather than listed below; a single well-known member of it
    // is a fixture, and naming it is what lets this assert that the title, the
    // description and the card all say the same hull.
    const document = await (await page.request.get(`${PRODUCT_URL}/ships/Anaconda`)).text();

    expect(title(document)).toBe(`Anaconda · ${englishMessages['app.name']}`);
    expect(description(document)).toContain('Anaconda');
    expect(canonical(document)).toBe(`${SITE_ORIGIN}/ships/Anaconda`);
    expect(value(document, /property="og:image"[^>]*content="([^"]*)"/)).toBe(
      `${SITE_ORIGIN}/assets/ships/Anaconda/illustration.png`,
    );
    // The alt text is the title, so the picture is described in whatever
    // language the document is in rather than in one of its own.
    expect(value(document, /property="og:image:alt"[^>]*content="([^"]*)"/)).toBe(title(document));
  });

  test('publishes one document for every address the map advertises', async ({ page }) => {
    const sitemap = await (await page.request.get(`${PRODUCT_URL}/sitemap.xml`)).text();
    const advertised = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
      (match) => match[1],
    );

    // More than the three top-level addresses, because every hull has one.
    // Counted rather than named: the set belongs to the Almanac.
    expect(advertised.length).toBeGreaterThan(40);

    for (const address of advertised) {
      const path = address.slice(SITE_ORIGIN.length);
      const response = await page.request.get(`${PRODUCT_URL}${path}`, { maxRedirects: 0 });

      expect(response.status(), address).toBe(200);
      expect(canonical(await response.text()), address).toBe(address);
    }
  });

  test('keeps the application’s own identity on the page that catches everything else', async ({
    page,
  }) => {
    // `404.html` answers an address nobody published, so it is the one document
    // that should not claim to be a screen.
    const document = await (await page.request.get(`${PRODUCT_URL}/404.html`)).text();

    expect(title(document)).toBe(englishMessages['app.document-title.default']);
    expect(description(document)).toBe(englishMessages['app.description']);
    expect(canonical(document)).toBe(`${SITE_ORIGIN}/`);
  });

  /**
   * The half feature 015 added: the body, not the head.
   *
   * Everything above this point would pass just as well against the shell this
   * application served for its first fourteen features — a correct head over an
   * empty `<app-root>`. What a reader that runs no script actually wants is
   * underneath it, and until now none of it was there (015/FR-001, SC-001).
   */
  test('states a hull’s figures in the body, with no script executed', async ({ page }) => {
    const response = await page.request.get(`${PRODUCT_URL}/ships/Anaconda`, { maxRedirects: 0 });
    const document = await response.text();
    const body = await readableText(page, document);

    // The figures FR-002 names, in the words the document uses for them. Read
    // out of the served bytes: no browser has run, nothing has booted, and this
    // is exactly what an indexer or an AI crawler is handed.
    expect(body).toContain('Faulcon DeLacy');
    expect(body).toContain('180 m/s');
    expect(body).toContain('350 MJ');
    expect(body).toContain('400 t');
    expect(body).toContain('Crew 4');
    expect(body).toContain('Mass lock 23');
    expect(body).toContain('1 Huge');
    expect(body).toContain('3 Large');
  });

  test('opens every content-bearing document with its own subject', async ({ page }) => {
    // What a reader applying no CSS resolves by document order. The shell draws
    // two bar compositions and hides one, so a hull's document carries two
    // `<h1>` elements in markup while exactly one is ever rendered — the
    // narrower composition's comes first, and it names the hull.
    for (const [path, subject] of [
      ['/ships/Anaconda', 'Anaconda'],
      ['/ships/Viper_Mk_IV', 'Viper Mk IV'],
    ] as const) {
      const document = await (
        await page.request.get(`${PRODUCT_URL}${path}`, { maxRedirects: 0 })
      ).text();

      expect((await headings(page, document))[0], path).toBe(subject);
    }
  });

  test('names every hull the catalogue lists', async ({ page }) => {
    const document = await (
      await page.request.get(`${PRODUCT_URL}/ships`, { maxRedirects: 0 })
    ).text();
    const body = await readableText(page, document);

    // Counted against the sitemap rather than against 49: the set belongs to
    // the Almanac, and a pin move must not need this number edited (FR-003).
    const sitemap = await (await page.request.get(`${PRODUCT_URL}/sitemap.xml`)).text();
    const hulls = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((match) => match[1])
      .filter((address) => address.startsWith(`${SITE_ORIGIN}/ships/`));

    expect(hulls.length).toBeGreaterThan(40);
    for (const address of hulls) {
      const segment = address.slice(`${SITE_ORIGIN}/ships/`.length);
      expect(body, address).toContain(segment.replace(/_/g, ' '));
    }

    // FR-003's other half — a link from here to each hull's own address — is
    // NOT asserted, because it is not built. The catalogue's rows are buttons
    // whose second press builds the hull rather than navigating to it
    // (`responsive-catalogue-view.ts`, Commander request 2026-08-28), so they
    // are not links and cannot be relabelled into links without changing what
    // the control means. Every hull address is still reachable: the sitemap
    // lists all 49, and each answers 200 with its own canonical, which the
    // tests above check. Recorded here rather than quietly asserted around,
    // because a crawler following links alone finds no hull from this page.
  });

  test('states every content-bearing address’s subject, and leaves the benches alone', async ({
    page,
  }) => {
    // The whole set, from the map rather than from a list here. The two benches
    // are advertised and state nothing until a Commander acts, so they keep the
    // empty body they have always had — which is a ruling, not an oversight
    // (FR-018).
    const sitemap = await (await page.request.get(`${PRODUCT_URL}/sitemap.xml`)).text();
    const advertised = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
      (match) => match[1],
    );
    const benches = [`${SITE_ORIGIN}/outfitting`, `${SITE_ORIGIN}/equipment`];

    let stated = 0;
    for (const address of advertised) {
      const path = address.slice(SITE_ORIGIN.length);
      const body = await readableText(
        page,
        await (await page.request.get(`${PRODUCT_URL}${path}`, { maxRedirects: 0 })).text(),
      );

      if (benches.includes(address)) {
        expect(body, address).toBe('');
        continue;
      }
      expect(body.length, address).toBeGreaterThan(0);
      stated += 1;
    }

    expect(stated).toBe(advertised.length - benches.length);
  });

  test('serves the navigation fallback with no address’s content in it', async ({ page }) => {
    // `index.csr.html` is what the service worker falls back to for every
    // navigation it cannot match, and what `404.html` is copied from. A body
    // here is one address's content served under every other address at once,
    // which is the trap that made the root's document worth thinking about at
    // all (015/FR-014, `contracts/address-set.md` §3).
    for (const path of ['/index.csr.html', '/404.html']) {
      const document = await (await page.request.get(`${PRODUCT_URL}${path}`)).text();

      expect(await readableText(page, document), path).toBe('');
    }
  });
});
