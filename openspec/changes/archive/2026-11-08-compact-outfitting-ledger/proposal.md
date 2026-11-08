## Why

The Ship Builder design (`.design/Ship Builder.dc.html`, canvases 1c and 1d) now draws the outfitting
ledger in a tighter measure, so more mounts fit on one screen where the ledger sits beside the
bench. An Anaconda carries thirty-nine mounts, and at the current 44-pixel row that ledger needs
about a screen and a half.
The design also offers the mount kinds in the same order in which the ledger draws them. The
application offers them in a different order.

## What Changes

- Offer the kinds a Commander can narrow the ledger to in the order the ledger draws them:
  hardpoints, utility mounts, core internals, optional internals. This applies in every composition. The
  application currently offers hardpoints, core internals, optional internals and then utility
  mounts.
- Where the ledger sits inline beside the bench (the two-pane and wide compositions, which both
  draw canvas 1c's ledger rail), draw each ledger row at the dense 36-pixel target
  (`--ednb-target-size-dense`) in place of the 44-pixel baseline. The size box goes from 28 to 22
  pixels, and the node badge from 22 to 18 pixels, and the size-box figure from 11 to 10 pixels.
  The row's inline inset goes from 16 to 14 pixels. The space between groups and before the first
  group becomes 10 pixels, and a group rule stands 4 pixels clear of its first row in place of 8.
  design.md "Screens" lists every measure. The compact composition keeps its current rows.
- In the same two compositions, move the fitted module's class and rating (`4A`) out of the code
  line into a hairline chip beside the module name. The code line keeps the mount and the
  engineering (`GIMBALLED · OVERCHARGED G5 · CORROSIVE`). The compact composition keeps the class
  and rating at the start of the code line, as canvas 1d draws it.
- Restate the size equivalent the hull anatomy marks rely on. The ledger is still the equivalent
  control under SC 2.5.8, but its rows meet the criterion's 24-pixel minimum, not the 44-pixel
  baseline.

The work does not include:

- The utility-mount group in the ledger, the utility marks on the hull anatomy, and the empty mount
  without a size caption. The application already does these.
- The anatomy analysis panels (power, drives, defence, offence). A separate change covers them.
- Journal import of several builds. Its current behaviour stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/module-outfitting`: Add a requirement for the order in which the ledger offers the
  mount kinds. It follows the order in which the ledger draws them. Add a second requirement, "The
  ledger holds the Commander's choice of kind while it is offered". The two also record three
  behaviours the application already has: the ledger shows the first choice offered where the Commander has made no choice, a chosen kind
  stays shown while it is offered, and armour and the cargo hatch sit with the core internals. Only
  the order changes.
- `ship-builder/hull-anatomy`: In "Marks are anchored, separately operable and move as little as the
  plate allows", state that the ledger's equivalent rows meet SC 2.5.8's 24-pixel minimum. The
  current text says they meet the 44-pixel baseline. Also state that, where the ledger shows one
  kind of mount at a time, the choice that shows a mount's kind is on the same screen as the plate.
  The application already behaves this way, but the requirement did not say it. Add two scenarios:
  "The ledger is the size equivalent" and "The ledger shows another kind of mount".

## Impact

The change affects:

- the outfitting workspace's category list and its unit and end-to-end coverage;
- the ledger rail's spacing in the two-pane and wide compositions: the workspace's styles, and a
  `dense` input on `ednb-slot-group` for its rule's clearance and inset;
- the ledger row (`ednb-slot-card`) and the module identity badge (`ednb-module-identity-badge`).
  The badge also serves the defence and offence panels, so the chip is drawn only when the caller
  asks for it;
- the primitive and semantic token layers, which get dense measures for the size box and the node
  badge;
- the end-to-end accessibility assertions in `e2e/accessibility/assertions.ts`. The dense ledger row
  joins `DENSE_TARGETS`, so the sweep holds it to the 24-pixel floor rather than the 44-pixel
  baseline. `expectEquivalentControls` measures the ledger's equivalent rows against the same floor. The
  comments on `expectEquivalentControls` and on both `EQUIVALENT_TARGETS` constants (in
  `assertions.ts` and `e2e/accessibility/axe.ts`) are restated to match;
- the `slot-card`, `slot-group` and `module-identity-badge` entries in the UI preview catalogue and their
  component contracts, which get four dense states (three for the slot card, one for the slot group) and two class-chip
  states;
- the end-to-end tests in `e2e/module-outfitting.spec.ts` (the category order, the dense-row
  and rail measures in every profile, and the two name-cut tests) and `e2e/hull-anatomy.spec.ts` (the equivalent check, renamed from "at the full baseline" and given a
  step for the compositions that are not compact);
- the coverage ledger `e2e/coverage-ledger.ts`, which registers the new assertions;
- the design file `.design/Ship Builder.dc.html`, whose revision is committed with this change;
- archived design records whose statements are no longer current. In
  `openspec/changes/archive/002-module-outfitting/design/outfitting-workspace.md`: "The rail is one
  ground" (the row measure, the inset, the size box, the node badge, the group spacing and the group
  rule clearance), wave 9's size-box figure, the code-line paragraph and the bullet "The code line is
  not cut" (the `4A` at the start), "No `ALL` at compact width" (the category order), and "All
  targets meet 44 CSS px". In
  `openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md`: "Divergence from FR-012" (the
  ledger at the full 44-pixel baseline), and `contracts/slot-targeting.md`, "Accessibility and
  feedback" (the same targets at full size). This change's design records what replaces them, and the
  archives stay as they are.

The change needs no new localised string, no package call and no dependency.
