import { expect, test, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { sweepOutfittingState } from './accessibility';
import { expectNoDocumentOverflow, settled } from './accessibility/assertions';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import {
  fitCommitted,
  statusRailIsColumn,
  openChooserRows,
  revealMount,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { buildStockHull } from './shell';

/**
 * Drives & Mass, end to end.
 *
 * The unit suites already prove what the projection selects and which package
 * getter each figure came from. What only a browser can show is the rest: that
 * the mode strip actually opens the region, that the two cards survive a phone,
 * a doubled text size and a 400% zoom without losing a reading or scrolling the
 * document sideways, and that every reading canvas 1c draws — the headline
 * mass, the three-part split, the position on the curve and the `SCO` badge
 * among them — actually reaches a Commander's screen.
 *
 * Nothing here writes down a tonne or a light year. Every figure is read back
 * out of the running page and compared against another part of the same page
 * that has to agree with it.
 */

const HULL = 'Anaconda';
const ROUTE = `/ships/${HULL}`;

/** Creates a stock build and opens the anatomy region's `DRIVES` mode. */
async function openDrives(page: Page, messages = englishMessages): Promise<void> {
  await page.goto(ROUTE);
  await buildStockHull(page, messages['hullDetail.create']);

  await page
    .locator('ednb-hull-anatomy .anatomy__modes button')
    .filter({ hasText: messages['anatomy.mode.drives'] })
    .click();
  await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();
}

/** Every digit in a string, so a locale's own grouping cannot change the value. */
function digits(text: string): string {
  return text.replace(/\D/gu, '');
}

/**
 * Upper case, for comparing a drawn label with the message it came from.
 *
 * The canvas sets its card and section labels in caps and the design system
 * draws that in CSS, so the words a translator writes stay sentence case.
 */
function caps(text: string): string {
  return text.toLocaleUpperCase('en');
}

/**
 * Switches the thruster mount off through feature 002's own power control.
 *
 * The unavailable mobility state is reachable in a browser only this way, and
 * it is the state FR-005 is about — so it is reached rather than asserted at
 * the unit layer alone.
 */
async function switchThrustersOff(page: Page): Promise<void> {
  await revealMount(page, 'MainEngines');
  const mount = page.locator('.slot[data-slot-key="MainEngines"]');

  // The label is the control, and the rest of this suite drives it that way.
  // Its checkbox is a clipped one-pixel box, so forcing a pointer onto the box
  // itself aims at a coordinate the layout never promised belonged to it —
  // whatever the ledger happens to draw over that point at a given width
  // receives the click instead, and the state does not change. The label is
  // the drawn target with the 24px floor under it, at every width.
  await mount.locator('.power__switch').click();
  await expect(mount.locator('.power__toggle')).not.toBeChecked();
  await settled(page);
}

/**
 * Fits an Overcharge drive through feature 002's own chooser.
 *
 * The `SCO` badge is the one reading on either card with no stock hull to draw
 * it on, so the state has to be reached rather than asserted at the unit layer
 * alone. The catalogue marks the capability and the chooser names the module,
 * so the row is found by the name the catalogue gives it.
 */
async function fitOverchargeDrive(page: Page): Promise<void> {
  await revealMount(page, 'FrameShiftDrive');
  const mount = page.locator('[data-slot-key="FrameShiftDrive"] button').first();
  await mount.click();
  await expect(mount).toHaveAttribute('aria-pressed', 'true');

  await openChooserRows(page);
  const row = page
    .locator('.candidate')
    .filter({ hasText: /\(SCO\)/u })
    .first();
  await expect(row).toBeVisible();
  await row.locator('.candidate__name').click();
  if (await surfacesAreLayers(page)) {
    await page.getByRole('button', { name: /fit module/i }).click();
  }
  await fitCommitted(page);
  await settled(page);
}

test.describe('Drives & Mass', () => {
  test('the DRIVES mode opens the two cards canvas 1c draws', async ({ page }) => {
    await openDrives(page);

    const cards = page.locator('ednb-drives-mass .drives__card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.drives__card-heading')).toHaveText(
      englishMessages['drives.thrusters.heading'],
    );
    await expect(cards.nth(1).locator('.drives__card-heading')).toHaveText(
      englishMessages['drives.fsd.heading'],
    );

    // Each card is a region a reader can move to by name.
    for (const index of [0, 1]) {
      const labelledBy = await cards.nth(index).getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      await expect(page.locator(`#${labelledBy}`)).toBeVisible();
    }
  });

  test('leaving the mode gives feature 010’s plates back unchanged', async ({ page }) => {
    await page.goto(ROUTE);
    await buildStockHull(page, englishMessages['hullDetail.create']);

    // Two plates, top and bottom, and both have to come back. What is compared
    // is every mount's slot and its spoken name rather than the markup: the
    // schematic mints fresh relation ids each time it is drawn, so identical
    // HTML would be the wrong bar to clear.
    const plates = page.locator('ednb-hull-anatomy ednb-hull-schematic .schematic');
    await expect(plates).toHaveCount(2);
    await expect(plates.first()).toHaveAttribute('data-state', 'ready');
    await expect(plates.nth(1)).toHaveAttribute('data-state', 'ready');
    const mounts = page.locator('ednb-hull-anatomy .schematic__mount');
    const before = await mounts.evaluateAll((nodes) =>
      nodes.map((node) => `${node.getAttribute('data-slot')}/${node.getAttribute('aria-label')}`),
    );
    expect(before.length).toBeGreaterThan(0);

    const modes = page.locator('ednb-hull-anatomy .anatomy__modes button');
    await modes.filter({ hasText: englishMessages['anatomy.mode.drives'] }).click();
    await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();
    await expect(plates).toHaveCount(0);

    await modes.filter({ hasText: englishMessages['anatomy.mode.mounts'] }).click();
    await expect(plates).toHaveCount(2);
    await expect(plates.first()).toHaveAttribute('data-state', 'ready');
    await expect(plates.nth(1)).toHaveAttribute('data-state', 'ready');
    expect(
      await mounts.evaluateAll((nodes) =>
        nodes.map((node) => `${node.getAttribute('data-slot')}/${node.getAttribute('aria-label')}`),
      ),
    ).toEqual(before);
  });

  test('the headline mass and its place on the curve both reach the screen', async ({ page }) => {
    await openDrives(page);

    // The canvas's `1,142` and the `91% OF OPTIMAL MASS` beside it. Both are
    // package answers now, so both carry a figure rather than an explanation.
    await expect(page.locator('ednb-drives-mass .drives__headline-mass')).toHaveText(/\d/u);
    await expect(page.locator('ednb-drives-mass .drives__curve-position')).toHaveText(/\d/u);
    // A stock Anaconda's drive is not Overcharge-capable, and the canvas draws
    // a badge rather than a negation, so there is nothing to badge here.
    await expect(page.locator('ednb-drives-mass .drives__sco')).toHaveCount(0);
  });

  test('an Overcharge drive badges SCO, and says the words behind it only once', async ({
    page,
  }, testInfo) => {
    await openDrives(page);
    await fitOverchargeDrive(page);

    // On the card's own rule, beside the words it qualifies — the canvas gives
    // it no line of its own.
    const badge = page.locator('ednb-drives-mass .drives__card-heading:has(.drives__sco)');
    await expect(badge).toHaveCount(1);
    // The canvas draws three letters. The words behind the abbreviation are in
    // the markup for a reader who cannot see it and are spoken, never drawn —
    // component styles are scoped, so a card that did not define
    // `.visually-hidden` itself would print the whole sentence beside the
    // badge.
    await expect(badge.locator('.drives__sco')).toHaveText(englishMessages['drives.fsd.sco'], {
      useInnerText: true,
    });

    // The box, not the text: a 1px clipped span still reports its words to
    // `innerText`, and what separates spoken from drawn is the space it takes.
    // Without the rule this span lays out inline at the width of its sentence,
    // beside three letters the canvas draws alone.
    const hidden = badge.locator('.visually-hidden');
    await expect(hidden).toHaveText(englishMessages['drives.fsd.sco.description']);
    const box = await hidden.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(1);
    expect(box?.height).toBeLessThanOrEqual(1);

    await sweepOutfittingState(page, testInfo, 'drives and mass, overcharge drive');
  });

  test('every part of the mass bar carries a number and a length', async ({ page }) => {
    await openDrives(page);

    // The split is one package answer, so no part is drawn as a silent zero
    // beside two that are measured.
    const values = await page
      .locator('ednb-drives-mass .drives__card:first-child .drives__legend-value')
      .allTextContents();
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(value).toMatch(/\d/u);
    }

    const widths = await page
      .locator('ednb-drives-mass .drives__mass-part')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).getBoundingClientRect().width),
      );

    expect(widths).toHaveLength(3);
    for (const width of widths) {
      expect(width).toBeGreaterThan(0);
    }
  });

  test('the three parts are laid end to end and the optimal mark sits between them', async ({
    page,
  }) => {
    await openDrives(page);

    // The canvas's bar is additive: hull, then modules, then fuel, each
    // starting where the last ended, on a track that runs to the thrusters'
    // maximum. Read off the screen rather than off the view model, because
    // three parts that each started at zero would still have the widths the
    // unit suite checks.
    const boxes = await page.locator('ednb-drives-mass .drives__mass-part').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = (node as HTMLElement).getBoundingClientRect();
        return { start: box.left, end: box.right };
      }),
    );

    expect(boxes).toHaveLength(3);
    for (let index = 1; index < boxes.length; index += 1) {
      // Adjacent, within the hairline the canvas sets between them.
      expect(boxes[index].start).toBeGreaterThanOrEqual(boxes[index - 1].end);
      expect(boxes[index].start - boxes[index - 1].end).toBeLessThanOrEqual(2);
    }

    const bar = await page.locator('ednb-drives-mass .drives__mass-bar').evaluate((node) => {
      const box = (node as HTMLElement).getBoundingClientRect();
      return { start: box.left, end: box.right };
    });
    // A stock hull is under its own thrusters' maximum, so the parts stop short
    // of the end of the track.
    expect(boxes[2].end).toBeLessThan(bar.end);

    const mark = await page
      .locator('ednb-drives-mass .drives__mass-optimal')
      .evaluate((node) => (node as HTMLElement).getBoundingClientRect().left);
    expect(mark).toBeGreaterThan(bar.start);
    expect(mark).toBeLessThanOrEqual(bar.end);

    // And both ends of that scale are written out under it.
    const marks = await page.locator('ednb-drives-mass .drives__mass-mark-value').allTextContents();
    expect(marks).toHaveLength(2);
    for (const value of marks) {
      expect(value).toMatch(/\d/u);
    }
  });

  test('every bar is decoration with its own number beside it', async ({ page }) => {
    await openDrives(page);

    const tracks = page.locator(
      'ednb-drives-mass .drives__mass-bar, ednb-drives-mass .drives__envelope-track, ednb-drives-mass .drives__range-track',
    );
    expect(await tracks.count()).toBeGreaterThan(0);
    for (const track of await tracks.all()) {
      await expect(track).toHaveAttribute('aria-hidden', 'true');
    }

    // Each envelope row still says its own reading in text.
    const values = await page.locator('ednb-drives-mass .drives__envelope-value').allTextContents();
    expect(values).toHaveLength(5);
    for (const value of values) {
      expect(value).toMatch(/\d/u);
    }
  });

  test('the envelope follows the ENG allocation, and boost does not', async ({ page }) => {
    // Almanac 0.2.0 split a build's own flight model from what an allocation
    // makes of it, and FR-004 carries the split: `mobilityMetricsResult` owns
    // `boost` and takes no pips at all, `mobilityCapacitorMetricsResult` owns
    // the speed and the three rotations at the settled allocation. Only a
    // browser can show that the card is actually re-read when another feature's
    // control moves, and only this test can show the two results are not
    // borrowing figures from each other.
    await openDrives(page);

    const rows = page.locator('ednb-drives-mass .drives__envelope-row');
    // `allInnerTexts` does not retry, so the list is waited for first — the
    // same guard every other envelope assertion in this file opens with.
    await expect(rows).toHaveCount(5);
    const reading = async (): Promise<string[]> =>
      rows.locator('.drives__envelope-value').allInnerTexts();
    // `innerText` returns what the reader sees, and the design system sets
    // these labels in caps from CSS, so the row is found by the same `caps()`
    // the rest of this suite compares a drawn label with.
    const labels = await rows.locator('.drives__envelope-label').allInnerTexts();
    const rowFor = (key: 'drives.thrusters.boost' | 'drives.thrusters.speed'): number =>
      labels.findIndex((label) => caps(label.trim()) === caps(englishMessages[key]));
    const boost = rowFor('drives.thrusters.boost');
    const speed = rowFor('drives.thrusters.speed');
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(speed).toBeGreaterThanOrEqual(0);

    const before = await reading();

    // Through feature 005's own distributor, which is what settles the pips.
    // The dashboard opens on even thirds — two apiece, of six — so the first
    // step of the engines row moves the allocation the card is read at from two
    // pips to one.
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: englishMessages['anatomy.mode.power'] })
      .click();
    await expect(page.locator('ednb-power-thermals')).toBeVisible();
    await page.locator('.distributor tbody tr').nth(1).locator('.pips__step').first().click();
    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: englishMessages['anatomy.mode.drives'] })
      .click();
    await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();
    await settled(page);

    const after = await reading();

    // The top speed the capacitor result owns moved, so the card was re-read
    // rather than left standing at the allocation it was first drawn at. The
    // three rotations are the same result's and move with it, but whether each
    // moves far enough to change a drawn digit is the package's business and
    // not something this suite writes down.
    expect(after[speed]).not.toBe(before[speed]);

    // The boost the build's own flight model owns did not. A boost that
    // followed the pips would mean one result had been read for a figure the
    // other publishes, which is the seam FR-004 keeps apart.
    expect(after[boost]).toBe(before[boost]);
  });

  test('a switched-off mount reads as off, with the package’s own reasons', async ({
    page,
  }, testInfo) => {
    await page.goto(ROUTE);
    await buildStockHull(page, englishMessages['hullDetail.create']);
    await switchThrustersOff(page);

    await page
      .locator('ednb-hull-anatomy .anatomy__modes button')
      .filter({ hasText: englishMessages['anatomy.mode.drives'] })
      .click();
    await expect(page.locator('ednb-drives-mass .drives')).toBeVisible();

    // Off is not absent: the module is still fitted and still named, and the
    // card says which of the two states this is.
    await expect(page.locator('ednb-drives-mass .drives__state')).toHaveText(
      englishMessages['drives.source.off'],
    );

    // No envelope, and — the point of FR-005 — no hull catalogue speed standing
    // in for the reading the package declined to give.
    await expect(page.locator('ednb-drives-mass .drives__envelope')).toHaveCount(0);
    const issues = page.locator('ednb-drives-mass .drives__issues li');
    expect(await issues.count()).toBeGreaterThan(0);
    for (const issue of await issues.all()) {
      expect((await issue.textContent())?.trim().length).toBeGreaterThan(0);
    }

    // The curve marks stay: what the switch took away is the build's mobility,
    // not the module's own stats. So does the drive card beside it.
    await expect(page.locator('ednb-drives-mass .drives__mass-mark')).toHaveCount(2);
    await expect(page.locator('ednb-drives-mass .drives__range')).toHaveCount(3);

    // The unavailable state is a different DOM from the ready one — an
    // unavailable value and a named list of reasons where the envelope was — so
    // it is swept in its own right rather than covered by the ready sweep.
    await sweepOutfittingState(page, testInfo, 'drives and mass, mobility unavailable');
  });

  test('the drive’s own facts are the canvas’s legend and nothing more', async ({ page }) => {
    await openDrives(page);

    // The canvas's legend under the ranges — optimal mass, fuel per jump and the
    // whole tank. Three rows, because that is what the canvas draws; mass lock
    // is in the headline trio, where the canvas puts it.
    const facts = page.locator('ednb-drives-mass .drives__card:last-child .drives__legend-row');
    await expect(facts).toHaveCount(3);

    // Each row's name is the label's own text; the canvas's qualifier runs in
    // beside it as an element of its own.
    const labels = await facts
      .locator('.drives__legend-label')
      .evaluateAll((nodes) => nodes.map((node) => node.firstChild?.textContent?.trim() ?? ''));
    expect(labels).toEqual([
      englishMessages['drives.fsd.optimal-mass'],
      englishMessages['drives.fsd.maximum-fuel'],
      englishMessages['drives.fsd.total-range'],
    ]);
    for (const value of await facts.locator('.drives__legend-value').allTextContents()) {
      expect(value).toMatch(/\d/u);
    }
  });

  test('both cards rule their blocks off each other, as the canvas does', async ({ page }) => {
    await openDrives(page);

    // Canvas 1c draws one hairline in the thruster card — under the legend,
    // over `SPEED ENVELOPE AT THIS MASS` — and two in the drive card, under the
    // headline trio and under `RANGE BY LOAD`. Without them the blocks run into
    // one another and a card reads as one long list.
    const thrusters = page.locator('ednb-drives-mass .drives__card:first-child .drives__rule');
    const drive = page.locator('ednb-drives-mass .drives__card:last-child .drives__rule');
    await expect(thrusters).toHaveCount(1);
    await expect(drive).toHaveCount(2);

    // Decoration: they separate blocks a reader already reaches by heading and
    // by list.
    for (const rule of await page.locator('ednb-drives-mass .drives__rule').all()) {
      await expect(rule).toHaveAttribute('aria-hidden', 'true');
      const height = await rule.evaluate(
        (node) => (node as HTMLElement).getBoundingClientRect().height,
      );
      expect(height).toBeGreaterThan(0);
    }
  });

  test('a legend row keeps its qualifier beside its name, not under it', async ({ page }) => {
    await openDrives(page);

    // The canvas runs `ANACONDA · MILITARY GRADE` in after `Hull` as part of the
    // same run of text, with the figure at the end of the same row. Under it,
    // the qualifier would be a block of its own and the figure would float away
    // from the name it belongs to.
    const row = page.locator('ednb-drives-mass .drives__legend-row').first();
    const geometry = await row.evaluate((node) => {
      const label = node.querySelector('.drives__legend-label') as HTMLElement;
      const detail = node.querySelector('.drives__legend-detail') as HTMLElement;
      const value = node.querySelector('.drives__legend-value') as HTMLElement;

      // The name is the label's own text, before the qualifier inside it, so it
      // is measured over that text rather than over the element that carries
      // both. An inline box reports one rectangle per line it takes, and the
      // first of the qualifier's is the one that says which line it starts on.
      const name = document.createRange();
      name.selectNodeContents(label.firstChild as Node);

      return {
        inside: label.contains(detail),
        display: getComputedStyle(detail).display,
        name: name.getBoundingClientRect(),
        label: label.getBoundingClientRect(),
        detail: detail.getClientRects()[0],
        value: value.getBoundingClientRect(),
      };
    });

    // The qualifier is part of the name's own text rather than a block under
    // it: inside the name's element, laid out inline, and inside the box that
    // element occupies.
    expect(geometry.inside).toBe(true);
    expect(geometry.display).toBe('inline');
    expect(geometry.detail.top).toBeGreaterThanOrEqual(geometry.label.top - 1);
    expect(geometry.detail.bottom).toBeLessThanOrEqual(geometry.label.bottom + 1);

    // Where the row has the width for it — the width the canvas is drawn at —
    // the qualifier runs in after the name, on the name's own line. Where it
    // does not, it wraps to the next line of the same run, which is what text
    // does; holding it on one line would take the row off the card instead.
    const besideTheName = geometry.detail.top < geometry.name.bottom;
    if (besideTheName) {
      expect(geometry.detail.left).toBeGreaterThan(geometry.name.left);
    }

    // And the figure is still at the end of the same row, never under the name.
    expect(geometry.value.left).toBeGreaterThanOrEqual(geometry.label.right - 1);
  });

  test('the optimal mark is written under the tick it marks', async ({ page }) => {
    await openDrives(page);

    // The canvas centres `OPTIMAL 1,260 t` on its own tick and sets
    // `MAX 1,890 t` against the end of the track: where each mark sits *is* part
    // of the reading, which is why an over-mass build clips rather than
    // rescales.
    const geometry = await page.evaluate(() => {
      const tick = document.querySelector('.drives__mass-optimal') as HTMLElement;
      const bar = document.querySelector('.drives__mass-bar') as HTMLElement;
      const marks = [...document.querySelectorAll('.drives__mass-mark')] as HTMLElement[];
      return {
        tick: tick.getBoundingClientRect(),
        bar: bar.getBoundingClientRect(),
        optimal: marks[0].getBoundingClientRect(),
        max: marks[1].getBoundingClientRect(),
      };
    });

    // Centred on the tick, within a few pixels of rounding.
    const tickCentre = geometry.tick.left + geometry.tick.width / 2;
    const markCentre = geometry.optimal.left + geometry.optimal.width / 2;
    expect(Math.abs(markCentre - tickCentre)).toBeLessThanOrEqual(4);
    // And the maximum against the end of the track it names.
    expect(Math.abs(geometry.max.right - geometry.bar.right)).toBeLessThanOrEqual(4);
  });

  test('the drive card opens with the canvas’s own three cells', async ({ page }) => {
    await openDrives(page);

    // Canvas 1c heads the card `JUMP LADEN`, `JUMP UNLADEN`, `MASS LOCK` on one
    // hairline ground, above `RANGE BY LOAD`.
    const cells = page.locator('ednb-drives-mass .drives__cells .metric');
    await expect(cells).toHaveCount(3);

    const labels = await cells.locator('.metric__label').allTextContents();
    expect(labels.map((label) => label.trim())).toEqual([
      englishMessages['drives.fsd.jump-laden'],
      englishMessages['drives.fsd.jump-unladen'],
      englishMessages['drives.fsd.mass-lock'],
    ]);
    for (const value of await cells.locator('.metric__value').allTextContents()) {
      expect(value).toMatch(/\d/u);
    }

    // The two jumps are the ends of the list below them, so the card can never
    // head itself with a figure its own rows disagree with.
    const ranges = await page.locator('ednb-drives-mass .drives__range-value').allTextContents();
    const cellValues = await cells.locator('.metric__number').allTextContents();
    expect(cellValues[1]?.trim()).toBe(ranges[0]?.trim());
    expect(cellValues[0]?.trim()).toBe(ranges[2]?.trim());
  });

  test('the three loads are drawn once each, with what each carries', async ({ page }) => {
    await openDrives(page);

    // Three, not the canvas's four: its `CURRENT` row is a jump at some
    // arbitrary current fuel and cargo state, which this application has no
    // viewing condition to read one at.
    const rows = page.locator('ednb-drives-mass .drives__range');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('ednb-drives-mass .drives__range-label')).toHaveText([
      englishMessages['drives.load.maximum'],
      englishMessages['drives.load.unladen'],
      englishMessages['drives.load.laden'],
    ]);

    // One figure a row, as the canvas draws them. The whole tank is its own
    // reading and appears once, in the legend under the ranges.
    for (const row of await rows.all()) {
      await expect(row.locator('.drives__range-value')).toHaveCount(1);
    }
  });

  test('a fuller load never jumps further on one tank than a lighter one', async ({ page }) => {
    await openDrives(page);

    // Read the package's own three single-jump figures back off the page and
    // check they order the way the loads do. Nothing here writes one down.
    const values = await page
      .locator('ednb-drives-mass .drives__range-value')
      .evaluateAll((cells) =>
        cells.map((cell) => Number.parseFloat((cell.textContent ?? '').replace(/[^\d.]/gu, ''))),
      );
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(values).toHaveLength(3);
    expect(values[0]).toBeGreaterThanOrEqual(values[1]);
    expect(values[1]).toBeGreaterThanOrEqual(values[2]);
  });

  test('the section labels are the catalogue’s words, drawn in caps by CSS', async ({ page }) => {
    await openDrives(page);

    const headings = await page
      .locator('ednb-drives-mass .drives__section-heading')
      .allTextContents();
    const expected = [englishMessages['drives.fsd.range-by-load']].map(caps);

    for (const label of expected) {
      expect(headings.map((heading) => caps(heading.trim())).join(' | ')).toContain(label);
    }

    // The speed envelope stopped being one of them on 2026-08-26 (Commander
    // request): the canvas draws the bars under the legend with no line over
    // them, and the words stayed as the list's own name rather than as ink.
    await expect(page.locator('ednb-drives-mass .drives__envelope')).toHaveAttribute(
      'aria-label',
      englishMessages['drives.thrusters.envelope'],
    );
    expect(headings.map((heading) => heading.trim())).not.toContain(
      englishMessages['drives.thrusters.envelope'],
    );

    // The mass block is not one of them either: neither canvas heads it, so its
    // name is the list's accessible name and never a line on the screen.
    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend'),
    ).toHaveAttribute('aria-label', englishMessages['drives.thrusters.mass']);
    expect(headings.map((heading) => heading.trim())).not.toContain(
      englishMessages['drives.thrusters.mass'],
    );
  });

  test('an expanded translation keeps every reading and moves no package digit', async ({
    browser,
    baseURL,
    page,
  }) => {
    await openDrives(page);
    const before = await page.locator('ednb-drives-mass .drives__envelope-value').allTextContents();

    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const german = await context.newPage();
    await openDrives(german, germanMessages);

    await expect(german.locator('ednb-drives-mass .drives__range')).toHaveCount(3);
    await expect(german.locator('ednb-drives-mass .drives__envelope-row')).toHaveCount(5);
    await expect(
      german.locator('ednb-drives-mass .drives__card:first-child .drives__legend-value'),
    ).toHaveCount(3);
    const after = await german
      .locator('ednb-drives-mass .drives__envelope-value')
      .allTextContents();

    expect(after).toHaveLength(before.length);
    // German groups and separates its decimals differently. The digits are the
    // package's and do not move because the words around them did.
    for (const [index, value] of after.entries()) {
      expect(digits(value)).toBe(digits(before[index]));
    }
    // The mass split is the package's too, so the German page states the same
    // digits under different words.
    const germanMass = await german
      .locator('ednb-drives-mass .drives__card:first-child .drives__legend-value')
      .allTextContents();
    const englishMass = await page
      .locator('ednb-drives-mass .drives__card:first-child .drives__legend-value')
      .allTextContents();
    for (const [index, value] of germanMass.entries()) {
      expect(digits(value)).toBe(digits(englishMass[index]));
    }

    await expectNoDocumentOverflow(german);
    await context.close();
  });

  test('mirrors the layout without mirroring a figure', async ({ page }) => {
    await openDrives(page);
    const before = await page.locator('ednb-drives-mass .drives__envelope-value').allTextContents();

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await settled(page);

    expect(
      await page.locator('ednb-drives-mass .drives__envelope-value').allTextContents(),
    ).toEqual(before);
    await expectNoDocumentOverflow(page);
  });

  test('loses no reading with motion removed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDrives(page);

    // The requirement is not less animation: it is that no reading was ever
    // only reachable through one. The bars are the part a transition could have
    // been carrying, so the figures beside them are what is read back.
    await expect(page.locator('ednb-drives-mass .drives__envelope-value')).toHaveCount(5);
    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-value'),
    ).toHaveCount(3);
    await page.emulateMedia({ reducedMotion: null });
  });

  test('selects the stacked arrangement at 400% zoom rather than scrolling sideways', async ({
    page,
  }) => {
    // The arrangement is chosen from the space the region is given, so a zoomed
    // page picks the stacked one for the same reason a phone does.
    await page.setViewportSize({ width: 320, height: 256 });
    await openDrives(page);

    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-row'),
    ).toHaveCount(3);
    await expect(page.locator('ednb-drives-mass .drives__envelope-row')).toHaveCount(5);
    await expect(page.locator('ednb-drives-mass .drives__range')).toHaveCount(3);
    await expectNoDocumentOverflow(page);
  });

  test('the stacked arrangement loses no reading and scrolls nothing sideways', async ({
    page,
  }, testInfo) => {
    await openDrives(page);
    const wide = {
      mass: await page
        .locator('ednb-drives-mass .drives__card:first-child .drives__legend-row')
        .count(),
      envelope: await page.locator('ednb-drives-mass .drives__envelope-row').count(),
      ranges: await page.locator('ednb-drives-mass .drives__range').count(),
      facts: await page
        .locator('ednb-drives-mass .drives__card:last-child .drives__legend-row')
        .count(),
    };

    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page);

    expect(
      await page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-row').count(),
    ).toBe(wide.mass);
    expect(await page.locator('ednb-drives-mass .drives__envelope-row').count()).toBe(
      wide.envelope,
    );
    expect(await page.locator('ednb-drives-mass .drives__range').count()).toBe(wide.ranges);
    expect(
      await page.locator('ednb-drives-mass .drives__card:last-child .drives__legend-row').count(),
    ).toBe(wide.facts);

    await expectNoDocumentOverflow(page);

    // The arrangement is swept from the top of the page.
    //
    // Resizing keeps the scroll offset the tablet layout was left at, and the
    // command bar is sticky: whichever row that offset happens to park behind
    // the bar is read as an obscured target by the geometry rules. Which row
    // that is says nothing about the stacked arrangement — it moves with every
    // change to any height above it, and it is a different row in each of the
    // five profiles this test runs in — so the state named here is scanned
    // where a Commander who reached this width meets it, at its top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await settled(page);

    await sweepOutfittingState(page, testInfo, 'drives and mass, stacked');
  });

  test('a doubled text size loses no reading either', async ({ page }) => {
    await withRootTextScale(page, DOUBLED_TEXT);
    await openDrives(page);

    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-row'),
    ).toHaveCount(3);
    await expect(page.locator('ednb-drives-mass .drives__envelope-row')).toHaveCount(5);
    await expect(page.locator('ednb-drives-mass .drives__range')).toHaveCount(3);
    await expect(
      page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-value'),
    ).toHaveCount(3);
    await expectNoDocumentOverflow(page);
  });

  test('the whole region passes the accessibility sweep as drawn', async ({ page }, testInfo) => {
    await openDrives(page);
    await sweepOutfittingState(page, testInfo, 'drives and mass');
  });

  /**
   * German at a doubled text size, on this project's own device.
   *
   * `test.use` rather than a fresh context: a context built by hand takes
   * Playwright's defaults for everything it is not given, and this layout is
   * decided by the viewport and the touch profile the project sets.
   *
   * Each condition alone was already held and each alone is fine. Together they
   * are not: German's compounds are single unbreakable words, and at twice the
   * size `Höchstgeschwindigkeit` is wider than the column it sits in. It painted
   * across the bar and over the value beside it, and pushed the document
   * sideways. This is the pair `tasks.md` T058 names.
   */
  test.describe('in German, at a doubled text size', () => {
    test.use({ locale: 'de-DE' });

    test('loses no reading to a word wider than its column', async ({ page }) => {
      await withRootTextScale(page, DOUBLED_TEXT);
      await openDrives(page, germanMessages);

      await expect(page.locator('ednb-drives-mass .drives__envelope-row')).toHaveCount(5);
      await expect(
        page.locator('ednb-drives-mass .drives__card:first-child .drives__legend-value'),
      ).toHaveCount(3);

      // No label may reach into the figure beside it: an overrun paints on top
      // of the package's own number, which is the reading itself.
      const overruns = await page
        .locator(
          'ednb-drives-mass .drives__envelope-row, ednb-drives-mass .drives__card:first-child .drives__legend-row',
        )
        .evaluateAll((rows) =>
          rows
            .map((row) => {
              const label = row.querySelector('[class$="__label"]');
              const value = row.querySelector('[class$="__value"]');
              if (!label || !value) {
                return null;
              }
              const labelBox = label.getBoundingClientRect();
              const valueBox = value.getBoundingClientRect();
              return labelBox.right > valueBox.left + 1 ? label.textContent : null;
            })
            .filter(Boolean),
        );
      expect(overruns).toEqual([]);

      await expectNoDocumentOverflow(page);
    });

    test('keeps the mass bar’s two marks on one line and off each other', async ({ page }) => {
      // The marks are the scale the bar above them is drawn on, and this is the
      // condition that would have made a label pinned under the optimal tick
      // meet the maximum's: two readings painted over each other is the one
      // failure a bar's own labels must not have (FR-009's sibling case at the
      // card, and the reason the pair is set at the ends of a wrapping row).
      await withRootTextScale(page, DOUBLED_TEXT);
      await openDrives(page, germanMessages);

      const boxes = await page.locator('ednb-drives-mass .drives__mass-mark').evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = (node as HTMLElement).getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }),
      );

      expect(boxes).toHaveLength(2);
      const overlaps =
        boxes[0].right > boxes[1].left + 1 &&
        boxes[0].bottom > boxes[1].top + 1 &&
        boxes[1].bottom > boxes[0].top + 1;
      expect(overlaps).toBe(false);

      await expectNoDocumentOverflow(page);
    });
  });
});

