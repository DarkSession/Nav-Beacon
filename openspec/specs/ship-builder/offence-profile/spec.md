## Purpose

This capability presents whole-build and per-weapon damage, damage types and their shares, damage at
the four range bands, shot convergence across the build's hardpoints, and weapons-capacitor
endurance for the active build.

## Requirements

### Requirement: Almanac supplies every offence measurement

Every offence measurement MUST come from `@elite-dangerous-almanac/core`; the application MUST NOT
re-sum, derive or estimate a weapon or build metric.

Presentational proportions over package amounts — a share of a stated total, a bar filled against a
stated strongest — are not measurements and are permitted where the canvas draws one, provided every
amount they are drawn from is itself stated.

Source: 007/FR-001, 007/SC-001, 007/SC-002.

#### Scenario: A displayed offence value is compared with the package

- **WHEN** the capability displays an offence value
- **THEN** it equals its Almanac field, or is a proportion of stated Almanac fields the canvas draws

#### Scenario: A proportion is drawn

- **WHEN** the capability draws a share of a total or a bar filled against a stated strongest
- **THEN** every amount the proportion is drawn from is itself stated

### Requirement: Build and weapon metrics come from the fitted build

Whole-build and per-weapon values about the fitted build MUST use `BuildMetrics.weaponMetrics()`.

The package's data-free `weaponMetrics()` MAY be asked about one article that is not a build's fitted
weapon — what the engineering editor's attribute table compares — and that reading MUST agree with
this one on which articles are weapons at all. It MUST NOT reach this panel or the status rail, which
read the build.

Source: 007/FR-002.

#### Scenario: A build total is read

- **WHEN** the panel or the status rail states a whole-build or per-weapon offence value
- **THEN** the value comes from `BuildMetrics.weaponMetrics()` for the fitted build

#### Scenario: The engineering editor compares one article

- **WHEN** the engineering editor asks the data-free `weaponMetrics()` about one article
- **THEN** that reading agrees with this one on which articles are weapons
- **AND** the reading does not reach this panel or the status rail

### Requirement: Damage by type

Every conventional damage type the build deals — kinetic, thermal, explosive, caustic, absolute and
unclassified — MUST be stated with its exact returned amount and its share of the conventional total,
beside the bar that draws those shares. A type the build does not deal MUST NOT be given a line, a
zero or a segment. No amount MAY be folded into another type.

This is the whole damage-by-type reading. `antiXeno` and `sustainedDamageByType` are fields no canvas
draws, and this capability does not read them.

Source: 007/FR-003.

#### Scenario: The build deals several conventional types

- **WHEN** the build deals more than one conventional damage type
- **THEN** each type is one segment of the bar, sized against the others by its share of the
  conventional total
- **AND** each type's exact returned amount and its share are stated in words beside it

#### Scenario: The build does not deal a type

- **WHEN** the build deals none of a conventional damage type
- **THEN** that type has no segment, no line and no zero

#### Scenario: The build deals no conventional damage

- **WHEN** the build deals no conventional damage at all
- **THEN** no damage bar is drawn

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

The row MUST keep its exact package slot key as its identity and its handoff, and MUST NOT display
it.

Source: 007/FR-004.

#### Scenario: A weapon row is drawn

- **WHEN** the package returns a fitted weapon
- **THEN** the row states the weapon's module identity and engineering, its enabled state, its burst
  damage per second, its sustained damage per second, its armour piercing, its maximum range and its
  falloff range

#### Scenario: A field is absent

- **WHEN** the package gives a weapon no damage, no range or no piercing figure
- **THEN** the row leaves the field not stated rather than inferring one

#### Scenario: A continuous-fire weapon is listed

- **WHEN** the package reports the same burst and sustained figure for a beam
- **THEN** the row draws that figure in both columns

#### Scenario: The slot key is read

- **WHEN** a weapon row is identified or handed off
- **THEN** it carries its exact package slot key
- **AND** the slot key is not displayed

### Requirement: Disabled weapons

Disabled weapons MUST remain visible and totals MUST follow the package's enabled-state behaviour.

Source: 007/FR-005.

#### Scenario: Every weapon is disabled

- **WHEN** every fitted weapon is disabled
- **THEN** the totals are genuine zeroes
- **AND** the weapon list still holds every weapon

#### Scenario: No weapons are fitted

- **WHEN** no weapon is fitted
- **THEN** the state is distinct from fitted weapons producing zero totals

### Requirement: Capacitor endurance

Capacitor endurance MUST use `BuildMetrics.weaponsCapacitorMetrics()` for the WEP pips the power and
heat capability's shared conditions hold. The application MUST NOT calculate endurance or pip
scaling.

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

