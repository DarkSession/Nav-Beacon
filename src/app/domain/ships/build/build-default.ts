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
  if (fit === null || named(snapshot.shipName) || named(snapshot.shipIdent)) {
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
  return atStartingPower(module) && module.preEngineered === null && module.engineering === null;
}

/** The journal's zero-based first power group, which every module starts in. */
const FIRST_POWER_GROUP = 0;

/**
 * Whether a module is powered the way every module starts.
 *
 * Read by what the state says, not by whether it was written. A journal states
 * `On` and `Priority` on every module and a build assembled here states
 * neither, so one build reaches this comparison in two shapes; both say the
 * module is on and in the first group. A module switched off, or moved to
 * another group, is a decision in either shape (024/FR-001).
 */
function atStartingPower(module: SnapshotModuleV1): boolean {
  return (
    (module.enabled === null || module.enabled) &&
    (module.priority === null || module.priority === FIRST_POWER_GROUP)
  );
}

/**
 * Whether a ship carries a name or an ident a Commander gave it.
 *
 * A journal states both on every ship and writes them blank for a ship that has
 * neither, so a blank is an absent name rather than a chosen one — which is how
 * a build's title already reads them.
 */
function named(value: string | null): boolean {
  return value !== null && value.trim() !== '';
}

/**
 * One letter case, because two spellings of one identity are one identity.
 *
 * A hull symbol, a slot key and a module symbol are each unique
 * case-insensitively, and the package says so itself: `getModuleBySymbol`
 * answers every spelling of a symbol it knows with one module. The Anaconda's
 * supplied fit reaches this comparison as `Int_SuperCruiseAssist` and the same
 * module in a build as `Int_SupercruiseAssist`, and both are that one module.
 * `almanac-identity-contract.spec.ts` holds the package to it over every hull.
 *
 * So this compares the identity rather than the spelling, as the rest of the
 * application does wherever it matches identities. Nothing is corrected and
 * nothing is handed back altered: a Commander who opens a hull's default
 * loadout from a link is looking at the build a Commander who created it from
 * the catalogue is looking at, and letter case is not a decision either of them
 * made (024/FR-001).
 */
export function fold(identity: string): string {
  return identity.toLowerCase();
}
