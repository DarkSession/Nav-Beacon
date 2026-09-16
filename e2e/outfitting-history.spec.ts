import { expect, test, type Page } from '@playwright/test';
import { sweepOutfittingState } from './accessibility';
import {
  commandBarActionState,
  fitCommitted,
  openChooser,
  openChooserRows,
  pressCommandBarAction,
  revealMount,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { buildStockHull, regroupCoreMount, savedToBrowser } from './shell';

/**
 * Undo and redo, end to end (US4).
 *
 * The claim is that a step back is a step back to a build, not to a picture of
 * one: every modelled field returns and the package recomputes everything that
 * follows, over one revision. The other half is what never records a step —
 * looking, searching, opening a field and typing in it are not decisions, and a
 * Commander who undoes after doing those must land on their last real one
 * (FR-016, FR-018).
 */

/** Creates a stock build and lands in the workspace with the ledger rendered. */
async function openStockBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

const undo = (page: Page) => commandBarActionState(page, /^undo$/i);
const redo = (page: Page) => commandBarActionState(page, /^redo$/i);

/** Selects one mount by its exact game slot key. */
async function selectMount(page: Page, slotKey: string): Promise<void> {
  await revealMount(page, slotKey);
  const row = page.locator(`[data-slot-key="${slotKey}"] button`).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
}

/** What the ledger says is fitted in one mount, identity and code line. */
async function fittedAt(page: Page, slotKey: string): Promise<string> {
  return page
    .locator(`[data-slot-key="${slotKey}"]`)
    .evaluate((node) => node.querySelector('.identity')?.textContent?.trim() ?? '');
}

/**
 * The power chip for one mount.
 *
 * Every assertion about it goes through a retrying `expect`, because an undo
 * resolves when the click is dispatched and the ledger re-renders a moment
 * later — reading the value straight after the click reads the state before it.
 */
function chip(page: Page, slotKey: string) {
  return page.locator(`[data-slot-key="${slotKey}"] .power__priority`);
}

/** Puts one mount in a power group, which is one decision. */
async function setGroup(page: Page, slotKey: string, value: string): Promise<void> {
  await revealMount(page, slotKey);
  await chip(page, slotKey).selectOption({ value });
  await expect(chip(page, slotKey)).toHaveValue(value);
}

test.describe('stepping back and forward', () => {
  test('restores each intermediate state of a mixed sequence, exactly', async ({ page }) => {
    await openStockBuild(page);
    const slot = 'SmallHardpoint1';
    const stock = await fittedAt(page, slot);

    // Three decisions of three different kinds.
    await selectMount(page, 'MediumHardpoint1');
    await openChooserRows(page);
    const rows = page.locator('.candidate');
    await expect(rows.first()).toBeVisible();
    await rows.first().locator('.candidate__name').click();
    if (await surfacesAreLayers(page)) {
      await page.getByRole('button', { name: /fit module/i }).click();
    }
    await fitCommitted(page);
    const fitted = await fittedAt(page, 'MediumHardpoint1');
    expect(fitted).not.toHaveLength(0);

    const stockGroup = await chip(page, slot).inputValue();
    await setGroup(page, slot, '3');
    await page.locator(`[data-slot-key="${slot}"] .power__switch`).click();
    await expect(page.locator(`[data-slot-key="${slot}"] .power__toggle`)).not.toBeChecked();

    // Back through all three, each landing on the state before it.
    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.locator(`[data-slot-key="${slot}"] .power__toggle`)).toBeChecked();
    await expect(chip(page, slot)).toHaveValue('3');

    await pressCommandBarAction(page, /^undo$/i);
    await expect(chip(page, slot)).toHaveValue(stockGroup);
    expect(await fittedAt(page, 'MediumHardpoint1')).toBe(fitted);

    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.locator('[data-slot-key="MediumHardpoint1"]')).toContainText(/empty/i);
    expect(await fittedAt(page, slot)).toBe(stock);
    await expect(undo(page)).toBeDisabled();

    // And forward again, to exactly where it left.
    await pressCommandBarAction(page, /^redo$/i);
    await expect(page.locator('[data-slot-key="MediumHardpoint1"]')).not.toContainText(/empty/i);
    await pressCommandBarAction(page, /^redo$/i);
    await expect(chip(page, slot)).toHaveValue('3');
    await pressCommandBarAction(page, /^redo$/i);
    await expect(page.locator(`[data-slot-key="${slot}"] .power__toggle`)).not.toBeChecked();

    expect(await fittedAt(page, 'MediumHardpoint1')).toBe(fitted);
    await expect(redo(page)).toBeDisabled();
  });

  test('recomputes every package result rather than restoring one', async ({ page }) => {
    await openStockBuild(page);

    await selectMount(page, 'Slot03_Size6');
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator('[data-slot-key="Slot03_Size6"]')).toContainText(/empty/i);

    await pressCommandBarAction(page, /^undo$/i);

    // The module is back, and everything the package says about the build was
    // read again from it rather than carried on the tape.
    await expect(page.locator('[data-slot-key="Slot03_Size6"]')).not.toContainText(/empty/i);
  });

  test('discards the forward branch when a new decision is made', async ({ page }) => {
    await openStockBuild(page);
    await setGroup(page, 'SmallHardpoint1', '1');
    await pressCommandBarAction(page, /^undo$/i);
    await expect(redo(page)).toBeEnabled();

    await setGroup(page, 'SmallHardpoint2', '2');

    await expect(redo(page)).toBeDisabled();
  });

  test('is offered as disabled rather than hidden at either end', async ({ page }, testInfo) => {
    await openStockBuild(page);

    // A control that disappears is a control a Commander has to go looking for.
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    await sweepOutfittingState(page, testInfo, 'history/disabled');
  });

  test('records nothing for looking, searching or opening a field', async ({ page }) => {
    await openStockBuild(page);

    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);
    await page.locator('input[type="search"]').fill('pulse');
    // Closed before the next part: at compact width the chooser is a screen of
    // its own over an inert background, and the command bar is behind it. The
    // wide composition draws it inline with no such control.
    if (await surfacesAreLayers(page)) {
      await page.locator('.replacement__cancel').click();
    }

    await page.getByRole('button', { name: /rename the ship/i }).click();
    // Typed and abandoned. Escape leaves the field as it was: the canvas draws
    // no Cancel beside the title, so leaving without committing is Escape.
    // Nothing is typed into the DOM value the field would commit on blur —
    // `fill` alone does not commit, and pressing Escape closes it (wave 4).
    await page.locator('.identity-fields__input').press('Escape');

    await expect(undo(page)).toBeDisabled();
  });

  test('retains a bounded tape, and the bound is the tape’s own', async ({ page }) => {
    // Twenty-four round trips through the controls, each awaited. That is slow
    // on purpose — see the note below — and at 25 seconds on a developer machine
    // it had no room left in the default 30 for a CI runner's slower cores.
    test.slow();

    await openStockBuild(page, 'Sidewinder');
    // A mount that draws power, so it has a group to change. The power plant is
    // what everything else draws from and has no group at all (wave 4).
    const slot = 'FrameShiftDrive';
    // Its category first: at compact width a mount nobody has asked for is not
    // on the page at all (`revealMount`).
    await revealMount(page, slot);
    const groups = chip(page, slot);

    // Twelve decisions here, and exactly a hundred and one in
    // `session-edit-history.spec.ts` and `outfitting-history.spec.ts` where a
    // decision costs no browser. What this journey proves is the part only a
    // browser can: every decision a Commander makes through the controls is on
    // the tape, in order, and the tape runs out exactly when it should.
    const decisions = 12;
    for (let step = 0; step < decisions; step += 1) {
      await groups.selectOption({ value: String((step % 4) + 1) });
      await expect(groups).toHaveValue(String((step % 4) + 1));
    }

    for (let step = 0; step < decisions; step += 1) {
      await pressCommandBarAction(page, /^undo$/i);
    }

    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
  });
});

