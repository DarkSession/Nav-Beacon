import type { LoadoutIssue } from '@elite-dangerous-almanac/core/ships/loadout-validation';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import {
  BUILD_SNAPSHOT_FORMAT,
  BUILD_SNAPSHOT_VERSION,
  type BuildSnapshotV1,
} from '../../ships/build/build-snapshot';
import { hasExactKeys, isDate, isIndex, isObject } from './fleet-coverage';
import { parseBuildSnapshotV1 } from '../../ships/build/build-snapshot.parser';
import {
  reconstructFromSnapshot,
  substitutedModule,
  unfitIssues,
  type ReconstructionFailure,
} from '../../ships/build/build-snapshot.reconstructor';

/**
 * One owned ship as the fleet service holds it, and the way back to a build.
 *
 * The payload is the package-produced ship model plus the two facts the service
 * adds to it: the Frontier `ShipId` that identifies the ship inside one account,
 * and the journal date-line tuple the model was read from (020/FR-015). There is
 * no name, note, record identity or revision, because an owned ship is not an
 * application record; and there is no calculated value, cargo capacity, hull or
 * module value, rebuy, hot state, fuel, health, ammunition, engineer, blueprint
 * ID, engineering quality or modifier block, because every one of those is
 * either the package's to derive from the model or a field 020/FR-015 excludes.
 *
 * The model is deliberately the shape local persistence already stores, so it
 * travels the reconstruction path a saved build travels — the snapshot parser
 * and `reconstructFromSnapshot` — rather than a second private one. What is
 * different is what a failure may leave behind. A stored build the package
 * defaults a mount on is ordinary build state; an owned ship is a statement
 * about a Commander's real ship, so a model the package does not fit exactly is
 * refused whole and nothing partial or substituted is kept (020/FR-016).
 */
export interface OwnedShipPayload {
  /** Frontier's own ship identity, unique within one Commander account. */
  readonly shipId: number;
  /** The UTC journal date the model was read from, as `YYYY-MM-DD`. */
  readonly sourceDate: string;
  /** The zero-based journal line the model was read from. */
  readonly sourceLine: number;
  readonly model: OwnedShipModel;
}

/** The package-produced ship model, and nothing beside it. */
export interface OwnedShipModel {
  readonly hullSymbol: string;
  readonly shipName: string | null;
  readonly shipIdent: string | null;
  readonly modules: readonly OwnedShipModule[];
}

/** One fitted module of an owned ship. */
export interface OwnedShipModule {
  /** The game's own slot key. */
  readonly slot: string;
  readonly symbol: string;
  /** `null` is an absent field, which the package treats as on. */
  readonly enabled: boolean | null;
  /** The zero-based power-priority group, 0–4, or `null` when absent. */
  readonly priority: number | null;
  readonly preEngineered: OwnedShipPreEngineered | null;
  readonly engineering: OwnedShipEngineering | null;
}

/** The tuple that identifies one pre-engineered article in the package catalogue. */
export interface OwnedShipPreEngineered {
  readonly symbol: string;
  readonly blueprint: string;
  readonly grade: number;
  readonly acquisition: string;
  readonly experimental: string | null;
}

/**
 * The engineering an owned module carries.
 *
 * A completed grade, with no roll quality beside it: an owned ship is a ship a
 * Commander has already engineered, so the roll is finished by the time the
 * journal states it, and 020/FR-015 excludes the quality figure from storage.
 */
export interface OwnedShipEngineering {
  /** The blueprint's `fdname`, or `null` where the engineering names none. */
  readonly blueprint: string | null;
  /** The completed blueprint grade, 1–5. */
  readonly grade: number;
  /** The experimental effect's `fdname`, or `null`. */
  readonly experimental: string | null;
}

/** One owned ship, reconstructed through the package. */
export interface OwnedShip {
  readonly shipId: number;
  readonly sourceDate: string;
  readonly sourceLine: number;
  /**
   * The build itself. Names and derived figures are read from here through the
   * package — `BuildMetrics.of(loadout)` and the package's own catalogues — so
   * this application keeps no second copy of either (design, decision 8).
   */
  readonly loadout: ShipLoadout;
}

