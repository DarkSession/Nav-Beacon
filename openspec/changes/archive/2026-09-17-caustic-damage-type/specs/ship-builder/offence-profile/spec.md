## MODIFIED Requirements

### Requirement: Damage by type

Every conventional damage type the build deals — kinetic, thermal, explosive, caustic, absolute and
unclassified — MUST be stated with its exact returned amount and its share of the conventional total,
beside the bar that draws those shares. A type the build does not deal MUST NOT be given a line, a
zero or a segment. No amount MAY be folded into another type.

Each amount MUST come from `damageByType` on `BuildMetrics.weaponMetrics()` for the fitted build, and
the conventional types MUST be that split's members less `antiXeno`.

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
