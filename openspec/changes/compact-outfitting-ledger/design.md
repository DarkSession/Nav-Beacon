## Context

See proposal.md for the motivation. Three archived records hold the rulings this change replaces. The
archives stay as they are, and this document is the record of what is current:

- `openspec/changes/archive/002-module-outfitting/design/outfitting-workspace.md`:
  - "The rail is one ground": the 44-pixel row, 12 pixels between groups, the group rule 8 pixels
    clear of its first row, and the canvas's inset, size box and node badge measures;
  - wave 9, "The size box is drawn the same on every row", for its `11px` figure only (its rule
    that the box does not change with selection still stands);
  - the paragraph that sets the code line as `4A GIMBALLED · OVERCHARGED G5 · CORROSIVE`, and the
    bullet "The code line is not cut", for its `4A` and its "44px measure is a floor" (the line is
    still not cut);
  - the accessibility list's "All targets meet 44 CSS px", for the dense rows;
  - "No `ALL` at compact width", which records the strip in the order hardpoints, core, optional,
    utility.
- `openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md`: "Divergence from FR-012",
  which says the ledger carries every mount "at the full 44-pixel baseline". The Equivalent
  exception it records still stands. Only the size of the equivalent changes.
- `openspec/changes/archive/010-hull-anatomy/contracts/slot-targeting.md`, "Accessibility and
  feedback": the ledger is "the same targets at full size". It is now the same targets at the
  criterion's minimum or more.

The facts that shape the approach:

- The outfitting workspace has three compositions, from `observeComposition()`: `compact`,
  `two-pane` and `wide`. `benchIsLayer()` is true only at `compact`. In `two-pane` and `wide` the
  ledger is canvas 1c's inline rail beside the bench, and the rows are drawn the same in both. A
  short viewport is `compact` at any width. The same `ednb-slot-card` draws a ledger row in all
  three.
- `ednb-module-identity-badge` draws the module name, the projected route marks and the code line.
  The ledger, the offence weapon list and two places in the defence panel use it. Only the ledger
  changes.
- The badge already speaks the class and rating in words (`codeDescription`, the
  `outfitting.module.code` message) beside the drawn code. The visible `4A` is a code, and the
  spoken text is what a screen reader relies on.
- The token layer has `--ednb-target-size-dense` (36 pixels, from `--ednb-target-min-compact`) and
  a 24-pixel floor. The size box (`--ednb-layout-mount-box`, 28 pixels) and the node badge
  (`--ednb-layout-node-box`, 22 pixels) have one measure each. The hull anatomy also uses the node
  measure for its marks.
- The end-to-end target sweep (`e2e/accessibility/assertions.ts`) holds every control to the
  44-pixel baseline, except the `DENSE_TARGETS` list, which it holds to the 24-pixel floor.
  `expectEquivalentControls` holds every ledger row to 44 pixels, because the hull marks claim the
  ledger as their SC 2.5.8 equivalent. It already presses through the category choices to reach a
  mount whose kind is not shown, which is how the equivalent stays on the same screen while the
  ledger is narrowed.
- `ShipLoadout.slots()` returns the kinds in one order for all 49 hulls in the package catalogue:
  hardpoint, utility, armour, core, optional, cargo hatch.

## Goals / Non-Goals

**Goals:**

- Where the ledger is the inline rail, a row is 36 pixels or the height its content needs,
  whichever is taller.
- One category order, the same as the order in which the ledger draws its groups.
- The class chip and the dense row are both opted into by the caller. No other surface that uses
  the badge or the row changes.

**Non-Goals:**

- No change to the rows in the compact composition. Canvas 1d draws them as before.
- No change to the hull anatomy marks or to their measure.
- No tooltip on the chip. Canvas 1c gives it a `title` of "Fitted module class". The spoken text
  already says that, and the row is a control, so a nested tooltip would be a second target inside
  the first.

## Screens

The change introduces no screen. It changes the ledger rail of the outfitting workspace.

**Ledger rail, two-pane and wide compositions.**

- Composes `ednb-slot-group` and `ednb-slot-card` as now. Both take a new `dense` input, and the
  workspace passes `composition() !== 'compact'` to each.
- A dense row: `min-block-size: var(--ednb-target-size-dense)`, block padding none (as now),
  inline padding `--ednb-space-xl` (14 pixels). Size box and node badge use new dense measures
  (22 and 18 pixels). The size-box figure takes `--ednb-text-size-label` (10 pixels).