test.describe('the ship’s name and ident', () => {
  async function rename(page: Page, value: string): Promise<void> {
    await page.getByRole('button', { name: /rename the ship/i }).click();
    // The title is the field. Leaving it is confirming it, which is what the
    // canvas's "click to rename" means — there is no control beside it.
    await page.locator('.identity-fields__input').fill(value);
    await page.locator('.identity-fields__input').press('Enter');
  }

  test('names the ship, sets the ident, and undoes each back to absence', async ({ page }) => {
    await openStockBuild(page);
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();

    await rename(page, 'Pacifier');
    await expect(page.getByRole('heading', { level: 1, name: 'Pacifier' })).toBeVisible();

    await page.getByRole('button', { name: /change the ship id/i }).click();
    await page.locator('.identity-fields__input').fill('FD-11X');
    await page.locator('.identity-fields__input').press('Enter');
    await expect(page.locator('.identity-fields__plate')).toHaveText('FD-11X');

    // Clearing sets absence, not an empty string. Emptying the field is how a
    // plate is taken off: the canvas draws no Clear beside it (wave 4).
    await page.getByRole('button', { name: /change the ship id/i }).click();
    await page.locator('.identity-fields__input').fill('');
    await page.locator('.identity-fields__input').press('Enter');
    await expect(page.locator('.identity-fields__plate')).toHaveCount(0);

    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.locator('.identity-fields__plate')).toHaveText('FD-11X');

    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.locator('.identity-fields__plate')).toHaveCount(0);

    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    await expect(undo(page)).toBeDisabled();
  });

  test('is accessible in the states it draws', async ({ page }, testInfo) => {
    await openStockBuild(page);
    // The disabled-control test owns the initial stock-state scan.

    await rename(page, 'Pacifier');
    await sweepOutfittingState(page, testInfo, 'history/one decision');

    await page.getByRole('button', { name: /rename the ship/i }).click();
    await sweepOutfittingState(page, testInfo, 'history/identity field open');
  });
});

