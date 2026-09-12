import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import applicationManifest from '../package.json';
import englishMessages from '../src/app/i18n/locales/en.json';
import germanMessages from '../src/app/i18n/locales/de.json';
import { ZOOM_400 } from './accessibility';
import {
  clippedText,
  expectNoDocumentOverflow,
  expectNoRawMessages,
  expectOrderedHeadings,
  expectRootLanguage,
  expectTargetSizes,
  settled as settledPage,
} from './accessibility/assertions';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import { helpRouteCoverage, type HelpRouteRow } from './coverage-ledger';
import {
  accountDialog,
  acceptedExchange,
  conflictLayer,
  deletionConfirmation,
  firstChangeConflicts,
  fleetAnswer,
  installCommanderService,
  openAccountDialog,
  showOwnedShips,
} from './commander';
import { openChooser, openEditor, revealMount, revealStatusRail } from './outfitting-surfaces';
import { buildStockHull, openActionLayer, openLibrary, reachShellAction } from './shell';

/**
 * Help, reached from everywhere.
 *
 * FR-011's claim is exhaustive rather than representative: every capability,
 * package-backed surface and obscuring layer this application ships has a row
 * in `helpRouteCoverage`, and this suite opens the modal from every one of
 * them. A row that cannot be driven here is a row whose claim is untested,
 * which is the drift the ledger exists to prevent.
 *
 * The other half of FR-002 is checked at the same time and is the easier one
 * to forget: the row's own surface offers no help control and embeds no legal
 * body of its own. One shared destination only works if there is not quietly a
 * second one.
 */

const HULL = 'Anaconda';

/** The frame's Help action, in the language the suite reads. */
const HELP_ACTION = new RegExp(`^${englishMessages['help.action.label']}$`, 'i');

/** The modal's own accessible name. */
const HELP_TITLE = new RegExp(
  englishMessages['help.title'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  'i',
);

/**
 * Every layer currently covering the frame.
 *
 * `dialog[open]` rather than the dialog role: the shell keeps its layers
 * mounted and closed, and a closed one is still a `dialog` element. Counting
 * those would make "one dialog is open" true of a page with none.
 */
function layers(page: Page) {
  return page.locator('dialog[open]');
}

function helpModal(page: Page) {
  return page.getByRole('dialog', { name: HELP_TITLE });
}

async function openHelp(page: Page): Promise<void> {
  await reachShellAction(page, HELP_ACTION);
  await expect(helpModal(page)).toBeVisible();
}

/**
 * The frame's Help entry itself, brought within reach without pressing it.
 *
 * Where the bar draws its controls it is on the banner row; where the bar is
 * folded it is inside the action layer, and a journey that wants to *look at*
 * the control rather than use it still has to open the layer holding it first.
 * Of the five layout profiles only 1440 is wide enough for the banner row.
 */
async function helpEntry(page: Page) {
  const entry = page.getByRole('button', { name: HELP_ACTION });

  if ((await entry.count()) === 0) {
    await openActionLayer(page);
    await expect(entry).toHaveCount(1);
  }
  return entry.first();
}

async function closeHelp(page: Page): Promise<void> {
  await helpModal(page)
    .getByRole('button', { name: new RegExp(`^${englishMessages['action.close']}$`, 'i') })
    .click();
  await expect(helpModal(page)).toHaveCount(0);
}

/**
 * Waits for the application to stop rewriting its own address.
 *
 * The workspace publishes its build into the fragment after the route has
 * landed, and the catalogue writes the selected hull into the path. Both are
 * ordinary behaviour and both are asynchronous, so a journey that reads the
 * address the instant a screen appears is reading a value that is still
 * moving. What FR-001 claims is that *opening help* changes nothing — which is
 * only checkable once the screen beneath has finished settling.
 */
async function settled(page: Page): Promise<string> {
  // Away from the manifest first. Resting on one of its rows opens that hull
  // in the inspector and rewrites the address — feature 001's own behaviour,
  // and nothing to do with help, but it would move the value under this
  // journey's feet.
  await page.mouse.move(0, 0);

  // A workspace publishes the open build into the fragment a moment after the
  // screen itself arrives, so an address read as soon as a build appears is one
  // that was always going to change for a reason unrelated to help. Waited for
  // by its shape rather than by a timeout, because under a loaded machine the
  // wait is however long it is.
  if ((await page.locator('[data-slot-key]').count()) > 0) {
    await expect(page).toHaveURL(/#b\./);
  }

  let previous = page.url();
  let stable = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.waitForTimeout(100);
    const current = page.url();
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 5) {
      return current;
    }
    previous = current;
  }
  return previous;
}

/** A stock build, open in the workspace. */
async function withStockBuild(page: Page, hull = HULL): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, englishMessages['hullDetail.create']);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

/** Presses one segment of the anatomy mode strip. */
async function openMode(page: Page, label: string): Promise<void> {
  await page.locator('ednb-hull-anatomy .anatomy__modes button').filter({ hasText: label }).click();
}

/** Selects a mount, however this width offers it. */
async function selectSlot(page: Page, slotKey: string): Promise<void> {
  // At compact width the ledger draws one category at a time, so the mount is
  // brought into it before it is pressed (canvas 1d).
  await revealMount(page, slotKey);
  await page.locator(`[data-slot-key="${slotKey}"] button`).first().click();
}

/** Dismisses whatever layer is covering the frame, by its own visible control. */
const WAY_OUT = new RegExp(
  `^(${englishMessages['action.close']}|${englishMessages['action.cancel']}` +
    `|${englishMessages['library.delete.cancel']})$`,
  'i',
);

/**
 * Dismisses every layer covering the frame, by each one's own visible control.
 *
 * A layer may cover a layer — a delete confirmation stands over the library
 * that raised it — so this works down the stack until the frame is back. It
 * presses named controls only: falling back to whatever button happens to be
 * last would let a layer with no visible way out pass.
 */
