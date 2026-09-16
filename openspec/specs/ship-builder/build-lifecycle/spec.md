## Purpose

A Commander creates a stock build, works in it, and finds it again later. This capability owns build
creation, the active build, the local records that hold builds, their names, notes, expiry and
removal, and the versioned browser persistence format.

## Requirements

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

A build carries no decision while every module it holds is the one the package publishes for that
slot — `getDefaultLoadout(<hull symbol>)` in
`@elite-dangerous-almanac/core/ships/default-loadouts` — with no engineering and no pre-engineered
article on any of them, with every module powered and in the first power group, and with no ship
name and no ident. Such a build MUST take no record: none minted, and none taken over. A
pre-engineered article is named apart from engineering because it is a separate field: a module
carrying one keeps the symbol the hull was supplied with and states no engineering, so a build
holding one meets every other condition here and is still a build a Commander decided something
about.

Power and naming MUST be read by what the state says, not by whether it was written. A journal
states the power of every module and names the ship on every event, writing both blank for a ship
that carries neither, while a build assembled in the application states none of it; a module that is
on and in the first power group carries no decision in either shape, and a blank name and a blank
ident are an absent name and an absent ident. A module switched off, a module in another power
group, and a name or an ident a Commander gave MUST each be read as a decision.

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

#### Scenario: A pre-engineered article on an otherwise default build

- **WHEN** a Commander fits a pre-engineered article to a module on a build that is otherwise the
  package default, leaving the module at the symbol the hull was supplied with and stating no
  engineering
- **THEN** the build is autosaved to an unnamed record of its own, because the article is modelled
  state

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
- **AND** the library still lists that record, where there is one

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

### Requirement: Stored entry facts and listing

Stored entries MUST state their name or that they have none, hull, last-modified time and the
validation state recorded at that time. An unnamed entry MUST also state how long it has before it
expires, and MUST be titled by the build's own ship name, by its ident where there is no ship name,
or by the hull name where there is neither.

Entries MUST be listed as one list in one order, and MUST NOT be divided into a group of named
records and a group of unnamed ones. The last-modified time MUST be stated as how long ago the entry
was edited, in the active locale's own words; the instant itself MUST remain available as text, so
that nothing is lost to a reader who needs it exactly.

The recorded validation, the remaining life and the marker on the record the workspace holds are
stated rather than drawn. The row the workspace holds carries `aria-current` and sits on the amber
edge; a build with issues carries their count on a warm plate beside its title, and a build with none
carries nothing.

The title MUST be read from the build rather than stored on the record, MUST NOT be a name the
application invented, and MUST be distinguished from a name the Commander gave the record. A build
MAY have one local note.

A record a journal import stored is the one exception to the invented name. Where an
imported build carries neither ship name nor ident, its hull name is stored as the
record's name, so the record is kept rather than left to run out on a clock the
Commander never saw. That is the only name the application supplies, it is supplied
on that one route, and nothing else may be added beside it on this precedent.

Source: 001/FR-010, 016/FR-013.

#### Scenario: An unnamed entry is titled from the build

- **WHEN** an unnamed record's build carries a ship name
- **THEN** the entry is titled by that ship name, marked as not a name the Commander gave the record

#### Scenario: An unnamed build carries neither ship name nor ident

- **WHEN** an unnamed record's build has no ship name and no ident
- **THEN** the entry is titled by the hull name

#### Scenario: The ship name changes

- **WHEN** a Commander renames the ship in an unnamed build
- **THEN** the entry's title follows it, because the title is read from the build

#### Scenario: Two unnamed entries share a title

- **WHEN** two unnamed entries carry the same title, because two ships share a name
- **THEN** neither is treated as a duplicate of the other
- **AND** hull, last-modified time and remaining life still tell them apart

#### Scenario: Reading when an entry was edited

- **WHEN** a Commander reads an entry's last-modified time
- **THEN** it is stated as how long ago the entry was edited, in the active locale's own words
- **AND** the instant itself remains available as text

#### Scenario: An imported build carries neither ship name nor ident

- **WHEN** a journal import stores a build that carries no ship name and no ident
- **THEN** the record is named by the hull name the package publishes
- **AND** the record is kept rather than expiring

