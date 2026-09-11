## MODIFIED Requirements

### Requirement: Local-only notes and storage identities

Notes MUST remain local and MUST NOT enter a remote record, build link or SLEF export. A saved build
or autosave MAY carry an application record identity to the same-origin service for cross-device
synchronisation. That identity MUST NOT enter a build link or SLEF export. Device claim identities
MUST remain local.

Source: 001/FR-011, 020/FR-019.

#### Scenario: Sharing a build that carries a note

- **WHEN** a Commander shares a build that has a local note as a link or a SLEF export
- **THEN** neither the note nor the storage identity is in the output

#### Scenario: A signed-in Commander synchronises a build

- **WHEN** a signed-in Commander synchronises a saved build or autosave
- **THEN** its application record identity can enter the remote record
- **AND** its note and device claim identity remain local

### Requirement: Concurrent pages and records

A record deleted by another live page or synchronised device MUST NOT clear this page's active
build. The build MUST remain usable, autosave MUST pause, and resuming MUST be an explicit Commander
action. Resuming MUST write the build, whether or not it changed since the record was discarded. For
a remote tombstone, resuming MUST restore the record under its old identity at a newer revision. The
pause MUST be about the discarded record alone. A page that moves onto another record MUST autosave
into it unasked and MUST NOT keep stating a discard that is not about the build it now holds.

Two live pages MUST NOT autosave to one record. Each page's autosave target is an unnamed record it
minted or took over for itself, one for each tool it carries. A page that finds another live page
claiming one of those identities MUST fork that one under a fresh identity before either page next
writes, and MUST leave its other tool's record where it is. A page that forks MUST write its work
into the fresh record, whether or not it changed since the record it left. Two pages MAY hold the
same named record open because neither autosaves into it. Concurrent manual writes to one record
MUST offer overwrite, keep both and cancel.

A record deleted on this page MUST leave this tab claiming nothing for the tool that was autosaving
into it. A page built in this tab afterwards MUST NOT restore from that deleted record.

Source: 001/FR-012, 017/FR-010, 020/FR-010.

#### Scenario: Another page deletes this page's record

- **WHEN** another live page or synchronised device deletes the record this page is autosaving into
- **THEN** this page keeps its build usable and pauses autosave
- **AND** the Commander resumes autosave by an explicit action

#### Scenario: Resuming a build that has not changed

- **WHEN** a Commander resumes autosave after another page or device deleted the record, without
  changing the build
- **THEN** the build is written to a record again
- **AND** a remote tombstone is superseded under the old identity

#### Scenario: Another build is opened while autosave is paused

- **WHEN** a Commander opens another build while autosave is paused on a discarded record
- **THEN** the build that opens is autosaved without being asked for
- **AND** the workspace states nothing about the record that was discarded

#### Scenario: Two pages claim one autosave identity

- **WHEN** a page finds another live page claiming its autosave record identity
- **THEN** it forks under a fresh identity before either page next writes
- **AND** its work is written into that identity, whether or not it changed

#### Scenario: A page carries a build and a loadout

- **WHEN** a page autosaves a build and a loadout at the same time
- **THEN** each is written to an unnamed record of its own
- **AND** a fork of one leaves the other where it is

#### Scenario: This page deletes the record a tool autosaves into

- **WHEN** a Commander deletes the record this page's build or loadout autosaves into
- **THEN** this tab claims nothing for that tool
- **AND** a page built in this tab afterwards restores no build or loadout from it

#### Scenario: A conflicting manual save from another tab

- **WHEN** two pages or devices write manually to one record
- **THEN** the application offers overwrite, keep both and cancel
- **AND** neither version is silently lost

### Requirement: Expiry of unnamed records

An unnamed record MUST expire seven days after it was last modified, and MUST then be removed. The
seven days MUST run from last modification, so a build a Commander keeps working on never expires
under them. Naming a record MUST stop the clock: a named record MUST NOT expire, and is bounded only
by the browser storage quota. A local record a live page is autosaving into MUST NOT expire while
that page holds it. There MUST be no limit on how many records may exist inside the seven days.

For a signed-in Commander, a live online page MUST renew its remote autosave protection under
`platform/cross-device-records`. The service MUST expire the remote copy only after the seven-day
modification period and that protection deadline both pass. An offline page MUST retain its local
record even if the remote copy expires. Its next synchronisation MUST handle that expiry as a remote
deletion conflict and MUST NOT discard the active build.

The sweep MUST NOT be announced after it has run. The remaining time on the entry is the notice,
given while there is still something a Commander can do about it; a message about builds that are
already gone offers nothing to act on and no way back. That notice is stated rather than drawn, so a
Commander who does not use a screen reader meets it by going to the record: an unnamed record can run
out without a drawn warning that it was going to.

Expiry is not a storage bound and MUST NOT be presented as one: at the browser storage quota the
Commander MUST still be able to choose records to discard while the active in-memory build remains
usable.

Source: 001/FR-013, 020/FR-025.

#### Scenario: An unnamed record is returned to

- **WHEN** a Commander keeps editing an unnamed record
- **THEN** the seven days run from the last modification and the record does not expire

#### Scenario: A record is taken over

- **WHEN** a build takes over an unnamed record holding identical modelled state
- **THEN** the seven days do not restart, because taking a record over is not modifying it
- **AND** the entry states the remaining time

#### Scenario: A tab is left open for longer than seven days

- **WHEN** a page holds a record it is autosaving into for longer than seven days
- **THEN** its local record is not swept while that page holds it
- **AND** its remote copy remains protected while the page can reach the service

#### Scenario: A live tab remains offline beyond remote expiry

- **WHEN** a live page cannot renew protection before its remote copy expires
- **THEN** its local record and active build remain available
- **AND** the next synchronisation reports a remote deletion conflict

#### Scenario: Unsaved edits to a named build

- **WHEN** unsaved edits to a named build sit in their unnamed record for seven days
- **THEN** the unnamed record expires on the same clock as any other
- **AND** the named record it was forked from does not expire at all

#### Scenario: Naming a record before it expires

- **WHEN** a Commander names a record at any point before it runs out
- **THEN** the record is kept indefinitely
- **AND** there is no count at which naming becomes necessary

#### Scenario: Expired records are swept

- **WHEN** the sweep removes expired records
- **THEN** the application says nothing about them afterwards

#### Scenario: The browser storage quota is reached

- **WHEN** browser storage is full
- **THEN** the Commander can still choose records to discard
- **AND** the active in-memory build remains usable
