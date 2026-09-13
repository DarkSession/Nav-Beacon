import { expect, test, type Page, type TestInfo } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  acceptedExchange,
  accountDialog,
  conflictLayer,
  COMMANDER_NAME,
  deletionConfirmation,
  everyChangeApplied,
  everyChangeConflicts,
  installCommanderService,
  library,
  openAccountDialog,
  storedCommanderState,
  type CommanderService,
} from './commander';
import {
  buildStockHull,
  expectRecords,
  openLibrary,
  reachShellAction,
  savedToBrowser,
} from './shell';

/**
 * The Commander account, from the outside.
 *
 * Five journeys, and each of them is one claim the constitution makes about an
 * optional account: planning needs none, signing in merges rather than
 * replaces, a save that cannot reach the account is still a save, a record two
 * devices disagree about is answered by the Commander, and deleting the account
 * leaves the planning work where it is.
 *
 * The service is stubbed at the network boundary rather than seeded into
 * storage, because what is under test starts at the answer the service gives —
 * and because what the browser *sent* is half of what each of these journeys
 * has to prove.
 *
 * Every rendered state is scanned, as every journey in this suite scans one.
 */

const HULL = 'Anaconda';

/** One remote record the account already holds, which the merge brings here. */
const ACCOUNT_RECORD = {
  format: 'ednb.remote-record',
  version: 1,
  id: '4f1d2a70-6f9c-4c1a-9a1e-2b0c5d8e7f30',
  tool: 'ship',
  kind: 'named',
  createdAt: '2026-09-01T10:00:00.000Z',
  modifiedAt: '2026-09-01T10:00:00.000Z',
  build: {
    format: 'ednb.build',
    version: 1,
    shipSymbol: HULL,
    shipName: 'Account plan',
    shipIdent: null,
    modules: [],
  },
} as const;

/**
 * A stock build of the reference hull, autosaved into this browser.
 *
 * `held` is how many records this browser should hold once the build is
 * stored, so that a test wanting two of them can say so.
 */
async function planSomething(page: Page, held = 1): Promise<void> {
  await page.goto(`/ships/${HULL}`);
  await buildStockHull(page, englishMessages['hullDetail.create']);
  await savedToBrowser(page);
  await expectRecords(page, held);
}

/**
 * Names the build on screen, so the record it was in stops being the working
 * one and the next build gets a working record of its own.
 *
 * A browser holding two records is what a response refusing two of them needs.
 */
async function nameActiveBuild(page: Page, name: string): Promise<void> {
  await reachShellAction(page, /^Save$/);
  const dialog = page.getByRole('dialog', { name: englishMessages['workspace.save.title'] });
  await dialog
    .getByRole('textbox', { name: englishMessages['workspace.save.name.label'] })
    .fill(name);
  await dialog.getByRole('button', { name: englishMessages['workspace.save.confirm'] }).click();
  await expect(dialog).toHaveCount(0);
}

/** The identity of the first live record this browser has offered the account. */
function offeredRecordId(service: CommanderService): string | null {
  for (const change of service.sent.flatMap((exchange) => exchange.changes)) {
    const record = change['record'];
    if (typeof record === 'object' && record !== null && 'id' in record) {
      const id = (record as { id: unknown }).id;
      if (typeof id === 'string') return id;
    }
  }
  return null;
}

/** Waits until this browser has offered its record, and names what it offered. */
async function recordOffered(service: CommanderService): Promise<string> {
  await expect.poll(() => offeredRecordId(service), { timeout: 15_000 }).not.toBeNull();
  const offered = offeredRecordId(service);
  if (offered === null) throw new Error('this browser offered the account no record');
  return offered;
}

/** The synchronisation region the record library draws above its list. */
function synchronisation(page: Page) {
  return library(page).locator('ednb-synchronisation-panel');
}

/** Opens the record library and waits for what it says about the account. */
async function openRecords(page: Page): Promise<void> {
  await openLibrary(page);
  await expect(synchronisation(page)).toBeVisible();
}

/** Every change of every exchange answered as applied. */
function applyEverything(service: CommanderService, accountRevision = 1): void {
  service.exchange = (request) => ({
    status: 200,
    body: everyChangeApplied(request, accountRevision),
  });
}

async function scan(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await expectNoAccessibilityViolations(page, testInfo, { label });
}

