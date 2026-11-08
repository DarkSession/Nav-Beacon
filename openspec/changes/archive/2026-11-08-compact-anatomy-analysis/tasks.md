## 1. Shared

- [x] 1.1 Verify `compact-outfitting-ledger` is applied (its tasks.md has every box checked and
      `pnpm run check` passes on the branch) before starting. This change builds on it.
- [x] 1.2 Add a `dense` input (default `false`) to `ednb-metric-group`. When it is on, each cell is
      padded `--ednb-space-xs` in the block direction and `--ednb-space-sm` in the inline
      direction, and nothing else changes. Add a dense state to the `metric-group` preview and its
      component contract. Verify with a unit test that the cell padding changes only when `dense`
      is on, that `preview-manifest.spec.ts` passes, and that the state is on the preview index the
      target and contrast sweep walks.
- [x] 1.3 In each of the four panels (power, drives, defence, offence), set block padding to
      `--ednb-space-md` by `--ednb-space-lg`, the gap between blocks to `--ednb-space-md`, the stack
      gap inside a block to `--ednb-space-sm`, and pass `dense` to every `ednb-metric-group` that remains. Add one
      end-to-end step to each panel's spec file that runs in every layout profile and measures a
      block's padding (10 and 12 pixels), the gap between two items stacked inside a block (8 pixels), the gap between two blocks (10 pixels, where two stand side
      by side or one above the other) and a tile's padding (6 and 8 pixels): a `DISSIPATION` tile in power and a shield summary tile in
      defence. Drives keeps no tile once task 3.1 removes its metric group, and offence composes
      none, so their steps measure no tile. Register each step on its
      panel's `-reflow` entry in `e2e/coverage-ledger.ts`. Verify the steps pass in all ten projects,
      `pnpm run policy` reports no token violation, `pnpm run policy:specs` passes, and each title is
      on its entry by `grep`.
- [x] 1.4 Add `ednb-fit-text` to the design system (`src/app/ui/components/fit-text/`), from the
      pattern `module-identity-badge` uses for a cut module name. It draws a text in full. Where the
      caller's rule holds the text on one line and the text does not fit, it cuts the text and draws
      a `…` after it. The `…` is a presentational `ednb-tooltip` that shows the whole text on hover
      and on a press, and it is drawn only while the text is cut (measured on resize and on a new
      text). The whole text stays in the document, so a screen reader reads it whole. Where the
      caller's rule lets the text wrap, it wraps between words, and a word too long for the box
      is cut the same way rather than broken. Add its preview state and its component
      contract. Verify with unit tests that the `…` and its tip appear only while the text is cut,
      that the tip holds the whole text, and that the whole text is in the accessibility tree, and
      that `preview-manifest.spec.ts` passes.

## 2. Power

- [x] 2.1 Add `$container-power-row-min` and a `container-power-row-up` mixin to
      `src/styles/_responsive.scss`. Set its value by measurement: render the power panel with the
      Anaconda default build in English and in German, narrow the panel in `0.5rem` steps, and take
      the narrowest width at which, in both languages, no block's `scrollWidth` exceeds its
      `clientWidth`, no figure is cut, the summary tiles stand three across and the heat tiles two
      across, and no block other than the distributor has fallen to its narrow arrangement. A label
      may be cut (task 2.7). Record the method and the figure in a comment, and expose the step on
      the panel's host as `--power-row-min`. At that step, lay the four blocks out in one row
      (`minmax(0, 1.1fr)` then three `minmax(0, 1fr)`), in the order priority groups, draw by
      module, heat profile, distributor. Keep two rows of two from `40rem` and one column below it.
      If the panel at a 2020×1228 viewport (79.875rem when measured) is narrower than the step,
      stop and report the two widths to the Commander before going on. Verify by extending the
      end-to-end test "lays the four blocks out in two rows of the same width, whatever it has". It
      reads the panel's width and the step from the panel's `--power-row-min` custom property. It
      expects one row (four blocks with one top edge, in the stated order) at or above the step,
      two rows of two between `40rem` and the step, and one column below `40rem`. In the desktop
      projects it also sets a 2020×1228 viewport and expects one row there. Verify it passes in all
      ten projects, and that "loses no figure in an expanded translation" and "stacks its blocks at
      400% zoom" still pass.
