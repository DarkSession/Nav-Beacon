## Screens

The change introduces no screen. It adds one legend line and one bar segment to the damage-by-type
reading the offence analysis canvas already composes.

The reading handles three states, and caustic enters each of them on the same terms as the five
types beside it:

- **A type the build deals.** The legend line composes the canvas's tracked mono label with the
  amount and the share; the bar composes one `.split__segment` sized by that share.
- **A type the build does not deal.** No line, no segment, no zero.
- **No conventional damage at all.** No bar.

The reading satisfies 007/FR-003.

## The caustic segment's colour token

`--ednb-surface-damage-caustic` is bound to `--ednb-palette-good` (`#8fd94a`). Explosive holds
`--ednb-palette-good-2` (`#7fc46b`).

The bar separates its segments with a hairline gap over `--ednb-surface-inset` (`#151514`), so a
segment's boundary is the gap rather than the neighbouring colour. Each segment is measured against
that ground:

| Segment      | Against `#151514` |
| ------------ | ----------------: |
| kinetic      |            7.85:1 |
| thermal      |            6.46:1 |
| explosive    |            8.71:1 |
| caustic      |           10.61:1 |
| absolute     |           10.08:1 |
| unclassified |            2.26:1 |

Caustic is the highest of the six. Between neighbours the figures are much lower — explosive against
caustic is 1.22:1, where kinetic against thermal is 1.21:1 and caustic against absolute is 1.05:1 —
because one dark theme cannot hold six hues that are all far apart. Caustic therefore sits in the
band the existing pairs already occupy and moves no figure.

That is sound because the colour carries no reading of its own. Every segment states its type, its
exact amount and its share as text in the legend line beside it, so a Commander who cannot separate
the two greens reads both lines. Giving caustic a sixth distinct hue would leave the palette, or
reuse a token that carries another meaning in the theme.

## Builds carrying a withdrawn SCO fit

A stored build, a link or a SLEF payload can name a Supercruise Overcharge drive in a frame shift
drive mount larger than its class. `ShipLoadout.setModule` refuses that fit, and the application
already answers a refusal during reconstruction: the codec raises `reconstructionFailed`, and SLEF
carries the package diagnostic. The Commander is told the loadout could not be reconstructed rather
than shown a build with the drive dropped. No new outcome is needed.

## Migration Plan

The exact dependency and the lockfile move together. Table 1's content hash is re-pinned in
`docs/ship-link-codec.md` and in the codec suite. No persisted build format changes, so a stored
build and a published link are read on the same terms as before. A rollback restores the dependency,
the lockfile and the previous table.
