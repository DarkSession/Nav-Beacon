## MODIFIED Requirements

### Requirement: Naming, saving, reopening and deleting a loadout

Users MUST be able to name the open loadout, save it, reopen a saved loadout and
delete one.

A manual save MUST consume the unnamed record the loadout was autosaved into and MUST leave
no copy of it behind: naming that loadout MUST name the same local identity, and writing it
into a saved record MUST delete the unnamed one afterwards. Saving a copy under another name
MUST create a further record and leave the original where it is. The saved list MUST NOT
hold both a save and the unnamed record it was made from, because the two are one loadout
and a Commander who saved once has one loadout to find again.

A save from a loadout that holds no record has no unnamed record to consume and MUST write a
named record of its own. A Commander who names a loadout has asked for it to be kept, whatever
its stored state, so a loadout at its suit's default MUST be saved like any other.

Source: 013/FR-016, 017/FR-007, 024/FR-002.

#### Scenario: A named loadout is saved

- **WHEN** a Commander saves an edited loadout under a name
- **THEN** it appears in the saved list, identified by that name, its suit and its
  modification count

#### Scenario: A saved loadout is reopened

- **WHEN** a Commander opens a saved loadout
- **THEN** every choice is restored exactly as saved

#### Scenario: An autosaved loadout is named

- **WHEN** a Commander names a loadout the bench has autosaved into an unnamed record
- **THEN** the saved list holds one record for that loadout, under the name
- **AND** no unnamed record of it is left behind

#### Scenario: A loadout that holds no record is named

- **WHEN** a Commander names a loadout that is still at its suit's default
- **THEN** a named record is written for it
- **AND** the saved list holds it

#### Scenario: An autosaved loadout replaces a saved one

- **WHEN** a Commander saves such a loadout over a loadout already in the list
- **THEN** the loadout is written into the record it replaced
- **AND** the unnamed record it was autosaved into is gone

### Requirement: Autosave of the open loadout

The open loadout MUST be recoverable from a stored record at all times that it carries a choice
a Commander made, without being asked for and without a Commander action, and MUST be restored
from that record after a reload. A loadout that has no record yet MUST be autosaved to an unnamed
record of its own from the moment it carries such a choice. A loadout opened from an existing
record MUST be autosaved to an unnamed record of its own from its first change.

A loadout carries no choice while it holds its suit at the lowest grade the package publishes for
that suit — the grades of `getSuitByFamily(<suit family>)` in
`@elite-dangerous-almanac/core/equipment/suits` — with no weapon on any mount and no modification
fitted. That is the loadout the bench starts when a suit is chosen and nothing else is done to it.
Such a loadout MUST take no record: none minted, and none taken over.

A loadout carries no name of its own. The name a Commander gave belongs to the record the loadout
was saved into, so a loadout in no record has no name to lose. This is why the test names none,
where the ship tool's names the ship name and the ident.

The test MUST be the stored state alone and MUST NOT depend on where the loadout came from. A default
loadout reaches the bench by a suit chosen at the gate, by a link and by a journal event, and each is
recovered the same way: by choosing the suit again. The rule holds over the loadout that reaches the
bench. A record a Commander asked for by name is a deliberate save and is untouched by it, so a batch
of journal events still stores one named record for every loadout selected.

The unnamed record a loadout already holds MUST be kept and MUST keep being written. Changing a
loadout back to its suit's default MUST NOT remove its record, because a record is removed only by a
confirmed deletion, by the manual save that consumes it, or by expiry.

The cost of taking no record is that a default loadout is recoverable only from the address, which
carries the open loadout for as long as one is on the bench. That is the state's whole content: a
Commander who reaches the bench at an address carrying no loadout meets the empty bench, and reaches
the same default again by choosing the suit.

Wherever a record is taken for a loadout — at either of those two moments — an unnamed record already
holding identical stored state MUST be taken over rather than a second copy of it stored. A record
holding a ship build MUST NOT be taken over for a loadout, because the two hold different content
and are never the same state.
Autosave MUST NEVER write to a named record: a Commander who names a loadout has said which version
they want kept, so editing a named loadout forks an unnamed record and the named record moves only
when the Commander saves.

Starting an empty bench, opening a saved loadout and reading one from a link MUST NOT
overwrite or discard the record of the loadout before it. An unnamed loadout record MUST be
kept and MUST expire under the same rule as any other unnamed record, and MUST NOT expire
while the page that autosaves into it is live.

Source: 017/FR-007, 017/SC-003, 024/FR-002.

#### Scenario: Reloading the tab

- **WHEN** a Commander reloads the tab with a loadout that holds a record on the bench
- **THEN** the loadout the bench was holding is restored from that record

#### Scenario: A loadout at its suit's default

- **WHEN** a Commander chooses a suit and changes nothing else
- **THEN** no record is stored for the loadout
- **AND** the saved list holds no entry for it

#### Scenario: The first change to a default loadout

- **WHEN** a Commander makes the first change to a loadout that was at its suit's default
- **THEN** the loadout is autosaved to an unnamed record of its own

#### Scenario: A default loadout arrives by another route

- **WHEN** a loadout whose stored state is its suit's default reaches the bench from a link or a
  single journal event
