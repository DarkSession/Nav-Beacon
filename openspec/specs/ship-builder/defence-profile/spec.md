## Purpose

This capability presents shields, recovery, cell banks, armour, resistances, hull hardness and module
protection for the active build, read at the SYS allocation the workspace stands at.

## Requirements

### Requirement: Almanac supplies every defence value

Every defence value MUST come from `@elite-dangerous-almanac/core` without local calculation,
clamping or apportionment.

Source: 006/FR-001, 006/SC-001.

#### Scenario: A displayed defence value is compared with the package

- **WHEN** the capability displays a defence value
- **THEN** it equals its Almanac field, with no local calculation, clamping or apportionment behind it

### Requirement: Shield readings

Shields MUST use `BuildMetrics.shieldMetricsResult()` and MUST show the returned strength, role
contributions, resistances and two effective-hit-point readings per damage type: the bare shield, and
the same shield at the standing SYS allocation. Every figure shown MUST be a returned field, each
from its own call. The role contributions are shown once the shield's sources are chosen.

The bare readings MUST NOT move with the allocation. `RESIST` and `MJ` are the bare shield from
`shieldMetricsResult()`, which takes no allocation at all, and the four resistance percentages are
base values that MUST NOT have systems resistance folded into them.

The second effective-hit-point column MUST be
`shieldCapacitorMetricsResult({ systemsPips: <standing allocation> })`, and the allocation MUST
always be passed, because the package's own default is four pips rather than none. Nothing MUST be
multiplied: both columns are `effectiveHitPoints` straight off two package results, and
`systemsResistance` is the package's own field.

The second column's heading MUST state the SYS allocation it is read at, because a figure that moves
with a condition shown without that condition is a misleading number. At four pips the heading reads
`MJ × 4 SYS PIPS`, at two pips `MJ × 2 SYS PIPS`, and at none `MJ × 0 SYS PIPS`, where the column
equals the `MJ` column exactly.

Source: 006/FR-002.

#### Scenario: The shield table is read at four pips

- **WHEN** the standing SYS allocation is four pips
- **THEN** the second effective-hit-point column heads `MJ × 4 SYS PIPS`
- **AND** it holds `shieldCapacitorMetricsResult({ systemsPips: 4 })`'s `effectiveHitPoints` beside
  the bare shield's own figure

#### Scenario: The allocation drops to none

- **WHEN** the standing SYS allocation is zero pips
- **THEN** the column heads `MJ × 0 SYS PIPS` and equals the `MJ` column exactly
- **AND** the `RESIST` and `MJ` columns are unchanged

#### Scenario: A resistance is read

- **WHEN** a shield resistance percentage is shown
- **THEN** it is the base value, with no systems resistance folded into it

#### Scenario: A resistance is negative

- **WHEN** the package returns a negative resistance
- **THEN** the reading remains negative

### Requirement: One diagnosis for a refused shield

A `null` shield result MUST remain unavailable, and a Commander MUST be told the reason once: one
package diagnosis that refuses two readings MUST NOT be presented twice. A generator that is not
fitted, one switched off, and one the power plant does not feed MUST each be stated in the
Commander's own language and MUST remain distinguishable from each other. The statement MUST be
chosen by the package's own field and reason and by nothing else. Every way the plant leaves the
generator unfed MAY share one statement, because they are one thing to act on. Any other diagnosis
MUST keep the package's own words.

Source: 006/FR-003.

#### Scenario: One diagnosis refuses strength and recovery

- **WHEN** one package diagnosis refuses both the shield strength and the recovery
- **THEN** the reason is presented once

#### Scenario: A diagnosis refuses the recovery alone

- **WHEN** a diagnosis refuses the recovery alone
- **THEN** it is presented on its own

#### Scenario: The generator is unpowered

- **WHEN** the power plant does not feed the shield generator
- **THEN** the shield and recovery results are the package's own structured unavailable results
- **AND** the generator's power state remains visible

#### Scenario: The generator is absent or switched off

- **WHEN** the generator is not fitted, or is fitted and switched off
- **THEN** each state is stated in the Commander's own language and remains distinguishable from the
  other and from an unfed generator

### Requirement: Shield recovery readings

Recovery MUST use `BuildMetrics.shieldRecoveryResult()` and MUST keep the regeneration rate, the
regeneration time and the recovery time separate readings.

Source: 006/FR-004.

#### Scenario: Recovery is read

- **WHEN** shield recovery is shown
- **THEN** the regeneration rate, the regeneration time and the recovery time are three separate
  readings

### Requirement: Infinite defence outcomes

Infinite recovery and infinite effective hit points MUST be expressed by their package meaning
without changing the result.

Source: 006/FR-005, 006/SC-002.

#### Scenario: The package returns an infinite result

- **WHEN** the package returns an infinite recovery or an infinite effective-hit-point figure
- **THEN** the reading states the package's meaning and the result is unchanged

### Requirement: Cell bank readings

Cell banks MUST use `BuildMetrics.cellBanks()`. Once the shield's sources are chosen, the reserve MUST
be the package total, every returned bank MUST be listed under it with its class and rating, its cells, its reinforcement and its powered
state, banks differing in any of those MUST be listed apart, and no fitted bank MUST be
indistinguishable from none fitted.

Source: 006/FR-006.

#### Scenario: Banks are fitted

- **WHEN** the package returns fitted cell banks and the shield's sources are chosen
- **THEN** the reserve states the package total
- **AND** each bank is listed with its class and rating, its cells, its reinforcement and its powered
  state

#### Scenario: Two banks differ

- **WHEN** two returned banks differ in class, rating, cells, reinforcement or powered state and the shield's sources are chosen
- **THEN** they are listed apart

