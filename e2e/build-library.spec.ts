import { expect, test, type Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import { expectNoDocumentOverflow, expectSingleVisibleH1 } from './accessibility/assertions';
import {
  buildStockHull,
  expectRecords,
  openLibrary,
  openRecordFromLibrary,
  reachShellAction,
  recordCount,
  regroupCoreMount,
  savedToBrowser,
} from './shell';

/**
 * Managing what this browser is holding.
 *
 * Every destructive step here is confirmed and names what it will remove, and
 * the concurrency journeys drive two real pages into a real conflict rather
 * than simulating one — because the thing being tested is that neither
 * Commander's version disappears.
 */

/** A record seeded directly, so a listing state can be reached without a journey. */
function seedRecord(
  id: string,
  overrides: Record<string, unknown> = {},
): { key: string; value: string } {
  return {
    key: `ednb:record:${id}`,
    value: JSON.stringify({
      format: 'ednb.local-record',
      version: 1,
      id,
      kind: 'named',
      revisionId: `revision-${id}`,
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
      name: `Build ${id}`,
      note: null,
      hullSymbol: 'Anaconda',
      validation: { valid: true, complete: true },
      build: {
        format: 'ednb.build',
        version: 1,
        shipSymbol: 'Anaconda',
        shipName: null,
        shipIdent: null,
        modules: [],
      },
      sourceNamed: null,
      ...overrides,
    }),
  };
}

/** Puts values into the store before the application boots. */
async function seed(page: Page, entries: readonly { key: string; value: string }[]): Promise<void> {
  await page.addInitScript((seeded) => {
    for (const { key, value } of seeded) {
      localStorage.setItem(key, value);
    }
  }, entries);
}

/**
 * Fills this origin's local storage, so the next record write has nowhere to go.
 *
 * Under a key this application does not own, and added after the records a test
 * seeds, so what runs out is the browser's room rather than anything the
 * application decided. The quota is the only bound left on records since the
 * twenty-record limit was withdrawn on 2026-08-25 (FR-013).
 */
const FILL_STORAGE = (): void => {
  // Coarse first, then finer, so what is left over is smaller than anything
  // the application would write. A megabyte of headroom would leave the store
  // full in name only.
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
};

async function fillStorage(page: Page): Promise<void> {
  await page.addInitScript(FILL_STORAGE);
}

/**
 * Fills the store on the page as it stands, without a reload.
 *
 * `addInitScript` runs on the next navigation, which is no use where the store
 * has to go full *while* a layer is open and holding what a Commander typed.
 */
async function fillStorageNow(page: Page): Promise<void> {
  await page.evaluate(FILL_STORAGE);
}

/**
 * Creates a build and waits for the workspace to have finished settling.
 *
 * The address is part of that. The workspace publishes the build to the
 * fragment a moment after the screen is drawn, and a journey that opens the
 * library before it lands pushes the layer's history entry over an address with
 * no build on it — so back returns to `/outfitting`, and the layer's own
 * assertion that it took no address of its own has nothing to compare against.
 * Waiting here rather than in each journey keeps the two ways out of the layer
 * reading as the one thing they are.
 *
 * A Commander meeting that same window loses the build from the address for
 * real, which is issue 86 and is not this change's to fix. These journeys read
 * the two ways out of the layer, not the race, so they step around it; the wait
 * can go when 86 is closed.
 */
async function createBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await openWorkspaceWithBuild(page, hull);
  // One decision on the build, so there is a record to list. A build still at
  // its hull's package default holds nothing a Commander decided and is stored
  // nowhere, and a power group is state no record title reads (024/FR-001).
  await regroupCoreMount(page);
  await savedToBrowser(page);
  // Its own budget: publishing the fragment fetches the codec and its table as
  // a lazy chunk and then encodes the build, and an encode states what it is
  // waiting for rather than taking the default (assertions, ruled 2026-09-06).
  await expect(page).toHaveURL(/\/outfitting#b\./, { timeout: 15_000 });
}

/**
 * Chooses a row, which is what the footer's actions act on.
 *
 * The reference draws dense rows and commits from a footer, so acting on a
 * record is two presses: choose it, then commit (build-library design,
 * "Reference composition").
 */
async function chooseRecord(page: Page, title: string): Promise<void> {
  // A row is named by its own words, so it is found by its title — anchored,
  // because "Anaconda" would otherwise also match "Anaconda explorer".
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Scoped to the layer. The screen it stands over is in the same document, and
  // the shipyard behind it names forty-eight of its own controls `Build a stock
  // …` — which a bare page-wide match claims as well (2026-09-04).
  const row = page
    .getByRole('dialog', { name: 'Saved builds' })
    .getByRole('button', { name: new RegExp(`^${escaped}\\b`, 'i') });
  // Retried, because the listing re-reads storage after a write and the row a
  // press was aimed at can be replaced a frame later: the click then resolves
  // against a detached node and its handler never runs.
  await expect(async () => {
    await row.click({ timeout: 2_000 });
    await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * One of the footer's two actions, scoped to the footer.
 *
 * The canvas names them for what they do — `DELETE` and `OPEN IN OUTFITTING` —
 * so `Delete` also reads as a substring of the confirmation's own
 * `Delete this build`. Scoping to the plate and matching exactly is what keeps
 * the two apart.
 */
function footerAction(page: Page, name: string) {
  return page.locator('.library__footer').getByRole('button', { name, exact: true });
}

/**
 * Saves the build the workspace is holding, from the workspace's own `SAVE`.
 *
 * Naming, renaming and saving a copy all go through here since 2026-08-27:
 * the library commits open and delete, and what should become of a build is
 * asked where a Commander is working in it (FR-009).
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
}

/**
 * Creates a build and waits only for the workspace.
 *
 * Chosen over `createBuild` where the write is expected *not* to land: with the
 * store full the honest status is that nothing was written, so waiting for
 * "saved" would be waiting for the bug. The address is published either way —
 * a build link is encoded from the loadout, which a full store does not touch —
 * so these journeys simply have no use for it.
 */
async function openWorkspaceWithBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  // The command bar titles an unnamed build by what the build calls itself,
  // which for a stock hull is the hull (FR-010, ruled 2026-08-25).
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(hull, 'i') })).toBeVisible();
}

