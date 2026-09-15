import { expect, test, type Locator, type Page } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { expectNoDocumentOverflow } from './accessibility/assertions';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  buildStockHull,
  holdEveryChunk,
  openLibrary,
  regroupCoreMount,
  savedToBrowser,
  waitForTakeover,
  waitingStatement,
  watchForTheStatement,
  watchForTheStatementFromStart,
} from './shell';

/**
 * What a Commander is told between asking for a screen and getting it
 * (018/US1).
 *
 * Every screen is its own chunk, fetched on the navigation that first asks for
 * it. These journeys hold that fetch, so the wait a Commander meets on a slow
 * connection is a wait the suite can read, and then let it go, refuse it, or
 * replace it with a second navigation.
 *
 * Runs in all ten projects: the statement is the same one at every width, and
 * the screen behind it is unusable at every width, by touch as well as by
 * pointer.
 */

/** The statement, while it stands. */
const overlay = waitingStatement;

/** The mark it draws. */
const mark = (page: Page): Locator => overlay(page).locator('img');

/** The two entries on the start page, each of which opens a tool. */
const tools = (page: Page): Locator => page.getByRole('main').getByRole('link');

/**
 * The failure as visible text, which is the projection that stays to be re-read.
 *
 * Scoped to the status region, because the same sentence is also published to
 * the polite announcement outlet beside it. They are two projections of one
 * event, and a locator that matched both would be asserting about neither.
 */
const failureNotice = (page: Page): Locator =>
  page.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']);

/** The outlets a reader hears: the one that waits its turn, and the one that cuts in. */
const politeOutlet = (page: Page): Locator => page.locator('[data-announcement-outlet="polite"]');
const assertiveOutlet = (page: Page): Locator =>
  page.locator('[data-announcement-outlet="assertive"]');

/** Waits until the statement is standing, which the threshold makes a moment. */
async function stands(page: Page): Promise<void> {
  await expect(overlay(page)).toBeVisible({ timeout: 15_000 });
}

/** The alpha of an element's own background colour, as the browser computes it. */
function groundAlpha(dialog: Locator): Promise<number> {
  return dialog.evaluate((element) => {
    const parts = getComputedStyle(element).backgroundColor.match(/[\d.]+/g) ?? [];
    // `rgb(r g b)` is opaque; `rgb(r g b / a)` and `rgba(…)` state the alpha.
    return parts.length < 4 ? 1 : Number(parts[3]);
  });
}

