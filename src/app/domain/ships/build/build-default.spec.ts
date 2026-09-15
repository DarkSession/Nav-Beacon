import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { FIXTURE_HULL, FIXTURE_SLOTS, UNKNOWN_HULL } from '../outfitting/outfitting.fixtures';
import { atPackageDefault } from './build-default';
import type { BuildSnapshotV1 } from './build-snapshot';
import { toBuildSnapshotV1 } from './build-snapshot.serializer';

/**
 * What a record is worth keeping is decided here.
 *
 * The question is asked of the state alone, so every route into a build — the
 * hull catalogue, a link, a SLEF paste, a journal event — gets the same answer
 * for the same build (024/FR-001).
 */

function replacedModule(): BuildSnapshotV1 {
  const build = ShipLoadout.default(FIXTURE_HULL);
  const fitted = build.fittedModuleAt(FIXTURE_SLOTS.fittedHardpoint);
  const other = build
    .modulesForSlot(FIXTURE_SLOTS.fittedHardpoint)
    .find((module) => module.symbol !== fitted?.symbol);
  if (other === undefined) {
    throw new Error(
      `The installed Almanac offers one module alone for ${FIXTURE_HULL}'s ` +
        `${FIXTURE_SLOTS.fittedHardpoint}. Pick a mount with a choice from the package ` +
        'rather than writing one here.',
    );
  }
  build.setModule(FIXTURE_SLOTS.fittedHardpoint, other);
  return toBuildSnapshotV1(build);
}

describe('package default build', () => {
  it('reports the hull’s default loadout at its default', () => {
    expect(atPackageDefault(toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)))).toBe(true);
  });

  it('reports a replaced module as not at the default', () => {
    expect(atPackageDefault(replacedModule())).toBe(false);
  });

  it('reports a named ship as not at the default', () => {
    const named = { ...toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)), shipName: 'Gimel' };

    expect(atPackageDefault(named)).toBe(false);
  });

  it('reports a ship carrying an ident as not at the default', () => {
    const identified = {
      ...toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL)),
      shipIdent: 'FD-11X',
    };

    expect(atPackageDefault(identified)).toBe(false);
  });

  it('reads one package identity spelled two ways as one identity', () => {
    // A hull symbol, a slot key and a module symbol are each unique
    // case-insensitively, and the package hands the same one back in more than
    // one spelling — the default loadout it publishes and the catalogue a build
    // link decodes into do not always agree. A Commander who opens a hull's
    // default loadout from a link is looking at the same build as one who
    // created it from the catalogue (024/FR-001).
    const snapshot = toBuildSnapshotV1(ShipLoadout.default(FIXTURE_HULL));
    const recased: BuildSnapshotV1 = {
      ...snapshot,
      shipSymbol: snapshot.shipSymbol.toUpperCase(),
      modules: snapshot.modules.map((module) => ({
        ...module,
        slot: module.slot.toUpperCase(),
        symbol: module.symbol.toUpperCase(),
      })),
    };

    expect(atPackageDefault(recased)).toBe(true);
  });

  it('reports a hull the package publishes no default for as not at a default', () => {
    // Answered rather than thrown: there is no default to be at, and asking the
    // package for one raises. A record is owed for such a build like any other.
    const unknown: BuildSnapshotV1 = {
      format: 'ednb.build',
      version: 1,
      shipSymbol: UNKNOWN_HULL,
      shipName: null,
      shipIdent: null,
      modules: [],
    };

    expect(() => atPackageDefault(unknown)).not.toThrow();
    expect(atPackageDefault(unknown)).toBe(false);
  });
});