async function dismissLayer(page: Page): Promise<void> {
  for (let depth = 0; depth < 4; depth += 1) {
    // The shell's navigation overlay is a layer with nothing to press: it
    // stands over the page while a route is still loading and withdraws itself
    // (018/FR-002). A dismissal that navigates raises it for a moment, so the
    // stack is read once it has gone rather than while it is on top of it —
    // otherwise the layer this reaches for is the one layer that has no way
    // out by design.
    await expect(page.locator('dialog[open].waiting')).toHaveCount(0);

    const covering = layers(page);
    if ((await covering.count()) === 0) {
      return;
    }
    const top = covering.last();
    // Marked before it is pressed, so the wait below is about this layer rather
    // than about whatever is on top afterwards.
    await top.evaluate((layer) => layer.setAttribute('data-dismissing', ''));
    await top.getByRole('button', { name: WAY_OUT }).first().click();

    // The frame is given back on the next change detection rather than on the
    // click itself, so this waits for the layer just pressed to actually close
    // before the next turn of the loop takes hold of one — a locator that
    // resolves on a layer already on its way out then never becomes clickable.
    //
    // Waited on that layer rather than on the stack getting shorter, because a
    // layer may hand back to the one that raised it: cancelling the
    // account-deletion question returns the account modal, so the count is the
    // same on both sides of a dismissal that did exactly what it should.
    await expect(page.locator('dialog[open][data-dismissing]')).toHaveCount(0);
  }
  await expect(layers(page)).toHaveCount(0);
}

/**
 * Brings each transcribed row on screen.
 *
 * Keyed by the ledger's own row id, so a row added to the transcription with no
 * way to reach it fails this suite by name rather than being quietly skipped.
 */
const REACH: Record<string, (page: Page) => Promise<void>> = {
  'hull-catalogue': async (page) => {
    await page.goto('/ships');
    await expect(page.locator('ednb-ship-catalogue-page')).toBeVisible();
  },
  'hull-detail': async (page) => {
    // Waited for by the screen rather than by its build action: the wide
    // composition draws no action at all, because the manifest beside it is the
    // build (001/FR-007).
    await page.goto(`/ships/${HULL}`);
    await expect(page.locator('ednb-hull-detail-page')).toBeVisible();
  },
  'build-workspace': async (page) => {
    await page.goto('/outfitting');
    await expect(page.locator('ednb-build-workspace-page')).toBeVisible();
  },
  'build-library': async (page) => {
    // The library is a framed layer over the screen it was opened from, so what
    // is waited for is the layer rather than the route component's own host —
    // which has no box of its own once its content is in the top layer.
    await openLibrary(page);
    await expect(
      page.getByRole('dialog', { name: englishMessages['library.title'] }),
    ).toBeVisible();
  },
  'save-build-layer': async (page) => {
    await withStockBuild(page);
    await openSaveLayer(page);
  },
  'library-delete-confirmation': async (page) => {
    await withStockBuild(page);
    await openSaveLayer(page);
    await saveAs(page, 'Ledger build');
    // Deleting is the library's, and the row it acts on is the one the
    // workspace is holding — the build just saved.
    await openLibrary(page);
    // The footer's action is named for what it does, so it is reached on the
    // footer's own plate: `Delete` also reads inside `Delete this build`.
    await page
      .locator('.library__footer')
      .getByRole('button', { name: englishMessages['library.action.delete'], exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: /ledger build/i })).toBeVisible();
  },
  'outfitting-ledger': async (page) => {
    await withStockBuild(page);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  },
  'module-replacement-layer': async (page) => {
    await withStockBuild(page);
    await selectSlot(page, 'FrameShiftDrive');
    await openChooser(page);
  },
  'engineering-editor-layer': async (page) => {
    await withStockBuild(page);
    await selectSlot(page, 'FrameShiftDrive');
    await openEditor(page);
  },
  'normalisation-refusal': async (page) => {
    await page.goto('/outfitting');
    await pasteImport(page, JSON.stringify(UNSUPPORTED_PARTIAL_QUALITY));
    await expect(page.getByRole('dialog', { name: /import build/i })).toContainText(
      englishMessages['slef.import.failure.normalizationUnsupported']
        .replace('{{count}}', '1')
        .trim(),
    );
  },
  'status-rail': async (page) => {
    await withStockBuild(page);
    // Canvas 1d keeps the rail behind the anatomy strip's `STATUS` segment
    // rather than in a third track, so it is opened rather than waited for.
    await revealStatusRail(page);
  },
  'import-layer': async (page) => {
    await page.goto('/outfitting');
    await reachShellAction(page, /^import build$/i);
    await expect(page.getByRole('dialog', { name: /import build/i })).toBeVisible();
  },
  'export-layer': async (page) => {
    await withStockBuild(page);
    await reachShellAction(page, /^export$/i);
    await expect(page.getByRole('dialog', { name: /export build/i })).toBeVisible();
  },
  'import-outcome': async (page) => {
    await importPayload(page, JSON.stringify(SUPPORTED_PARTIAL_QUALITY));
    // The outcome is the build itself: the Almanac's verdict in the rail, and
    // the mounts the payload asked for in the ledger. At compact width the rail
    // is behind the anatomy strip's `STATUS` segment, so it is opened rather
    // than waited for.
    await revealStatusRail(page);
    await expect(page.locator('ednb-build-status')).toBeVisible();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  },
  'power-and-thermals': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.power']);
    await expect(page.locator('ednb-power-thermals')).toBeVisible();
  },
  'defence-analysis': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.defence']);
    await expect(page.locator('ednb-defence-analysis')).toBeVisible();
  },
  'offence-analysis': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.offence']);
    await expect(page.locator('ednb-offence-analysis')).toBeVisible();
  },
  'drives-and-mass': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.drives']);
    await expect(page.locator('ednb-drives-mass')).toBeVisible();
  },
  'cost-and-materials': async (page) => {
    await withStockBuild(page);
    await revealStatusRail(page);
    await expect(page.locator('ednb-cost-materials .cost__row').first()).toBeVisible();
  },
  'hull-anatomy': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.mounts']);
    await expect(page.locator('ednb-hull-anatomy')).toBeVisible();
  },
  'hull-anatomy-side-state': async (page) => {
    await withStockBuild(page);
    await openMode(page, englishMessages['anatomy.mode.mounts']);
    await expect(
      page.locator('ednb-hull-anatomy .anatomy__sides, ednb-hull-anatomy'),
    ).not.toHaveCount(0);
  },
  'application-frame': async (page) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
  },
  'feedback-host': async (page) => {
    await page.goto('/outfitting');
    await expect(page.locator('ednb-announcement-outlet').first()).toBeAttached();
  },
  'account-dialog': async (page) => {
    // The service is stubbed before the first navigation: the account state is
    // read while the application boots, and a development server answers every
    // address with the application itself.
    await installCommanderService(page, { session: 'anonymous' });
    await page.goto('/ships');
    await openAccountDialog(page);
  },
  'account-deletion-confirmation': async (page) => {
    await installCommanderService(page, { session: 'signed-in' });
    await page.goto('/ships');
    await openAccountDialog(page, true);
    await accountDialog(page)
      .getByRole('button', { name: englishMessages['account.delete.action'] })
      .click();
    await expect(deletionConfirmation(page)).toBeVisible();
  },
  'owned-ships-layer': async (page) => {
    await installCommanderService(page, {
      session: 'signed-in',
      fleet: () => ({ status: 200, body: fleetAnswer() }),
    });
    await openLibrary(page);
    await showOwnedShips(page);
    await expect(page.locator('ednb-owned-ships-panel')).toBeVisible();
  },
  'record-conflict-layer': async (page) => {
    const service = await installCommanderService(page, { session: 'signed-in' });
    // The account answers the first change with its own deletion marker, which
    // is the one question only a Commander can answer.
    service.exchange = (request) =>
      request.changes.length === 0
        ? { status: 200, body: acceptedExchange({ accountRevision: 2 }) }
        : firstChangeConflicts(request);
    await withStockBuild(page);
    // Waited for before the layer is raised: the library pushes a history entry
    // carrying the address showing at that moment, and the workspace publishes
    // its build into the fragment a moment after the screen arrives.
    await expect(page).toHaveURL(/#b\./);
    await openLibrary(page);
    await expect(conflictLayer(page)).toBeVisible({ timeout: 15_000 });
  },
};

