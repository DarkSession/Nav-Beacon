## Why

The engineering interface can offer an experimental-effect edit that the fitted module does not
permit. Almanac 0.2.12 publishes the required restriction through the loadout effect menu.

[Almanac pull request 55](https://github.com/DarkSession/Elite-Dangerous-Almanac/pull/55) records the
upstream restriction and its shared regression fixtures.

## What Changes

- Use `@elite-dangerous-almanac/core` 0.2.12 as the game-data and build-edit source.
- Offer experimental effects only when `ShipLoadout.availableExperimentalEffects(slotKey)` returns
  them.
- Keep a fitted module's fixed experimental state visible without offering a control that can add,
  remove or replace it.
- Verify package acceptance and the rendered engineering states for editable and fixed effects.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship-builder/module-engineering`: Define the package effect-menu result as the source of
  experimental-effect edit availability.

## Impact

The change affects the Almanac dependency, the outfitting application state, the engineering
surface, and their unit and end-to-end coverage.
