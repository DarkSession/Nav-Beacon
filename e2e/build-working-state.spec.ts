import { expect, test, type Page } from '@playwright/test';
import {
  buildStockHull,
  expectRecords,
  openLibrary,
  reachShellAction,
  reachShellLink,
  recordCount,
  recordCountAfterFlush,
  savedToBrowser,
  setShipIdent,
} from './shell';

/**
 * Work that survives — and work that is never silently lost.
 *
 * The journeys here are the ones a Commander only notices when they go wrong:
 * a reload that keeps the build, two windows that do not fight over one
 * autosave, and a browser that refuses to store anything without taking the
 * build down with it.
 *
 * A build takes a record from the first decision made on it, so nothing is
 * asked before one build replaces another: what is left behind is on the
 * library's list if it carries a decision, and reachable again from its hull if
 * it does not. What is asserted here is that arithmetic: four edited builds
 * leave four records, opening a save writes nothing to it, the first edit forks,
 * and naming or overwriting returns the count to where it belongs (024/FR-001,
 * FR-008, FR-009).
 *
 * The workspace holding one of those builds is one of the four routes
 * `interface-conformance` walks and scans, so its landmarks, its heading, its
 * width and its axe scan are evidenced there (ledger surface
 * `system/cross-route-conformance`). The persistence notice is silent unless
 * there is a problem to act on, so a build that has reached storage and one that
 * has not render the same tree, and one scan covers both. What parts them is the
 * host attribute `savedToBrowser` reads.
 */

/** Creates a stock build and lands in the workspace. */
async function createBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
}

/** Creates a stock build and makes one decision on it, so it takes a record. */
async function createDecidedBuild(page: Page, hull = 'Anaconda', plate = 'NB-01'): Promise<void> {
  await createBuild(page, hull);
  await setShipIdent(page, plate);
}

/**
 * Saves the build the workspace is holding, from the workspace's own `SAVE`.
 *
 * The library commits open and delete since 2026-08-27; what should become of a
 * build is asked where a Commander is working in it (FR-009).
 */
