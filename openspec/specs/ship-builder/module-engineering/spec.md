## Purpose

Commanders engineer the modules of the active build and set each module's enabled state and power
priority. The Almanac package supplies every blueprint, effect, attribute, cost and edit result.

## Requirements

### Requirement: Blueprints and experimental effects come from the package

The package's blueprint and experimental-effect symbols MUST be used as their Frontier `fdname`
identity values. Persisted build and link fields named `fdname` MUST retain those field names.

Each module MUST support applying and replacing a blueprint and grade, adding, replacing and
removing only an experimental effect, and clearing all ordinary engineering exactly as the package
permits. Removing only the effect MUST preserve the blueprint and grade.

Modified attributes MUST come from `ShipLoadout.fittedModuleAt(slotKey).effectiveStats`.
Restrictions on further engineering MUST come from `ShipLoadout.availableBlueprints(slotKey)`,
`ShipLoadout.availableExperimentalEffects(slotKey)`, the fitted module's
`preEngineeredVariant.engineeringLocked` value, and the results of `ShipLoadout.applyBlueprint(...)`
and `ShipLoadout.setExperimentalEffect(...)`.

`ShipLoadout.availableBlueprints(slotKey)` and each returned blueprint's `grades` MUST be the source
of blueprint and grade choices. `ShipLoadout.availableExperimentalEffects(slotKey)` MUST be the
source of experimental-effect edit choices. The carried effect MUST come from
`ShipLoadout.fittedModuleAt(slotKey).engineering.ExperimentalEffect`. Its visible name MUST come
from the package's `getExperimentalEffectName(effectSymbol, locale)` call. If the effect-menu call
returns no choices for a module that carries an effect, that effect MUST remain visible as fixed
state and the application MUST NOT offer a control to add, remove or replace it.

Source: 002/FR-012.

#### Scenario: A blueprint is offered

- **WHEN** a Commander opens the engineering choices for a module
- **THEN** only the blueprints, grades and experimental effects the package supports for that module
  are offered

#### Scenario: An experimental effect is fixed

- **WHEN** a fitted module carries an experimental effect and
  `ShipLoadout.availableExperimentalEffects(slotKey)` returns no choices
- **THEN** the carried experimental effect remains visible as fixed state
- **AND** no control can add, remove or replace it

#### Scenario: A fixed effect survives a grade edit

- **WHEN** a Commander applies a permitted grade to a module whose experimental effect is fixed
- **THEN** the fitted module retains the same experimental effect
- **AND** the effect remains visible as fixed state
- **AND** no control can add, remove or replace it

#### Scenario: Only the experimental effect is removed

- **WHEN** a Commander removes the experimental effect alone
- **THEN** the blueprint and grade stay as they were

#### Scenario: All ordinary engineering is cleared

- **WHEN** a Commander chooses the package's explicit "none" entry among the blueprint choices
- **THEN** the module's ordinary engineering is cleared through the package

#### Scenario: A module is replaced

- **WHEN** a module is replaced in its mount
- **THEN** the incoming module does not inherit the outgoing module's engineering

### Requirement: The engineering surface presents the package's attributes

The engineering surface MUST present every numeric attribute the package publishes on the fitted
article, and only those the article itself carries. Where a reading is drawn from more than one
package record — the stock column of an identified pre-engineered variant is read from the catalogue
rather than from `stats` — an attribute either record carries MUST be presented, with the absence
stated in the reading that has no figure for it. It MUST NOT present a chosen subset, and MUST NOT
invent, derive or estimate an attribute the package does not publish.

Where the package calculates a figure for the kind of article the mount holds, that figure MUST be
presented beside the catalogued attributes, on both readings, and MUST come from the package's own
calculation rather than from arithmetic over the rows. A weapon's damage per shot and per second,
sustained damage per second, sustained rate of fire, distributor draw and heat are what a recipe is
chosen for, and a Commander MUST NOT have to multiply two rows to read one of them.

A calculated figure MUST NOT be offered where it would not be a second reading. Three cases:

