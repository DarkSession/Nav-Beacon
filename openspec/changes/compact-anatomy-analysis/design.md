## Context

See proposal.md for the motivation. The change builds on `compact-outfitting-ledger`, which is
applied first. Archived records hold rulings this change replaces. The archives stay as they
are, and this document is the record of what is current:

- `openspec/changes/archive/005-power-and-heat/design/screen-inventory.md`: the "Heat profile"
  row, which draws the bars beside four tiles.
- `openspec/changes/archive/005-power-and-heat`: the canvas contract's "Panel layout" (two rows of
  two) and "3. HEAT PROFILE" (the drained-capacitor bar, the key, the `RESTING HEAT` and `PEAK
SUSTAINED` tiles), and the detail's "Heat profile" for the same three.
- `openspec/changes/archive/006-defence-profile/design/defence-profile.md`: "Responsive and
  interaction rules", where "the panel holds no control of its own", and the ruling of 2026-08-28
  that drew the `0%` and `100%` scale under the damage bars.
- `openspec/changes/archive/007-offence-profile/design/canvas-contract.md`: "Panel layout" (the
  weapons and the damage as a pair, the convergence under them), "1. WEAPONS" (a code line on
  every row, one row per weapon), review note 20 (the 508-pixel block) and review note 21 (the
  `14rem` plate).
- `openspec/changes/archive/007-offence-profile/design/screen-inventory.md`: the "Offence Analysis
  panel" row (the `1fr 1fr` pair with convergence full-width below) and the FR-004 row ("Every
  returned weapon is one inert row").
- `openspec/changes/archive/007-offence-profile/design/component-state-preview-matrix.md`: the
  weapon-collection state "duplicate symbols in distinct exact slots", which now draws one shared
  row where the two weapons are identical.
- `openspec/changes/archive/007-offence-profile/design/offence-profile.md`: the 508-pixel block
  (lines 40 and 154), "neither sorts nor merges … two rows" (lines 66-67), the code line on every
  row (line 72) and the `14rem` plate (line 139). In the canvas contract's "What is built", the rows
  for the 508-pixel block and the `14rem` plate, and departure 2, which names the WEP allocation as
  a line beneath the four rows.
- `openspec/changes/archive/006-defence-profile/design/screen-inventory.md`: "The panel holds no
  control of its own".
- `openspec/changes/archive/008-mobility-and-jump/design/mobility-and-jump-profile.md`: "The
  headline trio", "The two cards" items 3 and 4 (the trio and its hairline), and "The status rail",
  where `JUMP` is the drive card's `Jump laden` cell. It is now the `FULL CARGO` range row.
- `openspec/changes/archive/008-mobility-and-jump/design/screen-inventory.md`: the trio.
- `openspec/changes/archive/005-power-and-heat/contracts/heat-profile.md`: the five scenarios with
  `firingDrained` (lines 3-4 and 32), "With no weapons, all five scenarios remain present" (line
  54), and the `RESTING HEAT` and `PEAK SUSTAINED` rows (lines 81-82 and 125-129).
- `openspec/changes/archive/005-power-and-heat/design/reference-review.md`: "the exact five heat
  scenarios" (line 24), and `WITHIN LIMIT` and `OVER THRESHOLD` with the key that names both fills
  (lines 166-169 and 366).
- `openspec/changes/archive/007-offence-profile/contracts/weapon-output.md`: "Do not … merge
  duplicate symbols or collapse weapons into counts" (lines 133-134).
- `openspec/changes/archive/008-mobility-and-jump/design/reference-review.md`: the headline trio
  (lines 56, 86 and 94).

The facts that shape the approach:

- The four panels are hosted by `hull-anatomy` and each lays itself out from its own inline size
  through a container query. `container-wide-up` opens at `40rem`. Below it every panel is one
  column, which is the compact arrangement. Nothing in the panels reads `observeComposition()`.
