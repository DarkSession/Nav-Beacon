## Purpose

Keeping an on-foot loadout and handing it on: naming it, saving it in the
Commander's own browser, reopening or deleting it, exporting it as a link, a
payload or a readable summary, and reaching the bench at its own address.

## Requirements

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

### Requirement: Saving under the name of an existing loadout

Saving under the name of an existing loadout MUST ask whether to replace it or
keep both.

A journal import that stores several loadouts MUST NOT ask. Every imported loadout
is kept, alongside anything already saved under the same name, because the
Commander asked for one import rather than for a question about each name in it.

Source: 013/FR-017, 016/FR-016.

#### Scenario: The name is already taken

- **WHEN** a Commander saves the open loadout under the name of a saved loadout
- **THEN** they are asked whether to overwrite it or keep both copies

#### Scenario: An import stores a name already in use

- **WHEN** a journal import stores loadouts under names that are already saved
- **THEN** both copies are kept
- **AND** nothing is asked

### Requirement: Saved loadouts stay in the Commander's browser

Saved loadouts MUST survive closing and reopening the application, and MUST live
only in the Commander's own browser.

Source: 013/FR-018.

#### Scenario: The application is closed and reopened

- **WHEN** a Commander saves several named loadouts and reloads the application
- **THEN** every saved loadout reopens with the suit, grade, weapons, grades and
  modifications it was saved with

#### Scenario: The browser store is unavailable or full

- **WHEN** every browser store is unavailable or full and a Commander saves
- **THEN** saving fails with a statement of what happened
- **AND** the open loadout is not lost

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

### Requirement: A loadout in the address outranks the restored one

Where the address carries a loadout and the page also holds a record of its own, the loadout
in the address MUST open. A link that is refused MUST leave the restored loadout on the bench
and MUST say why the link was refused.

Source: 017/FR-009.

#### Scenario: A shared loadout is opened in a tab that has a record

- **WHEN** a Commander opens an address carrying a loadout in a tab that holds a record of its own
- **THEN** the loadout in the address opens on the bench

#### Scenario: The link in the address is refused

- **WHEN** the loadout in the address cannot be read
- **THEN** the restored loadout stays on the bench
- **AND** the Commander is told why the link was refused

### Requirement: Saving and sharing carry held content

A saved loadout and a shared link MUST carry the content the bench is holding —
a weapon in a mount the current suit does not carry, and a modification a locked
slot holds — as well as what is in effect, so that neither saving nor sharing
discards a choice the Commander has made.

Source: 013/FR-018a.

#### Scenario: A link restores held content

- **WHEN** a Commander copies the link of a loadout that holds content and opens
  it
- **THEN** the same suit, grades, weapons and modifications are restored,
  including any the bench was only holding

### Requirement: A stored loadout this version cannot rebuild

A stored loadout this version cannot rebuild MUST be reported as unopenable and
MUST be left in store exactly as it was.

Source: 013/FR-019.

#### Scenario: An unrebuildable stored loadout is opened

- **WHEN** a Commander opens a stored loadout this version cannot rebuild
- **THEN** the Commander is told it could not be opened
- **AND** the stored loadout is left intact

### Requirement: Exporting the open loadout

Users MUST be able to export the open loadout as a link that restores it, as a
structured payload, and as a readable summary.

A link MUST restore exactly the loadout it was made from, including the weapons
and modifications the bench was only holding, for every loadout the application
can build.

Source: 013/FR-020, 013/SC-005.

#### Scenario: A link is exported and opened

- **WHEN** a Commander copies the link of an open loadout and opens it
- **THEN** the same suit, grades, weapons and modifications are restored
- **AND** the weapons and modifications the bench was only holding are restored
  with them

#### Scenario: A readable summary is exported

- **WHEN** a Commander exports a readable summary
- **THEN** it names the suit, its grade, each weapon with its grade, and each
  fitted modification

### Requirement: A link that names unresolvable equipment

