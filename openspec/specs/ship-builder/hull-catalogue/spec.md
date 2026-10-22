## Purpose

Commanders browse the Almanac hull catalogue, narrow it to the hulls they care about, and read what a
hull is and what it can carry before they build anything. This capability owns the catalogue listing,
hull detail, hull addresses and hull artwork.

## Requirements

### Requirement: Package source of hull data

Hull identities, facts, slots and default loadouts MUST come from `@elite-dangerous-almanac/core`;
hulls MUST use the package `symbol`.

Source: 001/FR-001, 001/SC-001.

#### Scenario: A hull fact is read from the package

- **WHEN** the application states any hull fact, slot layout or default loadout
- **THEN** the value matches the installed Almanac package
- **AND** the hull is identified by its package `symbol`

### Requirement: Catalogue listing, sorting and narrowing

The catalogue MUST show name, manufacturer, size, hardpoint layout and retail price, and MUST support
bidirectional sorting over those facts. It MUST narrow in exactly the two ways the reference toolbar
draws: one text search matching every fact a hull shows, where each word of the search may land on a
different fact, and one exclusive landing-pad size strip led by `ALL`. Missing values MUST remain
distinct from zero and sort ties MUST be stable.

Source: 001/FR-002.

#### Scenario: Searching and filtering the catalogue

- **WHEN** a Commander searches, filters or sorts the catalogue
- **THEN** the catalogue narrows over the displayed catalogue facts
- **AND** the active constraints and the match count are shown

#### Scenario: A search word lands on a different fact

- **WHEN** a Commander types a search of several words
- **THEN** each word may match a different fact of the same hull

#### Scenario: A hull has no value for a sorted fact

- **WHEN** the catalogue sorts over a fact a hull does not publish
- **THEN** the missing value stays distinct from zero
- **AND** hulls that tie keep a stable order

### Requirement: Catalogue state across navigation

Catalogue search, filters, sort and scroll position MUST survive a trip to hull detail and back
during the browser session. They MUST NOT become build or link state.

Source: 001/FR-003.

#### Scenario: Returning from hull detail

- **WHEN** a Commander opens hull detail and returns to the catalogue in the same browser session
- **THEN** the search, filters, sort and scroll position are as they were left
- **AND** none of them appears in the build or in a build link

### Requirement: Hull detail facts

Hull detail MUST show the package name, manufacturer, size, speed and boost, base shield and armour,
hull mass, hardness, crew, mass-lock factor, the hardpoint mix and how many hardpoints there are
altogether, the hull price and the illustration, with units for every measured value that has one.
Hull facts MUST be distinguished from module-dependent build results.

Heat capacity and dissipation, reserve fuel and the rotation rates are out of scope for this
capability: the reference draws none of them on the shipyard. Hardness, crew and mass lock hold their
place on the reference's metric grid.

Source: 001/FR-004.

#### Scenario: Opening hull detail

- **WHEN** a Commander opens hull detail for a hull
- **THEN** the catalogue facts and the illustration are shown, with units where a value has one
- **AND** no build is created or replaced

### Requirement: Hull mount readout

Hull detail MUST state what the hull can carry, beside what it can do: how many utility mounts it
has, the size of each of its seven core-internal mounts named by function, the sizes of its
unrestricted optional-internal mounts, and how many mounts each of those three groups holds. Optional
mounts the package restricts to one module family MUST be stated separately from the rest, under a
group of their own, with each restriction named. A hull with no restricted mount to state MUST state
nothing about restriction — an empty group is not drawn as an absence.

The planetary-approach mount is left out. All 49 hulls the installed package publishes carry one, and
it takes the approach suite and nothing else. A mount every hull has separates no hull from another,
so it MUST appear in neither optional group and MUST be counted in neither total. It is the only
mount both groups leave out. Twenty hulls restrict something else as well; the other twenty-nine
draw no restricted group.

Each total MUST count the mounts of its own group and nothing else. The hull's optional column is
therefore the two totals plus the approach mount, and neither total is a subset of the other.

Seventeen hulls restrict mounts to military modules, two to cargo, one to passenger cabins, and one
to both limpet controllers and vessel hangars; the Anaconda Mk II restricts mounts to both military
modules and cargo. So the group MUST take a hull's restrictions as a list
rather than as one, and MUST name each restriction beside the mounts it holds.

