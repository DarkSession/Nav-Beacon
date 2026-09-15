import { expect, test, type Page, type TestInfo } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { everyPublishedSlotKey, sweepOutfittingState } from './accessibility';
import {
  expectEquivalentControls,
  expectNoDocumentOverflow,
  settled,
} from './accessibility/assertions';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import { openChooser, revealMount } from './outfitting-surfaces';
import { buildStockHull, regroupCoreMount } from './shell';

/**
 * Hull anatomy, end to end.
 *
 * The unit suites already prove what the projection admits and what the parser
 * refuses. What only a browser can show is the rest: that the package's own
 * geometry actually renders, that a mount drawn ten pixels across is still a
 * target a thumb can hit, that selecting one reaches the ledger and back, and
 * that a plate which cannot load takes nothing else on the screen with it.
 */

const HULL = 'Anaconda';

/** A hull the package draws the same mount on both sides of. */
const REPEATED = { hull: 'Federation_Corvette', slot: 'MediumHardpoint1' } as const;

async function openStockBuild(
  page: Page,
  hull: string = HULL,
  messages: Record<string, string> = englishMessages,
): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, messages['hullDetail.create']);
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
}

/** Every mount control the plates currently draw, on whichever sides are shown. */
function mounts(page: Page) {
  return page.locator('ednb-hull-anatomy .schematic__mount:visible');
}

/** The text of the polite outlet, which is where a side change is announced. */
async function politeText(page: Page): Promise<string> {
  return (await page.locator('[data-announcement-outlet="polite"]').textContent()) ?? '';
}

/** No plate scrolls: the whole document is in view, at the document's own ratio. */
async function expectNoPlateScrolling(page: Page): Promise<void> {
  const overflowing = await page
    .locator('ednb-hull-anatomy .schematic')
    .evaluateAll(
      (nodes) =>
        nodes.filter(
          (node) =>
            node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
        ).length,
    );
  expect(overflowing).toBe(0);
}

/**
 * What the plate pair has to work with, read from the page itself.
 *
 * Two facts, not three, because the workspace already publishes two of the
 * pair's conditions as one: `data-composition` is anything but `compact` where
 * the region has the inline size for a ledger beside a bench **and** the window
 * is tall enough to stack anything at all, which is the same pair of facts the
 * stylesheet asks as `outfitting-regions` and `not-short-viewport`
 * (`ui/outfitting/composition.ts`, `observeComposition`). Reading it is what the
 * workspace publishes it for — "the one thing about that decision a test can
 * read without measuring pixels and re-deriving the rule it is checking"
 * (`outfitting-workspace.html`).
 *
 * Only the block's own room is measured, because nothing publishes it.
 */
async function plateRoom(page: Page): Promise<{
  composition: string | null;
  wideEnough: boolean;
}> {
  return page.locator('ednb-hull-anatomy').evaluate((host: HTMLElement) => ({
    composition: host.closest('.outfitting')?.getAttribute('data-composition') ?? null,
    // The root's size now, not 16: `@container anatomy (min-width: 74.075rem)`
    // resolves its `rem` against the root's computed font size, so the step the
    // block is actually held to moves with the reader's text.
    wideEnough:
      host.getBoundingClientRect().width >=
      74.075 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  }));
}

/**
 * How many sides are actually on screen.
 *
 * Counted by what is laid out rather than by the class: the hidden side keeps
 * `anatomy__plate--hidden` and the pair's own query gives it `display: block`
 * again, so the class says which side canvas 1d would drop and not how many are
 * drawn.
 */
function drawnPlates(page: Page): Promise<number> {
  return page
    .locator('ednb-hull-anatomy .anatomy__plate')
    .evaluateAll((plates) => plates.filter((plate) => plate.getClientRects().length > 0).length);
}