- [x] 2.2 Remove `firingDrained` from `HEAT_SCENARIOS` in
      `src/app/domain/ships/power-heat/power-heat.ts`, and restate its doc comment. Update
      `power-heat.spec.ts` so it expects four scenarios in the order idle, thrusters, FSD charging,
      sustained fire, with the shield bank spike after them. Add a unit test that gives the
      drained-capacitor scenario the largest load and verifies, on a build with no shield cell bank, that the track scale equals the largest of the four
      projected scenarios. Add a unit test on a build with no weapons that verifies the sustained-fire
      bar is the package's `heatMetricsResult()` scenario and no unavailable state is drawn. Verify
      `pnpm test` passes.
- [x] 2.3 In `power-thermals`, remove the drained entries from `SCENARIO_LABELS` and
      `SCENARIO_DESCRIPTIONS`, remove `heatLegend` and its markup and styles, remove the
      `RESTING HEAT` and `PEAK SUSTAINED` tiles from `heatFacts` (leaving `DISSIPATION` and
      `HEAT SINKS`), and remove the heat block's `container-wide-up(heat)` split so the tiles stand
      under the bars at every width. After the level of an overheating bar, add the visually hidden
      words `power.heat.over`. Update the unit tests at `power-thermals.spec.ts`:
  - the scenario labels test expects no `Weapons alpha`;
  - the non-settling test uses `firingSustained` in place of `firingDrained`;
  - the legend test is replaced by one that verifies no key is drawn;
  - the tiles test expects two tiles;
  - a new test verifies an overheating bar carries the hidden words, the overheat hatch
    (`heat__over` with a width) and its level figure, and a bar within the limit carries neither the
    words nor the hatch;
  - an overheating shield cell bank bar carries the hidden words, the hatch and its level figure.

  Verify `pnpm test` passes.

- [x] 2.4 Remove `power.heat.scenario.firing-drained`, its `.description`, `power.heat.within`,
      `power.heat.resting` and `power.heat.peak` from `en.json` and `de.json`. Verify with
      `grep -rn` over `src/` that no key is still referenced, and that `pnpm run policy` passes its
      message catalogue checks.
- [x] 2.5 Update the end-to-end heat test in `e2e/power-and-heat.spec.ts`. In every layout profile,
      it verifies the four scenario bars are drawn in order with their labels from the English
      catalogue, the shield cell bank bar follows them where a bank is fitted, no `Weapons alpha`
      bar is drawn, no key is drawn, and the tiles are `DISSIPATION` and `HEAT SINKS`. On a build
      whose sustained fire overheats, it verifies that bar's accessible text contains
      "Over threshold", and an axe scan of the heat block finds no violation. Verify it passes in all
      ten projects.
- [x] 2.6 In `e2e/coverage-ledger.ts`, restate the `build/power-and-thermals-heat` assertion "the
      five returned scenarios…" as four drawn scenarios with the drained-capacitor scenario left
      out, and add an assertion for the overheat words. Restate the `build/power-and-thermals-reflow`
      assertions for one row, two rows of two and one column, and register the cut-label step from
      task 2.7. Verify `pnpm run policy:specs` passes, and verify with `grep` that each restated
      title is on the stated entry.
- [x] 2.7 At the one-row step, hold every label in the four blocks on one line: the tile labels,
      the priority group labels, the module names in draw by module, the heat scenario labels and
      the distributor's labels. Draw each through `ednb-fit-text` (task 1.4), so a label that does
      not fit is cut with the reachable `…`. A heat scenario label is already the trigger of its
      own gloss: where it is cut, its tooltip shows the whole label before the gloss, and no second
      tooltip is drawn. Figures are never cut. Below the step, labels wrap between words, and a word too long for its
      box is cut the same way rather than broken. Any metric group
      change is opt-in, so no other user of the metric group changes. Verify with unit tests, and
      with an end-to-end step in the desktop projects at a 2020×1228 viewport in German that finds
      "Kraftwerksleistung" cut, hovers its `…` and reads the whole label in the tooltip, and finds
      every figure in the panel uncut (`scrollWidth` not over `clientWidth`).

