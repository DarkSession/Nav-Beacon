import { expect, test, type Page, type TestInfo } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  fleetAnswer,
  installCommanderService,
  library,
  ownedShip,
  ownedShipModel,
  showOwnedShips,
  type CommanderService,
} from './commander';
import { openLibrary } from './shell';

/**
 * The ships a Commander owns, and what a refresh of them may claim.
 *
 * The fleet is a projection of Frontier journal, so almost every state here is
 * a statement about what the service could and could not confirm. What the
 * journeys below hold it to is that the ships already accepted stay on screen
 * through every one of those states, and that nothing says the fleet is current
 * unless the service answered that it is (020/FR-016, 020/FR-018, 020/FR-022).
 *
 * Copying an owned ship into the planning tools is its own journey, in
 * `fleet-copy.spec.ts`.
 */

const FIRST_SHIP = 'Bright Anvil';
const SECOND_SHIP = 'Quiet Ledger';

/** The owned-ships region inside the stored-build layer. */
function fleet(page: Page) {
  return library(page).locator('ednb-owned-ships-panel');
}

/** Opens the stored-build layer on the ships the Commander owns. */
async function openOwnedShips(page: Page): Promise<void> {
  await openLibrary(page);
  await showOwnedShips(page);
  await expect(fleet(page)).toBeVisible();
}

/** One settled fleet holding one ship. */
function oneShip(): Record<string, unknown> {
  return fleetAnswer({
    ships: [ownedShip(12, ownedShipModel('Anaconda', FIRST_SHIP, 'BA-01'))],
  });
}

/** The same fleet with a second ship a later journal read confirmed. */
function twoShips(): Record<string, unknown> {
  return fleetAnswer({
    ships: [
      ownedShip(12, ownedShipModel('Anaconda', FIRST_SHIP, 'BA-01')),
      ownedShip(13, ownedShipModel('Python', SECOND_SHIP, 'QL-02'), '2026-09-02', 5),
    ],
  });
}

/** Answers the fleet read with one ship and each refresh with what is next. */
function refreshesWith(
  service: CommanderService,
  answers: readonly Record<string, unknown>[],
): void {
  let next = 0;
  service.fleet = (asked) => {
    if (asked === 'read') {
      return { status: 200, body: oneShip() };
    }
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    return { status: 200, body: answer };
  };
}

async function scan(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await expectNoAccessibilityViolations(page, testInfo, { label });
}

/** Asks the service to read more journal. */
async function refresh(page: Page): Promise<void> {
  await fleet(page).getByRole('button', { name: englishMessages['fleet.refresh'] }).click();
}

test.describe('the ships a Commander owns', () => {
  test('lists the accepted fleet and says what journal it was read from', async ({
    page,
  }, testInfo) => {
    const service = await installCommanderService(page, { session: 'signed-in' });
    refreshesWith(service, [twoShips()]);

    await openOwnedShips(page);
    await expect(fleet(page).getByRole('button', { name: FIRST_SHIP })).toBeVisible({
      timeout: 15_000,
    });
    await expect(fleet(page)).toContainText(englishMessages['fleet.status.current']);
    // The interval the projection covers, which is what makes an incomplete
    // fleet checkable rather than a claim (020/FR-016).
    await expect(fleet(page)).toContainText('Journal read from');
    await scan(page, testInfo, 'owned ships, current');

    await refresh(page);
    await expect(fleet(page).getByRole('button', { name: SECOND_SHIP })).toBeVisible({
      timeout: 15_000,
    });
    expect(service.asked).toContain('fleet-refresh');
    await scan(page, testInfo, 'owned ships, after a refresh');
  });

  test('states a held refresh and a failed one without emptying the list', async ({
    page,
  }, testInfo) => {
    const service = await installCommanderService(page, { session: 'signed-in' });
    refreshesWith(service, [
      fleetAnswer({ result: 'waiting', ships: [] }),
      fleetAnswer({ result: 'failed', failure: 'frontier-unavailable', ships: [] }),
    ]);

    await openOwnedShips(page);
    await expect(fleet(page).getByRole('button', { name: FIRST_SHIP })).toBeVisible({
      timeout: 15_000,
    });

    // Frontier holds the next attempt. The ships already accepted stay.
    await refresh(page);
    await expect(fleet(page)).toContainText(englishMessages['fleet.status.waiting'], {
      timeout: 15_000,
    });
    await expect(fleet(page)).toContainText(englishMessages['fleet.detail.waiting']);
    await expect(fleet(page).getByRole('button', { name: FIRST_SHIP })).toBeVisible();
    await scan(page, testInfo, 'owned ships, refresh held');

    // And a refresh that stopped says so, and says the list is what was last
    // accepted rather than what was just confirmed (020/FR-018).
    await refresh(page);
    await expect(fleet(page)).toContainText(englishMessages['fleet.status.failed.frontier'], {
      timeout: 15_000,
    });
    await expect(fleet(page)).toContainText(englishMessages['fleet.detail.last-accepted']);
    await expect(fleet(page).getByRole('button', { name: FIRST_SHIP })).toBeVisible();
    await scan(page, testInfo, 'owned ships, refresh failed');
  });

  test('offers a sign-in rather than a fleet when there is no account', async ({
    page,
  }, testInfo) => {
    await installCommanderService(page, { session: 'anonymous' });

    await openOwnedShips(page);
    await expect(fleet(page)).toContainText(englishMessages['fleet.status.sign-in-required']);
    await expect(
      fleet(page).getByRole('button', { name: englishMessages['account.sign-in'] }),
    ).toBeVisible();
    await scan(page, testInfo, 'owned ships, sign-in required');
  });
});
