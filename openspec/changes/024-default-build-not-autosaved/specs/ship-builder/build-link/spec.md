## MODIFIED Requirements

### Requirement: Link validation and history

Navigated and pasted links MUST use the same validation and replacement rules.

While a build is active, the address MUST carry that build's link. It MUST be there from the moment
the build becomes active, not only after an edit, and build edits MUST replace the fragment without
adding a history entry for each edit.

This is what makes a build that is in no record recoverable. A build still at the package default for
its hull is stored nowhere, so the address is the only thing holding it, and a Commander who reloads
the tab gets the build back from there.

Source: 001/FR-020, 024/FR-003.

#### Scenario: A link is pasted rather than navigated

- **WHEN** a Commander pastes a build link instead of navigating to it
- **THEN** the same validation and replacement rules apply

#### Scenario: A build becomes active

- **WHEN** a build becomes active and the Commander edits nothing
- **THEN** the address carries that build's link

#### Scenario: A Commander edits the build

- **WHEN** a Commander edits the build
- **THEN** the fragment is replaced
- **AND** no history entry is added for the edit

#### Scenario: The workspace is reloaded on a default build

- **WHEN** a Commander reloads the tab while the workspace holds a build at the package default for
  its hull
- **THEN** the same build is in the workspace
