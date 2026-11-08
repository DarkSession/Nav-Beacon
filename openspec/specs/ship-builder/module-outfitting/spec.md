## Purpose

Commanders inspect every slot the active build carries and fit, replace or remove the modules in
them. The Almanac package supplies the slots, the fittable choices, the labels and the result of
every edit.

## Requirements

### Requirement: Outfitting acts on an active build

Outfitting MUST require an active build and MUST NOT create one.

Source: 002/FR-001.

#### Scenario: No build is active

- **WHEN** no build is active
- **THEN** outfitting presents no slot ledger
- **AND** no build is created

#### Scenario: A build is invalid or incomplete

- **WHEN** the package reports the active build invalid or incomplete
- **THEN** the build stays editable

### Requirement: Package results are the source of every slot and edit result

Slots, module facts, post-engineering attributes, compatibility, removability and edit results MUST
come from `ShipLoadout`. Slot identity MUST be the game slot key, never position.

Presentation identifies a slot by its kind, its size and, for hardpoints, its node number. The exact
game slot key is not required to be visible text. It MUST remain the slot's identity, the value
exchanged with hull anatomy, and available to assistive technology.

Source: 002/FR-002, 002/SC-001.

#### Scenario: A slot is presented

- **WHEN** the ledger draws a slot
- **THEN** the slot reads as its kind, its size and, for a hardpoint, its node number
- **AND** the game slot key is available to assistive technology

#### Scenario: A slot is referred to

- **WHEN** the application names a slot to the package or to hull anatomy
- **THEN** it uses the game slot key and never the slot's position in a list

### Requirement: The ledger draws every mount with two stated exceptions

The ledger MUST draw every mount `ShipLoadout.slots()` returns, in the package's own order, with two
stated exceptions.

- The cargo hatch MUST be drawn after the core internals and before the optional internals.
- The planetary approach mount MUST NOT be drawn at all, and MUST be recognised by the package's
  `planetaryApproachSuite` restriction rather than by the spelling of its slot key.

Both exceptions are presentation and nothing else: the withheld mount stays ordinary build state,
still fitted, still read by every package calculation, still exported and still carried by a build
link. Because the row is the only place the mount was offered, there is no route to choose the plain
suite over the advanced one, no route to empty the mount, and no control for the mount's enabled
state or priority group; a build carries whatever it arrived with.

Source: 002/FR-002a.

#### Scenario: The cargo hatch is placed

- **WHEN** the ledger draws the mounts of a build
- **THEN** the cargo hatch is drawn after the core internals and before the optional internals

#### Scenario: The planetary approach mount is withheld

- **WHEN** a mount carries the package's `planetaryApproachSuite` restriction
- **THEN** the ledger draws no row for it
- **AND** the mount stays fitted, is read by every package calculation, is exported and is carried
  by a build link

#### Scenario: A build link recorded the mount empty

- **WHEN** a build link opens with the planetary approach mount empty
- **THEN** the build keeps it empty and the ledger draws nothing for it

### Requirement: Missing package facts stay unavailable

Missing facts for package-resolved modules MUST remain unavailable rather than becoming zero or an
estimate. Only package-resolved module identities are supported.

Source: 002/FR-003.

#### Scenario: The package publishes no figure for a fact

- **WHEN** a package-resolved module carries no figure for a fact the surface draws
- **THEN** the fact reads as unavailable
- **AND** no zero and no estimate is drawn in its place

#### Scenario: A module identity the package cannot resolve

- **WHEN** a build carries a module identity the package does not resolve
- **THEN** the identity is outside the supported contract and no compatibility behaviour is offered
  for it

### Requirement: Replacement choices are the package's own candidates

Replacement choices MUST contain the stock form and each package pre-engineered variant of every
currently fittable module, with no application-added candidates.

Source: 002/FR-004.

#### Scenario: Choices are offered for a mount

