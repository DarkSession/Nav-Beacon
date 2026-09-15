import type { EquipmentLoadout } from '../loadout-link/equipment-loadout';
import { newLoadout } from './loadout-edit';
import { loadoutFingerprint } from './loadout-fingerprint';

/**
 * Whether a loadout is still the one the bench starts for its suit.
 *
 * A loadout in this state holds nothing a Commander decided: the suit at the
 * lowest grade the package publishes for it, no weapon on any mount and no
 * modification fitted. It is reached again by choosing the suit, so it is worth
 * no record (024/FR-002).
 *
 * Asked of the loadout alone, as the ship tool's answer is asked of a build
 * alone. A default loadout reaches the bench by a suit chosen at the gate, by a
 * link and by a journal event, and all three get this answer.
 *
 * The starting loadout is `newLoadout`'s, which is the one the store itself
 * starts. Rebuilding it here from the suit catalogue would be a second copy of
 * that rule, free to drift away from the loadout a Commander is actually given.
 */
export function atSuitDefault(loadout: EquipmentLoadout): boolean {
  const fingerprint = defaultFingerprint(loadout.suitFamily);
  return fingerprint !== null && loadoutFingerprint(loadout) === fingerprint;
}

/**
 * The fingerprint of a suit family's starting loadout, built once per family.
 *
 * The question is asked on every revision of a loadout that holds no record,
 * and the answer moves only when the installed package does. A family this
 * release publishes no suit for has no starting loadout, and is answered as
 * not at a default rather than memoised as nothing.
 */
const defaults = new Map<string, string>();

function defaultFingerprint(suitFamily: string): string | null {
  const known = defaults.get(suitFamily);
  if (known !== undefined) {
    return known;
  }

  const started = newLoadout(suitFamily);
  if (started === null) {
    return null;
  }

  const fingerprint = loadoutFingerprint(started);
  defaults.set(suitFamily, fingerprint);
  return fingerprint;
}