A link that names equipment the application cannot resolve MUST say what could
not be resolved and MUST NOT replace the open loadout with a partial one.

A loadout comes in two ways: a link the bench itself made, and a journal event the
game wrote. The structured payload still leaves the bench for other tools, and the
bench offers no route for reading one back.

Source: 013/FR-021.

#### Scenario: A link names equipment this version does not recognise

- **WHEN** a Commander opens a link that names equipment this version does not
  recognise
- **THEN** the Commander is told what could not be resolved
- **AND** nothing already open is replaced by a partial loadout

### Requirement: A journal suit loadout comes in

The bench MUST import a journal `SuitLoadout`, `SwitchSuitLoadout` or
`CreateSuitLoadout` event, from a pasted event or from journal files. The event MUST
be read by `parseSuitLoadout` in `@elite-dangerous-almanac/core/equipment/suit-loadout`,
and the application MUST NOT resolve a suit, a weapon, a grade or a modification
itself.

Where a source holds more than one event, the application MUST list them and MUST
let the Commander select one or more, as the ship import does. Each listed loadout
MUST be identified by its loadout name, its suit, its grade, how many weapons it
carries, how many modifications it holds, and when the line was written. The suit's
name MUST come from the package.

Import MUST be available whatever the bench is holding, and MUST leave the bench
untouched until it succeeds.

Source: 016/FR-014.

#### Scenario: An event is pasted

- **WHEN** a Commander pastes a journal `SwitchSuitLoadout` event
- **THEN** the package reads it
- **AND** the suit, its grade, its modifications and the weapon at each mount are restored

#### Scenario: A journal file holds several suit loadouts

- **WHEN** a scanned journal holds four suit loadout events
- **THEN** the four are listed with their name, suit, grade, weapon count, modification
  count and time
- **AND** the Commander selects one or more of them

#### Scenario: An import fails

- **WHEN** the package refuses the event
- **THEN** the bench is left exactly as it was
- **AND** the Commander is told what was refused

### Requirement: What the package could not fit is reported

Where the package reports that it left something out of an imported loadout — a
weapon it does not carry, a mount it does not know, a grade outside the published
range, or a modification it cannot resolve — the application MUST state what was
left out and MUST NOT substitute anything for it.

Source: 016/FR-015.

#### Scenario: An event names a weapon this version does not carry

- **WHEN** an imported event names a weapon the package cannot resolve
- **THEN** the rest of the loadout is imported
- **AND** the application states which entry was left out

#### Scenario: An event names an unknown suit

- **WHEN** an imported event names a suit the package cannot resolve
- **THEN** the event is refused whole
- **AND** the Commander is told the suit was not recognised

### Requirement: One imported loadout opens, several are saved

Where exactly one loadout is selected, it MUST open on the bench.

Where more than one is selected, every selected loadout MUST be saved and none MUST
open, and the bench MUST be left as it was. The application MUST then open the saved
loadouts layer so the Commander chooses what to open, and MUST state how many
loadouts were imported.

An imported loadout MUST be saved under the name the event carries, or under the
suit's own name where the event carries none. Each MUST carry the note that it came
from a journal.

Source: 016/FR-017, 016/SC-004.

#### Scenario: One loadout is selected

- **WHEN** a Commander selects one loadout and loads it
- **THEN** it opens on the bench

#### Scenario: Several loadouts are selected

- **WHEN** a Commander selects three loadouts and loads them
- **THEN** three saved loadouts exist
- **AND** the bench holds what it held before
- **AND** the saved loadouts layer opens, stating that three were imported

#### Scenario: An event carries no loadout name

- **WHEN** an imported event states no loadout name
- **THEN** the saved loadout is named by the suit's own name

### Requirement: The bench has its own address

The bench MUST be reachable at its own address, and that address MUST restore the
bench directly rather than by way of another screen.

Source: 013/FR-027.

#### Scenario: The bench address is opened

- **WHEN** a Commander opens the bench's own address
- **THEN** the bench is restored directly, and not by way of another screen

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
