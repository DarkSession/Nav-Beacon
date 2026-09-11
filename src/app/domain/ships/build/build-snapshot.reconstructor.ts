import {
  PRE_ENGINEERED_MODULES,
  type PreEngineeredVariant,
} from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { getPreEngineeredJournalModifiers } from '@elite-dangerous-almanac/core/ships/pre-engineered-stats';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { getShipBySymbol } from '@elite-dangerous-almanac/core/ships/ships';
import type {
  LoadoutEvent,
  LoadoutModule,
  ModuleEngineering,
} from '@elite-dangerous-almanac/core/ships/slef';
import type { BuildSnapshotV1, PreEngineeredIdentityV1, SnapshotModuleV1 } from './build-snapshot';

/** Why a snapshot could not become a live build. */
export type ReconstructionFailure = 'unknown-hull' | 'unknown-identity' | 'refused';

export type ReconstructionResult =
  | { readonly ok: true; readonly loadout: ShipLoadout }
  | { readonly ok: false; readonly failure: ReconstructionFailure; readonly reason: string };

/**
 * Rebuilds a live build from a stored snapshot, through the package.
 *
 * The package owns every rule here. It refuses a hull it does not carry, it
 * refuses a module identity it cannot resolve, and — the property this whole
 * path depends on — it returns every fixed mount populated with that hull's
 * default whenever the snapshot's own entry is absent or unusable. There is no
 * repair pass in this application and no "the armour was missing" provenance:
 * the package's answer is the build, and a defaulted mount is ordinary build
 * state from the moment it arrives (FR-014, constitution II).
 *
 * The hull is looked up before construction for two reasons: so a refusal can
 * name what was wrong — the package would refuse it too — and so the build is
 * reconstructed on the package's own symbol rather than the one the snapshot
 * happens to spell it with.
 */
export function reconstructFromSnapshot(snapshot: BuildSnapshotV1): ReconstructionResult {
  const hull = getShipBySymbol(snapshot.shipSymbol);
  if (hull === null) {
    return {
      ok: false,
      failure: 'unknown-hull',
      reason: `This installation carries no hull "${snapshot.shipSymbol}".`,
    };
  }

  const modules: LoadoutModule[] = [];
  for (const module of snapshot.modules) {
    const built = loadoutModule(module);
    if (!built.ok) {
      return built;
    }
    modules.push(built.value);
  }

  const event: LoadoutEvent = {
    event: 'Loadout',
    // The package's own symbol for the hull, not the string the snapshot spells
    // it with. A record written before the ingress gate resolved the identity
    // carries a journal-cased hull — `sidewinder` for `SideWinder` —
    // and every asset this application serves is a directory named the
    // package's way, so reopening one would draw no schematics. Reconstruction
    // is where such a record gets its identity back (constitution II).
    Ship: hull.symbol,
    ...(snapshot.shipName === null ? {} : { ShipName: snapshot.shipName }),
    ...(snapshot.shipIdent === null ? {} : { ShipIdent: snapshot.shipIdent }),
    Modules: modules,
  };

  let loadout: ShipLoadout;
  try {
    loadout = ShipLoadout.fromLoadout(event);
  } catch (error) {
    return { ok: false, failure: 'refused', reason: reasonOf(error) };
  }

  // Ordinary engineering is applied after construction, because the package
  // re-derives its modifiers from the blueprint and grade rather than taking a
  // stored copy of them.
  for (const module of snapshot.modules) {
    const engineering = module.engineering;
    if (engineering === null || engineering.blueprint === null) {
      continue;
    }
    try {
      loadout.applyBlueprint(module.slot, engineering.blueprint, {
        grade: engineering.grade,
        quality: engineering.quality,
        ...(engineering.experimental === null
          ? {}
          : { experimentalEffectSymbol: engineering.experimental }),
      });
    } catch (error) {
      return { ok: false, failure: 'unknown-identity', reason: reasonOf(error) };
    }
  }

  return { ok: true, loadout };
}

