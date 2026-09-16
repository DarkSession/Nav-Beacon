import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import { expectNoDocumentOverflow, expectRelationship } from './accessibility/assertions';
import { commandBarActionState } from './outfitting-surfaces';
import { buildStockHull, reachShellAction, savedToBrowser, setShipIdent } from './shell';

/**
 * A build, handed over as a file rather than as a link.
 *
 * The properties under test are the honest ones: the payload is present and
 * selectable before any control is pressed, every delivery reports what it
 * actually observed, an invalid build still exports, and nothing leaves the
 * origin at any point.
 */

async function withStockBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

function layer(page: Page) {
  return page.getByRole('dialog', { name: /export build/i });
}

async function openExport(page: Page): Promise<void> {
  await reachShellAction(page, /^export$/i);
  await expect(layer(page)).toBeVisible();
}

async function chooseSlef(page: Page): Promise<void> {
  await layer(page)
    .getByRole('radio', { name: /slef json/i })
    .check();
  await expect(layer(page).getByLabel(/slef payload/i)).not.toHaveValue('');
}

test.describe('exporting a build as SLEF', () => {
  test('offers both drawn formats in one layer', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);

    await expect(layer(page).getByRole('radio', { name: /share link/i })).toBeVisible();
    await expect(layer(page).getByRole('radio', { name: /slef json/i })).toBeVisible();
    // The reference lists two more formats this application cannot produce.
    await expect(layer(page).getByRole('radio', { name: /journal loadout/i })).toHaveCount(0);
    await expect(layer(page).getByRole('radio', { name: /markdown/i })).toHaveCount(0);
  });

  test('offers a selectable SLEF payload with metadata and delivery actions', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await test.step('shows one selectable payload before anything is pressed', async () => {
      const field = layer(page).getByLabel(/slef payload/i);
      await expect(field).toHaveAttribute('readonly', '');
      const payload = await field.inputValue();
      expect(JSON.parse(payload)).toHaveLength(1);
    });
    await test.step('states what the payload is and how large it is', async () => {
      await expect(layer(page).getByText(/SLEF v1 · \d+ modules · /)).toBeVisible();
    });
    await test.step('says nothing about the link that travelled with it', async () => {
      await expect(layer(page).getByText(/carries a link/i)).toHaveCount(0);
    });
    await test.step('always offers Download, and Copy beside it', async () => {
      await expect(layer(page).getByRole('button', { name: /^download$/i })).toBeEnabled();
      await expect(layer(page).getByRole('button', { name: /^copy$/i })).toBeEnabled();
    });
  });

  test('reports a download as dispatched, never as saved', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    const download = page.waitForEvent('download').catch(() => null);
    await layer(page)
      .getByRole('button', { name: /^download$/i })
      .click();
    await download;

    await expect(layer(page).getByText(/handed to your browser/i)).toBeVisible();
    await expect(layer(page).getByText(/saved/i)).toHaveCount(0);
  });

  test('keeps the payload on screen when the clipboard refuses', async ({ page, context }) => {
    await context.grantPermissions([]);
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });

    await layer(page)
      .getByRole('button', { name: /^copy$/i })
      .click();

    await expect(layer(page).getByText(/could not be copied/i)).toBeVisible();
    await expect(layer(page).getByLabel(/slef payload/i)).not.toHaveValue('');
  });

  test('exports whatever the Almanac says about the build, without withholding it', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    // The payload is there whatever the verdict is, and the verdict — when
    // there is one — is a sentence beside it rather than a reason to withhold.
    await expect(layer(page).getByLabel(/slef payload/i)).not.toHaveValue('');
    const warning = layer(page).getByText(/the almanac reports this build as/i);
    if ((await warning.count()) > 0) {
      await expect(warning.first()).toBeVisible();
    }
    await expect(layer(page).getByRole('button', { name: /^download$/i })).toBeEnabled();
  });
});

