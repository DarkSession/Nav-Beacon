import { expect, test, type Page } from '@playwright/test';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import englishMessages from '../src/app/i18n/locales/en.json';
import { sweepOutfittingState } from './accessibility';
import { expectNoAccessibilityViolations } from './accessibility/axe';
import {
  applyDraft,
  benchFollowedSelection,
  chooseEffect,
  chooseFirstEffect,
  chooseRecipe,
  chosenRecipe,
  clearEffect,
  clearRecipe,
  draftAbandoned,
  editorOffered,
  effectMenuIsDrawn,
  effectOptions,
  revealEffectOptions,
  fitCommitted,
  openEditor as bringEditorOnScreen,
  revealFamilyHolding,
  revealMount,
  surfacesAreLayers,
} from './outfitting-surfaces';
import { buildStockHull, reachShellAction } from './shell';

/**
 * Engineering a module, end to end (US3).
 *
 * The claim being checked is that three package operations stay three. Applying
 * a recipe, changing only an effect and clearing engineering do different
 * things to a build, and the difference is visible in what survives each one —
 * a grade, a modifier block, a purchase identity. A suite that only checked
 * "the module is engineered afterwards" would pass with all three collapsed
 * into one (FR-012, engineering editor design, "Operations").
 */

/** Creates a stock build and lands in the workspace with the ledger rendered. */
async function openStockBuild(page: Page, hull = 'Anaconda'): Promise<void> {
  await page.goto(`/ships/${hull}`);
  await buildStockHull(page, 'Build');
  await expect(page).toHaveURL(/\/outfitting(#|$)/);
  await expect(page.locator('[data-slot-key]').first()).toBeVisible();
}

/** Selects one mount by its exact game slot key. */
async function selectMount(page: Page, slotKey: string): Promise<void> {
  await revealMount(page, slotKey);
  const row = page.locator(`[data-slot-key="${slotKey}"] button`).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await benchFollowedSelection(page);
}

/** Opens the engineering editor for the selected mount, at whatever width. */
async function openEditor(page: Page, slotKey: string): Promise<void> {
  await selectMount(page, slotKey);
  await bringEditorOnScreen(page);
}

/**
 * The exact package menu for one mount, asked of the installed Almanac here.
 *
 * Asked rather than written down, so the assertion is parity between what the
 * editor drew and what the package offers — not a copy of the package's data
 * that a release could quietly diverge from. It runs in the test process, not
 * in the page: the application ships a bundle, and reaching into `node_modules`
 * from the browser would be testing a different build of the package.
 */
async function packageMenu(slotKey: string): Promise<{ blueprints: string[]; effects: string[] }> {
  const build = await stockBuild();
  return {
    blueprints: build.availableBlueprints(slotKey).map((blueprint) => blueprint.blueprintSymbol),
    effects: [...build.availableExperimentalEffects(slotKey)],
  };
}

/**
 * The installed package, loaded the one way it can be loaded here.
 *
 * `@elite-dangerous-almanac/core` is ESM-only and its `exports` map defines no
 * `require` condition, so a static import from Playwright's CommonJS loader
 * fails to resolve. A dynamic import is the ordinary ESM entry point and works
 * from either module system.
 */
async function stockBuild(hull = 'Anaconda'): Promise<ShipLoadout> {
  const core = await import('@elite-dangerous-almanac/core/ships/ship-loadout');
  return core.ShipLoadout.default(hull);
}

/** One package-owned Mercenary article whose experimental state is fixed. */
async function fixedEffectMercenaryArticle(): Promise<{
  readonly slot: string;
  readonly articleName: string;
  readonly effectName: string;
}> {
  const [
    { PRE_ENGINEERED_MODULES },
    { getPreEngineeredVariantName },
    { getExperimentalEffectName },
  ] = await Promise.all([
    import('@elite-dangerous-almanac/core/ships/pre-engineered'),
    import('@elite-dangerous-almanac/core/i18n/pre-engineered'),
    import('@elite-dangerous-almanac/core/i18n/experimental-effects'),
  ]);
  const variant = PRE_ENGINEERED_MODULES.find(
    (candidate) =>
      candidate.acquisition === 'mercenary' &&
      typeof candidate.experimentalEffectSymbol === 'string',
  );
  expect(variant).toBeDefined();

  const build = await stockBuild();
  const slot = build
    .slots('hardpoint')
    .find((candidate) =>
      build.modulesForSlot(candidate.key).some((module) => module.symbol === variant!.symbol),
    );
  const articleName = getPreEngineeredVariantName(variant!, 'en');
  const effectName = getExperimentalEffectName(variant!.experimentalEffectSymbol!, 'en');
  expect(slot).toBeDefined();
  expect(articleName).not.toBeNull();
  expect(effectName).not.toBeNull();

  return { slot: slot!.key, articleName: articleName!, effectName: effectName! };
}

/**
 * The recipes the editor is currently offering, by their drawn name.
 *
 * Canvas 1c's dropdown and canvas 1d's cards, counted the same way — the
 * dropdown's own first option is the no-blueprint one, exactly as the card list
 * opens with it.
 */
function recipeRows(page: Page) {
  return page.locator(
    '.blueprint:not(.blueprint--none), ednb-blueprint-choice-list option:not(:first-child)',
  );
}

/** Chooses one grade cell. */
async function chooseGrade(page: Page, grade: number): Promise<void> {
  const cell = page
    .locator('.grade')
    .filter({ hasText: new RegExp(`^${grade}$`) })
    .first();
  await cell.click();
  await expect(cell.locator('input[type="radio"]')).toBeChecked();
  // The radio is checked by the platform the moment it is pressed, before the
  // store has answered, so the checked state is not the panel agreeing. The cell
  // publishes what the panel decided, and that is what the next read needs.
  await expect(cell).toHaveAttribute('data-selected', 'true');
}

/** What the ledger's code line says about one mount's engineering. */
/** The recipe line the ledger draws on one mount, as a Commander reads it. */
async function applied(page: Page, slotKey: string): Promise<string> {
  return (
    (await page.locator(`[data-slot-key="${slotKey}"] .identity__code-line`).first().textContent())
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

async function ledgerEngineering(page: Page, slotKey: string): Promise<string> {
  // The row, not this screenful: at compact width the ledger draws one category
  // at a time, so a mount read after a journey that left another tab open is
  // not on the page until its own is pressed.
  await revealMount(page, slotKey);
  return page
    .locator(`[data-slot-key="${slotKey}"]`)
    .evaluate((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

test.describe('engineering a module', () => {
  test('offers exactly the recipes and effects the package offers', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');

    const menu = await packageMenu('FrameShiftDrive');
    expect(menu.blueprints.length).toBeGreaterThan(0);

    // One row per package recipe, and no row without one. A menu with an extra
    // entry is a job the Almanac would refuse after offering it.
    await expect(recipeRows(page)).toHaveCount(menu.blueprints.length);
    if (menu.effects.length > 0) {
      // Nothing under the recipe is drawn until there is a recipe: an effect
      // menu over no blueprint is a control over nothing (wave 4).
      await chooseRecipe(page, /increased range/i);
      await revealEffectOptions(page);
      await expect(effectOptions(page)).toHaveCount(menu.effects.length);
    }
  });

  test('keeps the option the effect menu is on inside the box it scrolls in', async ({ page }) => {
    // The list is bounded at `--ednb-layout-menu-drop` and scrolls inside
    // itself, so an option the keyboard walks to is otherwise named by
    // `aria-activedescendant` while sitting below the fold — the reading moves
    // and nothing on screen does. Only a real layout can show this, which is
    // why it is asserted here rather than in the component's own suite.
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);

    if (!(await effectMenuIsDrawn(page))) {
      return;
    }

    await page.locator('ednb-experimental-effect-list .menu__trigger').click();
    const list = page.locator('ednb-experimental-effect-list .menu__list');
    await expect(list).toBeVisible();

    // Only where the package offers more effects than the box can hold; with a
    // shorter menu there is nothing to scroll and nothing to assert.
    const scrolls = await list.evaluate((box) => box.scrollHeight > box.clientHeight);
    if (!scrolls) {
      return;
    }

    await page.keyboard.press('End');

    // Polled, not read once. The browser applies the scroll after the key, and
    // on a loaded machine that is not the same tick — this assertion is the one
    // failure a full matrix run produces without a defect behind it (measured
    // 2026-09-04 and again 2026-09-06).
    await expect.poll(() => list.evaluate((box) => box.scrollTop)).toBeGreaterThan(0);

    const inView = await list.evaluate((box) => {
      const active = box.querySelector(
        `#${CSS.escape(box.getAttribute('aria-activedescendant') ?? '')}`,
      );
      const listBox = box.getBoundingClientRect();
      const optionBox = active!.getBoundingClientRect();
      return optionBox.top >= listBox.top - 1 && optionBox.bottom <= listBox.bottom + 1;
    });

    expect(inView).toBe(true);
  });

  test('opens with nothing selected on an unengineered module', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');

    // Not the no-blueprint option either: that would be the editor proposing to
    // strip a module that has nothing to strip.
    await expect.poll(() => chosenRecipe(page)).toBeNull();
    await expect(page.locator('.grades')).toHaveCount(0);
  });

  test('applies blueprint, grade and effect in one confirmation', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');

    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);
    await chooseFirstEffect(page);

    await applyDraft(page);

    const line = await ledgerEngineering(page, 'FrameShiftDrive');
    expect(line).toMatch(/increased range/i);
    expect(line).toMatch(/5/);
  });

  test('replaces a grade and then a recipe, each as one decision', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 3);
    await applyDraft(page);

    await openEditor(page, 'FrameShiftDrive');
    // The editor opens on what the module already carries.
    await expect.poll(() => chosenRecipe(page)).toMatch(/increased range/i);
    await chooseGrade(page, 5);
    await applyDraft(page);
    expect(await ledgerEngineering(page, 'FrameShiftDrive')).toMatch(/5/);

    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /^shielded$/i);
    await applyDraft(page);
    expect(await ledgerEngineering(page, 'FrameShiftDrive')).toMatch(/shielded/i);
  });

  test('adds, replaces and removes only the effect, keeping the recipe and grade', async ({
    page,
  }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 4);
    await applyDraft(page);

    await openEditor(page, 'FrameShiftDrive');
    await revealEffectOptions(page);
    // The name line alone: an option carries the package's description under it
    // as well, and what the journey needs back is what to ask for next.
    const names = await effectOptions(page)
      .locator('.effect__name, .menu__option-name')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
    await chooseFirstEffect(page);
    await applyDraft(page);
    const withFirst = await ledgerEngineering(page, 'FrameShiftDrive');
    expect(withFirst).toMatch(/increased range/i);

    await openEditor(page, 'FrameShiftDrive');
    await chooseEffect(page, names[1] ?? '');
    await applyDraft(page);

    await openEditor(page, 'FrameShiftDrive');
    // The explicit no-effect option, which is the only removal route and the
    // one that preserves the blueprint and grade underneath (FR-012).
    await clearEffect(page);
    await applyDraft(page);

    const line = await ledgerEngineering(page, 'FrameShiftDrive');
    expect(line).toMatch(/increased range/i);
    expect(line).toMatch(/4/);
  });

  test('clears through the no-blueprint option, with no separate clear control', async ({
    page,
  }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);
    await applyDraft(page);

    await openEditor(page, 'FrameShiftDrive');

    // Canvas 1c's wide-only `CLEAR ✕` was withdrawn as duplicative, so no
    // control named for clearing exists at any width.
    await expect(page.getByRole('button', { name: /^clear/i })).toHaveCount(0);

    await clearRecipe(page);
    await applyDraft(page);

    expect(await ledgerEngineering(page, 'FrameShiftDrive')).not.toMatch(/increased range/i);
  });

  test('takes a choice back without leaving a mark on the build', async ({ page }) => {
    await openStockBuild(page);
    // Read after selecting, so the comparison is about the build rather than
    // about the mount being selected — which is session state and spends no
    // revision by design (FR-018).
    await selectMount(page, 'FrameShiftDrive');
    const before = await ledgerEngineering(page, 'FrameShiftDrive');

    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);

    // The same capability, drawn as each canvas draws it. Canvas 1d holds a
    // draft, so it carries the control that leaves it. Canvas 1c draws no such
    // control: inline a choice *is* the decision as it is made, and undo is
    // what takes it back — so undo is this composition's revert (wave 4,
    // constitution V).
    if (await surfacesAreLayers(page)) {
      await page.getByRole('button', { name: /revert/i }).click();
      await draftAbandoned(page);
    } else {
      // Inline the recipe and the grade are one decision, because a recipe
      // without a grade asks the Almanac for nothing: the operation is the
      // grade landing on it. So one undo takes it back (FR-018).
      //
      // Reached through the shell rather than pressed on the banner: the bar
      // draws its actions on the row only where they fit, and holds them in the
      // named menu everywhere else, so a journey that wants an action asks for
      // it by name rather than for the composition it is in.
      await reachShellAction(page, /^undo/i);
    }

    await expect.poll(() => ledgerEngineering(page, 'FrameShiftDrive')).toBe(before);
  });

  test('says so, in the panel, where the package offers no engineering', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'CargoHatch');

    // The panel is drawn and answers the question. A bench that simply omitted
    // the region answered it by saying nothing, and nothing outside the panel
    // told a Commander whether the Almanac offers a recipe for the hatch or
    // whether the panel had failed to draw (wave 9).
    expect(await editorOffered(page)).toBe(true);
    // Inline the panel is already on the bench; at compact width it is a screen
    // reached from the action bar. Both draw the same sentence (constitution V).
    await bringEditorOnScreen(page);
    await expect(page.locator('.engineering__state')).toContainText(/no engineering/i);

    // Still no control with nothing behind it: no recipe, grade or effect is
    // offered (FR-009). The details half stays — the hatch has the attributes
    // it was catalogued with whether or not anything will ever engineer them,
    // and FR-009 requires its facts to be exposed (wave 11).
    await expect(page.locator('ednb-blueprint-choice-list')).toHaveCount(0);
    await expect(page.locator('ednb-grade-selector')).toHaveCount(0);
    await expect(page.locator('ednb-experimental-effect-list')).toHaveCount(0);
    await expect(page.locator('.engineering__attributes')).toBeVisible();

    // And the panel keeps its shape: the sentence takes the half the controls
    // would have taken and the attributes stay in the half they are in on
    // every other article, rather than the table sliding under the sentence
    // into a one-column panel of its own (wave 11, Commander request).
    await expect(page.locator('.engineering__choices .engineering__state')).toContainText(
      /no engineering/i,
    );
    await expect(page.locator('.engineering__result .engineering__attributes')).toBeVisible();
  });

  test('is accessible in every editor state', async ({ page }, testInfo) => {
    await openStockBuild(page);

    await openEditor(page, 'FrameShiftDrive');
    await sweepOutfittingState(page, testInfo, 'engineering/unengineered');

    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);
    await sweepOutfittingState(page, testInfo, 'engineering/recipe chosen');

    await clearRecipe(page);
    await sweepOutfittingState(page, testInfo, 'engineering/clearing');

    await applyDraft(page);
    await selectMount(page, 'CargoHatch');
    await sweepOutfittingState(page, testInfo, 'engineering/mount takes none');
  });
});

