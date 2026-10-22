import type {
  BuildSlot,
  CoreSlotType,
  OptionalRestriction,
} from '@elite-dangerous-almanac/core/ships/slots';

/**
 * One chip in a slot group: a mount size, and how many mounts of it there are.
 *
 * The reference draws a hull's unrestricted optional mounts as `7`, `3 × 6`,
 * `3 × 5`, `2 × 4`, `3`, `2`, `1` rather than as twelve chips, so a run of equal
 * sizes is one chip carrying its own count. A run of one carries no count: `× 1`
 * beside a figure says nothing the figure did not.
 */
export interface SlotSizeRun {
  readonly size: number;
  readonly count: number;
}

/**
 * One core mount: which of the seven it is, how big it is, and the package's
 * own descriptor for it — which is what names it, since the name is game text
 * and belongs to the package rather than to a table here.
 */
export interface CoreMount {
  readonly core: CoreSlotType;
  readonly size: number;
  readonly slot: BuildSlot;
}

/** The mounts one restriction holds, and which restriction it is. */
export interface RestrictedMounts {
  readonly restriction: OptionalRestriction;
  readonly sizes: readonly SlotSizeRun[];
  readonly count: number;
}

/**
 * What a hull can carry, as the shipyard states it.
 *
 * Every figure is the package's own layout for the hull. Nothing here is
 * counted from a build: this is the hull's capacity, and what a Commander has
 * put in it is the outfitting ledger's reading (feature 002).
 *
 * The optional mounts are partitioned rather than counted twice. `optional`
 * holds the mounts that take anything that fits; `restricted` holds the ones
 * that take one family, each entry carrying its own count. A mount appears in
 * exactly one of them, so the counts add up to the hull's optional column.
 *
 * Every restriction the package publishes is reported. Which of them a screen
 * states is the screen's own question: hull detail leaves the planetary
 * approach mount out (001/FR-022), and that is decided where the screen's view
 * is assembled, not here.
 */
export interface HullCapacity {
  /** How many tiny utility mounts. Every one is the same size, so there is no run. */
  readonly utility: number;
  /** The seven core mounts, in the package's own order. */
  readonly core: readonly CoreMount[];
  /** The optional mounts that take any module of their kind, grouped by size. */
  readonly optional: readonly SlotSizeRun[];
  /** How many unrestricted optional mounts, which is not how many runs there are. */
  readonly optionalCount: number;
  /**
   * The restricted optional mounts, one entry per restriction the hull has.
   *
   * Every hull the installed package publishes carries at least one — the
   * planetary approach suite's own mount — and twenty carry two or three. The
   * list is still allowed to be empty: a hull that restricted nothing would
   * have nothing to say here.
   */
  readonly restricted: readonly RestrictedMounts[];
}

/**
 * The hull's capacity, read off the package's own enumerated mounts.
 *
 * The mounts arrive as the package enumerated them and are read by `kind`,
 * `core` and `restriction` rather than by position — the same rule the rest of
 * this application follows about package identities.
 */
export function hullCapacity(slots: readonly BuildSlot[]): HullCapacity {
  const core: CoreMount[] = [];
  const optionalSizes: number[] = [];
  const restrictedSizes = new Map<OptionalRestriction, number[]>();
  let utility = 0;

  for (const slot of slots) {
    if (slot.kind === 'utility') {
      utility += 1;
      continue;
    }
    if (slot.kind === 'core') {
      core.push({ core: slot.core, size: slot.size, slot });
      continue;
    }
    if (slot.kind !== 'optional') {
      continue;
    }
    if (slot.restriction === undefined) {
      optionalSizes.push(slot.size);
      continue;
    }
    const sizes = restrictedSizes.get(slot.restriction) ?? [];
    sizes.push(slot.size);
    restrictedSizes.set(slot.restriction, sizes);
  }

  const restricted = [...restrictedSizes].map(([restriction, sizes]) => ({
    restriction,
    sizes: groupBySize(sizes),
    count: sizes.length,
  }));

  return {
    utility,
    core,
    optional: groupBySize(optionalSizes),
    optionalCount: optionalSizes.length,
    restricted,
  };
}

/**
 * Sizes into the reference's chips: largest first, equal sizes in one run.
 *
 * The package already publishes a hull's optional mounts largest first, so the
 * sort is ordinarily a no-op. It is done anyway, because the grouping is only
 * correct on a sorted list — a release that published them in another order
 * would otherwise draw the same size as two separate chips rather than as one
 * run of two.
 */
function groupBySize(sizes: readonly number[]): readonly SlotSizeRun[] {
  const runs: SlotSizeRun[] = [];
  for (const size of [...sizes].sort((left, right) => right - left)) {
    const last = runs.at(-1);
    if (last !== undefined && last.size === size) {
      runs[runs.length - 1] = { size, count: last.count + 1 };
      continue;
    }
    runs.push({ size, count: 1 });
  }
  return runs;
}