## 3. Drives

- [x] 3.1 In `drives-mass`, replace `jumpCells` and its `ednb-metric-group` with one line under the
      Frame Shift Drive card's heading, above the hairline and the `RANGE BY LOAD` rows: the label
      from `drives.fsd.mass-lock` with the `micro-label` mixin, and the value from `drive.massLock`
      in the range row's value style, on a baseline-aligned wrapping row. Where `drive.massLock` is
      null, draw `ednb-unavailable-value` with the shared unavailable wording. Remove
      `jumpCellsLabel`. Set the range legend's gap to `--ednb-space-xs`, and verify it measures 6
      pixels in the end-to-end step of task 3.3. Update the unit tests in `drives-mass.spec.ts` that read the jump cells, and
      add tests that verify the line's value is the hull's mass lock and that a null mass lock reads
      as unavailable, never as `0`. Verify `pnpm test` passes.
- [x] 3.2 Change `drives.fsd.mass-lock` to "Mass lock factor" in `en.json` and "Massensperrfaktor"
      in `de.json`. Remove `drives.fsd.jump-laden`, `drives.fsd.jump-unladen` and
      `drives.fsd.summary`. Verify with `grep -rn` over `src/` that no removed key is referenced, and
      that `pnpm run policy` passes.
- [x] 3.3 Update `e2e/mobility-and-jump.spec.ts`. Replace the three-cell step with one that runs in
      every layout profile and verifies the mass lock line stands before the first range row, reads
      the catalogue label, that no jump tile is drawn, and that the range legend's gap measures 6
      pixels. Change the status rail step so the rail's
      `JUMP` cell is compared with the `FULL CARGO` range row's value (`.drives__range-value`).
      Verify both pass in all ten projects, and that the German translation test passes.
- [x] 3.4 Restate the `build/drives-and-mass-cards` assertions in `e2e/coverage-ledger.ts` that name
      the trio, and register the mass lock line step and the rail step. Verify
      `pnpm run policy:specs` passes and each title appears on the stated entry with `grep`.

## 4. Defence

- [x] 4.1 Add `defence.view.summary` ("Summary", "Übersicht"), `defence.view.sources` ("Sources",
      "Quellen"), `defence.view.shield` ("Shield readings", "Schildwerte") and
      `defence.view.armour` ("Armour readings", "Panzerungswerte") to `en.json` and `de.json`.
      Verify `pnpm run policy` passes its message catalogue checks.
- [x] 4.2 In `defence-analysis`, give each card a signal for its chosen view (summary by default)
      and a computed that says whether the card has sources: for the shield a role contribution from
      `shieldMetricsResult()` or a bank from `cellBanks()`, for the armour a contribution from
      `armourMetrics()`. Where the card has sources, draw an `ednb-tab-group` with `presentation="segmented"` in
      the card's head, labelled by `defence.view.shield` or `defence.view.armour`, with the two
      choices. Draw any shield diagnosis above both views. Draw only the chosen view with `@if`. The shield summary holds the pool, the damage table and the recovery tiles. The shield sources hold the source rows and the
      reserve. The armour summary holds the pool, the damage table and the tiles. The armour sources
      hold the source rows. A card with no sources draws no choice and shows its summary. Verify with
      unit tests:
  - both cards show the summary at first, and each offers its choice;
  - choosing the shield's sources shows the source rows and the reserve with every bank, and leaves
    the armour's view as it was;
  - with no shield, choosing the armour's sources shows the bulkhead and reinforcement rows;
  - a card with no sources draws no tab group and shows its summary;
  - a card showing its sources draws no pool and no damage table;
  - a card whose sources go shows its summary, and shows the chosen sources again when they come
    back;
  - after the sources are chosen and the panel is destroyed and created again, the card shows its
    summary, and still shows it after its last source is removed and restored;
  - an unfed generator's diagnosis is shown with either view chosen;
  - each summary holds its pool, its damage table and its tiles, and no source row;
  - a shield with no role contribution and no bank draws no choice.

  Update the existing source and reserve tests in `defence-analysis.spec.ts` to choose the sources
  first. Verify `pnpm test` passes.

