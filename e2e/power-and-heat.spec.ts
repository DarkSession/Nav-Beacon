import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { sweepOutfittingState } from './accessibility';
import { expectNoDocumentOverflow, expectTargetSizes, settled } from './accessibility/assertions';
import { AXE_TAGS } from './accessibility/axe';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import {
  fitCommitted,
  revealFamilyHolding,
  revealMount,
  revealStatusRail,
  statusRailIsColumn,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { buildStockHull } from './shell';

/**
 * Power and thermals, end to end.
 *
 * The unit suites already prove what the projection selects and what each
 * sentinel means. What only a browser can show is the rest: that the mode strip
 * actually opens the layer, that a condition moves every figure it should and
 * nothing it should not, and that the whole panel survives a phone, a doubled
 * text size and a 400% zoom without losing a figure or scrolling the document
 * sideways.
 *
 * Nothing here writes down a megawatt. Every figure the suite checks is read
 * back out of the running page and compared with another part of the same page
 * that has to agree with it — a suite that pinned the Anaconda's plant output
 * would fail the day the Almanac corrected it, which is not what it is for.
 */

const HULL = 'Anaconda';

/** Creates a stock build and opens the anatomy region's `POWER` mode. */
async function openPower(page: Page, messages = englishMessages): Promise<void> {
  await page.goto(`/ships/${HULL}`);
  await buildStockHull(page, messages['hullDetail.create']);

  await page
    .locator('ednb-hull-anatomy .anatomy__modes button')
    .filter({ hasText: messages['anatomy.mode.power'] })
    .click();
  await expect(page.locator('ednb-power-thermals .power')).toBeVisible();
}

/**
 * Brings the status rail on screen and returns the dashboard afterwards.
 *
 * Canvas 1c draws the rail as a third track beside the mode panel, so both are
 * on screen at once and this is a no-op. Canvas 1d has no third track: the rail
 * is the strip's `STATUS` segment and the dashboard is its `POWER` one, and a
 * segment that is not the open one is not on the page. A journey that presses
 * in the rail and reads in the dashboard therefore does it in two visits at
 * that width, which is what a Commander does too.
 */
async function inTheRail(
  page: Page,
  visit: () => Promise<void>,
  messages = englishMessages,
): Promise<void> {
  await revealStatusRail(page, exactly(messages['outfitting.status-rail.mode']));
  await visit();
  await openMode(page, messages['anatomy.mode.power']);
}

/** One drawn label, matched whole — a bare string is a substring match. */
function exactly(label: string): RegExp {
  return new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'iu');
}

/** Opens one segment of the anatomy strip, by the word it draws. */
async function openMode(page: Page, label: string): Promise<void> {
  await page.locator('ednb-hull-anatomy .anatomy__modes button').filter({ hasText: label }).click();
  await expect(page.locator('ednb-power-thermals .power')).toBeVisible();
}

/** The cells of one table in the dashboard, row by row. */
async function rows(page: Page, selector: string): Promise<string[][]> {
  return page
    .locator(`${selector} tbody tr`)
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        [...node.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').trim()),
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
 * The canvas sets its tile and column labels in caps, and the design system
 * draws that in CSS rather than in the catalogue — the words a translator
 * writes stay sentence case. Comparing both ends in one case checks that the
 * right message reached the screen without asserting the treatment.
 */
function caps(text: string): string {
  return text.toLocaleUpperCase('en');
}

/**
 * Presses one segment of a segmented control and waits for it to say so.
 *
 * `settled` waits for animations to stop, which is not the same as waiting for
 * a redraw: with nothing animating it returns at once, and a zoneless
 * application can still be a frame short of having drawn the press. A table
 * read in that frame is the table from before it. The control publishes its own
 * pressed state from the same signal as the figures beside it, so once that
 * reads true those figures have been drawn again too.
 */
async function press(page: Page, segment: Locator): Promise<void> {
  await segment.click();
  await expect(segment).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
}

/**
 * Presses one of a bank's four pip blocks and waits for the bank to say so.
 *
 * Not `press`: a block is not a toggle with a pressed state. The six pips are
 * shared, so asking for three in one bank can leave another at a pip and a half,
 * and no block stands for that. What the bank does publish is the name of the
 * group the blocks sit in — the allocation it stands at — drawn from the same
 * signal as the recharge in the cell beside it, so once that name has moved the
 * figures in the row have been drawn again too.
 *
 * `settled` is not enough on its own here, for the reason given over `press`
 * and measurably so: in a loop that presses and reads, better than a third of
 * the reads come back as the allocation from before the press. It stays,
 * because a press the panel has answered may still be animating.
 */
async function pressPip(page: Page, block: Locator): Promise<void> {
  const bank = block.locator('xpath=..');
  const standing = await bank.getAttribute('aria-label');
  expect(standing, 'the pip group is named with the allocation it stands at').not.toBeNull();

  await block.click();
  await expect(bank).not.toHaveAttribute('aria-label', standing ?? '');
  await settled(page);
}

/** Puts the dashboard into its retracted condition. */
async function retractHardpoints(page: Page): Promise<void> {
  await press(
    page,
    page
      .locator('ednb-power-thermals .power__hardpoints button')
      .filter({ hasText: englishMessages['power.hardpoints.retracted'] }),
  );
}

/** The four scenario names the heat block draws, in order, from the catalogue. */
const FOUR_SCENARIOS = [
  englishMessages['power.heat.scenario.idle'],
  englishMessages['power.heat.scenario.thrusters'],
  englishMessages['power.heat.scenario.fsd-charging'],
  englishMessages['power.heat.scenario.firing-sustained'],
];

/** An optional mount on the stock hull that takes a size-6 shield cell bank. */
const BANK_SLOT = 'Slot04_Size6';

/** The stock hull's huge and large weapon mounts. */
const BEAM_SLOTS = ['HugeHardpoint1', 'LargeHardpoint1', 'LargeHardpoint2', 'LargeHardpoint3'];

/** The scenario names the heat block draws, in order. */
async function heatNames(page: Page): Promise<string[]> {
  return page
    .locator('.power__block--heat .heat__name button')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
}

/**
 * Fits the first module of one family that matches `variant` to one mount.
 *
 * Through the outfitting panel, as a Commander does it: the mount, the chooser,
 * the family, the row. The name is pressed rather than the row, because a click
 * in the gap between the identity and the figures lands on no content, and
 * Firefox then activates nothing.
 */
async function fitModule(
  page: Page,
  slot: string,
  family: RegExp,
  variant: RegExp = family,
): Promise<void> {
  await revealMount(page, slot);
  const mount = page.locator(`[data-slot-key="${slot}"] button`).first();
  await mount.click();
  await expect(mount).toHaveAttribute('aria-pressed', 'true');

  // Opens the chooser too, whichever surface this width draws it on.
  await revealFamilyHolding(page, family);
  const row = page
    .locator('.candidates__choices .candidate')
    .filter({ hasText: family })
    .filter({ hasText: variant })
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.locator('.candidate__name').click();
  if (await surfacesAreLayers(page)) {
    await page.getByRole('button', { name: /fit module/i }).click();
  }
  await fitCommitted(page);
  await expect(page.locator(`[data-slot-key="${slot}"]`).first()).toContainText(family);
  await settled(page);
}

test.describe('opening the layer', () => {
  test('retitles the region and replaces the plates with the panel', async ({ page }) => {
    await openPower(page);

    await expect(page.locator('ednb-hull-anatomy .anatomy__heading')).toHaveText(
      englishMessages['power.heading'],
    );
    // A title and nothing under it, which is all the canvas's switching script
    // carries per mode.
    await expect(page.locator('ednb-hull-anatomy .anatomy__title p')).toHaveCount(0);

    // The plates go with the mode. The canvas's switching script hides the
    // plate container outside `mounts`, so the side selector and the legend
    // that belong to the plates leave with them and the panel has the region to
    // itself (design/canvas-contract.md).
    await expect(page.locator('ednb-power-thermals')).toBeVisible();
    await expect(page.locator('ednb-hull-anatomy .anatomy__plates')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .anatomy__sides')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .anatomy__legend')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .schematic__mount')).toHaveCount(0);
  });

  test('leaves the mounts layer exactly as it was when the mode is closed', async ({ page }) => {
    await openPower(page);
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: englishMessages['anatomy.mode.mounts'] })
      .click();

    await expect(page.locator('ednb-power-thermals')).toHaveCount(0);
    await expect(page.locator('ednb-hull-anatomy .anatomy__heading')).toHaveText(
      englishMessages['anatomy.heading'],
    );
    // The plates are back, drawing their node numbers and carrying no trace of
    // the mode that replaced them.
    await expect(page.locator('ednb-hull-anatomy .anatomy__plates')).toBeVisible();
    await expect(page.locator('ednb-hull-anatomy .schematic__mount[data-power]')).toHaveCount(0);
  });
});