test.describe('the plates', () => {
  test('draws package geometry and names hardpoints and utilities', async ({ page }) => {
    await openStockBuild(page);
    await test.step('draw both package schematics from the hull own geometry', async () => {
      const plates = page.locator('ednb-hull-anatomy .schematic[data-state="ready"]');
      await expect(plates.first()).toBeVisible();

      // Canvas 1c lays the hull on its side in a frame of the hull's own shape.
      // The package draws every hull nose-up, so the frame is wider than it is
      // tall and the drawing is turned once to match — one transform over the
      // package's own paths, which are written out unchanged.
      const drawing = page.locator('ednb-hull-anatomy .schematic__drawing').first();
      const viewBox = (await drawing.getAttribute('viewBox')) ?? '';
      const [, , width, height] = viewBox.split(' ').map(Number);
      expect(width / height).toBeCloseTo(720 / 292, 2);
      await expect(drawing.locator('.schematic__artwork')).toHaveAttribute(
        'transform',
        /^translate\(-?[\d.]+ -?[\d.]+\) rotate\(-90\)$/,
      );

      // The picture is the package's own document, rasterised, drawn inside that
      // same turned group and at the `viewBox` the extract carries. Both halves
      // were made from one SVG at build time, which is why they line up.
      for (const side of ['top', 'bottom']) {
        await expect(
          page.locator(
            `ednb-hull-anatomy .schematic[data-side="${side}"] .schematic__artwork image`,
          ),
        ).toHaveAttribute('href', `assets/ships/${HULL}/schematic-${side}.png`);
      }
    });
    await test.step('name every mount with its slot, kind, side and state', async () => {
      await expect(mounts(page).first()).toBeVisible();

      const name = await mounts(page).first().getAttribute('aria-label');
      // Named the way the ledger row names it, not by the package's slot key.
      expect(name).toMatch(/Hardpoint \d/);
      expect(name).not.toMatch(/[A-Za-z]Hardpoint\d/);
      expect(name).toMatch(/hardpoint|utility mount/);
      expect(name).toMatch(/Top|Bottom/);
      expect(name).toMatch(/fitted|empty/);
      expect(name).toMatch(/engineered|stock/);
    });
    await test.step('present a utility as a utility, never as a hardpoint', async () => {
      await expect(mounts(page).first()).toBeVisible();

      const utilities = page.locator(
        'ednb-hull-anatomy .schematic__mount[data-kind="utility"]:visible',
      );
      expect(await utilities.count()).toBeGreaterThan(0);
      expect(await utilities.first().getAttribute('aria-label')).toContain('utility mount');
    });
  });

  test('limits schematic content to located mounts and the declared legend', async ({ page }) => {
    await openStockBuild(page);
    await test.step('give no geometry to a core, optional, armour or cargo-hatch slot', async () => {
      await expect(mounts(page).first()).toBeVisible();

      const keys = await mounts(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-slot') ?? ''),
      );
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => /Hardpoint\d+$/u.test(key))).toBe(true);
    });
    await test.step('publish no provenance control of their own', async () => {
      await expect(mounts(page).first()).toBeVisible();

      // Neither canvas draws a provenance or help control on the anatomy panel;
      // canvas 1d draws `HELP & FAQ` once, in the application menu, and that is
      // feature 012's. The only controls in the region are the mounts, the mode
      // strip, the side selector and a retry on a plate that did not arrive
      // (FR-011).
      const controls = page.locator(
        'ednb-hull-anatomy a, ednb-hull-anatomy button, ednb-hull-anatomy [role="button"], ednb-hull-anatomy [role="link"]',
      );
      const names = await controls.evaluateAll((nodes) =>
        nodes
          .filter((node) => !node.classList.contains('schematic__mount'))
          .map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()),
      );

      expect(
        names.every((name) =>
          /^(top|bottom|try again|mounts|power|drives|defence|offence|status)$/i.test(name),
        ),
      ).toBe(true);
      expect(await page.locator('ednb-hull-anatomy a[href]').count()).toBe(0);
    });
    await test.step('draw the legend the reference draws, and only that', async () => {
      const entries = page.locator('ednb-hull-anatomy .anatomy__legend-entry');
      await expect(entries).toHaveText([
        /Selected/i,
        /Fitted/i,
        /Empty/i,
        /Utility/i,
        /Engineered/i,
      ]);
    });
  });
});