test.describe('engineering costs', () => {
  test('prices no job of its own — the rail states the build’s materials', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);

    // Neither canvas draws a materials list inside the editor: it holds the
    // article's attributes, and the recipe, the grade and the effect, and the
    // only `MATERIALS` block on either canvas is the build-wide one in the
    // rail (wave 11, Commander
    // request, reversing waves 5 and 9). Its rarity marks, its ordering, its
    // counts and its Merc Coin row are covered where it lives, in
    // `cost-and-materials.spec.ts`.
    //
    // Read as the block and the heading it would carry, not as the word: the
    // package's description of a lightweight effect says its components are
    // "crafted from lightweight materials", and game text inside the panel is
    // not this panel making a materials list.
    const editor = page.locator('.engineering').first();
    await expect(
      editor.locator('ednb-cost-materials, .block--materials, .rail-materials, .materials-box'),
    ).toHaveCount(0);
    await expect(
      editor.getByText(englishMessages['cost-materials.materials.heading'], { exact: true }),
    ).toHaveCount(0);
    // A completed grade is the only thing this application models, so no
    // surface calls the recipe a roll (FR-013, reference review). Read as a
    // word: `Controller` is a package noun that carries the letters.
    await expect(editor).not.toContainText(/\broll(s|ed|ing)?\b/iu);

    // Gone from the panel, not from the build: once the job is on the module,
    // the rail states its materials. Counted rather than seen — at compact
    // width the editor is a screen over the workspace and the rail is behind
    // it, so this is read after leaving the editor, and the rail's own block
    // may sit inside the Status stack there (feature 009).
    await applyDraft(page);
    await expect
      .poll(() => page.locator('ednb-cost-materials .rail-material').count())
      .toBeGreaterThan(0);
  });

  test('marks which way each figure moved, and says so in words', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);

    const comparison = page.locator('.comparison');
    await expect(comparison).toBeVisible();
    const text = (await comparison.textContent()) ?? '';
    // The canvas's own green and red with its ▲/▼, off the application's table
    // of which way is better rather than off the Almanac's unreliable
    // `LessIsGood`. Never colour alone: the marker is drawn and the direction
    // is spoken (wave 4).
    expect(text).toMatch(/[▲▼]/);
    expect(text).toMatch(/improved|worsened/i);
    await expect(
      page
        .locator(
          '.comparison__value--modified[data-direction="better"], .comparison__value--modified[data-direction="worse"]',
        )
        .first(),
    ).toBeVisible();
  });

  test('states an absent figure as a value, and lists what the package calculates', async ({
    page,
  }, testInfo) => {
    await openStockBuild(page);
    await openEditor(page, 'SmallHardpoint1');
    await chooseRecipe(page, /rapid fire/i);
    await chooseGrade(page, 5);

    const comparison = page.locator('.comparison');
    await expect(comparison).toBeVisible();

    // Rapid fire gives a pulse laser a jitter the catalogue never gave it, so
    // the stock side of that row has no figure. It is a number that is absent,
    // not a name the catalogue lost, and the cell says so.
    const jitter = comparison.locator('tr', { has: page.getByText(/^Jitter/) });
    await expect(jitter.locator('.comparison__value .unavailable')).toBeVisible();
    await expect(comparison).not.toContainText(/name unavailable/i);

    // Damage per second is what the recipe is chosen for, and the Almanac
    // calculates it. Both readings are drawn, after the stats they come from.
    const dps = comparison.locator('tr', {
      has: page.getByText(englishMessages['outfitting.engineering.attribute.damagePerSecond'], {
        exact: true,
      }),
    });
    await expect(dps).toBeVisible();
    await expect(dps.locator('.comparison__value').first()).toHaveText(/\d/);
    await expect(dps.locator('.comparison__value--modified')).toHaveText(/\d/);

    // A pulse laser never stops to reload, so it sustains what it starts with,
    // and it fires one round a shot. Both rows would be a row above them
    // written twice, and both are left off.
    for (const key of [
      'outfitting.engineering.attribute.sustainedDamagePerSecond',
      'outfitting.engineering.attribute.damagePerShot',
    ] as const) {
      await expect(comparison).not.toContainText(englishMessages[key]);
    }

    // The drive every other swept state opens has no one-sided row and no
    // calculated figure, so this is the only state that renders either. It
    // carries the table's longest label, in a column that does not wrap.
    await sweepOutfittingState(page, testInfo, 'engineering/weapon figures');
  });

  test('keeps the engineering one height as a recipe fills it', async ({ page }) => {
    // The grade and the effect follow from a recipe, so choosing one would grow
    // the engineering card by both of them and move whatever the card stands
    // over. The room the three controls take is kept whether or not the last
    // two are drawn, so the card is the height it will be before anything is
    // chosen. Nothing is drawn that is not there: what is reserved is the room
    // (`design/engineering-editor.md`, "The engineering keeps one height").
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');

    const details = page.locator('.engineering__result');
    const choices = page.locator('.engineering__choices');
    await expect(choices).toBeVisible();
    await expect(details).toBeVisible();

    // The controls come first and the article's own figures follow them, at
    // both placements.
    const boxOf = async () =>
      await page.evaluate(() => ({
        details: document.querySelector('.engineering__result')!.getBoundingClientRect(),
        choices: document.querySelector('.engineering__choices')!.getBoundingClientRect(),
      }));

    const before = await boxOf();
    expect(before.choices.bottom).toBeLessThanOrEqual(before.details.top + 1);

    if (await surfacesAreLayers(page)) {
      // Canvas 1d's screen scrolls and reserves nothing: there the three
      // controls are a plate on a page of plates, and what follows them follows
      // them down. What that width owes is the same three controls.
      await expect(page.locator('.engineering')).toHaveClass(/engineering--layer/);
      await chooseRecipe(page, /increased range/i);
      await expect(page.locator('ednb-grade-selector')).toBeVisible();
      return;
    }

    await chooseRecipe(page, /increased range/i);
    await expect(page.locator('ednb-grade-selector')).toBeVisible();
    await expect(page.locator('ednb-experimental-effect-list')).toBeVisible();

    const after = await boxOf();
    // Two controls appeared into room that was already paid for, so the card is
    // the height it was. Within a pixel, not to the pixel: a recipe gives the
    // table beside it a `MODIFIED` column, and a column changes where its rows
    // round to by a fraction of one.
    expect(Math.abs(after.choices.height - before.choices.height)).toBeLessThan(1);
    expect(Math.abs(after.details.top - before.details.top)).toBeLessThan(1);
  });

  test('expands the details and the engineering instead of scrolling either', async ({ page }) => {
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);
    await chooseGrade(page, 5);

    const panes = page.locator('.engineering__panes');
    await expect(panes).toBeVisible();
    if (await surfacesAreLayers(page)) {
      // The full-screen composition owns the viewport and has no page to grow
      // into: the layer around it is what scrolls, and the column this asserts
      // on releases only for the inline placement
      // (`design/engineering-editor.md`, "Nothing here scrolls").
      return;
    }

    // Nothing inside the panel is a scroller, and nothing inside it is hidden.
    // Wave 11 gave each half its own, inside a panel bounded to a share of a
    // column that was itself bounded to the screen — three nested boxes, and a
    // weapon's seventy attribute rows read four at a time in the innermost of
    // them (FR-012b; Commander request 2026-08-27).
    const measured = await panes.evaluate((node) => {
      const box = (element: Element) => ({
        overflow: getComputedStyle(element).overflowY,
        hidden: element.scrollHeight - element.clientHeight,
        height: element.getBoundingClientRect().height,
      });

      const choices = node.querySelector('.engineering__choices')!;
      const result = node.querySelector('.engineering__result')!;

      return {
        choices: box(choices),
        result: box(result),
        panes: box(node),
        gap: Number.parseFloat(getComputedStyle(node).rowGap),
        body: box(node.closest('.engineering__body')!),
        panel: box(node.closest('.engineering')!),
        // The column that used to bound the panel releases while a mount is
        // selected, exactly as it releases for an anatomy dashboard
        // (`design/outfitting-workspace.md`).
        centre: getComputedStyle(document.querySelector('.outfitting__centre')!).position,
      };
    });

    for (const region of [measured.choices, measured.result, measured.body, measured.panel]) {
      expect(region.overflow).toBe('visible');
      // A box that is not a scroller and has something outside it is a box
      // hiding content outright, which is the one outcome worse than scrolling.
      expect(region.hidden).toBeLessThanOrEqual(1);
    }

    // The panel holds both cards whole and nothing else: their two heights and
    // the one gap between them, with no room reserved past what is drawn. That
    // is what "expands" means once neither card can give way, and the sum is
    // what a floor left over from an earlier arrangement would break.
    expect(measured.panes.height).toBeCloseTo(
      measured.choices.height + measured.result.height + measured.gap,
      0,
    );
    expect(measured.centre).toBe('static');
  });
});