#### Scenario: No banks against unpowered banks

- **WHEN** no cell bank is fitted and the shield's sources are chosen
- **THEN** the state is distinct from fitted banks whose powered totals are zero

### Requirement: Armour readings

Armour MUST use `BuildMetrics.armourMetrics()` for hit points, contributions, resistances, effective
hit points, module armour and module protection. Its contributions are shown once its sources are chosen.

Source: 006/FR-007.

#### Scenario: Armour is read without shields

- **WHEN** the build has no shields
- **THEN** armour still shows its total hit points, its resistances and its effective hit points
- **AND** once its sources are chosen, its bulkhead and reinforcement contributions

#### Scenario: Module protection is read

- **WHEN** module armour and the module-protection fraction are shown
- **THEN** each remains distinct from hull hit points

### Requirement: Bulkhead and hull hardness

The fitted bulkhead and the hull hardness MUST come from Almanac records.

Source: 006/FR-008.

#### Scenario: Hull hardness is read

- **WHEN** hull hardness is shown
- **THEN** it is the package's own catalogue value for that hull

#### Scenario: The hull is unknown

- **WHEN** a hull the catalogue does not hold is used
- **THEN** the package construction boundary rejects it before it can become the active build

### Requirement: Source modules keep their package identity

A fitted generator, booster, bulkhead, reinforcement or bank shown as a source MUST be named by its
own package identity — the module the package resolved, its class, its rating and its engineering.
Aggregate package contributions MUST NOT be divided among slots.

Source: 006/FR-009, 006/SC-003.

#### Scenario: A source row is read

- **WHEN** a source row names a fitted module
- **THEN** it states the module the package resolved, with its class, its rating and its engineering

#### Scenario: A contribution is aggregate

- **WHEN** the package returns an aggregate contribution
- **THEN** no share of it is apportioned to a slot

### Requirement: The shield and the armour each offer a summary and their sources

Where the shield or the armour has sources, it MUST offer a choice between a summary and its
sources. A summary holds the pool, the damage-type readings, and the shield's recovery or the
armour's hardness, module armour and module protection. The sources hold the source modules with
their contributions and the shield's cell bank reserve. A shield diagnosis, the generator's power state included, MUST be shown in both views.

Source: 006/FR-002, 006/FR-003, 006/FR-006, 006/FR-007.

#### Scenario: A summary is read

- **WHEN** the shield or the armour shows its summary
- **THEN** it states the pool, the damage-type readings, and the recovery readings (shield) or the
  hull hardness, module armour and module protection (armour)

#### Scenario: The shield's sources are chosen

- **WHEN** a Commander chooses the shield's sources
- **THEN** the shield's role contributions and its cell bank reserve, with every returned bank, are
  shown

#### Scenario: An unfed generator in either view

- **WHEN** the power plant does not feed the shield generator
- **THEN** the generator's power state is shown whether the summary or the sources are chosen

### Requirement: Each source contribution is read with its unit

Each source contribution the shield or the armour shows MUST be read with its unit, the shield's in
megajoules and the armour's in hit points, wherever the unit is drawn once for the whole list.

Source: 006/FR-002, 006/FR-007.

#### Scenario: A source row is read on its own

- **WHEN** assistive technology reads one source row of the shield or the armour
- **THEN** the row's contribution is read with its unit

### Requirement: The shield and the armour each hold their own choice

The shield and the armour MUST each show only the view chosen for it and hold its own choice, and
the choice MUST name both views and state which one is shown. The shield has sources when
`BuildMetrics.shieldMetricsResult()` returns a role contribution or `BuildMetrics.cellBanks()` a
bank; the armour has sources when `BuildMetrics.armourMetrics()` returns a contribution. Each time
the defence profile is opened, each choice MUST start at the summary.

Source: 006/FR-002, 006/FR-007.

#### Scenario: The defence profile is opened

- **WHEN** the defence profile is opened
- **THEN** the shield and the armour each show their summary

#### Scenario: Only the chosen view is shown

- **WHEN** the shield or the armour shows its summary
- **THEN** none of its source modules is shown

#### Scenario: Only the chosen sources are shown

- **WHEN** the shield or the armour shows its sources
- **THEN** its pool and its damage-type readings are not shown

#### Scenario: The shield's choice leaves the armour's alone

- **WHEN** a Commander chooses the shield's sources
- **THEN** the armour still shows the view it showed before

#### Scenario: The defence profile is opened again

- **WHEN** a Commander has chosen the shield's or the armour's sources, leaves the defence profile
  and opens it again
- **THEN** the summary is shown

#### Scenario: The choice is read by assistive technology

- **WHEN** assistive technology reads the shield's or the armour's choice
- **THEN** it names both views and states which one is shown

### Requirement: The choice of view follows the sources

Where the shield or the armour has no sources, it MUST offer no choice and MUST show its summary.
While the defence profile stays open, a shield or armour that loses its last source and gains one
again MUST show the view chosen since the defence profile was last opened, or the summary where
none was chosen.

Source: 006/FR-002, 006/FR-007.

#### Scenario: No sources

- **WHEN** the shield or the armour has no sources
- **THEN** no choice is offered for it and its summary is shown

#### Scenario: Nothing chosen since the profile was opened

- **WHEN** the defence profile has been opened again and no view has been chosen since
- **AND** the shield's or the armour's sources go and come back
- **THEN** the summary is shown

#### Scenario: The sources go and come back

- **WHEN** a Commander has chosen the shield's or the armour's sources
- **AND**, without the defence profile being closed, it loses its last source and gains one again
- **THEN** the summary is shown while it has none
- **AND** the sources are shown again once it has one