- Each panel draws its blocks with `--ednb-space-2xl` block padding and `--ednb-space-panel` inline
  padding, and `--ednb-space-region` between blocks. The tiles are `ednb-metric-group`, whose cells
  take `--ednb-space-lg` all round. The panels already hold no minimum height.
- The power panel's heat block draws the package's five scenarios and, where a bank is fitted, the
  shield cell bank's spike. Each scenario name is a tooltip trigger. The heat track is
  `--ednb-measure-power-bar` (9 pixels), already finer than canvas 1c's 10.
- The distributor's pip steps are buttons at the 24-pixel floor (`DENSE_TARGETS`), and the
  distributor already falls back to canvas 1d's three-line arrangement below `30rem` of its own
  width.
- The power panel already uses `ednb-tab-group` with `presentation="segmented"` for `DEPLOYED` and
  `RETRACTED`. The segmented presentation draws `aria-pressed` buttons and has a preview state.
- The offence panel's weapon rows use `ednb-module-identity-badge` in its compact variant, which
  draws the name and a code line from the class, rating, mount and `detail`. Left without them, the
  badge draws the name alone. `weaponRows` makes one row per weapon in the package's order.
- Weapon figures come from `BuildMetrics.weaponMetrics()` (`FittedWeaponMetrics`), which carries
  no engineering. The engineering, the pre-engineered variant and the symbol come from the package
  `FittedModule`, which the workspace projects as `FittedModuleView` and `engineeringView()`.
- The gunsight plate is `aria-hidden`, and the mount statements (`ul.shots`) are visually hidden
  text that follows it, so moving the readout under the plate moves no visible sentence.
- The mass lock comes from `getShipBySymbol(loadout.shipSymbol).masslock`, which the mobility
  projection already carries as `drive.massLock`.

## Goals / Non-Goals

**Goals:**

- Every panel draws one set of readings at every width. Only the arrangement changes with width.
- Every removed reading is one the canvas no longer draws, and every reading kept is the same
  package figure as before.
- Every new control and every new variant is composed from the design system and has a preview
  state.

**Non-Goals:**

- The outfitting ledger, which `compact-outfitting-ledger` covers.
- Canvas 1d (compact) as a separate drawing. It is not yet updated, and the Commander chose one
  trimmed version of each panel for every width.
- Canvas 1c's fixed column widths inside a block (the module name's 104 pixels, the share's 34
  pixels, the heat label's 92 pixels). The blocks keep their content-sized grids, because the German
  labels are longer than the English ones.

## Screens

The change introduces no screen. It changes the four panels of the hull anatomy region.

**Common to all four panels.**

- A block takes `--ednb-space-md` (10 pixels) block padding and `--ednb-space-lg` (12 pixels)
  inline padding, in place of 16 and 18. Blocks stand `--ednb-space-md` apart, in place of
  `--ednb-space-region`. Inside a block, the stack gap is `--ednb-space-sm` (8 pixels) in place of 13.
- Every `ednb-metric-group` in the four panels takes a new `dense` input. A dense cell is padded
  `--ednb-space-xs` (6 pixels) by `--ednb-space-sm` (8 pixels), in place of 12 all round. Nothing
  else that uses the metric group changes.
- The canvas's outer panel padding (`4px 20px 10px`) belongs to `hull-anatomy` and is left as it
  is, because it also frames the plates.

**Power.** Satisfies power-and-heat "Heat scenarios" and keeps "Distributor readings" and "Pip
allocation".

- Arrangement: four blocks in one row, `minmax(0, 1.1fr)` then three `minmax(0, 1fr)`, in the order
  priority groups, draw by module, heat profile, distributor. No block but the distributor falls to
  its narrow arrangement at that step. They stand in one row where the panel is at
  least `$container-power-row-min` wide, a new container step. Between `40rem` and that step they
  stand as two rows of two, as now. Below `40rem` they are one column, as now. The step's value is
  measured (task 2.1): the narrowest panel at which every block keeps its content in English and
  German with nothing cut or overflowing. The panel exposes the step on its host as the custom
  property `--power-row-min`, so the end-to-end test reads the same value the container query uses.