- **WHEN** replacement choices are presented for a mount
- **THEN** the list holds the stock form and each package pre-engineered variant of every module the
  package reports fittable for the current build
- **AND** it holds no candidate the application added

#### Scenario: One module reaches the Commander by several routes

- **WHEN** a module is available through more than one acquisition route
- **THEN** each route stays one package variant

### Requirement: Search and ordering arrange package records only

Search and ordering MAY arrange package records but MUST NOT alter their values or admit an
unfittable module.

Search MUST cover exactly four fields — the displayed package name for the active locale, class,
rating and weapon mount type. Every whitespace-separated search term MUST match at least one of
those four as a case- and accent-insensitive substring, and a choice matches only when every term
does. The no-match and clear-search states MUST be explicit.

Within a family the leading order keys MUST be numeric class descending and then the package's own
price for the article descending. A choice the package publishes no price for MUST follow every
priced choice of the same class rather than sorting as though it were free. Displayed module name,
package rating order ascending, stock before variants and the package's own ordinals settle what is
left.

The price MUST be the package's own catalogue figure for that exact article, read and never
computed, and is the same value the choice's own `COST` cell states. A Mercenary Coin price MUST NOT
be converted into it and MUST NOT be weighed against it, so an article the package prices only in
coin has no credit price and takes the unpriced place.

Source: 002/FR-005, 002/SC-002.

#### Scenario: Several search terms are entered

- **WHEN** a Commander enters two whitespace-separated terms
- **THEN** a choice matches only when each term matches the displayed name, the class, the rating or
  the weapon mount type as a case- and accent-insensitive substring

#### Scenario: No choice matches

- **WHEN** no choice matches the search
- **THEN** an empty result is shown
- **AND** the search can be cleared from the search field itself

#### Scenario: Choices are ordered inside a family

- **WHEN** a family's choices are drawn
- **THEN** they descend by numeric class and then by the package's own price for the article

#### Scenario: The package publishes no credit price for a choice

- **WHEN** a choice has no package credit price, including one priced only in Mercenary Coin
- **THEN** it follows every priced choice of the same class

#### Scenario: The largest candidate list is searched

- **WHEN** the largest package candidate list is searched in Chromium at the mobile viewport under
  4x CPU slowdown
- **THEN** the results update within 100 ms

### Requirement: Acquisition and entitlement labels come from the package

Choice and fitted-module labels MUST reflect package acquisition and entitlement data.
Community-goal and event rewards MUST be identified as unique rewards. Mercenary and tech-broker
variants MUST be identified as not ordinarily available. A choice MAY carry multiple labels.

Source: 002/FR-006.

#### Scenario: A community-goal reward is offered

- **WHEN** the package marks a choice as a community-goal or event reward
- **THEN** the choice is labelled a unique reward

#### Scenario: A restricted variant is fitted

- **WHEN** a Mercenary or tech-broker variant is fitted
- **THEN** its label states that it is not ordinarily available, before and after fitting

### Requirement: A fitted variant is recognised by the package field alone

A fitted variant MUST be recognized only by `FittedModule.preEngineeredVariant`. Variant purchase
grade and current ordinary engineering grade MUST remain distinct.

Source: 002/FR-007.

#### Scenario: Mercenary engineering is cleared

- **WHEN** clearing Mercenary engineering removes the package's ability to identify the purchased
  variant
- **THEN** the application follows the resulting package state

### Requirement: Fitting, replacing and removing use package edit operations

Fitting, replacing and removing MUST use package edit operations and surface their structured
refusal results.

Source: 002/FR-008, 002/SC-004.

#### Scenario: An edit is accepted

- **WHEN** a Commander fits, replaces or removes a module
- **THEN** the build and every Almanac result are updated from the package edit operation

#### Scenario: The package refuses an edit

- **WHEN** a package edit operation returns a refusal
- **THEN** the structured refusal result is surfaced

#### Scenario: A slot cannot be emptied

