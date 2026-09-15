## MODIFIED Requirements

### Requirement: One selected event replaces the active build

Where exactly one event is selected, import MUST behave as it does for a pasted
entry: the package validates and normalises it, and it becomes the active build.
The imported build MUST NOT also be written to a named record. It is the active
build, and it is kept exactly as any active build is kept: in the record autosave
holds it in where it carries a decision, and in the address where it does not.

Source: 016/FR-009, 024/FR-001.

#### Scenario: One event is selected

- **WHEN** a Commander selects one event from a journal file and loads it
- **THEN** it becomes the active build
- **AND** no named record is created for it
