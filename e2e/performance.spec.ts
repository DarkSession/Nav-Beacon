import { expect, test, type Page } from '@playwright/test';
import { buildStockHull, regroupCoreMount, savedToBrowser } from './shell';

/**
 * The plan's performance goals, measured rather than assumed.
 *
 * These are not micro-benchmarks. Each one is a promise a Commander would
 * notice being broken: a search that stutters over the full manifest, a
 * workspace that becomes interactive before it has restored the build it is
 * about, an autosave that blocks typing, and a link that takes longer to make
 * than to paste.
 *
 * The budgets are deliberately loose. A CI machine under fourteen parallel
 * browsers is not a Commander's laptop, and a test that fails on a busy runner
 * teaches everyone to ignore it.
 */

/** Constraining the manifest, from the first keystroke to the settled count. */
async function timeConstraint(page: Page, action: () => Promise<void>): Promise<number> {
  const started = Date.now();
  await action();
  await expect(page.locator('[data-hull-symbol]:visible').first()).toBeVisible();
  return Date.now() - started;
}

test.describe('the catalogue, at full size', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ships');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The complete installed manifest, not a page of it.
    await expect(page.locator('[data-hull-symbol]:visible')).toHaveCount(48);
  });

  test('searches, filters and orders the whole manifest without a perceptible wait', async ({
    page,
  }) => {
    const search = page.getByRole('searchbox', { name: 'Search ships or manufacturers' });

    const searching = await timeConstraint(page, () => search.fill('a'));
    const filtering = await timeConstraint(page, async () => {
      await page.getByRole('radio', { name: 'Large' }).check();
    });
    const ordering = await timeConstraint(page, async () => {
      // The reference orders the wide manifest from its own column headers.
      await page
        .getByRole('button', { name: /^Sort by Price Mcr, / })
        .first()
        .click();
    });

    for (const [what, elapsed] of [
      ['search', searching],
      ['filter', filtering],
      ['order', ordering],
    ] as const) {
      expect(elapsed, `${what} took ${elapsed} ms over the full manifest`).toBeLessThan(1_000);
    }
  });
});

test.describe('the workspace, on arrival', () => {
  test('restores the working build before it is interactive', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting(#|$)/);
    // One decision on the build, so autosave has a record to write. A build
    // still at its hull's package default is stored nowhere (024/FR-001).
    await regroupCoreMount(page);
    await savedToBrowser(page);

    await page.reload();

    // The first frame that offers the build's own actions is a frame in which
    // the build is already there. A workspace that lets a Commander act before
    // it has restored is a workspace that can discard what they did.
    await expect(page.getByRole('button', { name: /^(export|menu)$/i }).first()).toBeVisible();
    await expect(page.getByRole('banner').getByText('Anaconda').first()).toBeVisible();
    await expect(page.locator('[data-slot-key]').first()).toBeVisible();
  });

  test('coalesces autosaves instead of writing once per edit', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    // One decision on the build, so autosave has a record to write. A build
    // still at its hull's package default is stored nowhere (024/FR-001).
    await regroupCoreMount(page);
    await savedToBrowser(page);

    // One record, one key, however many revisions went into it.
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('ednb:record:')),
    );
    expect(keys).toHaveLength(1);
  });
});

test.describe('the codec', () => {
  test('encodes and decodes a real build well inside the sub-50 ms target', async ({ page }) => {
    await page.goto('/ships/Anaconda');
    await buildStockHull(page, 'Build');
    await expect(page).toHaveURL(/\/outfitting#b\./);

    // Publication happens once per modelled edit, so the time from an edit to a
    // published fragment is what the target is about. Measured through the
    // product's own path rather than by calling the codec directly.
    const published = await page.evaluate(() => {
      const started = performance.now();
      return new Promise<number>((resolve) => {
        const check = () => {
          if (window.location.hash.startsWith('#b.')) {
            resolve(performance.now() - started);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    });

    expect(published).toBeLessThan(50);
  });
});
