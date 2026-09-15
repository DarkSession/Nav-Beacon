## MODIFIED Requirements

### Requirement: Build creation from the package default loadout

Build creation MUST be explicit and MUST use the package default loadout,
`ShipLoadout.default(<hull symbol>)` in `@elite-dangerous-almanac/core/ships/ship-loadout`. If no
default is available, creation MUST be unavailable; the application MUST NOT invent one.

Source: 001/FR-007, 024/FR-001.

#### Scenario: Creating a build for a hull

- **WHEN** a Commander creates a build for a selected hull
- **THEN** the build carries the Almanac default loadout for that hull

#### Scenario: The package publishes no default loadout

- **WHEN** a hull has no package default loadout
- **THEN** creation is unavailable for that hull
- **AND** the application does not invent a loadout

#### Scenario: Creating a build while another build is open

- **WHEN** a Commander creates a build while another build is open
- **THEN** the application does not ask about the build already open
- **AND** the earlier build stays in the record it was autosaved to, where it holds one

### Requirement: Autosave of the active build

The active build MUST be recoverable from a stored record at all times that it carries a decision a
Commander made, without being asked for and without a Commander action, and MUST be restored from
that record after reload. A build that has no record yet MUST be autosaved to an unnamed record of
its own from the moment it carries such a decision. A build opened from an existing record MUST be
autosaved to an unnamed record of its own from its first modelled edit. Wherever a record is taken
for a build — at either of those two moments — an unnamed record already holding identical modelled
state MUST be taken over rather than a second copy of it stored. Autosave MUST NEVER write to a named
record. Creating, opening or loading another build MUST NOT overwrite or discard the record of the
build before it. Records MUST use local identities independent of their display names.

A build carries no decision while its modelled state is the package default loadout for its hull —
`ShipLoadout.default(<hull symbol>)` in `@elite-dangerous-almanac/core/ships/ship-loadout` — with no
ship name and no ident. Such a build MUST take no record: none minted, and none taken over.

The test MUST be the modelled state alone and MUST NOT depend on where the build came from. A default
build reaches the workspace by creation from the hull catalogue, by a build link, by a SLEF paste and
by a journal event, and each is recovered the same way: by selecting the hull again. The rule holds
over the build that becomes active. A record a Commander asked for by name is a deliberate save and
is untouched by it, so a batch of journal events still stores one named record for every event
selected.

The unnamed record a build already holds MUST be kept and MUST keep being written. Editing a build
back to the package default MUST NOT remove its record, because a record is removed only by a
confirmed deletion, by the manual save that consumes it, or by the expiry this capability defines.

The cost of taking no record is that a default build is recoverable only from the address, which
carries the open build's link for as long as a build is active. That is the state's whole content: a
Commander who reaches the workspace at an address carrying no build link meets the no-build state,
and reaches the same default again by selecting the hull.

Autosave stops at the named record deliberately. A Commander who names a build has said which version
of it they want kept, and letting the next edit flow into that record would take the decision back
off them. So editing a named build forks an unnamed record and every write goes there, and the named
record moves only when the Commander saves. The cost is that ordinary browsing and ordinary editing
leave records behind, which the seven-day expiry and naming carry.

Source: 001/FR-008, 024/FR-001.

#### Scenario: Reloading the tab

- **WHEN** a Commander reloads the tab on a build that holds a record
- **THEN** the build the tab was working on is restored from that record

#### Scenario: A build at the package default

- **WHEN** a Commander creates a build and changes nothing in it
- **THEN** no record is stored for it
- **AND** the library lists no entry for it

#### Scenario: The first modelled edit of a default build

- **WHEN** a Commander makes the first modelled edit to a build that was at the package default
- **THEN** the build is autosaved to an unnamed record of its own

#### Scenario: A default build arrives by another route

- **WHEN** a build whose modelled state is the package default for its hull becomes active from a
  build link, a SLEF paste or a single journal event
- **THEN** no record is stored for it, exactly as for a build created from the hull catalogue

#### Scenario: A batch of journal events holds a default build

- **WHEN** a Commander selects several journal events, one of which holds a build at the package
  default for its hull
- **THEN** a named record is stored for every event selected, that one included

#### Scenario: A ship name on an otherwise default build

- **WHEN** a Commander sets a ship name or an ident on a build that is otherwise the package default
- **THEN** the build is autosaved to an unnamed record of its own, because the name is modelled state

#### Scenario: Reloading a tab holding a default build

- **WHEN** a Commander reloads the tab on a build at the package default, at the address that carries
  its build link
- **THEN** the build is restored from the address

#### Scenario: Reaching the workspace at an address carrying no build

