import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { settled } from './assertions';

/**
 * The tags scanned on every rendered state.
 *
 * WCAG A and AA through 2.2. No rule is disabled and no tag is dropped. One
 * rule is answered node by node rather than scanned away — `target-size` on a
 * schematic mount, which takes SC 2.5.8's own Equivalent exception; see
 * `EQUIVALENT_TARGETS` below. If a rule ever needs excluding, the verification
 * contract sets the bar: a versioned rule-to-criterion record from the
 * installed axe metadata, an automated assertion that every mapped criterion is
 * inside the constitution's excluded set, retained semantic
 * assertions, and no in-scope criterion lost along the way.
 */
export const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
] as const;

/**
 * The one rule result that is answered rather than fixed, and the one node it
 * is answered on.
 *
 * WCAG 2.2 SC 2.5.8 offers four ways to satisfy it, and axe can only check two
 * of them: the 24-pixel size minimum and the spacing exception. The hull
 * schematic's mount marks meet neither and cannot: the Almanac draws real
 * mounts closer together than 24 CSS pixels at the plate widths this screen has
 * room for, so a mark large enough to pass would sit on top of its neighbour
 * and take that mount out of reach entirely.
 *
 * They take the criterion's **Equivalent** exception instead — "a function can
 * be achieved through a different control on the same page that meets the
 * minimum". Feature 002's outfitting ledger is that control: it stands beside
 * the plates, carries every mount the plates draw as a row at least 24 CSS
 * pixels in both dimensions, and reaches every one of them without the
 * artwork.
 *
 * The exception is asserted, not asserted-to: `expectEquivalentControls` walks
 * the mounts actually drawn and fails if any of them has no row of at least 24
 * CSS pixels in both dimensions. The rule stays enabled for every other node on
 * every page, and a mount that ever stops having an equivalent fails there
 * rather than passing quietly here.
 */
const EQUIVALENT_TARGETS = { rule: 'target-size', selector: '.schematic__mount' } as const;

/**
 * Scans the current page and fails on any in-scope violation.
 *
 * The complete result is attached to the failure, because "3 violations" is not
 * something anyone can act on — the selectors, the failure summaries and the
 * help URLs are.
 *
 * An automated scan is a floor, not a ceiling: it cannot judge whether a name
 * is meaningful or whether a reading order makes sense. Those live in the named
 * assertions and the manual screen-reader protocols.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  testInfo: TestInfo,
  options: { label?: string } = {},
): Promise<void> {
  // Scanned once the surface has settled: a colour caught mid-transition is a
  // frame no one reads, and reporting it as a contrast failure would point at
  // the user-agent's defaults rather than at anything this project chose.
  await settled(page);

  const scanned = await test.step(`axe: ${options.label ?? 'scan'}`, () =>
    new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze());

  // Node by node, never rule by rule: a `target-size` result anywhere else on
  // the page is still a failure, and so is any other result on a mount. The
  // node is asked of the page rather than pattern-matched out of the selector
  // axe reports, which is written in whatever terms axe found shortest.
  const violations = [];
  for (const violation of scanned.violations) {
    if (violation.id !== EQUIVALENT_TARGETS.rule) {
      violations.push(violation);
      continue;
    }
    const nodes = [];
    for (const node of violation.nodes) {
      const selector = String(node.target.at(-1) ?? '');
      const exempt = await page.evaluate(
        ([one, mount]) => document.querySelector(one)?.matches(mount) === true,
        [selector, EQUIVALENT_TARGETS.selector],
      );
      if (!exempt) {
        nodes.push(node);
      }
    }
    if (nodes.length > 0) {
      violations.push({ ...violation, nodes });
    }
  }
  const results = { ...scanned, violations };

  if (results.violations.length > 0) {
    await testInfo.attach(`axe-${options.label ?? 'scan'}.json`, {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  }

  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));

  expect(summary, `axe violations${options.label ? ` in ${options.label}` : ''}`).toEqual([]);
}