/**
 * The two partial-roll payloads feature 002 already tests the package against.
 *
 * Transcribed from `src/app/domain/ships/outfitting/outfitting.fixtures.ts`, where
 * both are documented with the package behaviour they provoke: dirty drives at
 * grade 5 are a recipe the package identifies, so their partial roll is
 * completed and reported; that same recipe named against a frame shift drive is
 * one the package can neither roll nor match to a catalogued article, so the
 * whole candidate is refused. They are duplicated here rather than imported
 * because that module reaches into the Almanac, which this suite's transpiler
 * does not resolve — and made up here by nobody, because a payload this suite
 * invented would be it guessing at what the package does.
 */
const SUPPORTED_PARTIAL_QUALITY = {
  event: 'Loadout',
  Ship: HULL,
  Modules: [
    {
      Slot: 'MainEngines',
      Item: 'Int_Engine_Size7_Class5',
      Engineering: { BlueprintName: 'Engine_Dirty', Level: 5, Quality: 0.37 },
    },
  ],
};

/**
 * The payload whose partial engineering the package cannot complete.
 *
 * Transcribed with its sibling above from `outfitting.fixtures.ts`: the frame
 * shift drive's engineering menu does not offer `Engine_Dirty`, and no
 * catalogued article of that module answers to it, so the package can neither
 * roll the recipe nor identify an article carrying it and the whole candidate
 * is refused before anything is activated. A refusal has no half-outcome and
 * therefore no workspace state of its own — it is reported where the payload
 * arrived.
 */
const UNSUPPORTED_PARTIAL_QUALITY = {
  event: 'Loadout',
  Ship: HULL,
  Modules: [
    {
      Slot: 'FrameShiftDrive',
      Item: 'Int_Hyperdrive_Size6_Class5',
      Engineering: { BlueprintName: 'Engine_Dirty', Level: 5, Quality: 0.42 },
    },
  ],
};

/** Opens the layer that names the build in hand. */
async function openSaveLayer(page: Page): Promise<void> {
  // The layer is the workspace's since 2026-08-27, reached from the command
  // bar's filled `SAVE`: a library answers "which of these builds", and what
  // should become of one is asked where a Commander is working in it (FR-009).
  await reachShellAction(page, /^save$/i);
  await expect(
    page.getByRole('dialog', { name: englishMessages['workspace.save.title'] }),
  ).toBeVisible();
}

/**
 * Saves the open build under a name, from the layer that is already open.
 *
 * No mode is pressed: a build with nothing to replace is offered no card, and
 * saving as a new build is the only thing the commit can do (canvas 1c).
 */
async function saveAs(page: Page, name: string): Promise<void> {
  const layer = page.getByRole('dialog', { name: englishMessages['workspace.save.title'] });
  await layer.getByRole('textbox', { name: /^build name$/i }).fill(name);
  await layer.getByRole('button', { name: englishMessages['workspace.save.confirm'] }).click();
  await expect(layer).toHaveCount(0);
}

/** Pastes a payload into the import layer and submits it. */
async function pasteImport(page: Page, payload: string): Promise<void> {
  await reachShellAction(page, /^import build$/i);
  const layer = page.getByRole('dialog', { name: /import build/i });
  await layer.getByLabel(/slef payload/i).fill(payload);
  await layer.getByRole('button', { name: /^load build$/i }).click();
}

/**
 * Imports a payload into an empty workspace.
 *
 * The payloads are the reviewed package fixtures the outfitting feature
 * already tests against, not values invented here: a build this suite made up
 * would be this suite asserting against its own guess at what the Almanac does.
 */
async function importPayload(page: Page, payload: string): Promise<void> {
  await page.goto('/outfitting');
  await pasteImport(page, payload);

  // Nothing is asked before an import replaces what is on screen: since
  // 2026-08-25 the build being replaced has a record of its own, so there is
  // no question here to answer (feature 001, FR-008).

  // What this journey wants is the surface beneath, so it waits for the frame
  // to be uncovered and dismisses nothing. Feature 004 closes its own layer
  // once the workspace behind it has been rebuilt, and that is not instant:
  // asked whether it is still open while it is closing, the layer says yes,
  // and the control that answer reaches for stops being clickable before the
  // press lands — which is a wait for a button that will never be pressable
  // again rather than a dismissal.
  //
  // A refusal would leave the layer open and fail here instead. That is the
  // honest outcome: these payloads are the reviewed package fixtures, and one
  // of them being refused is the fixture having changed, not something for
  // this helper to cancel away and then assert against a workspace that never
  // received the build.
  await expect(layers(page)).toHaveCount(0);
}

/** Every row the ledger transcribes, with the recipe that brings it on screen. */
const ROWS: readonly HelpRouteRow[] = helpRouteCoverage;

