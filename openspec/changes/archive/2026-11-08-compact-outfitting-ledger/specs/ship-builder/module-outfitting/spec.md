## ADDED Requirements

### Requirement: The ledger offers the mount kinds in a fixed order

A Commander MAY narrow the ledger to one kind of mount. The kinds offered MUST be hardpoints, utility
mounts, core internals (with armour and the cargo hatch) and optional internals, in that order, for
every build. The order is chosen because it is the order in which the kinds first appear in `ShipLoadout.slots()` for every
hull, counting armour and the cargo hatch as core internals. A choice that shows every kind, where it
is offered, MUST come first.

Source: 002/FR-002a.

#### Scenario: Every kind can be shown at once

- **WHEN** the ledger offers a choice that shows every kind of mount
- **THEN** the choice that shows every kind comes first, followed by hardpoints, utility mounts,
  core internals and optional internals, in that order

#### Scenario: One kind is shown at a time

- **WHEN** the ledger shows only one kind of mount at a time
- **THEN** the choices are hardpoints, utility mounts, core internals and optional internals, in
  that order

#### Scenario: Armour and the cargo hatch

- **WHEN** a Commander narrows the ledger to the core internals
- **THEN** the armour and the cargo hatch are shown with them

### Requirement: The ledger holds the Commander's choice of kind while it is offered

A press on any of the ledger's choices, the choice that shows every kind included, is the
Commander's choice. Before any press, the ledger MUST show the first choice offered. When the
choices offered change, the ledger MUST show the Commander's choice if it is still offered, and
otherwise the first choice offered.

Source: 002/FR-002a.

#### Scenario: No choice made, every kind offered

- **WHEN** the Commander has made no choice and the ledger offers a choice that shows every kind
- **THEN** every kind is shown

#### Scenario: No choice made, one kind at a time

- **WHEN** the Commander has made no choice and the ledger shows one kind at a time
- **THEN** hardpoints are shown

#### Scenario: A chosen kind stays shown

- **WHEN** a Commander has chosen the optional internals
- **AND** the ledger changes between showing one kind at a time and offering every kind at once
- **THEN** the optional internals are still the kind shown

#### Scenario: The choice of every kind is no longer offered

- **WHEN** every kind is shown
- **AND** the ledger changes to showing one kind at a time
- **THEN** hardpoints are shown

#### Scenario: The choice of every kind is offered again

- **WHEN** every kind is shown
- **AND** the ledger changes to showing one kind at a time
- **AND** the Commander makes no choice
- **AND** the ledger offers every kind again
- **THEN** every kind is shown