- an article the package does not measure as a weapon, which would be answered with the
  calculation's own defaults;
- a continuous-fire weapon, whose damage, draw and heat are already per second and whose cadence
  figures are what the calculation carries a weapon with no shots by;
- a figure whose two readings both equal another row's, which is what a weapon that never stops to
  reload does to its sustained figures.

A figure that repeats on one reading and moves on the other is a reading and MUST be kept. A
defaulted zero, a placeholder and a repeated figure are all rows a Commander learns nothing from.

Attribute labels are application-localized; the package's own field identities MUST NOT reach a
screen.

The stock reading MUST be shown whether or not the module is engineered. The modified reading MUST
be shown exactly when there is a selection or existing engineering to compare against, and a
selection the package refuses MUST remain unavailable rather than becoming a comparison.

A published boot time of zero MUST NOT be drawn: it is a real reading that reports no delay, and a
row stating it tells a Commander nothing. No other published figure may be suppressed, and a zero
elsewhere is data.

The module's purchase cost is not an attribute and MUST NOT be presented as one: it is stated by the
choice row it is bought from and totalled for the build, not by what the article does.

Attributes MUST be presented for every fitted article, including one the package will accept no
further engineering for.

Source: 002/FR-012a.

#### Scenario: A weapon is inspected

- **WHEN** the surface draws a fitted weapon
- **THEN** every numeric attribute the package publishes on that article is presented
- **AND** the package's damage per shot and per second, sustained damage per second, sustained rate
  of fire, distributor draw and heat are presented beside them, on both readings

#### Scenario: The article is not measured as a weapon

- **WHEN** the package does not measure the fitted article as a weapon
- **THEN** no calculated weapon figure is offered

#### Scenario: A weapon never stops to reload

- **WHEN** a calculated figure reads the same as another row on both readings
- **THEN** that figure is not offered

#### Scenario: A figure moves on one reading only

- **WHEN** a calculated figure repeats another row on one reading and differs on the other
- **THEN** the figure is kept

#### Scenario: The article publishes a boot time of zero

- **WHEN** the package publishes a boot time of zero for the fitted article
- **THEN** no boot time row is drawn
- **AND** a published zero for any other figure is drawn as data

#### Scenario: Nothing is selected and nothing is engineered

- **WHEN** a fitted module has no engineering and the Commander has selected none
- **THEN** the stock reading is shown and no modified reading is shown

#### Scenario: The package refuses a selection

- **WHEN** the package refuses a selection
- **THEN** the selection stays unavailable and no comparison is drawn from it

#### Scenario: The article takes no further engineering

- **WHEN** the package accepts no further engineering for a fitted article
- **THEN** its attributes are still presented

### Requirement: The engineering surface does not scroll within itself

Where the surface draws the details and the engineering inline, neither the surface nor either side
of it MAY scroll within itself in the block axis. Both sides MUST expand to the whole of what they
hold, the surface MUST be as tall as the taller of them, and the page MUST carry the result.

A labelled wide fact table keeps its own inline-axis scroller, which is the one internal scroll the
responsive rules allow and what keeps the document from scrolling horizontally.

Both sides MUST keep their positions for every fitted article. Where there is nothing to engineer,
the side that would carry the controls MUST state why, and the attributes MUST stay on the side they
occupy otherwise.

Source: 002/FR-012b.

#### Scenario: One side is taller than the other

- **WHEN** the attributes are taller than the engineering controls
- **THEN** the surface is as tall as the attributes
- **AND** the page scrolls rather than either side

#### Scenario: A wide fact table is drawn

- **WHEN** a labelled fact table is wider than its column
- **THEN** the table scrolls in the inline axis inside its own container
- **AND** the document does not scroll horizontally

#### Scenario: There is nothing to engineer

- **WHEN** the package accepts no engineering for the fitted article
- **THEN** the side that would carry the controls states why
- **AND** the attributes stay on the side they occupy otherwise

### Requirement: The engineering surface draws no materials list