test.describe('reaching help from every shipped surface', () => {
  test('the transcription and this suite name the same rows', () => {
    const transcribed = ROWS.map((row) => row.id).sort();
    const driven = Object.keys(REACH).sort();

    expect(driven).toEqual(transcribed);
  });

  for (const row of ROWS) {
    test(`opens help from ${row.surface}`, async ({ page }) => {
      await REACH[row.id](page);

      const covering = await layers(page).count();
      if (row.frameEntry === 'obscured' && covering > 0) {
        // What FR-011 requires of a layer that covers the frame: it is
        // dismissible, and help is reached from the capability beneath — not
        // from a second route inside the layer. Two of these rows are layers
        // only where the space is narrow; where this width draws them inline
        // the frame was never covered and there is nothing to dismiss.
        await expect(layers(page).getByRole('button', { name: HELP_ACTION })).toHaveCount(0);
        await dismissLayer(page);
      }

      const before = await settled(page);
      await openHelp(page);

      // One dialog, and it is this one.
      await expect(layers(page)).toHaveCount(1);
      expect(page.url()).toBe(before);

      await closeHelp(page);

      // The address after closing is not compared here. Feature 001's manifest
      // opens the hull the pointer comes to rest on, so on the shipyard the
      // control that closes a centred modal is standing over a row, and what
      // moves the address is that row rather than anything help did. The
      // complete round trip is asserted on the workspace below, where no
      // surface navigates on hover.
      await expect(helpModal(page)).toHaveCount(0);
    });
  }
});

test.describe('the one destination FR-002 requires', () => {
  test('no capability offers a help control or legal body of its own', async ({ page }) => {
    await withStockBuild(page);

    // Nothing but the frame claiming to be a way to the legal body. Scoped to
    // the frame, which is everything a Commander is looking at: the modal is
    // mounted beside it and closed, and counting its contents here would be
    // counting the one destination FR-002 asks for as a violation of it.
    const capability = page.locator('ednb-app-frame');
    await expect(capability.getByRole('link', { name: /licen[cs]e/i })).toHaveCount(0);
    await expect(capability.getByText(/Frontier Developments plc/i)).toHaveCount(0);

    // The frame's action, and exactly one of it — reached the way a Commander
    // reaches it, because the entry is on the bar where there is room and
    // behind the action layer where there is not. Counting only what the bar
    // happens to draw is how "no more than one" passes on a frame that offers
    // no help at all, which is the opposite of what FR-002 asks for.
    const entries = page.getByRole('button', { name: HELP_ACTION });
    if ((await entries.count()) === 0) {
      await openActionLayer(page);
    }
    await expect(entries).toHaveCount(1);
  });

  test('help opens over the capability and gives it back unchanged', async ({ page }) => {
    await withStockBuild(page);
    const fragment = new URL(await settled(page)).hash;
    const ledger = await page.locator('[data-slot-key]').count();

    await openHelp(page);
    await closeHelp(page);

    expect(new URL(page.url()).hash).toBe(fragment);
    expect(await page.locator('[data-slot-key]').count()).toBe(ledger);
  });

  test('opening help makes no request of any kind', async ({ page }) => {
    await page.goto('/outfitting');
    await page.waitForLoadState('networkidle');
    await settled(page);

    // Recorded only once the capability beneath has finished loading, so what
    // is measured is what opening help costs — not what the screen it opened
    // over was still fetching.
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await openHelp(page);
    await closeHelp(page);

    const origin = new URL(page.url()).origin;
    // Nothing is fetched to open help: no route chunk, no document, nothing
    // off this origin. The one thing a first open can still pull is a font
    // face the design system already declares, on a capability that had not
    // yet drawn a monospace glyph — the shell's own loading, arriving late,
    // and the same on any layer. SC-005 measures that case in full in the
    // production offline journey, where the app shell is already cached.
    const unexpected = requests.filter((url) => !/\.woff2?(\?|$)/.test(url));
    expect(unexpected).toEqual([]);
    expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  });
});

test.describe('the folded route the reference draws', () => {
  test('the action layer carries the same entry as the wide row', async ({ page }) => {
    await withStockBuild(page);

    const inline = page.getByRole('button', { name: HELP_ACTION });
    if ((await inline.count()) === 0) {
      await openActionLayer(page);
    }

    await expect(page.getByRole('button', { name: HELP_ACTION }).first()).toBeVisible();
  });

  test('draws the reference’s mark on the bar and its words in the menu', async ({ page }) => {
    await withStockBuild(page);

    // Both compositions are in the document at every width; which one is drawn
    // is a media query, and what each one draws is what this asserts. The wide
    // command bar carries the reference's `?`: one control, the mark hidden
    // from the accessibility tree, and the action's localised name inside the
    // control as text rather than as the glyph.
    const wide = page.locator('.frame__actions .action--symbol');
    await expect(wide).toHaveCount(1);
    await expect(wide.locator('.action__symbol')).toHaveText(englishMessages['help.action.symbol']);
    await expect(wide.locator('.action__symbol')).toHaveAttribute('aria-hidden', 'true');
    await expect(wide.locator('.action__label')).toHaveCount(0);
    await expect(wide.locator('.visually-hidden')).toHaveText(englishMessages['help.action.label']);

    // And it is the only control on the bar drawn that way. A row of marks is a
    // row of guesses; one is a convention.
    expect(await page.locator('.frame__actions .action').count()).toBeGreaterThan(1);

    // The folded action layer spells the same entry out and draws no mark at
    // all, which is what canvas 1d draws there: a menu is a list of rows a
    // Commander reads rather than a bar they scan.
    await expect(page.locator('.action-layer__panel .action--symbol')).toHaveCount(0);
    await expect(
      page
        .locator('.action-layer__panel .action__label')
        .filter({ hasText: englishMessages['help.action.label'] }),
    ).toHaveCount(1);
  });

  test('keeps the frame’s actions inside the viewport at 200% text', async ({ page }) => {
    // Whichever composition this width draws, and the folded one is the one
    // that can escape: its panel hangs off a trigger in a wrapping sticky
    // banner, and both of its escapes are horizontal — a rem-based
    // `min-inline-size` wider than the screen, and a wrapped trigger sitting at
    // the leading edge of its own row. Either one puts FR-001's only route to
    // help off the side of the phone, where nothing can reach it, without
    // making the document scroll sideways for anyone to notice.
    await withRootTextScale(page, DOUBLED_TEXT);
    await withStockBuild(page);

    const trigger = page.locator('.action-layer__trigger');
    const folded = await trigger.isVisible();
    if (folded) {
      await openActionLayer(page);
    }

    const drawn = folded ? page.locator('.action-layer__panel') : page.locator('.frame__actions');
    await expect(drawn).toBeVisible();

    const width = page.viewportSize()?.width ?? 0;
    const box = await drawn.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);

    // And the entry itself is there to be pressed, once, at this text size.
    await expect(page.getByRole('button', { name: HELP_ACTION })).toHaveCount(1);
  });
});