test.describe('moving between geometry and the ledger', () => {
  test('selecting a mount reaches its exact slot, in one interaction', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const mount = mounts(page).first();
    const key = await mount.getAttribute('data-slot');
    await mount.click();

    await expect(mount).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`ednb-slot-card [data-slot-key="${key}"]`)).toHaveAttribute(
      'data-selected',
      'true',
    );
    expect(page.url()).not.toContain(key ?? '');
  });

  test('selecting a slot in the ledger marks it on the plates', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const key = await mounts(page).nth(1).getAttribute('data-slot');
    await page.locator(`ednb-slot-card [data-slot-key="${key}"] .slot__select`).first().click();

    await expect(
      page.locator(`ednb-hull-anatomy .schematic__mount[data-slot="${key}"]`).first(),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('a mount drawn on both sides stays one identity in the same state', async ({ page }) => {
    await openStockBuild(page, REPEATED.hull);
    const drawings = page.locator(
      `ednb-hull-anatomy .schematic__mount[data-slot="${REPEATED.slot}"]`,
    );
    await expect(drawings).toHaveCount(2);

    await drawings.first().click();

    // Both, not just the one that was pressed: two drawings of one mount are
    // one build identity, so the second is marked by the same selection.
    await expect(drawings.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(drawings.nth(1)).toHaveAttribute('aria-pressed', 'true');
  });

  test('selecting an internal slot marks nothing on the plates', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // At compact width the core mounts are a category the ledger is not opened
    // on, so the row is pressed into view before it is pressed.
    await revealMount(page, 'PowerPlant');
    await page.locator('ednb-slot-card [data-slot-key="PowerPlant"] .slot__select').first().click();

    await expect(
      page.locator('ednb-hull-anatomy .schematic__mount[aria-pressed="true"]'),
    ).toHaveCount(0);
  });

  test('neither the fragment, the stored build nor the shown side is recorded', async ({
    page,
  }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();
    // Feature 004 publishes the build's fragment and feature 001 writes its
    // working record a moment after the build opens. Both are waited for, so
    // what is compared below is what selection did and not a race with two
    // publishers this feature does not own.
    await expect(page).toHaveURL(/#b\./);
    // One decision on the build, so autosave has a record to write. A build
    // still at its hull's package default is stored nowhere (024/FR-001).
    await regroupCoreMount(page);
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).length))
      .toBeGreaterThan(0);
    const url = page.url();
    const stored = await page.evaluate(() => JSON.stringify(localStorage));

    await mounts(page).first().click();
    await mounts(page).nth(1).click();
    const sides = page.locator('ednb-hull-anatomy .anatomy__sides button');
    if (await sides.first().isVisible()) {
      await sides.nth(1).click();
    }

    // Looking is free: no fragment, no revision, nothing written down. The side
    // a Commander is looking at is not part of their build either (FR-004 of
    // feature 004, and this feature's privacy assertions).
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(stored);
    for (const marker of ['schematic', 'anatomy', 'visibleSide', 'selectedSlot']) {
      expect(stored).not.toContain(marker);
    }
  });
});

test.describe('when a schematic does not arrive', () => {
  test('says so and leaves the ledger and the editor whole', async ({ page }) => {
    await page.route('**/assets/ships/**/schematic-bottom.json', (route) => route.abort());
    await openStockBuild(page);

    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="temporarilyUnavailable"]'),
    ).toHaveCount(1);
    await expect(page.locator('ednb-slot-card').first()).toBeVisible();
    // The peer side is unaffected.
    await expect(page.locator('ednb-hull-anatomy .schematic[data-state="ready"]')).toHaveCount(1);
  });

  test('states a document that is not this build own as a defect rather than drawing it', async ({
    page,
  }) => {
    // The package contract is checked where the extract is made, so what can
    // still arrive wrong here is a deployment serving something else. Retrying
    // does not fix that, and it is not stated as though it might.
    await page.route('**/assets/ships/**/schematic-top.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ symbol: 'Anaconda', side: 'top', mounts: 'all of them' }),
      }),
    );
    await openStockBuild(page);

    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="contractDefect"]'),
    ).toHaveCount(1);
    await expect(page.locator('ednb-slot-card').first()).toBeVisible();
  });

  test('asks again by itself when connectivity returns', async ({ page }) => {
    await page.route('**/assets/ships/**/schematic-*.json', (route) => route.abort());
    await openStockBuild(page);
    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="temporarilyUnavailable"]'),
    ).toHaveCount(2);

    await page.unroute('**/assets/ships/**/schematic-*.json');
    // The browser's own `online` transition, not a reload and not a second
    // press: a Commander who walks back into signal should not have to ask.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator('ednb-hull-anatomy .schematic[data-state="ready"]')).toHaveCount(2);
    await expect(mounts(page).first()).toBeVisible();
  });

  test('does not ask again for a document that arrived wrong', async ({ page }) => {
    await page.route('**/assets/ships/**/schematic-top.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ symbol: 'Anaconda', side: 'top', mounts: 'all of them' }),
      }),
    );
    await openStockBuild(page);
    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="contractDefect"]'),
    ).toHaveCount(1);

    await page.unroute('**/assets/ships/**/schematic-top.json');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // The file arrived and was wrong. Asking for it again returns the same
    // wrong file, so the plate keeps saying what it found, and offers no retry.
    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="contractDefect"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="contractDefect"] ednb-action-button'),
    ).toHaveCount(0);
  });

  test('leaves every slot reachable when neither schematic arrives', async ({ page }) => {
    await page.route('**/assets/ships/**/schematic-*.json', (route) => route.abort());
    await openStockBuild(page);

    await expect(page.locator('ednb-hull-anatomy .schematic__mount')).toHaveCount(0);
    // Reachable, not on screen at once: at compact width the ledger draws one
    // category at a time, so what proves nothing went down with the plates is
    // every category's rows rather than this screenful's.
    expect((await everyPublishedSlotKey(page)).length).toBeGreaterThan(20);
  });
});