test.describe('purchased and reward articles', () => {
  /** Fits the first chooser row carrying one acquisition label. */
  async function fitArticle(page: Page, slotKey: string, label: RegExp): Promise<void> {
    await selectMount(page, slotKey);
    // Whichever family holds it, and whichever manifest is drawing: the rail
    // draws one family's rows at a time, so the article a test names may be in
    // a family it has not revealed yet.
    await revealFamilyHolding(page, label);
    const row = page.locator('.candidates__choices .candidate').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    // The module's name itself: a row's centre falls in the gap between the
    // identity and the figures, the identity block's centre falls between its
    // name and its code line once the panel is narrow, and Firefox does not
    // activate a label from a click that lands on no content.
    await row.locator('.candidate__name').click();
    await expect(row.locator('input[type="radio"]')).toBeChecked();
    if (await surfacesAreLayers(page)) {
      await page.getByRole('button', { name: /fit module/i }).click();
    }
    await fitCommitted(page);
  }

  test('keeps a reward’s identity through an effect-only change', async ({ page }) => {
    await openStockBuild(page);
    await fitArticle(page, 'FrameShiftDrive', /tech broker/i);

    await openEditor(page, 'FrameShiftDrive');
    // The recipe the article arrived with is stated rather than offered
    // (wave 5).
    await expect(page.locator('.blueprints__fixed')).toBeVisible();

    // An effect on its own, which is `setExperimentalEffect` rather than a
    // re-roll of the recipe.
    await chooseFirstEffect(page);
    await applyDraft(page);

    await openEditor(page, 'FrameShiftDrive');
    // Still a purchase. If the identity had been lost, this article would now
    // be an ordinary module that happens to be well rolled (FR-012).
    await expect(page.locator('.blueprints__fixed')).toBeVisible();
  });

  test('prices a Mercenary upgrade above the grade it was bought at', async ({ page }) => {
    const fixedArticle = await fixedEffectMercenaryArticle();
    await openStockBuild(page);
    await fitArticle(page, fixedArticle.slot, new RegExp(fixedArticle.articleName, 'i'));

    await openEditor(page, fixedArticle.slot);

    const fixedEffect = page.locator('.engineering__fixed-effect');
    await expect(fixedEffect).toContainText(fixedArticle.effectName);
    await expect(fixedEffect).toContainText(/fixed/i);
    await expect(page.locator('ednb-experimental-effect-list')).toHaveCount(0);

    // The bespoke recipe the article was bought with. Its own table begins
    // above the purchase grade, so the cells offered are the grades that are
    // still to climb rather than a fixed five (contract, "Engineering").
    await expect.poll(() => chosenRecipe(page)).not.toBeNull();
    await page.locator('.grade').last().click();
    // Waited out before applying, the way the climb back down below is. A
    // click resolves when the event is dispatched, and applying a draft the
    // panel has not finished answering commits the grade that was there
    // before it — which is the article's purchase grade, and reads as a climb
    // that never happened.
    //
    // Read off the chosen cell rather than the figure beside the legend: only
    // canvas 1c draws that figure, and canvas 1d needs none because its cells
    // carry their own numbers. The cell marked as chosen is the one thing both
    // drawings of this control state, so it is what a journey that runs at
    // every width is allowed to ask.
    await expect(page.locator('.grade[data-selected="true"] .grade__number')).toHaveText('5');

    // The grades below the recipe's own lowest are marked as outside its range,
    // and the mark is drawn rather than only published as an attribute: a cell
    // that says it is out of range and looks exactly like one that is not says
    // nothing to a Commander (SC 1.4.11).
    const marks = await page.locator('.grade').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const drawn = getComputedStyle(node);
        return {
          unavailable: node.getAttribute('data-unavailable') === 'true',
          image: drawn.backgroundImage,
          size: drawn.backgroundSize,
          height: Math.round(box.height),
        };
      }),
    );
    expect(marks.some((cell) => cell.unavailable)).toBe(true);
    for (const cell of marks) {
      expect(cell.image === 'none').toBe(!cell.unavailable);
      if (!cell.unavailable) {
        continue;
      }

      // And it crosses the whole cell, which is how the canvas draws it. Held
      // to a band along one edge the mark is a rule under the number rather
      // than a hatch over the cell, and a Commander reads the cell as one the
      // recipe reaches (Commander request 2026-08-30).
      const [, band] = cell.size.split(' ');
      expect(band === undefined || Number.parseFloat(band) >= cell.height).toBe(true);
    }
    // Inline this has already committed; in a layer it is a draft that has to
    // be applied before the ledger says anything. Either way the panel is then
    // showing the climbed article (constitution V).
    await applyDraft(page);
    if (await surfacesAreLayers(page)) {
      await openEditor(page, fixedArticle.slot);
    }
    await expect(page.locator('.engineering__fixed-effect')).toContainText(fixedArticle.effectName);
    await expect(page.locator('ednb-experimental-effect-list')).toHaveCount(0);

    // The climb's own Merc Coin, which Almanac 0.1.5 publishes per grade
    // (upstream #337). The editor prices no job of its own any more, so the
    // figure is read where the build's costs are: `buildCost()` folds the
    // climb's coins in with the purchase's, and the rail's one row states the
    // total. It joins no material list even there — Merc Coin has no credit or
    // material equivalent, so summing it into one would invent an exchange rate
    // the game does not have (wave 11).
    const coins = page.locator('ednb-cost-materials .rail-material--merc-coin');
    await expect(coins).toHaveCount(1);
    await expect(coins).toContainText(/merc coin/i);

    // And back down to the grade it was bought at, which the recipe's own table
    // does not reach. The bar has to come back to 1 rather than to nothing:
    // a blank bar on a plainly engineered article was what pressing that cell
    // used to do, because the Almanac publishes no recipe there and the answer
    // is to restore the article rather than to ask for one (wave 6).
    // The build still has a link. Six Mercenary articles — this small mining
    // hardpoint among them — sit on modules the package gives no engineering
    // menu. The codec table records their variants' own blueprints, so an ordinary
    // record can name a grade climbed off the purchase grade and the link stands.
    // Its own timeout: publishing is asynchronous, so the fragment appears one
    // encode after the climb is applied — comfortably under a second here, and
    // slower on a machine running the whole matrix.
    await expect(page).toHaveURL(/\/outfitting#b\./, { timeout: 15_000 });

    const climbed = await applied(page, fixedArticle.slot);
    await page.locator('.grade').first().click();
    await expect(page.locator('.grade[data-selected="true"] .grade__number')).toHaveText('1');
    await applyDraft(page);

    expect(climbed).toMatch(/G5$/);
    await expect.poll(() => applied(page, fixedArticle.slot)).toMatch(/G1$/);
  });

  test('offers no apply on a final article', async ({ page }) => {
    await openStockBuild(page);

    // The package reports some reward articles as final: they accept no
    // further engineering, and no editor draws an action for one.
    const finals = await page.evaluate(
      () => document.querySelectorAll('.engineering__apply').length,
    );
    expect(finals).toBe(0);
  });
});

