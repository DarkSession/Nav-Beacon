import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { sweepOutfittingState } from './accessibility';
import { expectNoDocumentOverflow, settled, TARGET_FLOOR_PX } from './accessibility/assertions';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import {
  fitCommitted,
  openChooser,
  revealFamilyHolding,
  revealMount,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { buildStockHull } from './shell';

/**
 * Defence analysis, end to end.
 *
 * The unit suites already prove what the projection selects and what each
 * sentinel means. What only a browser can show is the rest: that the mode strip
 * actually opens the layer, that the allocation the power dashboard is read at
 * is the allocation the pip column and the recovery are read at — while the
 * bare four columns beside them stand still — and that the whole panel survives a
 * phone, a doubled text size and a 400% zoom without losing a figure or
 * scrolling the document sideways.
 *
 * Nothing here writes down a megajoule. Every figure the suite checks is read
 * back out of the running page and compared with another part of the same page
 * that has to agree with it — a suite that pinned the Anaconda's shield pool
 * would fail the day the Almanac corrected it, which is not what it is for.
 */

const HULL = 'Anaconda';

/** The mount the stock hull carries its shield generator in. */
const GENERATOR_SLOT = 'Slot03_Size6';

/** An optional mount on the stock hull that takes a size-6 shield cell bank. */
const BANK_SLOT = 'Slot04_Size6';

/** Creates a stock build and opens the anatomy region's `DEFENCE` mode. */
async function openDefence(page: Page, messages = englishMessages): Promise<void> {
  await page.goto(`/ships/${HULL}`);
  await buildStockHull(page, messages['hullDetail.create']);
  await openMode(page, messages['anatomy.mode.defence']);
  await expect(page.locator('ednb-defence-analysis .defence')).toBeVisible();
}

/** Presses one segment of the anatomy mode strip. */
async function openMode(page: Page, label: string): Promise<void> {
  const segment = page
    .locator('ednb-hull-anatomy .anatomy__modes button')
    .filter({ hasText: label });
  await segment.click();
  await expect(segment).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
}

/**
 * The damage rows of one card, cell by cell.
 *
 * The bar's own cell is left out: it holds no text at all, by design, and every
 * reading on the line is in the cells that do — four on the shield card since
 * the fifth column joined it, three on the hull, which pips do not reach.
 */
async function damageRows(page: Page, card: string): Promise<string[][]> {
  return page
    .locator(`ednb-defence-analysis .${card} .damage tbody tr`)
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        [...node.querySelectorAll('th, td:not(.damage__bar)')].map((cell) =>
          (cell.textContent ?? '').trim(),
        ),
      ),
    );
}

/** Every digit in a string, so a locale's own grouping cannot change the value. */
function digits(text: string): string {
  return text.replace(/\D/gu, '');
}

/**
 * Upper case, for comparing a drawn label with the message it came from.
 *
 * The canvas sets its headings and tile labels in caps, and the design system
 * draws that in CSS rather than in the catalogue — the words a translator
 * writes stay sentence case. Comparing both ends in one case checks that the
 * right message reached the screen without asserting the treatment.
 */
function caps(text: string): string {
  return text.toLocaleUpperCase('en');
}

/** One card's choice of view, as drawn in its head. */
function viewChoice(page: Page, card: string): Locator {
  return page.locator(`ednb-defence-analysis .${card} .card__head ednb-tab-group`);
}

