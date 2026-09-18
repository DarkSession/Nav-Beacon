## ADDED Requirements

### Requirement: Versioned equipment link codec

The application-owned equipment codec MUST be versioned, use package identities and preserve all
published versions. The identifier table MUST be generated from the installed package and used only
to encode or decode identities; it MUST NOT supply game facts or calculations.

A published identifier table MUST be immutable. A payload names the table that decodes it, so the
content a table held when a link was written is the content it MUST still hold. Where a package
upgrade changes what the generator produces, the new content MUST be written as the next table
version and every earlier table MUST stay readable. The build MUST refuse to write a published
table, with no flag that permits it, and MUST refuse to run where a published table no longer
matches the hash it declares.

A link the bench opens MUST be decoded against the table version its payload names, for every
version the application carries.

Decoding against the named table resolves the identities the table holds. Whether the installed
package still publishes them is a separate question, answered by "A link that names unresolvable
equipment" (013/FR-021), which this requirement does not alter.

Source: 013/FR-020, 013/SC-005.

#### Scenario: A link written by an older published version

- **WHEN** a Commander opens an equipment link carrying a published payload version below the
  current one, naming equipment the installed package still publishes
- **THEN** the codec decodes it against the table that version names and restores an equivalent
  loadout
- **AND** the weapons and modifications the bench was only holding are restored with it

#### Scenario: A payload names a version the application does not carry

- **WHEN** an equipment payload names a table version this application does not carry
- **THEN** the link is refused rather than guessed
- **AND** the restored loadout on the bench is unchanged and the Commander is told why

#### Scenario: A package upgrade changes what the table holds

- **WHEN** the installed package makes the generator produce content a published table does not hold
- **THEN** the new content is written as the next table version
- **AND** the published table keeps the content it was published with
- **AND** a new link names the new version while an older link still names, and is decoded by, its own

#### Scenario: A published table's content has moved

- **WHEN** the generator produces content the committed table for the current version does not hold
- **THEN** the build fails and names the version the new content belongs under
- **AND** no table is written

#### Scenario: A published table has been edited

- **WHEN** the content of a published equipment table no longer matches the hash it declares
- **THEN** the build fails and names the table
- **AND** no table is written

#### Scenario: The identifier table is used

- **WHEN** the codec uses its compact identifier table
- **THEN** the table is generated from the installed package
- **AND** it supplies no game fact and no calculation

## MODIFIED Requirements

### Requirement: Exporting the open loadout

Users MUST be able to export the open loadout as a link that restores it, as a
structured payload, and as a readable summary.

A link MUST restore exactly the loadout it was made from, including the weapons
and modifications the bench was only holding, for every loadout the application
can build.

A link the bench publishes into the fragment or offers for export MUST name the
current table version, whatever version the loadout arrived on. Where the current
table cannot represent the loadout, no link MUST be published or offered and the
loadout on the bench MUST be left as it is. An equipment fragment already in the
address MUST be removed, so the address names no loadout the bench cannot share,
and a fragment belonging to another tool MUST be left as it is. The Commander MUST
be told what refused it — the mount, or the suit where the suit is what the current
table cannot name — and the reason.

Source: 013/FR-020, 013/SC-005.

#### Scenario: A link is exported and opened

- **WHEN** a Commander copies the link of an open loadout and opens it
- **THEN** the same suit, grades, weapons and modifications are restored
- **AND** the weapons and modifications the bench was only holding are restored
  with them

#### Scenario: A readable summary is exported

- **WHEN** a Commander exports a readable summary
- **THEN** it names the suit, its grade, each weapon with its grade, and each
  fitted modification

#### Scenario: A loadout opened from an older version reaches the bench

- **WHEN** a loadout opened from a link naming an earlier table version reaches
  the bench
- **THEN** the link published into the fragment names the current table version
- **AND** it restores the same suit, grades, weapons and modifications

#### Scenario: The current table cannot represent the open loadout

- **WHEN** the current table holds no identity for something the open loadout
  carries
- **THEN** no link is published into the fragment and none is offered for export
- **AND** the loadout on the bench is left as it is
- **AND** an equipment fragment already in the address is removed, and a fragment
  belonging to another tool is left as it is
- **AND** the Commander is told what refused it — the mount, or the suit — and the
  reason
