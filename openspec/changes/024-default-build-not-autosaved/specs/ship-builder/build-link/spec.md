## MODIFIED Requirements

### Requirement: Link validation and history

Navigated and pasted links MUST use the same validation and replacement rules.

A build's link MUST be published from the moment the build becomes active, not only after an edit.
Build edits MUST replace the fragment without adding a history entry for each edit. Where the codec
refuses the build, nothing is published, and a fragment carrying an earlier build's link MUST be
removed, so the address names no build the workspace does not hold.

This is what makes a build that is in no record recoverable. A build still at the package default
for its hull is stored nowhere, so a published link is the only thing holding it, and a Commander
who reloads the tab gets the build back from the address that carries it.

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
