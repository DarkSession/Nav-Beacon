## Purpose

This capability presents power generation and draw, priority shedding, distributor capacitors and
the heat scenarios the Almanac returns for the active build, together with the hardpoint state and
pip allocation those results are read under.

## Requirements

### Requirement: Almanac supplies every power and heat value

Every numeric value and calculation MUST come from `@elite-dangerous-almanac/core` without local
recomputation.

Source: 005/FR-001, 005/SC-001.

#### Scenario: A displayed figure is compared with the package

- **WHEN** the capability displays a value or a state
- **THEN** it equals the corresponding Almanac field for the active build

### Requirement: Power budget readings

Power MUST use `BuildMetrics.powerBudget()` for plant capacity, the selected hardpoint state's total
draw, and the per-group draw, cumulative draw and powered state of every priority group this build
puts something in. A group nothing is assigned to MUST NOT be drawn. Package `headroom`,
`utilisation` and `withinBudget` MUST NOT be shown in either hardpoint state.

`powerBudget()`'s `headroom`, `utilisation` and `withinBudget` fields describe deployed hardpoints
only, and the package publishes no retracted equivalent. The application MUST NOT calculate a
retracted equivalent, and MUST NOT reintroduce the deployed ones without the design drawing them.

Source: 005/FR-002.

#### Scenario: A priority band is drawn

- **WHEN** the build assigns at least one module to a priority group
- **THEN** that group shows its draw, its cumulative draw and its powered state for the selected
  hardpoint state

#### Scenario: A priority group holds nothing

- **WHEN** the build assigns no module to a priority group
- **THEN** the capability draws no row for that group

#### Scenario: The build has no power plant

- **WHEN** the build has no power plant
- **THEN** draw remains reportable and plant capacity is zero

### Requirement: Hardpoint state selection

The power budget MUST show only one hardpoint state at a time, MUST default to deployed and MUST
allow the Commander to switch between deployed and retracted. This capability owns that selection; it
is in memory only and reaches no route, history, storage, saved build or export.

Source: 005/FR-003, 005/SC-002.

#### Scenario: The Commander switches hardpoint state

- **WHEN** the Commander switches between deployed and retracted
- **THEN** the power budget shows that state alone
- **AND** the Commander identifies deployment-dependent power shedding without leaving the capability

#### Scenario: The workspace is reopened

- **WHEN** the capability is opened
- **THEN** the selected hardpoint state is deployed
- **AND** no route, history entry, stored record, saved build or export carries the selection

### Requirement: Disabled modules stay in the budget

Disabled modules MUST remain visible and MUST contribute exactly as the package reports.

Source: 005/FR-004.

#### Scenario: A module is switched off

- **WHEN** a fitted module is disabled
- **THEN** it remains listed
- **AND** its contribution is the one the package reports

### Requirement: Per-module power breakdown

A per-module breakdown MUST use package-resolved post-engineering draw and MAY sort by contribution.

Source: 005/FR-005.

#### Scenario: A module's draw is read

- **WHEN** the breakdown states a module's draw
- **THEN** the figure is the package-resolved post-engineering draw

### Requirement: Module list readings per hardpoint state

The module list MUST state each line's draw in the selected hardpoint state, so a stowed hardpoint
and a switched-off module each read a real zero and each state's list adds up to that state's own
package total. A line standing for more than one mount MUST carry its count, a line the plant leaves
dark MUST name its group, and a switched-off line MUST say so. The list carries no action: a mount is
selected in the module outfitting ledger.

Source: 005/FR-006.

#### Scenario: Hardpoints are retracted

- **WHEN** the selected state is retracted and the build carries a deployed-only module
- **THEN** that line reads a real zero
- **AND** the module remains identifiable in the list

#### Scenario: The list is totalled

- **WHEN** the lines of one hardpoint state are added together
- **THEN** the sum equals that state's own package total

#### Scenario: A line stands for several mounts