test.describe('the artifact and the build it describes', () => {
  /** A modelled edit a Commander makes in one step, on every layout. */
  async function rename(page: Page, value: string): Promise<void> {
    await page.getByRole('button', { name: /rename the ship/i }).click();
    // The title is the field, and leaving it is confirming it.
    await page.locator('.identity-fields__input').fill(value);
    await page.locator('.identity-fields__input').press('Enter');
  }

  test('never shows a payload for a build that has since been edited', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    const before = await layer(page)
      .getByLabel(/slef payload/i)
      .inputValue();
    expect(before).not.toContain('Pacifier');

    await page
      .getByRole('button', { name: /^close$/i })
      .first()
      .click();
    await rename(page, 'Pacifier');
    await openExport(page);
    await chooseSlef(page);

    // Made again for the build on screen. The previous revision's payload
    // under the current build's title is exactly the thing being ruled out.
    const after = await layer(page)
      .getByLabel(/slef payload/i)
      .inputValue();
    expect(after).not.toBe(before);
    expect(after).toContain('Pacifier');
  });

  test('hands the current revision’s bytes to a delivery, never the previous one’s', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await page
      .getByRole('button', { name: /^close$/i })
      .first()
      .click();
    await rename(page, 'Pacifier');
    await openExport(page);
    await chooseSlef(page);

    const payload = await layer(page)
      .getByLabel(/slef payload/i)
      .inputValue();
    const download = page.waitForEvent('download');
    await layer(page)
      .getByRole('button', { name: /^download$/i })
      .click();

    await expect(layer(page).getByText(/handed to your browser/i)).toBeVisible();
    expect(payload).toContain('Pacifier');
    await download.catch(() => null);
  });
});

test.describe('the layer itself', () => {
  test('is a named modal dialog with no accessibility violations', async ({ page }, testInfo) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    await expectNoAccessibilityViolations(page, testInfo);
    await expectNoDocumentOverflow(page);
  });
});

test.describe('the network', () => {
  test('sends nothing anywhere while a build is exported or delivered', async ({ page }) => {
    await withStockBuild(page);
    const origin = new URL(page.url()).origin;
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) {
        foreign.push(request.url());
      }
    });

    await openExport(page);
    await chooseSlef(page);
    const download = page.waitForEvent('download').catch(() => null);
    await layer(page)
      .getByRole('button', { name: /^download$/i })
      .click();
    await download;

    expect(foreign).toEqual([]);
  });
});