/**
 * The priority-group rows as the canvas draws them: a group, a draw, and either
 * a cumulative percentage or the word that replaces it.
 */
async function bandRows(page: Page): Promise<{ group: string; draw: string; tail: string }[]> {
  return page.locator('.power__block--bands .power__band').evaluateAll((nodes) =>
    nodes.map((node) => ({
      group: node.querySelector('.power__band-group')?.textContent?.trim() ?? '',
      draw: node.querySelector('.power__band-draw')?.textContent?.trim() ?? '',
      tail:
        node.querySelector('.power__band-share')?.textContent?.trim() ??
        node.querySelector('.power__band-state')?.textContent?.trim() ??
        '',
    })),
  );
}

test.describe('reading the build', () => {
  test('states power groups and the labelled module totals', async ({ page }) => {
    await openPower(page);
    await test.step('draws every group the build uses, each stating its own verdict', async () => {
      const bands = await bandRows(page);
      // The groups this build puts something in, in the package's order. The game
      // has five; a group nothing is assigned to is not a reading of this build.
      expect(bands.length).toBeGreaterThan(0);
      expect(bands.length).toBeLessThanOrEqual(5);
      const numbers = bands.map((band) => Number(digits(band.group)));
      expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
      for (const band of bands) {
        expect(band.group).toMatch(/^Group [1-5]$/u);
        expect(band.draw).toMatch(/MW$/u);
        // A lit group states its share of plant output; a shed one states the
        // word the canvas puts in that column instead.
        expect(band.tail).toMatch(
          new RegExp(`^(\\d+%|${englishMessages['power.bands.offline']})$`, 'u'),
        );
      }
      expect(bands.some((band) => band.tail.endsWith('%'))).toBe(true);
    });
    await test.step('lists the drawing modules against a total that they add up to', async () => {
      const list = page.locator('ednb-power-thermals .module');
      const drawn = await list.count();
      expect(drawn).toBeGreaterThan(0);

      const draws = await list.locator('.module__draw').allInnerTexts();
      const figures = draws.map((text) => Number(text.replace(/[^\d.]/gu, '')));
      // Heaviest first, as the canvas orders its list.
      expect(figures).toEqual([...figures].sort((left, right) => right - left));

      // The row closing the list is the whole list added up, so the two readings
      // on this block have to agree without either being written down.
      const closing = await page.locator('.modules__total-draw').innerText();
      const total = Number((closing.match(/[\d.]+/u) ?? ['0'])[0]);
      const added = figures.reduce((sum, figure) => sum + figure, 0);
      expect(Math.abs(added - total)).toBeLessThan(0.05 * drawn);
    });
    await test.step('heads the list and closes it in the canvas’s own words', async () => {
      // `MODULE` against `MW` over the tracks, and `TOTAL DRAW` under them. The
      // note that used to sit beside the heading is withdrawn with the revision.
      expect(caps(await page.locator('.modules__head-name').innerText())).toBe(
        caps(englishMessages['power.modules.column.name']),
      );
      expect(caps(await page.locator('.modules__head-draw').innerText())).toBe(
        caps(englishMessages['power.unit.megawatts']),
      );
      expect(caps(await page.locator('.modules__total-label').innerText())).toBe(
        caps(englishMessages['power.modules.total-draw']),
      );
      await expect(page.locator('.power__block--modules .power__note')).toHaveCount(0);
    });
  });

  test('draws the four heat scenarios in order, no key, and the two tiles', async ({ page }) => {
    await openPower(page);

    // The trigger's own text, which is the only thing the row draws. The gloss
    // behind it is the tooltip's and is asserted on its own below. The stock
    // build carries no shield cell bank, so the four scenarios are every bar.
    expect(await heatNames(page)).toEqual(FOUR_SCENARIOS);
    await expect(page.locator('.power__block--heat')).not.toContainText('Weapons alpha');

    // Every bar states its own reading beside itself, so nothing on this block
    // is carried by the length of a fill alone.
    const levels = await page.locator('.power__block--heat .heat__level').allInnerTexts();
    expect(levels).toHaveLength(FOUR_SCENARIOS.length);
    for (const level of levels) {
      expect(level.trim()).not.toBe('');
    }

    // The line every bar is measured against is drawn through the bars and is
    // not captioned, and no key names the two fills.
    await expect(page.locator('.heat__threshold-label')).toHaveCount(0);
    await expect(page.locator('.power__block--heat .heat__legend')).toHaveCount(0);
    await expect(page.locator('.power__block--heat .heat__key')).toHaveCount(0);

    const tiles = await page
      .locator('.power__block--heat .power__facts .metric__label')
      .allInnerTexts();
    expect(tiles.map((tile) => caps(tile.trim()))).toEqual([
      caps(englishMessages['power.heat.dissipation']),
      caps(englishMessages['power.heat.sinks']),
    ]);
  });

  test('draws the shield cell bank bar after the four scenarios where a bank is fitted', async ({
    page,
  }) => {
    await page.goto(`/ships/${HULL}`);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await fitModule(page, BANK_SLOT, /shield cell bank/iu);
    await openMode(page, englishMessages['anatomy.mode.power']);

    expect(await heatNames(page)).toEqual([
      ...FOUR_SCENARIOS,
      englishMessages['power.heat.scenario.shield-bank'],
    ]);
  });

  test('says an overheating sustained-fire bar is over threshold, and its block passes a scan', async ({
    page,
  }) => {
    // Four fits through the outfitting panel, in every layout profile.
    test.slow();
    await page.goto(`/ships/${HULL}`);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    // A fixed beam laser in the huge mount and in each large one: the package
    // states that sustained fire on this build never settles.
    for (const slot of BEAM_SLOTS) {
      await fitModule(page, slot, /beam laser/iu, /Fixed\s*[34][A-E]/u);
    }
    await openMode(page, englishMessages['anatomy.mode.power']);

    const sustained = page
      .locator('.power__block--heat .heat__bar')
      .filter({ hasText: englishMessages['power.heat.scenario.firing-sustained'] });
    await expect(sustained).toHaveClass(/heat__bar--over/u);
    // The hatch beside the level figure for a reader who sees it, and the words
    // after the level for a reader who is told.
    await expect(sustained.locator('.heat__over')).toHaveCount(1);
    expect(await sustained.locator('.heat__level').ariaSnapshot()).toContain(
      englishMessages['power.heat.over'],
    );

    // A bar inside the limit carries neither.
    const idle = page.locator('.power__block--heat .heat__bar').first();
    await expect(idle).not.toHaveClass(/heat__bar--over/u);
    expect(await idle.ariaSnapshot()).not.toContain(englishMessages['power.heat.over']);

    await settled(page);
    const scan = await new AxeBuilder({ page })
      .include('ednb-power-thermals .power__block--heat')
      .withTags([...AXE_TAGS])
      .analyze();
    expect(scan.violations).toEqual([]);
  });

  test('sets every distributor figure flush to the end of its own column', async ({ page }) => {
    // Measured against each cell's own trailing content edge, not against the
    // figures beside it: this table's three banks draw equal-width figures down
    // every column, so siblings share an edge whichever way the column is
    // aligned and a comparison between them proves nothing.
    await openPower(page);

    // Only where the table is drawn as a table. Below 30rem the block has no
    // room for five columns and draws three lines a bank instead, each figure
    // beside the label that would have headed its column — so there is no
    // column for a figure to be flush to, and the arrangement is asserted by the
    // journey that owns it (`draws three lines to a bank` below).
    // Read from the per-figure labels rather than from the header row: the
    // header is hidden the accessible way when the columns go, which leaves it
    // a one-pixel box that still answers `visible`. The labels are drawn or they
    // are not.
    if (await page.locator('.distributor__label').first().isVisible()) {
      return;
    }

    const cells = await page
      .locator('.distributor tbody .distributor__cell--numeric')
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
          const range = node.ownerDocument.createRange();
          range.selectNodeContents(node);
          const drawn = range.getBoundingClientRect();
          return { edge, figure: rtl ? drawn.left : drawn.right };
        }),
      );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(Math.abs(cell.figure - cell.edge)).toBeLessThanOrEqual(1);
    }
  });

  test('says what every scenario name is shorthand for, in a tooltip rather than a title', async ({
    page,
  }) => {
    await openPower(page);

    const bars = page.locator('.power__block--heat .heat__bar');
    const drawn = await bars.count();
    expect(drawn).toBe(FOUR_SCENARIOS.length);

    // One gloss per bar, related to the name it explains and in the document
    // rather than in a `title` or a `data-tip` — those are unreachable by touch
    // and unreliably announced (011 FR-006).
    const tips = bars.locator('.heat__description [role="tooltip"]');
    await expect(tips).toHaveCount(drawn);
    const texts = await tips.evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim() ?? ''),
    );
    for (const text of texts) {
      expect(text).not.toBe('');
    }
    expect(texts[0]).toBe(englishMessages['power.heat.scenario.idle.description']);
    await expect(bars.locator('[data-tip]')).toHaveCount(0);
    await expect(bars.locator('[title]')).toHaveCount(0);

    const first = bars.first();
    const trigger = first.locator('.heat__description button');
    const tip = first.locator('.heat__description [role="tooltip"]');

    // Related to its trigger whether or not it is drawn, so a reader who is
    // told the interface has the gloss without having to find a control. Which
    // is also why the closed state is asserted on the class and the trigger's
    // own `aria-expanded` rather than on visibility: undrawn here means the
    // same screen-reader-only text every other text equivalent in this
    // application is, not an element taken out of the page.
    expect(await trigger.getAttribute('aria-describedby')).toBe(await tip.getAttribute('id'));
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(tip).not.toHaveClass(/tooltip__tip--shown/);

    // Hover draws it: the reading the canvas hangs on its `data-tip`, and the
    // one a pointer expects.
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(tip).toHaveClass(/tooltip__tip--shown/);
    const bubble = await tip.boundingBox();
    expect(bubble?.width ?? 0).toBeGreaterThan(1);

    // Drawn, it never pushes the document sideways.
    await expectNoDocumentOverflow(page);

    // And the pointer can travel from the name to the bubble to read it —
    // SC 1.4.13's "hoverable". The crossing is the interesting part: the bubble
    // stands off its trigger by a gap, and an unbridged gap collapses the tip
    // the instant the pointer enters it, which is a failure no amount of DOM
    // parentage prevents.
    const name = await trigger.boundingBox();
    expect(name).not.toBeNull();
    expect(bubble).not.toBeNull();
    for (const y of [(name?.y ?? 0) + (name?.height ?? 0) + 1, (bubble?.y ?? 0) + 1]) {
      await page.mouse.move((bubble?.x ?? 0) + (bubble?.width ?? 0) / 2, y);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }

    // The pointer leaving takes it back.
    await page.mouse.move(0, 0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // `Escape` puts away a tip a hover opened, with nothing inside it focused —
    // which is the case that criterion's dismissal exists for, and the case a
    // listener on the tooltip's own element would never hear.
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Dismissed, not disabled: the pointer leaving and coming back draws it again.
    await page.mouse.move(0, 0);
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(0, 0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // A press reaches the same gloss, because touch has no hover at all — a tap
    // where the profile has touch, a click where it does not. A press pins the
    // tip open whichever pointer it came from, and a press on a pinned tip puts
    // it away, so the control reads the same on a phone as on a desk.
    const touch = test.info().project.use.hasTouch === true;
    const press = async () => (touch ? trigger.tap() : trigger.click());

    await press();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await press();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('draws the three capacitors with their own figures', async ({ page }) => {
    await openPower(page);

    const banks = await rows(page, '.distributor');
    expect(banks.map((row) => row[0])).toEqual([
      englishMessages['power.distributor.bank.systems'],
      englishMessages['power.distributor.bank.engines'],
      englishMessages['power.distributor.bank.weapons'],
    ]);
    for (const bank of banks) {
      // The capacity is `MW` and the two rates are `MJ/s`: the pool takes the
      // unit the game's own outfitting panel writes after it so the two panels
      // read as one figure, and the rates keep the unit they are actually in
      // (ruled 2026-08-27). The three columns no longer share a unit, which is
      // what stopped the pool reading as a third rate.
      expect(bank[1]).toMatch(/\d MW$/u);
      expect(bank[2]).toMatch(/\d MJ\/s$/u);
      expect(bank[4]).toMatch(/\d MJ\/s$/u);
    }
  });
});