/**
 * The questions the modal answers, spelled out rather than imported.
 *
 * A topic renamed in the definitions is a topic this suite starts asserting
 * under its new name rather than one it silently stops checking, and a topic
 * withdrawn is one this list has to be edited to lose.
 */
const HELP_TOPIC_KEYS = ['browserPersistence', 'completedEngineeringGrades'] as const;

/**
 * The five withdrawn on 2026-08-27, by the words they used to be asked in.
 *
 * Asserted absent rather than merely dropped from the list above: a topic that
 * came back would otherwise pass every count this suite makes, and each of
 * these was withdrawn because the answer is somewhere a Commander already
 * reads it.
 */
const WITHDRAWN_HELP_QUESTIONS = [
  /share links expose/i,
  /accounts, uploads or telemetry/i,
  /what works offline/i,
  /hull fact/i,
  /where do the game values/i,
] as const;

const HELP_TOPIC_TEXT = HELP_TOPIC_KEYS.map((id) => ({
  id,
  question: englishMessages[`help.topic.${id}.question` as keyof typeof englishMessages],
  answer: englishMessages[`help.topic.${id}.answer` as keyof typeof englishMessages],
}));

/** Every question and answer the FAQ section drew, in reading order. */
async function renderedTopics(page: Page): Promise<[string, string][]> {
  return helpModal(page)
    .locator('.help-dialog__topic')
    .evaluateAll((topics) =>
      topics.map((topic) => [
        (topic.querySelector('.help-dialog__question')?.textContent ?? '').trim(),
        (topic.querySelector('.help-dialog__answer')?.textContent ?? '').trim(),
      ]),
    ) as Promise<[string, string][]>;
}

test.describe('the questions the modal answers', () => {
  test('answers every declared topic, once each, in words of its own', async ({ page }) => {
    // One modal, read several ways. Reaching it costs a stock build and a shell
    // action, and none of the readings below changes what it is reading, so the
    // modal is opened once and every claim is made against it.
    await withStockBuild(page);
    await openHelp(page);

    // Every topic the manifest declares, once each, in the declared order.
    expect(await renderedTopics(page)).toEqual(
      HELP_TOPIC_TEXT.map((topic) => [topic.question, topic.answer]),
    );

    // Each question its own heading over its own answer.
    const shape = await helpModal(page)
      .locator('.help-dialog__topic')
      .evaluateAll((topics) =>
        topics.map((topic) => ({
          heading: topic.querySelector('.help-dialog__question')?.tagName.toLowerCase() ?? '',
          answers: topic.querySelectorAll('.help-dialog__answer').length,
        })),
      );

    expect(shape.length).toBe(HELP_TOPIC_TEXT.length);
    for (const topic of shape) {
      expect(topic.heading).toBe('h4');
      expect(topic.answers).toBe(1);
    }

    // Nested under the FAQ heading rather than standing beside it.
    const faq = helpModal(page).locator('.help-dialog__section').nth(1);
    await expect(faq.locator('.help-dialog__heading')).toHaveText(
      new RegExp(englishMessages['help.section.faq'], 'i'),
    );
    await expect(faq.locator('.help-dialog__topic')).toHaveCount(HELP_TOPIC_TEXT.length);

    // And no raw key, blank answer, unresolved variable or markup in any of it.
    for (const [question, answer] of await renderedTopics(page)) {
      for (const text of [question, answer]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/^help\./);
        expect(text).not.toContain('{{');
        expect(text).not.toMatch(/<[a-z/]/i);
      }
    }
  });

  test('claims nothing the reference claims and this application cannot do', async ({ page }) => {
    await withStockBuild(page);
    await openHelp(page);
    const text = (await helpModal(page).textContent()) ?? '';

    // The reference FAQ says an imported module keeps its real roll, which
    // contradicts feature 002 FR-013 and constitution IV, and promises an
    // import behaviour feature 004 owns. Neither is a topic here.
    expect(text).not.toMatch(/retain(s|ed)?\s+(its|their|the)?\s*(original|real|partial)\s+roll/i);
    expect(text).not.toMatch(/coming soon|will soon|in a future (release|version)/i);

    // Nor any of the five questions withdrawn from the set.
    for (const question of WITHDRAWN_HELP_QUESTIONS) {
      expect(text).not.toMatch(question);
    }
  });

  test('draws the same set from the folded action layer', async ({ page }) => {
    await withStockBuild(page);

    const inline = page.getByRole('button', { name: HELP_ACTION });
    if ((await inline.count()) === 0) {
      await openActionLayer(page);
    }
    await page.getByRole('button', { name: HELP_ACTION }).first().click();
    await expect(helpModal(page)).toBeVisible();

    expect(await renderedTopics(page)).toEqual(
      HELP_TOPIC_TEXT.map((topic) => [topic.question, topic.answer]),
    );
  });
});