- **WHEN** one line stands for more than one mount
- **THEN** the line carries its count

#### Scenario: The plant leaves a line dark

- **WHEN** the plant leaves a line unpowered
- **THEN** the line names its priority group

### Requirement: Distributor readings

Distributor values MUST use `BuildMetrics.distributorMetricsResult()` for capacity, rated recharge,
pip-scaled recharge and the allocation used. The application MUST NOT scale recharge. The pips shown
MUST be the pips the package returns.

A bank's capacity MUST be written `MW`, and both recharge figures `MJ/s`. The figure itself MUST NOT
change: it is the package's `capacity`, copied, with no conversion, scale or factor applied, at the
decimal place this table uses.

Source: 005/FR-007.

#### Scenario: A bank is read at an allocation

- **WHEN** SYS, ENG or WEP is read
- **THEN** it shows capacity, rated recharge and actual recharge at the selected pips, each straight
  from the package

#### Scenario: Pips move

- **WHEN** the allocation changes
- **THEN** recharge changes and capacity does not

#### Scenario: A bank stands at no pips

- **WHEN** a bank stands at zero pips
- **THEN** its recharge is a genuine zero

#### Scenario: The units are read

- **WHEN** a bank states its capacity and its two recharge figures
- **THEN** the capacity carries `MW` and each recharge figure carries `MJ/s`

### Requirement: Pip allocation

This capability owns the pip allocation. A Commander assigns a whole `0`–`4` pips to one of SYS, ENG
and WEP, chosen in place with no draft, running total or confirmation step.

Six pips between the three is the ship's rule, and so is how they move: every whole pip assigned to
one bank MUST be taken half a pip from each of the other two. Where only one of the two has pips left
to give, that bank MUST pay the whole of it rather than the other going negative; taking pips back
out of a bank MUST run the same rule backwards, all of it going to one bank where the other is
already at four. It follows that the bank being set always stands on a whole pip while the two paying
for it stand on the half step, and that four blocks filled from the leading edge draw every
allocation the control can reach. No control MUST offer a half pip directly.

Source: 005/FR-007.

#### Scenario: A whole pip is assigned

- **WHEN** the Commander assigns a whole pip to one bank
- **THEN** half a pip is taken from each of the other two banks

#### Scenario: Only one bank has pips to give

- **WHEN** the Commander assigns a pip and only one of the other two banks has pips left to give
- **THEN** that bank pays the whole pip
- **AND** no bank goes negative

#### Scenario: Pips are taken back out

- **WHEN** the Commander takes pips out of a bank and one of the other two already stands at four
- **THEN** the whole of it goes to the remaining bank

#### Scenario: The control is offered

- **WHEN** a pip control is drawn
- **THEN** it offers whole pips alone and no half pip

### Requirement: Unavailable distributor result

A `null` distributor value MUST remain unavailable; catalogue figures MUST NOT replace a build
result.

Source: 005/FR-008, 005/SC-003.

#### Scenario: The distributor is missing, disabled, package-incomplete or shed

- **WHEN** the package returns `null` for a distributor value
- **THEN** the reading is presented as unavailable, with no catalogue figure and no inferred cause in
  its place

### Requirement: Heat scenarios

Heat MUST use `BuildMetrics.heatMetricsResult()` and MUST show four of the five returned scenarios
(idle, thruster, FSD-charging and sustained-fire), with their thermal load, heat level, gauge level,
overheat state and time to overheat. The drained-capacitor scenario MUST NOT be shown: the design does
not draw it. An overheating scenario or shield cell bank bar MUST be
identifiable without its colour: by a pattern and its level figure (the scenario's gauge level from `heatMetricsResult()`, or the bank bar's level
from `heatLevelAtTime`) for a reader who sees it, and in
words for a reader who is told.

