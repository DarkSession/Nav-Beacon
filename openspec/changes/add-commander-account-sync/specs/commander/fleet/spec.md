## Purpose

This capability derives a signed-in Commander's read-only owned fleet from selected Live Frontier
journal events, states when coverage is incomplete and exposes each confirmed loadout to the
ship-planning tools.

## ADDED Requirements

### Requirement: Fleet loadouts come from the Live journal

The application MUST populate ship loadouts from Live Frontier journal `Loadout` events and MUST NOT
use `/profile` as the source of a ship loadout. The continuation cursor MUST identify the next unread
UTC journal date and zero-based line index. The first cursor MUST be the request date minus 14 days at
line zero. After line `n` commits, it MUST become the same date and line `n + 1`. After a complete day
ends, including an empty day, it MUST become the next UTC date and line zero. An incomplete response
MUST NOT advance it to the next date.

The service MUST pass each candidate line unchanged to `inspectSlef` from
`@elite-dangerous-almanac/core/ships/slef`. If that call refuses a candidate `Loadout` event, the
import MUST stop before that line, keep the last accepted fleet and cursor, and retry that line after
a package update can resolve it. A non-empty malformed line MUST produce the same stop-before-line
result and MUST be retried rather than skipped.

The service MUST retry a network timeout, HTTP 429, HTTP 502, HTTP 503, HTTP 504 or a response that
Frontier marks incomplete. It MUST make at most three attempts for one dated response in one refresh.
Without `Retry-After`, it MUST wait one second before the second attempt and two seconds before the
third. It MUST honour `Retry-After` up to 30 seconds within the request. A longer value MUST end the
request and set the next permitted refresh time to that value. After a third retryable failure, that
time MUST be the later of a supplied `Retry-After` and 60 seconds after the failure. Other HTTP
failures MUST NOT retry. One token refresh MAY follow an authentication failure; another failure
MUST mark authorisation expired.

One dated response MUST NOT exceed 25 MiB. One non-empty line MUST NOT exceed 1 MiB. One projection
batch MUST contain at most 100 candidate `Loadout` lines and MUST NOT exceed 4 MiB. The Node process
MUST stop after 30 seconds and its output MUST NOT exceed 4 MiB. The service MUST start another batch
before a batch bound would be crossed and MUST handle at most ten batches in one refresh. Reaching
that request bound MUST return accepted partial progress and continue from its cursor on the next
refresh. An exceeded response, line, process or output bound MUST stop before the affected line or
response, MUST leave the last accepted fleet and cursor available, and MUST be stated to the
Commander.

Source: 020/FR-013.

#### Scenario: A journal day contains a Loadout event

- **WHEN** the service reads a complete Live journal response containing a `Loadout` event
- **THEN** it uses that event to populate the matching owned ship

#### Scenario: Frontier returns an incomplete journal response

- **WHEN** Frontier reports that a journal response is incomplete
- **THEN** the service does not advance its accepted cursor past that response
- **AND** it makes at most three attempts with the stated delay rule

#### Scenario: Frontier returns an empty journal day

- **WHEN** Frontier returns a complete response with no lines for the cursor date
- **THEN** the cursor advances to the next UTC date at line zero
- **AND** no fifth metadata item is created

#### Scenario: Frontier asks for a long retry delay

- **WHEN** a retryable response gives a `Retry-After` value longer than 30 seconds
- **THEN** the refresh ends without waiting inside the request
- **AND** the next permitted refresh time records that value

#### Scenario: The package refuses a candidate Loadout event

- **WHEN** the Almanac refuses a candidate `Loadout` event
- **THEN** the service keeps the last accepted fleet and cursor before that line
- **AND** the same line can be retried after a package update resolves it

#### Scenario: A journal line is malformed

- **WHEN** a non-empty journal line cannot be framed as a complete event
- **THEN** the service keeps the last accepted fleet and cursor before that line
- **AND** the malformed line is retried rather than skipped

#### Scenario: A journal input exceeds a hard projection bound

- **WHEN** a response, line, process or output exceeds its stated bound
- **THEN** the service does not advance the cursor over the affected line or response
- **AND** the application states the exceeded bound without retaining the input

#### Scenario: A refresh reaches its batch count

- **WHEN** one refresh completes ten bounded projection batches with more journal lines available
- **THEN** it returns the accepted fleet and cursor without starting another batch
- **AND** the next refresh continues from that cursor

### Requirement: Frontier ShipId identifies an owned ship

An owned ship MUST be identified by Frontier `ShipId` within one Commander account. The accepted
journal date-line tuple MUST define event order. A later-order accepted `Loadout` event for that
identity MUST replace its older loadout projection even when both events have the same timestamp. A
later-order ship-sale event for that identity MUST remove the projection without retaining the sale
event. Replaying an event at or before its accepted tuple MUST have no effect.

Source: 020/FR-014.

#### Scenario: A ship receives another Loadout event