test.describe('the one legal body the modal embeds', () => {
  /**
   * A fresh extraction from the file itself, by the generator's own rules.
   *
   * Not a copy of the notice typed into this spec: a second copy is the thing
   * that eventually disagrees, and a journey asserting against its own copy
   * proves only that two files this project wrote still match. What is under
   * test is that the text a browser rendered is the text root `LICENSE` holds.
   *
   * Run in its own Node process rather than imported: this suite is transpiled
   * to CommonJS, and the generator is a real ES module. The subprocess is also
   * the more honest evidence — nothing this test's own module graph has already
   * loaded can be what answers.
   */
  async function freshDisclaimer(): Promise<string> {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { readFileSync } from 'node:fs';" +
          "const { extractFrontierDisclaimer } = await import('./scripts/generate-help-manifest.mjs');" +
          "process.stdout.write(extractFrontierDisclaimer(readFileSync('LICENSE', 'utf8')).exactText);",
      ],
      { cwd: process.cwd() },
    );
    return stdout;
  }

  test('embeds the one legal body, opened by the summary that points at it', async ({ page }) => {
    // One modal, opened once: the excerpt, the summary above it and the
    // measure it wraps within are three readings of the same rendered section.
    await withStockBuild(page);
    await openHelp(page);
    const modal = helpModal(page);

    // One body and no other document, asserted before the body is read: reading
    // it is strict, so a second `.legal-excerpt__body` would fail there with a
    // resolution error rather than here with the sentence that says why it is
    // wrong (FR-004).
    const excerpt = modal.locator('.legal-excerpt__body');
    await expect(excerpt).toHaveCount(1);

    // The disclaimer exactly as root LICENSE holds it.
    const rendered = await excerpt.evaluate((node) => node.textContent ?? '');
    const expected = await freshDisclaimer();

    expect(expected.length).toBeGreaterThan(0);
    expect(rendered).toBe(expected);
    await expect(excerpt).toHaveAttribute('lang', 'en');

    // Five claims about five different things: this application's own code,
    // the library it was built against, the icon files it serves, the game data
    // and imagery, and the typefaces. Two of them carry the link to the
    // complete terms they summarise, which is what a summary of what covers
    // what was missing while there was nowhere to point.
    const lines = modal.locator('.help-dialog__licence-line');
    await expect(lines).toHaveCount(5);
    await expect(lines).toHaveText([
      new RegExp(englishMessages['help.licence.link.application'], 'i'),
      new RegExp(englishMessages['help.licence.link.library'], 'i'),
      new RegExp(englishMessages['help.licence.index.icons'], 'i'),
      new RegExp(englishMessages['help.licence.index.gameData'], 'i'),
      new RegExp(englishMessages['help.licence.index.typefaces'], 'i'),
    ]);

    // The label each linked line opens with is still its own, so the two
    // similarly-worded links are told apart by the words in front of them.
    await expect(lines.nth(0)).toContainText(
      englishMessages['help.licence.index.application'].replace('{{licence}}', '').trim(),
    );
    await expect(lines.nth(1)).toContainText(
      englishMessages['help.licence.index.library'].replace('{{licence}}', '').trim(),
    );

    // The MIT grant, the Almanac licence and the package's third-party notices
    // are named and pointed at, never reproduced (FR-004).
    await expect(modal).not.toContainText('Permission is hereby granted');
    await expect(modal).not.toContainText('THIRD_PARTY_NOTICES');

    // And it wraps within the measure rather than sideways.
    const overflow = await excerpt.evaluate((node) => ({
      clipped: node.scrollWidth > node.clientWidth + 1,
      hidden: node.scrollHeight > node.clientHeight + 1,
    }));

    expect(overflow.clipped, 'the excerpt needs a sideways drag to be read').toBe(false);
    expect(overflow.hidden, 'part of the excerpt is cut off').toBe(false);

    // The document itself has not been pushed sideways by it either.
    const document = await page.evaluate(() => ({
      scroll: window.document.documentElement.scrollWidth,
      client: window.document.documentElement.clientWidth,
    }));
    expect(document.scroll).toBeLessThanOrEqual(document.client + 1);
  });
});

test.describe('the three destinations the modal points at', () => {
  /**
   * The audited destinations, read out of the generator itself.
   *
   * Not typed in here. The generator is where the three URLs are declared and
   * validated, so a change to any of them fails this journey rather than
   * leaving it asserting a fourth thing that agrees with neither the product
   * nor the audit. Run in its own Node process for the reason `freshDisclaimer`
   * gives: this suite is transpiled to CommonJS and the generator is a real ES
   * module.
   */
  async function auditedDestinations(): Promise<{
    repository: string;
    almanac: string;
    source: string;
  }> {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const generator = await import('./scripts/generate-help-manifest.mjs');" +
          'process.stdout.write(' +
          'JSON.stringify({ repository: generator.REPOSITORY_LICENSE_URL,' +
          ' almanac: generator.ALMANAC_LICENSE_URL,' +
          ' source: generator.REPOSITORY_SOURCE_URL }));',
      ],
      { cwd: process.cwd() },
    );
    return JSON.parse(stdout) as { repository: string; almanac: string; source: string };
  }

  test('draws exactly the three audited links, and asks for nothing to draw itself', async ({
    page,
    context,
  }) => {
    await page.goto('/outfitting');
    await page.waitForLoadState('networkidle');
    await settled(page);

    const outbound: string[] = [];
    page.on('request', (request) => outbound.push(request.url()));
    const popups: unknown[] = [];
    context.on('page', (opened) => popups.push(opened));

    await openHelp(page);

    // Three links, all from the generated manifest: this application's source
    // in ABOUT, then the two complete licence documents in LICENCE, in the
    // order a reader meets the sections. A fourth — an issue tracker, a docs
    // site — would be a navigation nobody accepted (FR-003).
    const links = helpModal(page).getByRole('link');
    await expect(links).toHaveCount(3);
    const audited = await auditedDestinations();
    await expect(links.nth(0)).toHaveAttribute('href', audited.source);
    await expect(links.nth(1)).toHaveAttribute('href', audited.repository);
    await expect(links.nth(2)).toHaveAttribute('href', audited.almanac);

    // Drawing them costs nothing. A link is an address, not a request: opening
    // the modal reaches no origin, opens no tab and warms no destination.
    expect(outbound.filter((url) => url.includes('github'))).toEqual([]);
    expect(popups).toEqual([]);
    expect(await page.locator('link[rel="preconnect"], link[rel="prefetch"]').count()).toBe(0);
  });

  test('leaves deliberately, says nothing about this session, and reads as it looks', async ({
    page,
  }) => {
    // Three readings of the same three links, so the modal is opened once.
    await withStockBuild(page);
    const fragment = new URL(await settled(page)).hash;
    expect(fragment.length).toBeGreaterThan(0);

    await openHelp(page);
    const links = await helpModal(page).getByRole('link').all();
    expect(links).toHaveLength(3);

    for (const link of links) {
      // Named in visible text, because a Commander is told before they leave
      // and never after (constitution I).
      await expect(link).toContainText(/github/i);

      // `noreferrer` is the load-bearing half. This application keeps the open
      // build in the URL fragment; a fragment never rides in a `Referer`, but
      // the path around it would, and no part of a session belongs in another
      // origin's logs.
      const rel = (await link.getAttribute('rel')) ?? '';
      expect(rel).toContain('noreferrer');
      expect(rel).toContain('noopener');
      expect(await link.getAttribute('target')).toBe('_blank');

      // Neither address carries anything but the path to a document: no query,
      // no fragment, nothing that could be state on its way out.
      const href = new URL((await link.getAttribute('href')) ?? '');
      expect(href.protocol).toBe('https:');
      expect(href.search).toBe('');
      expect(href.hash).toBe('');

      // No reader-only sentence appended to any name. What each link is, is
      // what it reads as on screen, and which document a licence link covers is
      // its line's own leading label rather than a second sentence only some
      // people get.
      await expect(link).toHaveAccessibleName((await link.textContent())?.trim() ?? '');
    }

    const text = (await helpModal(page).textContent()) ?? '';

    // The destinations are in `href`s. A URL drawn as words is a thing to
    // mistype and a line that wraps sideways at 200% text.
    expect(text).not.toContain('https://');
    // And nothing about the open build, the route or this browser's stored
    // records is drawn either.
    expect(text).not.toContain(fragment.slice(1));
    expect(text).not.toContain('ednb:');
  });
});