test.describe('the conditions', () => {
  test('draws the hardpoint caption and names the pair by it', async ({ page }) => {
    await openPower(page);

    const caption = page.locator('ednb-power-thermals .power__hardpoints .tab-group__label');
    await expect(caption).toBeVisible();
    expect(caps(await caption.innerText())).toBe(caps(englishMessages['power.hardpoints.label']));

    // Named *by* the caption rather than by a string only a screen reader gets,
    // so the visible name and the accessible name are one string.
    const group = page.locator('ednb-power-thermals .power__hardpoints [role="group"]');
    await expect(group).toHaveAttribute(
      'aria-labelledby',
      (await caption.getAttribute('id')) ?? '',
    );
  });

  test('stowing the hardpoints moves every figure and states what is missing', async ({ page }) => {
    await openPower(page);
    const bands = page.locator('.power__block--bands .power__band');
    const deployed = await bands.first().innerText();
    const summary = page.locator('ednb-power-thermals .power__summary');

    // The canvas's three tiles, and only those three: no headroom, no
    // utilisation and no verdict.
    const shown = caps(await summary.innerText());
    expect(shown).toContain(caps(englishMessages['power.summary.plant']));
    expect(shown).toContain(caps(englishMessages['power.summary.draw']));
    expect(shown).toContain(caps(englishMessages['power.summary.unpowered']));

    await retractHardpoints(page);

    // Stowing moves the figures rather than removing any: all three tiles hold
    // in either state, which is why the canvas draws no sentence about what is
    // missing and neither does this.
    expect(await bands.first().innerText()).not.toBe(deployed);
    const stowed = caps(await summary.innerText());
    expect(stowed).toContain(caps(englishMessages['power.summary.plant']));
    expect(stowed).toContain(caps(englishMessages['power.summary.unpowered']));
  });

  test('setting a bank’s pips takes them out of the other two', async ({ page }) => {
    await openPower(page);
    const before = await rows(page, '.distributor');

    // The fourth block on systems: four pips there, and there are only six.
    const systems = page.locator('.distributor tbody tr').first().locator('.pips__step');
    await pressPip(page, systems.nth(3));

    const after = await rows(page, '.distributor');
    expect(after[0][4]).not.toBe(before[0][4]);
    // Capacity and rated recharge are properties of the fitted distributor, and
    // no allocation moves them.
    expect(after[0][1]).toBe(before[0][1]);
    expect(after[0][2]).toBe(before[0][2]);
    expect(after[1][1]).toBe(before[1][1]);
    expect(after[2][1]).toBe(before[2][1]);
    // The other two paid for it, so their recharges moved as well.
    expect(after[1][4]).not.toBe(before[1][4]);
    expect(after[2][4]).not.toBe(before[2][4]);
  });

  test('offers no draft, no apply, no reset and no error text', async ({ page }) => {
    await openPower(page);

    const panel = page.locator('ednb-power-thermals');
    await expect(panel).not.toContainText('Apply');
    await expect(panel).not.toContainText('Reset');
    await expect(panel.locator('.field__error')).toHaveCount(0);
  });

  test('changes no build, no history, no fragment and nothing stored', async ({ page }) => {
    await openPower(page);
    // Read after the link is published, not just after the route resolves:
    // feature 002 writes the fragment a moment behind the build landing, and a
    // value captured before then would make that arrival look like a change
    // this capability made. Only this test reads the URL, so only this test
    // waits for it.
    await expect(page).toHaveURL(/\/outfitting#b\./);
    const fragment = new URL(page.url()).hash;

    await retractHardpoints(page);
    await pressPip(
      page,
      page.locator('.distributor tbody tr').first().locator('.pips__step').first(),
    );

    expect(new URL(page.url()).hash).toBe(fragment);
    // Neither condition is part of the build, so neither reaches storage: a
    // reload opens on the state the panel opens on.
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage)));
    expect(stored).not.toContain('retracted');
    expect(stored).not.toContain('pips');
  });
});

