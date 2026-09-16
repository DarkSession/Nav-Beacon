import { getDefaultLoadout } from '@elite-dangerous-almanac/core/ships/default-loadouts';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { describe, expect, it } from 'vitest';
import { fold } from './build-default';

/**
 * What the installed Almanac says a module symbol identifies, written down.
 *
 * This suite tests the *package*, over every hull it publishes a default
 * loadout for. `atPackageDefault` compares a build's module symbols against the
 * supplied fit's by identity rather than by spelling, and the reason it may is
 * the package's own: a symbol names one module whatever its letter case. That
 * promise is characterised here, so a release that made letter case meaningful
 * fails this suite rather than quietly changing which builds take a record
 * (024/FR-001).
 *
 * It asserts no catalogue counts. How many hulls the package ships is the
 * package's business; what is asserted is that every one of them keeps the
 * promise, which stays true as the catalogue grows.
 */

/** The mount a hull's cargo hatch sits in, which carries no outfitting module. */
const CARGO_HATCH = 'CargoHatch';

/** Every hull the package publishes a supplied fit for, with that fit. */
const supplied = SHIPS.map((ship) => [ship.symbol, getDefaultLoadout(ship.symbol)] as const).filter(
  (entry): entry is readonly [string, NonNullable<ReturnType<typeof getDefaultLoadout>>] =>
    entry[1] !== null,
);

describe('the installed Almanac, on what a module symbol identifies', () => {
  it('publishes a supplied fit for hulls, so the comparison has something to read', () => {
    expect(supplied.length).toBeGreaterThan(0);
  });

  it('knows every supplied symbol but the cargo hatch, so the folding cases reach something', () => {
    // Each case below filters on what the catalogue knows, so a catalogue that
    // knew nothing would satisfy them all. A cargo hatch is not an outfitting
    // module and the catalogue carries none; every other supplied article is
    // one.
    const unresolved = supplied.flatMap(([hull, fit]) =>
      fit.modules
        .filter((module) => getModuleBySymbol(module.symbol) === null)
        .map((module) => `${hull} ${module.slot}=${module.symbol}`),
    );

    expect(unresolved.every((entry) => entry.includes(CARGO_HATCH))).toBe(true);
    expect(supplied.flatMap(([, fit]) => fit.modules).length - unresolved.length).toBeGreaterThan(
      0,
    );
  });

  it('names one hull whatever the case its symbol is asked in', () => {
    // `suppliedFit` memoises a hull's fit under its folded symbol, so two hulls
    // that folded together would answer each other's supplied fit.
    const folded = new Set(SHIPS.map((ship) => fold(ship.symbol)));

    expect(folded.size).toBe(SHIPS.length);

    for (const ship of SHIPS) {
      const published = getDefaultLoadout(ship.symbol);
      expect(getDefaultLoadout(ship.symbol.toLowerCase())).toEqual(published);
      expect(getDefaultLoadout(ship.symbol.toUpperCase())).toEqual(published);
    }
  });

  it('folds a supplied symbol onto the spelling its module catalogue uses', () => {
    // A supplied fit is not published in the catalogue's own spelling: the
    // Anaconda supplies `Int_SuperCruiseAssist`, which the catalogue calls
    // `Int_SupercruiseAssist`. Folding the case is what carries one onto the
    // other, and it has to reach every hull rather than that one.
    const unfolded = supplied.flatMap(([hull, fit]) =>
      fit.modules
        .filter((module) => {
          const known = getModuleBySymbol(module.symbol);
          return known !== null && fold(known.symbol) !== fold(module.symbol);
        })
        .map((module) => `${hull} ${module.slot}=${module.symbol}`),
    );

    expect(unfolded).toEqual([]);
  });

  it('answers each case of a symbol it knows with the same module', () => {
    const disagreeing = supplied.flatMap(([hull, fit]) =>
      fit.modules
        .filter((module) => {
          const published = getModuleBySymbol(module.symbol);
          const lowered = getModuleBySymbol(module.symbol.toLowerCase());
          const raised = getModuleBySymbol(module.symbol.toUpperCase());
          return published?.symbol !== lowered?.symbol || published?.symbol !== raised?.symbol;
        })
        .map((module) => `${hull} ${module.slot}=${module.symbol}`),
    );

    expect(disagreeing).toEqual([]);
  });

  it('names one module per supplied slot once letter case is set aside', () => {
    // The package does not publish its supplied fits in one case — the
    // Anaconda's names `Int_SuperCruiseAssist` beside
    // `int_planetapproachsuite_advanced` — so a build and a supplied fit can
    // hold one module in two spellings. Folding them is only sound while each
    // folded symbol still names one module.
    const collisions = supplied.flatMap(([hull, fit]) => {
      const byFolded = new Map<string, Set<string>>();
      for (const module of fit.modules) {
        const canonical = getModuleBySymbol(module.symbol)?.symbol ?? module.symbol;
        const seen = byFolded.get(fold(module.symbol)) ?? new Set<string>();
        seen.add(canonical);
        byFolded.set(fold(module.symbol), seen);
      }
      return [...byFolded.entries()]
        .filter(([, seen]) => seen.size > 1)
        .map(([folded, seen]) => `${hull} ${folded} -> ${[...seen].join(', ')}`);
    });

    expect(collisions).toEqual([]);
  });

  it('keeps each supplied slot key unique once letter case is set aside', () => {
    const collisions = supplied.flatMap(([hull, fit]) => {
      const counted = new Map<string, number>();
      for (const module of fit.modules) {
        counted.set(fold(module.slot), (counted.get(fold(module.slot)) ?? 0) + 1);
      }
      return [...counted.entries()]
        .filter(([, count]) => count > 1)
        .map(([slot]) => `${hull} ${slot}`);
    });

    expect(collisions).toEqual([]);
  });
});
