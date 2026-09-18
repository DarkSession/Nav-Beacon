import { expect, test, type Locator, type Page } from '@playwright/test';
import { sweepOutfittingState } from './accessibility';
import { reachShellAction, recordCountAfterFlush } from './shell';

/**
 * Handing a loadout to someone else (US4).
 *
 * The link is the address bar itself: the bench publishes what is on it after
 * every choice, and opening that address anywhere restores the same loadout —
 * held content included (FR-018a, FR-020). A link that names something this
 * version cannot resolve says so and leaves the bench alone (FR-021).
 */

async function wearSuit(page: Page, name: string): Promise<void> {
  await page.locator('.gate__suits .choice').filter({ hasText: name }).click();
  await expect(page.locator('.gate')).toHaveCount(0);
}

async function openRow(page: Page, target: string): Promise<void> {
  // The bench has to be drawn before its arrangement can be read. A page still
  // booting has no region at all and `count()` answers 0 for every one of them,
  // so an unguarded read takes "no ledger" to mean "drilled in" and waits out
  // the test looking for a back control on a screen that is not there yet —
  // which is how a fresh load of a shared link timed out at 60s on the compact
  // projects (CI, 2026-09-04). The page's own host is what says it has booted:
  // no region is drawn in every arrangement, and the compact bench draws one
  // tab at a time.
  await expect(page.locator('ednb-equipment-bench-page')).toBeAttached();

  const tab = page.getByRole('tab', { name: 'Loadout' });
  if ((await tab.count()) > 0) await tab.click();
  if ((await page.locator('.bench__region--loadout').count()) === 0) {
    await page.locator('.item__back').click();
  }
  await page.locator(`.ledger__row[data-target="${target}"]`).click();
  // Wide keeps the item column on screen while its contents change, so waiting
  // for the column says nothing. Wait for it to be about this row.
  await expect(page.locator(`.item[data-target="${target}"]`)).toBeVisible();
}

/**
 * The rows a Commander swaps from, wherever the composition draws them.
 *
 * Canvas 1a lists them inline under the modification slots, always on screen;
 * canvas 1b opens the same rows in a sheet over the drill-in.
 */
function swapList(page: Page): Locator {
  return page.locator('.item__alternatives .choice');
}

/** Chooses one of them. */
async function pickSwap(row: Locator): Promise<void> {
  await row.click();
}

/** Fits the first weapon a mount offers, and answers with what it is called. */
async function fitFirstWeapon(page: Page, mount: string): Promise<string> {
  await openRow(page, mount);
  const choice = swapList(page).first();
  const name = (await choice.locator('.choice__name').textContent())?.trim() ?? '';
  await pickSwap(choice);
  return name;
}

