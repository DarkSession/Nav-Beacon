## 0. Design revision

- [x] 0.1 In `.design/Ship Builder.dc.html`, point every licence link at
      `https://github.com/DarkSession/Nav-Beacon/blob/main/LICENSE`, and format the file with the
      repository's Prettier. Verify `grep -c Elite-Dangerous-Ship-Builder` on the file prints 0,
      `pnpm run format:check` passes, and `git diff main -- ".design/Ship Builder.dc.html"` shows
      no change other than the canvas 1c and 1d revision, the licence links and Prettier's
      formatting.

## 1. Category order

- [x] 1.1 Set the compact category list in `outfitting-workspace.ts` to
      `hardpoint, utility, core, optional`, so the wide list becomes `all` followed by the same
      four. Update the unit test that pins the compact list, and verify `pnpm test` passes with the
      new order.
- [x] 1.2 Update the unit test "opens on “all” where the width offers it" so it pins the wide list
      to `all, hardpoint, utility, core, optional`. Extend "holds the category a Commander chose"
      so it chooses `optional` in the compact composition, widens the region to 1440 pixels, and
      verifies `optional` is still the category, and the reverse from wide to compact. Add a test that
      leaves `all` shown, narrows the region to the compact composition, and verifies `hardpoint` is
      shown, then widens it to 1440 pixels again and verifies `all` is shown. Add a test that walks every hull in `SHIPS`, maps `ShipLoadout.default(hull).slots()` through
      `CATEGORY_KINDS`, and verifies that every hull carries all four kinds and that the first
      appearance of each kind follows the category list. Add another test that verifies `CATEGORY_KINDS` puts `armour` and `cargoHatch` under
      `core`. Verify the hull-walking test fails when the list is put back to the old order.
- [x] 1.3 Add an end-to-end step that runs in every layout profile, reads `data-composition`, and
      reads the category strip's labels in document order. Where the composition is `compact`,
      verify four choices (hardpoints, utility mounts, core internals, optional internals) and that
      hardpoints are pressed when the ledger opens. Where it is not `compact`, verify the choice
      that shows every kind comes first, followed by the same four. Take the expected labels from
      the English message catalogue rather than as literals, so a wording change does not fail an
      order check. At a compact profile, also press core internals and verify the armour row and
      the cargo hatch row are drawn. Verify the step passes in all ten projects.
- [x] 1.4 Register the tests from 1.2 and 1.3 as named assertions in `e2e/coverage-ledger.ts` on the
      `build/outfitting-ledger` entry, and add `002/FR-002a` to that entry's requirements. Verify `pnpm run policy:specs` passes. Verify with `grep` that each named assertion's title appears on the stated entry, because
      `policy:specs` passes on these requirement ids whether or not the new tests are registered.

## 2. Dense tokens

- [x] 2.1 Add `--ednb-measure-mount-box-dense` (1.375rem) and `--ednb-measure-node-box-dense`
      (1.125rem) to the primitives, and `--ednb-layout-mount-box-dense` and
      `--ednb-layout-node-box-dense` to the semantic layer, each with a comment that names canvas
      1c's 22px and 18px. Verify `pnpm run policy` reports no token violation and
      `pnpm run format:check` passes.

## 3. Class chip on the identity badge

- [x] 3.1 Add a `classChip` input (default `false`) to `ednb-module-identity-badge`. When it is on,
      `codeLine()` leaves out the class and rating, and the template draws `code()` in a chip on the
      name line, after the name and before the projected route marks. When `code()` is null, draw no
      chip. Keep `codeDescription` unchanged. Verify with unit tests: with the chip on, the code line
      reads `Gimballed` for a gimballed 4A article, and the chip reads `4A`. With the chip off, the
      code line still reads `4A Gimballed`. An article without class or rating draws no
      chip, and so do one with a class and no rating and one with a rating and no class. The
      spoken description is the same in both cases.
- [x] 3.2 Style the chip from tokens only: the metric face at `--ednb-text-size-micro`, the quiet
      ink, a hairline `--ednb-border-field` border, and `flex: none`. Verify `pnpm run policy`
      reports no colour literal. Verify the chip text meets AA text contrast in the
      `target-and-contrast` sweep once task 3.4 adds the preview states.
