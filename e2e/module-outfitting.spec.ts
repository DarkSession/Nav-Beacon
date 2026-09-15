import { expect, test, type Locator, type Page } from '@playwright/test';
import germanMessages from '../src/app/i18n/locales/de.json';
import englishMessages from '../src/app/i18n/locales/en.json';
import { everyPublishedSlotKey, publishedSlotKeys, sweepOutfittingState } from './accessibility';
import {
  acrossEveryFamily,
  benchFollowedSelection,
  chooserOffered,
  editorOffered,
  familyControls,
  fitCommitted,
  manifestOf,
  openAllFamilies,
  openChooser,
  openChooserRows,
  openEditor,
  revealedRows,
  revealFamilyHolding,
  revealMount,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { DOUBLED_TEXT, withRootTextScale } from './accessibility/text-scale';
import { buildStockHull, regroupCoreMount, savedToBrowser } from './shell';

/**
 * Fitting modules, end to end (US1).
 *
 * The claim being checked is parity: what the ledger shows is what
 * `loadout.slots()` says is there, key for key, including the mounts a
 * Commander cannot change. Everything else in this file follows from that — a
 * fit, a replacement, a removal and a refusal are all checked by looking at the
 * ledger afterwards, because the ledger is the build.
 */

/** Creates a stock build and lands in the workspace with the ledger rendered. */
async function openStockBuild(
  page: Page,
  hull = 'Anaconda',
  create = englishMessages['hullDetail.create'],
): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, create);
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

/**
 * Selects one mount by its exact game slot key.
 *
 * Waits on the row's own pressed state rather than on the bench appearing. The
 * bench is already there when another mount is selected, so waiting for it
 * proves nothing and lets the next click land on a control that is still being
 * replaced.
 */
async function selectMount(page: Page, slotKey: string): Promise<void> {
  // Its category first: at compact width a mount nobody has asked for is not
  // on the page at all (`revealMount`).
  await revealMount(page, slotKey);
  const row = page.locator(`[data-slot-key="${slotKey}"] button`).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await benchFollowedSelection(page);
}

/**
 * What the ledger currently says is fitted in one mount.
 *
 * The whole identity, name and code line together, because a module name is not
 * unique: a build can carry four pulse lasers that differ only in their class
 * and rating, and comparing names alone would call a replacement a no-op.
 */
async function fittedIdentityAt(page: Page, slotKey: string): Promise<string | null> {
  return page.locator(`[data-slot-key="${slotKey}"]`).evaluate((node) => {
    const identity = node.querySelector('.identity');
    if (identity === null) {
      return null;
    }
    // The name and the code, as the row draws them. The ledger and the manifest
    // arrange an identity differently — the ledger writes `1D` where the
    // manifest writes it in its own `CLASS` column — so what is compared is the
    // module, not the arrangement.
    const clone = identity.cloneNode(true) as HTMLElement;
    // What is drawn and what is read, and nothing that is neither: the ellipsis
    // mark on a cut name is hidden from the accessibility tree and carries the
    // whole name as its tip, so leaving it in would put the name in twice.
    for (const hidden of clone.querySelectorAll('.visually-hidden, [aria-hidden="true"]')) {
      hidden.remove();
    }
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Asserts one mount now carries the module a chooser row read as.
 *
 * Token by token rather than string against string: the ledger and the manifest
 * arrange an identity differently — the manifest gives the class its own column
 * and the ledger writes it into the row's code line — so what is compared is
 * the module, not the arrangement.
 *
 * Polled rather than read once. `fitCommitted` waits on the chooser, and the
 * chooser and the ledger are rendered from the same signal but not in the same
 * frame — on a replacement the chooser's marked-and-fitted row is already there
 * from the fit before it, so the wait can pass with the ledger still one render
 * behind and a single read then compares the module that was replaced.
 */
async function expectLedgerCarries(page: Page, slotKey: string, identity: string): Promise<void> {
  const reading = async () => (await fittedIdentityAt(page, slotKey))?.toLowerCase() ?? '';
  for (const token of identity.split(/[·\s]+/).filter((part) => part.length > 1)) {
    await expect
      .poll(reading, { message: `${slotKey} does not read as ${identity}` })
      .toContain(token.toLowerCase());
  }
}

/** The text a sighted Commander actually reads, with hidden text removed. */
async function renderedText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    for (const hidden of clone.querySelectorAll('.visually-hidden')) {
      hidden.remove();
    }
    return clone.textContent ?? '';
  });
}

/**
 * Opens the chooser for the selected mount, picks one row and confirms.
 *
 * Returns what the chosen row read as, so a caller can assert the ledger now
 * says the same thing. The mount stays selected afterwards, which is what the
 * bench does after a fit — so a second call replaces rather than re-selecting.
 */
