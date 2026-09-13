import type { FittedModule, ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  BUILD_SNAPSHOT_FORMAT,
  BUILD_SNAPSHOT_VERSION,
  type BuildSnapshotV1,
  type EngineeringSnapshotV1,
  type PreEngineeredIdentityV1,
  type SnapshotModuleV1,
} from './build-snapshot';

/**
 * Captures a live build's modelled state.
 *
 * Read from the `ShipLoadout` getters rather than from `toLoadoutEvent()`,
 * which is a capture format: it lower-cases identities and adds recomputed
 * derived fields, and both would make a stored build disagree with the one the
 * Commander is editing (research, "Lossless build snapshot").
 *
 * Slot order is the package's own, taken from `slots()`, so a stored build and
 * a live one enumerate their modules the same way and a diff between two
 * snapshots is a diff of decisions rather than of ordering.
 */
export function toBuildSnapshotV1(loadout: ShipLoadout): BuildSnapshotV1 {
  const modules: SnapshotModuleV1[] = [];

  for (const slot of loadout.slots()) {
    const module = slot.module;
    if (module !== null) {
      modules.push(snapshotModule(slot.key, module));
    }
  }

  return {
    format: BUILD_SNAPSHOT_FORMAT,
    version: BUILD_SNAPSHOT_VERSION,
    shipSymbol: loadout.shipSymbol,
    shipName: loadout.shipName,
    shipIdent: loadout.shipIdent,
    modules,
  };
}

/**
 * One snapshot, rebuilt field by field.
 *
 * An allowlist rather than a spread, wherever a snapshot crosses a boundary. A
 * caller can hold an object that reconstructs a build *and* carries a
 * calculated figure beside it, and a spread would carry the figure with it.
 * Adding a field here is a decision someone has to make on purpose (persistence
 * contract, "Boundary exclusions").
 */
export function copyBuildSnapshotV1(build: BuildSnapshotV1): BuildSnapshotV1 {
  return {
    format: BUILD_SNAPSHOT_FORMAT,
    version: BUILD_SNAPSHOT_VERSION,
    shipSymbol: build.shipSymbol,
    shipName: build.shipName,
    shipIdent: build.shipIdent,
    modules: build.modules.map((module) => ({
      slot: module.slot,
      symbol: module.symbol,
      enabled: module.enabled,
      priority: module.priority,
      preEngineered:
        module.preEngineered === null
          ? null
          : {
              symbol: module.preEngineered.symbol,
              blueprint: module.preEngineered.blueprint,
              grade: module.preEngineered.grade,
              acquisition: module.preEngineered.acquisition,
              experimental: module.preEngineered.experimental,
            },
      engineering:
        module.engineering === null
          ? null
          : {
              blueprint: module.engineering.blueprint,
              grade: module.engineering.grade,
              quality: module.engineering.quality,
              experimental: module.engineering.experimental,
            },
    })),
  };
}

function snapshotModule(slotKey: string, module: FittedModule): SnapshotModuleV1 {
  const preEngineered = snapshotPreEngineered(module);

  return {
    slot: slotKey,
    symbol: module.symbol,
    // `undefined` is "the field was absent"; `false` is a decision. Collapsing
    // them would silently repower a module the Commander switched off.
    enabled: module.on ?? null,
    priority: module.priority ?? null,
    preEngineered,
    engineering: snapshotEngineering(module, preEngineered),
  };
}

function snapshotPreEngineered(module: FittedModule): PreEngineeredIdentityV1 | null {
  const variant = module.preEngineeredVariant;
  if (variant === null) {
    return null;
  }

  return {
    symbol: variant.symbol,
    blueprint: variant.blueprintSymbol,
    grade: variant.grade,
    acquisition: variant.acquisition,
    // The effect the article carries *now*, not the one it was published with.
    //
    // A re-engineerable reward keeps its identity when a Commander changes only
    // its experimental effect, so the pair "this article, that effect" is the
    // thing to record. Storing the published effect instead loses the change,
    // and recording the difference as ordinary engineering on top loses more
    // than that: rebuilding rolls the reward's blueprint as an ordinary recipe
    // and the hand-set modifier block and the `preEngineeredVariant` identity
    // both disappear — measured, on the tech-broker drive, as six package
    // modifiers becoming five and `techBroker` becoming `null` (FR-012).
    //
    // The reconstructor already composes exactly this: it hands the identity's
    // effect to the package beside the article and lets the package rebuild the
    // fixed block around it.
    experimental: module.engineering?.ExperimentalEffect ?? null,
  };
}

/**
 * The ordinary engineering a module carries beyond its pre-engineered identity.
 *
 * A pre-engineered article already implies a blueprint and a grade, and the
 * identity tuple carries the effect it is currently wearing, so the package
 * republishes all three. Recording them a second time would be a second copy of
 * the same fact — and the two could disagree after a package update. So an
 * engineering block that says exactly what the identity already says is
 * recorded as absent, and anything further — a Mercenary article crafted up a
 * grade, whose blueprint and grade no longer describe the purchase — is
 * recorded as ordinary engineering on top.
 */
function snapshotEngineering(
  module: FittedModule,
  preEngineered: PreEngineeredIdentityV1 | null,
): EngineeringSnapshotV1 | null {
  const engineering = module.engineering;
  if (engineering === undefined) {
    return null;
  }

  const experimental = engineering.ExperimentalEffect ?? null;

  if (preEngineered !== null && describesVariant(engineering, preEngineered)) {
    return null;
  }

  return {
    blueprint: engineering.BlueprintName ?? null,
    grade: engineering.Level,
    quality: engineering.Quality,
    experimental,
  };
}

function describesVariant(
  engineering: { BlueprintName?: string; Level: number },
  variant: PreEngineeredIdentityV1,
): boolean {
  // The effect is not compared, because the identity was built from the fitted
  // module's own effect a moment ago and would always agree with itself. What
  // is left is the question that matters: does this engineering still describe
  // the article that was bought, or has it been crafted past it?
  return (
    sameIdentity(engineering.BlueprintName ?? null, variant.blueprint) &&
    engineering.Level === variant.grade
  );
}

/** Package identities are compared case-insensitively, the way the package matches them. */
function sameIdentity(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.toLowerCase() === right.toLowerCase();
}
