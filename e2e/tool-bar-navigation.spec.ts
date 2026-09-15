import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  buildStockHull,
  openLibrary,
  raiseSuitGrade,
  recordCount,
  savedToBrowser,
  setShipIdent,
} from './shell';

/**
 * Getting back, and starting again, from the bar.
 *
 * Feature 017's journeys. Three of them: the mark leads to the entry point from
 * every screen, a tool's own tab re-enters the tool a Commander is already in,
 * and the bench keeps the loadout on it the way the workspace keeps a build.
 */

/** The mark on the leading edge of the tool deck. */
const mark = (page: Page) => page.locator('.frame__flag-home');

/** The tool tabs, in the order the registry carries them. */
const tools = (page: Page) => page.locator('.frame__tools .frame__tool');

/** The entry point, whatever else the address carries. */
async function expectEntryPoint(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/(#.*)?$/);
  await expect(page.getByRole('main').getByRole('heading').first()).toHaveText(
    'Tools for Commanders',
  );
}

/**
 * Whether this screen is drawn as a sheet, with a bar of its own.
 *
 * Waited for rather than read once. The sheet's bar is published by the screen's
 * own effect, so it arrives after that route's chunk has loaded and run — and a
 * question asked before then is answered by the shipyard's bar, which is still
 * the one on screen.
 */
async function sheetBar(page: Page): Promise<boolean> {
  let drawn = true;
  await expect(page.locator('.frame__return'))
    .toBeVisible({ timeout: 5_000 })
    .catch(() => {
      drawn = false;
    });
  return drawn;
}

/** Wears a suit from the gate, which is what an empty bench offers. */
async function wearSuit(page: Page, name: string): Promise<void> {
  await page.locator('.gate__suits .choice').filter({ hasText: name }).click();
  await expect(page.locator('.gate')).toHaveCount(0);
}

/**
 * Wears a suit and raises its grade, so the loadout carries a choice.
 *
 * A loadout the bench starts and nothing else is stored nowhere, which is its
 * own journey below. Every journey about a record makes a choice on the
 * loadout first (024/FR-002).
 */
async function wearAndChoose(page: Page, name: string): Promise<void> {
  await wearSuit(page, name);
  await raiseSuitGrade(page);
}

/**
 * Draws the loadout ledger, however this arrangement holds it.
 *
 * The compact bench draws one region at a time and re-opens the row it was
 * drilled into, so a journey that opened a row reads the item rather than the
 * ledger when it comes back. The tab is what the wide bench answers with
 * nothing, and the back control is what the drill-in answers with.
 */
async function openLedger(page: Page): Promise<void> {
  await expect(page.locator('ednb-equipment-bench-page')).toBeAttached();
  const tab = page.getByRole('tab', { name: 'Loadout' });
  if ((await tab.count()) > 0) {
    await tab.click();
  }
  if ((await page.locator('.bench__region--loadout').count()) === 0) {
    await page.locator('.item__back').click();
  }
}

/** Waits for the bench to have written what is on it, rather than for a delay. */
async function autosaved(page: Page): Promise<void> {
  await expect(page.locator('ednb-equipment-bench-page')).toHaveAttribute(
    'data-persistence',
    'saved',
  );
}

test.describe('the mark leads to the entry point', () => {
  test('from a hull, the workspace and the bench (017/FR-001)', async ({ page }) => {
    // One way back, in the same place on every screen, whichever tool a
    // Commander is in and however deep they are in it.
    await page.goto('/ships/Anaconda');
    await expect(page.getByRole('main')).toBeVisible();
    if (await sheetBar(page)) {
      // The one exception, stated in the requirement: below the wide width a
      // hull is a sheet over the shipyard, and canvas 1b gives it a bar of its
      // own — the way back, and no mark beside it. The entry point stands on
      // the screen that arrow leads to.
      await expect(mark(page)).toBeHidden();
      await page.locator('.frame__return-back').click();
      await expect(page).toHaveURL(/\/ships$/);
    }
    await expect(mark(page)).toHaveAttribute('href', '/');
    // Named for where it goes, rather than announced as a picture.
    await expect(mark(page)).toHaveAccessibleName('Nav Beacon');
    await mark(page).click();
    await expectEntryPoint(page);

    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);
    await mark(page).click();
    await expectEntryPoint(page);
    // The address the workspace published goes with the screen it described.
    expect(new URL(page.url()).hash).toBe('');

    await page.goto('/equipment');
    await expect(page.locator('.gate')).toBeVisible();
    await mark(page).click();
    await expectEntryPoint(page);
  });

  test('and answers with nothing on the entry point itself (017/FR-002)', async ({ page }) => {
    // Drawn and offered there as everywhere else — the browser states where it
    // goes and a new tab opens it — and a plain press changes nothing.
    await page.goto('/');
    await expectEntryPoint(page);

    const heading = page.getByRole('main').getByRole('heading').first();
    await mark(page).click();

    await expectEntryPoint(page);
    // The same screen, not a second copy of it opened over the first.
    await expect(heading).toBeVisible();
  });
});