test.describe('targets and accessibility', () => {
  test('keeps nearby mounts separately operable', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // Every mount, activated on its own.
    //
    // The Almanac draws real mounts closer together than a mark is wide — the
    // Anaconda's two small hardpoints are six CSS pixels apart on the plate two
    // columns have room for — so marks overlap and a pointer landing between
    // them reaches whichever is in front. Separately operable therefore means
    // from the keyboard, where each mark is its own stop in its own order and
    // nothing can be in front of anything (spec, Edge Cases;
    // design/hull-anatomy.md, "Divergence from FR-012").
    const keys = await mounts(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-slot') ?? ''),
    );
    expect(keys.length).toBeGreaterThan(1);

    for (const key of keys) {
      const mount = page
        .locator(`ednb-hull-anatomy .schematic__mount[data-slot="${key}"]:visible`)
        .first();
      await mount.focus();
      await expect(mount).toBeFocused();
      await mount.press('Enter');
      await expect(mount).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('brings the mount being worked with to the front of the ones it overlaps', async ({
    page,
  }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // A pointer landing on a stack of marks reaches one of them, never none of
    // them, and the one selected is then drawn as the whole square rather than
    // the sliver its neighbour left uncovered.
    const mount = mounts(page).first();
    await mount.click();
    await expect(mount).toHaveAttribute('aria-pressed', 'true');

    const [selected, plain] = await mounts(page).evaluateAll((nodes) => [
      Number(getComputedStyle(nodes[0]).zIndex),
      Number(getComputedStyle(nodes[1]).zIndex),
    ]);
    expect(selected).toBeGreaterThan(plain);
  });

  test('steps overlapping marks apart and ties each back to its own mount', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // The Almanac draws real mounts closer together than a mark is wide, so on
    // a dense hull some marks step aside. Every one that does gets a hairline
    // back to the point the package published — the mark moved, the mount did
    // not (design/hull-anatomy.md, "Marks that would touch").
    for (const side of ['top', 'bottom']) {
      const plate = page.locator(`ednb-hull-anatomy .schematic[data-side="${side}"]`);
      const displaced = await plate.locator('.schematic__mount[data-displaced="true"]').count();
      expect(await plate.locator('.schematic__leader').count()).toBe(displaced);
    }

    // And the Anaconda's underside is a plate that needs it: it puts a utility
    // inside a large hardpoint's floor. Both plates are drawn at every width —
    // the compact arrangement hides one rather than dropping it — so this is
    // the same assertion in all ten projects.
    const bottom = page.locator('ednb-hull-anatomy .schematic[data-side="bottom"]');
    expect(
      await bottom.locator('.schematic__mount[data-displaced="true"]').count(),
    ).toBeGreaterThan(0);
  });

  test('keeps a mark from disappearing under its neighbour at doubled text', async ({ page }) => {
    // Before the first navigation: the scale is applied through an init script,
    // and a scale applied after `goto` never reaches the page at all.
    await withRootTextScale(page, DOUBLED_TEXT);
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();
    await settled(page);

    // The regression this exists for, and the limit of what it can promise.
    //
    // Separation used to be a fixed share of the plate, but a mark is
    // `clamp(0.875rem, 3.06cqw, 1.375rem)` — its floor is an absolute length,
    // so at doubled text a mark keeps its pixels while the plate loses them and
    // its share of the frame grows. A constant therefore believed marks were
    // further apart than they were drawn. The plate measures both now.
    //
    // What that cannot buy is full separation at every size: at 200% text on a
    // phone the Anaconda's underside is eight 28px marks on a 228px plate, and
    // no arrangement that keeps a mark near its own mount separates them all.
    // What it does buy is that no mark is *lost* — every square keeps more than
    // half of itself uncovered, so its number can be read and its own edge
    // found (design/hull-anatomy.md, "Marks that would touch").
    const sides = page.locator('ednb-hull-anatomy .anatomy__sides button');
    const selectable = await sides.first().isVisible();

    for (const [index, side] of ['top', 'bottom'].entries()) {
      if (selectable) {
        await sides.nth(index).click();
        await settled(page);
      }

      // Polled, because a plate that has just become visible measures itself a
      // frame later: its frame goes from nothing to its real width, the
      // observer reports, and the marks settle into the separation that width
      // asks for. Reading once can catch the arrangement before that lands.
      await expect
        .poll(
          () =>
            page
              .locator(`ednb-hull-anatomy .schematic[data-side="${side}"] .schematic__mount`)
              .evaluateAll((nodes) => {
                const boxes = nodes
                  .map((node) => node.getBoundingClientRect())
                  .filter((box) => box.width > 0);
                let pairs = 0;
                for (let i = 0; i < boxes.length; i += 1) {
                  for (let j = i + 1; j < boxes.length; j += 1) {
                    const a = boxes[i];
                    const b = boxes[j];
                    const uncovered =
                      Math.abs(a.left - b.left) >= a.width / 2 ||
                      Math.abs(a.top - b.top) >= a.height / 2;
                    if (!uncovered) {
                      pairs += 1;
                    }
                  }
                }
                return pairs;
              }),
          { message: `${side} plate at ${DOUBLED_TEXT}% text` },
        )
        .toBe(0);
    }
  });

  test('draws a selected utility in the utility hue, not the hardpoint one', async ({ page }) => {
    // Motion off before anything renders, because the mark's fill is a
    // transition and this test reads colours. Without it the read races the
    // transition and returns the colour the mark was *leaving* — which is the
    // same unselected fill for both kinds, so the two compare equal and the
    // test fails for a reason that has nothing to do with the hue. The plate
    // drops the transition entirely under `prefers-reduced-motion`, so this is
    // the product's own honest no-motion path rather than a test-only hack.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    /** One mount's settled fill, as three channels. */
    const fillOf = async (mount: ReturnType<typeof mounts>): Promise<number[]> => {
      await mount.click();
      await expect(mount).toHaveAttribute('aria-pressed', 'true');
      // Polled rather than read once: `aria-pressed` is set by the same change
      // detection pass that sets the class, but the paint that follows it is
      // the browser's own business.
      let channels: number[] = [];
      await expect
        .poll(async () => {
          const fill = await mount.evaluate((node) => getComputedStyle(node).backgroundColor);
          channels = (fill.match(/\d+/gu) ?? []).slice(0, 3).map(Number);
          return channels.length === 3 && channels.some((channel) => channel > 32);
        })
        .toBe(true);
      return channels;
    };

    // The fill says *selected* and the hue says *which kind*, so the two are
    // told apart by being warm or cool rather than merely by being different —
    // a regression that turned a selected utility green would pass an
    // inequality and fail this.
    const utility = await fillOf(
      page.locator('ednb-hull-anatomy .schematic__mount[data-kind="utility"]:visible').first(),
    );
    expect(utility[2]).toBeGreaterThan(utility[0]);

    const hardpoint = await fillOf(
      page.locator('ednb-hull-anatomy .schematic__mount[data-kind="hardpoint"]:visible').first(),
    );
    expect(hardpoint[0]).toBeGreaterThan(hardpoint[2]);

    // And selection is still a fill, not only a hue: an unselected mount sits on
    // the plate's own sunken ground, which neither of these is.
    const unselected = await page
      .locator('ednb-hull-anatomy .schematic__mount[aria-pressed="false"]:visible')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(unselected).not.toBe(`rgb(${utility.join(', ')})`);
    expect(unselected).not.toBe(`rgb(${hardpoint.join(', ')})`);
  });

  test('offers every drawn mount at the full baseline in the ledger', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // What lets the mounts take SC 2.5.8's Equivalent exception at all: the
    // same function, on the same screen, at the size the criterion asks for.
    await expectEquivalentControls(page);
  });

  test('the capability passes an accessibility scan', async ({ page }, testInfo: TestInfo) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    await sweepOutfittingState(page, testInfo, 'build/hull-anatomy');
  });
});