- Heat profile: the bars, then the tiles under them, at every width. The block's own split (bars
  beside the key and tiles at `container-wide-up(heat)`) is removed, because a block that is a
  quarter or half of the panel never reaches it.
- Bars: idle, thrusters, FSD charging, sustained fire, and the shield cell bank where one is fitted.
  The track scale is set by the bars drawn, so dropping the drained-capacitor bar lengthens the
  others wherever it was the longest.
- An overheating bar, the shield cell bank's included, keeps its colour and its hatch, a pattern that does not depend on colour, and
  its level is followed by the visually hidden words `power.heat.over` ("Over threshold"). With the key gone, these words are how a reader who is
  told learns the state, and the level figure beside the hatch is how a reader who sees it learns it. An overheating
  scenario never settles, so `heatMetricsResult()` gives it an infinite level and its figure is the
  `∞` symbol with its meaning. The shield cell bank's bar, from `heatLevelAtTime`, reads a figure
  above 100%.
- Tiles: `DISSIPATION` and `HEAT SINKS` (with its `2 × 3` breakdown), two across.
- Distributor: as now. In a quarter column it falls to its three-line arrangement. Its pip steps
  stay at the 24-pixel floor. Canvas 1c draws them at 11 pixels, which is under SC 2.5.8's minimum.
- States: heat unavailable (one `ednb-unavailable-value`, as now); no bank (four bars); a scenario
  that never settles (`∞` with its meaning, as now).

**Drives.** Keeps mobility-and-jump "Jump values from the package summary" and "Status rail cells
agree with the drive cards".

- The Frame Shift Drive card removes its three tiles. Under the card's heading, and above the
  hairline and the `RANGE BY LOAD` rows, one line: the label `MASS LOCK FACTOR` and the hull's
  value, at the two ends of a baseline-aligned wrapping row. The label uses the `micro-label`
  mixin, and the value uses the range row's value style. Where the catalogue has no mass lock, the
  value is `ednb-unavailable-value` with the shared unavailable wording, as the tile's was.
- The jump figures stay in the range rows: `UNLADEN` is the package's `maximum`, `FULL CARGO` is its
  `laden`, at the same `RANGE_DIGITS`. The status rail's `JUMP` cell equals the `FULL CARGO` row.
- The legend's gap is `--ednb-space-xs` (6 pixels), in place of 9.
- States: no drive (the card's existing absent state); loads that do not settle (the range rows'
  existing reasons). The mass lock line is drawn for every hull, as the tile was.

**Defence.** Satisfies defence-profile "The shield and the armour each offer a summary and their sources",
"The shield and the armour each hold their own choice" and "The choice of view follows the sources",
and the changed "Shield readings", "Cell bank readings" and "Armour readings".

- Each card's head: the heading and identity on one side, and on the other an `ednb-tab-group` with
  `presentation="segmented"`, labelled by the card (`Shield readings`, `Armour readings`), with
  two choices, `SUMMARY` and `SOURCES`. The canvas draws them as plain `div` tabs. The design
  system's segmented group is the existing pattern for one of two views, and it gives each choice a
  real button, a pressed state and a target at the 24-pixel floor: `.tab` is already in
  `DENSE_TARGETS`. Where the head is too narrow for both (German, a narrow card, 400% zoom), the
  choice wraps under the heading rather than cutting or overflowing.
- A shield diagnosis (refusal, the generator's power state) stands under the card's head, above
  both views, so it is shown whichever is chosen.
- Shield summary: the pool, the damage table and the
  recovery tiles (`RECHARGE`, `0→100%`, `BROKEN RESET`). Shield sources: the `MJ` head, the source
  rows, a hairline and the cell bank reserve with every bank.
- Armour summary: the pool, the damage table with its in-track zero line, and the tiles
  (`HARDNESS`, `MODULE PROT.`, `INTEGRITY`). Armour sources: the `HP` head and the source rows.
- Only the chosen view is in the document (`@if`, not hidden by style), so a reader is never read
  the view that is not shown.
- The choice is a signal per card in the panel. It lasts while the panel is drawn. Leaving the
  defence mode removes the panel, so each choice starts at summary each time the mode opens. A card
  with no sources draws no choice and shows its summary. A card whose sources disappear (the last
  source removed) shows its summary, and if they come back while the panel is drawn, it shows the
  Commander's last choice. Drawing the panel anew (a composition change that rebuilds the anatomy
  mode) also starts each choice at summary. That counts as opening the defence profile, an accepted
  reading of the requirement, recorded here under constitution IX.