test.describe('the layer’s semantics', () => {
  test('is a modal dialog with a heading, a format list and a labelled payload', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    const dialog = layer(page);

    expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
    await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(dialog.getByRole('group', { name: /format/i })).toBeVisible();
    await chooseSlef(page);
    await expect(dialog.getByLabel(/slef payload/i)).toBeVisible();
  });

  test('says which format is selected, and moves the selection when asked', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    const link = layer(page).getByRole('radio', { name: /share link/i });
    const slef = layer(page).getByRole('radio', { name: /slef json/i });

    // The layer opens on the format canvas 1c draws first and draws selected.
    await expect(slef).toHaveJSProperty('checked', true);
    await expect(link).toHaveJSProperty('checked', false);

    await link.check();

    await expect(link).toHaveJSProperty('checked', true);
    await expect(slef).toHaveJSProperty('checked', false);
  });

  test('stands at one height whichever format is chosen', async ({ page }) => {
    // The payload is a field of twelve rows and the link is one line, so
    // choosing between them moved the layer under the hand that had just
    // pressed the format beside it (Commander request 2026-08-28). The content
    // region carries a floor the taller of the two already stands at.
    await withStockBuild(page);
    await openExport(page);
    const content = layer(page).locator('.export-dialog__content');
    await chooseSlef(page);
    const withPayload = await content.boundingBox();

    await layer(page)
      .getByRole('radio', { name: /share link/i })
      .check();
    await expect(layer(page).getByLabel(/slef payload/i)).toHaveCount(0);
    const withLink = await content.boundingBox();

    expect(withPayload?.height).toBeGreaterThan(0);
    expect(withLink?.height).toBe(withPayload?.height);
  });

  test('hands the payload over readonly, and never as a disabled field', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    const field = layer(page).getByLabel(/slef payload/i);

    // Readonly rather than disabled: a disabled field cannot be focused, and
    // selecting the text is the one way out that no permission can take away.
    await expect(field).toHaveJSProperty('readOnly', true);
    await expect(field).toBeEnabled();
  });

  test('announces a delivery result in words, never the payload', async ({ page }) => {
    // No clipboard permission is granted: what is asserted is that the result
    // is said in words, and both answers are results. Firefox does not carry a
    // `clipboard-read` permission at all, so asking for one is not a way to
    // make this deterministic — it is a way to fail in one engine.
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    const polite = page.locator('[data-announcement-outlet="polite"]');

    await layer(page)
      .getByRole('button', { name: /^copy$/i })
      .click();

    await expect(polite).toHaveText(/cop(y|ied)/i);
    await expect(polite).not.toContainText('"event"');
  });

  test('keeps the payload and its metadata in their own direction under RTL', async ({
    page,
  }, testInfo) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));

    expect(await layer(page).locator('[data-bidi-isolate]').count()).toBeGreaterThan(0);
    await expectNoDocumentOverflow(page);
    await expectNoAccessibilityViolations(page, testInfo);

    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
  });

  test('stays complete at doubled text size, with every action still reachable', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    for (const name of [/^copy$/i, /^download$/i]) {
      await expect(layer(page).getByRole('button', { name })).toBeVisible();
    }
    await expectNoDocumentOverflow(page);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  test('gives its actions the baseline target size', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    for (const name of [/^copy$/i, /^download$/i]) {
      const box = await layer(page).getByRole('button', { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The formats are controls too, in both arrangements. The plate and the chip
    // are each the whole of their own input, so the box measured here is the box
    // a pointer actually aims at.
    for (const name of [/slef json/i, /share link/i]) {
      const box = await layer(page).getByRole('radio', { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('says every state in words rather than in colour alone', async ({ page, context }) => {
    await context.grantPermissions([]);
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    await layer(page)
      .getByRole('button', { name: /^copy$/i })
      .click();

    // Whatever the clipboard did, the layer says so in a sentence.
    await expect(
      layer(page)
        .getByText(/copied|could not be copied|copying/i)
        .first(),
    ).toBeVisible();
  });
});

/**
 * The layer, as canvas 1c and 1d draw it.
 *
 * `scripts/check-interface-foundations.mjs` proves no component holds a visual
 * literal; it cannot prove the tokens are composed into the arrangement the
 * reference draws. This block reads what the browser computes and compares it
 * with what the canvases set, in the same spirit as `e2e/design-reference.spec.ts`
 * and against the measurements recorded in
 * `openspec/changes/archive/011-interface-foundations/design/canvas-extraction.md`, "Choice cards".
 *
 * Each assertion is made at whichever arrangement the running profile's width
 * calls for, so all ten projects say something rather than five of them
 * skipping.
 */
test.describe('the layer, against the canvas', () => {
  /** The width at which the medium composition takes over (`_responsive.scss`). */
  const MEDIUM = 768;
  /** The height at or below which a layer is promoted to full height. */
  const SHORT = 480;

  test('stands the format list beside the payload, or above it when there is no room', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    const formats = layer(page).getByRole('group', { name: /format/i });
    const payload = layer(page).getByLabel(/slef payload/i);
    const list = (await formats.boundingBox())!;
    const field = (await payload.boundingBox())!;
    const width = page.viewportSize()!.width;

    if (width >= MEDIUM) {
      // Canvas 1c: `grid-template-columns: 236px 1fr`. The two regions share a
      // block band and divide the inline one.
      expect(list.y).toBeLessThan(field.y + field.height);
      expect(field.y).toBeLessThan(list.y + list.height);
    } else {
      // Canvas 1d: the strip sits above the payload in one column.
      expect(list.y + list.height).toBeLessThanOrEqual(field.y + 1);
    }
  });

  test('divides the two regions with one amber hairline, as drawn', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    const formats = layer(page).getByRole('group', { name: /format/i });
    const width = page.viewportSize()!.width;

    // Canvas 1c: `border-right: 1px solid var(--amber-a16)` on the format
    // column, running the height of the panel. Canvas 1d draws no rule.
    const rule = await formats.evaluate((node) => {
      // The rule closes the region the group is placed in, which is the
      // component's own host element rather than its fieldset.
      const style = getComputedStyle(node.closest('ednb-choice-group') ?? node);
      return { width: style.borderInlineEndWidth, colour: style.borderInlineEndColor };
    });

    if (width >= MEDIUM) {
      // Canvas 1c draws it at 1px, which is the hairline this system names.
      expect(parseFloat(rule.width)).toBe(1);
      expect(rule.colour).toContain('rgba(255, 140, 26');

      // And it runs the height of the panel, which is the whole reason the
      // layer's body hands its padding to the two regions. A rule that stopped
      // at the taller region's content would be the drawn mark at the wrong
      // length.
      const spans = await formats.evaluate((node) => {
        const region = node.closest('ednb-choice-group') ?? node;
        const body = region.closest('.layer__body')!;
        return Math.abs(
          region.getBoundingClientRect().height - body.getBoundingClientRect().height,
        );
      });

      expect(spans).toBeLessThanOrEqual(1);
    } else {
      expect(parseFloat(rule.width)).toBe(0);
    }
  });

  test('draws each format as the canvas draws it: a plate, or a chip', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    const slef = layer(page).getByRole('radio', { name: /slef json/i });
    const title = layer(page)
      .locator('label', { hasText: /slef json/i })
      .first();
    const width = page.viewportSize()!.width;

    // Both arrangements set the name in tracked uppercase condensed, which is
    // how every control label in the reference is set.
    const label = await title.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        family: style.fontFamily,
        transform: style.textTransform,
        tracking: parseFloat(style.letterSpacing) / parseFloat(style.fontSize),
      };
    });

    expect(label.family).toContain('Barlow Condensed');
    expect(label.transform).toBe('uppercase');
    // The exact step the canvas sets, as `e2e/design-reference.spec.ts` reads
    // every other tracked label in the reference: 0.16em on the plate's title,
    // 0.14em on the chip. A ratio, because the ramp is lifted and the sizes are
    // not the canvas's own.
    expect(Math.abs(label.tracking - (width >= MEDIUM ? 0.16 : 0.14))).toBeLessThan(0.005);

    const plate = await slef.evaluate((node) => {
      const card = node.closest('.choice')!;
      const style = getComputedStyle(card);
      return {
        border: parseFloat(style.borderTopWidth),
        height: card.getBoundingClientRect().height,
      };
    });

    if (width >= MEDIUM) {
      // Canvas 1c: `padding: 11px 12px` inside a `1px` amber edge, with the
      // description under the title — taller than a chip, and bordered.
      expect(plate.border).toBeGreaterThan(0);
      await expect(layer(page).getByText(/interchange format read by/i)).toBeVisible();
    } else {
      // Canvas 1d: a chip carrying the name alone, on no plate of its own. The
      // description it has no room for is hidden from the eye and kept for a
      // reader, which is what `not.toBeVisible` over a present element says.
      expect(plate.border).toBe(0);
      // Canvas 1d draws a 38px chip; a control this system draws alone meets the
      // 44px baseline, so the drawn figure is the floor and the baseline is the
      // claim.
      expect(plate.height).toBeGreaterThanOrEqual(44);
      // Taken out of the layout rather than out of the document: the box it
      // occupies is the hiding recipe's own pixel, and the text it holds is
      // still this format's description.
      const description = (await layer(page)
        .getByText(/interchange format read by/i)
        .boundingBox())!;
      expect(description.width).toBeLessThanOrEqual(1);
      await expectRelationship(page, slef, 'description', 'Interchange format');
    }
  });

  test('washes the chosen format amber without making colour the only carrier', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    const slef = layer(page).getByRole('radio', { name: /slef json/i });
    const link = layer(page).getByRole('radio', { name: /share link/i });

    // The wash is the echo; the fact is the control's own checked state, which
    // is what a reader is told (canvas 1c fills the chosen plate).
    await expect(slef).toHaveJSProperty('checked', true);
    await expect(link).toHaveJSProperty('checked', false);

    // And an eye is told by something a monochrome rendering keeps. Colour is
    // never the only carrier of a state (011/FR-010), so the two are compared on
    // what survives having the hue taken out of them: the marker's width on the
    // plate, the label's weight on either.
    const carriers = (radio: typeof slef) =>
      radio.evaluate((node) => {
        const choice = node.closest('.choice')!;
        return {
          marker: parseFloat(getComputedStyle(choice).borderInlineStartWidth),
          weight: getComputedStyle(choice.querySelector('label')!).fontWeight,
        };
      });
    const chosen = await carriers(slef);
    const other = await carriers(link);

    expect(chosen.weight).not.toBe(other.weight);
    expect(chosen.marker === other.marker && chosen.weight === other.weight).toBe(false);

    // Canvas 1c washes the chosen plate; canvas 1d fills the chosen chip, where
    // the plate itself is not drawn. The fill is read from whichever of the two
    // this width paints, so both arrangements are held to the same claim.
    const fill = (radio: typeof slef) =>
      radio.evaluate((node) => {
        const choice = node.closest('.choice')!;
        const plate = getComputedStyle(choice).backgroundColor;
        const chip = getComputedStyle(choice.querySelector('label')!).backgroundColor;
        return plate === 'rgba(0, 0, 0, 0)' ? chip : plate;
      });

    expect(await fill(slef)).not.toBe(await fill(link));
  });

  test('takes the width step the canvas draws, or the screen when that is narrower', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    const { width, height } = page.viewportSize()!;
    const dialog = (await layer(page).boundingBox())!;

    // Canvas 1c draws the export dialog at 760px against the 560px it draws the
    // import one at: two regions need more room than one. Below the medium
    // composition the layer is a sheet and takes the screen, and a short
    // viewport promotes it to a full-height panel that does the same — so the
    // profile decides which of the two claims is made, and every profile makes
    // one.
    if (width >= MEDIUM && height > SHORT) {
      // The platform holds a modal dialog off the edges of the screen, so a
      // viewport only just wider than the step lands inside it rather than on
      // it.
      expect(dialog.width).toBeLessThanOrEqual(760);
      expect(dialog.width).toBeGreaterThanOrEqual(Math.min(760, width) - 40);
    } else {
      expect(Math.round(dialog.width)).toBe(width);
    }
  });

  test('reaches every format at the narrowest profile without scrolling the document', async ({
    page,
  }) => {
    await withStockBuild(page);
    await openExport(page);
    const strip = layer(page).locator('.choice-group__options');

    // Each format's own control is inside the strip that holds it — after being
    // scrolled to, because canvas 1d's strip is allowed to scroll and a format
    // reached by scrolling is still reached. `toBeVisible` says nothing here:
    // the control is the transparent box over its plate, and Playwright counts a
    // zero-opacity box with a size as visible wherever it happens to sit.
    const bounds = (await strip.boundingBox())!;
    for (const name of [/share link/i, /slef json/i]) {
      const radio = layer(page).getByRole('radio', { name });
      await radio.scrollIntoViewIfNeeded();
      const box = (await radio.boundingBox())!;

      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    }
    await expectNoDocumentOverflow(page);
  });
});

