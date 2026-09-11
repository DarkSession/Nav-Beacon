import { expect, test, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import {
  acrossEveryFamily,
  benchFollowedSelection,
  commandBarActionState,
  familyControls,
  fitCommitted,
  manifestOf,
  openChooser,
  revealedFamilies,
  revealedRows,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import { buildStockHull } from './shell';

/**
 * The chooser's families, end to end (US2, wave 10; revised 2026-08-25).
 *
 * The unit suites prove the seeding rules and the grouping against the package.
 * What only a browser can show is the rest: that a Commander opening a mount
 * lands on the family holding what is already fitted, that revealing one costs
 * nothing, that a search never leaves a match behind a control they would have
 * to guess at, and that reading the screen in another language relabels the
 * families without moving a single choice between them.
 *
 * Since the 2026-08-25 canvas revision the two compositions differ in kind: a
 * family rail beside one variant pane at canvas 1c's width, the accordion at
 * canvas 1d's. Every claim below is written in the word both satisfy —
 * *revealed* — and branches only where the two genuinely answer differently,
 * which is where the requirement itself does.
 *
 * Nothing here writes down a family name. The Almanac's are the names on
 * screen, and a test that pinned one would fail on a package release that is
 * entirely correct — so what is pinned is the *relation*: which control a row
 * is under, and whether that control changed.
 */

/** A mount the Anaconda's stock build arrives with something fitted in. */
const FITTED_MOUNT = 'SmallHardpoint1';

/** A mount the stock build leaves empty, so no family holds a fitted choice. */
const EMPTY_MOUNT = 'HugeHardpoint1';

async function openStockBuild(
  page: Page,
  messages: Record<string, string> = englishMessages,
): Promise<void> {
  await page.goto('/ships/Anaconda');
  // Named from the catalogue this run is actually reading, because the German
  // context below reaches the same control through the German word for it.
  await buildStockHull(page, messages['hullDetail.create']);
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

async function selectMount(page: Page, slotKey: string): Promise<void> {
  const row = page.locator(`[data-slot-key="${slotKey}"] button`).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await benchFollowedSelection(page);
}

/** The accessible name of every family control currently drawn, in order. */
async function familyNames(page: Page): Promise<readonly string[]> {
  // The package's string alone. Everything around it is ours and moves with the
  // reading language whether or not the Almanac translated a thing: the control
  // carries the count sentence, and the name cell carries the untranslated
  // disclosure. Read together, either would satisfy a comparison meant
  // to prove the *package* relabelled its families.
  return page
    .locator('.family .family__name .game-text__value')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').replace(/\s+/gu, ' ').trim()),
    );
}

test.describe('module families', () => {
  test('opens the family holding the fitted module, and only that one', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    const open = await revealedFamilies(page);
    expect(open).toHaveLength(1);

    // It is the family the list itself marks as fitted, which is the whole
    // point: the row a Commander is looking for is on screen without them
    // opening anything (FR-021, SC-007). Scoped to the families' own rows,
    // because the compact composition pins the same row a second time in canvas
    // 1d's `FITTED HERE` block above them.
    const fitted = page.locator('.candidates__choices .candidate--fitted');
    await expect(fitted).toHaveCount(1);
    await expect(fitted).toBeVisible();

    // Every other family is drawn and closed, contributing its bar and no rows:
    // what is in the document is exactly the open family's own count.
    const total = await familyControls(page).count();
    expect(total).toBeGreaterThan(1);

    const openCount = Number(
      (await page.locator('.family__count').nth(open[0]!).innerText()).replace(/\D+/gu, ''),
    );
    expect(openCount).toBeGreaterThan(0);
    expect(await revealedRows(page).count()).toBe(openCount);
  });

  test('answers an unheld fitted choice in its own composition\u2019s terms', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, EMPTY_MOUNT);
    await openChooser(page);

    await expect(familyControls(page).first()).toBeVisible();

    if ((await manifestOf(page)) === 'accordion') {
      // An empty mount has no fitted choice, so there is no family to open and
      // the honest answer is all of them closed rather than an arbitrary first
      // one — which is a state canvas 1d draws (FR-021, SC-007).
      expect(await revealedFamilies(page)).toHaveLength(0);
      await expect(revealedRows(page)).toHaveCount(0);
      return;
    }

    // The rail cannot say "none". Canvas 1c's rail always has a selection and
    // never paints an empty pane, so it falls to the first family in package
    // order — not a substitute this application chose, but what the drawing
    // does (FR-021 as restated 2026-08-25).
    expect(await revealedFamilies(page)).toEqual([0]);
    expect(await revealedRows(page).count()).toBeGreaterThan(0);
  });

  test('brings the revealed family into the rail, and leaves a pressed one alone', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    if ((await manifestOf(page)) !== 'rail') {
      // The accordion draws its families and their rows in one scroller, so the
      // fitted row being on screen already carries its family with it. Only the
      // rail lists the families in a box of their own, which is the box this
      // rule is about (`design/module-replacement.md`, "The rail scrolls to the
      // family it was told to select").
      return;
    }

    const rail = page.locator('.candidates__rail');
    const selected = page.locator('.family--rail[aria-pressed="true"]');
    await expect(selected).toHaveCount(1);

    // The rail is bounded at the pane's own height and the Almanac publishes
    // seventy-seven families, so the revealed one can be well past the fold.
    // Wherever it landed, it is inside the box a Commander is reading
    // (FR-021, SC-007).
    const railBox = (await rail.boundingBox())!;
    const selectedBox = (await selected.boundingBox())!;
    expect(selectedBox.y).toBeGreaterThanOrEqual(railBox.y - 1);
    expect(selectedBox.y + selectedBox.height).toBeLessThanOrEqual(railBox.y + railBox.height + 1);

    // And a family the Commander reveals is left where they pressed it. The row
    // has to be one the rail would otherwise scroll to, or the restraint that
    // leaves an already-visible row alone answers first and the press is never
    // weighed — a test that pressed a row whole in the box would pass with the
    // press tracking deleted outright.
    const rows = page.locator('.family--rail');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);

    let clipped: { index: number; offset: number } | null = null;
    for (let index = 0; index < count; index += 1) {
      const box = await rows.nth(index).boundingBox();
      if (box === null) {
        continue;
      }
      if (box.y + box.height > railBox.y + railBox.height) {
        clipped = { index, offset: box.y - railBox.y };
        break;
      }
    }
    expect(clipped).not.toBeNull();

    // Dispatched rather than clicked: Playwright scrolls a target into view
    // before pressing it, which would move the rail before the rule under test
    // ever ran.
    await rows.nth(clipped!.index).evaluate((node: HTMLElement) => node.click());
    await expect(rows.nth(clipped!.index)).toHaveAttribute('aria-pressed', 'true');

    // Measured inside the rail rather than in the window. Revealing a family
    // redraws the pane beside it, which changes the panel's height and reflows
    // everything above it — so a viewport figure moves for reasons that have
    // nothing to do with the rail scrolling.
    const railAfter = (await rail.boundingBox())!;
    const after = (await rows.nth(clipped!.index).boundingBox())!;
    expect(Math.abs(after.y - railAfter.y - clipped!.offset)).toBeLessThanOrEqual(1);
  });

  test('draws the rail at the canvas\u2019s own width, and as a share either side of it', async ({
    page,
  }) => {
    // Canvas 1c draws the rail at 264px of a chooser column of 872 — its own 264
    // and 594 tracks with the 14px between them — and the share is taken against
    // that column rather than against the bench, because the editor beside it is
    // the bench's third track and not a second track of this grid. Taken against
    // the bench the same ratio drew 176px where the canvas draws 264
    // (`design/module-replacement.md`, "The rail's 264px is a floor and a
    // share").
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    const railWidth = async (): Promise<{ rail: number; column: number } | null> =>
      await page.evaluate(() => {
        const rail = document.querySelector('.candidates__rail');
        const column = document.querySelector('.candidates__manifest');
        return rail === null || column === null
          ? null
          : {
              rail: rail.getBoundingClientRect().width,
              column: column.getBoundingClientRect().width,
            };
      });

    // Polled on the width itself, not on any width at all. The rail is already
    // drawn at the profile's own width when the viewport changes, so a poll for
    // "greater than zero" passes on the layout before the resize.
    await page.setViewportSize({ width: 2020, height: 1100 });
    await expect
      .poll(async () => Math.abs(((await railWidth())?.rail ?? 0) - 264))
      .toBeLessThanOrEqual(2);
    const drawn = (await railWidth())!;

    // Narrower, it is a share of a narrower column rather than the same 264px
    // taking two fifths of it away from the rows.
    await page.setViewportSize({ width: 1790, height: 1100 });
    await expect
      .poll(async () => Math.round((await railWidth())?.rail ?? 0))
      .toBeLessThan(drawn.rail);

    // And wider it grows with the column, up to the width a family name stops
    // needing.
    await page.setViewportSize({ width: 2560, height: 1100 });
    await expect
      .poll(async () => Math.round((await railWidth())?.rail ?? 0))
      .toBeGreaterThan(drawn.rail);
  });

  test('draws a compact row on one line, with the price on its trailing edge', async ({ page }) => {
    // Canvas 1d's row: the class code in a fixed gutter, the module beside it
    // and the price on the trailing edge, `min-height: 60px`. Stacked instead —
    // which is what a single-column row does to those three cells — the same
    // row stood three deep, so a screen of modules showed a handful of them and
    // every price was a line of its own to read down (Commander request
    // 2026-08-30).
    await page.setViewportSize({ width: 390, height: 844 });
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);
    if ((await revealedRows(page).count()) === 0) {
      await familyControls(page).first().click();
    }
    await expect(revealedRows(page).first()).toBeVisible();

    const drawn = await revealedRows(page).evaluateAll((nodes) =>
      nodes.slice(0, 6).map((node) => {
        const centre = (selector: string): number | null => {
          const cell = node.querySelector(selector);
          if (cell === null) {
            return null;
          }
          const box = cell.getBoundingClientRect();
          return box.top + box.height / 2;
        };
        const row = node.getBoundingClientRect();
        const cost = node.querySelector('.candidate__cost')?.getBoundingClientRect();
        const name = node.querySelector('.candidate__name')?.getBoundingClientRect();
        return {
          height: row.height,
          lines: [
            centre('.candidate__class'),
            centre('.candidate__identity'),
            centre('.candidate__cost'),
          ],
          trailing: cost === undefined ? 0 : row.right - cost.right,
          afterName: cost === undefined || name === undefined ? 1 : cost.left - name.right,
        };
      }),
    );

    expect(drawn.length).toBeGreaterThan(1);
    for (const row of drawn) {
      // One line: the three cells are centred on the same line, whatever their
      // own heights are.
      const centres = row.lines.filter((line): line is number => line !== null);
      expect(centres.length).toBe(3);
      expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(2);

      // And the price is at the row's own end, after the name rather than under
      // it. The inset it stands off is the row's, and the same on every row.
      expect(row.afterName).toBeGreaterThan(0);
      expect(row.trailing).toBeGreaterThanOrEqual(0);
      expect(row.trailing).toBeLessThanOrEqual(drawn[0]!.trailing + 1);
    }

    // At a doubled text size the row stacks again, and the point of that is the
    // name. The gutter and the price are stated in rem and grow with the text
    // while only the name is allowed to shrink, so held on one line the three
    // cells took this row down to a class code, an ellipsis and a price with the
    // module's name gone (SC 1.4.4).
    await withRootTextScale(page, DOUBLED_TEXT);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const name = document.querySelector('.candidate .candidate__name');
          return name === null
            ? -1
            : Math.round(name.scrollWidth - name.getBoundingClientRect().width);
        }),
      )
      .toBeLessThanOrEqual(1);
  });

  test('orders a family\u2019s rows by class, then by what they cost', async ({ page }) => {
    await openStockBuild(page);
    // A medium mount, because it takes more than one class: a small hardpoint
    // offers class 1 and nothing else, and a family drawn there could not show
    // the class key doing any work.
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    // The compact composition reveals no family on a mount holding nothing, so
    // the first one is revealed here to have rows to read. Which family it is
    // does not matter — the order is a rule about every family.
    if ((await revealedRows(page).count()) === 0) {
      await familyControls(page).first().click();
    }
    await expect(revealedRows(page).first()).toBeVisible();

    // Read off the drawn rows rather than off the state: what the contract
    // fixes is the order a Commander sees, and both figures are on the row
    // (FR-005, SC-006).
    const rows = await revealedRows(page).evaluateAll((nodes) =>
      nodes.map((node) => ({
        code: (node.querySelector('.candidate__class')?.textContent ?? '').trim(),
        cost: (node.querySelector('.candidate__cost')?.textContent ?? '').trim(),
      })),
    );

    expect(rows.length).toBeGreaterThan(1);

    /** The leading digits of a cell, or `null` where it states no figure. */
    const figure = (text: string): number | null => {
      const found = /\d[\d,.\u00a0\u202f ]*/u.exec(text);
      if (found === null) {
        return null;
      }
      const digits = found[0].replace(/\D/gu, '');
      return digits.length === 0 ? null : Number(digits);
    };

    let classesFell = false;
    let pricesFell = false;

    for (let index = 1; index < rows.length; index += 1) {
      const previousClass = figure(rows[index - 1]!.code);
      const currentClass = figure(rows[index]!.code);
      if (previousClass === null || currentClass === null) {
        continue;
      }

      expect(previousClass).toBeGreaterThanOrEqual(currentClass);
      if (previousClass !== currentClass) {
        classesFell = true;
        continue;
      }

      // Same class: the price falls, and a row the package publishes no price
      // for never stands above one it prices. The cost cell can carry a second
      // Merc Coin line under the credits, so only the first figure is read.
      const previousCost = figure(rows[index - 1]!.cost);
      const currentCost = figure(rows[index]!.cost);
      if (previousCost === null) {
        expect(currentCost).toBeNull();
        continue;
      }
      if (currentCost !== null && previousCost !== currentCost) {
        expect(previousCost).toBeGreaterThan(currentCost);
        pricesFell = true;
      }
    }

    // Neither key is asserted vacuously: this family really does hold more than
    // one class, and more than one price inside a class.
    expect(classesFell).toBe(true);
    expect(pricesFell).toBe(true);
  });

  test('scrolls the manifest inside its own box rather than over the panel below', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    // The measurement that was missing when this went wrong. A `fieldset` hands
    // its anonymous content box a height only when it has a definite one, and
    // releasing the workspace column turned the panel's definite share into a
    // maximum — so the scroller inside grew to its content instead of scrolling,
    // and with the bench no longer clipping, the rows were painted over the
    // engineering panel below, where they answered presses meant for a family
    // control (`design/module-replacement.md`, "The fieldset needs a height of
    // its own"). Nothing about the rows says so; only the boxes do.
    const spill = await page.locator('.candidates').evaluate((node) => ({
      fieldset: node.scrollHeight - node.clientHeight,
      list: (() => {
        const host = node.closest('ednb-candidate-list') as HTMLElement;
        return host.scrollHeight - host.clientHeight;
      })(),
    }));

    expect(spill.fieldset).toBeLessThanOrEqual(1);
    expect(spill.list).toBeLessThanOrEqual(1);
  });

  test('reveals on a tap, changing nothing about the build', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    // Waited for rather than read straight away: the fragment is written from
    // the build a moment after the workspace arrives, and a hash captured
    // before that lands would be compared against one that was always going to
    // change for a reason that has nothing to do with a family.
    await expect(page).toHaveURL(/#b\./);
    const hash = new URL(page.url()).hash;
    const undo = commandBarActionState(page, /^undo$/i);
    const undoWasDisabled = await undo.isDisabled();

    const accordion = (await manifestOf(page)) === 'accordion';
    const rows = revealedRows(page);
    const rowsBefore = await rows.count();

    // Pinned by its own id, not by "the first unrevealed one": that locator
    // re-resolves after the press and would then be pointing at a different
    // family altogether.
    const state = accordion ? 'aria-expanded' : 'aria-pressed';
    const id = await familyControls(page)
      .and(page.locator(`[${state}="false"]`))
      .first()
      .getAttribute('id');
    const control = page.locator(`#${id}`);

    // A tap where the profile has touch and a click where it does not: the
    // control has to answer to a thumb as well as a pointer (FR-022). Both are
    // exercised here — the second press is always a click.
    const touch = test.info().project.use.hasTouch === true;
    await (touch ? control.tap() : control.click());
    await expect(control).toHaveAttribute(state, 'true');

    if (accordion) {
      // A disclosure: the family opens beside the one already open, and the
      // same press closes it again.
      expect(await rows.count()).toBeGreaterThan(rowsBefore);
      await control.click();
      await expect(control).toHaveAttribute(state, 'false');
      expect(await rows.count()).toBe(rowsBefore);
    } else {
      // A selection: this family becomes the only revealed one, and pressing it
      // a second time leaves it selected. A rail has no "none" for a second
      // press to mean, and its pane is never empty.
      expect(await revealedFamilies(page)).toHaveLength(1);
      expect(await rows.count()).toBeGreaterThan(0);
      await control.click();
      await expect(control).toHaveAttribute(state, 'true');
      expect(await revealedFamilies(page)).toHaveLength(1);
    }

    // Looking is free. No revision reached the link, and undo did not become
    // available because nothing was decided (FR-021, SC-006).
    expect(new URL(page.url()).hash).toBe(hash);
    expect(await undo.isDisabled()).toBe(undoWasDisabled);
  });

  test('leaves no family holding a match absent, and restores the seed on clearing', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    const seeded = await revealedFamilies(page);
    const total = await familyControls(page).count();

    await page.locator('input[type="search"]').fill('laser');
    // Waited on the list actually narrowing rather than on it merely being
    // there: it was already there, so a visibility check proves nothing.
    await expect(familyControls(page)).not.toHaveCount(total);

    const matched = await familyControls(page).count();
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(total);

    if ((await manifestOf(page)) === 'accordion') {
      // Every family drawn is open, so no match is behind a closed control, and
      // every family drawn holds at least one match (FR-023, SC-008).
      expect(await revealedFamilies(page)).toHaveLength(matched);
      await expect(page.locator('.family[aria-expanded="false"]')).toHaveCount(0);
      for (let index = 0; index < matched; index += 1) {
        await expect(
          page.locator('.family__choices').nth(index).locator('.candidate').first(),
        ).toBeVisible();
      }
    } else {
      // The rail narrows to the families holding matches and selects the first
      // of them. It cannot open them all — it draws one family's rows — and it
      // does not need to: what FR-023 protects is that a family holding a match
      // is never absent, and the rail keeps every one of them listed and
      // counted (FR-023 as scoped 2026-08-25, SC-008).
      expect(await revealedFamilies(page)).toEqual([0]);
      expect(await revealedRows(page).count()).toBeGreaterThan(0);
    }

    await page.locator('input[type="search"]').fill('');
    await expect(familyControls(page)).toHaveCount(total);
    expect(await revealedFamilies(page)).toEqual(seeded);
  });

  test('leaves a family the Commander closed closed when they fit from another', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    if ((await manifestOf(page)) === 'rail') {
      // The rail reveals exactly one family at a time, so there is no second
      // family standing open for a fit to disturb.
      return;
    }

    // The accordion is where the rule has something to keep, and the widths
    // that draw it with an inline bench are where it is proved: there the press
    // on a module row *is* the fit, so the chooser is rebuilt at a new revision
    // for the same mount, language, manifest and search — which is the only
    // shape the rule can be caught in. The report named a phone; the
    // arrangement it describes is the accordion, and the layer widths are
    // handled at the foot of this test.

    await page.locator('input[type="search"]').fill('laser');
    const families = familyControls(page);
    await expect(families).not.toHaveCount(0);
    const matched = await families.count();
    expect(matched).toBeGreaterThan(1);
    expect(await revealedFamilies(page)).toHaveLength(matched);

    // One family closed, and a module taken from the next one along. Only an
    // open family draws a `.family__choices`, so once the first is closed the
    // first of those belongs to the second family.
    await families.first().click();
    await expect(families.first()).toHaveAttribute('aria-expanded', 'false');
    await page
      .locator('.family__choices')
      .first()
      .locator('.candidate .candidate__name')
      .first()
      .click();

    // Where the bench is inline that press is the fit, so the chooser is
    // rebuilt at a new revision for the same mount and the same search, and the
    // family the Commander closed has to still be closed under it (FR-021,
    // Commander request 2026-08-31).
    await expect(familyControls(page).first()).toHaveAttribute('aria-expanded', 'false');
    expect(await revealedFamilies(page)).not.toContain(0);

    if (!(await surfacesAreLayers(page))) {
      return;
    }

    // Where the chooser is a layer, the press above marked the row and fitted
    // nothing: the fit is the separate `FIT MODULE` press, and the layer closes
    // on it. So the two assertions above hold at these widths whatever the rule
    // says, and what they evidence is the marking, not the rule.
    //
    // Nor does reopening the layer put the rule back in reach. A chooser opens
    // with an empty search, so the presentation a Commander comes back to is
    // not the one they left and the seed is meant to apply — asserting the
    // family stayed closed there would assert the opposite of FR-021. That the
    // search is cleared is stated here so a reader does not go looking for
    // coverage that would be wrong to add.
    await page.getByRole('button', { name: /fit module/i }).click();
    await fitCommitted(page);
    await openChooser(page);
    await expect(page.locator('input[type="search"]')).toHaveValue('');
  });

  test('answers a search past a screenful in its own composition\u2019s terms', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, FITTED_MOUNT);
    await openChooser(page);

    const total = await familyControls(page).count();
    const accordion = (await manifestOf(page)) === 'accordion';

    // One letter matches most of the mount.
    await page.locator('input[type="search"]').fill('a');

    if (accordion) {
      // A list of everything is not an answer a Commander can read, so what
      // stays on screen is the families and their counts — and the rows nobody
      // asked for are not built (FR-023).
      await expect(page.locator('.family[aria-expanded="true"]')).toHaveCount(0);
      await expect(revealedRows(page)).toHaveCount(0);
    } else {
      // The rail paints one family's rows at any match count, so the screenful
      // rule has nothing to protect against here: it reveals the first family
      // holding a match, exactly as it does for a narrow one.
      await expect(async () => {
        expect(await revealedFamilies(page)).toEqual([0]);
      }).toPass({ timeout: 10_000 });
      expect(await revealedRows(page).count()).toBeGreaterThan(0);
    }

    const counted = await page
      .locator('.family__count')
      .evaluateAll((nodes) =>
        nodes.reduce(
          (running, node) => running + Number((node.textContent ?? '').replace(/\D+/gu, '')),
          0,
        ),
      );
    expect(counted).toBeGreaterThan(25);

    // Not one family holding a match went missing, and the surface's own count
    // still says how many there are — whichever manifest is drawing them.
    expect(await familyControls(page).count()).toBeGreaterThan(0);
    const published = Number(
      (
        await page
          .locator('.replacement__count, ednb-candidate-search [role="status"]')
          .first()
          .innerText()
      ).replace(/\D+/gu, ''),
    );
    expect(published).toBe(counted);

    await page.locator('input[type="search"]').fill('');
    await expect(familyControls(page)).toHaveCount(total);
  });

  test('relabels every family in another language without moving a choice', async ({
    page,
    browser,
    baseURL,
  }) => {
    const english = await familyList(page);

    // German the only way a Commander can reach it: by asking for it with their
    // browser. There is no language control in the product (feature 011).
    const context = await browser.newContext({
      baseURL,
      locale: 'de-DE',
      viewport: test.info().project.use.viewport ?? null,
      hasTouch: test.info().project.use.hasTouch === true,
    });
    const german = await familyList(
      await context.newPage(),
      germanMessages as Record<string, string>,
    );
    await context.close();

    // The names change — that is the package's own German — and the nineteen
    // families it does not name outside English read as their English name with
    // the untranslated disclosure beside them, never as a blank or a raw id.
    expect(german.names).not.toEqual(english.names);
    expect(german.names.every((name) => name.length > 0)).toBe(true);

    // At least one family the package has named in German reads differently.
    // Which families a mount offers is the package's business, so whether any
    // of the nineteen it has not named outside English is among them is not
    // something this test can require; that fallback is proven directly, over
    // all 77 ids, in the presenter suite.
    const changed = german.names.filter((name, index) => name !== english.names[index]);
    expect(changed.length).toBeGreaterThan(0);

    // Membership is the package's `familyId` and nothing else, so not one
    // choice moved between families and no family gained or lost one, whatever
    // the locale's collator did to the names (FR-020, SC-009). Compared as a
    // set per family: the order *within* one is the locale's collation of the
    // module names, so German legitimately reorders rows it did not move.
    expect(german.membership).toEqual(english.membership);
  });
});