- [x] 3.3 Verify the defence and offence panels do not pass `classChip`. Their existing unit tests and
      the `offence-profile` end-to-end code-line step must pass unchanged.
- [x] 3.4 Add two states to the `module-identity-badge` preview and its component contract: the
      class chip with a code, and the class chip for an article without class or rating. Verify
      `preview-manifest.spec.ts` passes and both states are on the preview index the target and
      contrast sweep walks.

## 4. Dense ledger row

- [x] 4.1 Add a `dense` input (default `false`) to `ednb-slot-card`. When it is on, the card writes
      `data-density="dense"` on the row and passes `classChip` to the badge. In the dense state, the
      select control takes `min-block-size: var(--ednb-target-size-dense)` and inline padding
      `--ednb-space-xl`. The size box and the node badge take the dense layout measures, and the
      size-box figure takes `--ednb-text-size-label`. Verify with a unit test that the attribute and
      the chip appear only when `dense` is on. Task 4.6 verifies the chip does not change colour
      with selection.
- [x] 4.2 Add a `dense` input (default `false`) to `ednb-slot-group`. When it is on, the group rule
      stands `--ednb-space-2xs` clear of its first row and is inset `--ednb-space-xl`. In the
      outfitting workspace, pass `dense` as `composition() !== 'compact'` to every card and group.
      In the two-pane and wide compositions, set the ledger rail to `--ednb-space-md` between groups
      and before the first group.
      Keep `--ednb-space-sm` after the last row. Verify with a workspace unit test that the cards
      and groups are dense in the two-pane and wide compositions and not in the compact one. Add a
      dense state to the `slot-group` preview and its component contract, and verify
      `preview-manifest.spec.ts` passes and the state is on the preview index the target and
      contrast sweep walks. Task 4.6 measures
      the rail spacing.
- [x] 4.3 Add three dense states to the `slot-card` preview, and add them to the component
      contract's state list: a fitted engineered mount with class and rating, selected; the same
      mount unselected; and an empty mount. Verify `preview-manifest.spec.ts` passes and the three
      states are on the preview index the target and contrast sweep walks.
- [x] 4.4 Add `.slot[data-density='dense'] .slot__select` to `DENSE_TARGETS` in
      `e2e/accessibility/assertions.ts`, with a comment that cites canvas 1c, SC 2.5.8 and the accepted requirement "Contrast and
      target size" (`openspec/specs/platform/accessible-responsive-operation/spec.md`). The comment
      cites no path under `openspec/changes/`, because this change's folder moves when it is
      archived. Verify the `target-and-contrast` sweep
      passes, and verify it fails if a row in the compact composition is drawn under 44 pixels.
- [x] 4.5 Change `expectEquivalentControls` to measure each ledger row's width and height against `TARGET_FLOOR_PX`, and
      update its comment and the comments on both `EQUIVALENT_TARGETS` constants, in
      `e2e/accessibility/assertions.ts` and in `e2e/accessibility/axe.ts`, to state the 24-pixel
      equivalent in place of the 44-pixel baseline. Rename the `hull-anatomy` end-to-end test that calls
      it, "offers every drawn mount at the full baseline in the ledger", to "offers every drawn
      mount at the criterion's minimum in the ledger", and verify it passes at every layout
      profile. That test is the evidence for the scenario "The ledger
      shows another kind of mount": at a compact profile it opens on hardpoints, presses through the
      category choices on the same screen, and measures each utility row it reaches against
      `TARGET_FLOOR_PX`. Verify it fails when a utility row is drawn under 24 pixels in either dimension. Add a step to the same test for the compositions that are not `compact`: press hardpoints,
      verify the utility choice is on the same screen, press it, and measure the utility rows
      against `TARGET_FLOOR_PX`.