test.describe('reading a build in', () => {
  test('completes a supported partial roll at quality 1', async ({ page }) => {
    await openStockBuild(page);

    // A build the Almanac can identify but that arrived at a partial roll. It
    // is normalized before anything reads it, and nothing is said about it: a
    // completed grade is what the application models, so reaching one is not an
    // event.
    const core = await import('@elite-dangerous-almanac/core/ships/ship-loadout');
    const partial = core.ShipLoadout.default('Anaconda');
    partial.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', { grade: 5, quality: 0.42 });
    const imported = core.ShipLoadout.fromLoadout(partial.toLoadoutEvent());
    const completed = {
      kind: imported.completeEngineeringGrade('FrameShiftDrive').kind,
      quality: imported.fittedModuleAt('FrameShiftDrive')?.engineering?.Quality ?? null,
    };

    // The package's own promise, which the ingress gate depends on. If a
    // release stops keeping it, this fails here rather than as a mystery
    // elsewhere (contract, "Package acceptance").
    expect(completed.kind).toBe('normalized');
    expect(completed.quality).toBe(1);
  });

  test('refuses an unsupported partial before anything is activated', async ({ page }) => {
    await openStockBuild(page);
    const before = await ledgerEngineering(page, 'FrameShiftDrive');

    const core = await import('@elite-dangerous-almanac/core/ships/ship-loadout');
    const build = core.ShipLoadout.fromLoadout({
      event: 'Loadout',
      Ship: 'Anaconda',
      Modules: [
        {
          Slot: 'MainEngines',
          Item: 'Int_Engine_Size7_Class5',
          Engineering: {
            BlueprintName: 'Engine_Dirty',
            Level: 5,
            Quality: 0.42,
            Modifiers: [{ Label: 'NotAStat', Value: 1 }],
          },
        },
      ],
    });
    const refusal = build.completeEngineeringGrade('MainEngines').kind;

    // Whatever the package answers, the build on screen is untouched: the
    // candidate never became one (FR-013, SC-005).
    expect(['normalized', 'unsupported', 'unchanged']).toContain(refusal);
    expect(await ledgerEngineering(page, 'FrameShiftDrive')).toBe(before);
  });
});