/**
 * The frozen bar overhangs its scroller, and still draws its own rule.
 *
 * A hairline of nothing was not enough. The scroller's top edge is placed by
 * flex at a fractional device pixel while the browser snaps the bar to a whole
 * one, and at scale factors 1.5 and 2.5 the two miss each other: one device row
 * of the row *behind* the bar prints above it, which is the sliver a Commander
 * sees as a gap over the family's name. Only the box overhanging that edge
 * closes it — a shadow reaching above the edge is clipped away with everything
 * else up there, which is why the same technique works for the hull manifest's
 * frozen head, under the document, and not here.
 *
 * The overhang costs the bar whatever is drawn in its first two pixels, and a
 * `border-block-start` is exactly that: the rule above the family name went
 * with the clip every time the bar froze, and the band it vacated is where the
 * same Commander then watched the list scroll past. The rule is drawn inside
 * the box, set in by the overhang, so the clip lands on ground rather than on
 * it.
 *
 * Both halves are asserted, and as mechanism rather than as pixels. A pixel
 * comparison would only fail on the one scale factor the runner happens to be
 * at, and passing at that scale factor is what let this through twice already.
 */
test('freezes the family bar above the edge of its scroller, and still rules it', async ({
  page,
}) => {
  await openStockBuild(page);
  await selectMount(page, FITTED_MOUNT);
  await openChooser(page);

  const bar = page.locator('.family[aria-expanded="true"], .family[aria-pressed="true"]').first();
  await expect(bar).toBeVisible();

  const frozen = await page.evaluate(() => {
    const control = document.querySelector(
      '.family[aria-expanded="true"], .family[aria-pressed="true"]',
    ) as HTMLElement;
    const style = getComputedStyle(control);
    const rule = getComputedStyle(control, '::before');
    return {
      position: style.position,
      start: Number.parseFloat(style.insetBlockStart),
      ground: style.backgroundColor,
      rule: {
        start: Number.parseFloat(rule.insetBlockStart),
        size: Number.parseFloat(rule.blockSize),
        colour: rule.backgroundColor,
      },
    };
  });

  // The composition that scrolls its bars away with their own rows has no edge
  // for one to be frozen against and no seam to cover, and neither has the rail:
  // its names never scroll away from their rows, because the rows are in the
  // pane beside them. Stated as an assertion rather than passed over, because
  // the day either becomes sticky is the day the branch below has to hold for it
  // too.
  if (frozen.position !== 'sticky') {
    expect(frozen.position).toBe('static');
    return;
  }

  // Negative because the bar is pulled above the edge it freezes against, and
  // the scroller clips what hangs over. Anything shallower than two CSS pixels
  // is the leak — a hairline was what a Commander kept seeing through.
  expect(frozen.start).toBeLessThanOrEqual(-2);
  // Both measured bounds, not just the one that was leaking. Four CSS pixels of
  // overhang leaks too, at scale factor 1.25, because a bar that far above the
  // edge clears its own family before the family's rows are done.
  expect(frozen.start).toBeGreaterThan(-4);

  // And the ground the clip lands on is opaque, or the overhang is a window
  // rather than a cover.
  expect(frozen.ground).not.toMatch(/transparent|rgba\([^)]*,\s*0(\.0+)?\)/);

  // The rule survives that clip because it is set in by the overhang rather
  // than drawn on the box's own top edge. Set in by less and the clip takes it;
  // this is the assertion that fails if it ever goes back to being a border.
  expect(frozen.rule.size).toBeGreaterThan(0);
  expect(frozen.rule.start).toBeGreaterThanOrEqual(-frozen.start);
  expect(frozen.rule.colour).not.toMatch(/transparent|rgba\([^)]*,\s*0(\.0+)?\)/);
});