- **THEN** no record is stored for it, exactly as for a loadout started at the bench

#### Scenario: A batch of journal events holds a default loadout

- **WHEN** a Commander selects several journal events, one of which holds a loadout at its suit's
  default
- **THEN** a named record is stored for every loadout selected, that one included

#### Scenario: Reloading a tab holding a default loadout

- **WHEN** a Commander reloads the tab on a loadout at its suit's default, at the address that
  carries its link
- **THEN** the loadout is restored from the address

#### Scenario: A loadout is changed back to its suit's default

- **WHEN** a Commander changes a loadout that holds a record until its stored state is its suit's
  default again
- **THEN** the record is kept and is written with that state

#### Scenario: The same loadout arrives twice

- **WHEN** a Commander opens the same link to a changed loadout twice
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
- **THEN** the loadout before it remains as the record it was autosaved to, where it holds one
- **AND** the saved list still holds that record, where there is one

### Requirement: What the bench says about storing

A store that refuses a write MUST be stated where the Commander is, and MUST NOT make the
loadout unusable: a Commander whose browser stores nothing MUST still be able to assemble,
read, share and export a loadout. A blocked store, a full store and a failed write MUST each
be stated in words rather than by an unchanged control.

A record deleted by another live page MUST NOT clear the bench. The loadout MUST stay usable,
autosave MUST pause, and resuming MUST be an explicit Commander action, because nobody at this
page decided anything. Resuming MUST write the loadout, whether or not it has changed since
the record was discarded, and whether or not it is at its suit's default. Resuming is a Commander
asking for the loadout to be kept, so it takes a record as a manual save does.

The pause MUST be about the discarded record alone. A bench that takes up another record —
by opening a saved loadout, by reading one from an address, or by saving the loadout under a
name — MUST store into that record unasked, and MUST NOT keep stating a discard that is not
about the loadout it now holds.

A record deleted on this page MUST clear the bench, which is the opposite answer to the
opposite event: a Commander who deletes the record the bench autosaves into decided that here,
and writing it back on the next change would undo what they confirmed. The deleted record MUST
NOT be written again. A loadout the address still carries MUST open again from the address, as
any loadout in an address does, into a record of its own where it carries a choice. A loadout
at its suit's default opens from the address into no record, as it does by every other route,
and the deleted record stays deleted either way.

Source: 017/FR-008, 024/FR-002.

#### Scenario: The browser refuses to store anything

- **WHEN** the browser refuses every write while a loadout is on the bench
- **THEN** the bench states that nothing is being stored
- **AND** the loadout can still be changed, shared and exported

#### Scenario: The store is full

- **WHEN** the browser store is full and autosave cannot write
- **THEN** the bench states what happened and offers a way to choose records to discard

#### Scenario: This page deletes the record the bench autosaves into

- **WHEN** a Commander deletes the record this bench autosaves into, from this page
- **THEN** the bench holds no loadout
- **AND** the deleted record is never written again

#### Scenario: The address still carries the loadout whose record was deleted

- **WHEN** a Commander returns to an address carrying the loadout whose record they deleted
- **THEN** the loadout opens from the address, in a record of its own where it carries a choice
- **AND** the record they deleted stays deleted

#### Scenario: Resuming a loadout that has not changed

- **WHEN** a Commander resumes autosave after another page deleted the record, without
  having changed the loadout
- **THEN** the loadout is written to a record again

#### Scenario: Another loadout is opened while saving is paused

- **WHEN** a Commander opens another loadout while autosave is paused on a discarded record
- **THEN** the loadout that opens is stored without being asked for
- **AND** the bench states nothing about the record that was discarded

#### Scenario: Another page deletes this page's record

- **WHEN** another live page deletes the record this bench autosaves into
- **THEN** the loadout stays on the bench and autosave pauses
- **AND** the Commander resumes autosave by an explicit action

## ADDED Requirements

### Requirement: The address carries the loadout on the bench

The loadout MUST be published into the fragment from the moment it reaches the bench, not only
after a change, and each change MUST replace the fragment without adding a history entry. A bench
holding no loadout MUST publish none. The path and the query MUST NOT carry any part of it.

This is what makes a loadout that is in no record recoverable. A loadout still at its suit's default
is stored nowhere, so the fragment is the only thing holding it, and a Commander who reloads the tab
gets the loadout back from there.

Source: 024/FR-003.

#### Scenario: A suit is chosen and nothing else is done

- **WHEN** a Commander chooses a suit at the gate and makes no other choice
- **THEN** that loadout is published into the fragment

#### Scenario: The bench is reloaded on a default loadout

- **WHEN** a Commander reloads the tab while the bench holds a loadout at its suit's default
- **AND** the fragment carries that loadout
- **THEN** the same loadout is on the bench

#### Scenario: The bench is opened at an address carrying no loadout

- **WHEN** a Commander opens the bench at an address whose fragment carries no loadout
- **THEN** the bench opens on the suit gate

#### Scenario: Each change replaces what the fragment carries

- **WHEN** a Commander makes a change on the bench
- **THEN** the fragment carries the changed loadout
- **AND** no history entry is added for the change