- **WHEN** the package reports a slot non-removable
- **THEN** the slot states the package reason and offers no removal action

### Requirement: The cargo hatch offers facts and power state only

The cargo hatch MUST expose its facts and editable power state but MUST offer no replacement,
search, engineering or removal, because the package offers none.

Source: 002/FR-009.

#### Scenario: A Commander opens the cargo hatch row

- **WHEN** the cargo hatch is drawn
- **THEN** its facts and its editable power state are available
- **AND** no replacement, search, engineering or removal action is offered

### Requirement: Fixed mounts are populated by package construction

On load, package construction MUST populate every absent or unusable fixed mount with that hull's
package default before any calculation. The returned fixed module is ordinary build state. The
application MUST NOT run a repair pass, MUST NOT retain source-empty provenance and MUST NOT model
an empty or default-unavailable outcome.

Source: 002/FR-010.

#### Scenario: A build arrives with an empty fixed mount

- **WHEN** the workspace becomes active for a build whose fixed mount is absent or unusable
- **THEN** package construction has already fitted that hull's package default before any
  calculation runs
- **AND** the fitted default is ordinary build state with no provenance of its own

### Requirement: A package-defaulted fixed mount leaves no history entry

Package-defaulted fixed mounts MUST NOT create an application edit-history entry.

Source: 002/FR-011.

#### Scenario: A load populates a fixed mount

- **WHEN** package construction populates a fixed mount with its hull default
- **THEN** no edit-history entry is created for it

### Requirement: Replacement choices are grouped into Almanac families

Available replacement choices MUST be presented grouped into module families, which are the only
grouping level in the chooser. Exactly one family MUST be revealed at a time where the chooser draws
its rail beside the variant pane, and any number where it draws the accordion.

A choice's family MUST be the Almanac's own `familyId` for that module, and its name MUST be the
Almanac's localized family name. The application MUST NOT derive, abbreviate, translate or override
either. A variant takes the family of the module it is built on. Every available choice MUST appear
in exactly one family.

Source: 002/FR-020, 002/SC-009.

#### Scenario: A family holds two differently named articles

- **WHEN** the Almanac gives two differently named articles the same `familyId`
- **THEN** both appear in that one family

#### Scenario: The reading language changes

- **WHEN** the Commander changes the reading language
- **THEN** family names change and choices reorder within their families
- **AND** family membership does not change, because it is a package id rather than a name

#### Scenario: A family has no name in the active language

- **WHEN** the Almanac publishes no family name for the active language
- **THEN** the family still groups, counts and reveals normally
- **AND** it is never left blank and never shown as a raw id

### Requirement: The family revealed when choices are presented

When replacement choices are presented for a mount, a reading language, a reveal model or a search
the Commander has changed, the family containing the exact fitted stock or variant choice MUST be
the revealed one.

If no available family contains that exact fitted choice, the family revealed on the mount the
Commander came from MUST be revealed where this mount offers it. Failing that, the rail MUST reveal
the first family in package order and the accordion MUST reveal none. The carry MUST survive exactly
one step, MUST be consulted only where the mount has no fitted family of its own, and MUST NOT be
taken from a chooser revealing more or fewer than one family.

A presentation is the mount, the reading language, the reveal model and the search text. A change to
any of the four is a different presentation and takes the seed above. A rebuild at the same mount,
same language, same reveal model and same search — which is what fitting a module, undoing a fit and
redoing one all produce — MUST keep the reveals the Commander set rather than seeding them again.

Where a composition draws the families as a list of their own, a family the application reveals MUST
be brought into that list's visible box, and a family the Commander reveals themselves MUST NOT be
scrolled to.

Revealing a family is view state only and MUST NOT edit the build or enter edit history.

Source: 002/FR-021, 002/SC-007.

#### Scenario: The fitted choice has an available family

- **WHEN** choices are presented for a mount holding a module whose family is available
- **THEN** that family is the only family revealed

#### Scenario: An empty mount follows a fitted one