test.describe('a screen that has to be fetched', () => {
  test('states the wait, over the screen the Commander pressed from (018/FR-001, FR-002, FR-005)', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTakeover(page);
    const held = await holdEveryChunk(page);

    await tools(page).filter({ hasText: 'Ship Builder' }).click({ noWaitAfter: true });
    await stands(page);

    // One statement, and it says only that the application is working.
    await expect(overlay(page)).toHaveCount(1);
    await expect(overlay(page)).toHaveAccessibleName(englishMessages['navigation.waiting.notice']);
    await expect(overlay(page).getByRole('button')).toHaveCount(0);

    // The mark is centred in the viewport, whatever shape the profile is.
    const box = await mark(page).boundingBox();
    const view = page.viewportSize();
    expect(box, 'the mark was drawn').not.toBeNull();
    expect(view, 'the profile has a viewport').not.toBeNull();
    if (box !== null && view !== null) {
      expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThanOrEqual(2);
    }

    // A ground the screen behind stays visible through, rather than one that
    // takes it out of the reading. What the step should be is a judgment, and
    // the reference reading in `e2e/manual/` settles it; what a journey can
    // hold is that the ground is translucent at all (018/FR-002).
    const alpha = await groundAlpha(overlay(page));
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);

    // Nothing to sit through, either way. A statement that arrives late is
    // late, and one that lingers is a statement that is no longer true. Read
    // from a real engine, where a stylesheet the element actually got is the
    // one being asked — a duration never set and one set to zero both compute
    // to `0s`, so what this catches is a transition or an animation being given
    // to it later (018/FR-001, FR-005).
    expect(
      await overlay(page).evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.transitionDuration, style.animationDuration];
      }),
    ).toEqual(['0s', '0s']);

    // The screen behind it is still on the page, and is not reachable.
    await expect(page.locator('main')).toBeAttached();
    // What answers at the card's own middle. Asked for separately from what it
    // means: a point outside the viewport answers nothing at all, and nothing
    // is not the statement — a reading that folded the two together would pass
    // on a profile where the card sits below the fold.
    const atTheCard = await tools(page)
      .first()
      .evaluate((card) => {
        const box = card.getBoundingClientRect();
        const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { answered: at !== null, isTheCard: at !== null && card.contains(at) };
      });
    expect(atTheCard.answered, 'nothing at all was drawn where the card is').toBe(true);
    expect(atTheCard.isTheCard, 'the screen behind the statement is covered').toBe(false);

    await expectNoDocumentOverflow(page);

    held.release();
    await expect(page).toHaveURL(/\/ships$/);
    await expect(overlay(page)).toHaveCount(0);
  });

  test('draws the same statement whichever screen was asked for (018/FR-001)', async ({ page }) => {
    // One answer a Commander learns, rather than one per screen. The ship list
    // is already on screen; what is held here is the code behind the hull the
    // press opens — and, where a rest reads a hull, the workspace's as well,
    // because there the press builds the hull and opens the bench on it.
    await page.goto('/ships');
    await waitForTakeover(page);

    // Found and brought into view before the gate is armed, and pressed on its
    // own terms, for the reason the superseding journey below gives.
    const hull = page.locator('[data-hull-symbol] button:visible').first();
    await expect(hull).toBeVisible();
    await hull.scrollIntoViewIfNeeded();

    const held = await holdEveryChunk(page);
    await hull.press('Enter', { noWaitAfter: true });
    await stands(page);

    await expect(overlay(page)).toHaveAccessibleName(englishMessages['navigation.waiting.notice']);
    await expect(overlay(page).getByRole('button')).toHaveCount(0);

    held.release();
    await expect(overlay(page)).toHaveCount(0);
  });

  test('draws nothing for a screen whose code the browser already holds (018/FR-004)', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTakeover(page);

    // Fetched once…
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await expect(page).toHaveURL(/\/ships$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/(\?.*)?$/);

    // …and asked for again, which the browser answers without a request. The
    // threshold is what keeps that from flashing a statement nobody can read.
    //
    // Watched for every change across the navigation rather than read once at
    // the end. A reading taken after the screen has arrived is a reading a
    // statement that stood and came down would pass, which is the whole of
    // what the threshold is for — and at ten milliseconds it is a statement a
    // watch that only looked once a frame could miss as well.
    const watch = await watchForTheStatement(page);
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await expect(page).toHaveURL(/\/ships$/);
    await expect(page.getByRole('main')).toBeVisible();
    expect(await watch.wasDrawn(), 'a statement was drawn').toBe(false);
    await expect(overlay(page)).toHaveCount(0);
  });

  test('leaves one statement when a second navigation supersedes the first (018/FR-005)', async ({
    page,
  }) => {
    // From a screen there is something behind, so the browser's own way back is
    // a navigation rather than a step out of the application. The screen behind
    // the statement cannot be pressed, so the browser is the only place a
    // second navigation can come from — which is the point of the requirement.
    await page.goto('/');
    await waitForTakeover(page);
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await expect(page).toHaveURL(/\/ships$/);
    await expect(page.getByRole('main')).toBeVisible();

    // A history entry for a screen whose code has never been fetched, put there
    // rather than visited: visiting it would fetch the code, and then the
    // navigation that takes over would finish at once and the reading would be
    // the same whether the statement was carried across the handover or taken
    // down and never drawn again. The entry after it is the address the
    // Commander is on, so this press is where they are pressing from.
    //
    // Put there rather than walked to for a second reason: walking to it means
    // reloading, and a step back across a reload is a fresh document rather
    // than a navigation the application ever sees.
    //
    // The equipment bench, because the press below asks for the ship tool's
    // screens and this one has to be a screen it never asks for: its request
    // for its code is what says the navigation taking over has started.
    await page.evaluate(() => {
      history.pushState(null, '', '/equipment');
      history.pushState(null, '', '/ships');
    });

    // The row is found and brought into view before the gate is armed, and
    // pressed from the keyboard rather than with the pointer.
    //
    // Where a rest reads a hull, the move that carries a pointer onto the row
    // opens it, and the statement answering that navigation covers the row
    // before the press lands on it. The keyboard reaches the control the
    // Commander means without crossing anything on the way.
    const hull = page.locator('[data-hull-symbol] button:visible').first();
    await expect(hull).toBeVisible();
    await hull.scrollIntoViewIfNeeded();

    const watch = await watchForTheStatement(page);
    const held = await holdEveryChunk(page);
    await hull.press('Enter', { noWaitAfter: true });
    await stands(page);

    // Back to the screen whose code is held from arriving as well, so the
    // navigation that takes over waits too. The statement stands through the
    // handover: the browser's own way back is the one way a second navigation
    // can start while the screen behind the statement takes no press.
    //
    // The counts are read once the navigation taking over has asked for its own
    // code, not at the traversal: a store that took the statement down at the
    // handover would be read before it had done so, and pass.
    //
    // What the press asks for differs by profile — where a rest reads a hull it
    // opens the hull and then the bench on it, two navigations rather than one
    // — so this counts rather than names. The equipment bench is a screen
    // neither of those asks for, and its code is the next thing asked for after
    // the traversal, which the handover has to have happened for.
    const askedBefore = held.timesAsked();
    await page.evaluate(() => history.back());
    await expect
      .poll(() => held.timesAsked(), {
        message: 'the navigation taking over never asked for its screen',
      })
      .toBeGreaterThan(askedBefore);

    // The counts are what make this a reading. The application mounts one
    // overlay, so asking how many stand can only ever answer one; what the
    // requirement is about is whether the statement went down and came back
    // between the two navigations. Standing here, drawn once and never taken
    // down, it is the statement the press raised — carried across the handover
    // rather than removed by the navigation it replaced and drawn again a
    // threshold later (FR-005).
    expect(
      await watch.timesRemoved(),
      'the statement was taken down by the navigation it replaced',
    ).toBe(0);
    expect(await watch.timesDrawn(), 'the statement was drawn more than once').toBe(1);

    // It comes down with the navigation that is still going.
    held.release();
    await expect(page).toHaveURL(/\/equipment(#|$)/);
    await expect
      .poll(() => watch.timesRemoved(), {
        message: 'the statement outlived the navigation that was still going',
      })
      .toBeGreaterThan(0);
    // The navigation that was replaced is stated as nothing. It did not end:
    // it was superseded, and what took it over is what ended.
    await expect(failureNotice(page)).toHaveCount(0);
  });

  test('takes the statement down when what takes over is not a navigation (018/FR-005)', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTakeover(page);
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await expect(page).toHaveURL(/\/ships$/);
    await expect(page.getByRole('main')).toBeVisible();

    // A second history entry for the screen the Commander is already on. Going
    // back to it is a navigation to the address the application never left,
    // which it answers without navigating — the one case where what takes over
    // a handover is not a navigation at all. A Commander reaches it by pressing
    // back to a screen still arriving and then forward again; this is that
    // position without the reload, which would replace the document rather than
    // navigate in it.
    await page.evaluate(() => history.pushState(null, '', '/ships'));

    const hull = page.locator('[data-hull-symbol] button:visible').first();
    await expect(hull).toBeVisible();
    await hull.scrollIntoViewIfNeeded();

    const watch = await watchForTheStatement(page);
    const held = await holdEveryChunk(page);
    await hull.press('Enter', { noWaitAfter: true });
    await stands(page);

    // Nothing is going to end here. The statement handed over to an answer that
    // starts no navigation has to come down on that answer, or it never comes
    // down at all — and it is a statement a Commander cannot dismiss, over a
    // screen it has made inert (FR-005).
    //
    // What is read is that it was taken down, not what stands afterwards. With
    // every script held, the application goes on scheduling navigations for the
    // screen it cannot get — the router's own event log shows another starting
    // within the second — so a statement standing later is that navigation's
    // answer rather than this one's.
    //
    // The taking down is all this reads. A navigation that ran here rather than
    // being skipped would take the statement down too, and the two are not
    // separable from outside: the address is one whose code the browser already
    // holds, so neither asks for anything, and both leave the same address in
    // the bar. What pins the arm itself is the store's own test over the events
    // the router publishes; this holds that a Commander is not left under a
    // statement nothing can dismiss.
    await page.evaluate(() => history.back());
    await expect
      .poll(() => watch.timesRemoved(), {
        message: 'the statement was left standing over an answer that started no navigation',
      })
      .toBeGreaterThan(0);
    // Nothing failed: the application answered the address it was asked for.
    await expect(failureNotice(page)).toHaveCount(0);

    held.release();
  });

  test('states nothing about an address that resolves to nothing (018/FR-007)', async ({
    page,
  }) => {
    // The one redirect the route table declares. It is reached by typing an
    // address, so it is the navigation that starts a session — which draws no
    // statement — and it lands at the entry point rather than reporting a fault
    // (`platform/tool-navigation`).
    await page.goto('/not-an-address');
    await waitForTakeover(page);

    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(overlay(page)).toHaveCount(0);
    await expect(failureNotice(page)).toHaveCount(0);
  });
  test('is watched from before the document, so a reading of none is a reading (018/FR-008)', async ({
    page,
  }) => {
    // The control for the instrument the first-presentation readings use. Those
    // readings pass when nothing was drawn, so a watch that never attached
    // would agree with them for ever — and a watch installed before a document
    // exists is exactly where attaching can fail silently. This one is set the
    // same way and put where a statement is known to stand.
    const watch = await watchForTheStatementFromStart(page);
    await page.goto('/');
    await waitForTakeover(page);

    const held = await holdEveryChunk(page);
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await stands(page);

    expect(await watch.wasDrawn(), 'the watch set before the document read nothing').toBe(true);
    expect(await watch.timesDrawn()).toBe(1);

    held.release();
  });
});

