/**
 * The wire contract of `GET api/fleet` and `POST api/fleet/refresh`.
 *
 * Both addresses answer with one object of this shape, so one reader covers
 * them. Every field is always present and an absent value is `null`, which is
 * what makes a half-read answer detectable: a body missing a field is refused
 * whole rather than read as an absence.
 *
 * `GET api/fleet` reads stored state only, so it answers `current`, `empty` or
 * `incomplete` with nothing pending, no failure and no package refusal. The
 * other three results and every failure belong to a refresh.
 *
 * Nothing here is a calculated value, a hull or module name, a price, a hot
 * state or a raw journal event: the model is the package-produced ship model
 * and the two facts the service adds to it (020/FR-015).
 */

import {
  hasExactKeys,
  isObject,
  parseFleetCoverage,
  type FleetCoverage,
  type FleetResult,
} from './fleet-coverage';

// The coverage block, what it holds and the shape rules both readers work
// under live in `fleet-coverage`, because the browser's fleet cache reads that
// block back on every page and must not carry this reader with it. The types
// are published again here so that one import states the whole contract. The
// reader is not: taking it from here would put this module back on every page,
// which is the thing the split undoes.
export type { FleetCoverage, FleetResult, StoredShipsComparison } from './fleet-coverage';

/** Why a refresh stopped. Always with `result: "failed"`. */
export type FleetFailure =
  | 'frontier-unavailable'
  | 'response-too-large'
  | 'line-too-large'
  | 'line-malformed'
  | 'package-refused'
  | 'projection-unavailable';

/**
 * The package's own answer to a candidate `Loadout` it refused.
 *
 * Carried verbatim and never stored: the same `GET api/fleet` afterwards
 * answers `null` here. `message` is the package's text for the locale the
 * refresh asked in, and `null` where the package publishes none — which is
 * every locale but English today (020/FR-016).
 */
export interface PackageRefusal {
  readonly code: string;
  readonly constraint: string | null;
  readonly path: string | null;
  readonly message: string | null;
}

/**
 * One answer, read.
 *
 * `ships` holds the owned-ship payloads unchanged. They are handed to
 * `mapOwnedShip`, which is the one path from a payload to a build, rather than
 * being rebuilt here: this reader's job is the envelope.
 */
export interface FleetAnswer {
  readonly result: FleetResult;
  readonly ships: readonly unknown[];
  readonly coverage: FleetCoverage | null;
  /** `true` while journal is left to read before the fleet is current. */
  readonly pending: boolean;
  readonly failure: FleetFailure | null;
  readonly packageRefusal: PackageRefusal | null;
}

/** The stable application error codes a fleet refusal carries. */
export type FleetErrorCode =
  | 'unauthorised'
  | 'invalid-anti-forgery'
  | 'fleet-unavailable'
  /** Anything this browser could not read as one of the published codes. */
  | 'unknown';

/**
 * What one request to either fleet address produced.
 *
 * `unavailable` is the answer that never arrived and the answer this browser
 * could not read. Both mean the same thing to every caller: nothing was
 * confirmed, so nothing may be claimed (020/FR-022).
 */
export type FleetResponse =
  | { readonly kind: 'answered'; readonly answer: FleetAnswer }
  | { readonly kind: 'refused'; readonly status: number; readonly code: FleetErrorCode }
  | { readonly kind: 'unavailable' };

const RESULTS: readonly FleetResult[] = [
  'current',
  'empty',
  'incomplete',
  'waiting',
  'failed',
  'authorisation-expired',
];

const FAILURES: readonly FleetFailure[] = [
  'frontier-unavailable',
  'response-too-large',
  'line-too-large',
  'line-malformed',
  'package-refused',
  'projection-unavailable',
];

const ERROR_CODES: readonly FleetErrorCode[] = [
  'unauthorised',
  'invalid-anti-forgery',
  'fleet-unavailable',
];

const ANSWER_KEYS = ['result', 'ships', 'coverage', 'pending', 'failure', 'packageRefusal'];
const REFUSAL_KEYS = ['code', 'constraint', 'path', 'message'];

/**
 * Reads one 200 body, or `null` where it is not one.
 *
 * The exact key set is the boundary. A body carrying a field this contract does
 * not publish is refused rather than read past, because a fleet is a statement
 * about a Commander's real ships and a field nobody agreed on is not part of it.
 */
export function parseFleetAnswer(value: unknown): FleetAnswer | null {
  if (!isObject(value) || !hasExactKeys(value, ANSWER_KEYS)) {
    return null;
  }
  const result = value['result'];
  const ships = value['ships'];
  const pending = value['pending'];
  if (!isResult(result) || !Array.isArray(ships) || typeof pending !== 'boolean') {
    return null;
  }

  const failure = value['failure'];
  if (failure !== null && !isFailure(failure)) {
    return null;
  }
  const coverage = parseFleetCoverage(value['coverage']);
  const refusal = parseRefusal(value['packageRefusal']);
  if (coverage === undefined || refusal === undefined) {
    return null;
  }

  return {
    result,
    ships: [...(ships as readonly unknown[])],
    coverage,
    pending,
    failure,
    packageRefusal: refusal,
  };
}

/** Reads one Problem Details body into the code it names. */
export function parseFleetRefusal(status: number, value: unknown): FleetResponse {
  const code = isObject(value) ? value['code'] : null;
  return {
    kind: 'refused',
    status,
    code: ERROR_CODES.find((known) => known === code) ?? 'unknown',
  };
}

function parseRefusal(value: unknown): PackageRefusal | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObject(value) || !hasExactKeys(value, REFUSAL_KEYS)) {
    return undefined;
  }
  const code = value['code'];
  const constraint = value['constraint'];
  const path = value['path'];
  const message = value['message'];
  if (typeof code !== 'string' || code.length === 0) {
    return undefined;
  }
  if (!isNullableText(constraint) || !isNullableText(path) || !isNullableText(message)) {
    return undefined;
  }
  return { code, constraint, path, message };
}

function isResult(value: unknown): value is FleetResult {
  return RESULTS.some((known) => known === value);
}

function isFailure(value: unknown): value is FleetFailure {
  return FAILURES.some((known) => known === value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
