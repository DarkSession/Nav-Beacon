## ADDED Requirements

### Requirement: Versioned equipment link codec

The application-owned equipment codec MUST be versioned, use package identities and preserve all
published versions. The identifier table MUST be generated from the installed package and used only
to encode or decode identities; it MUST NOT supply game facts or calculations.

A published identifier table MUST be immutable. A payload names the table that decodes it, so the
content a table held when a link was written is the content it MUST still hold. Where a package
upgrade changes what the generator produces, the new content MUST be written as the next table
version and every earlier table MUST stay readable. The build MUST refuse to write a published
table, with no flag that permits it, and MUST refuse to run where a published table no longer
matches the hash it declares.

A link the bench opens MUST be decoded against the table version its payload names, for every
version the application carries. Where a payload names a version the application does not carry,
the Commander MUST be told so in the words of a loadout, not of a ship build.

Decoding against the named table resolves the identities the table holds. Whether the installed
package still publishes them is a separate question, answered by "A link that names unresolvable
equipment" (013/FR-021), which this requirement does not alter.

Source: 013/FR-020, 013/SC-005.

#### Scenario: A link written by an older published version

- **WHEN** a Commander opens an equipment link carrying a published payload version below the
  current one, naming equipment the installed package still publishes
- **THEN** the codec decodes it against the table that version names and restores an equivalent
  loadout
- **AND** the weapons and modifications the bench was only holding are restored with it

#### Scenario: A payload names a version the application does not carry

- **WHEN** an equipment payload names a table version this application does not carry
- **THEN** the link is refused rather than guessed
- **AND** the restored loadout on the bench is unchanged and the Commander is told why
- **AND** what the Commander is told names a loadout link, not a build link

#### Scenario: A package upgrade changes what the table holds

- **WHEN** the installed package makes the generator produce content a published table does not hold
- **AND** the table version is raised to the next one
- **THEN** the new content is written as the next table version
- **AND** the published table keeps the content it was published with
- **AND** a new link names the new version while an older link still names, and is decoded by, its own

#### Scenario: A published table's content has moved

- **WHEN** the generator produces content the committed table for the current version does not hold
- **THEN** the build fails and names the version the new content belongs under
- **AND** no table is written

#### Scenario: A published table has been edited

- **WHEN** the content of a published equipment table no longer matches the hash it declares
- **THEN** the build fails and names the table
- **AND** no table is written

#### Scenario: The identifier table is used

- **WHEN** the codec uses its compact identifier table
- **THEN** the table is generated from the installed package
- **AND** it supplies no game fact and no calculation

## MODIFIED Requirements

### Requirement: Exporting the open loadout

Users MUST be able to export the open loadout as a link that restores it, as a
structured payload, and as a readable summary.

A link MUST restore exactly the loadout it was made from, including the weapons
and modifications the bench was only holding, for every loadout the application
can build.

A link the bench publishes into the fragment or offers for export MUST name the
current table version, whatever version the loadout arrived on. Where the current
table cannot represent the loadout, the application MUST NOT publish or offer a
link, and the loadout on the bench MUST be left as it is. What becomes of a
fragment already in the address is stated by "The address carries the loadout on
the bench" (024/FR-003). The Commander MUST
be told what refused it — the mount, named by `getPersonalMountName` in
`@elite-dangerous-almanac/core/i18n/suits`, or the suit where what refused sits on
the suit rather than on a mount — and the reason.

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

#### Scenario: A loadout opened from an older version reaches the bench

- **WHEN** a loadout opened from a link naming an earlier table version reaches
  the bench
- **THEN** the link published into the fragment names the current table version
- **AND** it restores the same suit, grades, weapons and modifications

#### Scenario: The current table cannot represent the open loadout

- **WHEN** the current table holds no identity for something the open loadout
  carries
- **THEN** no link is published into the fragment and none is offered for export
- **AND** the loadout on the bench is left as it is
- **AND** the Commander is told what refused it — the mount, or the suit — and the
  reason

### Requirement: The address carries the loadout on the bench

The loadout MUST be published into the fragment from the moment it reaches the bench, not only
after a change, and each change MUST replace the fragment without adding a history entry. A bench
holding no loadout MUST publish none. The path and the query MUST NOT carry any part of it.

Where the current table cannot represent the loadout, the application MUST NOT publish a link, and
an equipment fragment already in the address MUST be removed, so the address names no loadout the
bench cannot share. A fragment belonging to another tool MUST be left as it is. Removing a fragment
publishes nothing, so it is not a loadout stated into the address.

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

#### Scenario: The codec refuses the loadout on the bench

- **WHEN** the current table cannot represent the loadout on the bench
- **THEN** nothing is published into the fragment
- **AND** an equipment fragment carrying an earlier loadout is removed
- **AND** a fragment belonging to another tool is left as it is

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
carries the open loadout for as long as one is on the bench and the current table can represent it.
A loadout the current table cannot represent is held nowhere, which is why the Commander MUST be told
at once rather than on the next reload. That is the state's whole content: a
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

#### Scenario: A default loadout the current table cannot represent

- **WHEN** the bench holds a default loadout the current table cannot represent
- **THEN** no fragment carries it and it takes no record
- **AND** the Commander is told the link was refused, and why, while the loadout is still on the
  bench