async function saveActiveBuild(
  page: Page,
  name: string,
  mode: 'new' | 'overwrite' = 'new',
): Promise<void> {
  await reachShellAction(page, /^Save$/);
  const dialog = page.getByRole('dialog', { name: 'Save build' });
  await dialog.getByRole('textbox', { name: 'Build name' }).fill(name);
  // The modes are drawn only where both apply. A build with nothing to replace
  // has one thing `SAVE BUILD` can do, so there is no card to press (canvas 1c).
  const asNew = dialog.getByRole('radio', { name: 'Save as a new build' });
  if (mode === 'overwrite') {
    await dialog.getByRole('radio', { name: /^Overwrite/ }).check();
  } else if ((await asNew.count()) > 0) {
    await asNew.check();
  }
  await dialog.getByRole('button', { name: 'Save build' }).click();
  // The press returns before the record is written. A journey that reloads
  // straight after it takes the reload with the save still in flight: the work
  // stays in the unnamed record autosave already holds, and the library never
  // lists the name the save was meant to give it. The layer is what the
  // workspace closes once the write has resolved — and keeps open, carrying
  // why, when the write did nothing — so waiting for it to go is waiting for
  // the save itself.
  await expect(dialog).toBeHidden();
  // And nothing took its place. The layer also closes on a conflict, which
  // replaces it with the question of what to do about the revision that landed
  // first — a save that wrote nothing, and one that would pass a wait for the
  // layer alone.
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Chooses a library row, which is what the footer's actions act on.
 *
 * A row is named by its own words rather than by a label over them, so it is
 * found by its title — anchored, because "Anaconda" would otherwise also match
 * "Anaconda explorer" (WCAG 2.5.3).
 */
async function chooseRecord(page: Page, title: string): Promise<void> {
  const row = page.getByRole('button', { name: new RegExp(`^${title}\\b`, 'i') });
  await expect(async () => {
    await row.click({ timeout: 2_000 });
    await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

/** Renames the ship, which is a modelled edit and therefore forks a record. */
async function renameShip(page: Page, name: string): Promise<void> {
  // The title is the field, and leaving it is confirming it — the canvas draws
  // no control beside it (feature 002, "click to rename").
  await page.getByRole('button', { name: /Rename the ship/ }).click();
  const field = page.locator('.identity-fields__input');
  await field.fill(name);
  await field.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/**
 * The saved-build surface, whichever composition it is showing.
 *
 * Scoped, because it stands over the screen rather than replacing it since
 * 2026-08-28: a bare `getByText` reaches the workspace behind it, and a closed
 * save dialog holds the same record's name in a label of its own.
 */
const library = (page: Page) => page.getByRole('dialog', { name: 'Saved builds' });

/** The exact bytes one record is stored as, so "untouched" can be checked. */
async function recordBytes(page: Page, id: string): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), `ednb:record:${id}`);
}

/** The owned keys currently in this browser. */
function storedKeys(page: Page) {
  return page.evaluate(() => ({
    records: Object.keys(localStorage).filter((key) => key.startsWith('ednb:record:')),
    tab: sessionStorage.getItem('ednb:tab'),
  }));
}

test.describe('the tab’s working build', () => {
  test('is saved to one owned record and restored after a reload', async ({ page }) => {
    await createDecidedBuild(page);
    await savedToBrowser(page);

    const before = await storedKeys(page);
    expect(before.records).toHaveLength(1);
    expect(before.tab).not.toBeNull();

    await page.reload();

    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    await expect(page.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    // The same record, not a second one.
    expect((await storedKeys(page)).records).toEqual(before.records);
  });

  test('still claims the record a save produced, and restores from it', async ({ page }) => {
    // A save clears the autosave target on purpose, because autosave has no
    // path to a named record. The work is in the record the save produced, so
    // the tab keeps claiming it — released, the reload would restore nothing
    // from storage and the next change would mint a second record for a build
    // the Commander has just saved by name (001/FR-008, 017/FR-007).
    test.slow();
    await createDecidedBuild(page);
    await savedToBrowser(page);
    await saveActiveBuild(page, 'Explorer');

    const before = await storedKeys(page);
    expect(before.records).toHaveLength(1);
    expect(before.tab).toContain(before.records[0]!.replace('ednb:record:', ''));

    await page.reload();

    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    // The same record, still claimed, and no second one minted for the same
    // work. A released claim reaches here too — the address carries the build
    // link, so the build comes back either way — and it comes back as an
    // arrival rather than as the save, which autosave then stores again.
    await expectRecords(page, 1);
    const after = await storedKeys(page);
    expect(after.records).toEqual(before.records);
    expect(after.tab).toBe(before.tab);
    await openLibrary(page);
    await expect(library(page).getByText('Explorer').first()).toBeVisible();
  });

  test('writes nothing outside the keys this application owns', async ({ page }) => {
    await createDecidedBuild(page);
    await savedToBrowser(page);

    const keys = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));

    expect(keys.local.every((key) => key.startsWith('ednb:record:'))).toBe(true);
    expect(keys.session).toContain('ednb:tab');
    // Session state is this tab's browsing position and its own identity, and
    // nothing else claims a key here.
    expect(keys.session.every((key) => ['ednb:catalogue', 'ednb:tab'].includes(key))).toBe(true);
  });

  test('stores no calculated value, price or catalogue fact', async ({ page }) => {
    await createDecidedBuild(page);
    await savedToBrowser(page);

    const stored = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.startsWith('ednb:record:'),
      )!;
      return localStorage.getItem(key) ?? '';
    });

    for (const forbidden of ['HullValue', 'Rebuy', 'MaxJumpRange', 'retailCost', 'manufacturer']) {
      expect(stored, forbidden).not.toContain(forbidden);
    }
    // The modelled build, and the envelope around it. Nothing else.
    expect(stored).toContain('"format":"ednb.local-record"');
    expect(stored).toContain('"format":"ednb.build"');
  });

  test('gives two independent pages two working records', async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    await createDecidedBuild(first, 'Anaconda', 'NB-01');
    await savedToBrowser(first);
    await createDecidedBuild(second, 'SideWinder', 'NB-02');
    await savedToBrowser(second);

    // Neither page has overwritten the other's autosave. Polled, because the
    // count is read on one page and was written by the other: a status line
    // answers for the renderer that wrote, and the renderer that reads holds
    // its own copy of the store, which the write reaches a moment later.
    await expectRecords(first, 2);
    await expect(first.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    await expect(second.getByRole('banner').getByText('Sidewinder').first()).toBeVisible();

    await context.close();
  });

  test('forks a duplicated tab rather than sharing one working record', async ({ browser }) => {
    const context = await browser.newContext();
    const original = await context.newPage();
    await createDecidedBuild(original, 'Anaconda');
    await savedToBrowser(original);

    // A duplicated tab inherits the session, and so believes it owns the same
    // working record until the claim is negotiated.
    const tabState = await original.evaluate(() => sessionStorage.getItem('ednb:tab'));
    const duplicate = await context.newPage();
    await duplicate.goto('/outfitting');
    await duplicate.evaluate((state) => sessionStorage.setItem('ednb:tab', state!), tabState);
    await duplicate.reload();
    await expect(duplicate.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
    await reachShellLink(duplicate, 'Ship Builder');
    await duplicate.goto('/ships/SideWinder');
    await buildStockHull(duplicate, 'Build');
    await setShipIdent(duplicate, 'NB-02');
    await savedToBrowser(duplicate);

    // Polled on the page that did not write it: two pages are two renderers over
    // one store, and the forked record reaches this one after the page that
    // wrote it has reported it.
    await expect.poll(() => recordCount(original)).toBeGreaterThan(1);

    await context.close();
  });

  test('keeps editing available when the browser refuses to store anything', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Every storage access throws, which is what a browser with site data
    // blocked actually does.
    await page.addInitScript(() => {
      const blocked = {
        get length(): number {
          throw new DOMException('denied', 'SecurityError');
        },
        key: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        getItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        setItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        removeItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        clear: () => {
          throw new DOMException('denied', 'SecurityError');
        },
      };
      Object.defineProperty(window, 'localStorage', { get: () => blocked });
    });

    await createDecidedBuild(page);

    await expect(page.getByText(/not allowing the application to store/i)).toBeVisible();
    // The build is still there and the screen still works. The hull is on the
    // command bar's identity line, where canvas 1c puts it.
    await expect(page.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();

    await context.close();
  });

  test('keeps editing available when the store is full', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key.startsWith('ednb:record:')) {
          throw new DOMException('exceeded', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    });

    await createDecidedBuild(page);

    await expect(page.getByText(/storage is full/i)).toBeVisible();
    await expect(page.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose builds to discard' })).toBeVisible();

    await context.close();
  });

  test('leaves four builds in a row as four records, asking nothing', async ({ page }) => {
    // The withdrawn replacement question in one assertion: each build replaces
    // the last on screen and none of them is lost, because each carries a
    // decision and so has a record (FR-008, FR-009, ruled 2026-08-25;
    // 024/FR-001).
    test.slow();
    let expected = 0;
    for (const [index, hull] of ['Anaconda', 'SideWinder', 'Eagle', 'Python'].entries()) {
      await createDecidedBuild(page, hull, `NB-0${index + 1}`);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expected += 1;
      await expectRecords(page, expected);
    }
  });

  test('keeps a build nobody changed out of the library, and lists it at its first edit', async ({
    page,
  }) => {
    // A build straight from the hull catalogue holds nothing a Commander
    // decided: it is the loadout the package publishes, reached again by
    // selecting the hull. Nothing is stored for it, and the saved list has no
    // entry to show. The first decision made on it is what takes a record
    // (024/FR-001).
    test.slow();
    await createBuild(page);
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();

    // Counted after the workspace has answered for what it owes, rather than
    // polled: a poll for a count that only ever rises succeeds on its first
    // attempt, so it reads no later than a bare read would.
    expect(await recordCountAfterFlush(page)).toBe(0);
    await openLibrary(page);
    await expect(library(page).getByText('Nothing is stored yet')).toBeVisible();
    // The sentence under that heading states the rule this change replaces. It
    // is read on the screen a Commander reaches right after creating a build,
    // which is where being told that nothing is kept yet has to make sense
    // (024/FR-001).
    await expect(
      library(page).getByText(
        'Work is kept here in this browser from your first change to it, until you discard it.',
      ),
    ).toBeVisible();
    await page.goBack();
    await expect(library(page)).toBeHidden();

    await setShipIdent(page, 'NB-01');
    await savedToBrowser(page);

    await expectRecords(page, 1);
    await openLibrary(page);
    await expect(library(page).getByText('Nothing is stored yet')).toBeHidden();
    await expect(library(page).getByText('Anaconda').first()).toBeVisible();
  });

  test('opens the save layer on what the build is already called', async ({ page }) => {
    // Reported empty 2026-08-28: the common way to reach SAVE is on a build just
    // made from a hull, and the field started blank there. It starts from what
    // the build is called — the ship's name, its ident, or the hull — which is
    // the same rule the library titles an unnamed row by (FR-010).
    await createBuild(page);
    await reachShellAction(page, /^Save$/);

    const layer = page.getByRole('dialog', { name: 'Save build' });
    await expect(layer.getByRole('textbox', { name: 'Build name' })).toHaveValue('Anaconda');

    // Nothing to replace yet, so the layer asks nothing: the pair of modes or
    // neither.
    await expect(layer.locator('.save__modes .choice')).toHaveCount(0);
  });

  test('offers both modes once the build has a save to replace', async ({ page }) => {
    // The other half of the same report. A build that was saved, or opened from
    // a save, must be able to choose between replacing it and keeping both.
    test.slow();
    await createDecidedBuild(page);
    await savedToBrowser(page);
    await saveActiveBuild(page, 'Explorer');
    await reachShellAction(page, /^Save$/);

    const layer = page.getByRole('dialog', { name: 'Save build' });
    await expect(layer.getByRole('textbox', { name: 'Build name' })).toHaveValue('Explorer');
    await expect(layer.getByRole('radio')).toHaveCount(2);
    // Replacing is the one that stands, and it names the record it would take.
    await expect(layer.getByRole('radio').first()).toBeChecked();
    await expect(layer.getByText(/Overwrite/)).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/i }).click();

    // The same offer after opening that save from the library, and still there
    // once an edit has forked the working record away from it: what the layer
    // offers to replace is the build's provenance, not whether it is unedited.
    await openLibrary(page);
    await chooseRecord(page, 'Explorer');
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Open in outfitting', exact: true })
      .click();
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await renameShip(page, 'Vindicator');

    await reachShellAction(page, /^Save$/);
    await expect(layer.getByRole('radio')).toHaveCount(2);
    await expect(layer.getByRole('textbox', { name: 'Build name' })).toHaveValue('Explorer');
  });

  test('writes nothing to a saved build when it is opened', async ({ page }) => {
    // A build, a named save, and an open — three journeys' worth of waiting on
    // one page, which runs past the default budget on a loaded machine.
    test.slow();
    await createDecidedBuild(page);
    await savedToBrowser(page);
    await saveActiveBuild(page, 'Explorer');
    await openLibrary(page);
    await expect(library(page).getByText('Explorer').first()).toBeVisible();

    const id = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('ednb:record:'))[0]!
        .replace('ednb:record:', ''),
    );
    const saved = await recordBytes(page, id);

    // Opening it again writes nothing at all: the build is already recoverable
    // from what was opened.
    await chooseRecord(page, 'Explorer');
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Open in outfitting', exact: true })
      .click();
    await expect(page).toHaveURL(/\/outfitting(#|$)/);

    expect(await recordBytes(page, id)).toBe(saved);
    expect(await recordCount(page)).toBe(1);
  });

  test('forks an unnamed record at the first edit, leaving the save untouched', async ({
    page,
  }) => {
    test.slow();
    await createDecidedBuild(page);
    await savedToBrowser(page);
    await saveActiveBuild(page, 'Explorer');
    await openLibrary(page);
    await expect(library(page).getByText('Explorer').first()).toBeVisible();

    const id = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('ednb:record:'))[0]!
        .replace('ednb:record:', ''),
    );
    const saved = await recordBytes(page, id);

    await chooseRecord(page, 'Explorer');
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Open in outfitting', exact: true })
      .click();
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await renameShip(page, 'Vindicator');

    // A second record now holds the edits, and the save is byte-identical.
    await expectRecords(page, 2);
    expect(await recordBytes(page, id)).toBe(saved);
  });

  test('returns the count to where it was when the save is replaced', async ({ page }) => {
    test.slow();
    await createDecidedBuild(page);
    await savedToBrowser(page);
    await saveActiveBuild(page, 'Explorer');
    // Naming consumes the record the build was already in: one record, not two.
    await expectRecords(page, 1);
    await openLibrary(page);

    await chooseRecord(page, 'Explorer');
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Open in outfitting', exact: true })
      .click();
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await renameShip(page, 'Vindicator');
    await expectRecords(page, 2);

    await saveActiveBuild(page, 'Explorer', 'overwrite');

    // The unsaved entry these edits were in is consumed by the save that
    // replaced the build they came from.
    await expectRecords(page, 1);
  });
});