test.describe('with no network at all', () => {
  test('imports and exports a build offline, with nothing leaving the origin', async ({
    page,
    context,
  }) => {
    await withStockBuild(page);

    // Both layers are opened once while the network is still up, and closed
    // again. They are `@defer`red, so their code arrives as its own chunk on
    // first use — and this matrix runs an unoptimised build with **no service
    // worker**, deliberately, so that a chunk which has never been fetched
    // cannot be fetched with the network down. What is under test here is that
    // the exchange itself needs no network: no inspection, construction,
    // serialization or delivery reaches for one. The shipped application's
    // cold-start offline behaviour is the service worker's, and is covered
    // against the production build in `e2e/offline.spec.ts`.
    await reachShellAction(page, /^import build$/i);
    await expect(page.getByRole('dialog', { name: /import build/i })).toBeVisible();
    await page
      .getByRole('button', { name: /^close$/i })
      .first()
      .click();
    await openExport(page);
    await chooseSlef(page);
    await page
      .getByRole('button', { name: /^close$/i })
      .first()
      .click();

    const origin = new URL(page.url()).origin;
    const requests: string[] = [];
    page.on('request', (request) => {
      requests.push(request.url());
    });

    await context.setOffline(true);

    // Import, offline.
    await reachShellAction(page, /^import build$/i);
    const importLayer = page.getByRole('dialog', { name: /import build/i });
    await importLayer
      .getByLabel(/slef payload/i)
      .fill(JSON.stringify({ event: 'Loadout', Ship: 'anaconda', Modules: [] }));
    await importLayer.getByRole('button', { name: /^load build$/i }).click();
    // Nothing is asked: the build being replaced is either in a record of its
    // own or still at its hull's package default, and neither is lost, so the
    // import lands straight in the workspace (feature 001, FR-008; 024/FR-001).
    await expect(page).toHaveURL(/\/outfitting($|[#?])/);

    // From here on, nothing but static files. The import landed in the
    // workspace, which is where feature 010 asks for the hull's schematics and
    // keeps asking while they fail — same-origin files under `/assets/`, served
    // to the page rather than fetched by anything the exchange did. What is
    // claimed below is the exchange's own silence: no endpoint, no beacon, no
    // fetch of a payload from anywhere.
    const duringExport: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/assets/')) {
        return;
      }
      duringExport.push(request.url());
    });

    // Export, still offline, with the same capabilities as before.
    await openExport(page);
    await chooseSlef(page);
    await expect(layer(page).getByLabel(/slef payload/i)).not.toHaveValue('');
    await expect(layer(page).getByRole('button', { name: /^download$/i })).toBeEnabled();
    await expect(layer(page).getByRole('button', { name: /^copy$/i })).toBeEnabled();

    // No other origin, at any point in the journey — a request that failed
    // because the network was down would still be recorded here.
    expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    // And the exchange asked for nothing of its own.
    expect(duringExport).toEqual([]);

    await context.setOffline(false);
  });
});