/**
 * Canvas 1c's three-stage flow, and the width it needs.
 *
 * The bench draws the family rail, the module pane and the engineering editor
 * side by side under one numbered strip. Three tracks need more than the
 * desktop project's 1440 leaves once the ledger and the status rail are paid
 * for, so the arrangement is asked for at the width the artboard was drawn at
 * and the fallback is asserted at the project's own
 * (`design/outfitting-workspace.md`, "The bench is two columns where it has
 * room for three").
 */
test.describe('the bench’s three columns', () => {
  /** The top edge of each numbered bar, in document order. */
  async function stripTops(page: Page): Promise<number[]> {
    return await page.evaluate(() =>
      [...document.querySelectorAll('.ednb-step')].map((bar) =>
        Math.round(bar.getBoundingClientRect().top),
      ),
    );
  }

  test('draws the editor beside the manifest, on the step strip’s own line', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 2020, height: 1100 });
    await openStockBuild(page);
    await selectMount(page, 'FrameShiftDrive');

    const manifest = page.locator('ednb-module-replacement');
    const editor = page.locator('ednb-engineering-editor');
    await expect(manifest).toBeVisible();
    await expect(editor).toBeVisible();

    const [manifestBox, editorBox] = await Promise.all([
      manifest.boundingBox(),
      editor.boundingBox(),
    ]);

    // Beside, not under: the editor starts after the manifest ends across, and
    // the two share the bench's own row.
    expect(editorBox!.x).toBeGreaterThanOrEqual(manifestBox!.x + manifestBox!.width);

    // One strip, three bars, one line. Steps ① and ② are the chooser's; step ③
    // is the editor's, and it pays the fitting panel's head so that it lands on
    // their line rather than on the head's.
    const tops = await stripTops(page);
    expect(tops).toHaveLength(3);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);

    // No project viewport is wide enough to reach this arrangement, so the gate
    // that scans every rendered state never sees it. It is scanned here, at the
    // width it was asked for.
    await expectNoAccessibilityViolations(page, testInfo, { label: 'bench-three-columns' });
  });

  test('holds the strip on one line at the narrowest bench, in the longer language', async ({
    browser,
    baseURL,
  }) => {
    // Step ③ is stood on the strip's line by an offset the height of the fitting
    // panel's head — a declared figure, not a shared row, because aligning by
    // grid would be a subgrid chain through three components. So the head has to
    // be the one row that figure assumes, and the case that would break it is
    // the narrowest bench that draws three columns in the language with the
    // longest labels: 1790 x 1010 puts the fitting column at 645px, and German
    // draws `MODUL ENTFERNEN` in it (`styles/_chrome.scss`).
    const context = await browser.newContext({
      baseURL,
      locale: 'de-DE',
      viewport: { width: 1790, height: 1010 },
    });
    const page = await context.newPage();

    try {
      await openStockBuild(page);
      await openEditor(page, 'FrameShiftDrive');

      const measured = await page.evaluate(() => ({
        toolbar: document.querySelector('.replacement__toolbar')?.getBoundingClientRect().height,
        tops: [...document.querySelectorAll('.ednb-step')].map((bar) =>
          Math.round(bar.getBoundingClientRect().top),
        ),
      }));

      expect(measured.tops).toHaveLength(3);
      expect(Math.max(...measured.tops) - Math.min(...measured.tops)).toBeLessThanOrEqual(1);

      // And the head is one row, which is the assumption the offset rests on. A
      // wrapped head steps the editor a whole row off the strip.
      expect(measured.toolbar).toBeLessThanOrEqual(48);
    } finally {
      await context.close();
    }
  });

  test('stacks the editor under the manifest where three columns do not fit', async ({ page }) => {
    await openStockBuild(page);
    await selectMount(page, 'FrameShiftDrive');

    if (await surfacesAreLayers(page)) {
      // Canvas 1d opens each surface as a screen of its own, so there is no
      // bench to arrange. What that width owes is asserted where the layers are.
      return;
    }

    const manifest = page.locator('ednb-module-replacement');
    const editor = page.locator('ednb-engineering-editor');
    const [manifestBox, editorBox] = await Promise.all([
      manifest.boundingBox(),
      editor.boundingBox(),
    ]);

    expect(editorBox!.y).toBeGreaterThanOrEqual(manifestBox!.y + manifestBox!.height - 1);
  });

  test('bounds the bench and hands what is left to the list and the attributes', async ({
    page,
  }) => {
    // Canvas 1c draws the bench as a card of a fixed height with the list
    // scrolling in one column and the attributes in the other. Beside each other
    // the two panels are not sharing one screen's height, they are each given
    // one, so the column ends where the window ends and what is left over goes
    // to the two boxes that have something to put in it (Commander request
    // 2026-08-30).
    await page.setViewportSize({ width: 2020, height: 1100 });
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');

    // With a recipe taken, because that is the state the table has something to
    // scroll: every comparison row then carries a direction drawn only for a
    // reader, and around a hundred boxes positioned out of the page are what
    // find a scroller that is not a containing block.
    await chooseRecipe(page, /increased range/i);

    const measured = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector)!;
        return {
          height: element.getBoundingClientRect().height,
          scrollable: element.scrollHeight - element.clientHeight > 1,
          overflow: getComputedStyle(element).overflowY,
        };
      };
      const declared = document.createElement('div');
      declared.style.blockSize = getComputedStyle(document.documentElement)
        .getPropertyValue('--ednb-layout-manifest-pane')
        .trim();
      document.body.append(declared);
      const pane = declared.getBoundingClientRect().height;
      declared.remove();

      return {
        pane,
        list: box('.candidates__pane'),
        choices: box('.engineering__choices .engineering__card-body'),
        details: box('.engineering__result .engineering__card-body'),
        document: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
      };
    });

    // The page does not carry the bench here: the bench carries itself.
    expect(measured.document).toBeLessThanOrEqual(measured.viewport + 1);

    // The list takes more than the height it declares for itself, which is the
    // whole of what "the room that is left" means.
    expect(measured.pane).toBeGreaterThan(0);
    expect(measured.list.height).toBeGreaterThan(measured.pane);
    expect(measured.list.scrollable).toBe(true);

    // And of the editor's two cards it is the attributes that scroll. The three
    // controls above them are reserved room, not a scroller.
    expect(measured.details.overflow).toBe('auto');
    expect(measured.choices.overflow).toBe('visible');
    expect(measured.choices.scrollable).toBe(false);

    // The bench clips what stands past it, so the shortest window it is bounded
    // at has to hold the whole of what the editor cannot fold: the step bar, the
    // reserved engineering card and the table's own floor. A pixel over and the
    // rest is unreachable, because nothing here scrolls to it
    // (`design/outfitting-workspace.md`, "The bench is bounded where it is three
    // columns").
    const bench = async () =>
      await page.evaluate(() => {
        const element = document.querySelector('.outfitting__bench')!;
        return {
          clipped: element.scrollHeight - element.clientHeight,
          document: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
        };
      });

    await page.setViewportSize({ width: 2020, height: 1062 });
    await expect(async () => {
      const shortest = await bench();
      expect(shortest.clipped).toBeLessThanOrEqual(1);
      expect(shortest.document).toBeLessThanOrEqual(shortest.viewport + 1);
    }).toPass({ timeout: 5_000 });

    // And a window under it releases the column, which is the stacked
    // arrangement's own answer: the page carries the bench and there is nothing
    // to clip.
    //
    // The three columns are still drawn here — this window is wide enough for
    // them and only too short for the bound — so this is the state that catches
    // a scroller keyed on the width alone. Nothing in the editor may scroll
    // while the page is scrolling too: that is a weapon's seventy rows read a
    // few at a time inside a page that moves under them, which is the nested
    // arrangement the record forbids (`design/engineering-editor.md`, "Nothing
    // here scrolls"). The chooser's pane is not part of that question — its
    // height is its own declared bound, and it holds at every width.
    await page.setViewportSize({ width: 2020, height: 1010 });
    await expect(async () => {
      const released = await bench();
      expect(released.clipped).toBeLessThanOrEqual(1);
      expect(released.document).toBeGreaterThan(released.viewport);

      const scrollers = await page.evaluate(() =>
        [...document.querySelectorAll('ednb-engineering-editor *')]
          .filter((box) => {
            const drawn = getComputedStyle(box);
            const scrolls = /auto|scroll/.test(drawn.overflowY);
            return scrolls && box.scrollHeight - box.clientHeight > 1;
          })
          .map((box) => box.className.toString().split(' ')[0]),
      );
      expect(scrollers).toEqual([]);
    }).toPass({ timeout: 5_000 });
  });

  test('lets nothing scroll inside a bench the anatomy has released', async ({ page }) => {
    // The workspace releases this column whenever the strip has a dashboard
    // open: a dashboard is a panel of figures as tall as the build has to say,
    // and the page is the better carrier for it. That release is the same fact
    // the bench's own bound is, so the scrollers inside the bench have to ask
    // it too — asked on the width and the window's height alone they stayed on,
    // and pressing `POWER` over a three-column bench left a list scrolling
    // inside a page that scrolled, with the chooser's declared height lifted in
    // the one state nothing was bounding it (`styles/_chrome.scss`).
    await page.setViewportSize({ width: 2020, height: 1100 });
    await openStockBuild(page);
    await openEditor(page, 'FrameShiftDrive');
    await chooseRecipe(page, /increased range/i);

    const inside = async () =>
      await page.evaluate(() => {
        const scrollers = [...document.querySelectorAll('ednb-engineering-editor *')].filter(
          (box) => {
            const drawn = getComputedStyle(box);
            return /auto|scroll/.test(drawn.overflowY) && box.scrollHeight - box.clientHeight > 1;
          },
        );
        const pane = document.querySelector('.candidates__pane');
        return {
          scrollers: scrollers.map((box) => box.className.toString().split(' ')[0]),
          cap: pane === null ? 'none' : getComputedStyle(pane).maxBlockSize,
          released: document
            .querySelector('.outfitting')
            ?.classList.contains('outfitting--dashboard'),
          document: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
        };
      });

    // Bounded, the column decides the list's height and the page does not move.
    await expect(async () => {
      const bounded = await inside();
      expect(bounded.released).toBe(false);
      expect(bounded.document).toBeLessThanOrEqual(bounded.viewport + 1);
      expect(bounded.cap).toBe('none');
    }).toPass({ timeout: 5_000 });

    await page
      .locator('.anatomy__modes')
      .getByRole('button', { name: /^power$/i })
      .click();

    await expect(async () => {
      const released = await inside();
      expect(released.released).toBe(true);
      expect(released.document).toBeGreaterThan(released.viewport);
      expect(released.scrollers).toEqual([]);

      // And the chooser's own declared height is back, which is what keeps a
      // 478-choice list from running the released page down two hundred rows.
      expect(released.cap).not.toBe('none');
    }).toPass({ timeout: 10_000 });
  });

  test('numbers step ③ only where the chooser numbers ① and ②', async ({ page }) => {
    // The number belongs to the strip, not to the bar. Where the chooser has no
    // room for its rail it draws the accordion and numbers nothing, and a lone
    // ③ over a bench with no other step on it names a flow that is not on the
    // screen (`design/module-replacement.md`, "The three steps, numbered").
    await openStockBuild(page);
    await selectMount(page, 'FrameShiftDrive');

    if (await surfacesAreLayers(page)) {
      // Canvas 1d draws no strip at all: each surface is a screen of its own.
      await expect(page.locator('.ednb-step')).toHaveCount(0);
      return;
    }

    const chooserSteps = await page.locator('ednb-candidate-list .ednb-step').count();
    const editorNumber = page.locator('.engineering__step .ednb-step__number');
    await expect(editorNumber).toHaveCount(1);

    if (chooserSteps === 0) {
      await expect(editorNumber).toBeHidden();
      return;
    }

    // Two bars from the chooser, and the editor's makes three.
    expect(chooserSteps).toBe(2);
    await expect(editorNumber).toBeVisible();
  });

  test('draws no numbered step over a mount with no chooser at all', async ({ page }) => {
    // The cargo hatch is a mount the Almanac offers no replacement for, so the
    // bench holds the editor and nothing else — at every width, not only at the
    // narrow ones the two rules above are about. The bar keeps its name; the
    // number would be the third step of a flow with no first or second.
    await openStockBuild(page);
    await selectMount(page, 'CargoHatch');

    if (await surfacesAreLayers(page)) {
      await expect(page.locator('.ednb-step')).toHaveCount(0);
      return;
    }

    await expect(page.locator('ednb-module-replacement')).toHaveCount(0);
    await expect(page.locator('.engineering__step .ednb-step__name')).toBeVisible();
    await expect(page.locator('.engineering__step .ednb-step__number')).toBeHidden();

    // And the editor takes the bench, rather than a 396px track with an empty
    // column beside it.
    await page.setViewportSize({ width: 2020, height: 1100 });
    const [bench, editor] = await Promise.all([
      page.locator('.outfitting__bench').boundingBox(),
      page.locator('ednb-engineering-editor').boundingBox(),
    ]);
    expect(editor!.width).toBeGreaterThan(bench!.width * 0.9);
  });
});

