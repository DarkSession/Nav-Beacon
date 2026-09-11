## MODIFIED Requirements

### Requirement: Offline use of the equipment bench

This requirement applies to every local capability of the equipment bench. Every local bench
capability MUST remain usable offline after first load. If the Commander is signed in, a remote
synchronisation that needs the network MUST remain pending without blocking the bench.

Source: 013/FR-026, 013/SC-006, 020/FR-011.

#### Scenario: The bench is used with no network connection

- **WHEN** a Commander loses the network connection after first load
- **THEN** every local bench capability remains usable
- **AND** a remote synchronisation remains pending until a later eligible action or explicit retry
