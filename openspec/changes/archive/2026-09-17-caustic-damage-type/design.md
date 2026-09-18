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
drive mount larger than its class. `ShipLoadout.setModule` refuses that fit, so no Commander reaches
it through outfitting. A payload is the other way in, and there the package repairs rather than
refuses: `ShipLoadout.fromLoadout` stocks the mount with the hull's own drive and reports the
substitution in `importOutcomes`.

The two ingress paths want opposite answers to that, so each keeps its own. A journal or SLEF
payload records a ship that flew, and the package's reading of it is the build, which is why
`build-ingress-normalizer.ts` treats a defaulted mount as ordinary state. A build link is this
application's own lossless format: its payload names exactly what the Commander fitted, so a
substituted article is a build they never had. The codec therefore reads `importOutcomes` after
reconstruction and raises `reconstructionFailed` naming the article and the mount, rather than
opening a build with the drive silently exchanged (constitution IV). No new outcome code is needed;
the existing refusal carries it.

## A new codec table rather than an edited one

The catalogue move narrows the module sets a frame shift drive mount offers, so the generator no
longer produces the content build-link codec table 1 holds. The application is published, and a
payload names the table that decodes it, so table 1 is the promise made to every link already
shared against it. Editing it would change what those links mean.

The new content is therefore minted as table 2, and table 1 stays exactly as it was published. The
codec architecture already carries this: the payload's first field is the table version, and
`build-link-codec-loader.ts` imports the table that field names. Minting a version costs two edits
in the codec and one new file, plus the pins and the corpus entry the suites carry, and touches no
earlier table.

The alternative considered was keeping one table and editing it, which the project did nine times
while it was pre-release and no link could exist. That exception depended on there being no
published links, and it is spent. The `--overwrite` flag that carried it is removed rather than left
in place, because a flag that is never sound to use is an invitation to use it. The generator
re-hashes every published table before it writes, and the capacity check prices every committed
table, so the rule is something the build holds rather than something to remember.

## Migration Plan

The exact dependency and the lockfile move together. Table 2 is added; table 1 keeps the content and
the hash it was published with. No persisted build format changes, and a link written against table
1 still decodes against table 1, so a stored build and a published link are read on the same terms
as before. A rollback restores the dependency and the lockfile, and lowers the current table version
to 1; table 2 stays readable, because a link may already name it.