The engineering surface MUST NOT draw a materials list of its own. Material requirements are stated
once, as the build-wide total drawn in the status rail; that total already includes what a selected
recipe adds.

Source: 002/FR-012c.

#### Scenario: A recipe is selected

- **WHEN** a Commander selects a blueprint and grade
- **THEN** the engineering surface draws no materials list
- **AND** the build-wide total in the status rail includes what the selected recipe adds

### Requirement: Every selected grade is a completed 100% quality

Every selected ordinary grade MUST represent 100% quality. A material requirement is identified by
its grade, and no surface calls it a roll.

Partial imported quality on each supported resolved module MUST be normalised to 100% through the
package. If the package cannot resolve the engineering identity or otherwise cannot complete the
grade losslessly, the entire incoming build MUST be refused before activation, the current build
MUST remain unchanged, and the refusal MUST identify the affected slot and engineering identity.

The application MUST NOT change only its quality scalar, strip engineering, retain the partial roll
or fabricate modifiers.

A completion is not reported to the Commander.

Source: 002/FR-013, 002/SC-005.

#### Scenario: Partial quality can be completed

- **WHEN** an incoming build carries partial engineering quality the package can complete losslessly
- **THEN** every affected module reaches quality 100%
- **AND** the Commander is not told about the completion

#### Scenario: Partial quality cannot be completed

- **WHEN** the package cannot resolve the engineering identity or cannot complete the grade
  losslessly
- **THEN** the whole incoming build is refused before activation
- **AND** the current build is unchanged
- **AND** the refusal names the affected slot and engineering identity

### Requirement: Engineering material costs come from package cost results

Engineering material costs MUST use package cost results, wherever they are stated. Fixed
pre-engineering MUST add no craft cost unless the package reports separately selected ordinary
engineering.

Source: 002/FR-014.

#### Scenario: A pre-engineered variant is fitted

- **WHEN** a fitted article carries only fixed pre-engineering
- **THEN** it adds no craft cost

#### Scenario: A variant is engineered further

- **WHEN** the package reports separately selected ordinary engineering on a pre-engineered variant
- **THEN** the package's cost result for that engineering is used

### Requirement: Enabled state and power priority are edited through the package

Enabled state and zero-based priority MUST be edited through `ShipLoadout`. Presentation MUST use
the Commander's one-based priority labels.

Where the source states no group, presentation MUST show the group the package puts the module in
rather than reporting the value as unavailable; the modelled field MUST stay absent, so nothing is
written into the build.

Any edit that re-fits a mount — a fit, a variant fit, or putting a purchase back — MUST carry the
mount's power state onto the article that lands there: a group the outgoing module was assigned MUST
be set again on the incoming one, and the on/off state it stated MUST be stated again. The carry
MUST be part of the same package edit and the same Commander decision as the edit that reset it, and
MUST write no field the outgoing module did not carry — an unstated group and an unstated on-state
stay unstated, because the package already answers both. Health is not carried, because this
application does not model it.

Enabled state and priority update every affected package calculation, while mass and cost remain
because the module is still fitted.

Source: 002/FR-015, 002/SC-003a.

#### Scenario: A module states no priority group

- **WHEN** the source states no priority group for a fitted module
- **THEN** presentation shows the group the package puts the module in
- **AND** the modelled field stays absent

#### Scenario: A module is switched off

- **WHEN** a Commander disables a fitted module
- **THEN** every affected package calculation is updated
- **AND** the module's mass and cost remain, because it is still fitted

#### Scenario: A mount is re-fitted

- **WHEN** a Commander replaces a module in a mount that carried a priority group or a stated on/off
  state
- **THEN** the incoming article is set to that group and that on/off state
- **AND** the carry is part of the same package edit and the same Commander decision, which one undo
  reverses

#### Scenario: The outgoing module carried no power state

- **WHEN** the outgoing module stated neither a group nor an on-state
- **THEN** neither field is written onto the incoming article

#### Scenario: Priority is presented

- **WHEN** a priority group is drawn for a Commander
- **THEN** it uses the one-based label while the package is edited with the zero-based value