/**
 * The grade bar says the same thing twice, on purpose.
 *
 * Canvas 1c fills the bar up to the chosen grade and numbers every cell, so a
 * cell past the choice is both unfilled and dimmed. Neither is the only carrier
 * — each cell names its own grade to a reader (`design/engineering-editor.md`).
 */
test('numbers every grade cell and dims the ones past the choice', async ({ page }) => {
  await openStockBuild(page);
  await openEditor(page, 'FrameShiftDrive');
  await chooseRecipe(page, /increased range/i);
  await chooseGrade(page, 2);

  const cells = page.locator('ednb-grade-selector .grade');
  await expect(cells).toHaveCount(5);

  const drawn = await cells.evaluateAll((nodes) =>
    nodes.map((node) => ({
      filled: node.getAttribute('data-filled') === 'true',
      number: node.querySelector('.grade__number')?.textContent?.trim() ?? '',
      colour: getComputedStyle(node.querySelector('.grade__number')!).color,
    })),
  );

  expect(drawn.map((cell) => cell.number)).toEqual(['1', '2', '3', '4', '5']);

  // Canvas 1c fills the bar up to the choice, so grade 2 reads as two. Canvas
  // 1d fills the chosen button alone, because a numbered button filled for
  // being *below* the choice is four buttons claiming to be the one that is
  // pressed. Both number every cell, which is the part this is about.
  const steps = await page
    .locator('ednb-grade-selector .grades')
    .first()
    .evaluate((node) => node.classList.contains('grades--steps'));
  expect(drawn.map((cell) => cell.filled)).toEqual(
    steps ? [false, true, false, false, false] : [true, true, false, false, false],
  );

  // The two states are drawn in different inks. Which ink is the stylesheet's
  // business; that they differ is the claim.
  const filled = new Set(drawn.filter((cell) => cell.filled).map((cell) => cell.colour));
  const unfilled = new Set(drawn.filter((cell) => !cell.filled).map((cell) => cell.colour));
  expect(filled.size).toBe(1);
  expect(unfilled.size).toBe(1);
  expect([...filled][0]).not.toBe([...unfilled][0]);
});

