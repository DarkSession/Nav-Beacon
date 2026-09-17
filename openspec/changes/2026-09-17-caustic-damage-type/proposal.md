## Why

Almanac 0.2.13 changes what a weapon's damage split can contain. `DamageSplit` now carries
`caustic` as a required amount, the Mk II Plasma Shock Accelerator is typed `absolute` rather than
unclassified, and the Enzyme Missile Rack deals a caustic share beside its explosive one. No article
in the 0.2.13 hardpoint catalogue deals unclassified damage.

The offence profile projects a fixed list of conventional damage types, and that list does not name
caustic. A build with a caustic weapon therefore loses a real amount from the reading, which
principle IV forbids.

The same release restricts one outfitting choice and one build-link table. Outfitting sells a
Supercruise Overcharge drive only at the size of the mount being outfitted, so `modulesForSlot` no
longer offers an SCO drive to a frame shift drive mount larger than its own class, and the package
refuses such a fit with a new `exactSizeRequired` constraint. The withdrawn candidates move a
position inside the build-link codec table's frame-shift-drive module sets.

## What Changes

- Use `@elite-dangerous-almanac/core` 0.2.13 as the game-data and build-calculation source.
- State caustic among the conventional damage types the offence reading gives an amount, a share, a
  legend line and a bar segment.
- Keep the unclassified type in the projection, and keep the pinned absence of an unclassified
  amount as the whole of what the catalogue supports saying about it.
- Repoint the offence fixtures and the package-acceptance suite at the article that carries a
  caustic share.
- Overwrite build-link codec table 1 for the withdrawn SCO candidates and record the overwrite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/offence-profile`: Name caustic among the conventional damage types the reading
  states.

## Impact

The change affects the Almanac dependency, its lockfile and its legal mirror, the offence domain
projection and the analysis canvas that draws it, the semantic colour tokens, both shipped locales,
the offence ownership policy, the build-link codec table with its reference corpus and codec
document, and the unit and end-to-end coverage of all of them.

The new `exactSizeRequired` constraint needs no application text. A refusal keeps the package's
`ModuleFitConstraint` as opaque data and the application never translates it, so a new constraint
value passes through unchanged.
