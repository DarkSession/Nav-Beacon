## Purpose

This capability keeps selected ship-build and equipment-loadout records consistent for one signed-in
Commander across browsers without changing anonymous local persistence.

## ADDED Requirements

### Requirement: Named saves and autosaves are eligible for synchronisation

For a signed-in Commander, the application MUST synchronise named saves and unnamed autosaves for
ship builds and equipment loadouts. Each record MUST have an application record identity distinct
from a Frontier ship identity. Notes and device claim identities MUST remain local and MUST NOT
enter a remote record.

Source: 020/FR-007.

#### Scenario: A signed-in Commander saves both record types

- **WHEN** a signed-in Commander saves a ship build and an equipment loadout
- **THEN** both records become available to the Commander's other signed-in devices
- **AND** neither remote record contains a note or device claim identity

### Requirement: First sign-in merges local and remote records

On first sign-in in a browser, the application MUST upload its eligible local records and retrieve
the Commander's remote records without a separate upload question. Records with different
application record identities MUST both remain. The merge MUST NOT replace a local record only
because another record has the same name or modelled state. Records with the same identity are equal
only when every field in their live-record contract is equal. Server revision, server content time
and live-page protection deadline MUST NOT affect equality. Equal records MUST accept the remote
revision. A difference in any synchronised field MUST become a conflicting write.

Source: 020/FR-008.

#### Scenario: First sign-in has records on both sides

- **WHEN** a Commander first signs in from a browser that has local records while the account has
  remote records
- **THEN** the resulting library contains both sets
- **AND** no record is lost because its name or modelled state matches another record

#### Scenario: The same identity has the same synchronised fields

- **WHEN** first sign-in finds local and remote records with the same identity and all synchronised
  fields equal
- **THEN** one record remains and accepts the remote revision

#### Scenario: The same identity has different state

- **WHEN** first sign-in finds local and remote records with the same identity and different state
- **THEN** the application offers overwrite, keep both and cancel
- **AND** neither version is silently lost

#### Scenario: The same identity has a different name or named state

- **WHEN** first sign-in finds the same identity and payload with a different name or named state
- **THEN** the application treats the records as conflicting writes
- **AND** neither expiry behaviour nor name changes silently

### Requirement: Revisions protect conflicting writes

Each remote record MUST carry a revision that changes on every accepted write. A write against an
older revision MUST preserve both versions until the Commander chooses overwrite, keep both or
cancel. Overwrite MUST replace the remote record with the local version. Keep both MUST give the
local version a different application record identity. Cancel MUST leave both versions unchanged,
mark the local version local-only and clear its pending remote operation. A protection renewal MUST
NOT change the content record revision or account revision.

Source: 020/FR-009.

#### Scenario: Two devices change one record

- **WHEN** a device tries to write a record after another device changed its revision
- **THEN** the application offers overwrite, keep both and cancel
- **AND** neither version is silently lost

#### Scenario: A live page renews protection

- **WHEN** the service accepts a protection renewal without a content change
- **THEN** the content record revision and account revision remain unchanged
- **AND** an unchanged write from another device does not become stale

#### Scenario: A Commander cancels a stale-write conflict

- **WHEN** a Commander chooses cancel for two different live versions
- **THEN** both versions keep their content
- **AND** the local version becomes local-only with no pending remote operation

### Requirement: Record deletion synchronises

Deleting a synchronised record MUST delete that remote record. An unchanged local copy that no live
page claims MUST be removed after it next synchronises. A live page that claims the record MUST keep
its active work, pause autosave and state the deletion conflict even when its content is unchanged.
A device with other unsynchronised changes MUST also keep its version and state the conflict.
Overwrite, including explicit resume from a live-page pause, MUST restore the local version under the
same application record identity at a revision newer than the tombstone. Keep both MUST leave the
tombstone in place and upload the local version under a fresh application record identity. Cancel
MUST leave the tombstone in place, mark the local version local-only and clear its pending remote
operation.

Source: 020/FR-010.

#### Scenario: Another device deletes an unchanged record

- **WHEN** a device synchronises an unchanged local copy that no live page claims after another
  device deleted the remote record
- **THEN** the local copy is removed

#### Scenario: Another device deletes a live page's unchanged record

- **WHEN** a live page synchronises an unchanged record it claims after another device deleted it
- **THEN** its active work remains available and autosave pauses
- **AND** explicit resume restores the remote record under the old identity

#### Scenario: Another device deletes a changed record

- **WHEN** a device synchronises local changes after another device deleted the remote record
- **THEN** the local version remains available
- **AND** the application states the conflict