/** Presses one view of a card and waits for its pressed state. */
async function chooseView(
  page: Page,
  card: string,
  label: string = englishMessages['defence.view.sources'],
): Promise<void> {
  const choice = viewChoice(page, card).getByRole('button', { name: label, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
}

/**
 * Fits a shield cell bank to {@link BANK_SLOT}, before the defence mode opens.
 *
 * The stock hull carries no bank, and the shield's reserve is drawn only where
 * one is aboard.
 */
async function fitCellBank(page: Page): Promise<void> {
  await revealMount(page, BANK_SLOT);
  const mount = page.locator(`[data-slot-key="${BANK_SLOT}"] button`).first();
  await mount.click();
  await expect(mount).toHaveAttribute('aria-pressed', 'true');

  // Opens the chooser as well.
  await revealFamilyHolding(page, /shield cell bank/iu);
  const row = page
    .locator('.candidates__choices .candidate')
    .filter({ hasText: /shield cell bank/iu })
    .first();
  await expect(row).toBeVisible();
  // The name, not the row: a click in the gap between the identity and the
  // figures lands on no content, and Firefox then activates nothing.
  await row.locator('.candidate__name').click();
  if (await surfacesAreLayers(page)) {
    await page.getByRole('button', { name: /fit module/i }).click();
  }
  await fitCommitted(page);
  await expect(page.locator(`[data-slot-key="${BANK_SLOT}"]`)).toContainText(/cell bank/iu);
  await settled(page);
}

/** Creates a stock build with a shield cell bank and opens the `DEFENCE` mode. */
async function openBankedDefence(page: Page): Promise<void> {
  await page.goto(`/ships/${HULL}`);
  await buildStockHull(page, englishMessages['hullDetail.create']);
  await fitCellBank(page);
  await openMode(page, englishMessages['anatomy.mode.defence']);
  await expect(page.locator('ednb-defence-analysis .defence')).toBeVisible();
}

/** One card's headline figure, as drawn. */
function pool(page: Page, card: string): Locator {
  return page.locator(`ednb-defence-analysis .${card} .card__pool-value`);
}

/**
 * The shield card's two recovery phases, in seconds.
 *
 * Read back off the page and turned into a number so two allocations can be
 * compared without this suite writing down a duration of its own. Only the
 * `m:ss` readings are collected: the recharge rate on the same block is a rate
 * rather than a phase, and a phase under a minute is a plain count of seconds
 * that no drained allocation produces.
 */
async function recoveryDurations(page: Page): Promise<number[]> {
  const drawn = await page
    .locator('ednb-defence-analysis .card--shield .card__facts .metric__value')
    .allInnerTexts();

  return drawn.flatMap((text) => {
    const parts = /^(\d+):(\d+)/u.exec(text.trim());
    return parts === null ? [] : [Number(parts[1]) * 60 + Number(parts[2])];
  });
}

test.describe('opening the layer', () => {
  test('retitles the region and replaces the plates with the two cards', async ({ page }) => {
    await openDefence(page);

    await expect(page.locator('ednb-hull-anatomy .anatomy__heading')).toHaveText(
      englishMessages['defence.heading'],
    );
    // A title and nothing under it, which is all the canvas's switching script
    // carries per mode.
    await expect(page.locator('ednb-hull-anatomy .anatomy__title p')).toHaveCount(0);

    await expect(page.locator('ednb-defence-analysis')).toBeVisible();
    await expect(page.locator('ednb-hull-anatomy .anatomy__plates')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .anatomy__legend')).toHaveCount(0);
    await expect(page.locator('ednb-power-thermals')).toHaveCount(0);
  });

  test('leaves the mounts layer exactly as it was when the mode is closed', async ({ page }) => {
    await openDefence(page);
    await openMode(page, englishMessages['anatomy.mode.mounts']);

    await expect(page.locator('ednb-defence-analysis')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .anatomy__heading')).toHaveText(
      englishMessages['anatomy.heading'],
    );
    await expect(page.locator('ednb-hull-anatomy .anatomy__plates')).toBeVisible();
    await expect(page.locator('ednb-hull-anatomy .schematic__mount[data-power]')).toHaveCount(0);
  });
});

test.describe('reading the build', () => {
  test('identifies defence pools, damage readings and their sources', async ({ page }) => {
    await openDefence(page);
    await test.step('heads both cards with a pool and names what each is read from', async () => {
      for (const card of ['card--shield', 'card--armour'] as const) {
        await expect(pool(page, card)).toHaveText(/\d/u);
      }
      const headings = await page.locator('ednb-defence-analysis .card__heading').allInnerTexts();
      expect(headings.map((heading) => caps(heading.trim()))).toEqual([
        caps(englishMessages['defence.shield.heading']),
        caps(englishMessages['defence.armour.heading']),
      ]);
      // The canvas names the fitted article beside each heading.
      await expect(
        page.locator('ednb-defence-analysis .card--shield .card__identity'),
      ).toContainText(/\S/u);
    });
    await test.step('draws the four damage types with a resistance and a pool apiece', async () => {
      for (const card of ['card--shield', 'card--armour'] as const) {
        const rows = await damageRows(page, card);
        expect(rows.map((row) => row[0])).toEqual([
          englishMessages['defence.damage.kinetic'],
          englishMessages['defence.damage.thermal'],
          englishMessages['defence.damage.explosive'],
          englishMessages['defence.damage.caustic'],
        ]);
        for (const row of rows) {
          // Every line states both of its figures beside the bar, so nothing on
          // this block is carried by the length of a fill alone. The resistance
          // leads its cell; a negative one is followed by the word the hatch
          // stands for, which is read out rather than seen.
          expect(row[1]).toMatch(/^-?[\d.,]+%/u);
          expect(row[2].trim()).not.toBe('');
        }
      }

      // The hull's caustic line has no resistance on a stock build, so its pool is
      // the headline pool: the two readings on the card have to agree without
      // either being written down here.
      const armour = await damageRows(page, 'card--armour');
      const caustic = armour.find((row) => row[1].replace(/\D/gu, '') === '0');
      if (caustic !== undefined) {
        expect(digits(caustic[2])).toBe(digits(await pool(page, 'card--armour').innerText()));
      }
    });
    await test.step('names every source row and closes it with the package aggregate', async () => {
      await chooseView(page, 'card--shield');
      await chooseView(page, 'card--armour');
      const rows = page.locator('ednb-defence-analysis .sources .source');
      expect(await rows.count()).toBeGreaterThan(0);
      for (const row of await rows.all()) {
        await expect(row.locator('.source__name')).toContainText(/\S/u);
        await expect(row.locator('.source__value')).toContainText(/\d/u);
      }

      // The rows carry aggregates, not shares: no row offers a per-module figure
      // and none of them is a control, because the package publishes no split and
      // the canvas draws no action here.
      await expect(page.locator('ednb-defence-analysis .sources button')).toHaveCount(0);
      await expect(page.locator('ednb-defence-analysis .sources a')).toHaveCount(0);
    });
  });

  test('sets every figure flush to the end of its own column', async ({ page }) => {
    // A column of figures is read down its length, so the digits have to line
    // up. Measured against each cell's own trailing content edge rather than
    // against the figures beside it: `32.0` over `32.0` shares an edge whether
    // the column is aligned to its start or its end, so a test that only
    // compares siblings cannot see the thing it is named for.
    //
    // Measured at all — rather than asserted on a style — because the rule that
    // draws this was present and outweighed for as long as the table has
    // existed: the cell rule beside it carries a type selector, and a bare
    // class does not beat one.
    await openDefence(page);

    for (const card of ['card--shield', 'card--armour'] as const) {
      const cells = await page
        .locator(`ednb-defence-analysis .${card} .damage tbody .damage__cell--numeric`)
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            const rtl = style.direction === 'rtl';
            // The cell's own trailing content edge, inside its padding. A
            // figure flush to it is aligned to the end; one that is not, is
            // not — which a comparison between sibling figures cannot tell,
            // because equal-width figures share an edge whichever way the
            // column is aligned.
            const edge = rtl
              ? box.left + parseFloat(style.paddingInlineEnd)
              : box.right - parseFloat(style.paddingInlineEnd);
            // The figure itself, not the cell's contents: a weakness and an
            // unbounded pool each carry a word for a screen reader, positioned
            // out of sight, and a range over the whole cell would union that
            // box in and measure something nobody sees.
            const figure = [...node.childNodes].find(
              (child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '',
            );
            if (figure === undefined) {
              throw new Error(`no figure text node in ${node.className}`);
            }
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(figure);
            const drawn = range.getBoundingClientRect();
            return { edge, figure: rtl ? drawn.left : drawn.right };
          }),
        );
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(Math.abs(cell.figure - cell.edge)).toBeLessThanOrEqual(1);
      }
    }
  });

  test('keeps the danger ink on a weakness figure, not only the hatch on its bar', async ({
    page,
  }) => {
    // The selector that right-aligns these cells carries a type, so the rule
    // that reddens a weakness has to carry one too or it loses the colour to
    // the numeric ink. The two facts live on the same cell and a regression in
    // either is invisible from the other, so they are asserted together.
    //
    // Compared against the token rather than a literal: this suite may not
    // write down a colour any more than it may write down a megajoule.
    await openDefence(page);

    const ink = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const swatch = document.createElement('span');
      swatch.style.color = root.getPropertyValue('--ednb-text-danger');
      document.body.append(swatch);
      const resolved = getComputedStyle(swatch).color;
      swatch.remove();

      const weak = [...document.querySelectorAll('.damage__row--weak .damage__cell--numeric')];
      return {
        danger: resolved,
        drawn: [...new Set(weak.map((cell) => getComputedStyle(cell).color))],
        aligned: [...new Set(weak.map((cell) => getComputedStyle(cell).textAlign))],
        count: weak.length,
      };
    });

    expect(ink.count, 'the stock hull draws at least one weakness').toBeGreaterThan(0);
    expect(ink.drawn).toEqual([ink.danger]);
    expect(ink.aligned).toEqual(['end']);
  });

  test('states armour protection and shield recovery facts', async ({ page }) => {
    await openDefence(page);
    await test.step('states the hull’s three protection facts and no fourth', async () => {
      const facts = caps(
        await page.locator('ednb-defence-analysis .card--armour .card__facts').innerText(),
      );
      expect(facts).toContain(caps(englishMessages['defence.armour.hardness']));
      expect(facts).toContain(caps(englishMessages['defence.armour.module-protection']));
      expect(facts).toContain(caps(englishMessages['defence.armour.integrity']));
      await expect(
        page.locator('ednb-defence-analysis .card--armour .card__facts .metric'),
      ).toHaveCount(3);
    });
    await test.step('states the recharge rate and both recovery durations', async () => {
      const recovery = caps(
        await page.locator('ednb-defence-analysis .card--shield .card__facts').innerText(),
      );
      expect(recovery).toContain(caps(englishMessages['defence.recovery.rate']));
      expect(recovery).toContain(caps(englishMessages['defence.recovery.full']));
      expect(recovery).toContain(caps(englishMessages['defence.recovery.broken']));
      await expect(
        page.locator('ednb-defence-analysis .card--shield .card__facts .metric'),
      ).toHaveCount(3);
    });
  });

  test('draws a weakness back from the zero line inside its track', async ({ page }) => {
    await openDefence(page);

    // The stock hull is kinetically weak, so the armour table reaches below
    // zero and carries the mark. Measured rather than read off a style, because
    // the thing worth guarding is where the ink lands.
    const zero = page.locator('ednb-defence-analysis .card--armour .damage__zero').first();
    await expect(zero).toBeAttached();
    const mark = (await zero.boundingBox())!.x;

    const weak = page.locator('ednb-defence-analysis .card--armour .damage__row--weak').first();
    await expect(weak).toBeAttached();
    const fill = (await weak.locator('.damage__fill').boundingBox())!;

    // It ends where zero is and starts before it, rather than running the other
    // way from the leading edge as though the hull resisted what it is worst
    // against. A pixel of slack, because a hairline mark has width of its own.
    expect(fill.x).toBeLessThan(mark);
    expect(Math.abs(fill.x + fill.width - mark)).toBeLessThanOrEqual(1);
  });

  test('draws no scale row under the bars, and keeps the zero line', async ({ page }) => {
    await openDefence(page);

    // Every bar has its figure beside it, so no scale stands under the bars.
    await expect(page.locator('ednb-defence-analysis .damage tfoot')).toHaveCount(0);
    await expect(page.locator('ednb-defence-analysis .scale')).toHaveCount(0);
    // The stock hull is kinetically weak, so the armour track is signed and
    // keeps its zero line.
    await expect(
      page.locator('ednb-defence-analysis .card--armour .damage__zero').first(),
    ).toBeVisible();
  });

  test('sets the metric cells apart with their gaps and no box around them', async ({ page }) => {
    await openDefence(page);

    // Canvas 1c builds its metric grids as cells on a panel fill with the amber
    // ground showing through one-pixel gaps. The ground is the rule; a border
    // around the whole grid is a box the canvas does not draw.
    const grid = page.locator('ednb-defence-analysis .card--armour .card__facts .metric-group');
    const box = await grid.evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.borderTopWidth, gap: style.rowGap, padding: style.paddingTop };
    });

    expect(box).toEqual({ width: '0px', gap: '1px', padding: '0px' });
  });

  test('rules each block off across the whole card', async ({ page }) => {
    await openDefence(page);

    const rules = page.locator('ednb-defence-analysis .card--shield .card__rule');
    expect(await rules.count()).toBeGreaterThan(0);

    const card = await page
      .locator('ednb-defence-analysis .card--shield')
      .evaluate((node) => node.getBoundingClientRect().width);

    // A rule that separates two blocks has to reach across them. Measured
    // rather than asserted on a class, because the canvas's own separator is a
    // line and the thing that made it a dot was a style, not a missing element.
    for (const rule of await rules.all()) {
      const width = await rule.evaluate((node) => node.getBoundingClientRect().width);
      expect(width).toBeGreaterThan(card / 2);
    }
  });
});