- [x] 4.6 Add an end-to-end step that runs in every layout profile and reads `data-composition`.
      Verify the step passes in all ten projects (five profiles, Chromium and Firefox). Wherever the
      composition is not `compact`, it verifies seven things:
  - every ledger row's select control, an empty mount included, is at least 24 CSS pixels wide and
    at least 36 pixels tall;
  - a fitted Anaconda row with no wrapped code line is 36 to 37 pixels tall (36, with a pixel for
    rounding);
  - the selected row's chip reads its class and rating;
  - the chip's computed colour and border colour are the same on the selected row and on an
    unselected row;
  - the rail measures 10 pixels between groups and before the first group, 4 pixels from a group
    rule to its first row, and 8 pixels after the last row;
  - on a fitted row, the size box measures 22 pixels, the node badge 18 pixels, the select
    control's inline padding 14 pixels, the group rule's inline inset 14 pixels and the size-box
    figure 10 pixels;
  - the selected row's accessible name contains the module name followed by its chip text.

  Where the composition is `compact`, it verifies the rows are at least 44 pixels tall, carry no
  chip, and keep the 28-pixel size box, the 22-pixel node badge, the 16-pixel inline padding, the
  11-pixel figure, 12 pixels between groups and before the first group, 8 pixels from a group rule
  to its first row, and 8 pixels after the last row.

- [x] 4.7 Run the two existing name-cut end-to-end tests in `e2e/module-outfitting.spec.ts`
      ("never loses a module name the row is too narrow to draw" and "keeps the whole name reachable
      at doubled text") and the `module-engineering` ledger steps. Verify they pass with the chip on
      the name line in the two-pane and wide compositions. Extend the first name-cut test to read `data-composition`. Where it is
      not `compact`, on a row whose name is cut, verify the chip's scroll width is no greater than
      its client width. Where it is `compact`, verify the row draws no chip. Extend "keeps the whole name reachable
      at doubled text" the same way: where the composition is not `compact`, verify the chip's scroll
      width is no greater than its client width and the chip's box lies inside the row's box.
- [x] 4.8 Register the renamed test and its new step from 4.5, and the step from 4.6, as named assertions in `e2e/coverage-ledger.ts` on the
      `build/hull-anatomy-targets` entry (`010/FR-012`), naming the scenarios "The ledger is the size
      equivalent" and "The ledger shows another kind of mount". Register the dense-row step also on
      the entry that evidences `011/FR-012` (contrast and target size). Verify
      `pnpm run policy:specs` passes. Verify with `grep` that each named assertion's title appears on the stated entry, because
      `policy:specs` passes on these requirement ids whether or not the new tests are registered.
- [x] 4.9 In `ednb-slot-card`, draw the size box on every row but a utility mount's, which keeps
      only its node number, in every composition (design.md, "A utility row draws its node number
      and no size box"). Restate the comment above the size box so it describes what is drawn.
      Verify with a unit test that a utility row draws its node badge and no size box, and a
      hardpoint, a core and an armour row each draw their size box. Add an end-to-end step that
      runs in every layout profile, shows the utility mounts and verifies that no utility row draws
      a size box, every utility row draws its node badge, and a hardpoint row still draws both.
      Register the step on `build/outfitting-ledger` in `e2e/coverage-ledger.ts`. Verify the step
      passes in all ten projects, `pnpm run policy:specs` passes, and the title is on its entry by
      `grep`.

## 5. Integration

- [x] 5.0 Restate every source comment that cites a ruling this change replaces, so it describes
      the rows as they are drawn: the compact rows by canvas 1d and the archived ruling, the dense
      rows by canvas 1c and the dense measures. Verify with `grep -rn` over `src/` and `e2e/` for
      "The rail is one ground", "No `ALL` at compact width", "The code line is not cut", "Divergence
      from FR-012" and "44" next to "ledger" that every hit matches the behaviour it describes.
- [x] 5.1 Run `pnpm run check`, and verify it passes in full: format, help artefacts, typecheck,
      both builds, policy, unit coverage at or above 80%, and the ten-project end-to-end matrix with
      its accessibility scan.
- [x] 5.2 Compare the wide ledger against canvas 1c in `.design/Ship Builder.dc.html` at the
      1440×900 profile. Verify that the row measure, the chip, the group spacing and the category
      order match, and that each departure (8 pixels after the last row, 4 pixels under a group rule,
      no chip tooltip) is the one design.md records. Compare the compact ledger against canvas 1d
      at the 390×844 profile, and verify the category order, the `4A` at the start of the code line
      and the absence of a chip.
