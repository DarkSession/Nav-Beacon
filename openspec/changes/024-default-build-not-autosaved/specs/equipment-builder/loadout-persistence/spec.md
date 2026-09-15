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
Such a loadout MUST take no record: none minted, and none taken over. The test MUST be the stored
state alone and MUST NOT depend on where the loadout came from, so a default loadout that arrives
in a link or in a journal import is kept the same way — by choosing the suit again.

A record a loadout already holds MUST be kept and MUST keep being written. Changing a loadout back
to its suit's default MUST NOT remove its record, because a record is removed only by a confirmed
deletion, by the manual save that consumes it, or by expiry.

The cost of taking no record is that a default loadout is recoverable only from the address, which
carries the open loadout after every change. That is the state's whole content: a Commander who
reaches the bench at an address carrying no loadout meets the empty bench, and reaches the same
default again by choosing the suit.

Wherever a record is taken for a loadout, an unnamed record already holding identical stored state
MUST be taken over rather than a second copy of it stored. A record holding a ship build MUST NOT
be taken over for a loadout, because the two hold different content and are never the same state.
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

- **WHEN** a loadout whose stored state is its suit's default arrives in a link or a journal import
- **THEN** no record is stored for it, exactly as for a loadout started at the bench

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
- **AND** the saved list still holds it
