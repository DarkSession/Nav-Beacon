## MODIFIED Requirements

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