test.describe('what is fetched', () => {
  test('asks for the active hull two schematics, once each, and no others', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/assets/ships/') && request.url().endsWith('.json')) {
        asked.push(new URL(request.url()).pathname);
      }
    });

    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // Two extracts, for the hull that is open. The package ships ninety-six
    // schematics, and asking for a hull nobody opened is work nobody wanted.
    expect(asked.sort()).toEqual([
      `/assets/ships/${HULL}/schematic-bottom.json`,
      `/assets/ships/${HULL}/schematic-top.json`,
    ]);
  });

  test('asks again for nothing when the build is edited', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();
    // Every plate, and every plate's picture. A side is two fetches, and where
    // two plates are drawn the first one's marks appear while the second one's
    // extract is still on its way — so a listener installed on the marks alone
    // records the second picture's *first* request as a re-request.
    await page.waitForLoadState('networkidle');

    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/assets/ships/')) {
        asked.push(request.url());
      }
    });

    // Emptying a fitted mount: the same hull, a new build revision, and the
    // same two documents, which are about the hull rather than the build.
    const key = await page
      .locator('.schematic__mount[data-fitted="true"]')
      .first()
      .getAttribute('data-slot');
    await page.locator(`[data-slot-key="${key}"] button`).first().click();
    // `REMOVE MODULE` lives on the fitting panel's head, which is a layer at a
    // compact width and inline at a wide one (`e2e/outfitting-surfaces.ts`).
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await settled(page);

    await expect(page.locator(`.schematic__mount[data-slot="${key}"]`).first()).toHaveAttribute(
      'data-fitted',
      'false',
    );
    expect(asked).toEqual([]);
  });
});