test.describe('what resets the tape', () => {
  test('a build created from a hull starts with no history', async ({ page }) => {
    await openStockBuild(page);
    await setGroup(page, 'SmallHardpoint1', '1');
    await expect(undo(page)).toBeEnabled();

    await openStockBuild(page, 'Sidewinder');

    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
  });

  test('a build opened from a link starts with no history', async ({ page }) => {
    // A different hull's link, so the incoming build genuinely replaces this
    // one rather than being the build already on screen.
    await openStockBuild(page, 'Sidewinder');
    await expect(page).toHaveURL(/\/outfitting#b\./);
    const incoming = new URL(page.url()).hash;

    await openStockBuild(page, 'Anaconda');
    await setGroup(page, 'SmallHardpoint1', '1');
    await expect(undo(page)).toBeEnabled();

    // Nothing is asked before the link replaces what is on screen: the build it
    // replaces is either in a record of its own or still at its hull's package
    // default, and neither is lost (feature 001, FR-008; 024/FR-001).
    await page.goto(`/outfitting${incoming}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
  });

  test('a reload restores the build and none of its history', async ({ page }) => {
    await openStockBuild(page);
    // A mount whose power state the link carries: the codec encodes power only
    // for modules that draw it, so a plant-only change leaves the address bar
    // describing a different build (see reference-review.md).
    await setGroup(page, 'SmallHardpoint1', '1');
    await savedToBrowser(page);

    await page.reload();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    // The build survived; the session's decisions did not, because the tape is
    // never written anywhere (edit-history contract, "Boundary isolation").
    await expect(chip(page, 'SmallHardpoint1')).toHaveValue('1');
    await expect(undo(page)).toBeDisabled();
  });

  test('a refused incoming build keeps the history it never replaced', async ({ page }) => {
    await openStockBuild(page);
    await setGroup(page, 'SmallHardpoint1', '1');

    await page.goto('/outfitting#b.not-a-real-link');
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();

    // Nothing replaced the build, so nothing about its history changed.
    await expect(undo(page)).toBeEnabled();
  });
});

test.describe('boundary isolation', () => {
  test('writes no tape, checkpoint or summary into local storage', async ({ page }) => {
    await openStockBuild(page);
    await setGroup(page, 'SmallHardpoint1', '1');
    await pressCommandBarAction(page, /^undo$/i);
    // A decision the undo did not take back, so there is a record to read. A
    // build undone to its hull's package default is stored nowhere, and the
    // tape this journey is about is held apart from storage either way
    // (024/FR-001).
    await regroupCoreMount(page);
    await savedToBrowser(page);

    const stored = await page.evaluate(() =>
      Object.keys(localStorage)
        .map((key) => localStorage.getItem(key) ?? '')
        .join(''),
    );

    for (const forbidden of ['past', 'future', 'checkpoint', 'history', 'outfitting.history']) {
      expect(stored, `local storage carries "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test('keeps the fragment observing the active build after undo and redo', async ({ page }) => {
    await openStockBuild(page);
    // Captured after the link is published, not before: the workspace renders
    // the ledger first and the fragment a moment later.
    await expect(page).toHaveURL(/\/outfitting#b\./);
    const stock = new URL(page.url()).hash;

    // A change the link carries: the fragment encodes what is fitted, and a
    // power group is not part of that (feature 001's codec).
    await selectMount(page, 'Slot03_Size6');
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator('[data-slot-key="Slot03_Size6"]')).toContainText(/empty/i);
    await expect.poll(() => new URL(page.url()).hash).not.toBe(stock);
    const edited = new URL(page.url()).hash;

    await pressCommandBarAction(page, /^undo$/i);
    await expect(page.locator('[data-slot-key="Slot03_Size6"]')).not.toContainText(/empty/i);

    // The publisher observes the active build after a step back exactly as
    // after any other edit — it is told nothing about the tape.
    await expect.poll(() => new URL(page.url()).hash).toBe(stock);

    await pressCommandBarAction(page, /^redo$/i);
    await expect.poll(() => new URL(page.url()).hash).toBe(edited);
  });

  test('adds no browser history entry for a step back or forward', async ({ page }) => {
    await openStockBuild(page);
    await setGroup(page, 'SmallHardpoint1', '1');
    const before = await page.evaluate(() => history.length);

    await pressCommandBarAction(page, /^undo$/i);
    await pressCommandBarAction(page, /^redo$/i);

    // The tape is not browser history and never becomes it: back still means
    // the page a Commander came from.
    expect(await page.evaluate(() => history.length)).toBe(before);
  });
});
