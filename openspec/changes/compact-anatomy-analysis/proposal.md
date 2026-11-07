## Why

The Ship Builder design (`.design/Ship Builder.dc.html`, canvas 1c) now draws the four anatomy
analysis panels (power, drives, defence, offence) in less space. It removes readings that repeat
another reading or that it no longer draws, and it puts the offence panel's shot convergence beside the
weapons instead of under them. A Commander can then read a panel without scrolling past ground that
carries nothing. The application still draws the earlier, taller panels.

## What Changes

The panels draw one version at every width. Where a panel is too narrow for the canvas's columns,
its blocks stack as they do now, but nothing is left out and nothing is added at a narrow width.

- **All four panels.** Smaller padding and gaps inside each panel, and tighter tiles, following
  canvas 1c (design.md "Screens" lists every measure).
- **Power.** Where the panel is wide enough, the four blocks stand in one row: priority groups, draw
  by module, heat profile, distributor. Today they stand in two rows of two. The heat profile:
  - draws four of the package's five scenarios, and the shield cell bank's bar as now. **BREAKING
    (spec):** the drained-capacitor scenario ("Weapons alpha") is removed;
  - removes the within-limit and over-threshold key, and keeps the overheat state as the hatch and the level
    figure, with visually hidden words for a screen reader;
  - keeps two tiles, `DISSIPATION` and `HEAT SINKS`, and removes `RESTING HEAT` and `PEAK
SUSTAINED`.
- **Drives.** The Frame Shift Drive card removes its three tiles (`JUMP LADEN`, `JUMP UNLADEN`,
  `MASS LOCK`). The two jump figures are already the ends of the `RANGE BY LOAD` rows beneath them.
  The mass lock becomes one line, `MASS LOCK FACTOR`, under the card's heading.
- **Defence.** The shield card and the armour card each offer a choice between a summary and its
  sources. The summary is shown first. It holds the pool, the damage table and the tiles. The
  sources hold the source modules, and on the shield card also the cell bank reserve. Each card
  holds its own choice. The `0%` and `100%` scale under the damage bars is removed.
- **Offence.**
  - Where the panel is wide enough, shot convergence becomes a third column beside the weapons and
    the damage by type, with a smaller plate and the target range under it.
  - A weapon row draws the module name without its code line, except where two rows would otherwise
    read the same.
  - Weapons that carry the same module with the same engineering, the same enabled state and the
    same five figures share one row, written `×N`. The row shows one weapon's figures, not a sum.
  - The weapon capacitor's heading states the WEP pips it is read at (`@ 3 PIPS`), in place of the
    separate line under the bars.

The work does not include:

- the outfitting ledger, the ledger categories and the class chip, which `compact-outfitting-ledger`
  covers. This change builds on that one;