/**
 * Whether the package fitted every module the snapshot named, where it named it.
 *
 * Reconstruction is deliberately forgiving: the package populates a fixed mount
 * from the hull default whenever the stored entry is absent or does not belong
 * there, and for a build a Commander is editing that default is ordinary build
 * state. A boundary that may keep nothing it did not receive needs the opposite
 * answer, so this asks the package two questions and takes both verbatim — does
 * it call any slot unknown or any module incompatible, and does every stored
 * identity come back fitted where it was stored. A substituted default fails the
 * second question and is the whole reason this check exists.
 */
export function fittedAsStored(snapshot: BuildSnapshotV1, loadout: ShipLoadout): boolean {
  if (
    loadout
      .validation()
      .issues.some((issue) => issue.code === 'unknownSlot' || issue.code === 'incompatibleModule')
  ) {
    return false;
  }
  return snapshot.modules.every((module) => {
    const fitted = loadout.fittedModuleAt(module.slot);
    return fitted !== null && fitted.symbol.toLowerCase() === module.symbol.toLowerCase();
  });
}

type ModuleResult =
  | { readonly ok: true; readonly value: LoadoutModule }
  | { readonly ok: false; readonly failure: ReconstructionFailure; readonly reason: string };

function loadoutModule(module: SnapshotModuleV1): ModuleResult {
  const engineering = preEngineeredEngineering(module.preEngineered);
  if (engineering !== null && !engineering.ok) {
    return engineering;
  }

  return {
    ok: true,
    value: {
      Slot: module.slot,
      Item: module.symbol,
      ...(module.enabled === null ? {} : { On: module.enabled }),
      ...(module.priority === null ? {} : { Priority: module.priority }),
      ...(engineering === null ? {} : { Engineering: engineering.value }),
    },
  };
}

type EngineeringResult =
  | { readonly ok: true; readonly value: ModuleEngineering }
  | { readonly ok: false; readonly failure: ReconstructionFailure; readonly reason: string };

/**
 * Rebuilds the engineering block a pre-engineered article arrives with.
 *
 * The stored form is an identity; this is where the package turns it back into
 * state, republishing the article's own grade and its modifier block. That is
 * what makes the identity sufficient: a reward article is recognised from its
 * modifiers, so writing the modifiers ourselves would only be a chance to write
 * them differently from the package that defines them.
 */
function preEngineeredEngineering(
  identity: PreEngineeredIdentityV1 | null,
): EngineeringResult | null {
  if (identity === null) {
    return null;
  }

  const variant = findVariant(identity);
  if (variant === null) {
    return {
      ok: false,
      failure: 'unknown-identity',
      reason: `This installation carries no pre-engineered "${identity.symbol}" article matching this identity.`,
    };
  }

  const experimental = identity.experimental ?? undefined;
  const resolved = {
    ...variant,
    ...(experimental === undefined
      ? { experimentalEffectSymbol: undefined }
      : { experimentalEffectSymbol: experimental }),
  } as PreEngineeredVariant;
  const modifiers = getPreEngineeredJournalModifiers(resolved);

  return {
    ok: true,
    value: {
      BlueprintName: variant.blueprintSymbol,
      Level: variant.grade,
      Quality: 1,
      ...(experimental === undefined ? {} : { ExperimentalEffect: experimental }),
      ...(modifiers.length === 0 ? {} : { Modifiers: modifiers }),
    },
  };
}

function findVariant(identity: PreEngineeredIdentityV1): PreEngineeredVariant | null {
  return (
    PRE_ENGINEERED_MODULES.find(
      (candidate) =>
        candidate.symbol.toLowerCase() === identity.symbol.toLowerCase() &&
        candidate.blueprintSymbol.toLowerCase() === identity.blueprint.toLowerCase() &&
        candidate.grade === identity.grade &&
        candidate.acquisition === identity.acquisition,
    ) ?? null
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
