import { getDefaultLoadout } from '@elite-dangerous-almanac/core/ships/default-loadouts';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { baselineFingerprint } from './build-fingerprint';
import type { BuildSnapshotV1 } from './build-snapshot';
import { toBuildSnapshotV1 } from './build-snapshot.serializer';

/**
 * Whether a build is still the one the package hands out for its hull.
 *
 * A build in this state holds nothing a Commander decided. It is
 * `ShipLoadout.default(<hull symbol>)` with no ship name and no ident, which is
 * reached again by selecting the hull, so it is worth no record (024/FR-001).
 *
 * Asked of the state alone. A default build arrives by creation, by a link, by
 * a SLEF paste and by a journal event, and nothing here can tell which — which
 * is the point: one answer for one state, wherever it came from.
 *
 * Compared by `baselineFingerprint`, so the two sides are the same function
 * over the same shape and a change to the serialiser moves both.
 */
export function atPackageDefault(snapshot: BuildSnapshotV1): boolean {
  const fingerprint = defaultFingerprint(snapshot.shipSymbol);
  return fingerprint !== null && comparableFingerprint(snapshot) === fingerprint;
}

/**
 * The fingerprint this comparison reads, with every package identity in one
 * letter case.
 *
 * A hull symbol, a slot key and a module symbol are each unique
 * case-insensitively, and the package hands the same one back in more than one
 * spelling: the default loadout it publishes for the Anaconda names
 * `Int_SuperCruiseAssist`, and the same module decoded from a build link comes
 * back as `Int_SupercruiseAssist`. A Commander who opens a hull's default
 * loadout from a link is looking at the build a Commander who created it from
 * the catalogue is looking at, and letter case is not a decision either of them
 * made (024/FR-001).
 *
 * Only this comparison reads it. `baselineFingerprint` stays exactly as it is,
 * because it answers a different question: whether the stored state moved.
 */
function comparableFingerprint(snapshot: BuildSnapshotV1): string {
  return baselineFingerprint({
    ...snapshot,
    shipSymbol: snapshot.shipSymbol.toLowerCase(),
    modules: snapshot.modules.map((module) => ({
      ...module,
      slot: module.slot.toLowerCase(),
      symbol: module.symbol.toLowerCase(),
    })),
  });
}

/**
 * The fingerprint of a hull's default build, built once per hull.
 *
 * Building the loadout is package work, and the question is asked on every
 * revision of a build that holds no record. A hull the package publishes no
 * default for is answered before anything is built, because asking for one
 * raises rather than returning nothing.
 *
 * Per process, so a release that changes a hull's default takes effect on the
 * next load — which is when the upgraded package arrives.
 */
const defaults = new Map<string, string>();

function defaultFingerprint(shipSymbol: string): string | null {
  if (getDefaultLoadout(shipSymbol) === null) {
    return null;
  }

  // Keyed in one case, because the package answers for a hull in any of them
  // and two spellings of one hull are one hull.
  const key = shipSymbol.toLowerCase();
  const known = defaults.get(key);
  if (known !== undefined) {
    return known;
  }

  const fingerprint = comparableFingerprint(toBuildSnapshotV1(ShipLoadout.default(shipSymbol)));
  defaults.set(key, fingerprint);
  return fingerprint;
}