/**
 * A build whose plant cannot cover it, made the way a Commander makes one.
 *
 * The smallest hull has the least headroom, so one hungry utility module is
 * the whole journey. It is then moved to a priority group of its own, which
 * is what leaves the rest of the build lit and one group dark — the artboard's
 * own case, and the one the badge is drawn for. With everything in group 1
 * instead, that single group goes dark and the plant lights nothing, which is
 * a real reading but a degenerate one to measure a share against.
 *
 * Nothing here writes down a megawatt: what is asserted is that the dashboard
 * reports a dark group and that what reads it agrees with it.
 */
async function shedBuild(page: Page): Promise<void> {
  await page.goto('/ships/SideWinder');
  await buildStockHull(page, englishMessages['hullDetail.create']);

  const mount = await revealMount(page, 'TinyHardpoint1');
  await mount.click();
  // Whichever manifest this width draws: the accordion opens with every
  // family shut, and the rail reveals exactly one at a time, so neither puts
  // an arbitrary candidate on screen by itself.
  await revealFamilyHolding(page, /cargo scanner/i);
  const scanner = page
    .locator('.candidates__choices .candidate')
    .filter({ hasText: /cargo scanner/i })
    .first();
  await scanner.scrollIntoViewIfNeeded();
  // The name rather than the row: a row's centre falls in the gap between the
  // identity and the figures, and a click landing on no content activates no
  // label in Firefox.
  await scanner.locator('.candidate__name').click();
  // Canvas 1c fits inline on that click; canvas 1d's chooser is a screen of
  // its own, so leaving it is the decision.
  if (await surfacesAreLayers(page)) {
    await page.getByRole('button', { name: /fit module/i }).click();
  }
  await fitCommitted(page);

  // Into a group of its own. The options carry the package's own 0-based
  // priority and are labelled with the 1-based group a Commander reads, so
  // `'1'` here is the `2` on screen. Located again after the fit rather than
  // through the handle the chooser was opened from: the ledger redraws the
  // row around the module now in the mount.
  await revealMount(page, 'TinyHardpoint1');
  await page
    .locator('[data-slot-key="TinyHardpoint1"] .power__priority')
    .first()
    .selectOption({ value: '1' });

  await page
    .locator('ednb-hull-anatomy .anatomy__modes button')
    .filter({ hasText: englishMessages['anatomy.mode.power'] })
    .click();
  await expect(page.locator('ednb-power-thermals .power')).toBeVisible();
  await expect(page.locator('ednb-power-thermals .power__band--offline')).not.toHaveCount(0);
}

test.describe('the status rail', () => {
  test('states the plant, bar and read-only controls', async ({ page }) => {
    await openPower(page);
    await test.step('states the plant against the draw, and the remainder the canvas states', async () => {
      const line = page.locator('ednb-power-summary .rail-power');
      let figures = '';
      // Read in the rail and compared in the dashboard, in that order: canvas 1d
      // draws one segment at a time, so the two readings are two visits there.
      await inTheRail(page, async () => {
        await expect(line).toBeVisible();
        await expect(line.locator('.rail-power__label')).toHaveText(
          englishMessages['power.rail.label'],
        );
        figures = await line.locator('.rail-power__figures').innerText();
      });
      expect(figures).toMatch(/MW/u);

      // The rail's draw is the same figure the dashboard's summary carries.
      const summary = await page.locator('ednb-power-thermals .power__summary').innerText();
      expect(digits(summary)).toContain(digits(figures.split('of')[0]));

      // The canvas's `· 7.80 OFF` suffix stands exactly where there is a
      // remainder to state, which is where the dashboard draws a dark group.
      const dark = await page.locator('ednb-power-thermals .power__band--offline').count();
      expect(caps(figures).includes('OFF')).toBe(dark > 0);
    });
    await test.step('draws the bar of the same figures, named rather than left a shape', async () => {
      await revealStatusRail(page);

      const bar = page.locator('ednb-power-summary .rail-bar');
      await expect(bar).toBeVisible();
      // The lengths carry no reading the line above does not, so the bar says in
      // words what it is showing rather than leaving it to the amber.
      await expect(bar).toHaveAttribute('aria-label', /\d/u);
      await expect(bar.locator('.rail-bar__plant')).toBeVisible();
    });
    await test.step('keeps the figures, the bar and the sentence read-only', async () => {
      // The pips are the block's only control; neither reading above them is
      // interactive, exactly as the canvas draws them.
      for (const selector of ['.rail-power', '.rail-bar']) {
        await expect(
          page.locator(
            `ednb-power-summary ${selector} button, ednb-power-summary ${selector} a, ednb-power-summary ${selector} input`,
          ),
        ).toHaveCount(0);
      }
    });
  });

  test('keeps the shed sentence read-only too', async ({ page }) => {
    // On a build that sheds nothing there is no sentence, and a count of zero
    // controls inside a component that drew nothing proves nothing. So this is
    // asked of a build the plant cannot cover.
    await shedBuild(page);
    await revealStatusRail(page);

    const statements = page.locator('ednb-power-shed-statements .statement');
    await expect(statements.first()).toBeVisible();

    await expect(
      page.locator(
        'ednb-power-shed-statements button, ednb-power-shed-statements a, ednb-power-shed-statements input',
      ),
    ).toHaveCount(0);
  });

  test('states a shed group in the build status block, and not in the power one', async ({
    page,
  }) => {
    await shedBuild(page);

    // The dashboard is what says a group is dark, and the sentence answers to
    // the same projection.
    const dark = await page.locator('ednb-power-thermals .power__band--offline').count();
    expect(dark).toBeGreaterThan(0);

    await inTheRail(page, async () => {
      // Feature 005 owns the sentence; feature 003's block is where it is
      // drawn, under the package's own validation issues (005/FR-013).
      const statements = page.locator('.outfitting__status-head .statement');
      await expect(statements).toHaveCount(dark);
      await expect(statements.first()).toBeVisible();
      // Not in this feature's own block as well: on the screen twice is one
      // sentence too many.
      await expect(page.locator('ednb-power-summary .statement')).toHaveCount(0);
    });
  });
});

