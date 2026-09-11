## MODIFIED Requirements

### Requirement: Offline after first load

Every non-Commander capability MUST remain usable offline after first load, unchanged. Locally
cached Commander records and the last accepted fleet projection MUST remain readable offline.
Sign-in, sign-out, account deletion, synchronisation and fleet refresh MAY require a network and
MUST state that requirement without blocking local work.

Source: 015/FR-013, 015/SC-006, 020/FR-022.

#### Scenario: A Commander goes offline

- **WHEN** a Commander who has loaded the application once goes offline
- **THEN** every non-Commander capability remains usable
- **AND** cached Commander records and the last accepted fleet remain readable
- **AND** network actions state that they need a network