- **WHEN** choices are presented for a mount with no fitted family of its own
- **THEN** the family revealed on the mount the Commander came from is revealed where this mount
  offers it

#### Scenario: Neither the mount nor the carry gives a family

- **WHEN** no available family holds the fitted choice and no carried family is offered here
- **THEN** the rail reveals the first family in package order and the accordion reveals none

#### Scenario: The fitted module has no available family

- **WHEN** package restrictions leave the fitted module without an available family
- **THEN** the accordion reveals no unrelated family as a substitute
- **AND** the rail selects the first family in package order

#### Scenario: A fitted unique-reward variant

- **WHEN** the fitted choice is a unique-reward variant
- **THEN** the family of the module it is built on is revealed

#### Scenario: The build changes at the same mount

- **WHEN** a fit, an undo or a redo rebuilds the chooser for the same mount, language, reveal model
  and search
- **THEN** the families the Commander revealed stay as they left them

#### Scenario: The application reveals a family off the visible end of the list

- **WHEN** the application reveals a family that sits outside the visible box of the family list
- **THEN** that family is brought into the visible box

#### Scenario: The Commander reveals a family

- **WHEN** a Commander reveals a family themselves
- **THEN** the list is not scrolled to it
- **AND** the build and the edit history are unchanged

### Requirement: Every family can be revealed and states itself

A Commander MUST be able to reveal any module family. Each family control MUST expose its localized
family name, its available-choice count and its revealed state to sighted and screen-reader users,
and MUST remain operable by touch and pointer on desktop, tablet and mobile.

Source: 002/FR-022, 002/SC-006.

#### Scenario: A family control is read

- **WHEN** a Commander or a screen reader reaches a family control
- **THEN** the control states the localized family name, the available-choice count and whether the
  family is revealed

#### Scenario: The chooser is used on a touch screen

- **WHEN** a Commander reveals a family by touch or by pointer on desktop, tablet or mobile
- **THEN** the control operates and the build is unchanged

### Requirement: A search changes which families are present and revealed

Applying or changing a non-empty replacement search MUST leave families without matches absent, and
MUST leave every family holding at least one match present and counted.

In the accordion, where the search matched no more than a screenful of choices it MUST reveal every
family containing at least one matching choice. Where it matched more it MUST reveal none, each
family still stating how many of the matches it holds, so the Commander narrows or reveals the one
they want rather than being handed hundreds of rows.

The rail MUST reveal the first family holding a match, whatever the match count, because it draws
one family's rows at a time and cannot hand over hundreds.

A Commander MAY then reveal any family. Clearing the search MUST restore the default family reveal.

Source: 002/FR-023, 002/SC-008.

#### Scenario: A search matches within a screenful

- **WHEN** a new or changed non-empty search matches no more than a screenful of choices
- **THEN** the accordion reveals every family holding at least one match

#### Scenario: A search matches more than a screenful

- **WHEN** a new or changed non-empty search matches more than a screenful of choices
- **THEN** the accordion reveals no family
- **AND** each family present states how many of the matches it holds

#### Scenario: The rail is drawn

- **WHEN** a new or changed non-empty search is applied where the chooser draws its rail
- **THEN** the rail reveals the first family holding a match, whatever the match count

#### Scenario: A family holds no match

- **WHEN** a family holds no matching choice
- **THEN** the family is absent
- **AND** no family holding a match is absent

#### Scenario: The search is cleared

- **WHEN** the Commander clears the search
- **THEN** the default family reveal is restored

### Requirement: A route-restricted choice is labelled on its own row

A unique-reward or otherwise route-restricted choice MUST be identified by its existing acquisition
and entitlement labels on its own row, inside its family. The chooser MUST NOT present a separate
standard or unique-reward section, and the removal of those sections MUST NOT remove or weaken any
acquisition or entitlement label.