test.describe('the choice of view', () => {
  test('offers each card its summary and its sources, and shows only the one chosen', async ({
    page,
  }, testInfo: TestInfo) => {
    await openBankedDefence(page);
    const summary = englishMessages['defence.view.summary'];
    const sources = englishMessages['defence.view.sources'];

    await test.step('names both views on each card, with the summary pressed and no source read', async () => {
      for (const [card, label] of [
        ['card--shield', englishMessages['defence.view.shield']],
        ['card--armour', englishMessages['defence.view.armour']],
      ] as const) {
        const group = viewChoice(page, card).getByRole('group', { name: label });
        await expect(group).toBeVisible();
        const buttons = group.getByRole('button');
        await expect(buttons).toHaveCount(2);
        expect((await buttons.allInnerTexts()).map((text) => caps(text.trim()))).toEqual([
          caps(summary),
          caps(sources),
        ]);
        await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
        await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'false');
      }
      // The sources are not in the document at all, so not in the
      // accessibility tree either.
      for (const name of [
        englishMessages['defence.source.shield'],
        englishMessages['defence.source.armour'],
        englishMessages['defence.banks.label'],
      ]) {
        await expect(page.getByRole('list', { name, exact: true })).toHaveCount(0);
      }
    });

    await test.step('shows the shield sources and its reserve, and leaves the armour on its summary', async () => {
      await chooseView(page, 'card--shield');
      const shield = page.locator('ednb-defence-analysis .card--shield');
      await expect(
        shield.getByRole('list', { name: englishMessages['defence.source.shield'], exact: true }),
      ).toBeVisible();
      expect(await shield.locator('.sources .source').count()).toBeGreaterThan(0);
      await expect(shield.locator('.reserve')).toBeVisible();
      expect(await shield.locator('.reserve__banks .source').count()).toBeGreaterThan(0);
      await expect(shield.locator('.card__pool')).toHaveCount(0);
      await expect(shield.locator('.damage')).toHaveCount(0);

      const armour = viewChoice(page, 'card--armour').getByRole('button');
      await expect(armour.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(pool(page, 'card--armour')).toBeVisible();
      await expect(page.locator('ednb-defence-analysis .card--armour .sources')).toHaveCount(0);
    });

    await test.step('sizes each choice at the 24-pixel floor', async () => {
      for (const card of ['card--shield', 'card--armour']) {
        for (const button of await viewChoice(page, card).getByRole('button').all()) {
          const box = (await button.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
          expect(box.height).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
        }
      }
    });

    await test.step('passes a scan with each card on its sources', async () => {
      await chooseView(page, 'card--armour');
      await expect(page.locator('ednb-defence-analysis .card--armour .sources')).toBeVisible();
      await sweepOutfittingState(page, testInfo, 'defence-analysis/sources');
    });
  });

  test('heads each source list with its unit and reads every figure with it', async ({
    page,
  }, testInfo: TestInfo) => {
    await openDefence(page);
    await chooseView(page, 'card--shield');
    await chooseView(page, 'card--armour');

    for (const [card, unit, name] of [
      [
        'card--shield',
        englishMessages['defence.damage.column.megajoules'],
        englishMessages['defence.source.shield'],
      ],
      [
        'card--armour',
        englishMessages['defence.damage.column.hull-points'],
        englishMessages['defence.source.armour'],
      ],
    ] as const) {
      const head = page.locator(`ednb-defence-analysis .${card} .sources__unit`);
      await expect(head).toHaveText(unit);
      await expect(head).toHaveAttribute('aria-hidden', 'true');

      // Read through the accessibility tree: each row is a list item, and its
      // figure is the last thing in it, so the unit closes what is read.
      const list = page.getByRole('list', { name, exact: true });
      const items = (await list.ariaSnapshot())
        .split('\n')
        .filter((line) => line.trim().startsWith('- listitem'));
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.replace(/["']/gu, '').trim()).toMatch(new RegExp(`\\d\\s${unit}$`, 'u'));
      }
    }

    await sweepOutfittingState(page, testInfo, 'defence-analysis/source-units');
  });

  test('keeps each card head whole in German at the mobile portrait profile', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      locale: 'de-DE',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await openDefence(page, germanMessages);

    for (const card of ['card--shield', 'card--armour']) {
      const head = page.locator(`ednb-defence-analysis .${card} .card__head`);
      const fit = await head.evaluate((node) => {
        const strip = node.querySelector('.tab-group')!;
        const outer = node.getBoundingClientRect();
        const inner = strip.getBoundingClientRect();
        return {
          head: node.scrollWidth <= node.clientWidth,
          strip: strip.scrollWidth <= strip.clientWidth,
          inside: inner.left >= outer.left - 1 && inner.right <= outer.right + 1,
        };
      });
      expect(fit).toEqual({ head: true, strip: true, inside: true });
      expect(
        (await viewChoice(page, card).getByRole('button').allInnerTexts()).map((text) =>
          caps(text.trim()),
        ),
      ).toEqual([
        caps(germanMessages['defence.view.summary']),
        caps(germanMessages['defence.view.sources']),
      ]);
    }

    await context.close();
  });

  test('starts both cards at their summary when the defence mode opens again', async ({ page }) => {
    await openDefence(page);
    await chooseView(page, 'card--shield');
    await chooseView(page, 'card--armour');

    await openMode(page, englishMessages['anatomy.mode.mounts']);
    await openMode(page, englishMessages['anatomy.mode.defence']);

    for (const card of ['card--shield', 'card--armour']) {
      await expect(viewChoice(page, card).getByRole('button').nth(0)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.locator(`ednb-defence-analysis .${card} .card__pool`)).toBeVisible();
      await expect(page.locator(`ednb-defence-analysis .${card} .sources`)).toHaveCount(0);
    }
  });

  test('shows the bulkhead row in the armour sources on a build with no shield', async ({
    page,
  }) => {
    // The mount is emptied before the mode is opened, because the chooser is a
    // layer at compact width and the mode strip is behind it.
    await page.goto(`/ships/${HULL}`);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await revealMount(page, GENERATOR_SLOT);
    await page.locator(`[data-slot-key="${GENERATOR_SLOT}"] button`).first().click();
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator(`[data-slot-key="${GENERATOR_SLOT}"]`)).toContainText(/empty/i);
    if (await surfacesAreLayers(page)) {
      await expect(page.locator('.replacement')).toHaveCount(0);
    }
    await openMode(page, englishMessages['anatomy.mode.defence']);

    // No shield, so no shield sources and no choice on that card.
    await expect(viewChoice(page, 'card--shield')).toHaveCount(0);
    await chooseView(page, 'card--armour');

    // The bulkhead row is named by the module, so it is found by the armour
    // the card's head names.
    const identity = (
      await page.locator('ednb-defence-analysis .card--armour .card__identity').innerText()
    ).trim();
    const rows = page.locator('ednb-defence-analysis .card--armour .sources .source');
    await expect(rows.first()).toContainText(identity);
  });
});