test.describe('the compact strip’s power badge', () => {
  test('draws no badge at all where the plant covers the build', async ({ page }) => {
    await openPower(page);

    // The badge is a warning, and a warning drawn over a build with nothing
    // wrong with it is a warning a Commander learns to stop reading (005/FR-014,
    // Commander request 2026-08-30). The stock hull's plant covers it, so there
    // is nothing here to warn about at any width — canvas 1c never draws the
    // plate, and canvas 1d draws it only on a build that sheds.
    await expect(page.locator('ednb-power-thermals .power__band--offline')).toHaveCount(0);
    await expect(page.locator('ednb-power-badge .badge')).toHaveCount(0);

    // And the share is not lost with it: the rail states the whole budget in
    // figures, on every build, one segment away.
    await revealStatusRail(page);
    await expect(page.locator('ednb-power-summary .rail-power__figures')).toContainText(/\d/u);
  });

  test('gives the six key figures the whole strip where no badge is drawn', async ({ page }) => {
    await openPower(page);

    if (await statusRailIsColumn(page)) {
      await expect(page.locator('.outfitting__key-figures')).toHaveCount(0);
      return;
    }

    // The other half of the same rule. A badge inside the six's own grid spans
    // every track of it, so `auto-fit` can collapse none of them and the
    // readings sit at their floor across a strip with half of it blank
    // (Commander request 2026-08-30). The badge is outside that grid, and
    // absent here, so the six take the strip.
    const spread = await page.locator('.outfitting__key-figures').evaluate((strip: HTMLElement) => {
      const style = getComputedStyle(strip);
      const cells = [...strip.querySelectorAll('.metric')];
      const first = cells[0]!.getBoundingClientRect();
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      const box = strip.getBoundingClientRect();
      return {
        count: cells.length,
        rows: new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().top))).size,
        covered: last.right - first.left,
        strip: box.width,
        // What is left between the last reading and the strip's own content
        // edge, which is the space an absent badge would otherwise still hold.
        trailingGap: box.right - parseFloat(style.paddingRight) - last.right,
      };
    });

    expect(spread.count).toBe(6);
    // Whatever number of rows this width puts them on, they fill what they are
    // given rather than sitting at their floor with the rest of the strip empty.
    expect(spread.covered).toBeGreaterThan((spread.strip / spread.rows) * 0.8);

    // Right up to the edge. A badge that draws nothing is still a flex item
    // unless it takes itself out of the row, and a flex item is still one gap —
    // which would stand here on every build the plant covers, which is most of
    // them.
    expect(spread.trailingGap).toBeLessThan(1);
  });
});

test.describe('the compact strip’s power badge, on a build that sheds', () => {
  test('names each dark group, and holds no control', async ({ page }) => {
    await shedBuild(page);

    if (await statusRailIsColumn(page)) {
      // Canvas 1c has no strip and no badge: the rail beside the workspace
      // states the draw, the remainder and the bar in full, and a plate
      // repeating one of those a track away would be the same reading twice.
      await expect(page.locator('ednb-power-badge .badge')).toHaveCount(0);
      return;
    }

    const badge = page.locator('ednb-power-badge .badge');
    await expect(badge).toBeVisible();

    // A reading, like every other cell in the strip.
    await expect(badge.locator('button, a, input, [tabindex]')).toHaveCount(0);

    // The share, then one line per dark group the dashboard draws — never a
    // single line counting them, which the artboard never prints.
    const dark = await page.locator('ednb-power-thermals .power__band--offline').count();
    const spoken = await page.locator('ednb-power-badge .badge__words').allInnerTexts();
    expect(spoken.length).toBe(dark + 1);
  });

  test('states the lit share of plant output, not of the whole demand', async ({ page }) => {
    await shedBuild(page);

    if (await statusRailIsColumn(page)) {
      return;
    }

    const badge = page.locator('ednb-power-badge .badge');
    const share = Number(
      /(\d+(?:[.,]\d+)?)\s*%/u.exec(await badge.innerText())?.[1] ?? '',
    ).valueOf();
    expect(Number.isFinite(share)).toBe(true);

    // Both figures are read off the rail on the same screen rather than written
    // down here: what is asserted is the relation between them.
    let figures = '';
    await inTheRail(page, async () => {
      figures = await page.locator('ednb-power-summary .rail-power__figures').innerText();
    });

    // `{{draw}} of {{available}}`, then ` · {{off}} off` on a build that sheds.
    // Every figure is taken through `digits`, which drops the separator a locale
    // chose: the three are all in megawatts to two places, so the ratios below
    // are the same ratios at whatever scale that leaves them on.
    const [reading = '', shed = ''] = figures.split('·');
    const [lit = '', available = ''] = reading.split(/\bof\b/u);
    const output = Number(digits(available));
    const poweredDraw = Number(digits(lit));
    const unpowered = Number(digits(shed));

    // The build this journey made draws more than its plant makes, which is why
    // a group is dark. That is the reading the badge is *not*.
    expect(unpowered).toBeGreaterThan(0);
    expect(poweredDraw + unpowered).toBeGreaterThan(output);

    // The badge counts only the draw the plant actually lights, so it cannot
    // exceed the output it is measured against — and it is below the share the
    // whole demand would have taken (FR-014).
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(100);
    expect(share).toBeLessThan(((poweredDraw + unpowered) / output) * 100);

    // And it is exactly the lit draw over that output, to the place it is drawn.
    expect(Math.abs(share - (poweredDraw / output) * 100)).toBeLessThanOrEqual(1);
  });

  test('stands beside the six figures, never over one of them', async ({ page }) => {
    // What the artboard's arrangement is for: the plate stands beside the six
    // readings rather than over them. It was drawn `position: absolute` across
    // `MASS` before the 2026-08-29 revision, so this is the regression the
    // placement exists to prevent (005/FR-014).
    //
    // Asserted at a doubled text size as well as at this profile's own, because
    // the strip's arrangement follows the space it is given at the size it is
    // given it: a placement that only holds while the six fit one row is not the
    // placement.
    for (const scale of [null, DOUBLED_TEXT]) {
      if (scale !== null) {
        await withRootTextScale(page, scale);
      }
      await shedBuild(page);

      if (await statusRailIsColumn(page)) {
        await expect(page.locator('ednb-power-badge .badge')).toHaveCount(0);
        return;
      }

      const boxes = await page
        .locator('.outfitting__key-figures')
        .evaluate((strip: HTMLElement) => {
          const box = (node: Element) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          };
          return {
            strip: box(strip),
            badge: box(strip.querySelector('ednb-power-badge')!),
            cells: [...strip.querySelectorAll('.metric')].map(box),
          };
        });

      expect(boxes.cells.length).toBe(6);
      for (const cell of boxes.cells) {
        const overlaps =
          boxes.badge.left < cell.right - 1 &&
          boxes.badge.right > cell.left + 1 &&
          boxes.badge.top < cell.bottom - 1 &&
          boxes.badge.bottom > cell.top + 1;
        expect(overlaps).toBe(false);
      }

      // And it closes the strip: the plate takes the trailing edge, so nothing
      // in the strip starts after it does.
      const trailing = Math.max(...boxes.cells.map((cell) => cell.right));
      expect(Math.round(boxes.badge.right)).toBeGreaterThanOrEqual(Math.round(trailing) - 1);
    }
  });
});

