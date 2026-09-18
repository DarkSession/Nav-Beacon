## Why

Almanac 0.2.13 changes what a weapon's damage split contains. `DamageSplit` carries `caustic` as a
required amount beside kinetic, thermal, explosive and absolute. `unclassified` stays optional and
absent when zero. The Mk II Plasma Shock Accelerator is typed `absolute`. The Enzyme Missile Rack
deals a caustic share beside its explosive one. No article in the 0.2.13 hardpoint catalogue deals
unclassified damage.

The offence profile projects a fixed list of conventional damage types, and that list omits caustic.
The reading therefore drops an amount the package reports for a build with a caustic weapon, which
principle IV forbids.

The same release restricts one outfitting choice. Outfitting sells a Supercruise Overcharge drive
only at the mount's own size. `ShipLoadout.modulesForSlot` offers no SCO drive to a larger frame
shift drive mount, and `setModule` refuses such a fit with the `exactSizeRequired` constraint. Each
frame-shift-drive module set in the build-link codec table therefore loses the SCO drives below the
mount's own class, which moves the position of every candidate under them.

## What Changes

- Use `@elite-dangerous-almanac/core` 0.2.13 as the game-data and build-calculation source.
- State caustic among the conventional damage types the offence reading gives an amount, a share, a
  legend line and a bar segment.
- Keep the unclassified type in the projection. The catalogue supports pinning only the absence of
  an unclassified amount.
- Repoint the offence fixture `OFFENCE_WEAPONS.caustic` at `Hpt_CausticMissile_Fixed_Medium`.
- Mint build-link codec table 2 for the withdrawn SCO candidates, and keep table 1 as it is
  published so the links already shared against it still decode.
- Refuse an in-place rewrite of a published table outright, in the generator and in the capacity
  check, rather than leaving an `--overwrite` flag that is no longer sound.
- Refuse a build link whose payload records a fit the installed catalogue declines, rather than
  opening the build the package repairs it into.
- Take the pre-engineered record for a Mercenary purchase whose capture states no modifiers, so a
  build carrying one still shares.
- Hold a published link for every table version a link can name, pinned to the build it opens.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/offence-profile`: Name caustic among the conventional damage types the reading
  states.
- `ship-builder/build-link`: State that a published identifier table is immutable. "Versioned
  codec" already requires every published payload version to be preserved, but says nothing about
  the table those versions read. The application is published, so a table a link names is a promise
  to that link: the content it held when the link was made is the content it has to hold. The
  package moved the frame-shift-drive candidate sets, which changes the table's content, so this
  change is the first to owe a new table number rather than a regeneration. State also what a
  payload the catalogue refuses becomes, and what a capture carrying a package variant without its
  modifiers carries.

## Impact

The change affects:

- the Almanac dependency, its lockfile and its mirrored licence and notices;
- the offence domain projection and the analysis canvas that draws it;
- the semantic colour tokens and both shipped locales;
- the offence ownership policy;
- the build-link codec tables, their loader, their generator, the capacity check, the reference
  corpus and `docs/ship-link-codec.md`;
- `docs/equipment-link-codec.md`, whose statement of the same rule named an exception that is
  spent. Almanac 0.2.13 leaves the equipment table's content unchanged, so that codec needs no
  new table here;
- the unit and end-to-end coverage of all of them.

The `exactSizeRequired` constraint needs no application text. A refusal keeps the package's
`ModuleFitConstraint` as opaque data, and the application never translates it.