/** The layer the shell's `EXPORT` opens. */
async function openExport(page: Page) {
  await reachShellAction(page, /^Export$/);
  const dialog = page.getByRole('dialog', { name: 'Export loadout' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('handing a loadout to someone else', () => {
  test('publishes a loadout nobody changed, and restores it from the address', async ({ page }) => {
    // The address carries the loadout from the moment a suit is chosen, before
    // any other choice is made on it. That is the whole of what holds it: a
    // loadout at its suit's default is stored nowhere, so a fresh load of that
    // address read it from the address and from nothing else (024/FR-002,
    // 024/FR-003).
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');

    await expect(async () => {
      expect(await page.evaluate(() => location.hash)).toMatch(/^#e\./);
    }).toPass({ timeout: 5_000 });
    const link = await page.evaluate(() => location.href);

    // Counted after the page has answered for what it owes. The bench is still
    // open, and a count taken on an open page is the same answer whether or not
    // a write is owed.
    expect(await recordCountAfterFlush(page)).toBe(0);

    await page.goto('about:blank');
    await page.goto(link);

    await expect(page.locator('.gate')).toHaveCount(0);
    await openRow(page, 'suit');
    await expect(page.locator('.item__name')).toContainText('Dominator Suit');
    // Through the flush on this side of the load as well: the restored bench is
    // an open page too, and the count it answers with is worth no more than the
    // one before it.
    expect(await recordCountAfterFlush(page)).toBe(0);
  });

  test('publishes the loadout as the address, and restores it from there', async ({ page }) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');
    const weapon = await fitFirstWeapon(page, 'PrimaryWeapon1');
    await openRow(page, 'suit');
    await page.locator('.grade').last().click();
    // The link carries the loadout on the bench, so the bench has to have the
    // choice before the address can be expected to.
    await expect(page.locator('.grade[data-selected="true"]')).toHaveText('G5');

    // Published after every choice, without a control having been pressed.
    // Read from the document rather than from the driver: the fragment is
    // replaced in place, which is not a navigation.
    await expect(async () => {
      expect(await page.evaluate(() => location.hash)).toMatch(/^#e\./);
    }).toPass({ timeout: 5_000 });
    const link = await page.evaluate(() => location.href);

    // Opened as a Commander receiving it would: a fresh load of that address.
    await page.goto('about:blank');
    await page.goto(link);

    await expect(page.locator('.gate')).toHaveCount(0);
    await openRow(page, 'suit');
    await expect(page.locator('.item__name')).toContainText('Dominator Suit');
    await expect(page.locator('.grade[data-selected="true"]')).toHaveText('G5');
    await openRow(page, 'PrimaryWeapon1');
    await expect(page.locator('.item__name')).toContainText(weapon);
  });

  test('keeps a weapon on a mount the worn suit does not offer (FR-018a)', async ({ page }) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');
    const held = await fitFirstWeapon(page, 'PrimaryWeapon2');
    await openRow(page, 'suit');
    await pickSwap(swapList(page).filter({ hasText: 'Maverick Suit' }));
    await expect(page.locator('.item__name')).toContainText('Maverick Suit');

    const link = await page.evaluate(() => location.href);
    await page.goto('about:blank');
    await page.goto(link);

    // The Maverick carries one primary, so the second draws no row — but the
    // weapon on it survived the link, which is what FR-018a is about. Put the
    // Dominator back on and there it is.
    await expect(page.locator('.ledger__row[data-target="PrimaryWeapon2"]')).toHaveCount(0);
    await openRow(page, 'suit');
    await pickSwap(swapList(page).filter({ hasText: 'Dominator Suit' }));

    // Compact draws the ledger behind its own tab, so ask for it back before
    // reading a row: `openRow` is what knows how to reach one either way.
    await openRow(page, 'PrimaryWeapon2');
    await expect(page.locator('.item[data-target="PrimaryWeapon2"] .item__name')).toContainText(
      held,
    );
  });

  test('offers the loadout as an object, a link and a readable summary', async ({
    page,
  }, testInfo) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');
    const dialog = await openExport(page);

    // Canvas 1a's three formats, each a choice named in words.
    await expect(dialog.getByRole('radio')).toHaveCount(3);
    for (const format of ['Loadout JSON', 'Share link', 'Plain text']) {
      await expect(dialog.getByRole('radio', { name: new RegExp(format) })).toBeVisible();
    }

    const payload = dialog.getByRole('textbox', { name: 'Loadout JSON' });
    await expect(payload).toHaveValue(/"format": "ednb\.loadout"/);
    // Identities only: nothing the package can answer leaves the bench.
    await expect(payload).not.toHaveValue(/shieldStrength|damagePerSecond/);

    // Canvas 1a's `#ge-exp-meta`, across from the two actions: what was written,
    // counted. The suit counts among the items, so a bench carrying nothing else
    // is one item and no modifications.
    const meta = dialog.locator('.export-loadout__meta');
    await expect(meta).toHaveText(/^Loadout JSON · 1 item · 0 mods · \d+\.\d KB$/);

    await sweepOutfittingState(page, testInfo, 'export loadout');

    await dialog.getByRole('radio', { name: /Plain text/ }).check();
    await expect(dialog.getByRole('textbox', { name: 'Plain text' })).toHaveValue(/Dominator Suit/);
    // The line is about the text this format wrote, so both ends of it move.
    await expect(meta).toHaveText(/^Plain text · 1 item · 0 mods · \d+\.\d KB$/);

    await dialog.getByRole('radio', { name: /Share link/ }).check();
    await expect(dialog.getByText(/#e\./)).toBeVisible();
  });
});

/**
 * A link that has been out in the world, transcribed rather than minted here.
 *
 * It is the Dominator entry of `published-equipment-links.fixture.json`: table 1, every mount
 * filled, every modification slot held. A link this application wrote today would prove only that
 * it agrees with itself, so the corpus is what says a shared link still opens.
 */
const PUBLISHED_LINK = 'e.4f@yCeG44mGCq1hcPOnHxlG';

/**
 * The same loadout under table 2, which this application does not carry.
 *
 * Captured from the test-only table the unit suite drives version selection with, so the payload
 * is well formed in every way but the number it names.
 */
const LINK_FROM_A_TABLE_THIS_VERSION_LACKS = 'e.784_peEBdC5G1GTekg-:wnS';

test.describe('a loadout link already shared', () => {
  test('opens on the loadout it was shared as, whatever table this version writes', async ({
    page,
  }) => {
    await page.goto(`/equipment#${PUBLISHED_LINK}`);

    // The gate stands until a suit is worn, so its absence is the link having opened.
    await expect(page.locator('.gate')).toHaveCount(0);

    await openRow(page, 'suit');
    await expect(page.locator('.item[data-target="suit"] .item__name')).toContainText(
      'Dominator Suit',
    );

    for (const [mount, weapon] of [
      ['PrimaryWeapon1', 'Manticore Oppressor'],
      ['PrimaryWeapon2', 'Manticore Executioner'],
      ['SecondaryWeapon', 'Karma P-15'],
    ]) {
      await openRow(page, mount!);
      await expect(page.locator(`.item[data-target="${mount}"] .item__name`)).toContainText(
        weapon!,
      );
    }
  });
});

test.describe('a loadout link naming a table this version does not carry', () => {
  test('says so where the Commander is, and leaves the open loadout alone', async ({ page }) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Maverick Suit');

    await page.evaluate((fragment) => {
      location.hash = fragment;
    }, LINK_FROM_A_TABLE_THIS_VERSION_LACKS);

    const notice = page.locator('ednb-status-notice');
    await expect(notice).toBeVisible();
    // A loadout link, said as one: the ship builder's wording is about a build.
    await expect(notice).toContainText(/loadout link/i);
    await expect(notice).toContainText(/newer version of the application/i);
    await expect(notice).not.toContainText(/build link/i);

    // What the Commander had is still there. A refusal replaces nothing.
    await expect(page.locator('.gate')).toHaveCount(0);
    await openRow(page, 'suit');
    await expect(page.locator('.item[data-target="suit"] .item__name')).toContainText(
      'Maverick Suit',
    );
  });
});

test.describe('a loadout link this version cannot read', () => {
  test('says so where the Commander is, and leaves the bench as it was', async ({ page }) => {
    // An `e.` fragment that is not a loadout this application minted.
    await page.goto('/equipment#e.notaloadoutatall');

    const notice = page.locator('ednb-status-notice');
    await expect(notice).toBeVisible();
    // Said in words a Commander can act on, never as a codec's own diagnostic,
    // and never by a journal key (FR-021).
    await expect(notice).toContainText(/could not be read/i);
    await expect(notice).not.toContainText('PrimaryWeapon');
    await expect(notice).not.toContainText('table');

    // The bench is exactly what it was: nothing was opened, nothing replaced.
    await expect(page.locator('.gate')).toBeVisible();
  });

  test('leaves a loadout already on the bench untouched', async ({ page }) => {
    await page.goto('/equipment');
    await wearSuit(page, 'Dominator Suit');

    // Pasted into the address of a bench that is already holding something.
    await page.evaluate(() => {
      location.hash = 'e.notaloadoutatall';
    });

    await expect(page.locator('ednb-status-notice')).toBeVisible();
    await expect(page.locator('.gate')).toHaveCount(0);
    await openRow(page, 'suit');
    await expect(page.locator('.item__name')).toContainText('Dominator Suit');
  });
});