test.describe('which artifact a Commander is looking at', () => {
  /**
   * The installed Almanac's own version, resolved the way the generator
   * resolves it.
   *
   * Through the package's export map in a real Node process rather than by
   * walking `node_modules` — under pnpm that is a symlinked store path, and a
   * journey that reads a version off a guessed directory is asserting against
   * whatever it happened to find.
   */
  async function installedAlmanacVersion(): Promise<string> {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { readFileSync } from 'node:fs';" +
          "import { fileURLToPath } from 'node:url';" +
          "const root = new URL('../../', import.meta.resolve('@elite-dangerous-almanac/core/ships/ships'));" +
          "const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));" +
          'process.stdout.write(manifest.version);',
      ],
      { cwd: process.cwd() },
    );
    return stdout;
  }

  /** Every term/value pair the ABOUT section publishes, in reading order. */
  async function identityFacts(page: Page): Promise<[string, string][]> {
    return helpModal(page)
      .locator('.version-facts__fact')
      .evaluateAll((facts) =>
        facts.map((fact) => [
          (fact.querySelector('dt')?.textContent ?? '').trim(),
          (fact.querySelector('dd')?.textContent ?? '').trim(),
        ]),
      ) as Promise<[string, string][]>;
  }

  test('names the two artifacts it is made of, and claims nothing else', async ({ page }) => {
    // The ABOUT section, read once. Every claim below is about the same
    // rendered section, so it is rendered once.
    await withStockBuild(page);
    await openHelp(page);
    const facts = await identityFacts(page);
    const byTerm = new Map(facts);

    // The versions the shipped root and installed manifests carry.
    expect(byTerm.get(englishMessages['help.about.version.application'])).toBe(
      applicationManifest.version,
    );
    expect(byTerm.get(englishMessages['help.about.version.almanac'])).toBe(
      await installedAlmanacVersion(),
    );

    // Each identity a term with its own value, and no term twice.
    expect(facts.length).toBe(2);
    expect(new Set(facts.map(([term]) => term)).size).toBe(2);
    for (const [term, value] of facts) {
      expect(term.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    }

    // Nothing about release state. The generator still classifies the build — a
    // mismatched `SHIP_BUILDER_RELEASE_TAG` fails generation — but FR-007's
    // display half is withdrawn with the rest of what the reference does not
    // draw.
    await expect(helpModal(page).getByText(/non-release|release/i)).toHaveCount(0);

    // And nothing about a live game or a live catalogue, which this
    // application has no way to know.
    await expect(
      helpModal(page).getByText(/live game|live catalogue|up to date|latest version/i),
    ).toHaveCount(0);

    // Three sentences, in one order, before the facts. The reference draws only
    // the first; the second is the owner's maintainer line and the third is
    // where the source is, with the destination named inside the sentence
    // (FR-008).
    const about = helpModal(page).locator('.help-dialog__section').first();
    const prose = await about
      .locator('p')
      .evaluateAll((paragraphs) => paragraphs.map((node) => (node.textContent ?? '').trim()));

    expect(prose).toEqual([
      englishMessages['help.purpose'],
      englishMessages['help.maintainer'],
      englishMessages['help.source'].replace('{{source}}', englishMessages['help.source.link']),
    ]);
    await expect(about.locator('ednb-version-facts')).toHaveCount(1);

    // A long identity wraps within the measure rather than sideways.
    const overflow = await helpModal(page)
      .locator('.version-facts')
      .evaluate((node) => node.scrollWidth - node.clientWidth);

    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * The accessibility floor, over every state the modal actually has (T054–T056).
 *
 * The states are the ones [design/screen-inventory.md](../openspec/changes/archive/012-help-and-licences/design/screen-inventory.md)
 * lists and no more: default, alternate locale, expanded text, reduced motion,
 * 200% text and actual 400% zoom. There is deliberately no release and no
 * non-release state to sweep — FR-007's display half is withdrawn, the modal
 * draws two version facts and says nothing about which kind of build produced
 * them, so a sweep that named those states would be sweeping a fiction.
 *
 * Every test here runs in all ten Chromium and Firefox layout projects, which
 * is what makes it a matrix sweep rather than a desktop one. The layout profile
 * is the project's, so the sheet and the centred modal are both covered without
 * this file resizing anything: at `mobile-portrait` the modal *is* the sheet.
 */
test.describe('the floor beneath every open state', () => {
  /**
   * The complete sweep over the currently rendered page.
   *
   * `label` is carried into every failure message, because "axe violations"
   * with no state attached sends whoever reads it looking through six of them.
   */
  async function sweep(page: Page, testInfo: TestInfo, label: string): Promise<void> {
    testInfo.setTimeout(testInfo.timeout + 20_000);

    await settledPage(page);
    await expectNoAccessibilityViolations(page, testInfo, { label });
    await expectOrderedHeadings(page);
    await expectTargetSizes(page);
    await expectNoDocumentOverflow(page);
    expect(await clippedText(page), `clipped text in ${label}`).toEqual([]);
  }

  test('sweeps the closed background and the open modal', async ({ page }, testInfo) => {
    await withStockBuild(page);
    await settled(page);

    // The background first. A modal that is accessible over an inaccessible
    // screen has moved the problem rather than solved it, and the closed state
    // is also where the frame's own Help entry is measured.
    await sweep(page, testInfo, 'closed background');

    await openHelp(page);
    await sweep(page, testInfo, 'open modal');
  });

  test('sweeps the modal over a capability with no build', async ({ page }, testInfo) => {
    // The same modal over the other kind of screen, and at the narrow profiles
    // it is also the modal reached through the folded action layer — which
    // `reachShellAction` opens where the width has one and leaves alone where
    // it does not. The layer is still open behind the modal when it appears,
    // which is a nesting the wide profiles never produce.
    await page.goto('/ships');
    await settled(page);
    await openHelp(page);

    await sweep(page, testInfo, 'open modal over the hull catalogue');
  });

  test('sweeps the modal in the other shipped locale', async ({ browser, baseURL }, testInfo) => {
    // German rather than a pseudo-locale: it is a shipped language, a
    // Commander can actually be in it, and every owned string in this modal has
    // an entry in it. The pseudo-locales are the preview application's, and
    // feature 011's expansion and RTL suites sweep the help previews there.
    const context = await browser.newContext({ baseURL, locale: 'de-DE' });
    const page = await context.newPage();

    try {
      await page.goto('/outfitting');
      await expectRootLanguage(page, { lang: 'de', dir: 'ltr' });
      await reachShellAction(page, new RegExp(`^${germanMessages['help.action.label']}$`, 'i'));

      const modal = page.getByRole('dialog', {
        name: new RegExp(germanMessages['help.title'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      });
      await expect(modal).toBeVisible();

      // Translated, not merely rendered: the purpose sentence is the German
      // one, and the excerpt is still Frontier's English.
      await expect(modal).toContainText(germanMessages['help.purpose']);
      await expect(modal.locator('.legal-excerpt__body')).toHaveAttribute('lang', 'en');
      await expectNoRawMessages(page);

      await sweep(page, testInfo, 'open modal in German');
    } finally {
      await context.close();
    }
  });

  test('sweeps the modal at 200% text', async ({ page }, testInfo) => {
    // The user's text size setting, applied before the first frame, which is
    // what SC 1.4.4 is actually about. Not zoom — that is the next test.
    await withRootTextScale(page, DOUBLED_TEXT);
    await withStockBuild(page);
    await openHelp(page);

    await sweep(page, testInfo, 'open modal at 200% text');
    await expectEverySectionReachable(page);
  });

  test('sweeps the modal at actual 400% zoom', async ({ browser, baseURL }, testInfo) => {
    // Viewport and device scale factor together, which is the equivalence WCAG
    // 1.4.10 defines. Its own context because `deviceScaleFactor` is fixed when
    // a context is created and cannot be changed on a live page.
    const context = await browser.newContext({
      baseURL,
      viewport: ZOOM_400.viewport,
      deviceScaleFactor: ZOOM_400.deviceScaleFactor,
    });
    const page = await context.newPage();

    try {
      await withStockBuild(page);
      await openHelp(page);

      await sweep(page, testInfo, 'open modal at 400% zoom');
      await expectEverySectionReachable(page);
    } finally {
      await context.close();
    }
  });

  test('keeps every state immediate and textual without motion', async ({ page }, testInfo) => {
    // What is asserted is that *nothing* is lost: a modal only reachable
    // through a transition is unreachable for a Commander who has asked for
    // none, and open and closed have to be distinguishable without watching
    // anything move.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withStockBuild(page);
    await settled(page);

    await expect(helpModal(page)).toHaveCount(0);
    await openHelp(page);
    const modal = helpModal(page);

    // Open state is a fact in the accessibility tree, not an appearance: the
    // dialog is there, it is modal, and it carries its own name. Modality is
    // read as the element's own `:modal` state rather than as an `aria-modal`
    // attribute, because the layer is a native `dialog` opened with
    // `showModal()` — which carries the semantics natively, and on which the
    // attribute would be a duplicate of something the platform already says.
    expect(await modal.evaluate((node) => node.matches(':modal')), 'the modal is not modal').toBe(
      true,
    );
    await expect(modal).toContainText(englishMessages['help.purpose']);

    // And nothing is mid-transition once it is open. A transition still running
    // when the content is asserted is a transition a Commander asked not to
    // have.
    const animating = await modal.evaluate(
      (node) =>
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    );
    expect(animating, 'the modal is still animating under prefers-reduced-motion').toBe(0);

    await sweep(page, testInfo, 'open modal under reduced motion');

    // And closed is a fact too: the dialog is gone, the capability beneath is
    // back, and neither took a transition to happen.
    await closeHelp(page);
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
    await page.emulateMedia({ reducedMotion: null });
  });

  test('carries no meaning in colour, icon, shape or placement alone', async ({ page }) => {
    await withStockBuild(page);
    await openHelp(page);
    const modal = helpModal(page);

    // Every control the modal draws — there is exactly one — has a text
    // accessible name. An icon-only close would put the only way out behind
    // glyph recognition.
    const controls = modal.getByRole('button');
    await expect(controls).toHaveCount(1);
    const names = await controls.evaluateAll((nodes) =>
      nodes.map(
        (node) => (node.textContent ?? '').trim() || (node.getAttribute('aria-label') ?? ''),
      ),
    );
    for (const name of names) {
      expect(name.length, 'a control in the modal has no textual name').toBeGreaterThan(0);
    }

    // The frame's own entry, likewise: the reference names the wide control
    // with a title attribute on a `?`, and this draws the label itself.
    await closeHelp(page);
    await expect(await helpEntry(page)).toHaveAccessibleName(HELP_ACTION);
    await openHelp(page);

    // No section depends on an image to be understood, and nothing in the
    // modal is drawn as one.
    await expect(helpModal(page).locator('img, svg')).toHaveCount(0);
  });
});

/**
 * Every section of the modal is reachable at a constrained size.
 *
 * The header and its close stay put; the body alone scrolls. So "reachable"
 * means the body can be scrolled to each section, not that each section is
 * already in view — a 320-pixel viewport at 400% zoom has room for about one.
 */
async function expectEverySectionReachable(page: Page): Promise<void> {
  const modal = helpModal(page);

  // The title and the way out are available without scrolling anything.
  await expect(modal.getByRole('heading', { name: HELP_TITLE })).toBeInViewport();
  await expect(
    modal.getByRole('button', { name: new RegExp(`^${englishMessages['action.close']}$`, 'i') }),
  ).toBeInViewport();

  const sections = [
    englishMessages['help.section.about'],
    englishMessages['help.section.faq'],
    englishMessages['help.section.licence'],
  ];
  for (const section of sections) {
    const heading = modal.getByRole('heading', { name: new RegExp(`^${section}$`, 'i') });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();
  }

  // The last thing in the last section is the disclaimer, and it is what a
  // clipped modal loses first.
  const excerpt = modal.locator('.legal-excerpt__body');
  await excerpt.scrollIntoViewIfNeeded();
  await expect(excerpt).toBeInViewport();

  // Whatever scrolled, it was not the document.
  await expectNoDocumentOverflow(page);
}