test.describe('a shield the package refuses', () => {
  test('states the reason once rather than under the strength and the recovery both', async ({
    page,
  }, testInfo: TestInfo) => {
    // The mount is emptied before the mode is opened, because the chooser is a
    // layer at compact width and the mode strip is behind it.
    await page.goto(`/ships/${HULL}`);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await revealMount(page, GENERATOR_SLOT);
    await page.locator(`[data-slot-key="${GENERATOR_SLOT}"] button`).first().click();
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator(`[data-slot-key="${GENERATOR_SLOT}"]`)).toContainText(/empty/i);
    if (await surfacesAreLayers(page)) {
      await expect(page.locator('.replacement')).toHaveCount(0);
    }

    await openMode(page, englishMessages['anatomy.mode.defence']);
    const card = page.locator('ednb-defence-analysis .card--shield');
    await expect(card).toBeVisible();

    // One thing refuses two readings, and the package returns the same issue in
    // both. A Commander is given it once: one unavailable state, one reason,
    // and no recovery block repeating it underneath (FR-003).
    await expect(card.locator('.issue')).toHaveCount(1);
    // The reason states the absence, so nothing says "Unavailable" beside it.
    await expect(card.locator('ednb-unavailable-value')).toHaveCount(0);
    await expect(card.locator('.issue')).toHaveText(/shield generator/i);

    // Nothing stands in for the result the package declined.
    await expect(card.locator('.damage')).toHaveCount(0);
    await expect(card.locator('.card__pool')).toHaveCount(0);
    await expect(card.locator('.sources')).toHaveCount(0);

    // And the hull card is untouched by any of it.
    await expect(pool(page, 'card--armour')).toBeVisible();
    await expect(page.locator('ednb-defence-analysis .card--armour .damage tbody tr')).toHaveCount(
      4,
    );

    // The ledger carries this surface with a scan of its own, and the refusal
    // is the half of it a complete build never draws.
    await sweepOutfittingState(page, testInfo, 'defence-analysis/refused');
  });

  test('gives a generator switched off a different reason from one that is not fitted', async ({
    page,
  }) => {
    // Stating each reason once is not the same as stating them alike. A card
    // that had collapsed the package's diagnoses into one verdict about the
    // generator would pass the test above and fail here (FR-003).
    await page.goto(`/ships/${HULL}`);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await revealMount(page, GENERATOR_SLOT);
    const mount = page.locator(`.slot[data-slot-key="${GENERATOR_SLOT}"]`);

    // The label is the control: its checkbox is a clipped one-pixel box, so a
    // click aimed at the box lands on whatever the ledger draws over that point.
    await mount.locator('.power__switch').click();
    await expect(mount.locator('.power__toggle')).not.toBeChecked();
    await settled(page);

    await openMode(page, englishMessages['anatomy.mode.defence']);
    const issue = page.locator('ednb-defence-analysis .card--shield .issue');
    await expect(issue).toHaveCount(1);
    const switchedOff = await issue.innerText();

    // The mount emptied, from the same build. The package names a second
    // reason, and the card draws that one instead.
    await revealMount(page, GENERATOR_SLOT);
    await page.locator(`[data-slot-key="${GENERATOR_SLOT}"] button`).first().click();
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator(`[data-slot-key="${GENERATOR_SLOT}"]`)).toContainText(/empty/i);
    if (await surfacesAreLayers(page)) {
      await expect(page.locator('.replacement')).toHaveCount(0);
      await openMode(page, englishMessages['anatomy.mode.defence']);
    }

    await expect(issue).toHaveCount(1);
    await expect(issue).not.toHaveText(switchedOff);
  });
});

