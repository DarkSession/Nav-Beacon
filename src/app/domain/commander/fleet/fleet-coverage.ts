/**
 * The part of the fleet contract this browser keeps, and the rules it is read
 * under.
 *
 * The coverage block is the one piece of a fleet answer that outlives the
 * answer: the browser's fleet cache stores it and reads it back on a later
 * visit. It is read here under the same rule both times, rather than a looser
 * second one, so a cached block and a fresh one mean the same thing
 * (020/FR-015, 020/FR-022).
 *
 * It sits apart from `fleet-answer` because the cache is reached on every page
 * and the answer's own reader is not: the fleet is a layer a Commander opens.
 * `fleet-answer` reads the rest of the envelope under these same rules.
 */

/** What the owned fleet is, as the service states it. */
export type FleetResult =
  /** Stored, confirmed complete by the last comparison, nothing pending. */
  | 'current'
  /** No accepted `Loadout` yet, so the fleet is empty. */
  | 'empty'
  /** Stored, and journal coverage cannot confirm that this is the whole fleet. */
  | 'incomplete'
  /** Frontier or another refresh of this account holds the next attempt. */
  | 'waiting'
  /** The refresh stopped on a failure, and the last accepted fleet still stands. */
  | 'failed'
  /** Frontier authorisation is gone, so a fresh sign-in comes first. */
  | 'authorisation-expired';

/** The last `StoredShips` comparison, as the service holds it. */
export interface StoredShipsComparison {
  readonly date: string;
  readonly line: number;
  /** `true` when every ship Frontier listed has an accepted projection. */
  readonly complete: boolean;
}

/** How far the account's journal coverage reaches. */
export interface FleetCoverage {
  /** The first date coverage reaches: 14 days before the first refresh. */
  readonly startDate: string;
  readonly cursorDate: string;
  readonly cursorLine: number;
  readonly storedShips: StoredShipsComparison | null;
  /** The earliest instant a refresh will ask Frontier again, or `null`. */
  readonly nextPermittedRefreshAt: string | null;
}

const COVERAGE_KEYS = [
  'startDate',
  'cursorDate',
  'cursorLine',
  'storedShips',
  'nextPermittedRefreshAt',
];
const STORED_SHIPS_KEYS = ['date', 'line', 'complete'];

/**
 * Reads the coverage block.
 *
 * `undefined` means the field did not read; `null` is the published absence.
 */
export function parseFleetCoverage(value: unknown): FleetCoverage | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObject(value) || !hasExactKeys(value, COVERAGE_KEYS)) {
    return undefined;
  }
  const startDate = value['startDate'];
  const cursorDate = value['cursorDate'];
  const cursorLine = value['cursorLine'];
  const nextPermittedRefreshAt = value['nextPermittedRefreshAt'];
  if (!isDate(startDate) || !isDate(cursorDate) || !isIndex(cursorLine)) {
    return undefined;
  }
  if (nextPermittedRefreshAt !== null && !isInstant(nextPermittedRefreshAt)) {
    return undefined;
  }
  const storedShips = parseStoredShips(value['storedShips']);
  if (storedShips === undefined) {
    return undefined;
  }
  return { startDate, cursorDate, cursorLine, storedShips, nextPermittedRefreshAt };
}

function parseStoredShips(value: unknown): StoredShipsComparison | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObject(value) || !hasExactKeys(value, STORED_SHIPS_KEYS)) {
    return undefined;
  }
  const date = value['date'];
  const line = value['line'];
  const complete = value['complete'];
  if (!isDate(date) || !isIndex(line) || typeof complete !== 'boolean') {
    return undefined;
  }
  return { date, line, complete };
}

export function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A UTC calendar date, in the spelling a journal cursor uses. */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

/** A UTC instant, in the spelling the session contract uses. */
export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