- [x] 4.3 Remove the `tfoot` scale under the damage bars, and any computed or style only it used.
      Keep the zero line inside a signed track. Replace the scale unit tests with one that verifies
      no scale row is drawn, and keep the zero-line test. Verify `pnpm test` passes.
- [x] 4.4 Update `e2e/defence.spec.ts`. In every layout profile, a step verifies:
  - each card's choice names both views, summary is pressed, and the sources are not in the
    accessibility tree;
  - pressing the shield's sources shows the source rows and the reserve, sets its pressed state, and
    leaves the armour on its summary;
  - each choice meets the 24-pixel floor `DENSE_TARGETS` holds `.tab` to;
  - an axe scan with each card on its sources view finds no violation.

  Add a step at the mobile portrait profile in German that verifies no card head overflows
  (`scrollWidth` at most `clientWidth`) and the choice is whole.

  Add a step that presses the shield's sources, opens another anatomy mode, opens the defence mode
  again and verifies both cards show their summary.

  Change the sources step and the sources count step to press the sources first, keeping "no button
  inside `.sources`". Change the scale step to verify no scale row is drawn. Add a step on a build
  with no shield that presses the armour's sources and finds the bulkhead row. Verify each passes in
  all ten projects, the defence panel's 400% zoom test still passes, and the `target-and-contrast`
  sweep passes.

- [x] 4.5 In `e2e/coverage-ledger.ts`, replace the `build/defence-analysis-shields` assertion that
      states the scale, restate the `build/defence-analysis-reflow` assertion "complete at every
      width" so it names the choice, and register the steps from 4.4 on
      `build/defence-analysis-sources`. Verify `pnpm run policy:specs` passes and each title appears
      on the stated entry with `grep`.
- [x] 4.6 Draw a unit head over each source list: `MJ` over the shield's source rows and `HP` over
      the armour's, right-aligned over the figures in the `micro-label` face and `aria-hidden`.
      Draw each contribution as a bare number, and carry its unit as visually hidden text inside
      the figure (design.md, "The source lists' unit head"). Take the units from the message
      catalogue. Verify with unit tests that each head reads its unit, that a figure's visible text
      has no unit, and that its accessible text has the unit. Add an end-to-end step in
      `e2e/defence.spec.ts` that runs in every layout profile, chooses each card's sources, and
      verifies the head reads `MJ` or `HP`, each figure's accessible name ends in that unit, and an
      axe scan of the sources finds no violation. Register the step on
      `build/defence-analysis-sources`. Verify `pnpm test` passes, the step passes in all ten
      projects, `pnpm run policy:specs` passes, and the title is on its entry by `grep`.

## 5. Offence

