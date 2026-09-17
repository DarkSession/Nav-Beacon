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
shift drive mount, and `setModule` refuses such a fit with the `exactSizeRequired` constraint. The
withdrawn candidates move positions inside the build-link codec table's frame-shift-drive module
sets.

## What Changes

- Use `@elite-dangerous-almanac/core` 0.2.13 as the game-data and build-calculation source.
- State caustic among the conventional damage types the offence reading gives an amount, a share, a
  legend line and a bar segment.
- Keep the unclassified type in the projection. The catalogue supports pinning only the absence of
  an unclassified amount.
- Repoint the offence fixture `OFFENCE_WEAPONS.caustic` at `Hpt_CausticMissile_Fixed_Medium`.
- Overwrite build-link codec table 1 for the withdrawn SCO candidates and record the overwrite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/offence-profile`: Name caustic among the conventional damage types the reading
  states.

No `ship-builder/build-link` requirement changes. "Versioned codec" requires the codec to preserve
every _published_ version. The project is pre-release, `SHIP_BUILDER_RELEASE_TAG` declares no
release, and no link is published against table 1, so `docs/ship-link-codec.md` sanctions replacing
that table in place. A published table would take the next table number instead.

## Impact

The change affects:

- the Almanac dependency, its lockfile and its mirrored licence and notices;
- the offence domain projection and the analysis canvas that draws it;
- the semantic colour tokens and both shipped locales;
- the offence ownership policy;
- build-link codec table 1, its reference corpus and `docs/ship-link-codec.md`;
- the unit and end-to-end coverage of all of them.

The `exactSizeRequired` constraint needs no application text. A refusal keeps the package's
`ModuleFitConstraint` as opaque data, and the application never translates it.