The application names each restriction `Military`, `Cargo`, `Limpet controller`, `Vessel hangar` and
`Passenger`, resolved through the localisation layer like every other string the application owns.
The name is the package's restriction identity spelled for a reader, and it heads a group of mounts
rather than describing what fits in them. A package name for a restriction replaces all five.

`getSlotRestrictionLabel` says which module families a mount accepts — `reinforcement packages and
shield cell banks` for a military mount. It describes the contents rather than naming the group, it
answers in English alone, and the screen MUST NOT head a restricted group with it.

Every size, count and restriction here is the package's own layout for the hull, read through
`getShipSlots` and never counted from a build.

Sizes MUST be grouped rather than listed one by one where a hull repeats one: the reference draws
twelve optional mounts as the seven chips `7`, `3 × 6`, `3 × 5`, `2 × 4`, `3`, `2`, `1`, largest
first. The grouping is presentation over the package's list, and it MUST NOT change what the list
says: the total MUST be the number of mounts rather than the number of groups, and no size may be
added to or dropped from what the package published. Ordering the chips largest first is part of the
presentation.

Source: 001/FR-022.

#### Scenario: A hull repeats an optional mount size

- **WHEN** hull detail states twelve optional mounts of sizes 7, 6, 6, 6, 5, 5, 5, 4, 4, 3, 2 and 1
- **THEN** the sizes are drawn as the chips `7`, `3 × 6`, `3 × 5`, `2 × 4`, `3`, `2`, `1`, largest first
- **AND** the stated total is 12

#### Scenario: A hull restricts several mount groups

- **WHEN** the package publishes more than one restriction for a hull
- **THEN** each restriction heads a group of its own, named by the application
- **AND** every restriction the package publishes for that hull is stated

#### Scenario: A hull restricts nothing beyond the approach mount

- **WHEN** the package publishes no restricted optional mount for a hull other than the planetary-approach mount
- **THEN** hull detail states nothing about restriction

#### Scenario: The planetary-approach mount is excluded

- **WHEN** hull detail states the optional mounts of any hull
- **THEN** the planetary-approach mount appears in neither optional group
- **AND** it is counted in neither total

### Requirement: Hull detail address

A hull detail address MUST name the hull by its package `name`, made URL-ready by replacing each
space with an underscore and changing nothing else — `Type-11 Prospector` is addressed as
`Type-11_Prospector`. That address MUST be matched without regard to case, and it is the canonical
one: the address bar MUST carry it, and it is the address the sitemap lists and the deployment
publishes. A hull's package `symbol` MUST remain accepted as an address and MUST be replaced in
history by the canonical one, so an address published before this rule still opens the hull it named
and is not a second address for it afterwards. A segment naming neither MUST show an error and MUST
NOT create a build.

A hull's address is its name; its identity is still its symbol. The `symbol` stays the hull identity
in stored builds, links, SLEF and the artwork paths.

Only the canonical address is published. The deployment writes one document per address the map
lists, so a symbol address is answered by `404.html` and the router opens the hull from there.

Source: 001/FR-005.

#### Scenario: Opening a hull by its name

- **WHEN** a Commander opens the address segment `type-11_prospector`
- **THEN** the Type-11 Prospector hull detail opens
- **AND** the address bar carries `Type-11_Prospector`

#### Scenario: Opening a hull by its symbol

- **WHEN** a Commander opens an address segment that is a hull's package `symbol`
- **THEN** that hull opens
- **AND** the canonical name address replaces the symbol address in history

#### Scenario: An address names no hull

- **WHEN** an address segment names neither a hull name nor a hull symbol
- **THEN** the application shows an error
- **AND** no build is created

### Requirement: Hull artwork

Hull artwork MUST come from the Almanac package assets, be served from the application's origin and
never carry information without a text equivalent. Missing or uncached artwork MUST NOT block hull
selection or build creation.

Source: 001/FR-006.

#### Scenario: Artwork is missing or not yet cached

- **WHEN** a hull's artwork is missing or uncached
- **THEN** the absence is temporary and is not stated as a catalogue failure
- **AND** the Commander can still select the hull and create a build