- The rail: `--ednb-space-md` (10 pixels) between groups, and `--ednb-space-md` before the first
  group. The space after the last row stays `--ednb-space-sm` (8 pixels), which the Commander set on
  2026-08-28. In a dense group, the group rule stands `--ednb-space-2xs` (4 pixels) clear of its first row and
  is inset `--ednb-space-xl` (14 pixels), the rows' own inset. Canvas 1c draws `0 14px 5px`, and the
  scale has no 5.
- The name line: the module name, then the class chip, then the route marks. The name shrinks and
  is cut first, as now. The chip and the marks are `flex: none`.
- The chip's text is inside the row's button, as the code line's was, so it stays part of the
  button's accessible name, in the order it is drawn: the name, then `4A`. The spoken
  `codeDescription` still follows, so the name holds the visible label and the words for it (SC
  2.5.3).
- The chip: the `4A` code in the metric face at `--ednb-text-size-micro`, in the quiet ink, inside
  a hairline border in `--ednb-border-field`. The border is decorative, because the text carries the
  meaning.
- The code line: the mount and the engineering only (`GIMBALLED · OVERCHARGED G5 · CORROSIVE`). It
  is still not cut, and it wraps where it must. A row that wraps grows past 36 pixels.

**Which choice is shown.** A press in the category strip sets the Commander's choice. The change does not alter when it is set or cleared,
only the order of the choices.

**Open question, outside this change.** Where the ledger shows one kind at a time, activating a
hull-anatomy mark of another kind (a utility mark while hardpoints are shown) leaves the kind shown
as it is. The hull-anatomy requirement "Movement between geometry and outfitting" says activation
marks the mount's outfitting row, and it does not say whether that row must then be on screen. The
module-outfitting requirement "The ledger holds the Commander's choice of kind while it is offered"
covers the first draw and changes to the choices offered, and does not decide this either. This
change neither creates nor resolves it. It is reported to the Commander as a separate question.

**Ledger rail, compact composition.** No change to the rows or to the rail's spacing: 12 pixels
(`--ednb-space-lg`) between groups and before the first group, 8 pixels after the last row, and the
group rule where it is now. The category strip offers four kinds in
the new order, and hardpoints are shown when the ledger opens, as now.

**Which layout profiles draw which composition.** The test matrix runs five profiles. The 1440×900
desktop draws `wide`, and the 1112×834 tablet in landscape draws `two-pane`. Both draw dense rows.
The 390×844 and 844×390 phones draw `compact`. The 834×1112 tablet in portrait is decided by the
region's measured width, so the end-to-end step reads `data-composition` in every profile and checks
dense rows wherever it is not `compact`. It does not assume a fixed list.

**States the row handles.** These are the states it handles now. Only the drawing of the class
changes:

- **Fitted, with class and rating.** The chip shows the code.
- **Fitted, missing its class, its rating or both.** `code()` needs both, so there is no code, no
  chip and no placeholder, as the code line drew none before. How the badge reports a missing class or
  rating is unchanged by this change.
- **Empty.** There is no module, so there is no chip. The row still meets the dense target.
- **Selected.** The selected mark stays as it is. The chip does not change colour with selection,
  for the same reason as the size box (archive 002, wave 9).
- **Name cut.** The chip stays whole beside the reachable ellipsis.
- **Doubled text or a narrow rail.** The `20em` container rule still decides whether the row cuts or
  wraps. A wrapped row grows, and the chip wraps with the name line and stays whole inside the row.

The rows satisfy the hull-anatomy requirement "Marks are anchored, separately operable and move as
little as the plate allows" (the size equivalent, and the equivalent on the same screen while the
ledger is narrowed). The category strip satisfies the module-outfitting requirements "The ledger offers the mount kinds in a fixed order" and "The ledger holds the Commander's choice of kind while it is
offered". The dense row and the chip satisfy the platform
requirement "Contrast and target size" (platform/accessible-responsive-operation): the row meets the
24-pixel floor and the chip text meets AA text contrast. They also satisfy "Accessible names, roles,
states and relationships": the row's accessible name still contains its visible label.

## Decisions

**The Commander's ruling of 2026-11-07.** The ledger rows that canvas 1c draws go from the 44-pixel
baseline to the 36-pixel dense target. The target sweep holds them to SC 2.5.8's 24-pixel floor,
which is the AA criterion the constitution adopts. The project's 44-pixel baseline is a design
choice that is stricter than AA. It stays in force for every other control, and for the ledger rows
in the compact composition. Journal import of several builds keeps its current behaviour, so the
design's "open the first build" flow is not built.

