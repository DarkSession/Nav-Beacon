## ADDED Requirements

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

- **WHEN** a link is published while the address stands on a history entry later than the one the
  build is being edited on
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
