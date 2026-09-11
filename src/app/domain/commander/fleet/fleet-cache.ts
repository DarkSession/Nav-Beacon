import { parseFleetCoverage, type FleetCoverage, type FleetResult } from './fleet-answer';

/**
 * The last accepted owned fleet, as this browser keeps it between visits.
 *
 * A Commander who loads the application once and then goes offline can still
 * read the fleet they already have; only the refresh needs a network, and it
 * says so rather than emptying the list (020/FR-022, 015/FR-013).
 *
 * One entry per Frontier Customer ID, for the same reason the account cursors
 * are keyed that way: two Commanders sharing a browser never read each other's
 * ships. The entry goes when the session does, and again when the account is
 * deleted (`CommanderStateRepository`).
 *
 * Only a settled answer is cached. `waiting`, `failed` and
 * `authorisation-expired` all leave the fleet this browser already accepted
 * exactly where it is, which is what makes a failed refresh harmless
 * (020/FR-018).
 */
export type SettledFleetResult = Extract<FleetResult, 'current' | 'empty' | 'incomplete'>;

export interface CachedFleet {
  readonly customerId: string;
  /** When this browser accepted the answer, so a reader can be told how old it is. */
  readonly acceptedAt: string;
  readonly result: SettledFleetResult;
  /**
   * The owned-ship payloads, unchanged.
   *
   * Stored rather than the builds they become: `mapOwnedShip` reads a payload
   * as untrusted input every time, so a package update changes what this cache
   * resolves to without the cache having to be rewritten — and a ship the
   * installed package can no longer resolve is refused on reading rather than
   * kept as something it is not (020/FR-016).
   */
  readonly ships: readonly unknown[];
  readonly coverage: FleetCoverage | null;
}

const SETTLED: readonly SettledFleetResult[] = ['current', 'empty', 'incomplete'];

const CACHE_KEYS = ['customerId', 'acceptedAt', 'result', 'ships', 'coverage'];

/** Whether a result is one this browser may cache. */
export function isSettledFleetResult(value: FleetResult): value is SettledFleetResult {
  return SETTLED.some((known) => known === value);
}

/**
 * Reads the stored cache, dropping what does not read.
 *
 * An entry that cannot be read is dropped on its own rather than refusing the
 * whole account state. The fleet is the one part of that value this browser can
 * ask for again — every other part decides which account a record belongs to,
 * and a half-read one of those is refused whole.
 */
export function parseFleetCache(value: unknown): readonly CachedFleet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cached: CachedFleet[] = [];
  for (const entry of value) {
    const read = parseEntry(entry);
    if (read !== null && !cached.some((held) => held.customerId === read.customerId)) {
      cached.push(read);
    }
  }
  return cached;
}

/** The fleet held for one Commander, or `null` where none is held. */
export function cachedFleetFor(
  cache: readonly CachedFleet[],
  customerId: string,
): CachedFleet | null {
  return cache.find((entry) => entry.customerId === customerId) ?? null;
}

/** Replaces the entry for one Commander, leaving every other account's alone. */
export function withFleetCached(
  cache: readonly CachedFleet[],
  fleet: CachedFleet,
): readonly CachedFleet[] {
  return [...cache.filter((entry) => entry.customerId !== fleet.customerId), fleet];
}

function parseEntry(value: unknown): CachedFleet | null {
  if (!isObject(value) || !hasExactKeys(value, CACHE_KEYS)) {
    return null;
  }
  const customerId = value['customerId'];
  const acceptedAt = value['acceptedAt'];
  const result = value['result'];
  const ships = value['ships'];
  if (typeof customerId !== 'string' || !/^[1-9]\d*$/.test(customerId)) {
    return null;
  }
  if (typeof acceptedAt !== 'string' || Number.isNaN(Date.parse(acceptedAt))) {
    return null;
  }
  if (!SETTLED.some((known) => known === result) || !Array.isArray(ships)) {
    return null;
  }
  if (!ships.every((ship) => isObject(ship))) {
    return null;
  }
  const coverage = parseFleetCoverage(value['coverage']);
  if (coverage === undefined) {
    return null;
  }
  return {
    customerId,
    acceptedAt,
    result: result as SettledFleetResult,
    ships: [...(ships as readonly unknown[])],
    coverage,
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
