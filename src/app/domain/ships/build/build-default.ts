import type { BuildSnapshotV1, SnapshotModuleV1 } from './build-snapshot';

/**
 * The modules a hull is supplied with: slot to module, in one letter case.
 *
 * Read from the package by `suppliedFit`, and carried on the candidate to the
 * store that asks this question.
 */
export type SuppliedFit = ReadonlyMap<string, string>;

/**
 * Whether a build is still the one the package hands out for its hull.
 *
 * A build in this state holds nothing a Commander decided. It carries the
 * hull's supplied fit, no ship name, no ident, and no choice on any module —
 * which is reached again by selecting the hull, so it is worth no record
 * (024/FR-001).
 *
 * Asked of the state alone. A default build arrives by creation, by a link, by
 * a SLEF paste and by a journal event, and nothing here can tell which — which
 * is the point: one answer for one state, wherever it came from. `fit` is the
 * hull's own, not the build's: it never changes while the build is open, and a
 * hull the package publishes no default for has none to be at.
 *
 * Nothing here reaches the package. The store that asks is started with the
 * shell, so a catalogue reached from here is a catalogue in the first bundle a
 * Commander downloads.
 */
export function atPackageDefault(snapshot: BuildSnapshotV1, fit: SuppliedFit | null): boolean {
  if (fit === null || snapshot.shipName !== null || snapshot.shipIdent !== null) {
    return false;
  }
  if (fit.size !== snapshot.modules.length) {
    return false;
  }

  return snapshot.modules.every(
    (module) => undecided(module) && fit.get(fold(module.slot)) === fold(module.symbol),
  );
}

/** Whether a module carries nothing beyond the article the hull was supplied with. */
function undecided(module: SnapshotModuleV1): boolean {
  return (
    module.enabled === null &&
    module.priority === null &&
    module.preEngineered === null &&
    module.engineering === null
  );
}

/**
 * One letter case, because two spellings of one identity are one identity.
 *
 * A hull symbol, a slot key and a module symbol are each unique
 * case-insensitively, and the package hands the same one back in more than one
 * spelling: the default loadout it publishes for the Anaconda names
 * `Int_SuperCruiseAssist`, and the same module decoded from a build link comes
 * back as `Int_SupercruiseAssist`. A Commander who opens a hull's default
 * loadout from a link is looking at the build a Commander who created it from
 * the catalogue is looking at, and letter case is not a decision either of them
 * made (024/FR-001).
 */
export function fold(identity: string): string {
  return identity.toLowerCase();
}
