import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import { expectNoDocumentOverflow } from './accessibility/assertions';
import { buildStockHull, openLibrary, reachShellAction, recordCount } from './shell';

/**
 * A build arriving from somewhere else.
 *
 * Everything here is about the same promise: an import either becomes the
 * active build in one step, or changes nothing at all. The interesting cases
 * are the refusals, because a refusal that half-replaced a build would be
 * indistinguishable on screen from one that did not.
 */

/** One valid journal Loadout event, the smallest thing the Almanac accepts. */
const JOURNAL_EVENT = JSON.stringify({
  event: 'Loadout',
  Ship: 'anaconda',
  Modules: [],
});

/** The same build inside a SLEF envelope, as another application would export it. */
const SLEF_ENVELOPE = JSON.stringify([
  { header: { appName: 'EDSY', appVersion: '2.0' }, data: JSON.parse(JOURNAL_EVENT) },
]);

/** The one gate, in bytes. Named here so the journey states it rather than implies it. */
const LIMIT_BYTES = 65_536;

async function openImport(page: Page): Promise<void> {
  await reachShellAction(page, /^import build$/i);
  await expect(page.getByRole('dialog', { name: /import build/i })).toBeVisible();
}

function layer(page: Page) {
  return page.getByRole('dialog', { name: /import build/i });
}

async function paste(page: Page, payload: string): Promise<void> {
  await layer(page)
    .getByLabel(/slef payload/i)
    .fill(payload);
}

async function submit(page: Page): Promise<void> {
  await layer(page)
    .getByRole('button', { name: /^load build$/i })
    .click();
}