test.describe('the rail’s pip control', () => {
  test('draws the canvas’s three banks over four blocks each', async ({ page }) => {
    await openPower(page);

    const sets = page.locator('ednb-power-summary .pipset');
    await expect(sets).toHaveCount(3);
    await expect(page.locator('ednb-power-summary .pips__step')).toHaveCount(12);

    // Each group is named with the allocation it stands at, which is the
    // reading for anyone who cannot see four rectangles.
    for (const bank of ['systems', 'engines', 'weapons']) {
      await expect(
        page.locator(`ednb-power-summary .pipset[data-bank="${bank}"] .pips`),
      ).toHaveAttribute('aria-label', /\d/u);
    }
  });

  test('moves the same allocation the distributor table reads', async ({ page }) => {
    await openPower(page);
    const before = await rows(page, '.distributor');

    // Pressed in the rail, read back in the dashboard: one condition, drawn in
    // two places, rather than a second allocation of the rail's own.
    await inTheRail(page, () =>
      pressPip(
        page,
        page.locator('ednb-power-summary .pipset').first().locator('.pips__step').nth(3),
      ),
    );

    const after = await rows(page, '.distributor');
    expect(after[0][4]).not.toBe(before[0][4]);
    // The table's own blocks stand at the allocation the rail set, which is the
    // reading its group carries — the cell itself holds buttons and no text.
    await expect(page.locator('.distributor tbody tr').first().locator('.pips')).toHaveAttribute(
      'aria-label',
      /4/u,
    );
    // The other two paid for it, so their recharges moved as well.
    expect(after[1][4]).not.toBe(before[1][4]);
    expect(after[2][4]).not.toBe(before[2][4]);
    // Capacity is a property of the fitted distributor, and no allocation
    // moves it — from either surface.
    expect(after[0][1]).toBe(before[0][1]);
  });

  test('draws three lines to a bank where five columns do not fit', async ({ page }) => {
    await openPower(page);

    const labels = page.locator('.distributor__label');
    if (!(await labels.first().isVisible())) {
      // The block has room for its five columns here, and the header row heads
      // them. Nothing to check: this journey is about what it does when it has
      // not.
      await expect(page.locator('.distributor thead th')).toHaveCount(5);
      return;
    }

    // Every field the table would have carried is still carried, each beside the
    // label that would have headed its column — the bank, its capacity, its
    // rated recharge, its pips and its recharge at the allocation standing.
    const banks = page.locator('.distributor tbody tr');
    await expect(banks).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const bank = banks.nth(index);
      await expect(bank.locator('.distributor__label')).toHaveCount(2);
      await expect(bank.locator('.distributor__cell--capacity')).toHaveCount(1);
      await expect(bank.locator('.distributor__cell--rated')).toHaveCount(1);
      await expect(bank.locator('.distributor__cell--recharge')).toHaveCount(1);
      await expect(bank.locator('.pips__step')).toHaveCount(4);
    }

    // And it is still a table to a reader: the columns are an arrangement, not
    // the association between a figure and what it is a figure of.
    await expect(page.locator('.distributor')).toHaveAttribute('role', 'table');
    await expect(page.locator('.distributor tbody th[role="rowheader"]')).toHaveCount(3);
  });

  test('redraws from an allocation the distributor table set', async ({ page }) => {
    await openPower(page);
    const rail = page.locator('ednb-power-summary .pipset').first().locator('.pips');
    const standing = await rail.getAttribute('aria-label');

    // The reverse direction. Both surfaces call the same action, so neither can
    // hold a reading the other does not have.
    await pressPip(
      page,
      page.locator('.distributor tbody tr').first().locator('.pips__step').nth(3),
    );

    await expect(rail).not.toHaveAttribute('aria-label', standing ?? '');
  });

  test('is on screen in every anatomy mode, which is why it is here', async ({ page }) => {
    await openPower(page);
    await expect(page.locator('ednb-power-summary .pipset')).toHaveCount(3);

    // The distributor table is only in `POWER`; the rail is everywhere. Leaving
    // the mode must not take the control with it.
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: englishMessages['anatomy.mode.mounts'] })
      .click();

    await expect(page.locator('ednb-power-thermals .power')).toHaveCount(0);
    await expect(page.locator('ednb-power-summary .pipset')).toHaveCount(3);
  });

  test('holds the target floor on every block, at this project’s layout', async ({ page }) => {
    await openPower(page);

    // Counted before it is measured. `expectTargetSizes` asserts that nothing
    // it found is undersized, which a selector matching nothing satisfies just
    // as well — so without this the sweep would go green on a rail that drew no
    // control at all.
    await expect(page.locator('ednb-power-summary .pips__step')).toHaveCount(12);

    // Each project in the matrix is one of the five layout profiles, so this
    // measures the twelve blocks at all of them across the run. A pip block is
    // one of a row of four chips — the canvas draws it at 14 CSS pixels square
    // — so it is held to SC 2.5.8's 24-pixel floor rather than to the project's
    // stricter 44, which is what `DENSE_TARGETS` records. The distributor
    // cell's blocks hold the same size, and the sweep below measures those.
    await expectTargetSizes(page, 'ednb-power-summary .pips__step');
    await expectTargetSizes(page, 'ednb-power-thermals .pips__step');
  });

  test('offers no draft, no running total and no half-pip block', async ({ page }) => {
    await openPower(page);

    const block = page.locator('ednb-power-summary');
    await expect(block).not.toContainText('Apply');
    await expect(block).not.toContainText('Reset');
    // Four blocks a bank and no more: a fifth for none, or a half-pip block,
    // would be a control the canvas does not draw.
    await expect(block.locator('.pipset').first().locator('.pips__step')).toHaveCount(4);
  });

  test('stands on the same inset as the cells it heads', async ({ page }) => {
    await openPower(page);
    await revealStatusRail(page);

    // Canvas 1c draws this block and the metric cells under it inside one
    // padded block, which the workspace owns. So the figures start where the
    // cells start: an inset of this block's own would be a second one inside
    // that padding, and the reading would stand further in than the cells it
    // heads (`openspec/changes/archive/003-ship-statistics/design/status-rail.md`, "Items 3 to 5
    // are one block").
    const line = page.locator('ednb-power-summary .rail-power');
    const cells = page.locator('.outfitting__status-cells .metric');
    await expect(line).toBeVisible();

    // The band goes wherever the rail goes, so a rail that has been opened has
    // one at every composition (003/FR-024). How many cells are in it is the
    // contributing features' business, not this one's — what is under test here
    // is where the power line starts relative to them.
    expect(await cells.count()).toBeGreaterThan(0);

    // The leading edge of the grid, not of its first cell in DOM order: the
    // cells are two to a row, so mirrored the first of them is the one in the
    // trailing column and its own edge is a column in from the block's.
    // Both edges are read in the page, in one call: mixing Playwright's own
    // box with an in-page rect would round two independently-derived numbers
    // and leave a sub-pixel difference to land on.
    const [lineStart, gridStart] = await line.evaluate((node, selector) => {
      const cellStarts = [...document.querySelectorAll(selector)].map(
        (cell) => cell.getBoundingClientRect().left,
      );
      return [(node as HTMLElement).getBoundingClientRect().left, Math.min(...cellStarts)];
    }, '.outfitting__status-cells .metric');

    expect(Math.round(lineStart)).toBe(Math.round(gridStart));
  });
});

/** How the four blocks stand, and the panel's width against its one-row step. */
async function powerArrangement(
  page: Page,
): Promise<{ panelRem: number; stepRem: number; lefts: number[]; tops: number[] }> {
  // The distributor is a component of its own, so the fourth block carries
  // that component's tag rather than the panel's block class.
  return page.locator('ednb-power-thermals').evaluate((panel) => {
    const style = getComputedStyle(panel);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const inline =
      panel.getBoundingClientRect().width -
      Number.parseFloat(style.paddingInlineStart) -
      Number.parseFloat(style.paddingInlineEnd) -
      Number.parseFloat(style.borderInlineStartWidth) -
      Number.parseFloat(style.borderInlineEndWidth);
    const blocks = [...panel.querySelectorAll('.power__block, ednb-distributor-block')].map(
      (block) => block.getBoundingClientRect(),
    );
    return {
      panelRem: inline / rem,
      stepRem: Number.parseFloat(style.getPropertyValue('--power-row-min')),
      lefts: blocks.map((block) => Math.round(block.left)),
      tops: blocks.map((block) => Math.round(block.top)),
    };
  });
}

