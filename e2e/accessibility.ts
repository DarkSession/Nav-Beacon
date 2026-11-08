import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  clippedText,
  expectNoDocumentOverflow,
  expectOrderedHeadings,
  expectTargetSizes,
  settled,
} from './accessibility/assertions';
import { expectNoAccessibilityViolations } from './accessibility/axe';

/**
 * One sweep, applied to every outfitting state.
 *
 * Feature 002 has a lot of states — workspace, chooser, engineering, no-build,
 * empty, no-match, unavailable, refusal, normalization, history-disabled — and
 * every one of them owes the same evidence. Writing that evidence out per state
 * would guarantee that one of them ends up with four checks instead of eight,
 * and nobody would notice which. So the sweep is one function and every state
 * calls it (responsive composition, "Verification matrix").
 *
 * What it does not do is judge. Whether a name is meaningful and whether a
 * reading order makes sense stay in the named assertions beside each journey
 * and in the manual screen-reader protocols; this is the floor beneath them.
 */

/** The 400%-zoom equivalence WCAG 1.4.10 defines, as a browser context. */
export const ZOOM_400 = { viewport: { width: 320, height: 256 }, deviceScaleFactor: 4 } as const;

/**
 * What one sweep is allowed to cost, added to the test's budget when it runs.
 *
 * Six passes over a rendered tree — an axe analysis, a heading walk, a target
 * measurement, an overflow check and a clipping check — cost 5–7 seconds on a
 * developer machine and roughly twice that on a CI runner, whose cores are
 * slower and are being shared by four workers. A test that sweeps three states
 * therefore wants around 45 seconds of the 30 the default gives it, which is how
 * `outfitting-history` came to time out on CI while passing everywhere else.
 *
 * The budget is **added per sweep** rather than set to a fixed number, because
 * what a test needs is a function of how many states it draws: one sweep gets
 * 45 seconds, three get 75, and a test that grows a fourth state grows its
 * allowance with it instead of quietly moving back towards the edge. Additive
 * also means it cannot compound — `test.slow()` multiplies the current timeout,
 * so calling it once per sweep would hand a three-state test 810 seconds and
 * turn a genuine hang into a very long wait.
 */
const SWEEP_BUDGET_MS = 15_000;

/**
 * The full sweep over one rendered outfitting state.
 *
 * `label` names the state in every failure message, because "axe violations"
 * with no state attached sends whoever reads it looking through ten of them.
 *
 * The state includes where the page stands. Two of the rules scanned here are
 * geometric — a target's size and its distance from its neighbours — and both
 * are read against the viewport, so a control parked behind the sticky command
 * bar is an obscured target for as long as the page is left at that offset.
 *
 * **So the sweep says where it stands, rather than each caller saying it.
 * Ruled 2026-08-27.** It stands at the top. Forty-odd callers reach their state
 * by pressing something, and a press scrolls whatever it has to in order to
 * land — including the document, once the workspace column releases and the
 * page is the tall thing. That left the sweep judging an offset nobody chose:
 * selecting the cargo hatch at 834x1112 parked the anatomy 233px up, under the
 * command bar, and `target-size` read the bar's own `?` as a target zero pixels
 * from the mount marks beneath it. At the top the same sweep is clean.
 *
 * It is the state a Commander meets, too. They reach a mount by scrolling the
 * ledger's own rail, which is what the rail is for; the document moving under
 * them is the test harness reaching a row, not a Commander reading a screen.
 * And a control that a sticky bar covers at some offset is
 * `2.4.11 Focus Not Obscured`, one of the criteria the constitution
 * excludes — it is not the spacing `2.5.8` is about, which is whether two
 * targets can be told apart by a thumb.
 *
 * A caller that means to sweep a scrolled state scrolls after this and says so,
 * which is what `mobility-and-jump` already does for the state it is about.
 */
export async function sweepOutfittingState(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  testInfo.setTimeout(testInfo.timeout + SWEEP_BUDGET_MS);

  await page.evaluate(() => window.scrollTo(0, 0));
  await settled(page);
  await expectNoAccessibilityViolations(page, testInfo, { label });
  await expectOrderedHeadings(page);
  await expectTargetSizes(page);
  await expectNoDocumentOverflow(page);
  await expectNoClippedText(page, label);
}

/**
 * No label, name or identity is cut off.
 *
 * A truncated module name is not a cosmetic problem here: two modules can
 * differ only in their tail, so an ellipsis can make two different articles
 * look like the same one (module-replacement design, "identity ambiguity is not
 * hidden by ellipsis").
 */
export async function expectNoClippedText(page: Page, label: string): Promise<void> {
  const clipped = await clippedText(page);
  expect(clipped, `clipped text in ${label}`).toEqual([]);
}

/**
 * A control's programmatic state, as a plain record.
 *
 * Every outfitting control that carries selection, expansion, checked or
 * disabled state exposes it here rather than in a border colour, and the suites
 * read it through this one helper so the attribute names are written once.
 */
export async function programmaticState(
  page: Page,
  selector: string,
): Promise<Record<string, string | null>> {
  return page
    .locator(selector)
    .first()
    .evaluate((node) => ({
      role: node.getAttribute('role'),
      selected: node.getAttribute('aria-selected'),
      expanded: node.getAttribute('aria-expanded'),
      checked: node.getAttribute('aria-checked'),
      pressed: node.getAttribute('aria-pressed'),
      invalid: node.getAttribute('aria-invalid'),
      disabled: node.hasAttribute('disabled') ? 'true' : node.getAttribute('aria-disabled'),
      current: node.getAttribute('aria-current'),
    }));
}

/**
 * The exact game slot keys a surface publishes to assistive technology.
 *
 * The keys are never visible text — the canvas draws `SIZE · NODE NO.` and
 * `FITTING · HARDPOINT 1` — so this reads them from where they actually live:
 * the `visually-hidden` identity beside the drawn label (reference review,
 * "Visible slot key, ruled 2026-08-21").
 */
export async function publishedSlotKeys(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot-key]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slot-key') ?? ''));
}

/**
 * Every mount the ledger holds, across the categories it is drawn in.
 *
 * `publishedSlotKeys` reads what is on the page, which at compact width is one
 * category of it: canvas 1d offers no `ALL` and draws one category at a time.
 * A claim about the *hull's* mounts rather than about this screenful walks the
 * categories, and puts back the one it started on so nothing downstream
 * inherits a tab it did not press.
 */
export async function everyPublishedSlotKey(page: Page): Promise<string[]> {
  const categories = page.locator('.outfitting__category');
  const total = await categories.count();
  if (total === 0) {
    return publishedSlotKeys(page);
  }

  const opened = await categories.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.getAttribute('aria-pressed') === 'true'),
  );
  const keys = new Set<string>();
  for (let index = 0; index < total; index += 1) {
    await categories.nth(index).click();
    await expect(categories.nth(index)).toHaveAttribute('aria-pressed', 'true');
    for (const key of await publishedSlotKeys(page)) {
      keys.add(key);
    }
  }
  if (opened >= 0) {
    await categories.nth(opened).click();
    await expect(categories.nth(opened)).toHaveAttribute('aria-pressed', 'true');
  }
  return [...keys];
}