/** A build already open in the workspace, so a replacement has something to replace. */
async function withStockBuild(page: Page): Promise<void> {
  await page.goto('/ships/Anaconda');
  await buildStockHull(page, 'Build');
  // Waits for the published fragment, not merely the route: publication is
  // asynchronous, and a hash captured before it lands would compare unequal to
  // itself a moment later.
  await expect(page).toHaveURL(/\/outfitting#b\./);
}

test.describe('importing a build', () => {
  test('is offered from every screen, with no build and no chosen hull', async ({ page }) => {
    // The library is not on this list. It is a modal layer over the screen it
    // was opened from, with no address of its own, and a modal makes the frame
    // behind it inert — which is what a modal is for. The import action is the
    // screen's, reached by closing the library (feature 001, build-library
    // design, "Composition").
    for (const route of ['/ships', '/ships/Anaconda', '/outfitting']) {
      await page.goto(route);
      await openImport(page);
      await expect(layer(page).getByLabel(/slef payload/i)).toBeEditable();
      await page
        .getByRole('button', { name: /^close$/i })
        .first()
        .click();
    }
  });

  test('is offered from the screen the library was opened over', async ({ page }) => {
    await openLibrary(page);
    await expect(page.getByRole('dialog', { name: /saved builds/i })).toBeVisible();

    await page.getByRole('button', { name: /^close$/i }).click();
    await openImport(page);

    await expect(layer(page).getByLabel(/slef payload/i)).toBeEditable();
  });

  test('turns a bare journal event into the active build', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JOURNAL_EVENT);
    await submit(page);

    await expect(page).toHaveURL(/\/outfitting($|[#?])/);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    // It is the active build and nothing more. It is kept the way any active
    // build is kept: in the address, and in the record autosave holds it in
    // because this event carries choices. No record is named for it — a name is
    // a Commander's, and none was given here (024/FR-001).
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#b\./);
    await openLibrary(page);
    await expect(
      page.locator('ednb-saved-build-card .record__title:not(.record__title--derived)'),
    ).toHaveCount(0);
  });

  test('takes no record for an entry holding a build at the package default', async ({
    page,
    browser,
  }) => {
    // The payload is the application's own export of a build nobody changed, so
    // what arrives is the hull's package default exactly. It becomes the active
    // build and it is in the address, and that is the whole of what holds it:
    // there is no decision in it worth a record (024/FR-001).
    await withStockBuild(page);
    expect(await recordCount(page)).toBe(0);

    await reachShellAction(page, /^export$/i);
    const exported = page.getByRole('dialog', { name: /export build/i });
    await exported.getByRole('radio', { name: /slef json/i }).check();
    const payload = await exported.getByLabel(/slef payload/i).inputValue();
    expect(payload).not.toBe('');

    // Pasted where nothing else could have supplied the build: a fresh context
    // shares neither the store nor the address this one published.
    const elsewhere = await browser.newContext();
    const incoming = await elsewhere.newPage();
    await incoming.goto('/ships');
    await openImport(incoming);
    await paste(incoming, payload);
    await submit(incoming);

    await expect(incoming).toHaveURL(/\/outfitting($|[#?])/);
    await expect(incoming.locator('[data-slot-key]').first()).toBeVisible();
    await expect.poll(() => incoming.evaluate(() => location.hash)).toMatch(/^#b\./);

    // Reloaded before the count, which is what makes the count an answer. The
    // page writes what it owes on the way out, so a record owed for the
    // imported build is in the store by the time it is read; counted on the
    // page that took the import, the read lands inside the coalescing window
    // and says nothing is stored whether or not one is owed.
    await incoming.reload();

    // And the build comes back, from the address alone. That is the other half
    // of the same claim: nothing was stored, and nothing needed to be.
    await expect(incoming.locator('[data-slot-key]').first()).toBeVisible();
    expect(await recordCount(incoming)).toBe(0);
    await elsewhere.close();
  });

  test('accepts a one-entry SLEF envelope the same way', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, SLEF_ENVELOPE);
    await submit(page);

    await expect(page).toHaveURL(/\/outfitting($|[#?])/);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  });

  test('draws the hull own schematics, however the source spelled it', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JOURNAL_EVENT);
    await submit(page);

    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    // A journal event names its hull the way the game logs it — `anaconda` —
    // and feature 010 draws from `assets/ships/<symbol>/`, a directory named
    // for the package's own symbol. A build that kept the source's spelling
    // asks for a directory no host serves, and both plates report the hull as
    // temporarily unavailable for a build that is perfectly whole.
    for (const side of ['top', 'bottom']) {
      const plate = page.locator(`ednb-hull-anatomy .schematic[data-side="${side}"]`);
      await expect(plate).toHaveAttribute('data-state', 'ready');
      await expect(plate.locator('.schematic__artwork image')).toHaveAttribute(
        'href',
        `assets/ships/Anaconda/schematic-${side}.png`,
      );
    }
  });

  test('adds no route and no history entry of its own', async ({ page }) => {
    await page.goto('/ships');
    const before = await page.evaluate(() => history.length);

    await openImport(page);
    await expect(page).toHaveURL(/\/ships$/);
    await page.getByRole('button', { name: /^cancel$/i }).click();

    expect(await page.evaluate(() => history.length)).toBe(before);
  });
});

test.describe('what the layer refuses, and what it leaves alone', () => {
  test('refuses one byte over the limit, naming the size and the limit', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);

    const padding = 'a'.repeat(LIMIT_BYTES);
    await paste(page, JSON.stringify({ event: 'Loadout', Ship: 'anaconda', Pad: padding }));
    await submit(page);

    await expect(layer(page).getByText(/most that can be imported/i)).toBeVisible();
    await expect(page).toHaveURL(/\/ships$/);
  });

  test('measures bytes rather than characters', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);

    // Half the limit in characters; one and a half times it in bytes.
    await paste(page, '€'.repeat(LIMIT_BYTES / 2));
    await submit(page);

    await expect(layer(page).getByText(/most that can be imported/i)).toBeVisible();
  });

  test('says malformed JSON in its own words, with no package prose', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, '{ not json');
    await submit(page);

    await expect(layer(page).getByText(/not valid JSON/i)).toBeVisible();
    // No exception message, no stack, no parser internals.
    await expect(layer(page).getByText(/unexpected token/i)).toHaveCount(0);
  });

  test('refuses zero and refuses two, rather than choosing one', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);

    await paste(page, '[]');
    await submit(page);
    await expect(layer(page).getByText(/exactly one build/i)).toBeVisible();

    await paste(page, JSON.stringify([JSON.parse(SLEF_ENVELOPE)[0], JSON.parse(SLEF_ENVELOPE)[0]]));
    await submit(page);
    await expect(layer(page).getByText(/exactly one build/i)).toBeVisible();
    await expect(page).toHaveURL(/\/ships$/);
  });

  test('lists the Almanac’s own diagnostics, fact by fact', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JSON.stringify([{ header: {}, data: {} }]));
    await submit(page);

    // Behind `Show advanced` since 2026-08-26: the refusal says what happened
    // in one sentence, and the package's own diagnostics are what a Commander
    // asks for when that sentence is not enough (Commander request).
    const list = layer(page).getByRole('list', { name: /refused/i });
    await expect(list).toHaveCount(0);

    await layer(page)
      .getByRole('button', { name: /show advanced/i })
      .click();

    await expect(list).toBeVisible();
    // The package's own five facts, not a summary of them.
    await expect(list.getByText(/entries\[0\]/).first()).toBeVisible();
  });

  test('names the exact hull the Almanac does not carry', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JSON.stringify({ event: 'Loadout', Ship: 'Nonexistent_Hull', Modules: [] }));
    await submit(page);

    await expect(layer(page).getByText(/Nonexistent_Hull/)).toBeVisible();
  });

  test('keeps the exact draft through every refusal', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    const draft = '  { not json  ';
    await paste(page, draft);
    await submit(page);

    await expect(layer(page).getByLabel(/slef payload/i)).toHaveValue(draft);
  });

  test('leaves the open build byte-identical when it refuses', async ({ page }) => {
    await withStockBuild(page);
    const before = await page.evaluate(() => location.hash);

    await openImport(page);
    await paste(page, '[]');
    await submit(page);
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(before);
  });

  test('replaces unsaved work without asking, and spends the draft doing it', async ({ page }) => {
    // Withdrawn on 2026-08-25: no question stands between the draft and the
    // build. Work carrying a decision is in a record of its own, and work still
    // at the package default is stored nowhere, so neither has anything to warn
    // about (feature 001, FR-008; 024/FR-001). Neither is read here: what this
    // asserts is that no question is asked, and that the draft is spent only by
    // the commit. What a build at the package default stores is read by the
    // import case above.
    await withStockBuild(page);
    const before = await page.evaluate(() => location.hash);

    await openImport(page);
    await paste(page, JOURNAL_EVENT);
    await submit(page);

    await expect(page.getByRole('dialog', { name: /replace/i })).toHaveCount(0);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    // The canonical link is republished by an effect after the build commits,
    // not by the commit itself, so the first slot can be on screen a frame
    // before the fragment catches up. Read until it does rather than once.
    await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(before);
  });
});