#### Scenario: A Commander overwrites a remote deletion

- **WHEN** a Commander chooses overwrite for a remote deletion conflict
- **THEN** the remote record is restored under its original identity at a newer revision
- **AND** the deletion marker is superseded

#### Scenario: A Commander keeps both after a remote deletion

- **WHEN** a Commander chooses keep both for a remote deletion conflict
- **THEN** the deletion marker remains for the old identity
- **AND** the local version synchronises under a fresh identity

#### Scenario: A Commander cancels a remote deletion conflict

- **WHEN** a Commander chooses cancel for a remote deletion conflict
- **THEN** the deletion marker remains and the local version becomes local-only
- **AND** its pending remote operation is cleared

### Requirement: Network failure does not stop local work

A failed or unavailable synchronisation request MUST leave local records and active work usable.
The application MUST state that synchronisation is pending or failed and MUST retry after a later
eligible action or explicit Commander request. It MUST NOT claim that a device is current until the
service confirms it.

Source: 020/FR-011.

#### Scenario: A save occurs without a network

- **WHEN** a signed-in Commander saves while the service cannot be reached
- **THEN** the local save succeeds when browser storage is available
- **AND** the application states that synchronisation is pending

### Requirement: Remote records preserve the versioned local model

A live remote ship record MUST contain only its UUID, `ship` discriminator, named or working kind,
creation time, browser modification time, supported record format and version, and build. The build
MUST contain only its format, version, hull symbol, ship name, ship ident and module entries. A
module entry MUST contain only its game slot key, module symbol, enabled state, priority, package
pre-engineering identity and ordinary engineering identity. A pre-engineering identity MUST contain
only module symbol, blueprint `fdname`, grade, acquisition identity and experimental-effect `fdname`
or null. Ordinary engineering MUST contain only blueprint `fdname` or null, grade, completed quality
and experimental-effect `fdname` or null. The build's ship name MUST be the saved-record name when it
is present. An accepted ident or hull fallback MUST be derived for display when that name is absent.
The remote record MUST NOT store a second name, hull listing copy or validation copy.

A live remote equipment record MUST contain only its UUID, `equipment` discriminator, named or
working kind, name or null, creation time, browser modification time, supported record format and
version, and loadout. The loadout MUST contain only its format, version, suit family, suit grade,
ordered suit modification slots and ordered weapon mounts. A fitted weapon MUST contain only its
symbol, grade and ordered modification slots. A modification slot MUST contain only a package
modification symbol or null. A weapon mount MUST contain only a fitted weapon or null. The remote
record MUST NOT store a second suit-family copy.

A tombstone MUST contain only the Customer ID relation, record UUID and server revision. Creating a
tombstone MUST remove the live payload and all other live-record and expiry fields. A live remote
record MUST NOT contain a note, source-named relation, local revision, device claim, calculated
value, catalogue fact, price or validation snapshot. Server logs MUST NOT contain a Customer ID,
record payload, record name or record UUID.

The browser MUST reconstruct a supported record before upload. Before accepting it, the service
MUST use a bounded Node command with the same strict record parsers, reconstruction functions and
pinned Almanac packages as the browser. It MUST refuse an invalid hull-slot, engineering, suit,
mount, grade or modification combination atomically. A server version MUST store only record formats
it supports. A newer server record MAY remain remote and unopened for an older browser. The
application MUST state why it cannot open or upload a record. A local record with an unknown hull
MUST remain stored but unopened under `ship-builder/build-lifecycle`. Unknown module identities MUST
remain outside the supported persistence contract.

One record-validation command MUST receive at most the bounded synchronisation request, MUST stop
after 30 seconds and MUST return at most 64 KiB. A timeout, oversized output, crash or non-zero exit
MUST refuse the complete batch before a database write.

Source: 020/FR-012.

#### Scenario: Another device uses an older application version

- **WHEN** that device retrieves a remote record with a newer unsupported format
- **THEN** the record remains remote and unopened
- **AND** the application states that its version cannot open the record

#### Scenario: A local record contains an unknown hull

- **WHEN** a local record names a hull the pinned package does not publish
- **THEN** the record remains local, stored and unopened
- **AND** it is not uploaded

#### Scenario: A remote write contains an unknown module identity

- **WHEN** a remote write names a module the pinned package does not publish
- **THEN** the service refuses the write
- **AND** it retains no unresolved remote record

#### Scenario: A remote write combines valid identities incorrectly

- **WHEN** a direct API client sends known identities in an invalid slot, mount or engineering
  combination
- **THEN** package-backed server reconstruction refuses the complete write
- **AND** no other device can retrieve that invalid record