`heatMetricsResult()` publishes five scenarios and states that a shield cell bank's heat is not one
of them, because a bank states heat per activation. A shield cell bank's heat bar MUST be drawn by
the package's own documented remedy: divide by the bank's spin-up, add it to the build's load, and
run it for that duration with `heatLevelAtTime`. `heatMetricsResult()` models no heat sink, so the
`HEAT SINKS` tile MUST be counted from `fittedModules()` rather than derived.

Source: 005/FR-009.

#### Scenario: The heat scenarios are read

- **WHEN** heat is shown
- **THEN** the idle, thruster, FSD-charging and sustained-fire scenarios each show their thermal
  load, heat level, gauge level, overheat state and time to overheat

#### Scenario: The drained-capacitor scenario is left out

- **WHEN** heat is shown
- **THEN** no reading of the drained-capacitor scenario appears

#### Scenario: A scenario overheats

- **WHEN** the package reports a shown scenario as overheating
- **THEN** it is drawn with a pattern beside its level figure, not by colour alone
- **AND** a reader who is told hears that it is overheating

#### Scenario: The shield cell bank's bar overheats

- **WHEN** the shield cell bank's bar reaches an overheating level
- **THEN** it is drawn with a pattern beside its level figure, not by colour alone
- **AND** a reader who is told hears that it is overheating

#### Scenario: The build carries no weapons

- **WHEN** the build carries no weapons
- **THEN** the sustained-fire scenario remains a package result and no absent state is invented

### Requirement: Unavailable heat result

A `null` heat result MUST remain unavailable; catalogue figures MUST NOT replace a build result.

Source: 005/FR-010.

#### Scenario: The build has no power plant

- **WHEN** the build has no power plant
- **THEN** heat is presented as unavailable, with no catalogue figure and no inferred cause in its
  place

### Requirement: Infinity carries its package meaning

Infinity MUST be expressed by its package meaning, such as never settling or never overheating,
rather than as an unexplained number.

Source: 005/FR-011.

#### Scenario: A scenario never overheats

- **WHEN** the package returns an infinite time to overheat
- **THEN** the reading states that the build never overheats rather than an unexplained number

### Requirement: Status rail power statements

The build status rail MUST carry one sentence per priority group the package reports unpowered with
the hardpoints deployed, each naming its group and its own deployed draw, in the rail's opening
`BUILD STATUS` block beneath the package's validation issues; the `POWER` line carrying the lit draw
against plant output, with its unpowered remainder named after it only where something is dark; and
the bar under it, drawing those same figures over the whole demand with a mark where the plant runs
out. This capability's own block begins at the `POWER` line.

Each MUST name only fields the package returned, no severity word MUST stand beside a sentence, and
no heat sentence MUST be drawn here. These three MUST NOT be interactive.

Source: 005/FR-013, 005/SC-004.

#### Scenario: A priority group is unpowered

- **WHEN** the package reports a priority group unpowered with the hardpoints deployed
- **THEN** the `BUILD STATUS` block carries one sentence for that group, beneath the package's
  validation issues, naming the group and its own deployed draw
- **AND** no severity word stands beside it

#### Scenario: The plant covers every group

- **WHEN** the package reports no unpowered group with the hardpoints deployed
- **THEN** no such sentence is drawn and the `POWER` line names no unpowered remainder

#### Scenario: The rail's figures are checked

- **WHEN** a figure or state this capability contributes to the rail is read
- **THEN** it equals the corresponding Almanac field for the same active build, read with the
  hardpoints deployed
- **AND** the sentence, the `POWER` line and the bar are not interactive

### Requirement: Rail pip control

The rail MUST carry the three `SYS`, `ENG` and `WEP` pip groups under the `POWER` bar as a control,
each over four blocks filled to that bank's standing allocation. The control edits the same single
viewing condition the distributor cell edits, through the same action and under the same six-pip
rule, and MUST NOT become a second allocation, a draft or a running total. Each bank MUST expose the
allocation it stands at in words, and the blocks shown MUST be the pips the package returned rather
than the ones that were pressed. The rail's three read-only power contributions stay read-only.