test.describe('the conditions that break layouts', () => {
  test('holds the whole hull in view at doubled text', async ({ page }) => {
    await withRootTextScale(page, DOUBLED_TEXT);
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // The plate holds its document at the document's own ratio, so there is
    // nothing to pan and nothing to cut off — at any text size.
    await expectNoDocumentOverflow(page);
    await expectNoPlateScrolling(page);

    // And one plate, in every profile: the workspace's seam is 47rem, which
    // doubled text makes 1504px — wider than the 1440px of the widest window
    // the matrix runs (`playwright.config.ts`). So every profile folds to a
    // single flow here, and a single flow is canvas 1d's block whatever the
    // window measures.
    //
    // Asserted here rather than beside the other layout tests because this is
    // where the failing configuration already ran, and passed: asked of the
    // page, the seam held at 1440px at every text size and drew the pair into
    // the middle of that flow (`hull-anatomy.scss`, `layout.outfitting-regions`).
    const room = await plateRoom(page);
    expect(room.composition).toBe('compact');
    expect(await drawnPlates(page)).toBe(1);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toBeVisible();
  });

  test('reflows to one plate at 400% zoom rather than scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // One plate and the selector that chooses it — canvas 1d's arrangement,
    // reached by the space the region was given rather than by a device name.
    await expect(
      page.locator('ednb-hull-anatomy .anatomy__plate:not(.anatomy__plate--hidden)'),
    ).toHaveCount(1);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectNoPlateScrolling(page);
  });

  test('draws the pair only where the arrangement and the room both allow it', async ({ page }) => {
    // The pair needs an arrangement of more than one region and the inline size
    // for two plates, and neither implies the other (Commander requests
    // 2026-08-30 and 2026-08-31). A landscape phone has the width and is a
    // single flow because it is too short to stack anything; a 744px portrait
    // window is a single flow for its width alone and still hands this block
    // 744px of container, two pixels more than the 742px centre column the
    // desktop the pair belongs on draws it inside (`design/hull-anatomy.md`,
    // "Intermediate tablet").
    //
    // Asserted at whatever this profile is, in both directions, so a regression
    // to either half fails here rather than passing quietly.
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const room = await plateRoom(page);
    const drawn = await drawnPlates(page);
    const selector = page.locator('ednb-hull-anatomy .anatomy__sides');

    if (room.composition !== 'compact' && room.wideEnough) {
      // Both sides are drawn, so there is nothing for the selector to choose.
      expect(drawn).toBe(2);
      await expect(selector).toBeHidden();
      return;
    }

    // Either half missing is canvas 1d's block: one labelled side, and the
    // selector that reaches the other.
    expect(drawn).toBe(1);
    await expect(selector).toBeVisible();
  });

  test('draws one plate on a tall window the compact composition owns', async ({ page }) => {
    // The case the arrangement condition was ruled on, stated at its own size
    // rather than left to whichever profile happens to run this. A 744px
    // portrait window is not short and is wider than the 742px centre column the
    // pair is drawn in on a 1440px desktop, and the block drew both sides of the
    // hull in the middle of canvas 1d's single flow (Commander request
    // 2026-08-31).
    //
    // It is refused twice over: the pair asks for two whole plates rather than
    // two of any size, and that step is above the seam the arrangement condition
    // asks at (`design/hull-anatomy.md`, "And the workspace has to compose more
    // than one region"). Both halves are asserted, because the reported screen
    // has to keep drawing one plate whichever of the two is changed.
    await page.setViewportSize({ width: 744, height: 1133 });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // The window has the height — this one is not short — and neither the room
    // nor the arrangement admits a pair.
    const room = await plateRoom(page);
    expect(room).toEqual({ wideEnough: false, composition: 'compact' });
    expect(await page.evaluate(() => matchMedia('(min-height: 30.0625rem)').matches)).toBe(true);

    expect(await drawnPlates(page)).toBe(1);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toBeVisible();
    await expectNoDocumentOverflow(page);
  });

  test('draws one plate at the width a pair would be smaller than it', async ({ page }) => {
    // The reported case (Commander request 2026-08-31). A 1440px desktop is
    // canvas 1c's own window and the arrangement the pair belongs to, and the
    // block it hands this region is 742px — two plates of 344px, against the
    // 566px bound one plate is drawn at. A threshold there makes a wider window
    // draw a smaller hull, so it is the plate's own bound doubled instead and
    // this window keeps the larger single drawing.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const room = await plateRoom(page);
    expect(room.composition).not.toBe('compact');
    expect(room.wideEnough).toBe(false);

    expect(await drawnPlates(page)).toBe(1);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toBeVisible();

    // And the one plate it draws is bounded rather than stretched across the
    // column, which is the same bound a plate of the pair is held to.
    const plate = page.locator('ednb-hull-anatomy .anatomy__plate:not(.anatomy__plate--hidden)');
    const bound = await page.evaluate(
      () => 35.35 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    const drawnWidth = (await plate.boundingBox())?.width ?? 0;
    expect(drawnWidth).toBeLessThanOrEqual(bound + 1);
    expect(drawnWidth).toBeGreaterThan(bound / 2);
  });

  test('draws the pair at the width two whole plates fit across', async ({ page }) => {
    // The other side of the same step, and the only place the suite reaches it.
    // The pair needs 74.075rem of block, which in the wide composition is about
    // 1884px of window — over the widest profile the matrix runs — so without
    // this case nothing exercises canvas 1c's two tracks, the strip beside the
    // rule, or the side selector standing down.
    await page.setViewportSize({ width: 1920, height: 1040 });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const room = await plateRoom(page);
    expect(room.composition).not.toBe('compact');
    expect(room.wideEnough).toBe(true);

    // Both sides drawn, so there is nothing for the selector to choose.
    expect(await drawnPlates(page)).toBe(2);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toBeHidden();

    // Neither plate is smaller for the other's arrival: both are at the same
    // bound one plate is drawn at, which is the whole of what the step is for.
    const bound = await page.evaluate(
      () => 35.35 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    const widths = await page
      .locator('ednb-hull-anatomy .anatomy__plate')
      .evaluateAll((plates) => plates.map((plate) => plate.getBoundingClientRect().width));
    expect(widths).toHaveLength(2);
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(bound + 1);
      expect(width).toBeGreaterThan(bound - 1);
    }

    await expectNoDocumentOverflow(page);
    await expectNoPlateScrolling(page);
  });

  test('mirrors the layout without mirroring the hull or renaming a mount', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();
    const before = await mounts(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-slot')),
    );

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await settled(page);

    const after = await mounts(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-slot')),
    );
    expect(after).toEqual(before);

    // A mirrored hull would put the port hardpoints to starboard. The reading
    // direction flips; the drawing does not.
    const mirrored = await page
      .locator('ednb-hull-anatomy .schematic__drawing')
      .first()
      .evaluate((node) => {
        const transform = getComputedStyle(node).transform;
        return transform !== 'none' && transform.startsWith('matrix(-');
      });
    expect(mirrored).toBe(false);
    await expectNoDocumentOverflow(page);
  });

  /**
   * The mode strip, in German at a doubled text size.
   *
   * `test.use` rather than a context built by hand: a hand-built context takes
   * Playwright's defaults for everything it is not given, and both the width
   * and the touch profile this arrangement is decided by come from the project.
   *
   * Each condition alone was already held. Together they were not: the segments
   * shrank under their own labels, and a German compound has no space to wrap
   * at, so `Verteidigung` painted across `Antriebe` beside it and took that
   * segment's taps — a mode nobody can reach swallowing one they can.
   */
  test.describe('the mode strip, in German at a doubled text size', () => {
    test.use({ locale: 'de-DE' });

    test('gives every mode the taps that land on it', async ({ page }) => {
      await withRootTextScale(page, DOUBLED_TEXT);
      await openStockBuild(page, HULL, germanMessages);
      const strip = page.locator('ednb-hull-anatomy .anatomy__modes .tab-group');
      await expect(strip).toBeVisible();

      // What a Commander's finger reaches at the middle of a segment. A segment
      // whose own centre answers to a different one is a segment nobody can
      // press, whatever its box says.
      const stolen = await strip.evaluate((node) => {
        const taken: string[] = [];
        for (const button of node.querySelectorAll('button')) {
          button.scrollIntoView({ block: 'center', inline: 'center' });
          const box = button.getBoundingClientRect();
          const under = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          const owner = under?.closest('button')?.id ?? null;
          if (owner !== button.id) {
            taken.push(`${button.id} answers to ${owner ?? 'nothing'}`);
          }
        }
        return taken;
      });
      expect(stolen).toEqual([]);

      await expectNoDocumentOverflow(page);
    });
  });

  test('loses no mount and no state with motion removed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    const mount = mounts(page).first();
    const key = await mount.getAttribute('data-slot');
    await mount.click();

    // The requirement is not less animation: it is that no state was ever only
    // reachable through one.
    await expect(page.locator(`[data-slot-key="${key}"] button`).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(mount).toHaveAttribute('aria-pressed', 'true');
    await page.emulateMedia({ reducedMotion: null });
  });
});