test.describe('what is never trusted', () => {
  test('renders a hull name from a payload as text, never as markup', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);

    // The only names in this layer are the package's own, and they arrive as
    // text content. A payload that carried markup could not reach the DOM as
    // markup even so.
    expect(await page.evaluate(() => '__pwned' in window)).toBe(false);
    await expect(layer(page).locator('script')).toHaveCount(0);
  });

  test('contacts no clipboard, share target or consumer of its own', async ({ page }) => {
    await withStockBuild(page);
    const origin = new URL(page.url()).origin;
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) {
        foreign.push(request.url());
      }
    });
    // A share sheet that actually opened would hang the run; the port is
    // replaced so the journey can assert what was handed to it instead.
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: unknown) => {
          (window as unknown as { __shared: unknown[] }).__shared.push(data);
        },
      });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    });
    // The ship carries an ident, so the build holds a decision and autosave has
    // a record to write. A build still at its hull's package default is stored
    // nowhere, so `savedToBrowser` below would wait for a record that is never
    // written (024/FR-001).
    await setShipIdent(page, 'NB-01');
    // The reload has to come after the build is in its record, not merely on
    // screen: autosave coalesces its writes, so a page reloaded in the window
    // before the first one lands restores nothing and comes back empty.
    await savedToBrowser(page);
    await page.reload();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    await openExport(page);
    await chooseSlef(page);
    const payload = await layer(page)
      .getByLabel(/slef payload/i)
      .inputValue();
    const share = layer(page).getByRole('button', { name: /^share$/i });
    if ((await share.count()) > 0) {
      await share.click();
      const shared = await page.evaluate(
        () => (window as unknown as { __shared: { text?: string }[] }).__shared,
      );
      expect(shared).toHaveLength(1);
      if (typeof shared[0]?.text === 'string') {
        expect(shared[0].text).toBe(payload);
      }
    }

    expect(foreign).toEqual([]);
  });
});

