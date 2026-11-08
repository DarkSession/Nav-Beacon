## ADDED Requirements

### Requirement: Identical weapons share a row

Weapons MUST share one row where their `ShipLoadout.fittedModules()` records give the same symbol,
pre-engineered variant, engineering and enabled state, and `BuildMetrics.weaponMetrics()` the same
five figures, as returned, that "Weapon list readings" names.
Any other weapon, or one with no record, has its own row. A shared row MUST state how many weapons
it stands for and draw one weapon's figures, not their sum, where its first weapon stands.

Source: 007/FR-004.

#### Scenario: Two identical weapons

- **WHEN** two fitted weapons have the same module, engineering and enabled state, and the same five
  figures
- **THEN** one row stands for both and states that it stands for two
- **AND** the row draws one weapon's figures

#### Scenario: Two weapons differ in engineering

- **WHEN** two fitted weapons carry the same module with different engineering
- **THEN** each has a row of its own

#### Scenario: One of two weapons is switched off

- **WHEN** two fitted weapons are the same except that one is switched off
- **THEN** each has a row of its own

#### Scenario: A shared row keeps its first weapon's place

- **WHEN** the first and third weapons in the package's order are identical and the second differs
- **THEN** the shared row stands first and the second weapon's row stands after it

#### Scenario: A weapon has no module record

- **WHEN** `BuildMetrics.weaponMetrics()` measures a weapon that has no `ShipLoadout.fittedModules()`
  record
- **THEN** that weapon has a row of its own

### Requirement: The mounted count counts weapons

The count of mounted weapons MUST be the number of weapons `BuildMetrics.weaponMetrics()`
returns, not the number of rows.

Source: 007/FR-004.

#### Scenario: Two weapons share a row

- **WHEN** five weapons are fitted and two of them share a row
- **THEN** the mounted count states five

### Requirement: A weapon row names its module

A weapon row MUST name its module: by `getPreEngineeredVariantName()` for the
`FittedModule.preEngineeredVariant` its `ShipLoadout.fittedModules()` record carries, or else by `getModuleName()` for the symbol
`BuildMetrics.weaponMetrics()` reports. Where another row shows the same name, and only there, it
MUST also state the class, rating, mount and engineering its `ShipLoadout.fittedModules()` record
gives, leaving out any the package does not publish.

Source: 007/FR-004.

#### Scenario: A name shown once

- **WHEN** no other row shows the same name
- **THEN** the row states the module's name alone

#### Scenario: A pre-engineered weapon is named

- **WHEN** a weapon's `ShipLoadout.fittedModules()` record carries a pre-engineered variant
- **THEN** its row is named by `getPreEngineeredVariantName()` for that variant

#### Scenario: A weapon with no module record is named

- **WHEN** a weapon has no `ShipLoadout.fittedModules()` record
- **THEN** its row is named by `getModuleName()` for the symbol `BuildMetrics.weaponMetrics()`
  reports

#### Scenario: A name shown twice

- **WHEN** two rows show the same name
- **THEN** each row also states those of the module's class, rating, mount and engineering the
  package publishes

### Requirement: An offence label that does not fit is cut

Where the offence panel draws its three blocks in three columns, each label MUST stand on one line.
A label that does not fit MUST be cut and followed by a `…` that shows the whole label on hover and
on a press. The whole label MUST stay available to assistive technology. A figure MUST NOT be cut.
Below the three-column width, a label MUST wrap between words, and a word MUST NOT be broken: a
word too long for its box MUST be cut in the same way.

Source: Commander decision during implementation.

#### Scenario: A weapon name is too long for its column

- **WHEN** the offence panel stands in three columns and a weapon name does not fit
- **THEN** the name is cut with a `…`, and hovering the `…` shows the whole name

#### Scenario: A cut label is read by a screen reader

- **WHEN** a screen reader reads a cut label
- **THEN** it reads the whole label

## MODIFIED Requirements

### Requirement: Capacitor endurance