- **WHEN** a later accepted `Loadout` event has the same Commander account and `ShipId`
- **THEN** one owned-ship record remains with the later loadout

#### Scenario: Two loadout events have the same timestamp

- **WHEN** two accepted `Loadout` events for one ship share a timestamp on different journal lines
- **THEN** the event with the later date-line tuple supplies the projection
- **AND** replaying the earlier line does not replace it

#### Scenario: The journal reports that an owned ship was sold

- **WHEN** a Live journal event identifies the sale of a projected owned ship
- **THEN** that ship is removed from the owned fleet
- **AND** the sale event is not retained

#### Scenario: StoredShips confirms current ownership

- **WHEN** an accepted `StoredShips` event is later than projected ships and identifies Frontier's
  stored ships while the latest `Loadout` identifies the current ship
- **THEN** projections absent from both sets are removed
- **AND** the event creates no ship without an accepted `Loadout`
- **AND** the `StoredShips` payload is not retained

### Requirement: Fleet storage is feature-specific

For each owned ship, the service MUST store only Frontier `ShipId`, source date-line tuple, ship
name, ship ident and the package-produced ship model. That model contains only hull symbol, game slot
keys, module symbols, package-identified pre-engineering, blueprint `fdname`, completed grade,
experimental-effect `fdname`, enabled state and priority. The service MUST store only the journal
metadata listed below.

The service MUST NOT store hull or module names, calculated values, cargo capacity, hull value,
module value, rebuy, hot state, fuel, module health, ammunition, engineer identity, blueprint ID,
engineering quality, raw modifiers, raw journal events, unrelated event fields, a general event
history or a general CAPI response document. Fleet import metadata MUST contain exactly four items:
the coverage start date; the next-unread cursor as one journal date-line tuple; the last
accepted `StoredShips` result as its date-line tuple plus `complete` or `incomplete`, or its absence;
and the next permitted refresh time. The result MUST be `incomplete` when that event names any ship
without an accepted projection or no accepted `Loadout` identifies the current ship. Only a later
accepted `StoredShips` event MAY recompute that result.
Server logs MUST NOT contain a Customer ID, Commander name, journal body, ship projection, `ShipId`
or package diagnostic text.

Source: 020/FR-015.

#### Scenario: A journal response contains unrelated events and fields

- **WHEN** the service completes that journal response
- **THEN** only the fleet projection, coverage start date, next-unread date-line tuple, last
  `StoredShips` date-line and completeness result or its absence, and next permitted refresh time
  remain
- **AND** the raw response and unrelated data are discarded

### Requirement: Fleet facts remain honest

The application MUST identify each fleet entry as a ship confirmed by an available Live `Loadout`
event and MUST remove it when an accepted ownership event states that it was sold. It MUST state when
journal coverage cannot confirm the complete current fleet. `ShipLoadout` and `BuildMetrics.of(build)`
from `@elite-dangerous-almanac/core` MUST supply ship construction and calculated values. A `Loadout`
event the package cannot resolve MUST be refused and not stored. The service MUST request the
package diagnostic in the active supported locale, return it only as refresh feedback and MUST NOT
store or privately translate it. An unavailable calculated value MUST be shown with the package
reason and MUST NOT be substituted.

Source: 020/FR-016.

#### Scenario: Available journal history does not cover every owned ship

- **WHEN** Frontier provides no usable `Loadout` event for one or more ships
- **THEN** the application states that the owned fleet can be incomplete
- **AND** it does not claim that the missing ship does not exist

#### Scenario: A journal module identity is not in the installed package

- **WHEN** the package cannot resolve a module identity in a candidate `Loadout` event
- **THEN** the candidate event is refused and not stored
- **AND** the application states the package reason without inventing a replacement

#### Scenario: A package refusal is shown in another locale

- **WHEN** a Commander refreshes in a supported locale and the package refuses a candidate event
- **THEN** the package supplies the diagnostic for that locale
- **AND** the service returns it without storing a diagnostic string

### Requirement: Owned ships are read-only

An owned-ship record MUST NOT accept edits from the planning tools. A Commander MAY copy an owned
loadout into a separate saved build with its own application record identity. Editing or deleting
that saved build MUST NOT change the owned ship.

Source: 020/FR-017.

#### Scenario: A Commander plans from an owned ship

- **WHEN** a Commander copies an owned loadout into the ship builder
- **THEN** the builder creates a separate saved build identity
- **AND** later plan edits leave the owned ship unchanged

### Requirement: Fleet refresh reports its result

A signed-in Commander MUST be able to request a fleet refresh. The application MUST state whether
the owned fleet is current to the accepted journal cursor, waiting for Frontier, incomplete or
blocked by expired authorisation. A failed refresh MUST leave the last accepted fleet available.

Source: 020/FR-018.

#### Scenario: Frontier cannot complete a refresh

- **WHEN** a refresh fails after the permitted retries
- **THEN** the last accepted owned fleet remains available
- **AND** the application states why the refresh is not current