- [x] 5.1 Set `--ednb-measure-convergence-block` to `11.875rem` and `--ednb-measure-gunsight-plate`
      to `9.375rem`, with comments naming canvas 1c's 190 and 150 pixels. Add
      `$container-offence-row-min` and its mixin, measured as in task 2.1 (Anaconda, English and
      German, a label may be cut), with the weapons block's six-column rows (its `36rem` step) as a
      further condition, and expose it on the panel's host as `--offence-row-min`. If the panel at a
      2020×1228 viewport is narrower than the step, stop and report the two widths to the Commander
      before going on. At that step, lay the three blocks in one row
      (`minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, var(--ednb-layout-convergence-block))`).
      Between `40rem` and the step, keep the
      pair with the convergence under it at the leading edge. Below `40rem`, one column. At the
      step, hold the labels on one line and draw each through `ednb-fit-text`, and give the weapon
      names the badge's existing cut-name tip, so a label that does not fit is cut with the
      reachable `…`. Figures are never cut. In `shot-convergence`, centre the plate and put the
      readout under it at every width, pad the convergence block `--ednb-space-md` by
      `--ednb-space-lg`, set an `--ednb-space-xs` gap between the plate and the readout, and remove
      the readout's flex basis. Verify by extending the end-to-end gunsight measure test. In every
      layout profile it verifies the plate is square, 150 pixels (±1), and lies wholly inside its
      block, the readout's top is below the plate's bottom, and the convergence block's padding (10
      and 12 pixels) and the gap between the plate and the readout (6 pixels) are as stated. It reads
      the step from `--offence-row-min`. At or above the step it verifies the three blocks share a
      top edge in the order weapons, damage, convergence. Between `40rem` and the step it verifies
      the weapons and the damage share a top edge and the convergence block stands below them at the
      leading edge, no wider than its column. Below `40rem` it verifies one column. In the desktop
      projects it also sets a 2020×1228 viewport and expects three columns. Verify it passes in all
      ten projects and `pnpm run policy` reports no token violation.
- [x] 5.2 Add `groupIdenticalWeapons` to `src/app/domain/ships/offence/offence.ts`. It takes the
      `FittedWeaponMetrics` list and the package `FittedModule` records keyed by slot, and returns
      groups in package order, each standing at its first member's position. Weapons share a group
      when their records give the same `symbol`, `preEngineeredVariant`, `engineering` (compared by
      value) and `on`, and their five package figures are equal as returned. A weapon with no record
      has its own group. Add unit tests in `offence.spec.ts`:
  - two identical weapons give one group, at the first one's position, with both weapons;
  - two weapons that differ only in engineering, only in `on`, only in pre-engineered variant, or
    only in one figure give two groups;
  - two figures that format the same but differ as returned give two groups;
  - weapons A, B and A′ in that order, A and A′ identical, give the groups [A, A′] then [B];
  - a shared group lists every member's slot key;
  - a weapon with no record gives its own group.

  In `offence-analysis.ts`, make one row per group. Give `WeaponRowView` a `slots` list and a
  `count`, with the first member's slot key as `id`. Replace the test "neither merges…" with one that
  verifies the rows follow the groups, and add tests that a shared row's `slots` carries every
  member's slot key and that no slot key appears in the row's rendered text, and that the `MOUNTED`
  heading counts weapons, not rows. Verify `pnpm test` passes.

- [x] 5.3 Pass the badge the name alone, and the class, rating, mount and engineering only where
      another row shows the same name, compared as the resolved name's text. Follow the name of a row with `count` above 1
      by `offence.weapon.count` (`×{{count}}`) and the visually hidden
      `offence.weapon.count.description` (`{{count}} identical weapons, figures for each`, `{{count}} identische Waffen, Werte je Waffe`), with
      the drawn `×N` `aria-hidden`. Add both keys
      to `en.json` and `de.json`. Verify with unit tests that a uniquely named row has no code line,
      that both rows of a pair with one name and different engineering have code lines, that the
      count reads `×2` with the hidden words "2 identical weapons, figures for each" and the drawn count is `aria-hidden`, that a `×2`
      row's burst figure is one member's `damagePerSecond` and not the sum, that a fixed and a gimballed weapon with one name both
      get code lines, that a weapon with no `fittedModules()` record is named from its weapon-metrics
      symbol, that a weapon whose record carries a pre-engineered variant is named by
      `getPreEngineeredVariantName()` for that variant, that a row for one weapon draws no count, and that a missing class or rating is
      left out rather than filled in. Verify `pnpm test` passes.