/** One row: four blocks on one top edge, in the order the canvas draws them. */
function expectOneRow({ lefts, tops }: { lefts: number[]; tops: number[] }): void {
  expect(new Set(tops).size, 'the four blocks share a top edge').toBe(1);
  expect(lefts, 'groups, modules, heat, distributor').toEqual([...lefts].sort((a, b) => a - b));
  expect(new Set(lefts).size).toBe(4);
}

/** Every figure in the panel that its box does not hold. */
async function cutPowerFigures(page: Page): Promise<string[]> {
  return page
    .locator(
      [
        '.power__band-draw',
        '.power__band-share',
        '.power__band-state',
        '.module__draw',
        '.modules__total-draw',
        '.heat__level',
        '.metric__number',
        '.metric__unit',
        '.distributor__cell--numeric > [data-bidi-isolate]',
        '.distributor__cell--recharge',
      ]
        .map((figure) => `ednb-power-thermals ${figure}`)
        .join(', '),
    )
    .evaluateAll((figures) =>
      figures
        .filter((figure) => figure.scrollWidth > figure.clientWidth + 1)
        .map((figure) => figure.textContent?.trim() ?? ''),
    );
}

/**
 * Every label in the panel that runs past its box with no `…` after it.
 *
 * A label drawn by `ednb-fit-text` that does not fit is marked
 * `data-text-reachable` and draws its `…`. One that runs past its box without
 * them is cut out of reach, or is a word broken where it should be cut.
 */
async function unmarkedPowerCuts(page: Page): Promise<string[]> {
  return page.locator('ednb-power-thermals ednb-fit-text').evaluateAll((labels) =>
    labels
      .filter((label) => {
        const value = label.querySelector('.fit-text__value');
        if (value === null || value.scrollWidth <= label.clientWidth + 1) {
          return false;
        }
        return (
          !label.hasAttribute('data-text-reachable') ||
          label.querySelector('.fit-text__more') === null
        );
      })
      .map((label) => label.textContent?.trim() ?? ''),
  );
}

/**
 * Every word in a panel label that runs onto a second line.
 *
 * A line may break between words and after a hyphen, a dash or a slash, and
 * nowhere else: a word too long for its box is cut with its `…`. Each word is
 * measured as a range of its own, so a word drawn on two lines gives two tops.
 */
async function brokenPowerWords(page: Page): Promise<string[]> {
  return page.locator('ednb-power-thermals .fit-text__value').evaluateAll((values) =>
    values.flatMap((value) => {
      const broken: string[] = [];
      const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const parent = node.parentElement;
        // A bubble is not on the line, and a visually hidden text is not drawn.
        if (
          parent === null ||
          parent.closest('[role="tooltip"]') !== null ||
          parent.getBoundingClientRect().width <= 1
        ) {
          continue;
        }
        for (const word of (node.textContent ?? '').matchAll(/[^\s/–—-]+[/–—-]?/gu)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          if (tops.size > 1) {
            broken.push(word[0]);
          }
        }
      }
      return broken;
    }),
  );
}

/**
 * Every two panel labels, one above the other, whose lines stand less than a
 * target apart.
 *
 * Any label can be cut, and a cut label draws a 24-pixel `…` target on its
 * line. Two labels in one column whose tops are closer than that draw two
 * targets that overlap (SC 2.5.8).
 */
async function crowdedPowerLabels(page: Page): Promise<string[]> {
  return page.locator('ednb-power-thermals').evaluate((panel) => {
    const labels = [...panel.querySelectorAll('ednb-fit-text')]
      .map((label) => ({ box: label.getBoundingClientRect(), text: label.textContent?.trim() }))
      .filter(({ box }) => box.width > 0);
    return labels.flatMap((upper, index) =>
      labels
        .slice(index + 1)
        .filter(({ box }) => {
          const across = Math.min(box.right, upper.box.right) - Math.max(box.left, upper.box.left);
          const apart = Math.abs(box.top - upper.box.top);
          return across > 0 && apart > 0.5 && apart < 23.5;
        })
        .map((lower) => `${upper.text} / ${lower.text}`),
    );
  });
}