### Requirement: Local-only notes and storage identities

Notes and storage identities MUST remain local and MUST NOT enter a build link or SLEF export.

Source: 001/FR-011.

#### Scenario: Sharing a build that carries a note

- **WHEN** a Commander shares a build that has a local note as a link or a SLEF export
- **THEN** neither the note nor the storage identity is in the output

### Requirement: Concurrent pages and records

A record deleted by another live page MUST NOT clear that page's active build. The build MUST remain
usable, autosave MUST pause, and resuming MUST be an explicit Commander action, because nobody at
this page decided anything. Resuming MUST write the build, whether or not it has changed since the
record was discarded, and whether or not it is at the package default. Resuming is a Commander
asking for the build to be kept, so it takes a record as a manual save does.

The pause MUST be about the discarded record alone: a page that moves onto
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

A tool whose work is in no record MUST claim none, and the tab's claim for the other tool MUST be
untouched. There is then nothing for a second page to collide with and nothing to fork: two pages
holding the same default work are not two claims on one record, and each takes a record of its own
at its own first change. Work in a named record is not work in no record: autosave has no path to a
named record, so a tool holds no autosave target while its work is in one, and the tab MUST claim
that record for as long as the work matches what it holds. This MUST hold for a record a save
produced and for one a Commander opened from the saved list alike, because both are records a reload
restores the work from. Once the work no longer matches, the tab MUST claim the unnamed record the
next write mints for it instead, and nothing until there is one.

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

#### Scenario: A Commander saves the work under a name

- **WHEN** a Commander saves under a name the work a tool was autosaving into an unnamed record
- **THEN** the tool stops autosaving, because autosave has no path to a named record
- **AND** this tab claims the record the save produced, so a reload restores the work from it

#### Scenario: A Commander opens a record from the saved list

- **WHEN** a Commander opens a named record from the saved list
- **THEN** this tab claims that record, so a reload restores the work from it
- **AND** nothing is announced to other pages, because no page autosaves into it

#### Scenario: A default build takes the place of saved work

- **WHEN** a Commander who has just saved under a name creates a build from the hull catalogue
- **THEN** this tab claims nothing for that tool, because the new build is at its hull's default and
  is in no record
- **AND** a page built in this tab afterwards restores no build from the record that was saved

#### Scenario: This page deletes the record a tool autosaves into

- **WHEN** a Commander deletes the record this page's build or loadout autosaves into
- **THEN** this tab claims nothing for that tool
- **AND** a page built in this tab afterwards restores no build or loadout from it

#### Scenario: A conflicting manual save from another tab

- **WHEN** two pages write manually to one record
- **THEN** the application offers overwrite, keep both and cancel
- **AND** neither version is silently lost

### Requirement: Expiry of unnamed records

An unnamed record MUST expire seven days after it was last modified, and MUST then be removed. The
seven days MUST run from last modification, so a build a Commander keeps working on never expires
under them. Naming a record MUST stop the clock: a named record MUST NOT expire, and is bounded only
by the browser storage quota. A record a live page is autosaving into MUST NOT expire while that page
holds it. There MUST be no limit on how many records may exist inside the seven days.

The sweep MUST NOT be announced after it has run. The remaining time on the entry is the notice,
given while there is still something a Commander can do about it; a message about builds that are
already gone offers nothing to act on and no way back. That notice is stated rather than drawn, so a
Commander who does not use a screen reader meets it by going to the record: an unnamed record can run
out without a drawn warning that it was going to.

Expiry is not a storage bound and MUST NOT be presented as one: at the browser storage quota the
Commander MUST still be able to choose records to discard while the active in-memory build remains
usable.

Source: 001/FR-013.

#### Scenario: An unnamed record is returned to

- **WHEN** a Commander keeps editing an unnamed record
- **THEN** the seven days run from the last modification and the record does not expire

#### Scenario: A record is taken over

- **WHEN** a build takes over an unnamed record holding identical modelled state
- **THEN** the seven days do not restart, because taking a record over is not modifying it
- **AND** the entry states the remaining time

#### Scenario: A tab is left open for longer than seven days