test.describe('a screen that never arrives', () => {
  test('is stated, on a screen the Commander can still use (018/FR-005, FR-007)', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTakeover(page);
    const held = await holdEveryChunk(page);

    await tools(page).filter({ hasText: 'Ship Builder' }).click({ noWaitAfter: true });
    await stands(page);
    held.refuse();

    // The statement comes down with the navigation, whatever the outcome.
    await expect(overlay(page)).toHaveCount(0);

    // The words stay on the page to be re-read, rather than being spoken and
    // gone, and they state no reason the application does not have.
    await expect(failureNotice(page)).toBeVisible();
    await expect(
      page.locator('.frame__status').getByText(englishMessages['navigation.failed.detail']),
    ).toBeVisible();

    // Said once as well, politely: nothing is blocked, so nothing interrupts.
    //
    // The outlets are not the only live region on the page. A notice drawn at
    // error tone carries `role="alert"`, which a reader speaks over whatever it
    // was saying — so an empty assertive outlet proves nothing by itself, and
    // the notice's own role is read too.
    //
    // What is read is that nothing here interrupts. Whether a reader then says
    // the sentence twice, once from each polite region, is not read: `status`
    // is a polite live region itself, and what makes the arrangement acceptable
    // is that a region inserted together with its text is usually not spoken —
    // a judgment step 21 of `e2e/manual/screen-reader.protocol.md` settles.
    await expect(politeOutlet(page)).toHaveText(englishMessages['navigation.failed.notice']);
    await expect(assertiveOutlet(page)).toHaveText('');
    await expect(
      page
        .locator('.frame__status ednb-status-notice')
        .filter({ hasText: englishMessages['navigation.failed.notice'] })
        .locator('[role]'),
    ).toHaveAttribute('role', 'status');

    // And the Commander is on a screen they can use, rather than back where
    // they pressed with no answer.
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
    held.release();
    await tools(page).filter({ hasText: 'Equipment Builder' }).click();
    await expect(page).toHaveURL(/\/equipment$/);
    // The next screen that opens takes the failure down with it.
    await expect(failureNotice(page)).toHaveCount(0);
  });

  test('says a second failure as well as the first (018/FR-007, 011/FR-009)', async ({ page }) => {
    await page.goto('/');
    await waitForTakeover(page);
    const held = await holdEveryChunk(page);
    held.refuse();

    // What a reader is told is what the region carrying it holds, not what the
    // application decided to publish. Both failures say the same sentence, so
    // the text is identical before and after and says nothing about whether the
    // second one reached anyone: a live region announces a change to what it
    // holds, and a sentence written over itself is not a change. The node is
    // what changes, so the node is what is read — the same reading the outlet's
    // own tests take, taken here against a real engine.
    //
    // Text nodes only: the framework's own anchors are comments, and they stay
    // put across a change.
    const readTheOutlet = (): Promise<{ found: boolean; replaced: boolean }> =>
      page.evaluate(() => {
        const outlet = document.querySelector('[data-announcement-outlet="polite"]');
        if (outlet === null) {
          throw new Error('There is no polite outlet on the page to read.');
        }
        const spoken =
          [...outlet.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
          ) ?? null;
        const window_ = window as unknown as { __spoken?: ChildNode | null };
        return { found: spoken !== null, replaced: spoken !== window_.__spoken };
      });
    const remember = (): Promise<void> =>
      page.evaluate(() => {
        const outlet = document.querySelector('[data-announcement-outlet="polite"]');
        (window as unknown as { __spoken?: ChildNode | null }).__spoken =
          [...(outlet?.childNodes ?? [])].find(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
          ) ?? null;
      });

    await remember();
    await tools(page).filter({ hasText: 'Ship Builder' }).click({ noWaitAfter: true });
    await expect(failureNotice(page)).toBeVisible();
    await expect
      .poll(async () => (await readTheOutlet()).found, {
        message: 'the first failure never reached the polite outlet',
      })
      .toBe(true);
    await remember();

    // A second screen, so a second navigation with its own code to fetch: the
    // first one's code is refused rather than held, and asking for it again
    // would not be a second failure of anything.
    await tools(page).filter({ hasText: 'Equipment Builder' }).click({ noWaitAfter: true });
    await expect
      .poll(readTheOutlet, {
        message: 'the second failure was written over the first in silence',
      })
      .toEqual({ found: true, replaced: true });

    // And still politely, and still once each: two events, not one interrupting.
    await expect(assertiveOutlet(page)).toHaveText('');
    await expect(politeOutlet(page)).toHaveText(englishMessages['navigation.failed.notice']);

    held.release();
  });

  test('is stated on the navigation that starts a session too (018/FR-007, FR-008)', async ({
    page,
  }) => {
    // No statement is drawn over a session's first presentation, whatever
    // happens to it — but a first navigation that fails is stated like any
    // other, and the Commander is left with whatever that address served them
    // rather than with nothing.
    //
    // The screen's own code is refused and the application's is not. They are
    // told apart by asking for the screen once and remembering what that
    // fetched, because both are chunks and only the address distinguishes them.
    // What the Commander is left on in this lane is the application's own
    // shell; where the build generated a document for the address it is that
    // document, which `prerendered-first-frame.spec.ts` reads in the lane that
    // has one.
    const screenChunks = new Set<string>();
    await page.goto('/');
    await waitForTakeover(page);
    page.on('request', (request) => {
      if (request.resourceType() === 'script') {
        screenChunks.add(request.url());
      }
    });
    await tools(page).filter({ hasText: 'Ship Builder' }).click();
    await expect(page).toHaveURL(/\/ships$/);
    await expect(page.getByRole('main')).toBeVisible();

    const fresh = await page.context().newPage();
    await fresh.route('**/*', async (route) => {
      if (screenChunks.has(route.request().url())) {
        await route.abort('failed').catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });

    // Watched from before the document exists, rather than read once at the
    // end. A reading taken after the failure is stated cannot tell a statement
    // that was never drawn from one that was drawn and removed, and "never
    // drawn over the first presentation" is the whole of what FR-008 asks.
    const watch = await watchForTheStatementFromStart(fresh);

    await fresh.goto('/ships');

    await expect(
      fresh.locator('.frame__status').getByText(englishMessages['navigation.failed.notice']),
    ).toBeVisible({ timeout: 30_000 });
    await expect(fresh.locator('ednb-waiting-overlay dialog[open]')).toHaveCount(0);
    expect(
      await watch.wasDrawn(),
      'the first presentation was covered by the waiting statement',
    ).toBe(false);
    // Something readable, rather than a blank page.
    await expect(fresh.getByRole('banner')).toBeVisible();
    await fresh.close();
  });
});