- [x] 5.4 Put the WEP pips in the capacitor heading: `offence.capacitor.heading` followed by
      `offence.capacitor.at-pips` (`@ {{pips}} pips`, `@ {{pips}} Pips`) in `--ednb-text-danger`,
      read from the WEP pips the power and heat capability's shared conditions hold, formatted for the active locale at
      `PIP_DIGITS` as today, and never from
      `weaponsCapacitorMetrics().weaponsPips`. Add `offence.capacitor.at-pips` to `en.json` and `de.json`. Remove the `bars__condition`
      line and `offence.capacitor.allocation` from both catalogues, and verify with `grep -rn` over
      `src/` that the removed key is not referenced and that `pnpm run policy` passes. Where the projection has
      no capacitor figure, draw the heading alone, and verify with a unit test that no pips are stated
      then. Update the capacitor unit tests, and verify the heading
      reads `@ 3 pips` at three WEP pips and follows the pip control when it changes, that the block
      states its pips exactly once, that 2.5 WEP pips read `2.5` in English and `2,5` in German, and that no `bars__condition` line is drawn. Verify
      `pnpm test` passes and the `target-and-contrast` sweep passes on the panel.
- [x] 5.5 Update `e2e/offence-profile.spec.ts`:
  - the test "keeps two mounts … two rows" verifies that two identical mounts draw one row with
    `×2`, and that a mount with different engineering draws a row of its own with a code line;
  - the code-line step verifies a uniquely named row draws no code line;
  - the two steps that count `.weapon` as the armed count sum each row's count instead;
  - a step in every layout profile verifies the `MOUNTED` count equals the number of fitted weapons
    and the capacitor heading carries the pips;
  - on the build with a `×2` row, an axe scan of the weapons block finds no violation.

  Verify each passes in all ten projects.

- [x] 5.6 In `e2e/coverage-ledger.ts`, replace the `build/offence-analysis-weapons` assertions "one
      row per returned weapon … no duplicate-symbol merge" and "two mounts carrying the same module
      stay two rows" with the grouping and name assertions from 5.2, 5.3 and 5.5. Restate the
      `build/offence-analysis-convergence` and `build/offence-analysis-reflow` assertions for the
      new plate, the three columns, the pair with the convergence under it, one column and the cut
      labels. Register the capacitor heading step on `build/offence-analysis-capacitor`. Verify `pnpm run policy:specs` passes and each title
      appears on the stated entry with `grep`.

## 6. Integration

- [x] 6.1 Restate every source comment that cites a ruling this change replaces, so it describes
      what is drawn now. Verify with `grep -rn` over `src/` and `e2e/` for "two rows of two",
      "Weapons alpha", "firingDrained", "headline trio", "trio", "no control of its own", "508",
      "14rem", "172px", "neither sorts nor merges" and "Read at" that every hit matches the
      behaviour it describes. Verify no comment cites a path under `openspec/changes/` that is not
      archived.
- [x] 6.2 Update `e2e/manual/screen-reader.protocol.md`. Rewrite step 18's drive card paragraph so
      it expects the mass lock factor to be announced as one label-and-value pair before the range
      rows, and the jump figures as the range rows' own. Add a step for the anatomy panels that
      expects each defence card's choice to be announced as two buttons with the summary pressed,
      the sources to be read after a press, and an offence row that stands for two weapons to be
      announced with "2 identical weapons, figures for each", and an overheating heat bar to be announced with "Over
      threshold". Raise the protocol's `**Version**` from 15 to 16. Verify by reviewing the protocol's diff against design.md
      "Screens", and that `pnpm run format:check` passes.
- [x] 6.3 Run `pnpm run check`, and verify it passes in full: format, help artefacts, typecheck,
      both builds, policy, unit coverage at or above 80%, and the ten-project end-to-end matrix with
      its accessibility scan.
- [x] 6.4 Compare each panel against canvas 1c in `.design/Ship Builder.dc.html` at 2020×1228,
      the canvas's own width, where power stands in one row and offence in three columns, at the
      1440×900 profile, and at 390×844, where the same readings stand in one column. Verify that the readings,
      their order and the measures in design.md "Screens" match, and that each departure is one
      design.md records, including the outer panel padding left to `hull-anatomy`, the 9-pixel heat
      track, the pip steps at the floor, the range field's own track, the
      content-sized columns inside a block, the segmented choice in place of the canvas's tabs,
      the code line where two names collide, the labels cut with a reachable `…`, and power's two
      rows of two and offence's pair below the canvas's width.