The chooser MUST draw a choice as the module with its mount, its class and rating, and its price,
and nothing else. The package's damage, mass, power draw and weapon draw MUST NOT be drawn at either
width. This is presentation only: a missing package fact still stays unavailable rather than
becoming zero wherever a fact is drawn.

Source: 002/FR-024.

#### Scenario: A unique reward is offered

- **WHEN** a unique-reward choice is available
- **THEN** it sits in its own family with its acquisition and entitlement labels on its row
- **AND** the chooser presents no separate standard or unique-reward section

#### Scenario: A choice row is drawn

- **WHEN** the chooser draws a choice row
- **THEN** the row carries the module with its mount, its class and rating, and its price
- **AND** it carries no damage, mass, power draw or weapon draw figure

### Requirement: The fitted choice and the picked choice are told apart

Where replacement choices are presented, the choice currently in the mount and the choice the
Commander has picked MUST each be identified, MUST be distinguishable from each other wherever they
are different rows, and MUST each be conveyed in text and in programmatic state as well as visually.

A picked choice is not a fitted choice until the Commander commits it, and the chooser MUST NOT
present the two alike while they differ.

Source: 002/FR-025.

#### Scenario: A pick waits for a commit

- **WHEN** a Commander picks a row other than the fitted one and has not yet committed it
- **THEN** the fitted row and the picked row carry different marks
- **AND** each mark is conveyed in text and in programmatic state as well as visually

#### Scenario: Picking a row is the fit

- **WHEN** the composition commits a pick as it is made
- **THEN** the fitted choice and the picked choice are the same row and carry one mark

### Requirement: The ledger offers the mount kinds in a fixed order

A Commander MAY narrow the ledger to one kind of mount. The kinds offered MUST be hardpoints, utility
mounts, core internals (with armour and the cargo hatch) and optional internals, in that order, for
every build. The order is chosen because it is the order in which the kinds first appear in `ShipLoadout.slots()` for every
hull, counting armour and the cargo hatch as core internals. A choice that shows every kind, where it
is offered, MUST come first.

Source: 002/FR-002a.

#### Scenario: Every kind can be shown at once

- **WHEN** the ledger offers a choice that shows every kind of mount
- **THEN** the choice that shows every kind comes first, followed by hardpoints, utility mounts,
  core internals and optional internals, in that order

#### Scenario: One kind is shown at a time

- **WHEN** the ledger shows only one kind of mount at a time
- **THEN** the choices are hardpoints, utility mounts, core internals and optional internals, in
  that order

#### Scenario: Armour and the cargo hatch

- **WHEN** a Commander narrows the ledger to the core internals
- **THEN** the armour and the cargo hatch are shown with them

### Requirement: The ledger holds the Commander's choice of kind while it is offered

A press on any of the ledger's choices, the choice that shows every kind included, is the
Commander's choice. Before any press, the ledger MUST show the first choice offered. When the
choices offered change, the ledger MUST show the Commander's choice if it is still offered, and
otherwise the first choice offered.

Source: 002/FR-002a.

#### Scenario: No choice made, every kind offered

- **WHEN** the Commander has made no choice and the ledger offers a choice that shows every kind
- **THEN** every kind is shown

#### Scenario: No choice made, one kind at a time

- **WHEN** the Commander has made no choice and the ledger shows one kind at a time
- **THEN** hardpoints are shown

#### Scenario: A chosen kind stays shown

- **WHEN** a Commander has chosen the optional internals
- **AND** the ledger changes between showing one kind at a time and offering every kind at once
- **THEN** the optional internals are still the kind shown

#### Scenario: The choice of every kind is no longer offered

- **WHEN** every kind is shown
- **AND** the ledger changes to showing one kind at a time
- **THEN** hardpoints are shown

#### Scenario: The choice of every kind is offered again

- **WHEN** every kind is shown
- **AND** the ledger changes to showing one kind at a time
- **AND** the Commander makes no choice
- **AND** the ledger offers every kind again
- **THEN** every kind is shown