test.describe('the statement and a surface that is already open', () => {
  test('stands in front of a layer the Commander opened (018/FR-002)', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    // One decision on the build, so autosave has a record to write. A build
    // still at its hull's package default is stored nowhere (024/FR-001).
    await regroupCoreMount(page);
    await savedToBrowser(page);

    // A fresh session, so the workspace's code is a fetch rather than something
    // the browser already holds.
    await page.goto('/');
    await waitForTakeover(page);
    await openLibrary(page);

    const held = await holdEveryChunk(page);
    const library = page.getByRole('dialog', { name: /^saved builds$/i });
    const row = library.getByRole('button', { name: /^Anaconda\b/i }).first();
    await expect(async () => {
      await row.click({ timeout: 2_000 });
      await expect(row).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await page
      .locator('.library__footer')
      .getByRole('button', { name: 'Open in outfitting', exact: true })
      .click({ noWaitAfter: true });
    await stands(page);

    // The top layer stacks them in the order they were opened, so the statement
    // is in front — and it is the statement, not the layer, that a press at the
    // middle of the screen reaches.
    const inFront = await overlay(page).evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return at !== null && dialog.contains(at);
    });
    expect(inFront, 'the statement is in front of the layer').toBe(true);

    held.release();
    await expect(overlay(page)).toHaveCount(0);
  });
});