async function fitFromChooser(
  page: Page,
  pick: (identities: readonly string[]) => number,
): Promise<string> {
  await openChooserRows(page);
  const rows = page.locator('.candidate');
  await expect(rows.first()).toBeVisible();

  // The same reading the ledger gives: the module's name and mount, with the
  // class column folded in the way the ledger's own code line writes it.
  const identitiesNow = async (): Promise<readonly string[]> =>
    rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const drawn = (element: Element | null): string => {
          if (element === null) {
            return '';
          }
          // What a sighted Commander reads. The class cell also spells its code
          // out for anyone who cannot see it, and the ledger has no such line.
          const clone = element.cloneNode(true) as HTMLElement;
          for (const hidden of clone.querySelectorAll('.visually-hidden')) {
            hidden.remove();
          }
          return clone.textContent ?? '';
        };
        return `${drawn(node.querySelector('.candidate__name'))} ${drawn(
          node.querySelector('.candidate__class'),
        )}`
          .replace(/\s+/g, ' ')
          .trim();
      }),
    );

  // The rail draws one family's rows at a time, so a row the caller asked for
  // may be in a family it has not revealed yet. The families are walked until
  // the pick lands — which is what a Commander does, and is the only reading
  // the accordion needs no help with because it can have every family open.
  let identities = await identitiesNow();
  let index = pick(identities);
  if (index < 0 && (await manifestOf(page)) === 'rail') {
    const ids = await familyControls(page).evaluateAll((nodes) => nodes.map((node) => node.id));
    for (const id of ids) {
      const control = page.locator(`#${id}`);
      await expect(async () => {
        await control.click();
        await expect(control).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      identities = await identitiesNow();
      index = pick(identities);
      if (index >= 0) {
        break;
      }
    }
  }
  expect(index, 'no choice matched what the test asked for').toBeGreaterThan(-1);

  // The row is the control. Its radio is a 1px box underneath the label's own
  // content, so a pointer — a Commander's or this one's — lands on the label
  // and the label activates the radio, which is the whole reason the row is a
  // label. Reaching past it to click the input asserts an interaction nobody
  // performs, and Firefox refuses it outright.
  //
  // The module's name itself, not the row and not the identity block. A row's
  // centre falls in the gap between the identity and the figures, and the
  // identity block's own centre falls between its name and its code line once
  // the panel is narrow enough to wrap them; Firefox does not activate a label
  // from a click that lands on no content. The name is the one box in the row
  // that is always text.
  const row = rows.nth(index);
  await row.locator('.candidate__name').click();
  // Canvas 1c draws no confirm control: inline, taking the row is the fit.
  // Canvas 1d's chooser is a screen of its own, so leaving it is a decision.
  //
  // Which is why the pick is read only where one exists to read. An inline fit
  // commits on that click and the chooser reseeds around the module now in the
  // mount — every family but its own closes — so the row that was taken is no
  // longer at the index it was taken from, and there was never an intermediate
  // state there to assert. `fitCommitted` below is what proves the decision
  // landed at both widths.
  if (await surfacesAreLayers(page)) {
    await expect(row.locator('input[type="radio"]')).toBeChecked();
    await page.getByRole('button', { name: /fit module/i }).click();
  }
  // Waiting for the decision to have actually been taken, which each width
  // shows differently: a layer closes, an inline panel clears the pick.
  await fitCommitted(page);

  return identities[index] ?? '';
}

test.describe('the slot ledger', () => {
  test('renders every package mount by exact key, less the approach mount', async ({ page }) => {
    await openStockBuild(page);

    // Across the categories, not down this screenful: canvas 1d draws one
    // category at a time and the claim is about the hull's mounts.
    const keys = await everyPublishedSlotKey(page);

    // The Anaconda's own layout. Asserted against the game's spellings rather
    // than against a count, because a count would still pass if a mount were
    // rendered under the wrong key.
    expect(keys).toContain('HugeHardpoint1');
    expect(keys).toContain('Armour');
    expect(keys).toContain('PowerPlant');
    expect(keys).toContain('CargoHatch');
    expect(keys).toContain('Slot01_Size7');
    // Every hull has one planetary approach mount, the two suites it takes are
    // the same module in every published figure, and the ledger draws no row
    // for it (002/FR-002a).
    expect(keys).not.toContain('PlanetaryApproachSuite');
    // Every key is unique: two rows sharing one identity would be two views of
    // one mount, and an edit to either would be an edit to both.
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('closes the core internals with the cargo hatch, above the optional mounts', async ({
    page,
  }) => {
    await openStockBuild(page);

    // The package puts the hatch last of all. The ledger draws it where the
    // `CORE` category already lists it, so the complete list and the category
    // agree (002/FR-002a).
    //
    // The claim belongs to the complete list, which is the one place the two
    // could disagree: a category holds one kind, so `CORE` closes with the
    // hatch and `OPTIONAL` never held it whatever this rule says. Only the wide
    // composition draws `ALL`; the compact one offers no such list
    // (`design/outfitting-workspace.md`, "No `ALL` at compact width"), and
    // there what is left to say is that the hatch is under `CORE` and under
    // nothing else.
    const categories = page.locator('.outfitting__category');
    const all = categories.first();
    const wide = (await categories.count()) > 0 && (await all.innerText()).match(/all/i) !== null;

    if (wide) {
      await all.click();
      await expect(all).toHaveAttribute('aria-pressed', 'true');

      const keys = await publishedSlotKeys(page);
      expect(keys.indexOf('CargoHatch')).toBe(keys.indexOf('FuelTank') + 1);
      expect(keys.indexOf('CargoHatch')).toBeLessThan(keys.indexOf('Slot01_Size7'));
      return;
    }

    const drawn = await everyPublishedSlotKey(page);
    expect(drawn).toContain('CargoHatch');
    expect(drawn.indexOf('CargoHatch')).toBe(drawn.indexOf('FuelTank') + 1);
    expect(drawn.indexOf('CargoHatch')).toBeLessThan(drawn.indexOf('Slot01_Size7'));
  });

  test('never renders a game slot key as visible text', async ({ page }) => {
    await openStockBuild(page);

    const visible = await renderedText(page, '.outfitting__ledger');

    // The canvas draws `SIZE · NODE NO.`, not `Slot01_Size7`. The key stays the
    // identity and the assistive-technology text, and nothing else.
    expect(visible).not.toContain('Slot01_Size7');
    expect(visible).not.toContain('HugeHardpoint1');
    expect(visible).not.toContain('CargoHatch');
  });

  test('keeps empty removable mounts visible and selectable', async ({ page }) => {
    await openStockBuild(page);

    const empty = page.locator('[data-slot-key="MediumHardpoint1"]');
    await expect(empty).toContainText(/empty/i);
    await selectMount(page, 'MediumHardpoint1');

    expect(await chooserOffered(page)).toBe(true);
  });

  test('fits, replaces and removes a module, one decision at a time', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');

    // Fit.
    const first = await fitFromChooser(page, () => 0);
    await expect(page.locator('[data-slot-key="MediumHardpoint1"]')).not.toContainText(/empty/i);
    await expectLedgerCarries(page, 'MediumHardpoint1', first);

    // Replace. The choice is picked by what it reads as rather than by its
    // position, so the assertion cannot pass on two rows that happen to match.
    const second = await fitFromChooser(page, (identities) =>
      identities.findIndex((identity) => identity !== first),
    );
    expect(second).not.toBe(first);
    await expectLedgerCarries(page, 'MediumHardpoint1', second);

    // Remove. The mount empties and stays in the ledger to be fitted again.
    // The control is in the chooser's header, which is where canvas 1c draws
    // it — emptying a mount is part of choosing what goes in it.
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();
    await expect(page.locator('[data-slot-key="MediumHardpoint1"]')).toContainText(/empty/i);
  });

  test('empties a mount from its own row on the secondary button', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    const fitted = await fitFromChooser(page, () => 0);
    await expectLedgerCarries(page, 'MediumHardpoint1', fitted);

    // The row itself, not the chooser's control. It is a pointer shortcut for a
    // Commander clearing several mounts, and `REMOVE MODULE` is still the drawn
    // route (Commander request 2026-08-28).
    const row = page.locator('[data-slot-key="MediumHardpoint1"]');
    await row.click({ button: 'right' });
    await expect(row).toContainText(/empty/i);
  });

  test('leaves a mount the package will not empty alone on the secondary button', async ({
    page,
  }) => {
    await openStockBuild(page);
    await revealMount(page, 'PowerPlant');

    const row = page.locator('[data-slot-key="PowerPlant"]');
    const before = await fittedIdentityAt(page, 'PowerPlant');
    await row.click({ button: 'right' });

    // A required mount has no removal to shortcut to, so the row is unchanged.
    expect(await fittedIdentityAt(page, 'PowerPlant')).toBe(before);
  });

  /**
   * German, because English is where the names are shortest.
   *
   * The row is the stock Anaconda's own longest drawn name: `Slot14_Size1`,
   * which carries the supercruise assistant. The longer one belonged to the
   * planetary approach mount, and the ledger no longer draws that mount at all
   * (002/FR-002a).
   *
   * What these two assert is the branch a row that fits owes: the whole name
   * drawn, and **no** mark standing in for something that was not cut. Nothing
   * a stock build carries overflows the ledger at any of the five layout
   * profiles, at 100% text or at 200%. `expectTheWholeNameIsReachable` still
   * carries the other branch and still runs it the moment a row overflows again
   * — a longer name, a narrower profile, another hull — and until then the
   * cut-and-reach path is proved over the port, in
   * `outfitting-components.spec.ts`, where the overflow is declared rather than
   * waited for. Written down rather than left as two tests that pass while
   * measuring nothing.
   */
  test.describe('in German', () => {
    test.use({ locale: 'de-DE' });

    /** The mount whose name is the longest the stock Anaconda's ledger draws. */
    const LONGEST_NAMED_MOUNT = 'Slot14_Size1';

    /**
     * What the package calls that mount's module in the language under test.
     *
     * Asked of the installed Almanac rather than written down: the catalogue
     * names every module in each of its six languages, and a release that
     * renames one renames this expectation with it rather than leaving a stale
     * literal behind (constitution II). Imported dynamically because the
     * package is ESM-only and its `exports` map has no CommonJS entry for the
     * leaf subpath.
     */
    async function longestName(): Promise<string> {
      const catalogue = await import('@elite-dangerous-almanac/core/i18n/modules');
      const name = catalogue.getModuleName('Int_SupercruiseAssist', 'de');
      if (name === null) {
        throw new Error('The package names no supercruise assistant in German.');
      }
      return name;
    }

    /**
     * A row cuts a long name short; it never loses one.
     *
     * The rule the ledger keeps is stated as a choice rather than as an
     * outcome, because which of the two a row takes is the line's to decide: a
     * name that fits is simply drawn, and a name that does not is cut with an
     * ellipsis that is itself the control carrying the whole of it. What this
     * refuses is a third option — drawing part of a name and offering no way to
     * read the rest — which is what SC 1.4.4 is about and what `clippedText`
     * stops trusting the moment `data-text-reachable` appears on a row.
     *
     * It is also the only thing watching that, at every text size. `clippedText`
     * cannot be: the exemption that makes a cut acceptable is set by the same
     * rule that cuts, so a lapse would exempt the sweep from noticing itself.
     */
    async function expectTheWholeNameIsReachable(page: Page): Promise<void> {
      const name = await longestName();
      const row = await revealMount(page, LONGEST_NAMED_MOUNT);
      await expectLedgerCarries(page, LONGEST_NAMED_MOUNT, name);

      const mark = row.locator('.identity__more');
      const drawnWhole = await row
        .locator('.game-text__value')
        .first()
        .evaluate(
          (node) => (node as HTMLElement).scrollWidth - (node as HTMLElement).clientWidth <= 1,
        );
      if (drawnWhole) {
        // Nothing was cut, so nothing stands in for what was cut.
        await expect(mark).toHaveCount(0);
        await expect(row.locator('[data-text-reachable]')).toHaveCount(0);
        return;
      }

      await expect(mark).toHaveCount(1);
      await expect(mark.locator('.tooltip__tip')).toHaveText(name);
      // A thumb, which is the input a painted ellipsis has no answer for.
      await mark.click();
      const bubble = mark.locator('.tooltip__tip--shown');
      await expect(bubble).toBeVisible();

      // And painted where it is drawn. A bubble is hung off its trigger, so any
      // ancestor of that trigger which hides its overflow clips the bubble away
      // — leaving a box with a size and a position that nothing renders into,
      // which is exactly what `toBeVisible` reports as visible. Asked of the
      // document rather than of the element, at the middle of the bubble.
      const painted = await bubble.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const at = node.ownerDocument.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return at !== null && (at === node || node.contains(at));
      });
      expect(painted, 'the whole name is drawn where nothing paints it').toBe(true);
    }

    test('never loses a module name the row is too narrow to draw', async ({ page }) => {
      // The stock Anaconda's own longest drawn name. It fits at every profile —
      // see the block comment above for where the other branch is proved.
      await openStockBuild(page, 'Anaconda', germanMessages['hullDetail.create']);
      await expectTheWholeNameIsReachable(page);
    });

    test('keeps the whole name reachable at doubled text', async ({ page }) => {
      // Doubled text does not simply switch the cut off. The condition is the
      // line, asked as a container query in `em` — so a narrow rail wraps and
      // grows, while a rail that is still twenty characters wide at this size
      // goes on cutting, and owes the same reachable name for it.
      await withRootTextScale(page, DOUBLED_TEXT);
      await openStockBuild(page, 'Anaconda', germanMessages['hullDetail.create']);
      await expectTheWholeNameIsReachable(page);
    });
  });

  test('puts the caret in the search field on the key the hint names', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    await page.keyboard.press('Control+k');

    // The field the hint sits beside, and not the browser's address bar: the
    // combination is cancelled before the engine claims it.
    await expect(page.locator('.search__field input')).toBeFocused();
  });

  test('offers no removal on a required mount, and says why', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'PowerPlant');

    // A missing action with no reason reads as a defect. The Almanac's reason
    // is what makes it read as a rule of the game instead.
    await expect(page.locator('.outfitting__bench-reason')).toContainText(/required/i);
    // It stays replaceable, which is a different thing from removable — and the
    // chooser it stays replaceable through is where removal would have been.
    expect(await chooserOffered(page)).toBe(true);
    await openChooser(page);
    await expect(page.getByRole('button', { name: /remove module/i })).toHaveCount(0);
  });

  test('gives the cargo hatch its facts and no replacement or search', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'CargoHatch');

    expect(await chooserOffered(page)).toBe(false);
    await expect(page.getByRole('button', { name: /remove module/i })).toHaveCount(0);
    await expect(page.locator('.outfitting__bench-reason')).toContainText(/built in/i);
    // The hatch itself is still listed with its module, not hidden away.
    await expect(page.locator('[data-slot-key="CargoHatch"]')).toContainText(/cargo hatch/i);

    // The engineering panel is drawn and says the Almanac offers none, rather
    // than being left out of the bench (wave 9). Opened the way this width
    // offers it: inline it is already there, and at compact width it is a
    // screen reached from the action bar.
    expect(await editorOffered(page)).toBe(true);
    await openEditor(page);
    await expect(page.locator('.engineering__state')).toContainText(/no engineering/i);
  });

  test('stays editable while the build is incomplete', async ({ page }) => {
    await openStockBuild(page);

    // Emptying a mount leaves a build the Almanac calls incomplete. Every other
    // mount still offers everything it offered before.
    await selectMount(page, 'Slot03_Size6');
    await openChooser(page);
    await page.getByRole('button', { name: /remove module/i }).click();

    await selectMount(page, 'Slot02_Size6');
    expect(await chooserOffered(page)).toBe(true);
  });

  test('publishes only the exact game slot key as shared identity', async ({ page }) => {
    await openStockBuild(page);

    const keys = await publishedSlotKeys(page);

    // No positional index ever becomes an identity. The node number the canvas
    // draws is a label; nothing is selected or edited by it, which is why no
    // published identity is a bare ordinal (FR-002).
    for (const key of keys) {
      expect(key, 'a published identity is a bare position').not.toMatch(/^\d+$/);
    }

    // And the exact key is the *only* identity published. Feature 010's anatomy
    // exchanges mounts with this ledger, and the two have to agree on one
    // identity: a second attribute would be a second thing to disagree about.
    const identityAttributes = await page.locator('[data-slot-key]').evaluateAll((nodes) =>
      nodes.flatMap((node) =>
        [...node.attributes]
          .map((attribute) => attribute.name)
          // `data-selected` is drawn state, not identity: it says which row is
          // marked, and it names nothing.
          .filter(
            (name) =>
              name.startsWith('data-') && !['data-slot-key', 'data-selected'].includes(name),
          ),
      ),
    );
    expect([...new Set(identityAttributes)]).toEqual([]);

    // The node number the canvas draws is text on the row, never an identity.
    const nodes = await page
      .locator('.slot__node')
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((node) => /^\d+$/.test(node))).toBe(true);
  });

  test('opens the row already in the mount with the canvas\u2019s wash and marker', async ({
    page,
  }) => {
    // Canvas 1c marks the manifest row under `COST` with
    // `background: linear-gradient(90deg, var(--amber-a16), \u2026)` and
    // `border-left: 3px solid var(--amber)` \u2014 the ground and the opening line,
    // not amber ink alone. The shared row treatment keys on `[data-selected]`,
    // and a mount at rest has picked nothing, so its checked row is the module
    // it holds and carries all three.
    await openStockBuild(page);
    await fitFromChooser(page, () => 1);
    await openChooser(page);

    // No family is opened by hand here: the chooser seeds the fitted module's
    // own family open, so the row that was just fitted is on screen (FR-021).
    // Scoped to the rows inside a family: canvas 1d pins a second copy of the
    // fitted row above them, and that copy carries no control, so it is never
    // the checked row (`design/module-replacement.md`, "The fitted row and the
    // row in hand are two different marks").
    const fitted = page.locator('.candidates__choices .candidate--fitted').first();
    await expect(fitted).toBeVisible();
    await expect(fitted).toHaveAttribute('data-selected', 'true');

    const drawn = await fitted.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        wash: style.backgroundImage,
        marker: `${style.borderInlineStartWidth} ${style.borderInlineStartColor}`,
      };
    });
    expect(drawn.wash).toContain('linear-gradient');
    expect(drawn.wash).toContain('255, 140, 26');
    expect(drawn.marker).toBe('3px rgb(255, 140, 26)');
  });

  test('marks the row in the mount apart from the row the Commander picked', async ({ page }) => {
    // The reported case (Commander request 2026-08-31). A pick is not a fit
    // until it is committed, so pressing a second row left two rows carrying
    // the identical amber ground with nothing saying which was which. The amber
    // belongs to the checked row; what the mount already holds keeps the marker
    // and gives up the wash and the ink.
    //
    // At canvas 1c's width picking a row *is* the fit and the two are one row,
    // so the case only exists where the chooser is a layer with its own
    // `FIT MODULE`. The width is set here rather than left to the profile,
    // because a test that stood down on the profiles that cannot reach the case
    // would assert nothing on four of the five.
    await page.setViewportSize({ width: 390, height: 844 });
    await openStockBuild(page);
    await fitFromChooser(page, () => 1);
    await openChooser(page);

    const held = page.locator('.candidates__choices .candidate--fitted').first();
    const other = page.locator('.candidates__choices .candidate:not(.candidate--fitted)').first();
    await expect(other).toBeVisible();
    await other.click();

    // Two rows, two marks. The picked row is the checked one; the row the mount
    // holds is not, and there is exactly one of each.
    const picked = page.locator(".candidates__choices .candidate[data-selected='true']");
    await expect(picked).toHaveCount(1);
    await expect(picked).not.toHaveClass(/candidate--fitted/);
    await expect(held).not.toHaveAttribute('data-selected', 'true');

    // The amber wash and ink go with the pick; the mount keeps the marker.
    const marks = await held.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        wash: style.backgroundImage,
        marker: `${style.borderInlineStartWidth} ${style.borderInlineStartColor}`,
      };
    });
    expect(marks.wash).toBe('none');
    expect(marks.marker).toBe('3px rgb(255, 140, 26)');

    const washed = await picked.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(washed).toContain('linear-gradient');

    // And it is never the mark alone: the row says so in its own text.
    expect(await held.textContent()).toContain(englishMessages['outfitting.candidate.fitted']);

    // Canvas 1d's `FITTED HERE` copy above the families is a statement of what
    // is in the mount and carries no control, so it is never the checked row and
    // is drawn the same way as the row it copies: the marker, and no wash.
    const pinned = page.locator('.candidates__pinned .candidate').first();
    await expect(pinned).toBeVisible();
    await expect(pinned).toHaveClass(/candidate--fitted/);
    await expect(pinned.locator('.candidate__radio')).toHaveCount(0);
    expect(
      await pinned.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          wash: style.backgroundImage,
          marker: `${style.borderInlineStartWidth} ${style.borderInlineStartColor}`,
        };
      }),
    ).toEqual({ wash: 'none', marker: '3px rgb(255, 140, 26)' });
  });

  test('marks an empty mount as selected the same way it marks a fitted one', async ({ page }) => {
    // The canvas paints the node from its kind — dashed and withdrawn for
    // `empty`, amber for a fitted mount — but checks the selected branch first
    // and takes every kind: `color = on ? '#0b0b0c' : (util ? … : empty ? … )`.
    // Our empty rule matched at the same specificity and sat after the selected
    // one, so it won, and the one row a Commander is most often looking for was
    // the one row whose marker never said it was selected (wave 9).
    await openStockBuild(page);

    const ink = (key: string) =>
      page.locator(`[data-slot-key="${key}"] .slot__node`).evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.color} on ${style.backgroundColor}`;
      });

    // Only a hardpoint carries a node number, so both mounts are read off the
    // rows that actually draw one.
    const keyed = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate(
          (element) => element.closest('[data-slot-key]')?.getAttribute('data-slot-key') ?? '',
        );
    const empty = await keyed('.slot:has(.slot__node):has(.slot__empty)');
    const filled = await keyed('.slot:has(.slot__node):not(:has(.slot__empty))');
    expect(empty).not.toBe('');
    expect(filled).not.toBe('');

    await selectMount(page, filled);
    const marked = await ink(filled);
    expect(await ink(empty)).not.toBe(marked);

    await selectMount(page, empty);
    expect(await ink(empty)).toBe(marked);
  });

  test('is accessible in every rendered ledger state', async ({ page }, testInfo) => {
    await openStockBuild(page);
    await sweepOutfittingState(page, testInfo, 'ledger');

    await selectMount(page, 'CargoHatch');
    await sweepOutfittingState(page, testInfo, 'ledger/cargo-hatch selected');

    await selectMount(page, 'MediumHardpoint1');
    await openChooserRows(page);
    await expect(page.getByRole('radio').first()).toBeVisible();
    await sweepOutfittingState(page, testInfo, 'ledger/chooser open');
  });
});

/**
 * The pointer wash on the outfitting lists (Commander request 2026-08-31).
 *
 * Three of this feature's four lists are here — the ledger's mounts, the
 * fitting rail's categories and the module rows beside them; the fourth, the
 * experimental effect's options, is in `module-engineering.spec.ts` beside the
 * rest of that surface.
 *
 * Read as the ground actually computed under a pointer rather than as a rule
 * declared somewhere in the cascade. A declared rule is what was already there
 * for the rail's categories and never reached them: the rail gives every row a
 * ground of its own in a block written later, and the hover rule lost to it on
 * source order. Only the computed ground catches that.
 *
 * Where the profile reports no hovering pointer the claim is the other one, and
 * it is asserted rather than skipped: the wash is inside a `(hover: hover)`
 * query precisely so a touch device is offered nothing it cannot use
 * (011/FR-006, `design/outfitting-workspace.md`, "Pointer hover").
 *
 * The other four profiles are declared with touch as their primary input, and
 * an engine may answer `(hover: hover)` false for that reason. So the branch is
 * taken from the media query the page itself reports rather than from the
 * profile name, and each profile evidences whichever half of the rule it is in
 * a position to. In the runs measured so far that is the wash at desktop, on
 * the rail manifest, and the restraint at the other four under Chromium. The
 * accordion's families are drawn at those widths, so their wash may have no
 * profile to be measured in, and the rule they share with the rail is what the
 * stylesheet holds.
 */
test.describe('a pointer resting on a list', () => {
  /** Whether this profile has a pointer that can rest on anything at all. */
  async function canHover(page: Page): Promise<boolean> {
    return page.evaluate(() => window.matchMedia('(hover: hover)').matches);
  }

  /** The ground the row computes at rest, and the one it computes under a pointer. */
  async function groundsOf(row: Locator): Promise<{ resting: string; hovered: string }> {
    await expect(row).toBeVisible();
    const resting = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
    await row.hover();
    const hovered = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
    return { resting, hovered };
  }

  async function expectAnswersThePointer(page: Page, row: Locator): Promise<void> {
    const { resting, hovered } = await groundsOf(row);
    if (await canHover(page)) {
      expect(hovered).not.toBe(resting);
    } else {
      expect(hovered).toBe(resting);
    }
  }

  /** A row the wash must leave alone, whether or not this profile can hover. */
  async function expectKeepsItsOwnGround(row: Locator): Promise<void> {
    const { resting, hovered } = await groundsOf(row);
    expect(hovered).toBe(resting);
  }

  test('is answered by the ledger’s mounts, the categories and the module rows', async ({
    page,
  }) => {
    await openStockBuild(page);

    // An unchosen mount, measured on the row that carries the ground rather
    // than on the button inside it. The chosen row keeps its own ground, which
    // is the distinction the wash exists to preserve.
    await selectMount(page, 'SmallHardpoint1');
    await expectAnswersThePointer(page, page.locator('.slot:not([data-selected="true"])').first());

    await openChooser(page);

    // A category that is not the revealed one. At the rail this is the row that
    // was declared and never drawn; the revealed row keeps the gradient the
    // canvas marks it with, so it is not the row to ask.
    await expectAnswersThePointer(page, page.locator('.family:not([aria-pressed="true"])').first());

    // A module row that offers a choice.
    await expectAnswersThePointer(
      page,
      page.locator('.candidate:has(.candidate__radio):not([data-selected="true"])').first(),
    );

    // And the rows the wash must not touch, asserted rather than left out of
    // the locators above.
    //
    // The revealed category is the one of them a profile can actually prove:
    // it is drawn by the rail, the rail is the wide manifest, and the wide
    // width is the one profile with a hovering pointer. Delete the
    // `[aria-pressed='false']` from the rail's wash and this fails. The
    // `FITTED HERE` copy below is the other way round — it is drawn only at the
    // compact widths, and every one of those is a touch profile — so its check
    // states the claim without being able to press on it. It is written down
    // rather than left out, and the coverage ledger says which of the two is
    // measured.
    if ((await manifestOf(page)) === 'rail') {
      // The accordion marks an open family with its caret rather than with
      // `aria-pressed`, so the rail is where a pressed row exists to ask.
      await expectKeepsItsOwnGround(page.locator('.family[aria-pressed="true"]').first());
    }

    // Only canvas 1d draws the `FITTED HERE` copy; the wide composition passes
    // it no heading and draws none of it, so there is no such row to ask there.
    const pinned = page.locator('.candidates__pinned .candidate');
    if ((await pinned.count()) > 0) {
      await expectKeepsItsOwnGround(pinned.first());
    }
  });
});

test.describe('package-populated fixed mounts', () => {
  test('arrive fitted before any calculation is read, with no repair state', async ({ page }) => {
    await openStockBuild(page);

    // Every fixed mount carries a module. The application ran no repair pass —
    // this is what the package's own construction returned (FR-010).
    for (const key of ['Armour', 'PowerPlant', 'MainEngines', 'FrameShiftDrive', 'CargoHatch']) {
      await revealMount(page, key);
      await expect(page.locator(`[data-slot-key="${key}"]`), key).not.toContainText(/empty/i);
    }

    // The validation verdict is already published, which means the calculation
    // read happened after construction rather than before it. It is read as
    // state rather than as a banner: the canvas reports a problem and is silent
    // otherwise, so a healthy build draws nothing to look for.
    await expect(page.locator('ednb-build-workspace-page')).toHaveAttribute(
      'data-validation',
      /valid|incomplete|invalid/,
    );
  });

  test('carry no repair provenance into anything the build is saved or shared as', async ({
    page,
  }) => {
    await openStockBuild(page);
    // One decision on the build, so autosave has a record to write. A build
    // still at its hull's package default is stored nowhere (024/FR-001).
    await regroupCoreMount(page);
    await savedToBrowser(page);

    const stored = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('ednb:record:'))
        .map((key) => localStorage.getItem(key) ?? '')
        .join('\n'),
    );

    expect(stored.length).toBeGreaterThan(0);
    // A defaulted mount is ordinary build state. Nothing records that it was
    // defaulted, because there is nothing for a Commander to decide about it.
    expect(stored).not.toContain('defaulted');
    expect(stored).not.toContain('repair');
    expect(stored).not.toContain('sourceSymbol');
    expect(page.url()).not.toContain('defaulted');
  });
});

/**
 * Finding a replacement, end to end (US2).
 *
 * The chooser's order and its four-field search are proved against the package
 * in `candidate-query.spec.ts`. What is checked here is that a Commander
 * actually gets them: that the sections are announced, that a term with the
 * wrong case still finds the module, that nothing matched is a sentence rather
 * than a blank region, and that the list is read again after a fit instead of
 * being remembered.
 */

/** The number the surface draws beside the search — canvas 1d's `24 FIT`. */
async function drawnCount(page: Page): Promise<number> {
  // Canvas 1d draws the count in its screen's header; canvas 1c draws none at
  // all, and the figure is spoken instead. Either way it is one figure, read
  // from wherever this width keeps it (wave 4).
  const text = await page
    .locator('.replacement__count, ednb-candidate-search [role="status"]')
    .first()
    .innerText();
  return Number(text.replace(/\D+/gu, ''));
}

async function search(page: Page, query: string): Promise<void> {
  await page.locator('input[type="search"]').fill(query);
}

/**
 * The published count, once the search that provoked it has actually settled.
 *
 * `fill` ends the typing, not the search. The surface republishes its figure a
 * beat later, so a bare read taken straight afterwards returns the answer to
 * the *previous* query — the whole list, where a narrowing search was just
 * typed. Every other caller in this file asserts through a retrying locator and
 * never meets it; this one compares two numbers and does, which is how a run
 * once read 349 against 2 and called it a regression.
 *
 * Narrowing is the settle condition rather than a pause, because it is the
 * thing being waited for: a search that has been applied publishes fewer
 * choices than the unfiltered list it was typed into.
 */
async function narrowedCount(page: Page, unfiltered: number): Promise<number> {
  await expect.poll(() => drawnCount(page)).toBeLessThan(unfiltered);
  return drawnCount(page);
}

test.describe('finding a replacement', () => {
  test('offers every choice the Almanac has for the mount, and says how many', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'SmallHardpoint1');
    // The count the surface publishes is the whole list; what is in the
    // document is whatever families are revealed. The accordion can reveal them
    // all at once and the rail draws one family at a time, so the rows are
    // gathered family by family — which is how "every choice" is checked at
    // either width (SC-006).
    await openChooser(page);

    const drawn = await drawnCount(page);
    // The families' own rows. The compact composition draws canvas 1d's
    // `FITTED HERE` block above them, which is the fitted row a second time —
    // a duplicate of a row already counted, not another choice.
    const seen = new Set<string>();
    await acrossEveryFamily(page, async (rows) => {
      for (const key of await rows.evaluateAll((nodes) =>
        nodes.flatMap((node) =>
          Array.from(node.querySelectorAll('input[type="radio"]')).map(
            (radio) => (radio as HTMLInputElement).value,
          ),
        ),
      )) {
        seen.add(key);
      }
    });

    // The count is the list, not a separate claim about it.
    expect(seen.size).toBe(drawn);
    expect(drawn).toBeGreaterThan(1);

    // The expansion is stock records *plus* their pre-engineered variants, so a
    // list that offered only stock rows would be missing a whole kind of choice.
    await expect(page.getByText('Pre-engineered', { exact: true }).first()).toBeVisible();
  });

  test('renders the whole expansion, so the scroller knows how tall it is', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    // Whatever is open is whole: no paging and no growing window. Families
    // change how much is open at once, not whether what is open is complete
    // (module-replacement design, wave 10).
    await openChooserRows(page);

    // Every choice of every revealed family, in the document, from the first
    // frame. A list that grew as it was reached could not tell the browser how
    // tall it was, so its bar shrank under the Commander every time it grew
    // (wave 4). What is revealed differs by manifest — all of them under the
    // accordion, one family under the rail — so the claim is about the rows
    // that *are* revealed rather than about a total.
    const revealed = await revealedRows(page).count();
    expect(revealed).toBeGreaterThan(0);

    // The manifest's own scroller, under the column head rather than around it:
    // the accordion's single body, or the rail's variant pane.
    const scroller = page.locator('.candidates__body, .candidates__pane').first();
    // Read once the fonts and the row images have settled. What this test is
    // about is the scroller's height not moving *as the list is reached* — a
    // figure read while a webfont is still swapping in moves for a reason that
    // has nothing to do with how the manifest is rendered.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images]
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }),
          ),
      );
    });
    const before = await scroller.evaluate((node) => node.scrollHeight);
    await scroller.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await expect(revealedRows(page)).toHaveCount(revealed);
    expect(await scroller.evaluate((node) => node.scrollHeight)).toBe(before);
  });

  test('groups every choice into one Almanac family, in the package\u2019s order', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, 'SmallHardpoint1');
    await openChooser(page);

    const controls = page.locator('.family');
    const families = await controls.count();
    expect(families).toBeGreaterThan(1);

    // Every row belongs to exactly one family's region, and every row the
    // surface counted is in one of them (FR-020, SC-006). Counted family by
    // family, because the rail reveals one at a time and the accordion can
    // reveal them all — the claim is the same, and only the walking differs.
    const drawn = await drawnCount(page);
    let grouped = 0;
    await acrossEveryFamily(page, async (rows) => {
      grouped += await rows.count();
    });
    expect(grouped).toBe(drawn);

    // Nothing is drawn outside a family except canvas 1d's `FITTED HERE` block,
    // which the compact composition pins above the list and the wide one does
    // not draw at all. Counted against what is revealed *now*, which is the
    // whole list under the accordion and the last family the walk selected
    // under the rail.
    const pinned = await page.locator('.candidates__pinned .candidate').count();
    expect(await page.locator('.candidate').count()).toBe(
      (await revealedRows(page).count()) + pinned,
    );

    // The sections are gone with their headings, and nothing replaced them.
    await expect(page.locator('.candidates__section, .candidates__group')).toHaveCount(0);
    expect(await renderedText(page, '.candidates')).not.toMatch(/standard modules/i);
  });

  test('keeps a unique reward\u2019s labels on its own row, inside its family', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, 'SmallHardpoint1');
    await revealFamilyHolding(page, /not sold anywhere/i);

    // Canvas 1c marks the reward on the row itself, directly under the ordinary
    // article it is built on — so the heading that used to carry that fact has
    // nothing left to say (FR-024). The mark is the icon of the route the
    // article is earned through, and the sentence beside it is what a reader
    // gets, so the row is found by the sentence rather than by the picture.
    const reward = page
      .locator('.candidate')
      .filter({ hasText: /not sold anywhere/i })
      .first();
    await expect(reward).toBeVisible();
    await expect(reward.locator('.acquisition__route')).toHaveCount(1);

    // It sits inside a family, and inside the same family as its base module.
    const family = reward.locator('xpath=ancestor::*[contains(@class, "candidates__choices")]');
    await expect(family).toHaveCount(1);

    const rewardName = (await reward.locator('.candidate__name').innerText())
      .split('·')[0]!
      .trim()
      .toLowerCase();
    const siblings = await family
      .locator('.candidate__name')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.toLowerCase() ?? ''));
    expect(siblings.filter((name) => name.includes(rewardName)).length).toBeGreaterThan(1);
  });

  test('draws a route mark\u2019s gloss where it can actually be seen', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'SmallHardpoint1');
    await revealFamilyHolding(page, /not sold anywhere/i);

    const gloss = page
      .locator('.candidate')
      .filter({ hasText: /not sold anywhere/i })
      .first()
      .locator('ednb-tooltip')
      .first();
    await expect(gloss).toHaveCount(1);

    await gloss.locator('.tooltip__trigger').hover();
    const bubble = gloss.locator('.tooltip__tip');
    await expect(bubble).toHaveClass(/tooltip__tip--shown/);

    /*
     * Painted, and painted whole.
     *
     * `toBeVisible` cannot say this: it reports a box with a size and a
     * position, and a manifest row is three boxes that cut their content —
     * `content-visibility: auto` on the row is paint containment, the identity
     * cell hides its overflow to cut a long name, and the pane is a scroller.
     * Drawn in place the bubble had a size, a position, a `z-index` and not one
     * pixel on the screen (Commander request 2026-08-29).
     *
     * Three points across it rather than one, because the three boxes cut it in
     * different directions: the row's containment took the whole bubble, and
     * the pane's edge took only the end of a mark drawn in the `COST` column.
     */
    const painted = await bubble.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const edge = node.ownerDocument.documentElement;
      return {
        inside:
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= edge.clientWidth &&
          box.bottom <= edge.clientHeight,
        drawn: [box.left + 2, box.left + box.width / 2, box.right - 2].map((x) => {
          const at = node.ownerDocument.elementFromPoint(x, middle);
          return at !== null && (at === node || node.contains(at));
        }),
      };
    });
    expect(painted.drawn).toEqual([true, true, true]);
    expect(painted.inside).toBe(true);
  });

  test('matches every term, whatever case or accents it is typed in', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    // Two terms across two different indexed fields: the module's name and its
    // mount type. Both have to match, and neither is typed the way it is drawn.
    await search(page, 'MULTI-CANNON gimballed');
    await expect(page.locator('.candidate').first()).toBeVisible();

    const identities = await page
      .locator('.candidate .candidate__identity')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));

    expect(identities.length).toBeGreaterThan(0);
    for (const identity of identities) {
      expect(identity.toLowerCase()).toContain('multi-cannon');
      expect(identity.toLowerCase()).toContain('gimballed');
    }
  });

  test('never matches a package symbol, however exactly it is typed', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    await search(page, 'Hpt_MultiCannon_Gimbal_Medium');

    // The symbol is the identity a fit is carried out with; it is not something
    // a Commander searches by, and a search that quietly matched it would find
    // rows whose visible text does not contain the query.
    await expect(page.locator('.replacement__no-matches')).toBeVisible();
  });

  test('explains a search that found nothing, and clears back to the whole list', async ({
    page,
  }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);

    const all = await drawnCount(page);

    await search(page, 'zzzz nothing');
    await expect(page.locator('.replacement__no-matches')).toContainText(/zzzz nothing/);
    await expect(page.locator('.candidate')).toHaveCount(0);
    // Nothing matched, so no family is drawn either: a control standing in
    // front of nothing is exactly what absence prevents (FR-023).
    await expect(page.locator('.family')).toHaveCount(0);

    // The way back is the mark inside the search field: the dedicated CLEAR
    // button beside the no-match notice is withdrawn.
    await page.locator('.search__clear').click();
    await expect(page.locator('.family').first()).toBeVisible();
    expect(await drawnCount(page)).toBe(all);
  });

  test('reads the list again after a fit rather than remembering it', async ({ page }) => {
    await openStockBuild(page);

    // A docking computer is one of the Almanac's exclusive families: fitting one
    // takes the rest of that family out of every other optional mount.
    await selectMount(page, 'Slot02_Size6');
    await openChooser(page);
    // Compared on the count the surface publishes rather than on the rows in the
    // document. What the two manifests draw differs by design — the accordion
    // opens every family a narrow search matched, the rail draws the first of
    // them — but both are counting the same answer from the package, and it is
    // the answer this test is about.
    const everything = await drawnCount(page);
    await search(page, 'docking computer');
    const before = await narrowedCount(page, everything);
    expect(before).toBeGreaterThan(0);
    if (await surfacesAreLayers(page)) {
      await page.getByRole('button', { name: /cancel/i }).click();
    }

    await selectMount(page, 'Slot01_Size7');
    await fitFromChooser(page, (identities) =>
      identities.findIndex((identity) => /docking computer/i.test(identity)),
    );

    await selectMount(page, 'Slot02_Size6');
    await openChooser(page);
    const everythingLeft = await drawnCount(page);
    await search(page, 'docking computer');

    // Fewer, because the Almanac now says so. Nothing here knows what an
    // exclusive family is; it asked again and rendered the answer.
    expect(await narrowedCount(page, everythingLeft)).toBeLessThan(before);
  });

  test('is accessible in every chooser state', async ({ page }, testInfo) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');
    await openChooser(page);
    await sweepOutfittingState(page, testInfo, 'chooser/families closed');

    await openAllFamilies(page);
    await sweepOutfittingState(page, testInfo, 'chooser/full');

    await search(page, 'multi');
    await expect(page.locator('.candidate').first()).toBeVisible();
    await sweepOutfittingState(page, testInfo, 'chooser/searched');

    await search(page, 'zzzz nothing');
    await expect(page.locator('.replacement__no-matches')).toBeVisible();
    await sweepOutfittingState(page, testInfo, 'chooser/no matches');

    if (await surfacesAreLayers(page)) {
      await page.getByRole('button', { name: /cancel/i }).click();
    }
    await selectMount(page, 'CargoHatch');
    await sweepOutfittingState(page, testInfo, 'chooser/mount takes nothing');
  });
});

test.describe('power and the cargo hatch', () => {
  test('offers power on the cargo hatch and nothing else, with the reason', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'CargoHatch');

    const hatch = page.locator('[data-slot-key="CargoHatch"]');
    await expect(hatch.locator('.power__toggle')).toHaveCount(1);
    await expect(hatch.locator('.power__priority')).toHaveCount(1);

    // Replace, search and remove are all absent — and the Almanac's reason for
    // that is published on the bench, because an action missing without a
    // reason reads as a defect (FR-009). Engineering is the one region that
    // stays: it is drawn and says the Almanac offers none (wave 9).
    expect(await chooserOffered(page)).toBe(false);
    await expect(page.getByRole('button', { name: /remove module/i })).toHaveCount(0);
    await expect(page.locator('.outfitting__bench-reason')).toContainText(/built in/i);

    await openEditor(page);
    await expect(page.locator('.engineering__state')).toContainText(/no engineering/i);
  });

  test('presents the package’s five groups one-based, as the game does', async ({ page }) => {
    await openStockBuild(page);

    await revealMount(page, 'FrameShiftDrive');
    const options = page.locator('[data-slot-key="FrameShiftDrive"] .power__priority option');

    // Five, and no sixth place for an unstated group. The chip used to hold a
    // disabled `—` for a module whose source named no group; it now draws the
    // package's own default for that case, which is group 1 — the group
    // `powerBudget()` had already put the module in and the group the power
    // panel beside it lists and sheds (ruled 2026-08-26, `power-controls.ts`).
    await expect(options).toHaveCount(5);

    // The five the package publishes, as bare numbers: the reference draws a
    // number in the chip and no word beside it.
    await expect(options.first()).toHaveText('1');
    await expect(options.first()).toHaveAttribute('value', '0');
    await expect(options.first()).toBeEnabled();
    await expect(options.last()).toHaveText('5');
    await expect(options.last()).toHaveAttribute('value', '4');

    // A stock build states no group, and the chip stands in the one the rest of
    // the application already has it in rather than in a blank.
    await expect(page.locator('[data-slot-key="FrameShiftDrive"] .power__priority')).toHaveValue(
      '0',
    );
  });

  test('leaves a module fitted when its power changes', async ({ page }) => {
    await openStockBuild(page);
    await revealMount(page, 'FrameShiftDrive');
    const before = await fittedIdentityAt(page, 'FrameShiftDrive');

    // By value, explicitly. Every option's label is now a number too, and a
    // bare string matches whichever comes first — which is the option one group
    // below the one this test means.
    await page
      .locator('[data-slot-key="FrameShiftDrive"] .power__priority')
      .selectOption({ value: '2' });

    // Still fitted, so its mass and its catalogue cost are still in the build
    // (contract, "Power and recalculation").
    expect(await fittedIdentityAt(page, 'FrameShiftDrive')).toBe(before);
    await expect(page.locator('[data-slot-key="FrameShiftDrive"] .power__priority')).toHaveValue(
      '2',
    );
  });

  test('switches a module off without unfitting it', async ({ page }) => {
    await openStockBuild(page);
    const before = await fittedIdentityAt(page, 'SmallHardpoint1');
    const mount = page.locator('[data-slot-key="SmallHardpoint1"]');
    const toggle = mount.locator('.power__toggle');

    // An absent power field reads as on, which is how the package treats it.
    await expect(toggle).toBeChecked();
    // The label is the control. Its checkbox is a hidden box under the drawn
    // track, so a pointer — a Commander's or this one's — lands on the label,
    // which is the whole reason the switch is one.
    await mount.locator('.power__switch').click();

    await expect(toggle).not.toBeChecked();
    expect(await fittedIdentityAt(page, 'SmallHardpoint1')).toBe(before);
  });

  test('names both power controls by module and mount', async ({ page }) => {
    await openStockBuild(page);

    // Forty rows of the same two controls: "powered" on its own says nothing
    // about which module a reader is on.
    await revealMount(page, 'FrameShiftDrive');
    const toggle = page.locator('[data-slot-key="FrameShiftDrive"] .power__toggle');
    await expect(toggle).toHaveAttribute('aria-label', /frame shift drive/i);
    await expect(toggle).toHaveAttribute('aria-label', /core internals/i);
  });

  test('keeps a mount\u2019s power group and off state through a replacement', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'MediumHardpoint1');

    const first = await fitFromChooser(page, () => 0);
    const mount = page.locator('[data-slot-key="MediumHardpoint1"]');

    // Two decisions about this mount: which group it sheds in, and that it is
    // off right now.
    await mount.locator('.power__priority').selectOption({ value: '3' });
    await mount.locator('.power__switch').click();
    await expect(mount.locator('.power__toggle')).not.toBeChecked();

    // A size upgrade is not a reason to undo either of them. The package resets
    // `On` and `Priority` on every fit and says to set them again where a
    // screen keeps a group across a swap; this one does, because the group is
    // the mount's rather than the article's (FR-015, SC-003a).
    const second = await fitFromChooser(page, (identities) =>
      identities.findIndex((identity) => identity !== first),
    );
    expect(second).not.toBe(first);
    await expectLedgerCarries(page, 'MediumHardpoint1', second);

    await expect(mount.locator('.power__priority')).toHaveValue('3');
    await expect(mount.locator('.power__toggle')).not.toBeChecked();
  });

  test('draws no power group on a module the Almanac prices at no power', async ({ page }) => {
    await openStockBuild(page);

    // Armour draws nothing and the power plant is what everything else draws
    // from. Neither has power to group, and the canvas draws no chip on one
    // (wave 4).
    await revealMount(page, 'Armour');
    await expect(page.locator('[data-slot-key="Armour"] ednb-power-controls')).toHaveCount(0);
    await expect(page.locator('[data-slot-key="PowerPlant"] ednb-power-controls')).toHaveCount(0);
    await expect(page.locator('[data-slot-key="FrameShiftDrive"] ednb-power-controls')).toHaveCount(
      1,
    );
  });
});