Source: 005/FR-013.

#### Scenario: The Commander sets pips from the rail

- **WHEN** the Commander uses the rail's pip control
- **THEN** the same allocation the distributor cell edits changes
- **AND** the blocks drawn are the pips the package returned

#### Scenario: A bank's allocation is read by assistive technology

- **WHEN** a bank in the rail's pip control is read
- **THEN** it exposes the allocation it stands at in words

### Requirement: Compact-width power badge

At compact width, where and only where the package reports a band unpowered with the hardpoints
deployed, the strip of key readings MUST close with a badge stating the share of plant output the
build's lit demand takes, over one line naming each such band by its priority group. Both figures
MUST be read from `BuildMetrics.powerBudget()`, the same result the rail reads, and MUST NOT be a
second reading of it.

The share is the lit demand over plant output, not over the whole demand: the reference sets `95%`
against a build whose lit draw is `29.64 MW` of a `31.20 MW` plant and whose whole demand is `37.44`.
Where the package reports no output at all there is no share to state, and the badge MUST state none.
The badge itself is still drawn on such a build, carrying its band lines alone.

A build whose plant covers every band MUST draw no badge at all. Where more than one band is dark the
badge MUST name each of them.

The badge MUST NOT take a row of its own away from the readings it closes: it stands at the trailing
edge of the row those readings are on, and takes a row of its own only where the width it needs is
not there.

The badge MUST be a reading and MUST NOT be interactive.

Source: 005/FR-014.

#### Scenario: One band is unpowered at compact width

- **WHEN** the package reports one band unpowered with the hardpoints deployed and the width is
  compact
- **THEN** the strip of key readings closes with a badge stating the lit demand's share of plant
  output, over one line naming that band by its priority group

#### Scenario: Several bands are unpowered

- **WHEN** the package reports more than one band unpowered with the hardpoints deployed
- **THEN** the badge names each of them

#### Scenario: The plant covers every band

- **WHEN** the package reports no band unpowered with the hardpoints deployed
- **THEN** no badge is drawn

#### Scenario: The plant produces no output

- **WHEN** the package reports no plant output at all
- **THEN** the badge states no share
- **AND** the badge is still drawn, carrying its band lines alone

#### Scenario: The row has the width the badge needs

- **WHEN** the row of readings has the width the badge needs
- **THEN** the badge stands at the trailing edge of that row rather than taking a row of its own

### Requirement: A power label that does not fit is cut

Where the power panel draws its four blocks in one row, each label MUST stand on one line. A label
that does not fit MUST be cut and followed by a `…` that shows the whole label on hover and on a
press. A label that already opens its own tooltip (a heat scenario name) MUST show the whole label
in that tooltip instead, and its `…` is then a plain mark. The whole label MUST stay available to
assistive technology. A figure MUST NOT be cut.

Source: Commander decision during implementation.

#### Scenario: A German label is too long for its tile

- **WHEN** the power panel stands in one row in German and a tile label does not fit
- **THEN** the label is cut with a `…`, and hovering the `…` shows the whole label

#### Scenario: A cut label is read by a screen reader

- **WHEN** a screen reader reads a cut label
- **THEN** it reads the whole label

#### Scenario: A cut heat scenario name

- **WHEN** a heat scenario name is cut
- **THEN** hovering or pressing the name shows the whole name before its gloss

### Requirement: A power label below one row is never broken

Below the one-row width, a power label MUST wrap between words, and a word MUST NOT be broken. A word
too long for its box MUST be cut with the same reachable `…`.

Source: Commander decision during implementation.

#### Scenario: The panel is narrower than one row

- **WHEN** the power panel stands in two rows or one column
- **THEN** a label wraps between words, and a word too long for its box is cut with a `…` rather
  than broken