test.describe('accessibility', () => {
  test('scans the standing statement and the failure it can end in (018/FR-003, 011/FR-012)', async ({
    page,
    browserName,
  }, testInfo) => {
    await page.goto('/');
    await waitForTakeover(page);

    // Which of these roles the browser's own accessibility tree holds right
    // now. Only one engine here answers that question; the other's reading is
    // the screen-reader record the ledger names, and every assertion outside
    // this branch holds in both.
    const behindTheStatement = ['banner', 'main', 'navigation'] as const;
    const exposed = async (roles: readonly string[]): Promise<string[]> => {
      const devtools = await page.context().newCDPSession(page);
      const tree = await devtools.send('Accessibility.getFullAXTree');
      await devtools.detach();
      const present = new Set(
        tree.nodes.filter((node) => !node.ignored).map((node) => node.role?.value),
      );
      return roles.filter((role) => present.has(role));
    };

    // The screen as it reads with nothing standing over it. Asked before the
    // statement, because three empty answers afterwards would read the same if
    // this browser spelled any of these roles differently or the tree came back
    // empty — the reading below would then pass for a reason that has nothing
    // to do with the statement.
    if (browserName === 'chromium') {
      expect(
        await exposed(behindTheStatement),
        'the screen is not in the accessibility tree before the statement stands',
      ).toEqual([...behindTheStatement]);
    }

    const held = await holdEveryChunk(page);

    await tools(page).filter({ hasText: 'Ship Builder' }).click({ noWaitAfter: true });
    await stands(page);

    // What a reader is left with, read off the browser's own accessibility tree:
    // the statement, and none of the screen behind it — no banner, no main, no
    // tool list — which is what FR-003 asks and what no assertion about one
    // element can show.
    //
    // The browser's tree, not the test runner's model of one. That model knows
    // `display`, `visibility` and `aria-hidden`, and nothing about the top
    // layer, so it still holds every landmark behind the statement and would
    // agree with any claim made about them. What takes them out of a reader's
    // reach is the modal dialog, and the browser is the only thing that can be
    // asked whether it did. The same three roles that were all there a moment
    // ago are asked for again, so an empty answer here can only be the
    // statement.
    if (browserName === 'chromium') {
      expect(
        await exposed(behindTheStatement),
        'the screen behind the statement is still in the accessibility tree',
      ).toEqual([]);
      // The other half of the same reading, so a tree that answered nothing at
      // all could not pass the first.
      expect(await exposed(['dialog']), 'the statement is not in the accessibility tree').toEqual([
        'dialog',
      ]);
    }

    // The mechanism behind it, so a failure says which half broke: the
    // statement is a *modal* dialog, which is what takes the rest of the
    // document out of the tree.
    expect(
      await overlay(page).evaluate((dialog) => (dialog as HTMLDialogElement).matches(':modal')),
      'the statement is a modal dialog',
    ).toBe(true);

    // Which shows in what a keyboard can reach: nothing behind it takes focus.
    // Whether there was a control to try is asked separately — a screen with
    // none would refuse focus for the wrong reason and read the same.
    const behind = await page.evaluate(() => {
      const control = document.querySelector<HTMLElement>('main a, main button');
      control?.focus();
      return {
        found: control !== null,
        took: control !== null && document.activeElement === control,
      };
    });
    expect(behind.found, 'the screen behind the statement carried no control to try').toBe(true);
    expect(behind.took, 'a control behind the statement took focus').toBe(false);

    await expectNoAccessibilityViolations(page, testInfo, { label: 'navigation waiting' });

    held.refuse();
    await expect(failureNotice(page)).toBeVisible();

    await expectNoAccessibilityViolations(page, testInfo, { label: 'navigation failed' });
  });
});