Capacitor endurance MUST use `BuildMetrics.weaponsCapacitorMetrics()` for the WEP pips the power and
heat capability's shared conditions hold. The application MUST NOT calculate endurance or pip
scaling. Wherever the block states a capacitor figure, it MUST state
once the WEP pips the power and heat capability's shared conditions hold, never `BuildMetrics.weaponsCapacitorMetrics()`'s `weaponsPips`. Where it states no capacitor
figure, it MUST state no WEP pips.

The capacity MUST be written `MW`; `DRAW` and `RECHARGE` MUST keep `MJ/s`. The figure itself MUST NOT
change: it is the package's `capacity`, copied, with no conversion, scale or factor applied, at the
two decimal places this block writes it to. The unit is a departure from the package, which documents
the field in megajoules, and from SI; the two blocks that state this quantity MUST NOT write it in
two units.

A pool written `MW` is still not a rate, still shares a scale with nothing beside it, and still
carries no bar.

Source: 007/FR-006.

#### Scenario: Endurance is read at the standing WEP pips

- **WHEN** the block states WEP capacity, recharge, sustained draw and time to drain
- **THEN** each is `BuildMetrics.weaponsCapacitorMetrics()`'s own figure at the WEP pips the power
  dashboard is set to

#### Scenario: The units are read

- **WHEN** the block states its capacity and its two rates
- **THEN** the capacity carries `MW` at two decimal places and `DRAW` and `RECHARGE` carry `MJ/s`
- **AND** the capacity figure is the package's `capacity`, unconverted and unscaled

#### Scenario: The WEP pips are stated once

- **WHEN** the block is read at the standing WEP pips
- **THEN** it states those pips once

#### Scenario: No capacitor figure is stated

- **WHEN** the block states no capacitor figure
- **THEN** it states no WEP pips

### Requirement: Weapon list readings

Every returned weapon MUST remain visible with its identity, its enabled state and the five figures
the canvas's six columns draw beside the module:

- burst damage per second, the package's `damagePerSecond`, headed `DPS BURST`;
- sustained damage per second, the package's `sustainedDamagePerSecond`, headed `SUSTAINED`;
- armour piercing;
- maximum range, the package's own `maximumRange`, headed `RANGE`;
- falloff range.

Missing damage, range or piercing MUST remain missing. A weapon the package gives no maximum range,
and a weapon it gives no sustained figure, each remain not stated. Nothing MUST be derived from
another figure and nothing MUST be capped: a continuous-fire weapon has no cadence, so the package
reports the same figure for burst and sustained and the row draws it twice.

Each weapon MUST keep its exact package slot key as its identity and its handoff, including a weapon
that shares a row, and the slot key MUST NOT be displayed. A weapon that shares a row remains
visible in that row's count, and a row that stands for more than one weapon MUST state its count for
a reader who sees it, and in words for a reader who is told that its figures are for each weapon.

Source: 007/FR-004.

#### Scenario: A weapon row is drawn

- **WHEN** the package returns a fitted weapon
- **THEN** the row names the weapon's module and states its enabled state, its burst damage per
  second, its sustained damage per second, its armour piercing, its maximum range and its falloff
  range

#### Scenario: A shared row is read

- **WHEN** a row stands for two weapons
- **THEN** it shows its count of two
- **AND** a reader who is told hears that it stands for two weapons and that its figures are for
  each weapon

#### Scenario: A field is absent

- **WHEN** the package gives a weapon no damage, no range or no piercing figure
- **THEN** the row leaves the field not stated rather than inferring one

#### Scenario: A continuous-fire weapon is listed

- **WHEN** the package reports the same burst and sustained figure for a beam
- **THEN** the row draws that figure in both columns

#### Scenario: The slot key is read

- **WHEN** a weapon row is identified or handed off
- **THEN** it carries the exact package slot key of every weapon it stands for
- **AND** no slot key is displayed

### Requirement: The gunsight plate

The gunsight view is a diagram. It MUST be hidden from assistive technology, and every one of the
hull's mounts MUST be stated as text beside it, including a mount the plate does not draw at all.

Each mount that is drawn is drawn as one mark and no other: a dot where its shot lands.

- A shot further off-axis than the plate shows MUST NOT be drawn. It MUST NOT be held at the frame
  either, because a mark on the margin says a shot lands where it does not.
