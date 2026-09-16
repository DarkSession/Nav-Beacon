## Purpose

A Commander shares a build as a URL that carries the whole build in its fragment. This capability
owns the fragment payload, what the payload may hold, the versioned codec that writes and reads it,
and the size bound the codec has to meet.

## Requirements

### Requirement: Fragment-only payload

A build link MUST keep its payload entirely in the URL fragment and MUST cause no transmission of
build data.

Source: 001/FR-015, 001/SC-004.

#### Scenario: Sharing a build as a link

- **WHEN** the application produces a build link
- **THEN** the versioned payload is in the fragment
- **AND** the path and query carry no build data

#### Scenario: Opening a build link

- **WHEN** a Commander opens a build link
- **THEN** no automatic request sends build data or contacts another origin

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

### Requirement: Values excluded from the payload

Calculated values, catalogue facts, prices, purchase provenance, notes and storage identities MUST
NOT enter the payload.

Source: 001/FR-017.

#### Scenario: Encoding a build with calculated values and a note

- **WHEN** the codec encodes a build
- **THEN** no calculated value, catalogue fact, price, purchase provenance, note or storage identity is in the payload

### Requirement: Versioned codec

The application-owned codec MUST be versioned, use package identities and preserve all published
versions. Any compact identifier table MUST be generated from the installed package and used only to
encode or decode identities; it MUST NOT supply game facts or calculations.

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

### Requirement: Refusal of a build the codec cannot represent

A build the codec cannot represent losslessly MUST be refused with the affected slot and reason, and
SLEF MUST remain available.

Source: 001/FR-019.

#### Scenario: A build cannot be encoded losslessly

- **WHEN** the codec cannot represent a build without loss
- **THEN** the application refuses the link and states the affected slot and the reason
- **AND** SLEF remains available for that build

#### Scenario: An invalid or truncated payload is opened

- **WHEN** a Commander opens a link whose payload is invalid, truncated or unsupported
- **THEN** the current build is unchanged
- **AND** the application explains the failure

### Requirement: Link validation and history

Navigated and pasted links MUST use the same validation and replacement rules.

A build's link MUST be published from the moment the build becomes active, not only after an edit.
Build edits MUST replace the fragment without adding a history entry for each edit. Where the codec
refuses the build, nothing is published, and a fragment carrying an earlier build's link MUST be
removed, so the address names no build the workspace does not hold. Removing that fragment publishes
nothing, so it is not a link stated into the address.

This is what makes a build that is in no record recoverable. A build still at the package default
for its hull — `getDefaultLoadout(<hull symbol>)` in
`@elite-dangerous-almanac/core/ships/default-loadouts` — is stored nowhere, so a published link is the
only thing holding it, and a Commander who reloads the tab gets the build back from the address that
carries it.

What the address does with a published link is stated by "The address keeps the published link"
(022/FR-001).

Source: 001/FR-020, 024/FR-003.

#### Scenario: A link is pasted rather than navigated

- **WHEN** a Commander pastes a build link instead of navigating to it
- **THEN** the same validation and replacement rules apply

#### Scenario: A build becomes active

- **WHEN** a build becomes active and the Commander edits nothing
- **THEN** that build's link is published

#### Scenario: A Commander edits the build

- **WHEN** a Commander edits the build
- **THEN** the fragment is replaced
- **AND** no history entry is added for the edit

#### Scenario: The codec refuses the active build

- **WHEN** the codec cannot represent the active build losslessly
- **THEN** no link is published for it
- **AND** a fragment carrying an earlier build's link is removed

#### Scenario: The workspace is reloaded on a default build

- **WHEN** a Commander reloads the tab while the workspace holds a build at the package default for
  its hull
- **AND** the fragment carries that build's published link
- **THEN** the same build is in the workspace

### Requirement: Codec value size bound

A codec value for the package hull with the most slots, with every slot fitted and every supported
modelled field populated, MUST not exceed 500 characters, its `b.` prefix counted among them. The
bound is on the value the codec produces, not on the URL carrying it: the origin, path and `#` belong
to the deployment, so a bound stated over them could not be enforced by the codec that has to satisfy
it. Builds that cannot meet the limit MUST use SLEF instead.

Source: 001/FR-021.

#### Scenario: The largest build is encoded

- **WHEN** the codec encodes the package hull with the most slots, every slot fitted and every supported modelled field populated
- **THEN** the codec value is at most 500 characters, counting its `b.` prefix

#### Scenario: A payload exceeds the limit

- **WHEN** a build-link payload is longer than the published 500-character limit
- **THEN** it is refused before decoding

#### Scenario: A build cannot meet the limit

- **WHEN** a build cannot be encoded inside the limit
- **THEN** SLEF is used instead

### Requirement: The address keeps the published link

While a build's link is published, the address MUST carry it. An address that carries no fragment
at all MUST have the published link stated again in place, whatever moved the fragment away. The
address bar then carries the link to the build that is open, so the address opens that build
wherever it is taken.

Restoring MUST NOT add a history entry. A restoration puts back what the address already claimed
to hold, so it is not an edit and does not lengthen a Commander's history.

A fragment the address already carries MUST be left alone, whichever kind it is:

- another build link is how a Commander reaches another build, and MUST be interpreted under the
  standing ingress rules rather than written over;
- any other fragment MUST NOT be removed or replaced, whether or not this application wrote it.
  The address is shared with whatever else uses it, and a fragment that is not a build link is
  neither interpreted nor cleared here.

Restoring MUST be bounded to the document the link was published onto. Where the address is for
another document, nothing is stated.

A restored link MUST NOT be read back as an arriving link. The build that is open is the build
the restored link describes, and restoring it MUST leave that build untouched — not replaced, and
not offered for replacement.

Where no link is published, because there is no build or because the link was refused, the
application MUST NOT state anything into the address.

Source: 022/FR-001.

#### Scenario: The address carries no fragment

- **WHEN** the address of the document a published build belongs to carries no fragment
- **THEN** the published link is stated again in the address
- **AND** no history entry is added
- **AND** opening that address where no build is stored opens the same build

#### Scenario: A link is published onto a later history entry

- **WHEN** a link is published while the address stands on a history entry later than the one the build is being edited on
- **AND** the address returns to the earlier entry of the same document
- **THEN** the address carries the published link

#### Scenario: The address carries a different build link

- **WHEN** the address carries a build link other than the one published
- **THEN** the published link is not stated again
- **AND** the incoming link is interpreted under the standing ingress rules

#### Scenario: The address carries a fragment that is not a build link

- **WHEN** the address carries a fragment that is not empty and is not a build link
- **THEN** the published link is not stated again
- **AND** the fragment is left exactly as it is

#### Scenario: A restoration does not disturb the build

- **WHEN** the published link is stated again into the address
- **THEN** the build that is open is unchanged
- **AND** no replacement is offered for it

#### Scenario: The address is for another document

- **WHEN** the address is for a document other than the one the link was published onto
- **THEN** the published link is not stated again

#### Scenario: No link is published

- **WHEN** no build link is published, because there is no build or the link was refused
- **THEN** nothing is stated into the address
