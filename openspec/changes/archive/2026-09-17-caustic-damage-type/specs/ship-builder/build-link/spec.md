## MODIFIED Requirements

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

#### Scenario: A package upgrade changes what the table holds

- **WHEN** the installed package makes the generator produce content a published table does not hold
- **THEN** the new content is written as the next table version
- **AND** the published table keeps the content it was published with
- **AND** a new link names the new version while an older link still names, and is decoded by, its own

#### Scenario: A published table has been edited

- **WHEN** the content of a published table no longer matches the hash it declares
- **THEN** the build fails and names the table
- **AND** no table is written