- **WHEN** a Commander opens the workspace at an address carrying no build link, having stored no
  record for the default build they had open
- **THEN** the no-build state explains how to select a hull, open a save or paste a link

#### Scenario: A build is edited back to the package default

- **WHEN** a Commander edits a build that holds a record until its modelled state is the package
  default again
- **THEN** the record is kept and is written with that state

#### Scenario: Creating the same stock hull twice

- **WHEN** a Commander creates the same stock hull a second time
- **THEN** no record is stored for either
- **AND** the second creation replaces the first on screen without being asked about

#### Scenario: The same edited build arrives twice

- **WHEN** a Commander opens the same link to an edited build twice
- **THEN** the build takes over the unnamed record already holding that modelled state
- **AND** one record exists rather than two

#### Scenario: Two saved builds edited into the same state

- **WHEN** a Commander edits two saved builds into the same first change
- **THEN** the second edit takes over the unnamed record already holding that state

#### Scenario: Two existing records become alike

- **WHEN** two records that already exist come to hold the same modelled state through later edits
- **THEN** they are never merged

#### Scenario: Editing a build opened from a named record

- **WHEN** a Commander edits a build opened from a named record
- **THEN** the named record is unchanged
- **AND** the edits are autosaved to an unnamed record of their own, listed as such

#### Scenario: Opening a named build and not editing it

- **WHEN** a Commander opens a named build and makes no edit
- **THEN** nothing is written

#### Scenario: Replacing the build in the workspace

- **WHEN** a Commander replaces the build in the workspace
- **THEN** the earlier build remains as the record it was autosaved to, where it holds one
- **AND** the library still lists it

### Requirement: Naming, saving and removing a record

Duplicate names MUST be allowed after warning. Removing a record MUST require a confirmed deletion,
the manual save that consumes it, or the expiry this capability defines, and nothing else may remove
one. Deleting the record this page is autosaving into MUST clear the active build to the no-build
state rather than leave it on screen with nowhere to write: the Commander asked for that build to go,
and the confirmation named it. A manual save MUST consume the unnamed record it saved from and MUST
leave no copy of it behind: naming an unnamed record MUST name that same local identity, and writing
the build into an existing record MUST delete the unnamed record afterwards. Saving a copy under
another name MUST create a further record and leave the original where it is. Replacing the active
build MUST NOT be confirmed: a build that carries a decision is in the record autosave keeps it in
where the store can hold it, and a build at the package default is reached again by selecting the
hull. A store failure leaves the earlier build in no record, and replacing MUST still not be
confirmed: replacing gives the Commander the build they asked for, and what the store did is already
stated on the screen.

A save from a build that holds no record has no unnamed record to consume and MUST write a named
record of its own. A Commander who names a build has asked for it to be kept, whatever its modelled
state, so a build at the package default MUST be saved like any other.

Naming, renaming and saving a copy MUST be offered on the build that is open, and MUST NOT be offered
as actions on a row of the library. The library MUST commit exactly two: open the record that was
chosen, and delete it. A record is renamed by opening it and saving it under another name over the
save it came from, and copied by opening it and saving it as a new build.

A journal import is the one route that stores a named record with no build open. A
Commander who selects several loadout events is not shown any of them, so there is
no open build to name them from, and each stored record MUST take its name from the
build it holds: its ship name, its ident where it carries no ship name, or its hull
name where it carries neither. Names stored this way MUST NOT be made unique, and
the Commander MUST NOT be asked about a name two of them share, because a batch is
one action and a question for every clash in it would be a queue of questions
nobody asked for.

A save that writes nothing MUST say so, and MUST leave what the Commander typed on screen for them to
try again with. A build looks the same whether its save landed or not, so a layer that closes over a
full store, a lock it could not take or a record removed in another tab is the one way an edit is
lost without anyone being told. The same holds for an answer to a save conflict.

Source: 001/FR-009, 016/FR-012, 024/FR-001.

#### Scenario: Naming an unnamed record

- **WHEN** a Commander saves an unnamed build under a name
- **THEN** the same local identity takes the name
- **AND** no copy of the unnamed record is left behind

#### Scenario: Naming a build that holds no record

- **WHEN** a Commander saves a build at the package default under a name
- **THEN** a named record is written for it
- **AND** the library lists it

#### Scenario: Saving over an existing record

- **WHEN** a Commander saves the open build into an existing record
- **THEN** the unnamed record the build was autosaved to is deleted afterwards

#### Scenario: Saving a copy under another name

- **WHEN** a Commander saves the open build as a new build under another name
- **THEN** a further record is created
- **AND** the record it was opened from stays where it is

#### Scenario: A name already in use