**Dense wherever the ledger is the inline rail.** `two-pane` and `wide` draw the same canvas 1c
rail, and today they draw the same rows. Making only `wide` dense would give one rail two row
measures, depending on whether a 306-pixel status column fits beside it. That difference has
nothing to do with the ledger.

**One `dense` input on the slot card and the slot group, and one `classChip` input on the badge.**
The workspace already knows its composition, so it tells the card and the group. The group needs
its own input because its rule's clearance and inset live in its own stylesheet. The card passes `classChip` to the badge when it is
dense. Two alternatives were considered and refused. `:host-context([data-composition])` in the card's
stylesheet would make a shared component depend on a parent attribute that is invisible to its own
API. A CSS-only change cannot move the code out of one line and into another. The badge input is
separate from the card input because the badge is also used in panels that have no "dense" idea.

**The badge composes the chip itself.** The code (`code()`) and the code line already come from the
badge. With `classChip` on, `codeLine()` leaves out the code and the template draws it on the name
line. The spoken `codeDescription` is unchanged, so the announced text stays the same. The
alternative was for the slot card to draw the chip and pass a null class to the badge. That would
lose the spoken description and split one identity across two components.

**Category order: one list, in the ledger's order, pinned against every hull.** `COMPACT_CATEGORIES`
becomes `hardpoint, utility, core, optional`, and the wide list stays `all` followed by that list.
Deriving the list at run time from the slots would offer no tab for a kind the build has none of.
That is a different behaviour, and nobody asked for it. Every one of the 49 hulls carries all four kinds, so no build
has a tab with no mounts. The hull test asserts that too, so a hull without one fails it and needs a
decision before it ships. A unit test walks every hull in the package
catalogue (`SHIPS`), maps `ShipLoadout.default(hull).slots()` through `CATEGORY_KINDS`, and checks
that the kinds first appear in the list's order. A package release that reorders the slots fails the
test and does not leave the two orders apart.

**Three components show the new states in the preview catalogue.** The badge gets a class-chip state with a code and one without a code. The slot card gets three dense states: a fitted engineered mount selected, the same mount unselected, and an empty mount. The slot group gets a dense state. Every component ships with a
preview of the states it must handle (constitution VII), and the target and contrast sweep measures
the preview index.

**The design revision is committed with the change.** `.design/Ship Builder.dc.html` holds canvases
1c and 1d as this change reads them. The repository is the source of truth for the design tool, so
the revision is committed in the same pull request. Before it is committed, it is formatted with
the repository's Prettier, and its licence link points back at this repository's own name.

**Dense measures as new tokens.** Add `--ednb-measure-mount-box-dense` (1.375rem) and
`--ednb-measure-node-box-dense` (1.125rem) to the primitives, and
`--ednb-layout-mount-box-dense` and `--ednb-layout-node-box-dense` to the semantic layer. Changing the
existing measures would also shrink the compact rows and the hull marks.

**The target sweep names the ledger row as dense.** Add `.slot[data-density='dense'] .slot__select`
to `DENSE_TARGETS`, with a comment that cites canvas 1c, SC 2.5.8 and the platform requirement "Contrast and target
size". It cites no path under `openspec/changes/`, because this change's folder moves when it is
archived. The compact row is not
named, so it is still held to 44. `expectEquivalentControls` measures against `TARGET_FLOOR_PX`,
which is what SC 2.5.8 asks of the equivalent. Its comment and the comment on `EQUIVALENT_TARGETS`
say so. `e2e/accessibility/axe.ts` keeps its own `EQUIVALENT_TARGETS`, which excludes the marks
from axe's target-size rule. Its exclusion is unchanged, and its comment, which says the ledger carries
every mount "at the full 44-pixel baseline", is restated with the 24-pixel equivalent.

## Risks / Trade-offs

- [A 36-pixel row is a smaller target than the project's 44-pixel baseline, and the tablet profiles
  that draw the inline rail are used by touch] → The row is half again the 24-pixel AA minimum
  (platform/accessible-responsive-operation, "Contrast and target size"), and the sweep holds it to
  that floor in every profile and both engines. Rows are stacked with no gap, so a row's whole box
  is its target, and the next target starts where it ends.
- [The chip adds width to the name line, so long names are cut sooner] → The cut is already a fold
  with a reachable whole name (SC 1.4.4 ruling in archive 002). The existing German test,
  `never loses a module name the row is too narrow to draw`, runs in every profile and covers it.
- [Two class placements, one per composition] → Both come from the same `code()` and the same
  spoken description. The difference is where the code is drawn, not what it says.

## Migration Plan

None. The change touches presentation only, with no stored data, build link or setting. A revert
restores the previous rows.
