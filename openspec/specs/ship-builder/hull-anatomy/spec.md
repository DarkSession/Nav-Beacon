## Purpose

This capability lets Commanders locate hardpoints and utility mounts on the Almanac top and bottom
hull schematics, and move between a located mount and its outfitting slot. Internal mounts stay
available through the complete slot list feature 002 owns.

## Requirements

### Requirement: Schematics come from the package for the active hull

Hull anatomy MUST require an active build and MUST present what the build reproduces from the
package's `schematic-top.svg` and `schematic-bottom.svg` for the hull `symbol` — the rendering and
the mount extract of each side. The package SVG itself MUST never be fetched, served or committed
(openspec/changes/archive/010-hull-anatomy/contracts/schematic-assets.md).

The schematic filter MUST be declared on an ordinary box around the drawing rather than on an SVG
container element, because WebKit applies no filter function to an SVG container and the package's
own ink then renders unfiltered. The marks and the leaders stay outside that box. The engine matrix
is Chromium and Firefox by constitutional mandate, so no automated test guards this: the suites
assert the shape of the declaration and `e2e/manual/webkit-filter.protocol.md` covers the rest.

Source: 010/FR-001.

#### Scenario: An active build on a known hull

- **WHEN** a build is active and the package ships schematics for its hull `symbol`
- **THEN** the top and bottom schematics of that hull are available, each with its rendering and its
  mount extract

### Requirement: Only annotated schematic features are interactive

The application MUST present as an interactive mount only a schematic feature carrying a package
`data-journal-slot` that resolves to a hardpoint or utility mount on the active hull.

Source: 010/FR-002.

#### Scenario: A slot key that does not resolve

- **WHEN** a schematic feature carries a slot key that does not resolve on the active hull
- **THEN** the feature is omitted at run time and no slot is guessed for it

### Requirement: Identity and geometry come from the package SVG

Hardpoint and utility-mount identity and geometry MUST come from the package SVG. The application
MUST NOT use list position, drawing order, hand-maintained mappings, or coordinates measured off the
rendered document (`getBBox`, `getScreenCTM`, `getBoundingClientRect` and the rest).

Arithmetic over the coordinates the package itself publishes — the rectangle a document draws in, the
middle of an annotation — is that geometry read, not a second source for it, and is permitted
(openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md, "Schematic regions").

Source: 010/FR-003.

#### Scenario: Placing a mount

- **WHEN** the application places a mount on a plate
- **THEN** it uses only coordinates the package publishes, and measures none off the rendered
  document

### Requirement: No invented geometry for internal slots

Core, optional, armour and cargo-hatch slots MUST NOT receive invented geometry. The complete slot
list MUST remain the route to every slot it draws, and this capability MUST NOT become a second route
to the one mount that list withholds (002/FR-002a). An internal mount is not this capability's to
locate either way.

Source: 010/FR-004.

#### Scenario: A slot with no package geometry

- **WHEN** a slot has no package schematic geometry
- **THEN** it stays available through the complete slot list, and this capability gives it no
  geometry of its own

#### Scenario: The withheld planetary approach mount

- **WHEN** the complete slot list withholds the planetary approach mount
- **THEN** hull anatomy does not locate it either

### Requirement: Located mounts state their state in text

Each located hardpoint and utility mount MUST expose fitted, empty, engineering and focused state
with a complete text equivalent naming its slot. Position, colour and shape MUST NOT carry mount
state alone.

A utility mount MUST have the same interaction, state, detail and outfitting navigation as a
hardpoint. A selected utility mount MUST NOT take the accent fill a selected hardpoint takes: the
fill says which mount is selected and the hue says which kind it is, so a selected utility mount is
filled in the informational hue the legend's `UTILITY` entry draws. Selection MUST also be carried by
`aria-pressed` and by the ledger row.

Source: 010/FR-005.

#### Scenario: A fitted, engineered mount

- **WHEN** a located mount is fitted, empty, engineered or focused
- **THEN** the plate shows that state visually and a text equivalent names the slot and its state

#### Scenario: A selected utility mount

- **WHEN** the Commander selects a utility mount
- **THEN** the mark is filled in the legend's `UTILITY` hue rather than the accent hue
- **AND** `aria-pressed` and the ledger row also carry the selection

### Requirement: Movement between geometry and outfitting

Activating a located hardpoint or utility mount MUST reach its slot. Focusing a located slot MUST
identify and reveal at least one containing schematic. Selecting a located mount MUST mark its
outfitting row and title the bench.

Source: 010/FR-006, 010/SC-002.

#### Scenario: Activating a mount

- **WHEN** the Commander activates a located hardpoint or utility mount
- **THEN** the matching game slot is reached in one interaction, its outfitting row is marked and the
  bench is titled

#### Scenario: Focusing a located slot

- **WHEN** the Commander focuses a located outfitting slot
- **THEN** the application identifies and reveals a schematic containing that slot

### Requirement: Repeated geometry is one build identity

Repeated geometry for one slot MUST remain one build identity and MUST show identical state. Every
located hardpoint and utility mount MUST appear once in a stable text-equivalent order, and MUST
resolve to the same package slot on every hull.

Source: 010/FR-007, 010/SC-001.

#### Scenario: A mount on both schematics

- **WHEN** a mount appears on the top and the bottom schematic
- **THEN** both instances represent one build slot and show identical state

#### Scenario: The text equivalent order

- **WHEN** the text equivalent lists the located mounts
- **THEN** each mount appears once, in a stable order

### Requirement: Mount detail stays with the outfitting capability

Located-mount detail — slot key, size, fitted module, priority and power state — MUST remain owned by
the outfitting capability at the same build revision. Hull anatomy MUST NOT publish a second detail
surface for a mount it has selected, and MUST NOT publish a second mount list.