- Whether a mount is armed and whether it is the mount the workspace has selected MUST each be
  carried by that mount's own sentence as well as by the ink of its mark.
- How a weapon is aimed, and which hardpoint a mark counts, MUST be stated in that sentence, and
  neither is drawn at all.
- The plate MUST draw no text at all: no hardpoint numeral, no leader and no caption.
- The field of view MUST be `40` milliradians. It is a property of the drawing and MUST NOT move to
  accommodate a build.
- The plate MUST be square in angle, with only the rings corrected for the box's pixel aspect.
- The plate MUST carry the boresight, a hairline ring on the axis, which is where the hull points and
  therefore what every shot is offset from. It carries no build state and needs no sentence of its
  own. No filled dot MUST stand at its centre.
- The plate MUST be drawn whole within its block.

The three mount states MUST be three fills of one shape. An empty mount takes the armed mount's own
hue gone stale, so it reads as this mount with nothing on it; the selected mount keeps the cool ink
and takes it over either.

The plate MUST state nothing on its own. Every fact its hues separate MUST be carried visibly
elsewhere in the same workspace, and not by colour there either: the module outfitting ledger names
each hardpoint's module or prints its emptiness as a word, and marks the selected row by inverting
its node badge — a solid ground, an inverted ink and a heavier weight, with the word itself for a
reader who is told — and this panel's own `WEAPONS` block lists what is fitted. A Commander who
cannot separate the plate's three hues MUST lose no reading.

Source: 007/FR-011.

#### Scenario: A shot lands inside the field of view

- **WHEN** a mount's shot at the chosen range is inside the `40` milliradian field of view
- **THEN** the plate draws one dot where that shot lands
- **AND** the mount's own sentence beside the plate states how the weapon is aimed and which
  hardpoint the mark counts

#### Scenario: A shot lands outside the field of view

- **WHEN** a mount's shot at the chosen range is further off-axis than the plate shows
- **THEN** no mark is drawn for it and no mark is held at the frame's margin
- **AND** the mount keeps its sentence, which states its true offset and angle

#### Scenario: Two dots overlap

- **WHEN** two mounts' shots land close enough for their dots to overlap
- **THEN** the plate draws them overlapping and moves neither
- **AND** each mount's sentence states its offset and its angle exactly

#### Scenario: The plate is read by assistive technology

- **WHEN** assistive technology reads the panel
- **THEN** the plate is hidden from it
- **AND** every one of the hull's mounts is read as text beside it

#### Scenario: The plate at any width

- **WHEN** the gunsight block is drawn at any width
- **THEN** the plate lies wholly inside it

### Requirement: Readings the canvas does not draw

Nothing user-facing MUST appear that `openspec/changes/archive/007-offence-profile/design/canvas-contract.md` does not sanction, and every region
it does sanction MUST be present. The following MUST NOT be drawn or read:

- a weapon row disclosure and a per-row slot action, because the canvas draws its weapon rows inert;
- the whole-build firing cost, the net drain and the returned allocation, because no canvas draws
  them;
- the ring caption and the four figures beneath the plate — the lateral span, the vertical span, the
  apparent spread and the widest mount — because no artboard draws them, so the block reports no
  figure about the group of mounts at all.

The unfilled hardpoint's mark and sentence and the selected mount's mark are sanctioned departures
the template does not contain. Neither adds a figure the package did not publish, and neither moves a
figure the canvas measures. Three more are sanctioned departures: a weapon row shared by
identical weapons with its count, a weapon row that draws its module's name without a code line, and
the capacitor's WEP pips stated with its heading rather than as a line beneath its rows.

Source: 007/Design Scope, 007/SC-004.

#### Scenario: A weapon row is used

- **WHEN** a Commander reads a weapon row
- **THEN** the row is inert, with no disclosure and no slot action

#### Scenario: The gunsight block is read

- **WHEN** the gunsight block is drawn
- **THEN** no ring caption, lateral span, vertical span, apparent spread or widest mount is stated
  beneath the plate

#### Scenario: The capacitor block is read

- **WHEN** the capacitor block is drawn
- **THEN** it states no whole-build firing cost, no net drain and no returned allocation