- journal import of several builds, whose current behaviour stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/power-and-heat`: "Heat scenarios" shows four of the five scenarios
  `heatMetricsResult()` returns and leaves out the drained-capacitor scenario. It also requires an
  overheating scenario or shield cell bank bar to be identifiable without its colour.
- `ship-builder/defence-profile`: Add three requirements and change three. "The shield and the
  armour each offer a summary and their sources" states what each view holds, and that a shield
  diagnosis is shown in both. "The shield and the armour each hold their own choice" states when
  each has sources, that the summary is shown first, and that each holds its choice on its own.
  "The choice of view follows the sources" shows the summary while there are none and restores the
  last choice when a source returns. "Shield readings", "Cell bank readings" and "Armour readings"
  show the contributions and the banks once the sources are chosen.
- `ship-builder/offence-profile`: Add three requirements and change four.
  - Added: "Identical weapons share a row" (one weapon's figures with a count), "The mounted count
    counts weapons" and "A weapon row names its module" (the code line only where two rows show the
    same name).
  - "Weapon list readings": each weapon keeps its slot key, including one that shares a row, and a
    row names its module rather than stating its engineering.
  - "The gunsight plate" no longer fixes the plate's size.
  - "Capacitor endurance": the block states once the WEP pips it is read at.
  - "Readings the canvas does not draw" sanctions three departures from the archived canvas contract: the
    shared row with its count, the row without a code line, and the WEP pips in the capacitor's
    heading.

`ship-builder/mobility-and-jump` does not change. The jump figures stay in the range rows, at the
same load and precision as the status rail's `JUMP` cell, and the mass lock is still the hull's
catalogue fact.

## Impact

The change affects:

- the power panel (`power-thermals`): its layout, the heat block and its unit tests. The domain
  projection `power-heat.ts` stops projecting the drained-capacitor scenario, so the heat track's
  scale is set by the four scenarios that are drawn;
- the drives panel (`drives-mass`): the tiles and the mass lock line;
- the defence panel (`defence-analysis`): the two choices, which use the design system's segmented
  `ednb-tab-group`, and the removal of the scale;
- the offence domain projection (`src/app/domain/ships/offence/offence.ts`), which groups identical
  weapons;
- the offence panel (`offence-analysis`, `shot-convergence`): the rows drawn from those groups, the name-only rows, the
  three-column layout, the capacitor heading, and the gunsight measure tokens;
- the design system's `ednb-metric-group`, which gets a dense state for the tighter tiles, with a
  preview state and its component contract;
- the English and German message catalogues: keys are removed (the drained scenario and its description,
  `power.heat.within`, the two removed tiles, `drives.fsd.jump-laden`, `drives.fsd.jump-unladen`,
  `drives.fsd.summary` and `offence.capacitor.allocation`); keys are added (`defence.view.summary`,
  `defence.view.sources`, `defence.view.shield`, `defence.view.armour`, `offence.weapon.count`,
  `offence.weapon.count.description` and `offence.capacitor.at-pips`); and `drives.fsd.mass-lock`
  is reworded;
- the manual screen-reader protocol `e2e/manual/screen-reader.protocol.md`, whose drives step names
  the removed tiles;
- the end-to-end tests `e2e/power-and-heat.spec.ts`, `e2e/mobility-and-jump.spec.ts`,
  `e2e/defence.spec.ts` and `e2e/offence-profile.spec.ts`, and the coverage ledger
  `e2e/coverage-ledger.ts`;
- archived design records whose statements are no longer current:
  - `openspec/changes/archive/005-power-and-heat/design/screen-inventory.md`: the "Heat profile" row
    (the bars beside four tiles);
  - `openspec/changes/archive/005-power-and-heat`: the canvas contract's "Panel layout" (two rows
    of two) and "3. HEAT PROFILE", and the detail's "Heat profile";
  - `openspec/changes/archive/006-defence-profile`: "Responsive and interaction rules" ("the panel
    holds no control of its own") and the scale ruling;
  - `openspec/changes/archive/007-offence-profile`: the canvas contract's "Panel layout", "1.
    WEAPONS" and review notes 20 and 21 (the 508px block and the 14rem plate);
  - `openspec/changes/archive/007-offence-profile/design/screen-inventory.md`: the "Offence
    Analysis panel" row and the FR-004 row (one row per weapon), and
    `component-state-preview-matrix.md`: the duplicate-symbols weapon state;
  - `openspec/changes/archive/007-offence-profile/design/offence-profile.md`: the 508px block, the
    rows that neither sort nor merge, the code line on every row, and the `14rem` plate; and the
    canvas contract's "What is built" rows for the block and the plate and its departure 2 (the WEP
    allocation as a line beneath the rows);
  - `openspec/changes/archive/006-defence-profile/design/screen-inventory.md`: "The panel holds no
    control of its own";
  - `openspec/changes/archive/008-mobility-and-jump`: "The headline trio" and "The two cards"
    items 3 and 4 in the profile, "The status rail" (`JUMP` as the `Jump laden` cell), and the trio
    in the screen inventory, and its reference review's trio;
  - `archive/005-power-and-heat`: `contracts/heat-profile.md` (the five scenarios, the no-weapons
    line and the two removed tile rows) and `design/reference-review.md` (the five scenarios and
    the key);
  - `archive/007-offence-profile/contracts/weapon-output.md`: "Do not … merge duplicate symbols or
    collapse weapons into counts".

  This change's design records what replaces them, and the archives stay as they are.

The change needs no package call and no dependency.