/**
 * Why an owned-ship payload did not become a build.
 *
 * `malformed` is the contract gate: the payload is not the owned-ship shape, or
 * carries a field 020/FR-015 excludes. The three reconstruction failures are the
 * package's own answers, carried under its own names.
 * `unsupported-combination` is the fourth: the package built something, but not
 * what the payload named, so what it built is a replacement rather than the
 * Commander's ship.
 */
export type OwnedShipMappingFailure =
  'malformed' | ReconstructionFailure | 'unsupported-combination';

export type OwnedShipMappingResult =
  | { readonly ok: true; readonly ship: OwnedShip }
  | {
      readonly ok: false;
      readonly failure: OwnedShipMappingFailure;
      /**
       * The one issue the package stated about this ship, where this
       * application can show that the package stated it, and `null` everywhere
       * else. The issue travels rather than its English text, because only a
       * caller that knows the reading locale can ask the package for words
       * (020/FR-016, constitution VI).
       */
      readonly stated: LoadoutIssue | null;
      /** The package's structured diagnostics, verbatim, where it published any. */
      readonly issues: readonly LoadoutIssue[];
    };

/**
 * A completed roll, in the figure the package reads.
 *
 * The stored model states a completed grade and no quality (020/FR-015), so
 * reconstruction states the completed roll rather than a figure nobody
 * computed.
 */
const COMPLETED_QUALITY = 1;

const PAYLOAD_KEYS = ['shipId', 'sourceDate', 'sourceLine', 'model'] as const;
const MODEL_KEYS = ['hullSymbol', 'shipName', 'shipIdent', 'modules'] as const;
const MODULE_KEYS = [
  'slot',
  'symbol',
  'enabled',
  'priority',
  'preEngineered',
  'engineering',
] as const;
const PRE_ENGINEERED_KEYS = [
  'symbol',
  'blueprint',
  'grade',
  'acquisition',
  'experimental',
] as const;
const ENGINEERING_KEYS = ['blueprint', 'grade', 'experimental'] as const;

/**
 * Reads one owned-ship payload and rebuilds it through the package.
 *
 * The payload arrives validated, and is read here as untrusted input anyway: a
 * stale cache, another browser tab or a service the package has moved past can
 * all produce something that is JSON and is not a ship. The exact key sets are
 * the boundary — an excluded field does not arrive and get ignored, it refuses
 * the ship — and every value check beyond them belongs to the snapshot parser
 * and the package.
 */
export function mapOwnedShip(value: unknown): OwnedShipMappingResult {
  const payload = parsePayload(value);
  if (!payload.ok) {
    return payload;
  }

  // The snapshot parser and the reconstructor each state a reason, and neither
  // reason can be shown to be the package's: some of those words come from the
  // package and some are written in this repository. The failure code is the
  // answer they are read for, and the words are dropped rather than carried as
  // the package's (020/FR-016).
  const parsed = parseBuildSnapshotV1(payload.snapshot);
  if (!parsed.ok) {
    return refusal('malformed');
  }

  const rebuilt = reconstructFromSnapshot(parsed.snapshot);
  if (!rebuilt.ok) {
    return refusal(rebuilt.failure);
  }

  const refused = refusedFit(parsed.snapshot, rebuilt.loadout);
  if (refused !== null) {
    return refusal(refused.failure, refused.stated, refused.issues);
  }

  return {
    ok: true,
    ship: {
      shipId: payload.shipId,
      sourceDate: payload.sourceDate,
      sourceLine: payload.sourceLine,
      loadout: rebuilt.loadout,
    },
  };
}

type PayloadResult =
  | {
      readonly ok: true;
      readonly shipId: number;
      readonly sourceDate: string;
      readonly sourceLine: number;
      /** The model in the shape the snapshot parser reads, still unchecked. */
      readonly snapshot: unknown;
    }
  | Extract<OwnedShipMappingResult, { readonly ok: false }>;