/**
 * Every family on the fitted mount, with the choices each one holds.
 *
 * Read with every family open, because a closed one holds no rows to compare.
 * Choices are compared by their view key, which is built from the package's own
 * identity rather than from any text — so the comparison survives the whole
 * screen being relabelled.
 */
async function familyList(
  page: Page,
  messages: Record<string, string> = englishMessages,
): Promise<{ names: readonly string[]; membership: readonly (readonly string[])[] }> {
  await openStockBuild(page, messages);
  await selectMount(page, FITTED_MOUNT);
  // The compact composition reaches the chooser through a control named in the
  // language being read, so the German run asks for it by its German name.
  await openChooser(page, messages['outfitting.capability.replace']);

  // Read family by family, because the rail draws one family's rows at a time
  // and the accordion can draw them all: `acrossEveryFamily` is the one place
  // that knows the difference. The order is the list's own either way, so the
  // two readings line up index for index.
  const names = await familyNames(page);
  const membership: string[][] = [];
  await acrossEveryFamily(page, async (rows) => {
    membership.push(
      (
        await rows.evaluateAll((nodes) =>
          nodes.flatMap((node) =>
            Array.from(node.querySelectorAll('input[type="radio"]')).map(
              (radio) => (radio as HTMLInputElement).value,
            ),
          ),
        )
      ).sort(),
    );
  });

  expect(membership.flat().length).toBeGreaterThan(0);
  return { names, membership };
}
