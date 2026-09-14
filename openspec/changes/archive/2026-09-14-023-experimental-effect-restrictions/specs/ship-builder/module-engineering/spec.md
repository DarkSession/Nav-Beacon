## MODIFIED Requirements

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