Source: 010/FR-008.

#### Scenario: A selected mount

- **WHEN** the Commander selects a located mount
- **THEN** the outfitting capability states its slot key, size, fitted module, priority and power
  state at the same build revision
- **AND** hull anatomy draws no second detail block and no second mount list

### Requirement: Schematic assets are reproducible from the pinned package

Schematics MUST be produced from the installed Almanac package into same-origin build assets, and no
other source may supply them. The application MUST NOT maintain a private copy or geometry catalogue.
An asset the application serves MUST be reproducible from the pinned package by a script in this
repository, and the build MUST fail when one is not (openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md, "The package SVG is
never fetched").

Source: 010/FR-009.

#### Scenario: An asset the pinned package does not produce

- **WHEN** a served schematic asset cannot be reproduced from the pinned package by a repository
  script
- **THEN** the build fails

### Requirement: A missing schematic never blocks outfitting

Missing or uncached schematics MUST NOT block slot inspection or editing, and MUST be identified as
temporarily unavailable. Every slot MUST remain usable without the schematics, and every located
hardpoint, utility mount and state MUST keep an equivalent text representation whether or not its
schematic is available.

Source: 010/FR-010, 010/SC-003, 010/SC-004.

#### Scenario: A schematic fails to load

- **WHEN** a schematic is missing or uncached
- **THEN** it is identified as temporarily unavailable
- **AND** the full slot list stays available and every slot stays inspectable and editable

### Requirement: Artwork provenance lives in the help capability

Artwork provenance and applicable media terms MUST be reachable from the application's help
capability. Hull anatomy MUST NOT publish a provenance control of its own.

Source: 010/FR-011.

#### Scenario: A Commander looks for provenance

- **WHEN** a Commander looks for the artwork's provenance and media terms
- **THEN** the help capability states them and the anatomy screen offers no control of its own

### Requirement: Marks are anchored, separately operable and move as little as the plate allows

Each interactive hardpoint and utility mount MUST be a separately operable named control anchored to
the position the package published, and MUST NOT be enlarged by moving that geometry.

Where two marks would cover each other the plate MUST draw them apart, as far as the plate allows and
no further. Where no arrangement separates them all they MUST be left near their own mounts rather
than one being moved clear of the rest, and the complete slot list remains the equivalent.

A mark MAY be drawn away from its anchor to keep it clear of another mark or of another mount's
published position, provided that:

- the anchor is unchanged;
- a leader joins the mark to its anchor and is drawn wherever the mark does not cover it;
- the displacement is computed only from coordinates the package published and the application's own
  measurement of how large it drew the mark;
- the result is deterministic for a given hull and plate size.

A mark MUST NOT be drawn further from its anchor than the separation between it and the marks it
would otherwise cover. A mark that covers neither another mark nor another mount's published
position, and that the plate can draw whole where the package put it, MUST NOT be moved at all. A
mark whose square would otherwise hang off the plate MUST be drawn just inside it, which is a mount
the package published within half a mark of the hull's own nose or tail. Where the package draws two
mounts as mirror images of each other, the plate MUST draw their marks as mirror images too.

Because a mark's drawn width does not scale with the plate at every size, how close is too close MUST
be measured rather than assumed (openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md, "Marks that would touch").

The marks are drawn at the canvas's own size, below the project's 44-pixel baseline: the size
criterion is met through SC 2.5.8's Equivalent exception, by feature 002's complete ledger offering
every one of the same mounts on the same screen, whether or not the artwork arrived
(openspec/changes/archive/010-hull-anatomy/design/hull-anatomy.md, "Divergence from FR-012", for the
exception). The equivalent need meet only the criterion's own minimum: each ledger row MUST be at
least 24 CSS pixels in both dimensions (SC 2.5.8). Where the ledger shows one kind
of mount at a time, the choice that shows a mount's kind MUST be on the same screen as the plate.
Nothing pans, because every plate is drawn whole at the hull's own proportions.

Source: 010/FR-012.

#### Scenario: Two marks would cover each other

- **WHEN** the package publishes two mounts whose marks would cover each other on this plate
- **THEN** the marks are pushed apart along the shorter of the two axes out of the overlap, no
  further than the separation requires
- **AND** each displaced mark keeps its published anchor and draws a leader back to it

#### Scenario: A mark nothing touches

- **WHEN** a mark covers neither another mark nor another mount's published position, and the plate
  can draw it whole where the package put it
- **THEN** the mark is not moved at all

#### Scenario: Mirrored mounts

- **WHEN** the package draws two mounts as mirror images of each other
- **THEN** the plate draws their marks as mirror images too

#### Scenario: A plate too small to separate its marks

- **WHEN** no arrangement separates every mark on the plate
- **THEN** the marks overlap near their own mounts rather than being moved clear of the rest
- **AND** the complete slot list remains the equivalent

#### Scenario: A mount at the nose or tail

- **WHEN** the package published a mount within half a mark of the hull's own nose or tail
- **THEN** the mark is drawn just inside the plate rather than hanging off it

#### Scenario: The same hull at the same plate size

- **WHEN** the same hull is drawn twice at the same plate size
- **THEN** every mark takes the same position

#### Scenario: The ledger is the size equivalent

- **WHEN** the plate draws a mark smaller than 24 by 24 CSS pixels
- **AND** the ledger shows that mount's kind
- **THEN** the ledger on the same screen offers the same mount as a control at least 24 by 24 CSS
  pixels

#### Scenario: The ledger shows another kind of mount

- **WHEN** the plate draws a utility mount and the ledger shows only the hardpoints
- **THEN** the choice that shows the utility mounts is on the same screen
- **AND** after that choice the ledger offers the mount as a control at least 24 by 24 CSS pixels