test.describe('what is said out loud', () => {
  test('says nothing about the state the plates arrive in', async ({ page }) => {
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();

    // A reader arriving at the region reads its state in place. Announcing the
    // plates that loaded normally would be noise on every build ever opened.
    expect((await politeText(page)).trim()).toBe('');
  });

  test('says once when a side stops working, and once when it comes back', async ({ page }) => {
    await page.route('**/assets/ships/**/schematic-bottom.json', (route) => route.abort());
    await openStockBuild(page);
    await expect(
      page.locator('ednb-hull-anatomy .schematic[data-state="temporarilyUnavailable"]'),
    ).toHaveCount(1);

    const failure = await politeText(page);
    expect(failure).toMatch(/bottom/i);
    // One announcement for the side, not one per mount that is no longer drawn.
    expect(failure.match(/bottom/gi)?.length).toBe(1);

    await page.unroute('**/assets/ships/**/schematic-bottom.json');
    // Through the browser's own `online` transition rather than the plate's
    // retry, because at a single-plate width the failed side is the one not on
    // screen — and recovery has to be announced there too.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('ednb-hull-anatomy .schematic[data-state="ready"]')).toHaveCount(2);

    const recovery = await politeText(page);
    expect(recovery).not.toBe(failure);
    expect(recovery).toMatch(/bottom/i);
  });

  test('says nothing when only the shown side changes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStockBuild(page);
    await expect(mounts(page).first()).toBeVisible();
    expect((await politeText(page)).trim()).toBe('');

    await page.locator('ednb-hull-anatomy .anatomy__sides button').nth(1).click();
    await settled(page);

    // Choosing which side to look at changes nothing about the build and
    // nothing about what is available; feature 002 announces the selection.
    expect((await politeText(page)).trim()).toBe('');
  });
});
