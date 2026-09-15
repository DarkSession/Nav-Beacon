import { expect, test, type Locator, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  expectNoRawMessages,
  expectOrderedHeadings,
  expectSingleVisibleH1,
} from './accessibility/assertions';
import {
  buildStockHull,
  manifestBuildControl,
  openHullFromManifest,
  reachShellLink,
  recordCount,
  restsToRead,
} from './shell';

/**
 * Inspecting a hull, and asking for a stock build.
 *
 * The two things this journey is really about: that every figure the reference
 * inspector carries is shown with the unit it is measured in, and that nothing
 * is created until a Commander asks — and then only after anything unsaved has
 * been accounted for.
 *
 * The reference inspector carries eight figures, the mount classes and one
 * price. Four of the eight are drawn bare, because the reference gives them no
 * unit: hardness, crew, mass lock and armour.
 */

const ANACONDA = '/ships/Anaconda';

/** Every figure the reference inspector carries, with the unit it shows. */
const FACTS: readonly (readonly [label: string, unit: string])[] = [
  ['Speed', 'm/s'],
  ['Boost', 'm/s'],
  ['Shield', 'MJ'],
  ['Hull mass', 't'],
];

/** The figures the reference draws bare, with no unit beside them. */
const BARE_FACTS: readonly string[] = ['Armour', 'Hardness', 'Crew', 'Mass lock'];

const detail = (page: Page) => page.getByRole('article').first();

/** The `Build` action, where this composition draws one. */
const stockAction = (page: Page): Locator =>
  page.getByRole('button', { name: englishMessages['hullDetail.create'], exact: true });

/**
 * The control this composition actually builds a stock hull with.
 *
 * Canvas 1b's sheet pins a `Build` action to its footer plate. Canvas 1a's rail
 * draws none, because the manifest beside it is the build: a rested pointer
 * opens a hull and the press after it flies its stock loadout. On a device that
 * cannot hover the rail keeps the action, since there a row press opens the
 * detail instead (`hull-detail.page.scss`, "The commitment").
 */
async function stockBuildControl(page: Page): Promise<Locator> {
  const action = stockAction(page);
  return (await action.count()) > 0 ? action.first() : manifestBuildControl(page);
}

/**
 * The screen's text, folded for comparison.
 *
 * Several labels are presented in capitals by the design system, so a
 * case-sensitive assertion would be testing the stylesheet rather than the
 * content.
 */