test.describe('the allocation the pip column and the recovery are read at', () => {
  test('moves the pip column alone, and leaves the bare shield where it is', async ({ page }) => {
    await openDefence(page);
    const heading = page.locator('ednb-defence-analysis .card--shield .damage thead th').last();
    const before = await damageRows(page, 'card--shield');
    const column = await heading.innerText();
    const strength = await pool(page, 'card--shield').innerText();

    // The pips live on the power dashboard, and one ship has one allocation:
    // moving them there is what the pip column and the recovery are read at.
    await openMode(page, englishMessages['anatomy.mode.power']);
    await page.locator('.distributor tbody tr').first().locator('.pips__step').nth(3).click();
    await settled(page);
    await openMode(page, englishMessages['anatomy.mode.defence']);

    const after = await damageRows(page, 'card--shield');
    // `RESIST` and `MJ` are the bare shield, which no allocation moves — the
    // package's own call for them takes none — so a pip moving on the dashboard
    // leaves every figure in them exactly where it was (FR-002).
    expect(after.map((row) => row.slice(0, 3))).toEqual(before.map((row) => row.slice(0, 3)));
    // What the allocation buys is a column of its own, headed with the count it
    // was read at, and it is the only thing on the table that follows the pips.
    expect(after.map((row) => row[3])).not.toEqual(before.map((row) => row[3]));
    expect(await heading.innerText()).not.toEqual(column);
    // Named, not merely moved. The fourth block on systems is four pips, and
    // the heading says so: a figure that follows the allocation is never drawn
    // without the allocation it was read at (FR-002).
    // The unit and the allocation are two lines of one heading, so the words are
    // compared with the whitespace between them collapsed.
    expect(caps(await heading.innerText()).replace(/\s+/g, ' ')).toBe(
      caps(
        `${englishMessages['defence.damage.column.megajoules']} ${englishMessages['defence.damage.column.at-pips'].replace('{{pips}}', '4')}`,
      ),
    );
    // The pool itself is not a function of the allocation, and the package says
    // so by returning the same strength.
    expect(digits(await pool(page, 'card--shield').innerText())).toBe(digits(strength));
  });

  test('lengthens the recovery the shields need as the systems bank is drained', async ({
    page,
  }) => {
    await openDefence(page);
    const before = await recoveryDurations(page);

    // The control never empties a bank outright — six pips between three banks
    // leaves one in systems once another holds four — so this is the slowest
    // recharge the dashboard can be set to. The phase that does not finish at
    // all is the package answering `Infinity`, which the unit suite reads
    // directly because no allocation the strip can reach produces it.
    await openMode(page, englishMessages['anatomy.mode.power']);
    await page.locator('.distributor tbody tr').nth(2).locator('.pips__step').nth(3).click();
    await settled(page);
    await openMode(page, englishMessages['anatomy.mode.defence']);

    // Slower, and no phase quicker for having less to run on. Which of the two
    // moves is the package's own reading of the allocation, not this suite's.
    const after = await recoveryDurations(page);
    expect(after.length).toBe(before.length);
    expect(after).not.toEqual(before);
    for (const [index, seconds] of after.entries()) {
      expect(seconds).toBeGreaterThanOrEqual(before[index]);
    }
  });
});

