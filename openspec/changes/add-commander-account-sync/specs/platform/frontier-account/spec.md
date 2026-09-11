## Purpose

This capability gives a Commander an optional Frontier-backed identity while anonymous tools keep
their local behaviour and require no account.

## ADDED Requirements

### Requirement: Frontier sign-in is optional

The application MUST offer Frontier as its only sign-in provider. A Commander who does not sign in
MUST retain every non-Commander capability, including local save, autosave, import, export and
fragment sharing. Commander account, synchronisation and fleet actions MUST require sign-in.

Source: 020/FR-001.

#### Scenario: A Commander does not sign in

- **WHEN** a Commander uses the application without signing in
- **THEN** every non-Commander capability remains available
- **AND** account, synchronisation and fleet actions state that they require sign-in

### Requirement: Frontier is the source of account identity

The account MUST use Frontier's numeric Customer ID as its stable identity and the Commander name
from Frontier as its display value. A change to the Commander name MUST NOT create another account.
The service MUST store no profile value beyond the Customer ID and Commander name.

Source: 020/FR-002.

#### Scenario: A Commander changes their name

- **WHEN** Frontier returns the same Customer ID with a different Commander name
- **THEN** the existing account receives the different name
- **AND** its records remain attached to the same account

### Requirement: Credentials stay on the server

Frontier access and refresh tokens MUST stay on the server, MUST be protected at rest and MUST NOT
be returned to browser code. The browser MUST use a secure, HTTP-only, same-site session cookie.
The service MUST store only a state hash, browser-correlation hash and expiry for each Frontier OAuth
attempt. The starting browser MUST hold the random correlation value in a secure, HTTP-only,
same-site cookie. The service MUST accept a callback only when both values match. It MUST consume the
attempt atomically on the first valid callback and remove used or expired attempts. A state MUST be
valid when server elapsed time is less than ten minutes and MUST be invalid when server elapsed time
is ten minutes or more. A late, repeated or differently correlated callback MUST require a fresh
sign-in without changing local work.

A session MUST expire 30 days after creation or its last renewal, or 180 days after creation,
whichever occurs first. The first successful protected request at least 24 hours after the last
renewal MUST set renewable expiry to 30 days after that request and MUST NOT extend absolute expiry.
Other requests that day MUST NOT write another renewal or change the expiry calculation. Expired
rows MUST be removed during a sign-in start or protected request. Detecting expiry MUST clear browser
account state and the fleet cache while retaining planning records and current work. Signing out
MUST end the browser session without deleting the account or its records.

Server logs MUST NOT contain a Frontier Customer ID, Commander name, token, OAuth authorisation code,
OAuth state, browser-correlation value, anti-forgery value or cookie. Access logging MUST record the
callback route template without its query.

Source: 020/FR-003.

#### Scenario: A signed-in browser requests its account

- **WHEN** a signed-in browser requests its account state
- **THEN** the response identifies the Commander without containing a Frontier token

#### Scenario: An OAuth callback arrives at the ten-minute boundary

- **WHEN** Frontier returns an OAuth callback at or after ten minutes from sign-in start
- **THEN** the application refuses that state and offers to start sign-in again
- **AND** local work remains unchanged

#### Scenario: An OAuth callback is replayed on another instance

- **WHEN** one service instance consumes a valid state and the callback reaches another instance
- **THEN** the repeated callback is refused
- **AND** no second session is created

#### Scenario: A callback opens in another browser

- **WHEN** a valid unused state returns without the starting browser's matching correlation cookie
- **THEN** the callback is refused and that attempt is consumed atomically
- **AND** neither browser can use that state to create a session or start a record upload

#### Scenario: A Commander signs out

- **WHEN** a Commander signs out
- **THEN** that browser session can no longer read or change remote Commander data
- **AND** the account and its records remain available for a later sign-in
- **AND** local account state and the local fleet cache are cleared
- **AND** local planning records remain available without sign-in

#### Scenario: A browser session reaches its renewable limit

- **WHEN** server time reaches 30 days since the session's creation or last renewal
- **THEN** that session cannot access remote Commander data
- **AND** browser account state and the fleet cache are cleared
- **AND** planning records and current work remain available

#### Scenario: An active session reaches its renewal point

- **WHEN** the first successful protected request arrives at least 24 hours after the last renewal
- **THEN** renewable expiry becomes 30 days after that request without passing absolute expiry
- **AND** another request that day does not write another renewal

#### Scenario: An active session reaches its absolute limit

- **WHEN** server time reaches 180 days after session creation despite later renewals
- **THEN** the session cannot access remote Commander data
- **AND** browser account state and the fleet cache are cleared
- **AND** planning records and current work remain available

#### Scenario: An OAuth callback is logged

- **WHEN** the server logs a successful or refused Frontier callback
- **THEN** it records the route template without the query
- **AND** no account identifier, credential or correlation value enters the log

### Requirement: Only Live game data is accepted

The account connection MUST request and accept only Frontier Live game data. Legacy game data MUST
NOT populate any Commander capability.

Source: 020/FR-004.

#### Scenario: Frontier identifies data as not Live

- **WHEN** an account response or journal event belongs to a legacy game version
- **THEN** it is not stored or presented as Commander data

### Requirement: Account requests disclose their destination

The browser MUST send Commander account and record requests only to the application's own origin.
The server MAY contact Frontier for the signed-in features the Commander requested. The application
MUST identify Frontier before sign-in and MUST NOT send build, loadout or note data to Frontier.

Source: 020/FR-005.

#### Scenario: A Commander starts sign-in

- **WHEN** a Commander starts Frontier sign-in
- **THEN** the application identifies Frontier as the external service
- **AND** no build, loadout or note data accompanies the request

### Requirement: Account deletion removes Commander data

The application MUST let a signed-in Commander delete the account. On confirmation, the browser
MUST first clear its account state, fleet cache, sync cursor and pending remote operations, and MUST
mark local planning records local-only. It MUST keep that local result whether the server response
arrives, is refused or is lost. If that local transaction fails, the browser MUST state the failure
and MUST NOT send the server deletion. The authenticated server operation MUST remove the Customer
ID, Commander name, protected Frontier tokens, sessions, remote records, fleet projections and
journal cursor metadata in one transaction. That transaction MUST treat already-absent dependent
records as success, so a repeat before session removal has the same result. If the request did not
commit, a later sign-in MUST let the Commander retry deletion. If it committed, a later sign-in MUST
create an empty account for that Customer ID. Neither outcome MAY upload the retained local-only
records without an explicit new save or copy.

Source: 020/FR-006.

#### Scenario: A Commander confirms account deletion

- **WHEN** a signed-in Commander confirms account deletion
- **THEN** the service removes all data held for that account
- **AND** local browser records remain available without sign-in
- **AND** no cached fleet or pending remote operation remains

#### Scenario: The deletion response is lost

- **WHEN** the browser receives no response after it sends a confirmed account deletion
- **THEN** it remains anonymous with no fleet cache or remote operation
- **AND** retained planning records remain local-only
- **AND** a later sign-in does not upload those records automatically

#### Scenario: Local account cleanup fails

- **WHEN** browser storage refuses the local account-deletion transaction
- **THEN** the application states the failure and sends no server deletion
- **AND** the signed-in account and local records remain available for another attempt