function parsePayload(value: unknown): PayloadResult {
  if (!isObject(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
    return refusal('malformed');
  }
  if (!isIndex(value['shipId'])) {
    return refusal('malformed');
  }
  if (!isDate(value['sourceDate']) || !isIndex(value['sourceLine'])) {
    return refusal('malformed');
  }

  const model = value['model'];
  if (!isObject(model) || !hasExactKeys(model, MODEL_KEYS) || !Array.isArray(model['modules'])) {
    return refusal('malformed');
  }

  const modules: unknown[] = [];
  for (const entry of model['modules']) {
    if (
      !isObject(entry) ||
      !hasExactKeys(entry, MODULE_KEYS) ||
      !isExactNullableObject(entry['preEngineered'], PRE_ENGINEERED_KEYS) ||
      !isExactNullableObject(entry['engineering'], ENGINEERING_KEYS)
    ) {
      return refusal('malformed');
    }
    modules.push(snapshotModule(entry));
  }

  return {
    ok: true,
    shipId: value['shipId'],
    sourceDate: value['sourceDate'],
    sourceLine: value['sourceLine'],
    snapshot: {
      format: BUILD_SNAPSHOT_FORMAT,
      version: BUILD_SNAPSHOT_VERSION,
      shipSymbol: model['hullSymbol'],
      shipName: model['shipName'],
      shipIdent: model['shipIdent'],
      modules,
    },
  };
}

/** One module, moved into the snapshot shape field by field and checked there. */
function snapshotModule(module: Record<string, unknown>): unknown {
  const engineering = module['engineering'];

  return {
    slot: module['slot'],
    symbol: module['symbol'],
    enabled: module['enabled'],
    priority: module['priority'],
    preEngineered: module['preEngineered'],
    engineering: isObject(engineering)
      ? {
          blueprint: engineering['blueprint'],
          grade: engineering['grade'],
          quality: COMPLETED_QUALITY,
          experimental: engineering['experimental'],
        }
      : engineering,
  };
}

/**
 * Why a model the package did not fit as stated is refused, or `null`.
 *
 * The package answers an unusable mount with the hull default, and leaves a
 * module that belongs nowhere sitting in the slot it was given with a
 * diagnostic against it. Both are ordinary state for a build being edited and
 * neither may become an owned ship, so both questions are asked and a refusal
 * states which one answered.
 *
 * Which refusal a substituted module is, is a question for the package rather
 * than for its prose: a symbol it does not carry is an identity this
 * installation cannot resolve, and one it carries but will not fit here is a
 * combination it does not support. Asking the catalogue keeps the answer the
 * package's, the way the SLEF path asks it whether a hull exists rather than
 * reading the word "hull" out of an exception.
 */
function refusedFit(
  snapshot: BuildSnapshotV1,
  loadout: ShipLoadout,
): {
  readonly failure: OwnedShipMappingFailure;
  readonly stated: LoadoutIssue | null;
  readonly issues: readonly LoadoutIssue[];
} | null {
  const issues = unfitIssues(loadout);
  const substituted = substitutedModule(snapshot, loadout);

  if (substituted !== null) {
    // A substitution is this application's own finding: the package fitted a
    // build and said nothing about it. The failure names which finding it is,
    // and the package stated nothing, because there are no package words to
    // carry.
    return getModuleBySymbol(substituted.symbol) === null
      ? { failure: 'unknown-identity', stated: null, issues }
      : { failure: 'unsupported-combination', stated: null, issues };
  }

  const stated = issues[0];
  return stated === undefined ? null : { failure: 'unsupported-combination', stated, issues };
}

function refusal(
  failure: OwnedShipMappingFailure,
  stated: LoadoutIssue | null = null,
  issues: readonly LoadoutIssue[] = [],
): Extract<OwnedShipMappingResult, { readonly ok: false }> {
  return { ok: false, failure, stated, issues };
}

function isExactNullableObject(value: unknown, keys: readonly string[]): boolean {
  return value === null || (isObject(value) && hasExactKeys(value, keys));
}
