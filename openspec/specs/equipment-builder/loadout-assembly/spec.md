## Purpose

The on-foot outfitting bench where a Commander assembles a loadout: a personal
suit at a grade, the handheld weapons its mounts carry at their own grades, the
tools the suit carries, and the statistics of the assembled Commander.

## Requirements

### Requirement: Personal suit catalogue

The application MUST offer every personal suit the equipment library publishes,
identified by the library's own name and symbol.

Source: 013/FR-001.

#### Scenario: Every published suit is offered

- **WHEN** a Commander opens the bench and reads the suits on offer
- **THEN** every personal suit the equipment library publishes is offered
- **AND** each is identified by the library's own name and symbol

### Requirement: Suit grades

The application MUST offer the grades each suit supports, and MUST NOT offer a
grade the library does not publish for that suit.

Source: 013/FR-002.

#### Scenario: Raising a suit grade restates its figures

- **WHEN** a Commander raises a suit from grade 3 to grade 5
- **THEN** the shield strength, the regeneration and each damage resistance
  restate at grade 5

#### Scenario: A suit that cannot be upgraded offers one grade

- **WHEN** a Commander selects the Flight Suit
- **THEN** no grade above 1 is offered, because the library publishes none

### Requirement: Weapon grades

The application MUST offer the grades the library publishes for each fitted
weapon, set for that weapon alone and unrelated to the suit's grade. Each
weapon's grade MUST govern its own attributes and its own unlocked modification
slots.

Source: 013/FR-002a.

#### Scenario: A weapon grade moves only that weapon

- **WHEN** a Commander raises a grade 3 weapon to grade 5 on a suit at grade 5
- **THEN** that weapon's damage and its unlocked modification slots restate at
  grade 5
- **AND** neither the suit nor any other fitted weapon changes grade

### Requirement: Weapon mounts and what each accepts

The application MUST offer weapon slots according to the selected suit's primary
and secondary slot counts, and MUST offer in each slot only the weapons that slot
accepts.

A mount key is an identity and not text. The mount keys the library publishes —
Frontier's journal `SlotName` values `PrimaryWeapon1`, `PrimaryWeapon2` and
`SecondaryWeapon`, each with a `kind` of `primary` or `secondary` — MUST identify
a mount everywhere the application names one: in the loadout model, in the link
format and in every refusal. The application MUST NOT keep a translation of a
mount name of its own; `getPersonalMountName` names one.

Source: 013/FR-003, 013/SC-001.

#### Scenario: A complete loadout is assembled

- **WHEN** a Commander chooses a suit and its grade, fills every weapon mount
  the suit carries, and fits a modification in every unlocked slot
- **THEN** the loadout is complete in under three minutes

#### Scenario: A selected suit offers the mounts it carries

- **WHEN** a Commander selects a suit
- **THEN** the suit's weapon slots are offered according to that suit's primary
  and secondary counts

#### Scenario: A slot offers only the weapons it accepts

- **WHEN** a Commander fills a secondary slot that accepts secondary weapons only
- **THEN** the choices offered are those the slot accepts, and not the whole
  catalogue

### Requirement: Handheld weapon catalogue

The application MUST offer every handheld weapon the library publishes, with its
make, class, damage type and fire mode.

Source: 013/FR-004.

#### Scenario: Every published weapon is offered

- **WHEN** a Commander reads the weapons on offer for a slot
- **THEN** every handheld weapon the library publishes for that slot is offered
  with its make, class, damage type and fire mode

### Requirement: Attributes of the selected item

The application MUST state, for the selected item, the attributes the library
holds for it at the selected grade:

- for a suit, its shield strength, its regeneration and each damage resistance;
- for a weapon, its damage, rate of fire, headshot multiplier, magazine, reserve
  and range, and its damage per shot, headshot damage, damage per second and
  sustained damage per second.

A figure the library does not publish MUST NOT be derived here. The derived
combat figures are stated because the library computes them, not because this
application can multiply.

Source: 013/FR-005.

#### Scenario: A selected weapon states its attributes

- **WHEN** a Commander selects a fitted weapon
- **THEN** its class, make, damage type, fire mode, rate of fire, magazine,
  reserve, range and per-grade damage are stated

### Requirement: Suit tools

The application MUST name the suit tools the library records for the selected
suit, and MUST state how many there are. Tools are fitted to every suit and
cannot be swapped, so they are named and never offered as a choice, never
selectable, and carry no grade and no modification slot.

Source: 013/FR-005a.

#### Scenario: Tools are named and counted, and none can be changed

- **WHEN** a Commander reads the tools of a selected suit
- **THEN** the tools the library records for that suit are named and counted
- **AND** none of them can be selected, changed, removed or swapped

### Requirement: Statistics of the assembled Commander

The application MUST state the assembled Commander's shield strength,
regeneration, damage resistances and firepower, and MUST restate them whenever a
choice changes them.

The bench draws two resistance groups, `ARMOUR` over `SHIELDS`, and each MUST
read the set the library publishes for it: the armour's four on the suit's grade,
which a grade moves, and the shield's four on the suit, which no grade moves. The
application MUST NOT compute or invent either set.