- **WHEN** a Commander saves under a name another record already carries
- **THEN** the application warns
- **AND** the duplicate name is allowed

#### Scenario: Deleting the record the workspace is autosaving into

- **WHEN** a Commander confirms deletion of the record this page is autosaving into
- **THEN** the active build clears to the no-build state
- **AND** the no-build state explains how to select a hull, open a save or paste a link, as it does before a Commander has built anything

#### Scenario: A save writes nothing

- **WHEN** a save or an answer to a save conflict fails to write
- **THEN** the application says the save wrote nothing
- **AND** what the Commander typed stays on screen to try again with

#### Scenario: A build is replaced while the store holds nothing

- **WHEN** a Commander opens another build while a store failure leaves the build on screen in no
  record
- **THEN** the replacement is not confirmed
- **AND** the screen still states what the store did

#### Scenario: A batch of imported builds is stored

- **WHEN** a Commander imports several loadout events from a journal
- **THEN** each record is named by the build's ship name, by its ident where there is no
  ship name, or by its hull name where there is neither
- **AND** nothing is asked about a name two of the records share

### Requirement: Concurrent pages and records

A record deleted by another live page MUST NOT clear that page's active build. The build MUST remain
usable, autosave MUST pause, and resuming MUST be an explicit Commander action, because nobody at
this page decided anything. Resuming MUST write the build, whether or not it has changed since the
record was discarded, and whether or not it is at the package default. Resuming is a Commander asking
for the build to be kept, so it takes a record as a manual save does. The pause MUST be about the discarded record alone: a page that moves onto
another record MUST autosave into it unasked, and MUST NOT keep stating a discard that is not about
the build it now holds.

Two live pages MUST NOT autosave to one record. Each page's autosave target is an unnamed record it
minted or took over for itself, one for each tool it carries, because a page holds a build and a
loadout at the same time and neither may be written into the other's record. A page that finds
another live page claiming one of those identities MUST fork that one under a fresh identity before
either page next writes, and MUST leave its other tool's record where it is. A page that forks MUST
write its work into the fresh record, whether or not it has changed since the record it left, so
that the identity its claim names is one a reload can restore from. Two pages MAY hold the same
named record open, because neither autosaves into it; concurrent manual writes to one record MUST
offer overwrite, keep both and cancel.

A tool that holds no record MUST claim none, and the tab's claim for the other tool MUST be
untouched. There is then nothing for a second page to collide with and nothing to fork: two pages
holding the same default work are not two claims on one record, and each takes a record of its own
at its own first change.

A record deleted on this page MUST leave this tab claiming nothing for the tool that was
autosaving into it. The claim is what a reload reads, so one left behind would have the tool
restore from a record that is gone.

Source: 001/FR-012, 017/FR-010, 024/FR-001, 024/FR-002.

#### Scenario: Another page deletes this page's record

- **WHEN** another live page deletes the record this page is autosaving into
- **THEN** this page keeps its build usable and pauses autosave
- **AND** the Commander resumes autosave by an explicit action

#### Scenario: Resuming a build that has not changed

- **WHEN** a Commander resumes autosave after another page deleted the record, without having
  changed the build
- **THEN** the build is written to a record again

#### Scenario: Another build is opened while autosave is paused

- **WHEN** a Commander opens another build while autosave is paused on a discarded record
- **THEN** the build that opens is autosaved without being asked for
- **AND** the workspace states nothing about the record that was discarded

#### Scenario: Two pages claim one autosave identity

- **WHEN** a page finds another live page claiming its autosave record identity
- **THEN** it forks under a fresh identity before either page next writes
- **AND** its work is written into that identity, whether or not it has changed

#### Scenario: A page carries a build and a loadout

- **WHEN** a page autosaves a build and a loadout at the same time
- **THEN** each is written to an unnamed record of its own
- **AND** a fork of one leaves the other where it is

#### Scenario: A tab holding default work is duplicated

- **WHEN** a tab holding a build at the package default, or a loadout at its suit's default, is
  duplicated
- **THEN** neither page forks a record for that tool, because neither claims one
- **AND** the claim each page holds for its other tool is untouched

#### Scenario: A default build is claimed by neither page until it is edited

- **WHEN** each of two pages holding the same default build makes its own first edit
- **THEN** each takes a record of its own

#### Scenario: This page deletes the record a tool autosaves into

- **WHEN** a Commander deletes the record this page's build or loadout autosaves into
- **THEN** this tab claims nothing for that tool
- **AND** a page built in this tab afterwards restores no build or loadout from it

#### Scenario: A conflicting manual save from another tab

- **WHEN** two pages write manually to one record
- **THEN** the application offers overwrite, keep both and cancel
- **AND** neither version is silently lost
