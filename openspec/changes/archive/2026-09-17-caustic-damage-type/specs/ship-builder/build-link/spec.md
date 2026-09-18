## MODIFIED Requirements

### Requirement: Payload contents

The payload MUST contain only non-derived modelled state: package-resolved identities, game slot
keys, ordinary and package-identified pre-engineering, grade, enabled state, priority, ship name and
ident. Every encoded identity MUST resolve in the installed package. A module's package variant and
later ordinary engineering MUST both survive. Package-defaulted fixed modules MAY be implicit in a
payload because reconstruction always restores them. Enabled state and priority MUST be carried for
every fitted module except those the package prices at no power draw at all: a module whose draw the
package does not publish MUST keep its state, because an unpublished figure is not a zero. That is
the rule the outfitting mount card applies when it decides whether to draw a power chip, and a chip a
Commander can set is a value a link has to carry.

Source: 001/FR-016.

#### Scenario: A module carries a package variant and later engineering

- **WHEN** a fitted module has a package-identified pre-engineering and ordinary engineering applied after it
- **THEN** both survive the round trip through the payload

#### Scenario: A capture states a package variant without its modifiers

- **WHEN** a fitted module carries a package variant and the capture it arrived in states no modifiers for it
- **THEN** the payload carries the variant identity and the build survives the round trip

#### Scenario: The package publishes no power draw for a module

- **WHEN** a fitted module's power draw is not published by the package
- **THEN** the payload carries its enabled state and priority

#### Scenario: The package prices a module at no power draw

- **WHEN** the package prices a fitted module at no power draw at all
- **THEN** the payload need not carry its enabled state and priority

#### Scenario: A valid link is opened

- **WHEN** a Commander opens a valid build link
- **THEN** the modelled build is restored
- **AND** no named save is created

### Requirement: Versioned codec

The application-owned codec MUST be versioned, use package identities and preserve all published
versions. Any compact identifier table MUST be generated from the installed package and used only to
encode or decode identities; it MUST NOT supply game facts or calculations.

A published identifier table MUST be immutable. A payload names the table that decodes it, so the
content a table held when a link was written is the content it MUST still hold. Where a package
upgrade changes what the generator produces, the application MUST mint the next table version for
the new content and MUST keep every earlier table readable. The build MUST refuse to write a
published table, with no flag that permits it.

Source: 001/FR-018, 001/SC-003.

#### Scenario: A link written by an older published version

- **WHEN** a Commander opens a link carrying any published payload version
- **THEN** the codec decodes it and reconstructs an equivalent build

#### Scenario: A payload names a newer version

- **WHEN** a payload names a version this application does not support
- **THEN** the link is refused rather than guessed
- **AND** the current build is unchanged and the failure is explained

#### Scenario: The identifier table is used

- **WHEN** the codec uses its compact identifier table
- **THEN** the table is generated from the installed package
- **AND** it supplies no game fact and no calculation

#### Scenario: A published link records a fit the package no longer permits

- **WHEN** a payload decodes against the table it names but records a fit the installed package refuses
- **THEN** the link is refused and the failure is explained
- **AND** the current build is unchanged
- **AND** no neighbouring article is substituted for the one the payload records

#### Scenario: A package upgrade changes what the table holds

- **WHEN** the installed package makes the generator produce content a published table does not hold
- **THEN** the new content is written as the next table version
- **AND** the published table keeps the content it was published with
- **AND** a new link names the new version while an older link still names, and is decoded by, its own

#### Scenario: A published table has been edited

- **WHEN** the content of a published table no longer matches the hash it declares
- **THEN** the build fails and names the table
- **AND** no table is written