/**
 * The saved-build surface, in whichever composition it is showing.
 *
 * The dialog rather than a heading: the layer names itself the same way over a
 * screen and on its own page, and over a screen the document's `h1` is the
 * screen's — the ship a Commander is in — with the layer's own name on the
 * dialog, which is where a modal's name belongs.
 */
const library = (page: Page) => page.getByRole('dialog', { name: 'Saved builds' });

test.describe('the build library', () => {
  test('says so when nothing is stored', async ({ page }) => {
    await openLibrary(page);

    await expect(library(page)).toBeVisible();
    await expect(page.getByText('Nothing is stored yet')).toBeVisible();
  });

  test('lists an unnamed build with its hull, time and recorded state', async ({ page }) => {
    await createBuild(page);
    await openLibrary(page);

    await expect(library(page)).toBeVisible();
    // Titled by what the build calls itself — here the hull, since this build
    // has neither a ship name nor an ident (FR-010).
    await expect(library(page).getByText('Anaconda').first()).toBeVisible();
    await expect(library(page).getByText('Valid').first()).toBeVisible();
    await expect(
      library(page)
        .getByText(/Current build/)
        .first(),
    ).toBeVisible();
  });

  test('lists named and unnamed records as one list, under no group heading', async ({ page }) => {
    // One list since 2026-08-27: the row's own title says which it is, and two
    // groups made the most recently edited build not reliably the first row
    // (FR-010, clarification 2026-08-27).
    // The unnamed one is dated within its seven days, since an older working
    // record is swept on the listing read rather than shown (FR-013).
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seed(page, [
      seedRecord('named-one', { name: 'Anaconda explorer' }),
      seedRecord('unnamed-one', { kind: 'working', name: null, modifiedAt: recent }),
    ]);
    await openLibrary(page);
    await expect(library(page)).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Unnamed builds' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Named builds' })).toHaveCount(0);
    await expect(page.locator('.records__list')).toHaveCount(1);
    await expect(page.locator('[data-record-id]')).toHaveCount(2);
    // One order, and it is the edited instant: the unnamed record was touched
    // an hour ago and the named one in January, so it leads.
    await expect(page.locator('[data-record-id]').first()).toHaveAttribute(
      'data-record-id',
      'unnamed-one',
    );
  });

  test('reads the edited column as how long ago, keeping the instant in words', async ({
    page,
  }) => {
    // What the column is read for. The canvas draws `2 d ago` there, and the
    // instant is not lost — it stays with the row's other read-not-drawn facts
    // (FR-010, clarification 2026-08-27).
    const modifiedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer', modifiedAt })]);
    await openLibrary(page);

    await expect(page.locator('[data-record-id="a"] .record__modified')).toHaveText(/ago/i);
    await expect(page.locator('[data-record-id="a"] .record__modified')).not.toHaveText(/2026/);
    // Named where it is read: the column header that would say what the date
    // is is hidden from the accessibility tree, so the fact says it itself.
    await expect(page.locator('[data-record-id="a"] .record__states')).toContainText(
      /Edited .*20\d\d/,
    );
  });

  test('commits exactly open and delete on the record that was chosen', async ({ page }) => {
    // The canvas's two, and nothing else. Naming, renaming and saving a copy
    // are the workspace's own `SAVE` since 2026-08-27 (FR-009).
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);

    await chooseRecord(page, 'Anaconda explorer');
    const footer = page.locator('.library__footer');

    await expect(footer.getByRole('button')).toHaveCount(2);
    // Named for what they do, as the canvas names them. The build they act on
    // is the row the Commander pressed, which is where they are looking.
    await expect(footer.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(
      footer.getByRole('button', { name: 'Open in outfitting', exact: true }),
    ).toBeVisible();
  });

  test('stands over the screen it was opened from, taking no address of its own', async ({
    page,
  }) => {
    // Canvas 1a draws the library as a modal over an inert originating screen,
    // and a modal is only a modal if there is a screen behind it. Built as a
    // sibling route there was none: the workspace was replaced by a page whose
    // whole body was the layer (Commander request 2026-08-28).
    await createBuild(page);
    await openLibrary(page);

    const layer = page.getByRole('dialog', { name: 'Saved builds' });
    await expect(layer).toBeVisible();

    // No navigation took the workspace away — the ship is still there, behind
    // and inert — and no address was taken either. The records are held on one
    // device, so an address for them resolves to a different list for every
    // Commander who opens it (Commander request 2026-09-04).
    await expect(page).toHaveURL(/\/outfitting#b\./);
    await expect(page.locator('ednb-outfitting-workspace')).toHaveCount(1);

    // And closing gives the screen back, fragment included — the build link the
    // workspace published on the entry the layer was opened over.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(layer).toBeHidden();
    await expect(page).toHaveURL(/\/outfitting#b\./);
    await expect(page).toHaveTitle(/^Build/);
  });

  test('closes on the browser’s own back, as a screen would', async ({ page }) => {
    // The entry is real even though the address does not change: back is one of
    // the two ways out and the canvas draws the other.
    await createBuild(page);
    await openLibrary(page);

    const layer = page.getByRole('dialog', { name: 'Saved builds' });
    await expect(layer).toBeVisible();

    await page.goBack();

    await expect(layer).toBeHidden();
    await expect(page).toHaveURL(/\/outfitting#b\./);
  });

  test('is the same layer over the shipyard, where no build is open', async ({ page }) => {
    // There is one composition. The library used to be a page as well, at its
    // own address, and that address is gone (Commander request 2026-09-04) —
    // so the screen behind is whichever one a Commander opened it from, and
    // over the shipyard there is simply no workspace behind it.
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);

    await expect(library(page)).toBeVisible();
    await expect(page.locator('ednb-outfitting-workspace')).toHaveCount(0);
    await expect(page).toHaveURL(/\/ships$/);
  });

  test('marks exactly one row, and moves the mark to whichever was chosen', async ({ page }) => {
    // Two states meet on these rows: the record the workspace is holding, and
    // the row the footer would act on. Both used to draw the marker, so opening
    // the library on a loaded build and then choosing a different record left
    // two rows washed and edged alike (reported 2026-08-28).
    test.slow();
    await createBuild(page);
    await saveActiveBuild(page, 'Alpha');
    // A second record from the same build, so the workspace ends up holding
    // Beta while Alpha is another row on the list.
    await saveActiveBuild(page, 'Beta');

    await openLibrary(page);
    const marked = page.locator('.record--chosen');

    // Opening marks where the Commander is: the library opens on the record the
    // workspace is holding, and it is the only marked row.
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText('Beta');

    await chooseRecord(page, 'Alpha');

    // Still one, and now the other. The record the workspace holds keeps saying
    // so — in `aria-current` and in its own words — without drawing a second
    // marker for it.
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText('Alpha');
    await expect(page.locator('.record[aria-current]')).toContainText('Current build');
  });

  test('names the record the build is already in, leaving nothing behind', async ({ page }) => {
    // Revised 2026-08-25: a manual save consumes the unnamed record these edits
    // were autosaved into, rather than copying the build beside it. A Commander
    // who saves their work finds one entry, not the same build twice (FR-008).
    await createBuild(page);

    await saveActiveBuild(page, 'Anaconda explorer');

    await openLibrary(page);
    await expect(library(page).getByText('Anaconda explorer').first()).toBeVisible();
    await expectRecords(page, 1);
  });

  test('warns about a duplicate name and still saves a separate build', async ({ page }) => {
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await createBuild(page);

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });
    await dialog.getByRole('textbox', { name: 'Build name' }).fill('Anaconda explorer');

    // One build carries the name, so the layer says so in words rather than
    // counting to one.
    await expect(dialog.getByText(/Another saved build already uses this name/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save build' }).click();

    // The build that was already stored, and the record this build was in,
    // which the save named rather than duplicated.
    await expectRecords(page, 2);
  });

  test('opens on replacing the save the build came from, and says when it was written', async ({
    page,
  }) => {
    // Canvas 1c draws the replacing card selected and its own line under it.
    // A Commander who opened a save and pressed SAVE means that save; the
    // alternative is one press away (FR-009).
    const modifiedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer', modifiedAt })]);
    await openLibrary(page);
    await openRecordFromLibrary(page, 'Anaconda explorer');

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });

    await expect(dialog.getByRole('radio', { name: /^Overwrite/ })).toBeChecked();
    await expect(dialog).toContainText('Last saved 2 days ago');
  });

  test('does not open the next save with a name that was typed and dismissed', async ({ page }) => {
    // A closed dialog still holds what is in it, so opening has to be a reset:
    // otherwise the next Commander to press SAVE finds an abandoned name in the
    // field, under a duplicate count worked out for a different one.
    //
    // The reset lands on what the build is called rather than on nothing since
    // 2026-08-28 — the abandoned draft is still what must not survive.
    await createBuild(page);

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });
    await dialog.getByRole('textbox', { name: 'Build name' }).fill('Abandoned');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await reachShellAction(page, /^Save$/);
    await expect(dialog.getByRole('textbox', { name: 'Build name' })).toHaveValue('Anaconda');
  });

  test('writes the note with the build, and keeps it out of the link', async ({ page }) => {
    await createBuild(page);

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });
    await dialog.getByRole('textbox', { name: 'Build name' }).fill('Anaconda explorer');
    await dialog.getByRole('textbox', { name: 'Note' }).fill('Neutron route to Colonia.');
    await dialog.getByRole('button', { name: 'Save build' }).click();

    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith('ednb:record:'))
            .map((key) => (JSON.parse(localStorage.getItem(key)!) as { note: string | null }).note),
        ),
      )
      .toEqual(['Neutron route to Colonia.']);

    // A note is this browser's own. Nothing about it reaches the address a
    // Commander shares (FR-011).
    expect(page.url()).not.toContain('Neutron');
  });

  test('says a save wrote nothing, and keeps what was typed on screen', async ({ page }) => {
    // The one outcome a Commander cannot notice for themselves: the build on
    // screen is identical whether the write landed or not (FR-009).
    await fillStorage(page);
    await openWorkspaceWithBuild(page);

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });
    await dialog.getByRole('textbox', { name: 'Build name' }).fill('Anaconda explorer');
    await dialog.getByRole('button', { name: 'Save build' }).click();

    await expect(dialog).toContainText(/could not be saved/i);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Build name' })).toHaveValue(
      'Anaconda explorer',
    );
  });

  test('returns to the build it was opened over rather than to the shipyard', async ({ page }) => {
    // Dismissing a layer puts a Commander back where they were. It used to send
    // everyone to the shipyard, which took a Commander who glanced at their
    // saved builds out of a build they had chosen nothing to leave (Commander
    // request 2026-08-27).
    await createBuild(page);
    await openLibrary(page);
    await expect(library(page)).toBeVisible();

    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    await expect(page.getByRole('heading', { level: 1, name: /anaconda/i })).toBeVisible();
  });

  test('copies a saved build by saving the one that was opened as a new build', async ({
    page,
  }) => {
    // Duplicating left the library's footer on 2026-08-27. The capability did
    // not: a record is copied by opening it and saving it as a new build, which
    // leaves the original exactly where it was (FR-009).
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);
    await openRecordFromLibrary(page, 'Anaconda explorer');

    await saveActiveBuild(page, 'Anaconda explorer copy');

    // Polled: the copy is what the press wrote, and the press is answered a
    // moment after it returns.
    const names = () =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith('ednb:record:'))
          .map((key) => (JSON.parse(localStorage.getItem(key)!) as { name: string | null }).name),
      );
    await expect.poll(names).toContain('Anaconda explorer copy');
    expect(await names()).toContain('Anaconda explorer');
    expect(await page.evaluate(() => localStorage.getItem('ednb:record:a'))).not.toBeNull();
  });

  test('renames a saved build by saving it over the save it was opened from', async ({ page }) => {
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);
    await openRecordFromLibrary(page, 'Anaconda explorer');

    await saveActiveBuild(page, 'Deep black', 'overwrite');

    // The same local identity, under a new name: identity is a UUID and never a
    // label (FR-009).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('ednb:record:a');
          return raw === null ? null : (JSON.parse(raw) as { name: string | null }).name;
        }),
      )
      .toBe('Deep black');
    await expectRecords(page, 1);
  });

  test('confirms a deletion, names the record, and cancelling keeps it', async ({ page }) => {
    await seed(page, [seedRecord('a')]);
    await openLibrary(page);

    await chooseRecord(page, 'Build a');
    await footerAction(page, 'Delete').click();
    const dialog = page.getByRole('dialog', { name: /Build a/ });
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep this build' }).click();
    expect(await page.evaluate(() => localStorage.getItem('ednb:record:a'))).not.toBeNull();

    await footerAction(page, 'Delete').click();
    await page
      .getByRole('dialog', { name: /Build a/ })
      .getByRole('button', { name: 'Delete this build' })
      .click();

    await expect.poll(() => page.evaluate(() => localStorage.getItem('ednb:record:a'))).toBeNull();
  });

  test('deletes only the record that was confirmed', async ({ page }) => {
    await seed(page, [seedRecord('a'), seedRecord('b')]);
    await openLibrary(page);

    await chooseRecord(page, 'Build a');
    await footerAction(page, 'Delete').click();
    await page
      .getByRole('dialog', { name: /Build a/ })
      .getByRole('button', { name: 'Delete this build' })
      .click();

    // Polled: the deletion is what the press wrote, and the press is answered a
    // moment after it returns.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith('ednb:record:')),
        ),
      )
      .toEqual(['ednb:record:b']);
  });

  test('opens a stored build into the workspace', async ({ page }) => {
    await seed(page, [seedRecord('a')]);
    await openLibrary(page);

    await openRecordFromLibrary(page, 'Build a');

    await expect(page.getByText('Anaconda').first()).toBeVisible();
  });

  test('narrows the list to what was searched for, and says how many are shown', async ({
    page,
  }) => {
    await seed(page, [
      seedRecord('a', { name: 'Anaconda explorer' }),
      seedRecord('b', {
        name: 'Python trader',
        hullSymbol: 'Python',
        build: {
          format: 'ednb.build',
          version: 1,
          shipSymbol: 'Python',
          shipName: null,
          shipIdent: null,
          modules: [],
        },
      }),
    ]);
    await openLibrary(page);
    await expect(page.getByText('2 builds', { exact: true })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search saved builds' }).fill('python');

    await expect.poll(() => page.locator('.library__count').innerText()).toBe('1 of 2 builds');
    await expect(page.locator('[data-record-id="b"]')).toBeVisible();
    await expect(page.locator('[data-record-id="a"]')).toHaveCount(0);
    // Narrowing changes no record and removes nothing.
    expect(await recordCount(page)).toBe(2);
  });

  test('says nothing matched, and leaves every control reachable', async ({ page }) => {
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);

    const search = page.getByRole('searchbox', { name: 'Search saved builds' });
    await search.fill('nothing like this');

    await expect(page.getByText(/Nothing here matches/)).toBeVisible();
    // Widening the search needs no separate action: the field is still there,
    // with what was typed still in it.
    await expect(search).toHaveValue('nothing like this');
    await search.fill('anaconda');
    await expect(page.locator('[data-record-id="a"]')).toBeVisible();
  });

  test('counts the issues a record was saved with, in words as well as a number', async ({
    page,
  }) => {
    await seed(page, [
      seedRecord('a', { name: 'Broken build', validation: { valid: false, complete: false } }),
    ]);
    await openLibrary(page);

    const row = page.locator('[data-record-id="a"] button');
    await expect(row).toContainText('Invalid');
    // The plate carries the number; the words are in the row's own text, so the
    // plate is never the only carrier.
    await expect(row.locator('.record__issues')).toHaveText('2');
    await expect(row.locator('.record__issues')).toHaveAttribute('aria-hidden', 'true');
    await expect(row).toContainText('issues recorded');
  });

  test('states how long an unnamed record has left, and drops one that ran out', async ({
    page,
  }) => {
    // Ages are seeded through the store rather than waited for: seven days is
    // not a thing to sit through, and the sweep reads `modifiedAt` (FR-013).
    const days = (count: number) =>
      new Date(Date.now() - count * 24 * 60 * 60 * 1000).toISOString();
    await seed(page, [
      seedRecord('fresh', { kind: 'working', name: null, modifiedAt: days(6) }),
      seedRecord('stale', { kind: 'working', name: null, modifiedAt: days(8) }),
    ]);
    await openLibrary(page);

    // The one with a day left says so; the one that ran out is simply not
    // there, swept before the listing was drawn and announced by nothing.
    await expect(page.locator('[data-record-id="fresh"]')).toContainText(/Deleted in/);
    await expect(page.locator('[data-record-id="stale"]')).toHaveCount(0);
    await expectRecords(page, 1);
  });

  test('lists an unsupported or unreadable record without opening or removing it', async ({
    page,
  }) => {
    await seed(page, [
      {
        key: 'ednb:record:newer',
        value: JSON.stringify({
          format: 'ednb.local-record',
          version: 99,
          id: 'newer',
          name: 'From the future',
          hullSymbol: 'Anaconda',
        }),
      },
      { key: 'ednb:record:broken', value: '{"format":"ednb.local-record","version":1,"id":' },
    ]);
    await openLibrary(page);

    await expect(page.getByText(/newer version of the application/i)).toBeVisible();
    await expect(page.getByText(/could not be read/i)).toBeVisible();
    // Scoped to the layer: the bar behind it carries `Open saved build`, which
    // is the control that raised this (2026-09-04).
    await expect(library(page).getByRole('button', { name: /Open/ })).toHaveCount(0);

    const stored = await page.evaluate(() => ({
      newer: localStorage.getItem('ednb:record:newer'),
      broken: localStorage.getItem('ednb:record:broken'),
    }));
    expect(stored.newer).not.toBeNull();
    expect(stored.broken).not.toBeNull();
  });

  test('offers explicit discard when the browser store is full', async ({ page }) => {
    await seed(
      page,
      Array.from({ length: 20 }, (_, index) =>
        // Edited just now: an unnamed record has seven days, and a record
        // stamped with the fixture's own instant would be swept before this
        // journey reached the library (FR-013).
        seedRecord(`w${index}`, {
          kind: 'working',
          name: null,
          modifiedAt: new Date().toISOString(),
        }),
      ),
    );
    await fillStorage(page);
    await openWorkspaceWithBuild(page);
    // One decision on the build, so a write is owed and the full store has
    // something to refuse. A build still at its hull's package default writes
    // nothing, and a store that is never written to is never reported full
    // (024/FR-001).
    await regroupCoreMount(page);

    await expect(page.locator('ednb-build-workspace-page')).toHaveAttribute(
      'data-persistence',
      'quota-full',
    );
    await expect(page.getByText(/storage is full/i)).toBeVisible();

    // From the notice's own control, which is what a Commander meeting a full
    // store has in front of them (001/FR-013).
    await page.getByRole('button', { name: 'Choose builds to discard' }).click();
    await expect(page.getByRole('heading', { name: 'Choose builds to discard' })).toBeVisible();

    // Nothing was removed to make room, and expiry is never offered as a way
    // out of a full store.
    expect(await recordCount(page)).toBe(20);
  });

  test('discards only the records explicitly selected', async ({ page }) => {
    await seed(
      page,
      Array.from({ length: 20 }, (_, index) =>
        // Edited just now: an unnamed record has seven days, and a record
        // stamped with the fixture's own instant would be swept before this
        // journey reached the library (FR-013).
        seedRecord(`w${index}`, {
          kind: 'working',
          name: null,
          modifiedAt: new Date().toISOString(),
        }),
      ),
    );
    await fillStorage(page);
    await openWorkspaceWithBuild(page);
    // One decision on the build, so a write is owed and the full store has
    // something to refuse. A build still at its hull's package default writes
    // nothing, and a store that is never written to is never reported full
    // (024/FR-001).
    await regroupCoreMount(page);
    await openLibrary(page);

    const manager = page.getByRole('group', { name: 'Choose builds to discard' });
    await manager.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Delete this build' }).click();

    await expectRecords(page, 19);
  });

  test('offers overwrite, keep both and cancel when two pages save one build', async ({
    browser,
  }) => {
    // Two pages, four navigations, an autosave and a named save each: this is
    // the longest journey in the suite, and on a loaded machine it runs past the
    // default budget without anything being wrong with it.
    test.slow();
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    // Waiting for the save is the precondition, not a convenience: the library
    // lists what is stored, and autosave coalesces before it writes.
    await createBuild(first);
    await saveActiveBuild(first, 'Shared build');
    await openLibrary(first);
    await expect(library(first).getByText('Shared build').first()).toBeVisible();

    // The other page opens the same named record, so both hold the same baseline.
    await openLibrary(second);
    await openRecordFromLibrary(second, 'Shared build');

    await openLibrary(first);
    await openRecordFromLibrary(first, 'Shared build');

    // One page saves; the other's baseline is now stale. Both pages hold the
    // same record, and neither autosaves into it, so the collision is only ever
    // between two deliberate saves (FR-012).
    await saveActiveBuild(second, 'From the other page', 'overwrite');

    await saveActiveBuild(first, 'From this page', 'overwrite');

    const conflict = first.getByRole('dialog', { name: /changed in another tab/i });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByText(/your version is kept/i)).toBeVisible();
    await expect(conflict.getByText(/both versions are kept/i)).toBeVisible();
    await expect(conflict.getByText(/nothing is saved/i)).toBeVisible();

    await conflict.getByRole('button', { name: 'Keep both versions' }).click();

    const names = () =>
      first.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith('ednb:record:'))
          .map((key) => (JSON.parse(localStorage.getItem(key)!) as { name: string | null }).name)
          .filter((name): name is string => name !== null),
      );
    // Neither version disappeared. Polled for this page's, which is what the
    // press writes and is written behind a lock; the other page's was there
    // before the press and is read once.
    await expect.poll(names).toContain('From this page');
    expect(await names()).toContain('From the other page');

    await context.close();
  });

  test('reopens the save on what was typed when answering the conflict wrote nothing', async ({
    browser,
  }) => {
    // The same journey as the question above, carried one step further: what a
    // Commander sees when the answer is refused. It is the same length, and
    // slow for the same reason.
    test.slow();
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    await createBuild(first);
    await saveActiveBuild(first, 'Shared build');
    await openLibrary(first);
    await expect(library(first).getByText('Shared build').first()).toBeVisible();

    // Both pages open the record before either saves, so both hold one
    // baseline and the collision is between two deliberate saves (FR-012).
    await openLibrary(second);
    await openRecordFromLibrary(second, 'Shared build');
    await openLibrary(first);
    await openRecordFromLibrary(first, 'Shared build');

    await saveActiveBuild(second, 'From the other page', 'overwrite');
    await saveActiveBuild(first, 'From this page', 'overwrite');

    const conflict = first.getByRole('dialog', { name: /changed in another tab/i });
    await expect(conflict).toBeVisible();

    // The store goes full with the question already on screen, so answering it
    // is refused for the reason a save is refused. Keeping both versions writes
    // a record, and there is no room to write one.
    await fillStorageNow(first);
    await conflict.getByRole('button', { name: 'Keep both versions' }).click();

    // Closing over this is the one way an edit is lost without being reported:
    // the build on screen is identical whether the answer landed or not.
    const dialog = first.getByRole('dialog', { name: 'Save build' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/could not be saved/i);
    // What was typed before the conflict was raised, not the record's own name
    // and not an empty field (FR-009).
    await expect(dialog.getByRole('textbox', { name: 'Build name' })).toHaveValue('From this page');

    await context.close();
  });

  test('is structurally sound and free of accessibility violations', async ({ page }, testInfo) => {
    await seed(page, [
      seedRecord('a'),
      seedRecord('b', { validation: { valid: false, complete: false } }),
    ]);
    await openLibrary(page);
    await expect(library(page)).toBeVisible();

    await expectSingleVisibleH1(page);
    await expectNoDocumentOverflow(page);
    await expectNoAccessibilityViolations(page, testInfo, { label: 'library-populated' });

    await chooseRecord(page, 'Build a');
    await footerAction(page, 'Delete').click();
    await expect(page.getByRole('dialog', { name: /Build a/ })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo, { label: 'library-delete-confirmation' });
  });

  test('scans the save layer over the build it names', async ({ page }, testInfo) => {
    await seed(page, [seedRecord('a', { name: 'Anaconda explorer' })]);
    await openLibrary(page);
    await openRecordFromLibrary(page, 'Anaconda explorer');

    await reachShellAction(page, /^Save$/);
    const dialog = page.getByRole('dialog', { name: 'Save build' });
    // The state with the most to get wrong: two modes, each with its own
    // associated outcome, and a message line that reports on what is typed.
    await dialog.getByRole('radio', { name: 'Save as a new build' }).check();
    await expect(dialog).toContainText('already use');

    await expectSingleVisibleH1(page);
    await expectNoDocumentOverflow(page);
    await expectNoAccessibilityViolations(page, testInfo, { label: 'save-build-layer' });
  });
});
