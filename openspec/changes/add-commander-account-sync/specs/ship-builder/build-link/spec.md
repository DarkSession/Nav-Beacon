## MODIFIED Requirements

### Requirement: Fragment-only payload

A build link MUST keep its payload entirely in the URL fragment. Opening or sharing the link MUST
NOT put build data in a request path, query, referrer or request to another origin. If the Commander
is signed in, the reconstructed build MAY enter normal same-origin record synchronisation after it
opens as an autosave.

Source: 001/FR-015, 001/SC-004, 020/FR-021.

#### Scenario: Sharing a build as a link

- **WHEN** the application produces a build link
- **THEN** the versioned payload is in the fragment
- **AND** the path and query carry no build data

#### Scenario: Opening a build link

- **WHEN** an anonymous Commander opens a build link
- **THEN** no automatic request sends build data or contacts another origin

#### Scenario: A signed-in Commander opens a build link

- **WHEN** a signed-in Commander opens a valid build link
- **THEN** the browser reconstructs the build from the fragment
- **AND** its autosave can synchronise through the same-origin record service
