import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  expectLandmarks,
  expectNoDocumentOverflow,
  expectNoRawMessages,
  expectOrderedHeadings,
  expectSingleVisibleH1,
} from './accessibility/assertions';
import { restsToRead } from './shell';

/**
 * The shipyard journey: find a hull among all of them.
 *
 * Everything asserted here is something a Commander does — type a search,
 * choose a size, flip a sort, come back and find the list as they left it. The
 * one structural assertion is the negative: none of that browsing state may
 * escape into the route, the fragment or anything stored, because none of it is
 * part of a build (FR-003).
 *
 * Counts are read from the visible hulls rather than from one composition, so
 * the same journey holds at every width: the manifest and the card list are two
 * renderings of one list and exactly one of them is on screen.
 */

/** Every hull currently on screen, in the order it is presented. */
function visibleHulls(page: Page) {
  return page.locator('[data-hull-symbol]:visible');
}

const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search ships or manufacturers' });

/** The command bar, where the reference puts the screen's one count. */
const commandBar = (page: Page) => page.getByRole('banner');

/**
 * The control that orders the manifest: a column header where the manifest is
 * a table, a sort chip where it is a card list. The reference draws one or the
 * other, never both, so the journey asks for the action rather than the widget.
 */
const sortControl = (page: Page, field: string) =>
  page.getByRole('button', { name: new RegExp(`^Sort by ${field}, `) }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/ships');
  await expect(page.getByRole('heading', { level: 1, name: /ship builder/i })).toBeVisible();
  await expect(visibleHulls(page)).toHaveCount(49);
});

