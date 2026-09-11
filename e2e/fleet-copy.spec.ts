import { expect, test, type Page } from '@playwright/test';
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

const CUSTOMER = '900001';
const SHIP_NAME = 'Bright Anvil';
const SHIP_IDENT = 'BA-01';

/** The Commander state key, which is where an accepted fleet is kept. */
const COMMANDER_STATE = 'ednb:commander-state';

/**
 * The package-produced ship model, in the shape the service stores it.
 *
 * It states the hull and the Commander's own names for the ship, and no
 * modules: the package populates every fixed mount with that hull's default,
 * and a mount it defaulted is ordinary build state. Written out here rather
 * than produced from the package, because the end-to-end suite runs in Node and
 * the package's subpaths are resolved by the application's build rather than by
 * Node.
 */
function ownedShipModel(hullSymbol: string): Record<string, unknown> {
  return {
    hullSymbol,
    shipName: SHIP_NAME,
    shipIdent: SHIP_IDENT,
    modules: [],
  };
}

/** One settled fleet answer, as `GET api/fleet` sends it. */
function fleetBody(): Record<string, unknown> {
  return {
    result: 'current',
    ships: [
      {
        shipId: 12,
        sourceDate: '2026-09-01',
        sourceLine: 3,
        model: ownedShipModel('Anaconda'),
      },
    ],
    coverage: {
      startDate: '2026-08-18',
      cursorDate: '2026-09-02',
      cursorLine: 7,
      storedShips: { date: '2026-09-01', line: 3, complete: true },
      nextPermittedRefreshAt: null,
    },
    pending: false,
    failure: null,
    packageRefusal: null,
  };
}

/**
 * A signed-in Commander whose account holds one ship.
 *
 * The record exchange is answered as unreachable: these journeys are about the
 * fleet, and the records this browser holds stay in this browser either way.
 */
async function stubAccount(page: Page): Promise<void> {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        signedIn: true,
        customerId: CUSTOMER,
        commanderName: 'CMDR Jameson',
        antiForgeryToken: 'token-1',
      }),
    }),
  );
  await page.route('**/api/fleet', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fleetBody()),
    }),
  );
  await page.route('**/api/records/synchronise', (route) => route.fulfill({ status: 503 }));
}

/** The layer, whichever of its two views is showing. */
function library(page: Page) {
  return page.getByRole('dialog', { name: 'Saved builds' });
}

/** Shows the ships the Commander owns, inside the stored-build layer. */
async function showOwnedShips(page: Page): Promise<void> {
  await library(page).getByRole('button', { name: 'Owned ships', exact: true }).click();
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
  }, COMMANDER_STATE);
}

/** Every record this browser holds, by name. */
async function recordNames(page: Page): Promise<readonly (string | null)[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ednb:record:'))
      .map(
        (key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { name?: string }).name ?? null,
      ),
  );
}

test.describe('the ships a Commander owns', () => {
  test('copies one into the builder as a build with its own identity', async ({ page }) => {
    await stubAccount(page);
    await openLibrary(page);
    await showOwnedShips(page);

    // Nothing has been copied, so this browser holds no records at all.
    await expectRecords(page, 0);
    const fleetBefore = await storedFleet(page);
    expect(fleetBefore).not.toBe('');

    await library(page).getByRole('button', { name: SHIP_NAME }).click();
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
    await showOwnedShips(page);
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
    await showOwnedShips(page);
    await expect(library(page).getByRole('button', { name: SHIP_NAME })).toBeVisible();
  });
});