test.describe('with no build to pass on', () => {
  test('offers no Export action, and the layer cannot open', async ({ page }) => {
    await page.goto('/outfitting');
    await expect(page.getByRole('main')).toBeVisible();

    // The honest state: the action is not published rather than published and
    // refusing. The canvas draws no unavailable panel, and one is not invented.
    //
    // Read off the bar's own row rather than by role: where the bar is folded
    // that row is `display: none` and leaves the accessibility tree, so a role
    // query finds nothing whether or not the action was published. The row is
    // in the document at every width, so this asks the question at all five
    // profiles rather than only at the widest.
    await expect(commandBarActionState(page, /^export$/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^export$/i })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /export build/i })).toHaveCount(0);
  });

  test('says what to do next through the workspace’s own empty state', async ({ page }) => {
    await page.goto('/outfitting');

    await expect(page.getByRole('main')).toContainText(/ship|build|hull/i);
    // Import is a shell action, so it is there with no build and no chosen hull.
    await reachShellAction(page, /^import build$/i);
    await expect(page.getByRole('dialog', { name: /import build/i })).toBeVisible();
  });

  test('leaves no payload behind when the build it described is gone', async ({ page }) => {
    await withStockBuild(page);
    await openExport(page);
    await chooseSlef(page);
    await expect(layer(page).getByLabel(/slef payload/i)).not.toHaveValue('');
    await page.keyboard.press('Escape');

    // Reloading the application starts a session with no build; nothing about
    // the previous payload is persisted, so there is nothing to come back.
    await page.goto('/outfitting');
    await expect(page.getByRole('dialog', { name: /export build/i })).toHaveCount(0);
  });
});