test.describe('the status rail', () => {
  test('states matching shield and hull figures without controls', async ({ page }) => {
    await openDefence(page);
    await test.step('carries the same shield and hull figures the cards carry', async () => {
      const rail = page.locator('ednb-defence-summary');
      await expect(rail).toBeVisible();
      const cells = await rail.locator('.metric').allInnerTexts();
      expect(cells).toHaveLength(2);
      expect(caps(cells[0])).toContain(caps(englishMessages['defence.rail.shield']));
      expect(caps(cells[1])).toContain(caps(englishMessages['defence.rail.armour']));

      // One projection, read twice: the rail and the card have to agree without
      // either figure being written down here.
      expect(digits(cells[0])).toContain(digits(await pool(page, 'card--shield').innerText()));
      expect(digits(cells[1])).toContain(digits(await pool(page, 'card--armour').innerText()));
    });
    await test.step('holds no control in the block', async () => {
      await expect(
        page.locator(
          'ednb-defence-summary button, ednb-defence-summary a, ednb-defence-summary input',
        ),
      ).toHaveCount(0);
    });
  });
});

test.describe('the conditions that break layouts', () => {
  test('keeps every figure at doubled text without scrolling the document', async ({ page }) => {
    await withRootTextScale(page, DOUBLED_TEXT);
    await openDefence(page);

    expect(await damageRows(page, 'card--shield')).toHaveLength(4);
    expect(await damageRows(page, 'card--armour')).toHaveLength(4);
    await expectNoDocumentOverflow(page);
  });

  test('stacks the two cards at 400% zoom rather than scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await openDefence(page);

    // Both cards whole at the narrowest width the matrix runs: the compact
    // canvas drops the resistances, the facts and the sources. None of that is
    // built — a separate abbreviated mobile data model is prohibited.
    expect(await damageRows(page, 'card--shield')).toHaveLength(4);
    expect(await damageRows(page, 'card--armour')).toHaveLength(4);
    await expect(
      page.locator('ednb-defence-analysis .card--armour .card__facts .metric'),
    ).toHaveCount(3);
    await chooseView(page, 'card--shield');
    expect(await page.locator('ednb-defence-analysis .sources .source').count()).toBeGreaterThan(0);
    await expectNoDocumentOverflow(page);
  });

  test('pads each card 10 by 12, stacks its items 8 apart, sets the cards 10 apart and pads a shield tile 6 by 8', async ({
    page,
  }) => {
    await openDefence(page);

    const measures = await page.locator('ednb-defence-analysis .defence').evaluate((panel) => {
      const box = (selector: string) => panel.querySelector(selector)!.getBoundingClientRect();
      const padding = (selector: string) => {
        const style = getComputedStyle(panel.querySelector(selector)!);
        return {
          block: parseFloat(style.paddingBlockStart),
          inline: parseFloat(style.paddingInlineStart),
        };
      };
      const shield = box('.card--shield');
      const armour = box('.card--armour');
      // Side by side where the armour starts at or after the shield's end,
      // and one above the other where it does not.
      const sideBySide = armour.left >= shield.right || armour.right <= shield.left;
      const between = sideBySide
        ? Math.max(armour.left - shield.right, shield.left - armour.right)
        : armour.top - shield.bottom;
      return {
        card: padding('.card--shield'),
        stack: box('.card--shield .table-scroller').top - box('.card--shield .card__pool').bottom,
        between,
        tile: padding('.card--shield .card__facts .metric'),
      };
    });

    expect(measures.card.block).toBeCloseTo(10, 0);
    expect(measures.card.inline).toBeCloseTo(12, 0);
    expect(measures.stack).toBeCloseTo(8, 0);
    expect(measures.between).toBeCloseTo(10, 0);
    expect(measures.tile.block).toBeCloseTo(6, 0);
    expect(measures.tile.inline).toBeCloseTo(8, 0);
  });

  test('loses no figure in an expanded translation', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();
    await openDefence(page, germanMessages);

    const rows = await damageRows(page, 'card--shield');
    expect(rows.map((row) => row[0])).toEqual([
      germanMessages['defence.damage.kinetic'],
      germanMessages['defence.damage.thermal'],
      germanMessages['defence.damage.explosive'],
      germanMessages['defence.damage.caustic'],
    ]);
    await expectNoDocumentOverflow(page);

    await context.close();
  });

  test('mirrors the layout without losing a figure', async ({ page }) => {
    await openDefence(page);
    const before = await damageRows(page, 'card--armour');

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await settled(page);

    expect(await damageRows(page, 'card--armour')).toEqual(before);
    await expectNoDocumentOverflow(page);
  });

  test('loses no state with motion removed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDefence(page);

    // The requirement is not less animation: it is that no state was ever only
    // reachable through one. The bars are the part a transition could have been
    // carrying, so the figures beside them are what is read back.
    expect(await damageRows(page, 'card--shield')).toHaveLength(4);
    await expect(pool(page, 'card--armour')).toHaveText(/\d/u);
    await page.emulateMedia({ reducedMotion: null });
  });
});

test.describe('accessibility', () => {
  test('the panel passes a scan at the standing and the drained allocation', async ({
    page,
  }, testInfo: TestInfo) => {
    await openDefence(page);
    await sweepOutfittingState(page, testInfo, 'defence-analysis/balanced');

    await openMode(page, englishMessages['anatomy.mode.power']);
    await page.locator('.distributor tbody tr').nth(2).locator('.pips__step').nth(3).click();
    await settled(page);
    await openMode(page, englishMessages['anatomy.mode.defence']);
    await sweepOutfittingState(page, testInfo, 'defence-analysis/weapons');
  });
});