### Requirement: Infinite duration and zero capacity

Infinite duration and zero capacity MUST be expressed by their package meaning, and MUST NOT be given
a cause the package did not state.

Source: 007/FR-007, 007/SC-003.

#### Scenario: The recharge keeps pace

- **WHEN** the package reports that the recharge keeps pace with the draw
- **THEN** the reading is drawn as `∞`, with what the symbol stands for stated beside it
- **AND** the build is not described as firing indefinitely

#### Scenario: No distributor is powered

- **WHEN** no distributor is powered
- **THEN** the package's zero-capacity result is stated as the package returns it, with no diagnosis
  of which of the package's reasons it was

### Requirement: Damage at a range band

Damage at a range band MUST apply the package's `damageFalloff()` to each enabled weapon's returned
damage per second at the band's distance. The application MUST NOT model attenuation, hardness,
resistance or a target.

Source: 007/FR-008.

#### Scenario: The four bands are read

- **WHEN** the build's damage is stated at each of the four range bands
- **THEN** each band's figure applies `damageFalloff()` to every enabled weapon's returned damage per
  second at that band's distance

#### Scenario: The strongest band is zero

- **WHEN** the strongest band is zero
- **THEN** no band is given a track at all and no band claims a share of it

### Requirement: A bar needs one scale

A bar MUST be drawn only where the figures it compares share one scale, and every figure MUST be
stated in words whether or not it carries a bar.

Source: 007/FR-009.

#### Scenario: Figures do not share a scale

- **WHEN** two figures beside each other do not share one scale
- **THEN** no bar compares them
- **AND** each figure is still stated in words

### Requirement: Shot convergence sources

Shot convergence MUST use the package's published hardpoint offsets (`ships/gunsights`) and its own
projection at range. The application MUST NOT derive an offset, model a projectile path or place a
mount the catalogue does not publish. A hull whose gunsight does not line up with its hardpoints MUST
be stated unavailable rather than drawn in part.

A target range MUST be chosen, every shot MUST move as the range moves, and the range MUST reach
3,000 m.

Source: 007/FR-010.

#### Scenario: The Commander moves the target range

- **WHEN** the Commander changes the chosen target range
- **THEN** every shot moves with it, using the package's own projection at that range

#### Scenario: The catalogue does not place the hull

- **WHEN** the package's gunsight does not line up with the hull's hardpoints
- **THEN** the view is stated unavailable rather than drawn from part of its mounts

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
- The plate MUST be drawn at `14rem`, within the block's `508px` bound.

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

### Requirement: Every catalogued hardpoint is drawn

Every hardpoint the catalogue places MUST be drawn on the plate whenever its shot is inside the field
of view, whether or not the build has armed it, at the offset the package publishes for that mount. A
hardpoint with nothing fitted MUST be told apart from an armed one by its mark, and MUST be named as
empty in its own sentence beside the plate rather than by that mark alone — which is also how it is
reported at a range too short for the plate to hold it.

Source: 007/FR-012.

#### Scenario: The build has armed none of the hull

- **WHEN** the catalogue places the hull and the build has armed none of its hardpoints
- **THEN** the plate keeps its axes, its rings and every one of its mounts
- **AND** each mount is named as empty in its own sentence

#### Scenario: A hull carries armed and empty mounts

- **WHEN** the hull carries both armed and empty hardpoints
- **THEN** each empty mount is told apart from the armed ones by its mark
- **AND** each is named as empty in its own sentence

### Requirement: The selected mount

The mount the outfitting workspace currently has selected MUST be marked on the plate and MUST be
named as the selected mount in its own sentence beside it. Whether that mount is armed MUST still be
stated in the same sentence. The selected mount takes the selection ink whether or not it is armed.

The selection MUST be read from the same slot key the module outfitting ledger and the hull
schematics mark, so the three drawings of one hull cannot disagree about which mount is open.

Source: 007/FR-013.

#### Scenario: An armed mount is selected

- **WHEN** the workspace has an armed hardpoint selected
- **THEN** the plate marks that mount with the selection ink
- **AND** its sentence names it as the selected mount and states that it is armed

#### Scenario: An empty mount is selected

- **WHEN** the workspace has an empty hardpoint selected
- **THEN** the plate marks it as selected
- **AND** its sentence names it as the selected mount and states that nothing is fitted

#### Scenario: The three drawings are compared

- **WHEN** the gunsight plate, the module outfitting ledger and the hull schematics mark a selection
- **THEN** all three read the same slot key

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
figure the canvas measures.

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