test.describe('the Commander account', () => {
  test('plans without an account and signs in only when asked', async ({ page }, testInfo) => {
    const service = await installCommanderService(page, { session: 'anonymous' });

    // Every planning tool works with no account at all, and nothing is sent.
    await planSomething(page);
    expect(service.asked).not.toContain('synchronise');

    await openAccountDialog(page);
    const dialog = accountDialog(page);
    await expect(dialog).toContainText(englishMessages['account.status.anonymous']);
    // What the account holds is stated before a Commander signs in, not after
    // (020/FR-005).
    await expect(dialog).toContainText(englishMessages['account.data.title']);
    await expect(dialog).toContainText(englishMessages['account.data.identity']);
    await expect(dialog).toContainText(englishMessages['account.data.credentials']);
    // Which of these actions need a network, said whether or not there is one
    // (020/FR-022).
    await expect(dialog).toContainText(englishMessages['account.network.notice']);
    await scan(page, testInfo, 'account dialog, anonymous');

    // The one deliberate navigation off this origin.
    await dialog.getByRole('button', { name: englishMessages['account.sign-in'] }).click();
    await expect(page).toHaveURL(/^https:\/\/auth\.frontierstore\.net\//, { timeout: 15_000 });

    // Frontier sends the Commander back, and the identity on screen is the one
    // the session states rather than one this browser chose (020/FR-002).
    applyEverything(service);
    service.session = 'signed-in';
    await page.goto('/ships?account=signed-in');
    await expect(accountDialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(accountDialog(page)).toContainText(englishMessages['account.status.signed-in']);
    await expect(accountDialog(page)).toContainText(COMMANDER_NAME);
    // The callback marker is taken out of the address rather than left in it.
    await expect(page).not.toHaveURL(/account=/);
    await scan(page, testInfo, 'account dialog, signed in');
  });

  test('merges this browser and the account on the first sign-in', async ({ page }, testInfo) => {
    const service = await installCommanderService(page, { session: 'anonymous' });
    await planSomething(page);

    service.session = 'signed-in';
    service.exchange = (request) => ({
      status: 200,
      body: {
        ...everyChangeApplied(request, 3),
        records: [{ revision: 3, record: ACCOUNT_RECORD }],
      },
    });

    await page.goto('/ships');
    await openRecords(page);

    // This browser's own record was offered, and the account's came back.
    await expect
      .poll(() => service.sent.flatMap((exchange) => exchange.changes).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const offered = service.sent.flatMap((exchange) => exchange.changes);
    expect(offered.some((change) => change['type'] === 'write')).toBe(true);
    // A note is local, and no request may carry one (020/FR-019).
    expect(JSON.stringify(service.sent)).not.toContain('"note"');

    await expect(library(page)).toContainText('Account plan', { timeout: 15_000 });
    await expect(synchronisation(page)).toContainText(
      'Your account has every record on this device',
    );
    await scan(page, testInfo, 'record library, first merge');
  });

  test('saves while the account cannot be reached, and catches up on a retry', async ({
    page,
  }, testInfo) => {
    const service = await installCommanderService(page, {
      session: 'signed-in',
      exchange: () => 'unreachable',
    });

    // The save lands in this browser whatever the network does (020/FR-011).
    await planSomething(page);
    await openRecords(page);
    await expect(synchronisation(page)).toContainText(
      englishMessages['sync.status.failed.offline'],
      { timeout: 15_000 },
    );
    await scan(page, testInfo, 'record library, account unreachable');

    applyEverything(service);
    await synchronisation(page)
      .getByRole('button', { name: englishMessages['action.retry'] })
      .click();
    await expect(synchronisation(page)).toContainText(
      'Your account has every record on this device',
      {
        timeout: 15_000,
      },
    );
    await expectRecords(page, 1);
  });

  test('asks about the next record when one question is set aside', async ({ page }) => {
    test.slow();
    const service = await installCommanderService(page, { session: 'signed-in' });

    // Nothing reaches the account while the records are made, so both saves are
    // still waiting when the account finally answers. A save that cannot reach
    // the account is still a save (020/FR-011).
    service.exchange = () => 'unreachable';

    // The first is named, so the second gets a working record of its own rather
    // than replacing it.
    await planSomething(page);
    await nameActiveBuild(page, 'First plan');
    await planSomething(page, 2);

    // The account is reachable again and disagrees about both records, holding
    // no copy of either: each is a record deleted on another device. One
    // response refuses them together, so two questions stand at once
    // (020/FR-010).
    service.exchange = (request) => everyChangeConflicts(request);

    await openRecords(page);

    const conflict = conflictLayer(page);
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(synchronisation(page)).toContainText('2 records');

    // Setting the first question aside answers nothing and says nothing about
    // the second. The layer moves on to the record still unanswered, rather
    // than leaving it out of reach for the rest of the visit while the status
    // above it goes on counting it (020/FR-009, 020/FR-010).
    await conflict.getByRole('button', { name: englishMessages['action.close'] }).click();
    await expect(conflict).toBeVisible();

    await conflict.getByRole('button', { name: englishMessages['action.close'] }).click();
    await expect(conflict).toHaveCount(0);

    // Neither question was answered, so both records stay exactly as they are.
    await expectRecords(page, 2);
    await expect(synchronisation(page)).toContainText('2 records');
  });

  test('asks the Commander about a record the account no longer holds', async ({
    page,
  }, testInfo) => {
    const service = await installCommanderService(page, { session: 'signed-in' });
    applyEverything(service);

    // The save this browser makes reaches the account, and the account takes
    // it. Every step after this one is about a record both sides hold.
    await planSomething(page);
    const deleted = await recordOffered(service);

    // Another device deletes that record. The account's own stream is where
    // this page finds the deletion, while it still holds the record itself
    // (020/FR-010).
    service.exchange = () => ({
      status: 200,
      body: acceptedExchange({
        accountRevision: 2,
        tombstones: [{ id: deleted, revision: 2 }],
      }),
    });

    await openRecords(page);

    // Three answers, and dismissing the layer answers none of them
    // (020/FR-009, 020/FR-010).
    const conflict = conflictLayer(page);
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toContainText(englishMessages['sync.conflict.deleted.description']);
    for (const answer of [
      englishMessages['sync.conflict.overwrite'],
      englishMessages['sync.conflict.keep-both'],
      englishMessages['sync.conflict.cancel'],
    ]) {
      await expect(conflict.getByRole('button', { name: answer })).toBeVisible();
    }
    await scan(page, testInfo, 'record conflict layer');

    // Dismissing the layer is not a fourth answer. The layer goes, the record
    // stays listed, and nothing about it has been settled — this browser's copy
    // is not local-only, because nobody said to leave both as they are
    // (020/FR-009, 020/FR-010).
    await conflict.getByRole('button', { name: englishMessages['action.close'] }).click();
    await expect(conflict).toHaveCount(0);
    await expectRecords(page, 1);
    await expect(synchronisation(page)).not.toContainText('kept in this browser only');

    // And the question is asked again the next time the library is opened,
    // because dismissal set the layer aside rather than the conflict.
    await library(page).getByRole('button', { name: englishMessages['action.close'] }).click();
    await expect(library(page)).toHaveCount(0);
    await openRecords(page);
    await expect(conflict).toBeVisible({ timeout: 15_000 });

    await conflict.getByRole('button', { name: englishMessages['sync.conflict.cancel'] }).click();
    await expect(conflict).toHaveCount(0);

    // Both versions stay: this browser keeps its copy, and the copy stops
    // synchronising until it is saved again (020/FR-010, 020/FR-024).
    await expectRecords(page, 1);
    await expect(synchronisation(page)).toContainText('kept in this browser only', {
      timeout: 15_000,
    });
    await scan(page, testInfo, 'record library, answered conflict');
  });

  test('deletes the account and leaves the planning records here', async ({ page }, testInfo) => {
    const service = await installCommanderService(page, { session: 'signed-in' });
    applyEverything(service);

    await planSomething(page);
    await openAccountDialog(page, true);

    await accountDialog(page)
      .getByRole('button', { name: englishMessages['account.delete.action'] })
      .click();

    // The destructive answer is behind a layer of its own, and says exactly
    // what leaves the server and what stays here (020/FR-006).
    const confirmation = deletionConfirmation(page);
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(englishMessages['account.delete.description']);
    await scan(page, testInfo, 'account deletion confirmation');

    await confirmation
      .getByRole('button', { name: englishMessages['account.delete.confirm'] })
      .click();

    await expect.poll(() => service.asked, { timeout: 15_000 }).toContain('delete-account');
    await expect(accountDialog(page)).toContainText(englishMessages['account.status.anonymous'], {
      timeout: 15_000,
    });

    // The planning work stays, and this browser holds nothing about the account.
    await expectRecords(page, 1);
    expect(await storedCommanderState(page)).not.toContain(COMMANDER_NAME);
    await scan(page, testInfo, 'account dialog, after deletion');
  });
});
