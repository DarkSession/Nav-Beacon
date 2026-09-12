import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  COMMANDER_STATE_KEY,
  fleetAnswer,
  installCommanderService,
  library,
  ownedShip,
  ownedShipModel,
  recordNames,
  showOwnedShips,
} from './commander';
import { expectRecords, openLibrary, reachShellAction, savedToBrowser } from './shell';

/**
 * Taking a ship a Commander owns into the planning tools.
 *
 * An owned ship is read-only. What the builder receives is a copy with a record
 * identity of its own, and the journey below proves it the only way that can be
 * proved: it changes the copy, deletes the copy, and reads the fleet entry
 * afterwards (020/FR-017).
 *
 * The account and the fleet are stubbed at the network boundary rather than
 * seeded into storage, because what is under test starts at the answer the
 * service gives.
 */

const SHIP_NAME = 'Bright Anvil';
const SHIP_IDENT = 'BA-01';

/** A signed-in Commander whose account holds one ship. */
async function stubAccount(page: Page): Promise<void> {
  await installCommanderService(page, {
    session: 'signed-in',
    // The record exchange is answered as unreachable: these journeys are about
    // the fleet, and the records this browser holds stay in this browser either
    // way.
    exchange: () => 'unreachable',
    fleet: () => ({
      status: 200,
      body: fleetAnswer({
        ships: [ownedShip(12, ownedShipModel('Anaconda', SHIP_NAME, SHIP_IDENT))],
      }),
    }),
  });
}

/** Shows the ships the Commander owns and waits for the one the account holds. */
async function showTheShip(page: Page): Promise<void> {
  await showOwnedShips(page);
  await expect(library(page).getByRole('button', { name: SHIP_NAME })).toBeVisible({
    timeout: 15_000,
  });
}

/** What this browser has accepted for this account, exactly as it is stored. */
async function storedFleet(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return '';
    }
    const state = JSON.parse(raw) as { fleetCache?: unknown };
    return JSON.stringify(state.fleetCache ?? null);
  }, COMMANDER_STATE_KEY);
}

test.describe('the ships a Commander owns', () => {
  test('copies one into the builder as a build with its own identity', async ({
    page,
  }, testInfo) => {
    await stubAccount(page);
    await openLibrary(page);
    await showTheShip(page);

    // Nothing has been copied, so this browser holds no records at all.
    await expectRecords(page, 0);
    const fleetBefore = await storedFleet(page);
    expect(fleetBefore).not.toBe('');

    await library(page).getByRole('button', { name: SHIP_NAME }).click();
    await expectNoAccessibilityViolations(page, testInfo, { label: 'owned ships, ship chosen' });
    await library(page).getByRole('button', { name: 'Copy into the builder' }).click();

    await expect(page).toHaveURL(/\/outfitting/, { timeout: 15_000 });
    await savedToBrowser(page);

    // Autosave minted the copy a record of its own. The fleet entry is not one
    // of them: an owned ship is not an application record (020/FR-017).
    await expectRecords(page, 1);
    expect(await storedFleet(page)).toBe(fleetBefore);
  });

  test('changes and deletes the copy while the fleet entry stays exactly as it was', async ({
    page,
  }) => {
    await stubAccount(page);
    await openLibrary(page);
    await showTheShip(page);
    const fleetBefore = await storedFleet(page);

    await library(page).getByRole('button', { name: SHIP_NAME }).click();
    await library(page).getByRole('button', { name: 'Copy into the builder' }).click();
    await expect(page).toHaveURL(/\/outfitting/, { timeout: 15_000 });
    await savedToBrowser(page);
    await expectRecords(page, 1);

    // Changed: the copy is named, which is a write to the copy's own record.
    await reachShellAction(page, /^Save$/);
    const save = page.getByRole('dialog', { name: 'Save build' });
    await save.getByRole('textbox', { name: 'Build name' }).fill('Fleet copy');
    const asNew = save.getByRole('radio', { name: 'Save as a new build' });
    if ((await asNew.count()) > 0) {
      await asNew.check();
    }
    await save.getByRole('button', { name: 'Save build' }).click();
    await expect.poll(() => recordNames(page)).toContain('Fleet copy');
    expect(await storedFleet(page)).toBe(fleetBefore);

    // Deleted: the copy goes, and it is the only thing that goes.
    await openLibrary(page);
    const row = library(page).getByRole('button', { name: /^Fleet copy\b/ });
    await expect(async () => {
      await row.click({ timeout: 2_000 });
      await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: /Fleet copy/ })
      .getByRole('button', { name: 'Delete this build' })
      .click();

    await expect.poll(() => recordNames(page)).not.toContain('Fleet copy');

    // The fleet entry is untouched, and still there to be copied again.
    expect(await storedFleet(page)).toBe(fleetBefore);
    await showTheShip(page);
  });
});