test.describe('the status rail', () => {
  test('carries the jump, the speed and the mass the cards carry', async ({ page }) => {
    await openDrives(page);

    // The three cells are composed from the design system's metric group, which
    // is what the canvas draws all six rail cells as.
    const cells = page.locator('ednb-drives-summary .metric');
    await expect(cells).toHaveCount(3);
    expect((await cells.locator('.metric__label').allTextContents()).map((l) => l.trim())).toEqual([
      englishMessages['drives.rail.jump'],
      englishMessages['drives.rail.speed'],
      englishMessages['drives.rail.mass'],
    ]);

    const railFigures = (await cells.locator('.metric__number').allTextContents()).map(digits);
    for (const figure of railFigures) {
      expect(figure).not.toBe('');
    }

    // The same projection reaches the rail and the cards, so the readings have
    // to agree without either being written down here. `JUMP` is the drive
    // card's laden cell, `SPEED` its top-speed row, `MASS` the thruster card's
    // headline.
    const ladenCell = page.locator('ednb-drives-mass .drives__cells .metric').first();
    expect(digits(await ladenCell.locator('.metric__number').innerText())).toBe(railFigures[0]);

    const topSpeed = page.locator('ednb-drives-mass .drives__envelope-row').first();
    expect(digits(await topSpeed.locator('.drives__envelope-value').innerText())).toBe(
      railFigures[1],
    );

    expect(digits(await page.locator('ednb-drives-mass .drives__headline-mass').innerText())).toBe(
      railFigures[2],
    );
  });

  test('the rail’s cells are one grid, not a block per feature stacked', async ({ page }) => {
    await openDrives(page);

    // Canvas 1c draws `SHIELD`, `ARMOUR`, `DPS`, `JUMP`, `SPEED` and `MASS` as
    // one band of cells, two across, ruled off each other only by the amber
    // ground showing through one-pixel gaps, and feature 003's `CARGO` and
    // `PASSENGERS` take the next row of the same band. Four features own them
    // between them, and drawn as a grid apiece they would rule off in groups —
    // `DPS` could never share a row with `JUMP`.
    //
    // That band is the rail's, and it goes wherever the rail goes. This journey
    // has the `DRIVES` segment open rather than `STATUS`, so where the rail is
    // not canvas 1c's third column it is not drawn at all, and the workspace's
    // own strip of key readings states the six above the category strip instead
    // — exactly once (`design/outfitting-workspace.md`, "The compact key
    // figures").
    if (!(await statusRailIsColumn(page))) {
      await expect(page.locator('.outfitting__key-figures .metric')).toHaveCount(6);
      await expect(page.locator('.outfitting__status-cells')).toHaveCount(0);
      return;
    }

    const cells = page.locator('.outfitting__status-cells .metric');
    await expect(cells).toHaveCount(8);

    const boxes = await cells.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = (node as HTMLElement).getBoundingClientRect();
        return {
          top: Math.round(box.top),
          left: Math.round(box.left),
          right: Math.round(box.right),
          bottom: Math.round(box.bottom),
          width: box.width,
        };
      }),
    );

    // Four rows of two, in the canvas's order — so a row boundary falls between
    // `ARMOUR` and `DPS`, and between `MASS` and `CARGO`, rather than between
    // the features that own them.
    const rows = [...new Set(boxes.map((box) => box.top))].sort((a, b) => a - b);
    expect(rows).toHaveLength(4);
    expect(boxes[2].top).toBe(boxes[3].top);
    expect(boxes[4].top).toBe(boxes[5].top);
    expect(boxes[6].top).toBe(boxes[7].top);

    // Two columns, the same two on every row, and the gap between them is the
    // hairline the canvas rules with rather than a gutter.
    const columns = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
    expect(columns).toHaveLength(2);
    expect(columns[1] - (columns[0] + boxes[0].width)).toBeLessThanOrEqual(2);

    // The amber ground reaches exactly as far as the cells do. It is what rules
    // them off each other through the one-pixel gaps, and it is nothing else —
    // a band of it around the cells would be a box the canvas draws around
    // nothing, which is what a ground painted across the block's own inset
    // looks like.
    const grid = page.locator('.outfitting__status-cells');
    const ground = await grid.evaluate((node) => {
      const box = (node as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(node as HTMLElement);
      return {
        top: Math.round(box.top),
        left: Math.round(box.left),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      };
    });

    expect(ground.padding).toEqual(['0px', '0px', '0px', '0px']);
    expect(ground.top).toBe(Math.min(...boxes.map((box) => box.top)));
    expect(ground.left).toBe(Math.min(...boxes.map((box) => box.left)));
    expect(ground.right).toBe(Math.max(...boxes.map((box) => box.right)));
    expect(ground.bottom).toBe(Math.max(...boxes.map((box) => box.bottom)));
  });

  test('names each figure with its unit, and holds no control', async ({ page }) => {
    await openDrives(page);

    const units = await page.locator('ednb-drives-summary .metric__unit').allTextContents();
    expect(units.map((unit) => unit.trim())).toEqual([
      englishMessages['drives.rail.light-years'],
      englishMessages['drives.rail.metres-per-second'],
      englishMessages['drives.rail.tonnes'],
    ]);

    await expect(
      page.locator('ednb-drives-summary button, ednb-drives-summary a, ednb-drives-summary input'),
    ).toHaveCount(0);
  });

  test('stands in the rail whichever mode the anatomy region has open', async ({ page }) => {
    await page.goto(ROUTE);
    await buildStockHull(page, englishMessages['hullDetail.create']);

    // The rail is not the panel: it reports the build, not what is on screen
    // beside it.
    await expect(page.locator('ednb-drives-summary .metric')).toHaveCount(3);
    await expect(page.locator('ednb-drives-mass')).toHaveCount(0);
  });
});