Firepower is one row per carried mount. Each row states the fitted weapon's
damage per second as the library computes it, and a dash where nothing counts.
The application MUST NOT perform that arithmetic here.

Every figure the bench states MUST match the equipment library for the same
suit, weapon, grade and modifications. Verification MUST be exhaustive over
every combination the library publishes that needs no screen rendered, and MUST
cover a named representative set of combinations on screen.

Source: 013/FR-006, 013/SC-002.

#### Scenario: Every stated figure is checked against the library

- **WHEN** the bench states a figure for a suit, weapon, grade and set of
  modifications
- **THEN** the figure equals the one the equipment library holds for that
  combination

#### Scenario: The stats restate as choices change

- **WHEN** a Commander selects a suit at a grade
- **THEN** the Commander stats state that suit's figures at the selected grade
- **AND** they restate whenever a later choice changes them

#### Scenario: An empty mount states a dash

- **WHEN** a carried mount holds no weapon
- **THEN** its firepower row states a dash rather than a computed figure

### Requirement: Mounts the suit does not carry

A weapon mount the current suit does not carry MUST NOT be drawn — not in the
ledger, and not as a firepower row — and its contents MUST be retained rather
than discarded, returning intact when a suit carrying that mount is worn.

Where such a mount is what the Commander had open, the item column MUST fall back
to the suit rather than stand on a mount nothing points at.

Source: 013/FR-007, 013/SC-007.

#### Scenario: Two suits are compared at the same grade

- **WHEN** a Commander switches between two suits at the same grade to compare
  their protection
- **THEN** the weapons and modifications already chosen are not lost

#### Scenario: A weapon in a mount the new suit lacks is held

- **WHEN** a Commander changes to a suit with fewer primary mounts while weapons
  occupy them
- **THEN** the weapons in mounts the new suit does not carry are held rather than
  discarded
- **AND** they return intact when the Commander changes back

#### Scenario: The open item falls back to the suit

- **WHEN** the mount the Commander had open is one the newly worn suit does not
  carry
- **THEN** the item column falls back to the suit

### Requirement: Undo and redo of outfitting choices

Users MUST be able to undo and redo their outfitting choices.

Source: 013/FR-022.

#### Scenario: An outfitting choice is undone and redone

- **WHEN** a Commander undoes an outfitting choice
- **THEN** the loadout returns to the state before that choice
- **AND** a redo restores the choice

### Requirement: Starting an empty bench

The application MUST offer a way to start an empty bench while the bench is open. Starting
one MUST leave the bench in the state it holds before a suit is chosen, with the suit gate
standing and every region drawn and inert.

Starting an empty bench MUST clear the loadout's name, the saved record the loadout belongs
to, the undo and redo history, the loadout the address carries, and, where the loadout holds
a record, this tab's claim on it. It MUST NOT be confirmed: a loadout that holds a record
stays as that record, so there is nothing to lose and nothing to ask about. The record itself
MUST stay where it is, so a page built in this tab afterwards MUST open on an empty bench and
MUST NOT restore the loadout that was cleared. Starting an empty bench while the bench is
already empty MUST change nothing.

A loadout still at its suit's default and in no record — the state
`equipment-builder/loadout-persistence`, "Autosave of the open loadout" defines — MUST be cleared on
the same terms, without being confirmed and without being kept. It carries no choice a Commander
made, and the same suit at the same grade is reached again by choosing that suit, so there is
nothing to lose here either. The saved list MUST then hold no entry for it. A loadout changed back
to its suit's default holds the record it took, and that record MUST stay listed.

Where the loadout on the bench carries a choice and is in no record — the store refuses
writes, the store is full, a write failed, or autosave is paused because the record was
discarded elsewhere — the bench MUST stay as it is. Nothing keeps the loadout in those states,
so clearing the bench would lose work rather than cost nothing, and what the bench already
states about storing is the reason.

Source: 017/FR-006, 024/FR-002.

#### Scenario: A loadout is on the bench

- **WHEN** a Commander starts an empty bench while a loadout is on it
- **THEN** the bench holds no loadout and the suit gate stands
- **AND** the Commander is asked nothing

#### Scenario: The loadout that was on the bench

- **WHEN** a Commander starts an empty bench while a loadout that carries a choice is on it
- **THEN** the loadout that was on the bench is still listed as its record
- **AND** a named record it was opened from is unchanged

#### Scenario: A loadout at its suit's default is cleared

- **WHEN** a Commander starts an empty bench while the loadout on it is still at its suit's
  default and in no record
- **THEN** the bench holds no loadout and the Commander is asked nothing
- **AND** the saved list holds no entry for the loadout that was cleared

#### Scenario: The store cannot hold the loadout

- **WHEN** a Commander starts an empty bench while a loadout that carries a choice is on it
  and the store refuses writes, a write failed or autosave is paused
- **THEN** the loadout stays on the bench
- **AND** the bench still states what it says about storing

#### Scenario: The address after an empty bench is started

- **WHEN** a Commander starts an empty bench
- **THEN** the address carries no loadout

#### Scenario: The history after an empty bench is started

