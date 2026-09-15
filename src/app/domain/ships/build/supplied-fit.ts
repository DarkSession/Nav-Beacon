import { getDefaultLoadout } from '@elite-dangerous-almanac/core/ships/default-loadouts';
import { fold, type SuppliedFit } from './build-default';

/**
 * The modules the package says a hull is supplied with, read once per hull.
 *
 * Read from `getDefaultLoadout`, which publishes the identities alone, rather
 * than from `ShipLoadout.default`, which builds a calculated loadout and
 * reaches the whole outfitting catalogue to do it. The package states the same
 * division in its own documentation.
 *
 * Asked by whoever constructs a candidate, as the hull's name is, so that
 * neither the store that holds the build nor the shell around it reaches the
 * package for it (`active-build.models.ts`, `BuildCandidate`).
 *
 * A hull the package publishes no default for answers `null`: there is no
 * default to be at. The answer is kept per process, so a release that changes a
 * hull's supplied fit takes effect on the next load — which is when the
 * upgraded package arrives.
 */
const supplied = new Map<string, SuppliedFit | null>();

export function suppliedFit(shipSymbol: string): SuppliedFit | null {
  const key = fold(shipSymbol);
  const known = supplied.get(key);
  if (known !== undefined) {
    return known;
  }

  const published = getDefaultLoadout(shipSymbol);
  const fit =
    published === null
      ? null
      : new Map(published.modules.map((module) => [fold(module.slot), fold(module.symbol)]));
  supplied.set(key, fit);
  return fit;
}