async function readableText(page: Page): Promise<string> {
  return (await detail(page).innerText()).replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The sheet's own identity, wherever this width draws it.
 *
 * At wide width the name and the `MANUFACTURER · <PAD> LANDING PAD` line are
 * the body's; at compact they are the command bar's title and the line under
 * it, and the body does not draw them a second time — the canvas puts them in
 * the bar and draws them once (`design/hull-detail.md`). The claim is that the
 * screen states both facts on one line, not which of the two places states it.
 */
async function identityText(page: Page): Promise<string> {
  const bar = page.locator('.frame__return-detail');
  const line = (await bar.count()) > 0 ? await bar.first().innerText() : '';
  const title = await page.getByRole('heading', { level: 1 }).first().innerText();
  return `${await readableText(page)} ${title} ${line}`.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Opens a hull the way a Commander does, without reloading the application.
 *
 * A full navigation would discard the in-memory build, and the replacement
 * question this journey is about would then never be asked.
 */
async function openHullInApp(page: Page, name: string): Promise<void> {
  // The command bar offers the tool a Commander is in as well as naming it, so
  // this tab is the way to the list of ships from every screen the ship tool
  // owns (017/FR-003). Waiting for it is what keeps the journey behind the
  // navigation that brought us here: without it the search below can be typed
  // into a manifest that is already leaving.
  await reachShellLink(page, 'Ship Builder');
  await expect(page).toHaveURL(/\/ships$/);
  await page.getByRole('searchbox', { name: 'Search ships or manufacturers' }).fill(name);
  await openHullFromManifest(page, name);
  await expect(page).toHaveURL(new RegExp(`/ships/[\\w-]+$`));
  await expect(detail(page)).toBeVisible();
}

test.describe('hull detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ANACONDA);
    await expect(page.getByRole('heading', { level: 2, name: 'Anaconda' })).toBeVisible();
  });

  test('shows every published fact with the unit it is measured in', async ({ page }) => {
    const text = await readableText(page);

    for (const label of BARE_FACTS) {
      expect(text, `${label} is shown`).toContain(label.toLowerCase());
    }

    for (const [label, unit] of FACTS) {
      expect(text, `${label} is shown`).toContain(label.toLowerCase());
      expect(text, `${label} names its unit`).toContain(unit.toLowerCase());
    }
  });

  // Canvas 1a/1b: `FAULCON DELACY · LARGE LANDING PAD`. The pad class is a
  // pad class, and the line says so rather than leaving a bare `LARGE`.
  test('names the manufacturer and the pad class on one identity line', async ({ page }) => {
    const text = await identityText(page);

    expect(text).toContain('faulcon delacy');
    expect(text).toContain('large landing pad');
  });

  // The reference draws every figure in the metric grid whole: `400`, not
  // `400.0` (canvas 1a `sy-mass`).
  test('draws every figure in the metric grid whole', async ({ page }) => {
    const grid = detail(page).locator('.metric-group');
    await expect(grid.first()).toBeVisible();

    for (const value of await grid.locator('.metric__number').allInnerTexts()) {
      expect(value.trim(), 'a metric grid figure carries no fraction').not.toMatch(/[.,]\d/);
    }
  });

  test('counts the mount classes the hull carries, largest first', async ({ page }) => {
    const mounts = await detail(page)
      .locator('[data-slot-group="hardpoint"] .detail__mount')
      .allInnerTexts();

    // The design system sets the class names in capitals; the assertion is
    // about the counts and their order, not about the stylesheet.
    expect(mounts.map((mount) => mount.replace(/\s+/g, ' ').trim().toLowerCase())).toEqual([
      '1 huge',
      '3 large',
      '2 medium',
      '2 small',
    ]);
  });

  test('carries the hardpoint total on its rule, as every other group does', async ({ page }) => {
    // The rule was the one section rule on this screen with no total on its
    // trailing edge, against three below it that all have one (Commander
    // request 2026-08-30). Nothing here writes the Anaconda's mount count down:
    // the total is held against the class counts drawn beside it on the same
    // screen, so a package that corrects the hull corrects both together.
    const group = detail(page).locator('[data-slot-group="hardpoint"]');
    const total = Number(
      (await group.locator('.detail__section-total').innerText()).replace(/\D/gu, ''),
    );

    const counts = await group.locator('.detail__mount').allInnerTexts();
    expect(counts.length).toBeGreaterThan(0);
    expect(
      counts.reduce((sum, chip) => sum + Number(/^(\d+)\b/u.exec(chip.trim())?.[1] ?? 0), 0),
    ).toBe(total);
  });

  test('states what the hull carries, grouped and totalled as the reference draws it', async ({
    page,
  }) => {
    // FR-022. Nothing here writes down an Anaconda's layout: every figure is
    // read back out of the page and held against another part of the same page
    // that has to agree with it, so a package that corrects a hull corrects the
    // assertion with it.
    const group = (id: string) => detail(page).locator(`[data-slot-group="${id}"]`);

    for (const id of ['utility', 'core', 'optional', 'restricted']) {
      await expect(group(id)).toHaveCount(1);
    }

    // Utility mounts carry a count and no chips: every one of them is the same
    // size, so a chip apiece would be one number written eight times.
    await expect(group('utility').locator('.detail__mount')).toHaveCount(0);

    // The seven core mounts, each named by the package rather than by a table
    // here, and each with its own size.
    await expect(group('core').locator('.detail__mount')).toHaveCount(7);
    expect(Number(await group('core').locator('.detail__section-total').innerText())).toBe(7);

    // The optional group's total is the number of mounts, not the number of
    // chips: a run of three sizes is one chip that says so.
    const optionalTotal = Number(
      (await group('optional').locator('.detail__section-total').innerText()).replace(/\D/gu, ''),
    );
    // A run's spoken sentence opens with its count — `3 size 6 mounts` — except
    // where the run is a single mount, which is written `One size 6 mount` so
    // that it reads as a sentence rather than as a sum.
    const runs = await group('optional').locator('.detail__mount-words').allInnerTexts();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(optionalTotal);
    expect(
      runs.reduce((total, words) => total + Number(/^(\d+)\b/u.exec(words)?.[1] ?? 1), 0),
    ).toBe(optionalTotal);

    // Largest first, read off the chips the eye sees.
    const sizes = (await group('optional').locator('.detail__mount-count').allInnerTexts()).map(
      (chip) => Number(chip.replace(/^.*?(\d+)\s*$/u, '$1')),
    );
    expect(sizes).toEqual([...sizes].sort((left, right) => right - left));

    // The restricted group names each restriction it holds, and its total is
    // counted separately from the optional one beside it.
    await expect(group('restricted').locator('.detail__restriction')).not.toHaveCount(0);
    const restrictionNames = [
      englishMessages['hullDetail.slots.restriction.military'],
      englishMessages['hullDetail.slots.restriction.cargo'],
      englishMessages['hullDetail.slots.restriction.limpetController'],
      englishMessages['hullDetail.slots.restriction.vesselHangar'],
      englishMessages['hullDetail.slots.restriction.passenger'],
    ];
    // The rule draws a restriction's name in the same upper case as the group
    // headings above it, so the comparison is against the message's own words
    // rather than against the casing the stylesheet applies to them.
    const stated = (
      await group('restricted').locator('.detail__restriction-name').allInnerTexts()
    ).map((words) => words.replace(/\s+/gu, ' ').trim().toLowerCase());
    expect(stated.length).toBeGreaterThan(0);
    for (const name of stated) {
      expect(restrictionNames.map((label) => label.toLowerCase())).toContain(name);
    }

    // A restriction the screen does not name is a restriction it does not draw,
    // which is how the planetary-approach mount every hull carries stays off
    // the group: the allowlist above is what holds that, and the unit suite
    // holds it over all 48 hulls against the package's own layout. Here the
    // group's total is held against the mounts the group itself states, so a
    // count that included something the list does not show would fail
    // (001/FR-022).
    const restrictedTotal = Number(
      (await group('restricted').locator('.detail__section-total').innerText()).replace(/\D/gu, ''),
    );
    const restrictedRuns = await group('restricted')
      .locator('.detail__mount-words')
      .allInnerTexts();
    expect(
      restrictedRuns.reduce((total, words) => total + Number(/^(\d+)\b/u.exec(words)?.[1] ?? 1), 0),
    ).toBe(restrictedTotal);
  });

  test('draws no restricted rule at all on a hull that restricts nothing it states', async ({
    page,
  }) => {
    // Twenty-nine of the 48 hulls restrict the planetary-approach mount and
    // nothing else, and that mount is left out, so the group is absent rather
    // than empty. The Sidewinder is one of them (001/FR-022).
    await page.goto('/ships/Sidewinder');
    await expect(page.getByRole('heading', { level: 2, name: 'Sidewinder' })).toBeVisible();

    const optional = detail(page).locator('[data-slot-group="optional"]');
    await expect(optional).toHaveCount(1);
    await expect(detail(page).locator('[data-slot-group="restricted"]')).toHaveCount(0);

    // Nothing states the absence either: no heading, and no restriction name.
    const text = await readableText(page);
    expect(text).not.toContain(englishMessages['hullDetail.slots.group.restricted'].toLowerCase());
  });

  test('shows the hull price as one headline figure in credits', async ({ page }) => {
    const text = await readableText(page);

    expect(text).toContain('hull price');
    expect(text).toMatch(/146,969,451\s*cr/);
  });

  // The plate carries the loader alone: the hull that was there is not the
  // hull being asked for, and holding the old picture up until the new one
  // decodes shows the wrong ship.
  test('shows the loader alone while an illustration is on its way', async ({ page }) => {
    // The picture is held until this test lets it go, rather than for a fixed
    // stretch: a stretch has to be guessed long enough to outlast the slowest
    // start-up, and whatever is guessed the picture can still arrive before the
    // state it hides has been read. Held this way the state lasts exactly as
    // long as the reading takes. Only the illustration is held, because only
    // the illustration is what the plate is waiting for.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/ships/**/illustration.png', async (route) => {
      await held;
      await route.continue();
    });
    // `commit` rather than the default: waiting for load would wait for the
    // very request being held, and the state under test would be over.
    await page.goto(ANACONDA, { waitUntil: 'commit' });

    // Committing gets the document, not the running application, so this first
    // reading also waits out the start-up. It can afford to: the picture is
    // held until the line below lets it go, so the loader cannot slip away
    // while the wait is on.
    const image = page.locator('.artwork__image');
    await expect(page.locator('.artwork__loader')).toBeVisible({ timeout: 15_000 });
    await expect(image).toBeHidden();

    // Letting go here, rather than dropping the interception: taking the
    // pattern away releases the request that is still being held, and the hold
    // then finishes onto a route the run has already dealt with.
    release();
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.artwork__loader')).toHaveCount(0);
  });

  test('keeps every action usable when the illustration cannot be fetched', async ({ page }) => {
    await page.route('**/assets/ships/**', (route) => route.abort());
    await page.goto(ANACONDA);

    await expect(page.getByText(/illustration is not available right now/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load the illustration again' })).toBeVisible();
    // The absence of a picture never gates creating a build (FR-006). Which
    // control that is depends on the composition, and neither of them is
    // waiting on an illustration.
    await expect(await stockBuildControl(page)).toBeEnabled();
  });

  test('recovers the illustration on retry, without reloading the page', async ({ page }) => {
    await page.route('**/assets/ships/**', (route) => route.abort());
    await page.goto(ANACONDA);
    const retry = page.getByRole('button', { name: 'Load the illustration again' });
    await expect(retry).toBeVisible();

    await page.unroute('**/assets/ships/**');
    await retry.click();

    // The same page, the same route, the same state: only the illustration
    // changed, and nothing had to be loaded again to get it.
    await expect(retry).toHaveCount(0);
    // Ten seconds in both environments, because the wait is a fetch of the
    // illustration rather than a redraw.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const image = document.querySelector<HTMLImageElement>('.artwork__image');
            return image !== null && image.complete && image.naturalWidth > 0;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page).toHaveURL(/\/ships\/Anaconda$/);
  });

  test('addresses a hull by its name, and keeps a symbol address working', async ({ page }) => {
    // The address is the package name with an underscore for each space, and it
    // is the one the address bar carries. A hull symbol is still accepted, so an
    // address published before the rule opens the hull it named — and is
    // replaced by the canonical one rather than standing beside it as a second
    // address for one hull (001/FR-005).
    await page.goto('/ships/Type-11_Prospector');
    await expect(page.getByRole('heading', { level: 2, name: 'Type-11 Prospector' })).toBeVisible();
    await expect(page).toHaveURL(/\/ships\/Type-11_Prospector$/);

    await page.goto('/ships/LakonMiner');
    await expect(page.getByRole('heading', { level: 2, name: 'Type-11 Prospector' })).toBeVisible();
    await expect(page).toHaveURL(/\/ships\/Type-11_Prospector$/);

    await page.goto('/ships/type-11_prospector');
    await expect(page.getByRole('heading', { level: 2, name: 'Type-11 Prospector' })).toBeVisible();
    await expect(page).toHaveURL(/\/ships\/Type-11_Prospector$/);

    // Replaced, not pushed: the Commander arrived at one hull, so back leaves
    // the shipyard rather than stepping through the addresses it answered to.
    await page.goto('/ships');
    await page.goto('/ships/LakonMiner');
    await expect(page).toHaveURL(/\/ships\/Type-11_Prospector$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/ships$/);
  });

  test('says nothing was created when the address is not a hull', async ({ page }) => {
    await page.goto('/ships/Nonexistent_Hull');

    await expect(page.getByRole('heading', { name: 'No such hull' })).toBeVisible();
    await expect(page.getByText(/Nonexistent_Hull/)).toBeVisible();
    await expect(page.getByText(/nothing has been created or changed/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: englishMessages['hullDetail.create'], exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to Ship Builder' })).toBeVisible();
  });

  test('creates the package’s own default build, and only when asked', async ({ page }) => {
    await expect(page).toHaveURL(/\/ships\/Anaconda$/);

    await buildStockHull(page, englishMessages['hullDetail.create']);

    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    // The hull is the command bar's identity line, as canvas 1c draws it, and
    // the build itself is the ledger under it. A hull line, a provenance line
    // and a saved-state line in the page were none of them on the canvas.
    await expect(page.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  });

  test('replaces the build on screen without asking, and stores no record for either', async ({
    page,
  }) => {
    // Withdrawn on 2026-08-25: nothing is asked before one build replaces
    // another. What each creation leaves behind is the other half of it. A
    // build straight from the catalogue is the loadout the package publishes
    // for the hull, which holds nothing a Commander decided: it is worth no
    // record, and a Commander reaches it again by selecting the hull
    // (FR-008, FR-009, 024/FR-001).
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    await expect(page.locator('ednb-build-workspace-page')).toHaveAttribute(
      'data-persistence',
      'ready',
    );

    await openHullInApp(page, 'Sidewinder');
    await buildStockHull(page, englishMessages['hullDetail.create']);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await expect(page.getByRole('banner').getByText('Sidewinder').first()).toBeVisible();

    // Nothing was stored for either of them. Read once rather than polled: a
    // count that states nothing was written holds from the first attempt, and
    // the status line beside it says the workspace never reached the store.
    await expect(page.locator('ednb-build-workspace-page')).toHaveAttribute(
      'data-persistence',
      'ready',
    );
    expect(await recordCount(page)).toBe(0);
  });

  test('draws the stock-hull action only where the manifest is not the build', async ({ page }) => {
    // Canvas 1a's rail ends at `HULL PRICE`: the manifest beside it already
    // builds, and a rail button would be the same transaction one press further
    // from the row a Commander is on (FR-007, `hull-detail.md`, "The wide rail
    // has no action"). Where the device cannot hover, a row press opens the
    // detail instead of building, so the action stays.
    const railBuilds = await restsToRead(page);

    await expect(stockAction(page)).toHaveCount(railBuilds ? 0 : 1);

    // Either way the capability is reachable, and reaching it is what proves
    // it: an absent button is only correct while something else is the build.
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  });

  test('is the sheet over the manifest at every width below the rail’s', async ({ page }) => {
    // Ruled 2026-08-30 (Commander request). There is no band between the two
    // compositions. With 48 hulls the manifest is several screenfuls, so a hull
    // opened at 900px under it would land below all of them: the Commander
    // presses a row and the page does not appear to change
    // (`design/hull-detail.md`, "Every width below the rail's is the sheet's").
    //
    // The rail's own width is the one threshold, and it is read from the page
    // rather than written here: a second copy of it in this suite would be one
    // that could disagree with the stylesheet.
    const atTheRail = await page.evaluate(() => matchMedia('(min-width: 64rem)').matches);

    const manifest = page.locator('.catalogue__browse');
    if (atTheRail) {
      // Beside the manifest, which keeps its track whether or not a hull is open.
      await expect(manifest).toBeVisible();
      return;
    }

    // Below it the detail takes the screen: the manifest is not drawn, and the
    // command bar carries the sheet's own return group rather than the
    // shipyard's identity.
    await expect(manifest).toBeHidden();
    await expect(page.locator('.frame__return')).toBeVisible();
  });

  test('draws the sheet as a column rather than at the width of the window', async ({ page }) => {
    // Ruled 2026-08-31 (Commander request). The sheet took whatever width the
    // screen gave it, and its artwork plate is `100%` of that at a fixed 3:2 —
    // so the illustration grew with the window while the window's height did
    // not: 979 x 653 at 1023px, 73% of a 900px-tall window spent before a
    // figure is read, against the 22% the rail draws the same plate at
    // (`design/hull-detail.md`, "The sheet is a column, not a screenful").
    //
    // The bound is read from the page rather than written here, so this cannot
    // hold a second copy of a figure the stylesheet owns.
    const atTheRail = await page.evaluate(() => matchMedia('(min-width: 64rem)').matches);
    const sheet = page.locator('.detail').first();
    const measured = await sheet.evaluate((element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const parent = element.parentElement?.getBoundingClientRect() ?? box;
      return {
        bound: getComputedStyle(element).maxInlineSize,
        width: box.width,
        leading: box.left - parent.left,
        trailing: parent.right - box.right,
      };
    });

    if (atTheRail) {
      // The rail's own track is the bound there, and the sheet's is not applied.
      expect(measured.bound).toBe('none');
      return;
    }

    // A column of the declared width, centred in whatever it was opened on.
    expect(measured.bound).not.toBe('none');
    const bound = Number.parseFloat(measured.bound);
    expect(measured.width).toBeLessThanOrEqual(bound + 1);
    expect(Math.abs(measured.leading - measured.trailing)).toBeLessThan(1);

    // And the illustration follows the column rather than the screen. The plate
    // is the column at a 3:2 ratio, so bounding the column is what bounds it:
    // unbounded it reached 979 x 653 at the last width before the rail.
    const plate = await page
      .locator('ednb-hull-artwork .artwork__frame')
      .first()
      .evaluate((frame) => {
        const box = frame.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
    expect(plate.width).toBeLessThanOrEqual(bound + 1);
    expect(plate.height).toBeLessThanOrEqual(bound / 1.5 + 1);
  });

  test('stays sound on a hull it cannot show, and on a second build', async ({
    page,
  }, testInfo) => {
    // The two states no other scan reaches. A hull's populated detail is one of
    // the four routes `interface-conformance` walks and scans, so it is scanned
    // there rather than a second time here (ledger surface
    // `system/cross-route-conformance`).
    await page.goto('/ships/Nonexistent_Hull');
    await expect(page.getByRole('heading', { name: 'No such hull' })).toBeVisible();
    await expectSingleVisibleH1(page);
    await expectOrderedHeadings(page);
    await expectNoRawMessages(page);
    await expectNoAccessibilityViolations(page, testInfo, { label: 'hull-detail-unknown' });

    await page.goto(ANACONDA);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    await openHullInApp(page, 'Sidewinder');
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo, { label: 'hull-detail-second-build' });
  });
});