test.describe('the layer itself', () => {
  test('is a named modal dialog with no accessibility violations', async ({ page }, testInfo) => {
    await page.goto('/ships');
    await openImport(page);

    await expectNoAccessibilityViolations(page, testInfo);
    await expectNoDocumentOverflow(page);
  });

  test('holds its refusal and its diagnostics without widening the page', async ({
    page,
  }, testInfo) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JSON.stringify([{ header: {}, data: {} }]));
    await submit(page);

    await expectNoDocumentOverflow(page);
    await expectNoAccessibilityViolations(page, testInfo);
  });
});

test.describe('the network', () => {
  test('sends nothing anywhere while a build is imported', async ({ page }) => {
    await page.goto('/ships');
    const origin = new URL(page.url()).origin;
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) {
        foreign.push(request.url());
      }
    });

    await openImport(page);
    await paste(page, JOURNAL_EVENT);
    await submit(page);
    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    expect(foreign).toEqual([]);
  });
});

test.describe('the layer’s semantics', () => {
  test('names and describes itself, and makes the page behind it inert', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);

    const dialog = layer(page);
    await expect(dialog).toHaveJSProperty('open', true);
    // The native element, so the inertness is the browser's rather than an
    // attribute the application manages and could get wrong.
    await expect(dialog).toHaveJSProperty('nodeName', 'DIALOG');
    await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();

    // Modal in the browser's own sense, which is what makes the page behind it
    // inert without the application managing an attribute it could get wrong.
    expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
  });

  test('labels the payload field visibly and associates its refusal with it', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    const field = layer(page).getByLabel(/slef payload/i);
    await expect(field).toBeVisible();

    await paste(page, '{ not json');
    await submit(page);

    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await field.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const described = page.locator(
      (describedBy ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => `#${id}`)
        .join(', '),
    );
    await expect(described.filter({ hasText: /json/i }).first()).toBeVisible();
  });

  test('says nothing on its one line until something has happened', async ({ page }) => {
    // Narrowed 2026-08-26 (Commander request). The line used to draw the
    // canvas's `AWAITING INPUT` and then the draft's size in bytes. Neither is
    // a state worth a line of a layer: the first names an empty field a
    // Commander is looking at, and the second is a fact about a transport
    // rather than about a build.
    await page.goto('/ships');
    await openImport(page);
    const status = layer(page).locator('p[data-bidi-isolate]').first();

    await expect(status).toHaveText('');

    await paste(page, JOURNAL_EVENT);

    await expect(status).toHaveText('');

    // Nor after a refusal: that is said by the field the payload is in, and
    // saying it here as well would be the same fact twice on one screen.
    await paste(page, '{');
    await submit(page);
    await expect(status).toHaveText('');
    await expect(
      layer(page)
        .getByText(/could not be read|refused|invalid/i)
        .first(),
    ).toBeVisible();
  });

  test('gives every diagnostic its five facts, each labelled', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await paste(page, JSON.stringify([{ header: {}, data: {} }]));
    await submit(page);

    await layer(page)
      .getByRole('button', { name: /show advanced/i })
      .click();

    const list = layer(page)
      .getByRole('list', { name: /refused/i })
      .first();
    await expect(list).toBeVisible();
    const entry = list.getByRole('listitem').first();
    for (const label of [/^entry$/i, /^property$/i, /^code$/i, /^constraint$/i, /^reason$/i]) {
      await expect(entry.getByText(label).first()).toBeVisible();
    }
  });

  test('announces the result once, politely, and never the payload', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    // Recorded as the outlet changes, because the workspace announces things of
    // its own once the build lands and the outlet holds only the latest.
    await page.evaluate(() => {
      const outlet = document.querySelector('[data-announcement-outlet="polite"]');
      const seen: string[] = [];
      (window as unknown as { __announced: string[] }).__announced = seen;
      new MutationObserver(() => seen.push(outlet?.textContent?.trim() ?? '')).observe(
        outlet as Node,
        { childList: true, characterData: true, subtree: true },
      );
    });

    await paste(page, JOURNAL_EVENT);
    await submit(page);
    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    const announced = await page.evaluate(
      () => (window as unknown as { __announced: string[] }).__announced,
    );
    const imported = announced.filter((text) => /anaconda imported/i.test(text));
    expect(imported.length).toBeGreaterThan(0);
    // Bounded: the outlet never carries the payload or a diagnostic list.
    expect(announced.join(' ')).not.toContain('Modules');
    // One import, one sentence: this journey commits once, so the outlet
    // carries that outcome once.
    expect(new Set(imported).size).toBe(1);
  });

  test('keeps technical strings in their own direction under a right-to-left page', async ({
    page,
  }) => {
    await page.goto('/ships');
    await openImport(page);
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await paste(page, JSON.stringify([{ header: {}, data: {} }]));
    await submit(page);

    // A JSON path that reordered under RTL would point somewhere else.
    const isolated = layer(page).locator('[data-bidi-isolate]');
    expect(await isolated.count()).toBeGreaterThan(0);
    await expectNoDocumentOverflow(page);

    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
  });

  test('stays readable at doubled text size, with nothing cut off', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await paste(page, JSON.stringify([{ header: {}, data: {} }]));
    await submit(page);

    await expect(layer(page).getByRole('button', { name: /^load build$/i })).toBeVisible();
    await expect(layer(page).getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  test('gives its actions the baseline target size', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);

    for (const name of [/^load build$/i, /^cancel$/i]) {
      const box = await layer(page).getByRole('button', { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('what is never trusted', () => {
  test('renders a producer’s own text as text, never as markup', async ({ page }) => {
    await page.goto('/ships');
    await openImport(page);
    const hostile = '<img src=x onerror="window.__pwned = true">';
    await paste(
      page,
      JSON.stringify([
        { header: { appName: hostile, appVersion: hostile }, data: JSON.parse(JOURNAL_EVENT) },
      ]),
    );
    await submit(page);
    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    expect(await page.evaluate(() => '__pwned' in window)).toBe(false);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });

  test('never follows a URL the payload named', async ({ page }) => {
    await page.goto('/ships');
    const origin = new URL(page.url()).origin;
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) {
        foreign.push(request.url());
      }
    });

    await openImport(page);
    await paste(
      page,
      JSON.stringify([
        {
          header: {
            appName: 'EDSY',
            appVersion: '2.0',
            appURL: 'https://elsewhere.test/outfitting',
          },
          data: JSON.parse(JOURNAL_EVENT),
        },
      ]),
    );
    await submit(page);
    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    expect(foreign).toEqual([]);
    await expect(page.getByRole('link', { name: /elsewhere/i })).toHaveCount(0);
  });
});