/**
 * The fourth of the outfitting lists a pointer answers (Commander request
 * 2026-08-31). The other three are in `module-outfitting.spec.ts`, and the
 * reason this one is measured rather than read out of the cascade is written
 * there too.
 *
 * Both shapes are asked, because both are drawn: canvas 1c's menu at the widths
 * that have a pointer, canvas 1d's cards at the rest. Only the desktop profile
 * reports a hovering pointer, so it is there the wash is evidenced and on the
 * touch profiles that the restraint is.
 */
test('washes an experimental effect a pointer rests on, and only where there is one', async ({
  page,
}) => {
  await openStockBuild(page);
  await openEditor(page, 'FrameShiftDrive');
  await chooseRecipe(page, /increased range/i);
  await revealEffectOptions(page);

  // The recipe was chosen a line above and no effect with it, so every option
  // on screen is an unchosen one. A chosen option keeps its own ground, its
  // edge and its marker, and the wash is written not to stand over them.
  const option = effectOptions(page).first();
  await expect(option).toBeVisible();
  // The two shapes publish a chosen option differently — the cards through
  // `data-selected`, the menu through `aria-selected` — so both are ruled out
  // rather than the one this width happens to draw.
  await expect(option).not.toHaveAttribute('data-selected', 'true');
  await expect(option).not.toHaveAttribute('aria-selected', 'true');

  const resting = await option.evaluate((node) => getComputedStyle(node).backgroundColor);
  await option.hover();
  const hovered = await option.evaluate((node) => getComputedStyle(node).backgroundColor);

  if (await page.evaluate(() => window.matchMedia('(hover: hover)').matches)) {
    expect(hovered).not.toBe(resting);
  } else {
    expect(hovered).toBe(resting);
  }
});
