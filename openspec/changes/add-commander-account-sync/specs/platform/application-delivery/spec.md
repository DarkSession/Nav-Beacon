## MODIFIED Requirements

### Requirement: The one time limit the application carries

Applying an update — the restart and the notice the restarted session draws — is a user-interface
time limit that meets none of WCAG 2.2.1's conditions. Success criterion 2.2.1 Timing Adjustable is
excluded by constitution V for this mechanism and no other, and this MUST be the application's only
limit on how long a Commander has to act.

Frontier OAuth state MUST be valid when server elapsed time is less than ten minutes and MUST be
invalid when server elapsed time is ten minutes or more. The expired state MAY end that sign-in
attempt, and the application MUST offer a fresh attempt without changing local work. Sessions and
access credentials MAY expire for security. Their expiry MUST NOT discard or change local work or
close a local interaction in progress. The application MUST request authentication again only when
a protected network action needs it. No security expiry adds another WCAG 2.2.1 exclusion. Every
conformance statement in this repository MUST name 2.2.1 among the excluded criteria.

Source: 011/FR-025, 020/FR-023.

#### Scenario: A conformance statement is written

- **WHEN** the application states its WCAG conformance
- **THEN** the statement names 2.2.1 among the excluded criteria

#### Scenario: Another mechanism wants a time limit

- **WHEN** a mechanism other than applying an update wants to limit how long a Commander has to act
- **THEN** it needs an amendment rather than a reading of this requirement

#### Scenario: A security credential expires

- **WHEN** a session or Frontier credential expires while local work is open
- **THEN** the local work and current interaction remain unchanged
- **AND** authentication is requested only when a protected network action needs it

#### Scenario: Frontier OAuth state expires

- **WHEN** a Frontier callback arrives at or after ten minutes from sign-in start
- **THEN** that sign-in attempt ends and a fresh attempt is available
- **AND** local work remains unchanged