test.describe('a tool’s tab re-enters the tool', () => {
  test('opens the list of ships from a hull and from the workspace (017/FR-004)', async ({
    page,
  }) => {
    await page.goto('/ships/Anaconda');
    await expect(page.getByRole('main')).toBeVisible();
    await tools(page).first().click();
    await expect(page).toHaveURL(/\/ships$/);

    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);
    await setShipIdent(page, 'NB-01');
    await tools(page).first().click();

    // The build is not discarded by leaving it: the record it autosaves into
    // keeps it (017/FR-004). One decision is made on it first, because a build
    // still at the package default is kept by the address rather than by a
    // record (024/FR-001).
    await expect(page).toHaveURL(/\/ships$/);
    // Polled: the autosave is written as the workspace is left, which the
    // address changing does not wait for.
    await expect.poll(() => recordCount(page)).toBeGreaterThan(0);
  });

  test('changes nothing where the list of ships is already open (017/FR-005)', async ({ page }) => {
    await page.goto('/ships');
    await expect(page.getByRole('main')).toBeVisible();
    const current = tools(page).first();

    // Offered as a link, and marked as the tool being read: both, at once
    // (017/FR-003, 017/SC-002).
    await expect(current).toHaveAttribute('href', '/ships');
    await expect(current).toHaveAttribute('aria-current', 'true');

    const entries = await page.evaluate(() => history.length);

    await current.click();

    await expect(page).toHaveURL(/\/ships$/);
    await expect(page.getByRole('main')).toBeVisible();
    // And no entry to press BACK through: the press led where the Commander
    // already was, so it is not a place they can return from.
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test('leaves an empty bench when the bench is open (017/FR-006)', async ({ page }) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');
    await expect(page).toHaveURL(/\/equipment#e\./);
    // Nothing was decided on it, so nothing is stored for it: the loadout is in
    // the address and nowhere else (024/FR-002).
    expect(await recordCount(page)).toBe(0);

    await tools(page).nth(1).click();

    // Canvas 2a and 2b: the suit gate stands and nothing was asked.
    await expect(page.locator('.gate')).toBeVisible();
    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // And nothing was left behind by clearing it either.
    expect(await recordCount(page)).toBe(0);
  });
});

test.describe('the bench keeps the loadout on it', () => {
  test('restores it after a reload, and lets a Commander start again (017/FR-007)', async ({
    page,
  }) => {
    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');
    await autosaved(page);

    // Nothing was saved and nothing was asked for: what is restored is what
    // autosave wrote (017/SC-003).
    await page.goto('/equipment');
    await expect(page.locator('.gate')).toHaveCount(0);
    await expect(page.locator('ednb-equipment-bench-page')).toContainText('Dominator Suit');

    // And starting again leaves what was on the bench where it is: it is listed
    // as its own record, and opening it puts it back.
    await tools(page).nth(1).click();
    await expect(page.locator('.gate')).toBeVisible();

    await openLibrary(page);
    const library = page.getByRole('dialog', { name: 'Saved builds' });
    const row = library.getByRole('button', { name: /Dominator Suit/i }).first();
    await expect(row).toContainText('Equipment Builder');

    await expect(async () => {
      await row.click({ timeout: 2_000 });
      await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await library.getByRole('button', { name: 'Open in outfitting', exact: true }).click();

    await expect(page).toHaveURL(/\/equipment(#|$)/);
    await expect(page.locator('.gate')).toHaveCount(0);
    await expect(page.locator('ednb-equipment-bench-page')).toContainText('Dominator Suit');
  });

  test('keeps a loadout nobody changed out of the saved list (024/FR-002)', async ({ page }) => {
    // The loadout the bench starts for a suit holds nothing a Commander
    // decided, and is reached again by choosing the suit. Nothing is stored for
    // it, and the first choice made on it is what takes a record.
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');
    await expect(page).toHaveURL(/\/equipment#e\./);

    expect(await recordCount(page)).toBe(0);
    await openLibrary(page);
    await expect(page.getByText('Nothing is stored yet')).toBeVisible();
    await page.goBack();

    await raiseSuitGrade(page);
    await autosaved(page);

    await expect.poll(() => recordCount(page)).toBe(1);
    await openLibrary(page);
    await expect(
      page.getByRole('dialog', { name: 'Saved builds' }).getByText('Dominator Suit').first(),
    ).toBeVisible();
  });
});

test.describe('the bench and the address', () => {
  test('a loadout in the address outranks the record restored (017/FR-009)', async ({ page }) => {
    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');
    await autosaved(page);
    const shared = new URL(page.url()).hash;

    // A second loadout on the bench, so what this page restores is not what the
    // link describes.
    await tools(page).nth(1).click();
    await expect(page.locator('.gate')).toBeVisible();
    await wearAndChoose(page, 'Maverick Suit');
    await autosaved(page);

    await page.goto(`/equipment${shared}`);

    // The address is a Commander's deliberate arrival and the record is only
    // what this page was doing before it. Read from the suit's own row rather
    // than from the page, which also carries the list of suits to choose from.
    await openLedger(page);
    const suit = page.locator('.ledger__row[data-target="suit"]');
    await expect(suit).toContainText('Dominator Suit');
    await expect(suit).not.toContainText('Maverick Suit');
  });

  test('a store that refuses a write is stated in the bench’s own words (017/FR-008)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Every storage access throws, which is what a browser with site data
    // blocked actually does.
    await page.addInitScript(() => {
      const denied = () => {
        throw new DOMException('denied', 'SecurityError');
      };
      const blocked = {
        get length(): number {
          return denied();
        },
        key: denied,
        getItem: denied,
        setItem: denied,
        removeItem: denied,
        clear: denied,
      };
      Object.defineProperty(window, 'localStorage', { get: () => blocked });
    });

    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');

    // Named for the loadout rather than for storage, and the bench is still a
    // bench: nothing is taken away because nothing can be written.
    await expect(page.getByText(/loadouts will not survive a reload/i)).toBeVisible();
    await expect(page.locator('ednb-equipment-bench-page')).toContainText('Dominator Suit');
    await expect(page.locator('.gate')).toHaveCount(0);

    await context.close();
  });

  test('a full store offers the bench a way to choose what to discard (017/FR-008)', async ({
    page,
  }) => {
    // The notice draws one control, and the layer it raises has to open on the
    // chooser rather than on the ordinary list — the Commander pressed it to
    // make room, and a layer with no chooser reads as a control that failed.
    await page.addInitScript(() => {
      for (const size of [64 * 1024, 1024, 64, 1]) {
        const chunk = 'x'.repeat(size);
        for (let index = 0; ; index += 1) {
          try {
            localStorage.setItem(`filler:${size}:${index}`, chunk);
          } catch {
            break;
          }
        }
      }
    });

    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');

    await expect(page.getByText(/storage is full/i)).toBeVisible();
    await page.getByRole('button', { name: 'Choose loadouts to discard' }).click();

    // The chooser itself, and in the bench's own words: what a Commander is
    // asked to discard here is a loadout.
    const manager = page.locator('ednb-record-manager');
    await expect(manager).toBeVisible();
    await expect(manager).toContainText(/discard a loadout to make room/i);
  });

  test('one unnamed record per tool, so a page holds a build and a loadout (017/FR-010)', async ({
    page,
  }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);
    // Each tool's work carries a decision, so each is owed a record of its own
    // (024/FR-001, 024/FR-002).
    await setShipIdent(page, 'NB-01');
    await savedToBrowser(page);

    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');
    await autosaved(page);

    // Two records, one per tool. A loadout written into the build's record
    // would be the build gone, and the two hold different content.
    const written = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('ednb:record:'))
        .map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { tool?: string }),
    );

    expect(written.map((record) => record.tool).sort()).toEqual(['equipment', 'ship']);
  });
});

test.describe('deleting the record the bench is autosaving into', () => {
  test('has the bench let go of it, and it stays deleted (017/FR-008)', async ({ page }) => {
    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');
    await autosaved(page);
    const deleted = await page.evaluate(() =>
      Object.keys(localStorage).find((key) => key.startsWith('ednb:record:'))!,
    );

    await openLibrary(page);
    const library = page.getByRole('dialog', { name: 'Saved builds' });
    const row = library.getByRole('button', { name: /Dominator Suit/i }).first();
    await expect(async () => {
      await row.click({ timeout: 2_000 });
      await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page.getByRole('button', { name: 'Delete this build' }).click();

    // The Commander deleted it here, so the bench lets go of it rather than
    // keeping a loadout with nowhere to be saved.
    await expect(page.locator('.gate')).toHaveCount(1);

    await page.getByRole('button', { name: 'Close' }).first().click();

    // Leaving the layer returns to the address the bench published, and a
    // loadout in the address outranks anything this page holds — so the loadout
    // is read back from there and written to a record of its own. What is never
    // written back is the record the Commander deleted (017/FR-008).
    await autosaved(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), deleted)).toBeNull();
  });
});

test.describe('deleting the record the workspace is autosaving into', () => {
  test('leaves this tab claiming nothing for the ship tool (017/FR-010)', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    // The ship carries an ident, so the build holds a decision and is worth a
    // record. A build at the package default is stored nowhere, so there would
    // be nothing to claim and nothing to delete (024/FR-001).
    await setShipIdent(page, 'NB-01');
    await savedToBrowser(page);

    // The claim as this tab is holding it, which is what a reload reads.
    const claimed = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('ednb:tab') ?? '{}').workingRecords?.ship ?? null,
    );
    expect(claimed).not.toBeNull();

    await openLibrary(page);
    const library = page.getByRole('dialog', { name: 'Saved builds' });
    const row = library.getByRole('button', { name: /Anaconda/i }).first();
    await expect(async () => {
      await row.click({ timeout: 2_000 });
      await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page.getByRole('button', { name: 'Delete this build' }).click();

    // A claim outliving the record it names would have a page built in this tab
    // restore the build from an entry that is gone (017/FR-010).
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(sessionStorage.getItem('ednb:tab') ?? '{}').workingRecords?.ship ?? null,
        ),
      )
      .toBeNull();
  });
});

test.describe('the bar with the open tool drawn as a control', () => {
  test('scans clean at every layout profile, in both engines', async ({ page }, testInfo) => {
    // The states this change adds: a tab that is a link and current at once,
    // and the empty bench that re-entering the bench leaves behind.
    await page.goto('/ships');
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo, { label: 'tool-bar-current' });

    await page.goto('/equipment');
    await wearAndChoose(page, 'Dominator Suit');
    await autosaved(page);
    await tools(page).nth(1).click();
    await expect(page.locator('.gate')).toBeVisible();

    await expectNoAccessibilityViolations(page, testInfo, { label: 'bench-after-re-entry' });
  });
});
