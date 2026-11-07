## MODIFIED Requirements

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