test.describe('hull catalogue', () => {
  // The reference carries the size of the shipyard in the command bar beside
  // the screen's own name, and nowhere else (canvas 1a "48 SHIPS").
  test('lists every installed hull before anything is narrowed', async ({ page }) => {
    await expect(commandBar(page).getByText('49 ships')).toBeVisible();
  });

  test('keeps the shipyard’s own size in the bar while the list is narrowed', async ({ page }) => {
    await search(page).fill('cutter');

    await expect(visibleHulls(page)).toHaveCount(1);
    await expect(commandBar(page).getByText('49 ships')).toBeVisible();
  });

  // The reference toolbar narrows two ways and no more: the search field and
  // the landing-pad strip, which is exclusive — `ALL` or one pad class, never
  // two. Manufacturer, hardpoint class and price are words the search matches.
  test('narrows by search and by landing-pad size', async ({ page }) => {
    await page.getByRole('radio', { name: 'Large' }).check();
    await expect(visibleHulls(page)).not.toHaveCount(49);

    await page.getByRole('radio', { name: 'Medium' }).check();
    await expect(page.getByRole('radio', { name: 'Large' })).not.toBeChecked();

    await page.getByRole('radio', { name: 'All', exact: true }).check();
    await expect(visibleHulls(page)).toHaveCount(49);

    await search(page).fill('type');
    await expect(visibleHulls(page)).not.toHaveCount(49);
  });

  // One field, so a Commander types everything they know: a manufacturer and
  // part of a name, in either order.
  test('searches a mix of manufacturer and ship name', async ({ page }) => {
    const symbols = () =>
      visibleHulls(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-hull-symbol')),
      );

    await search(page).fill('lakon asp');
    await expect(visibleHulls(page)).toHaveCount(2);
    const found = await symbols();

    // Word order is not part of the question being asked.
    await search(page).fill('asp lakon');
    await expect(visibleHulls(page)).toHaveCount(2);
    expect(await symbols()).toEqual(found);

    // Neither word alone is this narrow: both had to land.
    await search(page).fill('lakon');
    await expect(visibleHulls(page)).not.toHaveCount(2);
  });

  test('says why a constrained list is empty', async ({ page }) => {
    await search(page).fill('no such hull anywhere');

    await expect(visibleHulls(page)).toHaveCount(0);
    // Two renderings of one list, one of them on screen: the empty statement
    // belongs to whichever composition this width is showing.
    await expect(page.locator('.catalogue__empty:visible')).toHaveText(
      /no hull in the catalogue matches that filter/i,
    );
  });

  test('sorts in both directions on every field, and says which way', async ({ page }) => {
    for (const field of ['Ship', 'Manufacturer', 'Size', 'Hardpoints', 'Price Mcr']) {
      const control = sortControl(page, field);
      const before = await control.getAttribute('aria-label');

      await control.click();
      await expect(control).not.toHaveAttribute('aria-label', before!);
      await expect(control).toHaveAttribute('aria-label', /ascending|descending/);

      await control.click();
      await expect(control).toHaveAttribute('aria-label', before!);
    }
  });

  test('keeps every hull, and its order stable, when the direction flips', async ({ page }) => {
    const size = sortControl(page, 'Size');
    await size.click();
    const ascending = await visibleHulls(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-hull-symbol')),
    );

    await size.click();
    const descending = await visibleHulls(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-hull-symbol')),
    );

    expect(ascending).toHaveLength(49);
    expect(new Set(ascending)).toEqual(new Set(descending));
    // Ties keep the package's own order, so reversing is not a mirror image.
    expect(descending).not.toEqual([...ascending].reverse());
  });

  test('keeps browsing state out of the route, the fragment and storage', async ({ page }) => {
    await search(page).fill('cutter');
    await page.getByRole('radio', { name: 'Large' }).check();
    await expect(visibleHulls(page)).toHaveCount(1);

    const url = new URL(page.url());
    expect(url.search).toBe('');
    expect(url.hash).toBe('');

    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(stored.local).toEqual([]);
    // Browsing state is this tab's, and lives under exactly one owned key.
    expect(stored.session).toEqual(['ednb:catalogue']);
  });

  test('keeps the address a Commander followed, under a pointer that never moved', async ({
    page,
  }) => {
    // Resting on a row reads the hull beside it and replaces the address, which
    // is what makes the manifest browsable. A page that loads under a resting
    // pointer fires the same `mouseenter` with no movement behind it, so the
    // row the layout happened to put under the cursor took over the address: a
    // shared or bookmarked `/ships/Anaconda` landed on some other hull entirely
    // (reported 2026-08-28).
    // Parked over the manifest, then loaded under it without moving again.
    // Where a rest reads nothing — a touch screen, or any width below the rail's
    // — no row is read at all, so the address has to survive there too, by
    // having nothing to take it.
    const reads = await restsToRead(page);
    await page.goto('/ships');
    await visibleHulls(page).first().hover();

    for (const hull of ['Anaconda', 'Python', 'Sidewinder']) {
      await page.goto(`/ships/${hull}`);
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/ships/${hull}$`));
    }

    // And the reading it exists for still happens: a real move follows the
    // pointer where there is one, and the press does it where there is not.
    await page.goto('/ships');
    const row = visibleHulls(page).nth(3);
    // The row's own control, which is what a Commander reaches for at either
    // width: the anchored element carries the symbol, the control inside it
    // carries the action.
    const control = row.getByRole('button').first();
    await (reads ? control.hover() : control.click());

    // The address is the hull's name with an underscore for each space, and the
    // row carries the package symbol, so the two are the same string only where
    // the package spells them alike (001/FR-005). What the address has to say is
    // which hull opened, and the heading beside it is that hull.
    await expect(page).toHaveURL(/\/ships\/[^/]+$/);
    const opened = (new URL(page.url()).pathname.split('/').at(-1) ?? '').replace(/_/g, ' ');
    await expect(page.getByRole('heading', { level: 2, name: opened })).toBeVisible();
  });

  test('restores constraints, order and place after a trip to hull detail', async ({ page }) => {
    await search(page).fill('type');
    await sortControl(page, 'Price Mcr').click();
    await expect(sortControl(page, 'Price Mcr')).toHaveAttribute(
      'aria-label',
      'Sort by Price Mcr, descending',
    );
    const before = await visibleHulls(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-hull-symbol')),
    );

    // Where a rest reads a hull, resting on a row opens it beside the manifest
    // and pressing one flies it, so the trip is a hover and there is no entry to
    // come back from: the inspector replaces the address rather than stacking
    // one per row the pointer crossed. Where a rest reads nothing, the press is
    // the trip.
    const reads = await restsToRead(page);
    const row = page.getByRole('button', { name: /(view|build a stock) /i }).first();
    await (reads ? row.hover() : row.click());
    await expect(page).toHaveURL(/\/ships\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();

    if (!reads) {
      await page.goBack();
      await expect(page).toHaveURL(/\/ships$/);
    }

    await expect(search(page)).toHaveValue('type');
    await expect(sortControl(page, 'Price Mcr')).toHaveAttribute(
      'aria-label',
      'Sort by Price Mcr, descending',
    );
    expect(
      await visibleHulls(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-hull-symbol')),
      ),
    ).toEqual(before);
  });

  test('reads a hull on a rest only where the rail that reading appears in is drawn', async ({
    page,
  }) => {
    // Resting used to be the device's question alone, so a pointer crossing the
    // manifest below the rail's width threw canvas 1b's sheet up over the list
    // it was crossing — one hull after another, with no press behind any of it
    // (Commander request 2026-08-31).
    //
    // Asserted in both directions at whatever this profile is: where the rail is
    // drawn a rest still reads, and where it is not the press does the reading
    // and the row's own words say so.
    const reads = await restsToRead(page);
    await page.mouse.move(4, 4);
    await page.mouse.move(12, 12);

    const row = visibleHulls(page).first();
    const symbol = await row.getAttribute('data-hull-symbol');
    const action = row.getByRole('button').first();
    await expect(action).toHaveAttribute('aria-label', reads ? /^Build a stock/ : /^View/);

    await row.hover();
    if (reads) {
      await expect(page).toHaveURL(new RegExp(`/ships/${symbol}$`));
      return;
    }

    // Nothing moved, and the wait is real rather than an immediate read: the
    // navigation this refuses would have happened by now.
    await expect(page).toHaveURL(/\/ships$/);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/ships$/);

    // The press is what opens the hull there, which is the compact behaviour at
    // every device rather than only where the pointer is a finger.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/ships/${symbol}$`));
  });

  test('never renders a missing fact as a zero', async ({ page }) => {
    // Every installed hull publishes every catalogue fact, so the assertion is
    // the negative: nothing is being substituted for an absence.
    await expect(page.getByText('0.00', { exact: true })).toHaveCount(0);
  });

  test('never scrolls the document sideways', async ({ page }) => {
    await expectNoDocumentOverflow(page);

    await search(page).fill('type');
    await expect(visibleHulls(page)).not.toHaveCount(49);
    await expectNoDocumentOverflow(page);
  });

  test('stays sound with nothing to list', async ({ page }, testInfo) => {
    // The state a search can leave the manifest in, which no other scan
    // reaches. The populated manifest is one of the four routes
    // `interface-conformance` walks and scans, so it is scanned there rather
    // than a second time here (ledger surface `system/cross-route-conformance`).
    await search(page).fill('no such hull anywhere');
    await expect(visibleHulls(page)).toHaveCount(0);

    await expectLandmarks(page);
    await expectSingleVisibleH1(page);
    await expectOrderedHeadings(page);
    await expectNoRawMessages(page);
    await expectNoAccessibilityViolations(page, testInfo, { label: 'catalogue-no-matches' });
  });
});
