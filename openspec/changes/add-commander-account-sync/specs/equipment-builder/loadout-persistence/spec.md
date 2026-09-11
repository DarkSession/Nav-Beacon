## MODIFIED Requirements

### Requirement: Saved loadouts stay in the Commander's browser

Saved loadouts MUST survive closing and reopening the application. They MUST remain in the
Commander's browser when the Commander is anonymous. When the Commander is signed in, named saves
and unnamed autosaves MUST also synchronise to that Commander's account under
`platform/cross-device-records`.

Source: 013/FR-018, 020/FR-020.

#### Scenario: The application is closed and reopened

- **WHEN** a Commander saves several named loadouts and reloads the application
- **THEN** every saved loadout reopens with the suit, grade, weapons, grades and
  modifications it was saved with

#### Scenario: The browser store is unavailable or full

- **WHEN** every browser store is unavailable or full and a Commander saves
- **THEN** saving fails with a statement of what happened
- **AND** the open loadout is not lost

#### Scenario: A signed-in Commander uses another device

- **WHEN** a signed-in Commander opens the application on another synchronised device
- **THEN** their named loadouts and unexpired autosaves become available there

### Requirement: Autosave of the open loadout

The open loadout MUST be recoverable from a stored record at all times, without being asked
for and without a Commander action, and MUST be restored after a reload. A loadout that has
no record yet MUST be autosaved to an unnamed record of its own from the moment it is on the
bench. A loadout opened from an existing record MUST be autosaved to an unnamed record of its
own from its first change.

Wherever a record is taken for a loadout — at either of those two moments — an unnamed
record already holding identical stored state MUST be taken over rather than a second copy of
it stored. A record holding a ship build MUST NOT be taken over for a loadout, because the two
hold different content and are never the same state. Autosave MUST NEVER write to a named
record: a Commander who names a loadout has said which version they want kept, so editing a
named loadout forks an unnamed record and the named record moves only when the Commander
saves.

Starting an empty bench, opening a saved loadout and reading one from a link MUST NOT
overwrite or discard the record of the loadout before it. An unnamed loadout record MUST be
kept and MUST expire under the same rule as any other unnamed record. Its local copy MUST NOT
expire while the page that autosaves into it is live. A signed-in online page MUST renew the
remote protection deadline under `platform/cross-device-records`. If that remote copy expires
while the live page is offline, the local copy MUST remain and the next synchronisation MUST
report a remote deletion conflict.

Source: 017/FR-007, 017/SC-003, 020/FR-025.

#### Scenario: Reloading the tab

- **WHEN** a Commander reloads the tab with a loadout on the bench
- **THEN** the loadout the bench was holding is restored

#### Scenario: The same loadout arrives twice

- **WHEN** a Commander opens the same loadout link twice
- **THEN** the bench takes over the unnamed record already holding that stored state
- **AND** one record exists rather than two

#### Scenario: Editing a loadout opened from a named record

- **WHEN** a Commander changes a loadout opened from a named record
- **THEN** the named record is unchanged
- **AND** the change is autosaved to an unnamed record of its own, listed as such

#### Scenario: Opening a named loadout and not changing it

- **WHEN** a Commander opens a named loadout and makes no change
- **THEN** nothing is written

#### Scenario: A build record is never taken over

- **WHEN** the bench takes a record for a loadout
- **THEN** a record holding a ship build is never taken over for it

#### Scenario: Replacing what is on the bench

- **WHEN** a Commander starts an empty bench or opens another loadout
- **THEN** the loadout before it remains as the record it was autosaved to
- **AND** the saved list still holds it

#### Scenario: A signed-in live page keeps an unchanged loadout open

- **WHEN** a signed-in page holds an unchanged loadout longer than seven days and can reach the
  service
- **THEN** its local record stays available
- **AND** its remote protection deadline is renewed before expiry

#### Scenario: A live page remains offline beyond remote expiry

- **WHEN** a live page cannot renew protection before its remote loadout record expires
- **THEN** its local record and open loadout remain available
- **AND** the next synchronisation reports a remote deletion conflict

### Requirement: What the bench says about storing

A store that refuses a write MUST be stated where the Commander is and MUST NOT make the loadout
unusable. A Commander whose browser stores nothing MUST still be able to assemble, read, share and
export a loadout. A blocked store, a full store and a failed write MUST each be stated in words.

A record deleted by another live page or synchronised device MUST NOT clear this page's bench. The
loadout MUST stay usable, autosave MUST pause, and resuming MUST be an explicit Commander action.
Resuming MUST write the loadout, whether or not it changed since the record was discarded. For a
remote tombstone, resuming MUST restore the record under its old identity at a newer revision.

The pause MUST be about the discarded record alone. A bench that takes up another record by opening
a saved loadout, reading one from an address or saving under a name MUST store into that record
unasked. It MUST NOT keep stating a discard that is not about the loadout it now holds.

A record deleted on this page MUST clear the bench. The deleted record MUST NOT be written again. A
loadout the address still carries MUST open again from the address into a record of its own.

Source: 017/FR-008, 020/FR-010.

#### Scenario: The browser refuses to store anything

- **WHEN** the browser refuses every write while a loadout is on the bench
- **THEN** the bench states that nothing is being stored
- **AND** the loadout can still be changed, shared and exported

#### Scenario: The store is full

- **WHEN** the browser store is full and autosave cannot write
- **THEN** the bench states what happened and offers a way to choose records to discard

#### Scenario: This page deletes the record the bench autosaves into

- **WHEN** a Commander deletes the record this bench autosaves into from this page
- **THEN** the bench holds no loadout
- **AND** the deleted record is never written again

#### Scenario: The address still carries the loadout whose record was deleted

- **WHEN** a Commander returns to an address carrying the loadout whose record they deleted
- **THEN** the loadout opens from the address in a record of its own
- **AND** the record they deleted stays deleted

#### Scenario: Resuming a loadout that has not changed

- **WHEN** a Commander resumes autosave after another page or device deleted the record, without
  changing the loadout
- **THEN** the loadout is written to a record again
- **AND** a remote tombstone is superseded under the old identity

#### Scenario: Another loadout is opened while saving is paused

- **WHEN** a Commander opens another loadout while autosave is paused on a discarded record
- **THEN** the loadout that opens is stored without being asked for
- **AND** the bench states nothing about the record that was discarded

#### Scenario: Another page deletes this page's record

- **WHEN** another live page or synchronised device deletes the record this bench autosaves into
- **THEN** the loadout stays on the bench and autosave pauses
- **AND** the Commander resumes autosave by an explicit action