- The `0%` and `100%` scale row (`tfoot`) under the damage bars is removed. The zero line inside a
  signed track stays.
- A shield has sources when `shieldMetricsResult()` returns a role contribution or `cellBanks()` a
  bank. Armour has sources when `armourMetrics()` returns a contribution. A shield with neither has
  nothing the sources view could hold, so it offers no choice.
- States: shield absent, shield refused, banks fitted or not, banks unpowered, armour with no
  reinforcement.

**Offence.** Satisfies offence-profile "Identical weapons share a row", "The mounted count counts
weapons", "A weapon row names its module", "Weapon list readings", "Capacitor endurance", "The gunsight plate" and "Readings the canvas does not draw".

- The one-row step is the narrowest panel at which the weapons block still draws its six-column
  rows (its own `36rem` step from archive 007's screen inventory), and no block overflows.
- Arrangement: three columns, `minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, var(--ednb-layout-convergence-block))`
  (the semantic token that points at `--ednb-measure-convergence-block`),
  weapons then damage by type then shot convergence. They stand in one row where the panel is at
  least `$container-offence-row-min` wide, a new container step measured as for power (task 5.1).
  Between `40rem` and that step, the weapons and the damage stand as a pair with the convergence
  under them, at the leading edge and no wider than its column. Below `40rem` they are one column. The panel exposes the step on its host as the custom property
  `--offence-row-min`, as power does.
- `--ednb-measure-convergence-block` becomes `11.875rem` (190 pixels), and
  `--ednb-measure-gunsight-plate` becomes `9.375rem` (150 pixels). The block is padded
  `--ednb-space-md` by `--ednb-space-lg` with an `--ednb-space-xs` gap. The plate is centred, and the
  readout (`TARGET RANGE`, the range field, the `500 m … 5,000 m` scale) stands under it at every
  width. The flex basis that held the readout beside the plate is removed.
- The range field keeps the design system's own track and thumb, so its target stays at the floor.
  Canvas 1c's 10-pixel track is not copied.
- Weapon rows: the badge gets the name alone, and the class, rating, mount and engineering only
  where another row shows the same name (compared as the resolved name's text, so a fixed and a
  gimballed weapon with one name both get code lines). A row that
  stands for several weapons follows the name with `×N` (`offence.weapon.count`) in the name's line,
  with the visually hidden words `offence.weapon.count.description` ("{{count}} identical weapons, figures for each"). The
  drawn `×N` is `aria-hidden`, so a screen reader reads the count once. A reader who sees the row
  gets the count and no visible "each": the Commander chose per-weapon figures with `×N`, as the
  canvas draws it. Whether a visible "each" is needed is left to the Commander's review.
- Grouping: a pure function in the offence domain projection (`offence.ts`,
  `groupIdenticalWeapons`) takes the `FittedWeaponMetrics` list and the package `FittedModule`
  records, keyed by slot. Weapons share a group when their records give the same `symbol`, the same
  `preEngineeredVariant`, the same `engineering` (blueprint, level, experimental effect and
  modifiers, compared by value) and the same `on`, and their five package figures
  (`damagePerSecond`, `sustainedDamagePerSecond`, `armourPiercing`, `maximumRange`,
  `falloffRange`) are equal as returned, before any formatting. A weapon with no record has a group
  of its own. Each group lists its weapons in package order and stands at its first member's
  position. The panel makes one row per group: its `id` is the first member's slot key, `slots`
  carries every member's, and `count` is the group's size.
- The `MOUNTED` count in the heading stays the number of weapons, not the number of rows.
- The capacitor heading reads `WEAPON CAPACITOR` followed by `@ 3 PIPS` (`offence.capacitor.at-pips`)
  in `--ednb-text-danger`, read from the WEP pips the power and heat capability's shared conditions hold and never from
  `weaponsCapacitorMetrics().weaponsPips`. The separate `Read at 3 WEP pips` line is removed. Where the projection
  has no capacitor, the heading stands alone.
- States: no weapons, all weapons off, a refused gunsight, a hull whose mounts do not resolve.

## Decisions

- **One drawing at every width.** The Commander chose the trimmed panels everywhere. Canvas 1d is
  not yet updated, so it does not add or keep a reading the change removes. The alternative, keeping
  the old content below `40rem`, would carry two sets of tests for one capability.
- **The segmented tab group, not new tabs.** Constitution VII sends a missing pattern into the
  design system first. The pattern is not missing: `ednb-tab-group` already draws one of two views
  in the power panel. The alternative, a toggle drawn in the panel, would be a control with no
  preview and no contract.
- **This reverses 006's "the panel holds no control of its own".** That ruling kept the panel free
  of controls because the canvas drew none. Canvas 1c now draws two per panel, and the spec delta
  records the behaviour.
- **The grouping key includes the figures.** The Commander chose per-weapon figures with `×N`. A
  row can only show one weapon's figures if every member's figures are the same, so the figures are
  part of the key rather than assumed from the engineering. Comparing two package figures for
  equality derives nothing.
- **Code line where names collide.** Canvas 1c draws the name alone. Two rows that name the same
  module (same weapon, different engineering or state) would then read the same, and the badge
  already has the precedent of showing its symbol only where two rows would otherwise match. The
  alternative, the name alone always, leaves two identical-looking rows with different figures.
- **The grouping lives in the domain.** It compares package records and figures, which is domain
  logic under constitution III, so it sits beside `projectOffence` with its own unit tests, as the
  heat projection sits in `power-heat.ts`. The panel only draws the groups.
- **The badge needs no new input.** `compact-outfitting-ledger` adds `classChip`, which the offence rows do not set.
  Leaving the class, rating, mount and detail unset already draws the name alone, so no input is
  added for this change.
- **The drained-capacitor projection is removed at the domain.** `HEAT_SCENARIOS` in
  `power-heat.ts` drops `firingDrained`, so no caller can draw it and the track scale is computed
  from what is drawn. The alternative, filtering in the panel, would leave the scale set by a bar
  nobody sees.
- **The mass lock wording.** `drives.fsd.mass-lock` becomes "Mass lock factor" (German
  "Massensperrfaktor"), which is the canvas's label and the game's own term.
- **The capacitor's pips use the danger ink.** Canvas 1c draws them in `var(--hot)`, which the
  token layer names `--ednb-text-danger`, at 5.95:1 or better.

## Risks / Trade-offs

- **The four-in-a-row step may exceed the panel at 1440 × 900.** If the measured
  `$container-power-row-min` is wider than the power panel at the wide profile, the panel stays in
  two rows there. Task 2.1 stops and reports this to the Commander rather than shrinking text or
  cutting labels (constitution IX).
- **The three-column step may exceed the offence panel at 1440 × 900.** Task 5.1 stops and reports
  this as task 2.1 does for power.
- **Grouping hides that two weapons sit in different mounts.** The hull anatomy and the ledger still
  draw each mount, and the row keeps every slot key.
- **Removing the key moves meaning into hidden words.** The colour and hatch were explained by a
  visible key. They are now explained by the level figure and the hatch for a sighted
  reader, and by the hidden words for one who is told.
- **A longer heat bar is not a hotter build.** Dropping the drained bar rescales the track. The
  figures do not change.

## Migration Plan

No data or link format changes. The change ships in one release. A rollback restores the old
panels with no stored state to undo.