- **WHEN** a Commander starts an empty bench and then asks to undo
- **THEN** there is nothing to undo, because the choices before it belong to a loadout that
  is no longer on the bench

#### Scenario: The page is built again after an empty bench is started

- **WHEN** a Commander starts an empty bench and a page is built again in the same tab
- **THEN** the bench opens empty rather than restoring the loadout that was cleared
- **AND** the record that loadout was autosaved into, where it held one, is still listed

#### Scenario: The bench is already empty

- **WHEN** a Commander starts an empty bench while the bench holds no loadout
- **THEN** nothing changes and nothing is written

### Requirement: The list an item is chosen from holds its place

An empty weapon mount is a selected item, and the library publishes no grade for one, so it
offers no grade choice (013/FR-002a).

Choosing an item MUST NOT move the list it was chosen from.

Between one selected item and the next, the grade choice MUST NOT be what moves that list.
Where the grade choice stands above the list, it MUST take the same room whether or not the
selected item offers one. Where it stands below the list, it moves nothing above it and holds
no room at all. What an item's own name and subtitle take is that item's own, and a name that
needs two lines takes two.

The same MUST hold at the empty bench, wherever the bench still offers the list of suits
after the choice. Where the choice answers with the loadout it made in place of that list,
there is no list left to hold.

Source: 020/FR-001.

#### Scenario: A weapon is fitted into an empty mount

- **WHEN** a Commander opens an empty weapon mount and chooses a weapon from the list it
  offers
- **THEN** the list they chose from is where it was before the choice
- **AND** the weapon's grade choice is stated

#### Scenario: The first suit is chosen at the empty bench

- **WHEN** a Commander chooses a suit from the list the suit gate offers, and the bench still
  offers that list after the choice
- **THEN** the list is where it was before the choice

#### Scenario: The choice answers with the loadout instead

- **WHEN** a Commander chooses the first suit and the bench answers by stating the loadout in
  place of the list
- **THEN** the loadout is stated, and no list is held

#### Scenario: An empty mount is opened after a fitted item

- **WHEN** a Commander reads a fitted item and then opens an empty weapon mount
- **THEN** the grade choice moves neither list

### Requirement: Space held for an absent grade choice states nothing

Where the bench holds space for a grade choice the selected item does not offer, that space
MUST be hidden from the accessibility tree and MUST NOT be a control.

An item that publishes no grade has no grade to state, and a control that answers nothing is
worse than no control. Holding the space is the whole of what it does.

Source: 020/FR-002.

#### Scenario: A reader reaches an empty weapon mount

- **WHEN** a Commander using a screen reader reads an empty weapon mount
- **THEN** nothing is announced where the grade choice would stand

#### Scenario: The held space is not a control

- **WHEN** a Commander reads the controls an empty weapon mount offers
- **THEN** the space held for the grade choice is not one of them

### Requirement: Responsive and touch use across the equipment bench

This requirement applies to every screen of the equipment bench.

Every screen MUST be fully usable on desktop, tablet and mobile, by touch as well
as pointer, in portrait and landscape, with no horizontal page scrolling.

Every screen MUST pass an automated accessibility check against WCAG 2.0, 2.1 and
2.2 A and AA with no disabled rules, at desktop, tablet and mobile sizes, in both
supported engines, excepting only the success criteria the constitution names:
2.1.1, 2.1.2, 2.1.4, 2.2.1, 2.4.1, 2.4.3, 2.4.7 and 2.4.11.

Source: 013/FR-023, 013/SC-004.

#### Scenario: A bench screen is used on a phone in portrait

- **WHEN** a Commander opens any bench screen on a mobile device in portrait and
  works by touch
- **THEN** the screen is fully usable and the page does not scroll horizontally

#### Scenario: A bench screen is scanned for accessibility violations

- **WHEN** the automated check runs over a bench screen at desktop, tablet and
  mobile sizes in both supported engines, with no rule disabled
- **THEN** it reports no violation of a criterion the constitution does not
  exclude

### Requirement: Localisation across the equipment bench

This requirement applies to every screen of the equipment bench.

Every string the application owns MUST go through the localisation layer, and
every number and quantity MUST be formatted for the active locale.

Source: 013/FR-024.

#### Scenario: The bench is read in another locale

- **WHEN** a Commander reads the bench in a locale other than the default
- **THEN** every string the application owns is stated in that locale
- **AND** every number and quantity is formatted for that locale

### Requirement: Equipment names come from the equipment library

This requirement applies to every screen of the equipment bench.

Equipment names and modification names MUST be asked of the equipment library in
the active locale, and MUST NOT be translated or held here.

Source: 013/FR-025.

#### Scenario: A suit and a modification are named

- **WHEN** the bench states the name of a suit or of a modification
- **THEN** the name is the one the equipment library answers for the active
  locale

### Requirement: Offline use of the equipment bench

This requirement applies to every capability of the equipment bench.

Every capability MUST remain usable offline after first load.

Source: 013/FR-026, 013/SC-006.

#### Scenario: The bench is used with no network connection

- **WHEN** a Commander loses the network connection after first load
- **THEN** every bench capability remains usable