- **WHEN** a page holds a record it is autosaving into for longer than seven days
- **THEN** the record is not swept while that page holds it

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

### Requirement: Versioned browser persistence

Browser persistence MUST use a versioned format and migrate every supported older version without
losing recognized modelled state. During reconstruction, an unknown hull MUST leave the record stored
but unopened. Package reconstruction MUST populate every fixed mount from the hull default whenever
its source entry is absent or unusable, before the build becomes active; the application MUST NOT run
a separate repair or preserve empty-mount provenance. Unknown module identities are outside the
supported persistence contract. Unsupported newer versions MUST remain stored but unopened. Storage
failure MUST disable only persistence.

Source: 001/FR-014, 001/SC-002.

#### Scenario: A record names an unknown hull

- **WHEN** reconstruction meets a record whose hull the installed package does not publish
- **THEN** the record is refused atomically and stays stored but unopened

#### Scenario: A fixed mount is absent or unusable

- **WHEN** a record's entry for a fixed mount is absent or unusable
- **THEN** reconstruction populates that mount from the hull default before the build becomes active
- **AND** no separate repair runs and no empty-mount provenance is kept

#### Scenario: A record carries an unsupported newer version

- **WHEN** a record's format version is newer than any this application supports
- **THEN** the record stays stored but unopened

#### Scenario: Storage is unavailable or full

- **WHEN** browser storage is unavailable or full
- **THEN** only persistence is disabled
- **AND** the build remains usable and the persistence failure is clear

### Requirement: Ship name and ident on the active build

While a build is active, a Commander MUST be able to set and clear its ship name and ident. Both are
optional free text, both are modelled build state carried by the build snapshot, and neither MUST be
inferred, defaulted or derived from the hull. Applying either MUST go through the same package
reconstruction and atomic replacement as any other edit.

A ship's name and the name a Commander gives the saved build record are one value; the application
MUST NOT hold a second copy of it, and a record's local identity remains independent of it. An
unnamed build MUST present an empty name rather than a hull-derived placeholder shown as a value.

Free text, but not unbounded text: the game's own ship naming terminal takes at most 22 characters of
name and a 6-character ID plate, and a build carrying more than either describes a ship nobody can
register. Each field MUST hold a Commander to its bound as they type and as they paste, rather than
accepting the text and refusing it afterwards. Confirming a field MUST commit no more than its bound,
so a longer value that reached the field from a link or a SLEF file is brought inside the limit by
the edit rather than passed through it — and the field MUST open on the bounded value, so what a
Commander confirms is what they were shown. Both bounds sit under the build link codec's own
per-string bound, so a name and an ident that pass here always fit a shared link.

The two figures are held in the application because nothing publishes them. They are the game's
bounds and not this application's, so they belong to the Almanac; the package exposes no record of
the naming terminal's limits for them to be read from. They are a recorded gap rather than a licence:
the numbers live in one named place (`SHIP_NAME_MAX_LENGTH` / `SHIP_IDENT_MAX_LENGTH` in
`src/app/ui/outfitting/ship-identity-fields.ts`), they are the only game figures this application
states, and the condition for removing them is the package publishing the bounds — at which point the
constants go and the fields read them, in the same change. Nothing else may be added beside them on
this precedent.

Source: 002/FR-019.

#### Scenario: Setting a ship name

- **WHEN** a Commander sets the ship name on the active build
- **THEN** the name is applied through the same package reconstruction and atomic replacement as any other edit
- **AND** the saved record's name is that same value rather than a second copy of it

#### Scenario: Typing or pasting past a bound

- **WHEN** a Commander types or pastes more than 22 characters of ship name, or more than 6 characters of ident
- **THEN** the field holds them to the bound as they type

#### Scenario: A longer value arrives from a link or a SLEF file

- **WHEN** a ship name or ident longer than its bound reaches the field from a link or a SLEF file
- **THEN** the field opens on the bounded value
- **AND** confirming the field commits no more than the bound

#### Scenario: A build has no ship name

- **WHEN** a build carries no ship name
- **THEN** the field presents an empty name rather than a hull-derived placeholder shown as a value