test.describe('the conditions that break layouts', () => {
  test('lays the four blocks out in two rows of the same width, whatever it has', async ({
    page,
  }, testInfo) => {
    await openPower(page);

    // The panel draws the dashboard as one row from its own measured step, as
    // canvas 1c draws it on its 2020px artboard; as two rows of two — the
    // groups beside the module list, the heat profile beside the distributor —
    // from its 40rem step; and stacks all four below that. In two rows it picks
    // the arrangement for both rows: this counts the columns each pair is drawn
    // in and compares them, so a lower pair left running the full width under a
    // paired upper one fails at every profile wide enough to pair anything.
    // That is what stood the distributor a whole panel below the fold of a
    // region bounded by the column it sits in.
    const drawn = await powerArrangement(page);
    const { lefts, tops } = drawn;
    expect(lefts).toHaveLength(4);
    expect(drawn.stepRem).toBeGreaterThan(40);

    if (drawn.panelRem >= drawn.stepRem) {
      expectOneRow(drawn);
    } else {
      expect(new Set(lefts.slice(2)).size).toBe(new Set(lefts.slice(0, 2)).size);
      const paired = drawn.panelRem >= 40;
      expect(new Set(lefts.slice(0, 2)).size).toBe(paired ? 2 : 1);
      expect(new Set(lefts).size).toBe(paired ? 2 : 1);
      expect(new Set(tops).size).toBe(paired ? 2 : 4);
    }
    if (page.viewportSize()?.width === 1440 && page.viewportSize()?.height === 900) {
      expect(drawn.panelRem >= 40 && drawn.panelRem < drawn.stepRem).toBe(true);
    }

    // Canvas 1c's own width, where the panel stands in one row.
    if (testInfo.project.name.endsWith('-desktop')) {
      await page.setViewportSize({ width: 2020, height: 1228 });
      await settled(page);
      const wide = await powerArrangement(page);
      expect(wide.panelRem).toBeGreaterThanOrEqual(wide.stepRem);
      expectOneRow(wide);
    }
  });

  test('cuts a label that does not fit in one row with a reachable mark, and never a figure', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();
    await openPower(page, germanMessages);
    const panel = page.locator('ednb-power-thermals');

    // Below the one-row step a label wraps between words. A word too long for
    // its box is not broken: it is cut, with its `…`, like a line in one row.
    const below = await powerArrangement(page);
    expect(below.panelRem).toBeLessThan(below.stepRem);
    expect(await unmarkedPowerCuts(page)).toEqual([]);
    expect(await brokenPowerWords(page)).toEqual([]);
    expect(await crowdedPowerLabels(page)).toEqual([]);
    expect(await cutPowerFigures(page)).toEqual([]);
    if (testInfo.project.name.endsWith('-desktop')) {
      // At 1440 x 900 the summary tile is too narrow for the one German word.
      const plantBelow = panel
        .locator('.power__summary ednb-fit-text')
        .filter({ hasText: germanMessages['power.summary.plant'] });
      await expect(plantBelow).toHaveAttribute('data-text-reachable', '');
      await expect(plantBelow.locator('.fit-text__more')).toHaveCount(1);
    }

    if (testInfo.project.name.endsWith('-desktop')) {
      await page.setViewportSize({ width: 2020, height: 1228 });
      await settled(page);
      expectOneRow(await powerArrangement(page));

      // The tile label is cut, and its `…` shows the whole label.
      const plant = germanMessages['power.summary.plant'];
      const label = panel.locator('.power__summary ednb-fit-text').filter({ hasText: plant });
      await expect(label).toHaveAttribute('data-text-reachable', '');
      await expect(label.locator('.fit-text__value')).toHaveText(plant);
      // The mark's own box takes no height on the line, so the pointer goes
      // to the target drawn on it, as a Commander's pointer does.
      const mark = label.locator('.fit-text__more');
      await mark.locator('.tooltip__trigger').hover();
      await expect(mark.locator('.tooltip__tip--shown')).toBeVisible();
      await expect(mark.locator('.tooltip__tip--shown')).toHaveText(plant);
      await page.mouse.move(0, 0);

      // A cut scenario name is the trigger of its own gloss: its `…` is a
      // plain mark, the gloss shows the whole name before it, and a reader is
      // told the name once and the gloss once.
      const name = germanMessages['power.heat.scenario.firing-sustained'];
      const gloss = germanMessages['power.heat.scenario.firing-sustained.description'];
      const heat = panel.locator('.heat__name ednb-fit-text').filter({ hasText: name });
      await expect(heat).toHaveAttribute('data-text-reachable', '');
      await expect(heat.locator('.fit-text__more')).toHaveText('…');
      await expect(heat.locator('.fit-text__more ednb-tooltip')).toHaveCount(0);
      const trigger = heat.locator('.heat__description button');
      await expect(trigger).toHaveAccessibleName(name);
      await expect(trigger).toHaveAccessibleDescription(gloss);
      await trigger.hover();
      await expect(heat.locator('.tooltip__tip--shown')).toBeVisible();
      // The words drawn for the eye. The gloss a reader is told stays in the
      // bubble beside them, out of sight.
      await expect(heat.locator('.tooltip__tip--shown > [aria-hidden="true"]')).toHaveText(
        germanMessages['power.heat.scenario.whole']
          .replace('{{label}}', name)
          .replace('{{description}}', gloss),
      );
      await page.mouse.move(0, 0);

      // Every `…` drawn is a target of its own, clear of every other.
      expect(await crowdedPowerLabels(page)).toEqual([]);
      const marks = await panel
        .locator('.fit-text__more .tooltip__trigger')
        .evaluateAll((targets) => targets.map((target) => target.getBoundingClientRect().toJSON()));
      expect(marks.length).toBeGreaterThan(0);
      for (const [index, mark] of marks.entries()) {
        for (const other of marks.slice(index + 1)) {
          const overlap =
            Math.min(mark.right, other.right) > Math.max(mark.left, other.left) &&
            Math.min(mark.bottom, other.bottom) > Math.max(mark.top, other.top);
          expect(overlap, 'two `…` targets overlap').toBe(false);
        }
      }

      expect(await cutPowerFigures(page)).toEqual([]);
    }

    await context.close();
  });

  test('pads its blocks and a DISSIPATION tile at the compact measures, with the compact gaps', async ({
    page,
  }) => {
    await openPower(page);

    const measures = await page.locator('ednb-power-thermals').evaluate((panel) => {
      const px = (value: string) => Number.parseFloat(value);
      const heat = panel.querySelector('.power__block--heat') as HTMLElement;
      const heatStyle = getComputedStyle(heat);
      // The two items stacked first inside the heat block: its heading and the
      // bars with their tiles.
      const [head, body] = [...heat.children].map((child) => child.getBoundingClientRect());
      // The first two blocks, beside each other or one above the other.
      const [first, second] = [...panel.querySelectorAll('.power__block')].map((block) =>
        block.getBoundingClientRect(),
      );
      const beside = Math.round(first.top) === Math.round(second.top);
      const tile = panel.querySelector('.power__facts .metric') as HTMLElement;
      const tileStyle = getComputedStyle(tile);
      return {
        blockPaddingBlock: px(heatStyle.paddingBlockStart),
        blockPaddingInline: px(heatStyle.paddingInlineStart),
        stackGap: body.top - head.bottom,
        blockGap: beside
          ? Math.max(second.left - first.right, first.left - second.right)
          : second.top - first.bottom,
        tileLabel: tile.querySelector('.metric__label')?.textContent?.trim() ?? '',
        tilePaddingBlock: px(tileStyle.paddingBlockStart),
        tilePaddingInline: px(tileStyle.paddingInlineStart),
      };
    });

    expect(measures.blockPaddingBlock).toBeCloseTo(10, 0);
    expect(measures.blockPaddingInline).toBeCloseTo(12, 0);
    expect(measures.stackGap).toBeCloseTo(8, 0);
    expect(measures.blockGap).toBeCloseTo(10, 0);
    expect(caps(measures.tileLabel)).toBe(caps(englishMessages['power.heat.dissipation']));
    expect(measures.tilePaddingBlock).toBeCloseTo(6, 0);
    expect(measures.tilePaddingInline).toBeCloseTo(8, 0);
  });

  test('keeps every figure at doubled text without scrolling the document', async ({ page }) => {
    await withRootTextScale(page, DOUBLED_TEXT);
    await openPower(page);

    expect((await bandRows(page)).length).toBeGreaterThan(0);
    expect(await rows(page, '.distributor')).toHaveLength(3);
    // A doubled text size is where a word outgrows its box: it is cut with its
    // `…`, never broken mid-word.
    expect(await unmarkedPowerCuts(page)).toEqual([]);
    expect(await brokenPowerWords(page)).toEqual([]);
    await expectNoDocumentOverflow(page);
  });

  test('stacks its blocks at 400% zoom rather than scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await openPower(page);

    // Every block, at the narrowest width the matrix runs: the compact canvas
    // truncates the module list to five rows under a `TOP DRAW` heading and
    // drops the distributor's capacity and rated recharge. Neither is built.
    expect((await bandRows(page)).length).toBeGreaterThan(0);
    expect(await page.locator('.heat__bar').count()).toBe(FOUR_SCENARIOS.length);
    const banks = await rows(page, '.distributor');
    expect(banks[0][1]).toMatch(/\d MW$/u);
    // A label too long for its box is cut with its `…`, never broken mid-word.
    expect(await unmarkedPowerCuts(page)).toEqual([]);
    expect(await brokenPowerWords(page)).toEqual([]);
    await expectNoDocumentOverflow(page);
  });

  test('loses no figure in an expanded translation', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();
    await openPower(page, germanMessages);

    const bands = await bandRows(page);
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0].group).toBe('Gruppe 1');
    // German groups its decimals with a comma. The digits are unchanged:
    // formatting never alters a package number.
    expect(bands[0].draw).toMatch(/MW$/u);
    await expectNoDocumentOverflow(page);

    await context.close();
  });

  test('holds a drawn gloss inside the page at a doubled text size and mirrored', async ({
    page,
  }) => {
    // The bubble is capped against the viewport and hung off the leading edge
    // of its trigger, and both of those are the kind of measurement a text
    // scale or a mirrored direction breaks. Neither is exercised by the tip
    // being closed, so each is checked with one open.
    await withRootTextScale(page, DOUBLED_TEXT);
    await openPower(page);

    const trigger = page.locator('.power__block--heat .heat__description button').first();
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expectNoDocumentOverflow(page);

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await settled(page);
    await page.mouse.move(0, 0);
    await trigger.hover();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expectNoDocumentOverflow(page);
  });

  test('mirrors the layout without losing a figure', async ({ page }) => {
    await openPower(page);
    const before = await rows(page, '.distributor');

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await settled(page);

    expect(await rows(page, '.distributor')).toEqual(before);
    await expectNoDocumentOverflow(page);
  });

  test('loses no state with motion removed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPower(page);

    await retractHardpoints(page);

    // The requirement is not less animation: it is that no state was ever only
    // reachable through one. The bars are the part a transition could have been
    // carrying, so the figures beside them are what is read back.
    await expect(page.locator('.power__block--bands .power__band').first()).toContainText(
      englishMessages['power.unit.megawatts'],
    );
    await page.emulateMedia({ reducedMotion: null });
  });
});

test.describe('accessibility', () => {
  test('the dashboard passes a scan in both hardpoint states', async ({
    page,
  }, testInfo: TestInfo) => {
    await openPower(page);
    await sweepOutfittingState(page, testInfo, 'power-thermals/deployed');

    await retractHardpoints(page);
    await sweepOutfittingState(page, testInfo, 'power-thermals/retracted');
  });
});