#### Scenario: Record validation exceeds a process bound

- **WHEN** record validation exceeds 30 seconds or 64 KiB of output
- **THEN** the service refuses the complete batch before a database write
- **AND** every local change remains pending

### Requirement: Local records keep their account binding

A local record MUST be unbound, bound to one Frontier Customer ID or marked local-only. First sign-in
MUST bind and upload only unbound records and records already bound to that Customer ID. A record
bound to another Customer ID MUST remain local and MUST NOT appear in or upload to the signed-in
account. Account deletion MUST remove the binding from retained planning records and mark them
local-only. A local-only record MUST require an explicit new save or copy before it can synchronise.

Source: 020/FR-024.

#### Scenario: Another Commander signs in on the same browser

- **WHEN** a browser holds records bound to one Customer ID and a different Customer ID signs in
- **THEN** the first account's records remain local
- **AND** none appears in or uploads to the second account

#### Scenario: An account was deleted in this browser

- **WHEN** a different account later signs in after account deletion
- **THEN** retained planning records are not uploaded automatically
- **AND** an explicit new save or copy can create an eligible record

### Requirement: A remote autosave has a live-page protection deadline

A signed-in live page MUST renew a remote autosave's protection deadline before it expires while the
service is reachable. The service MUST store only that deadline and MUST NOT receive a device claim
identity. It MUST expire the remote autosave only after its seven-day modification period and its
protection deadline have both passed. An offline live page MUST keep its local autosave. If the
remote copy expires while that page cannot renew protection, the next synchronisation MUST preserve
the local work and report a deletion conflict. Server time MUST control the modification period and
protection deadline. The service MUST set server content time when it first accepts a historical
local record and after each accepted content change. It MUST set the first protection deadline and
each renewal to eight days after server receipt. A renewal MUST NOT change server content time. A
browser timestamp MUST NOT control remote expiry.

Source: 020/FR-025.

#### Scenario: A signed-in page remains live and online

- **WHEN** a page holds an unchanged autosave for longer than seven days while the service remains
  reachable
- **THEN** it renews the protection deadline before expiry
- **AND** neither the local nor remote record expires

#### Scenario: A live page remains offline beyond remote expiry

- **WHEN** an offline page still holds an autosave after its remote copy expires
- **THEN** the local autosave and active work remain available
- **AND** the next synchronisation reports a deletion conflict

#### Scenario: A device clock is incorrect

- **WHEN** a device uploads an autosave with a browser time far before or after server time
- **THEN** the service starts its seven-day remote period at server acceptance time
- **AND** later expiry uses only server time and the protection deadline

### Requirement: Synchronisation requests have fixed size bounds

One synchronised record payload MUST NOT exceed 64 KiB of UTF-8 JSON. One synchronisation request
MUST contain at most 100 changes and MUST NOT exceed 1 MiB of UTF-8 JSON. The service MUST refuse an
over-limit request before applying any change. The application MUST keep every local change pending
and state which bound the request exceeded.

The service MUST authenticate, validate and compare every change before it writes. If any change is
invalid, belongs to another account or conflicts, it MUST apply none of the batch and MUST leave the
account cursor unchanged. Its response MUST give an indexed result for every submitted change. If
all changes can apply, one transaction MUST commit them and return the resulting account cursor.
Each changed live record or tombstone MUST receive the next account revision. An identical content
write against its current record and a repeated delete against a tombstone MUST succeed as no-ops
with the current revision. A retry after a committed response was lost MUST therefore create no
further revision. The browser MUST advance its cursor and clear pending operations only after it
commits the complete response to browser storage.

Source: 020/FR-026.

#### Scenario: One record exceeds its bound

- **WHEN** a synchronisation request contains a record payload larger than 64 KiB
- **THEN** the service applies none of the request
- **AND** the application keeps the local change pending and names the 64 KiB bound

#### Scenario: A batch exceeds its count or byte bound

- **WHEN** a synchronisation request contains more than 100 changes or more than 1 MiB of UTF-8 JSON
- **THEN** the service applies none of the request
- **AND** the application keeps all local changes pending and names the exceeded bound

#### Scenario: One change in a mixed batch conflicts

- **WHEN** one request contains changes that could apply and one stale conflicting change
- **THEN** the service applies none of the request and leaves the account cursor unchanged
- **AND** the response identifies the result of every submitted change

#### Scenario: A committed response is lost

- **WHEN** a client retries the same writes and deletes after their first transaction committed
- **THEN** identical writes and existing tombstones return their current revisions as no-ops
- **AND** the retry creates no additional record or account revision
