import { writeSync } from 'node:fs';
import { getSlefDiagnosticMessage } from '@elite-dangerous-almanac/core/i18n/diagnostics';
import { getModuleBySymbol } from '@elite-dangerous-almanac/core/ships/modules';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { inspectSlef } from '@elite-dangerous-almanac/core/ships/slef';
import type { LoadoutModule, SlefDiagnostic } from '@elite-dangerous-almanac/core/ships/slef';
import type {
  OwnedShipEngineering,
  OwnedShipModel,
  OwnedShipModule,
} from '../../src/app/domain/commander/fleet/owned-ship';
import { mapOwnedShip } from '../../src/app/domain/commander/fleet/owned-ship';
import { parseRemoteRecord } from '../../src/app/domain/records/remote-record';
import { toBuildSnapshotV1 } from '../../src/app/domain/ships/build/build-snapshot.serializer';

/**
 * The server's only game-model parser, in its two modes (design, decision 8).
 *
 * `records` reads one bounded synchronisation batch through the browser's own
 * record parsers. `journal` reads one bounded batch of candidate Live `Loadout`
 * lines through `inspectSlef`, and returns the package-produced ship model the
 * fleet service stores. Both modes answer on standard output with one JSON
 * object and exit zero, so the caller reads a refusal rather than an exit code.
 */
const mode = process.argv[2] === 'journal' ? 'journal' : 'records';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

let input: unknown;
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  write({ ok: false, code: 'invalid-json', index: null });
  process.exit(0);
}

if (mode === 'journal') {
  projectJournal(input);
} else {
  await validateRecords(input);
}

async function validateRecords(request: unknown): Promise<void> {
  if (!isRecordRequest(request)) {
    write({ ok: false, code: 'invalid-request', index: null });
    process.exit(0);
  }

  for (const [index, record] of request.records.entries()) {
    if (!(await parseRemoteRecord(record)).ok) {
      write({ ok: false, code: 'invalid-record', index });
      process.exit(0);
    }
  }

  write({ ok: true, code: null, index: null });
}

/**
 * One bounded projection batch.
 *
 * Each candidate line goes to `inspectSlef` exactly as the journal wrote it
 * (020/FR-013). What comes back is built into a `ShipLoadout` and captured in
 * the shape local persistence already stores, then read back through
 * `mapOwnedShip` — the same gate the browser applies — so a model that would not
 * reopen is refused here rather than stored (020/FR-016).
 *
 * A refusal names the line and stops the batch: the fleet service keeps its
 * cursor before that line and retries it after a package update.
 */
function projectJournal(request: unknown): void {
  if (!isJournalRequest(request)) {
    write({ ok: false, code: 'invalid-request', index: null });
    process.exit(0);
  }

  const ships: JournalShip[] = [];
  for (const [index, line] of request.lines.entries()) {
    const projected = projectLine(line, request.locale);
    if (!projected.ok) {
      // The ships before the refused line are the batch's accepted prefix. The
      // service commits them and keeps its cursor on the refused line.
      write({ ok: false, code: 'package-refused', index, refusal: projected.refusal, ships });
      process.exit(0);
    }
    ships.push(projected.ship);
  }

  write({ ok: true, code: null, index: null, ships });
}

function projectLine(line: JournalLine, locale: string): LineResult {
  let inspection: ReturnType<typeof inspectSlef>;
  try {
    inspection = inspectSlef(line.text);
  } catch {
    return refused({ code: 'invalidLoadout', constraint: null, path: null, message: null });
  }

  const entry = inspection.entries[0];
  if (entry === undefined || inspection.entries.length !== 1) {
    return refused(diagnostic(inspection.diagnostics[0], locale));
  }

  let loadout: ShipLoadout;
  try {
    loadout = ShipLoadout.fromLoadout(entry.data);
  } catch (error) {
    return refused({
      code: 'invalidLoadout',
      constraint: null,
      path: null,
      message: packageMessage(error),
    });
  }

  const model = ownedShipModel(loadout);
  const substituted = refusedAgainstLine(entry.data.Modules, model);
  if (substituted !== null) {
    return refused(substituted);
  }

  const payload = {
    shipId: line.shipId,
    sourceDate: line.sourceDate,
    sourceLine: line.sourceLine,
    model,
  };
  const mapped = mapOwnedShip(payload);
  if (!mapped.ok) {
    return refused({
      code: mapped.failure,
      constraint: null,
      path: null,
      message: mapped.reason,
    });
  }

  return { ok: true, ship: payload };
}

/**
 * Whether the package fitted every module the line named, where it named it.
 *
 * `ShipLoadout.fromLoadout` is deliberately forgiving: a module identity it
 * cannot place comes back as the hull's own default, which is ordinary build
 * state for a build a Commander is editing and a fabricated fact for a
 * statement about a real ship. An owned ship therefore keeps nothing the line
 * did not state (020/FR-016), and which refusal it is stays a question for the
 * package catalogue rather than for the wording of a message.
 */
function refusedAgainstLine(
  modules: readonly LoadoutModule[],
  model: OwnedShipModel,
): PackageRefusal | null {
  for (const module of modules) {
    const fitted = model.modules.find(
      (candidate) => candidate.slot.toLowerCase() === module.Slot.toLowerCase(),
    );
    if (fitted !== undefined && fitted.symbol.toLowerCase() === module.Item.toLowerCase()) {
      continue;
    }
    return {
      code:
        getModuleBySymbol(module.Item) === null ? 'unknown-identity' : 'unsupported-combination',
      constraint: null,
      path: null,
      message: null,
    };
  }
  return null;
}

/**
 * The stored model, taken from the package's own reading of the line.
 *
 * The snapshot serialiser supplies every field; the roll quality beside a
 * completed grade is the one field 020/FR-015 excludes, so it is dropped here
 * rather than stored and ignored later.
 */
function ownedShipModel(loadout: ShipLoadout): OwnedShipModel {
  const snapshot = toBuildSnapshotV1(loadout);
  const modules: OwnedShipModule[] = snapshot.modules.map((module) => ({
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
    engineering: engineeringOf(module.engineering),
  }));

  return {
    hullSymbol: snapshot.shipSymbol,
    shipName: snapshot.shipName,
    shipIdent: snapshot.shipIdent,
    modules,
  };
}

function engineeringOf(
  engineering: { blueprint: string | null; grade: number; experimental: string | null } | null,
): OwnedShipEngineering | null {
  return engineering === null
    ? null
    : {
        blueprint: engineering.blueprint,
        grade: engineering.grade,
        experimental: engineering.experimental,
      };
}

/**
 * The package's own diagnostic, in the locale the refresh asked for.
 *
 * `getSlefDiagnosticMessage` answers `null` where the package publishes no text
 * for that locale. That absence travels as it is: the structured code and
 * constraint are the package's too, and this application never writes its own
 * translation of a game diagnostic (020/FR-016).
 */
function diagnostic(refusal: SlefDiagnostic | undefined, locale: string): PackageRefusal {
  if (refusal === undefined) {
    return { code: 'invalidLoadout', constraint: null, path: null, message: null };
  }
  return {
    code: refusal.code,
    constraint: refusal.constraint,
    path: refusal.path,
    message: getSlefDiagnosticMessage(refusal, locale),
  };
}

function packageMessage(error: unknown): string | null {
  return error instanceof Error && error.message.length > 0 ? error.message : null;
}

function refused(refusal: PackageRefusal): LineResult {
  return { ok: false, refusal };
}

interface PackageRefusal {
  readonly code: string;
  readonly constraint: string | null;
  readonly path: string | null;
  readonly message: string | null;
}

interface JournalLine {
  readonly shipId: number;
  readonly sourceDate: string;
  readonly sourceLine: number;
  readonly text: string;
}

interface JournalShip {
  readonly shipId: number;
  readonly sourceDate: string;
  readonly sourceLine: number;
  readonly model: OwnedShipModel;
}

type LineResult =
  | { readonly ok: true; readonly ship: JournalShip }
  | { readonly ok: false; readonly refusal: PackageRefusal };

function isRecordRequest(value: unknown): value is { readonly records: readonly unknown[] } {
  if (!isObject(value)) return false;
  return Object.keys(value).length === 1 && Array.isArray(value['records']);
}

function isJournalRequest(
  value: unknown,
): value is { readonly locale: string; readonly lines: readonly JournalLine[] } {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'lines' || keys[1] !== 'locale') return false;
  if (typeof value['locale'] !== 'string' || !Array.isArray(value['lines'])) return false;
  return value['lines'].every(
    (line: unknown) =>
      isObject(line) &&
      typeof line['shipId'] === 'number' &&
      typeof line['sourceDate'] === 'string' &&
      typeof line['sourceLine'] === 'number' &&
      typeof line['text'] === 'string',
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function write(result: {
  readonly ok: boolean;
  readonly code: string | null;
  readonly index: number | null;
  readonly refusal?: PackageRefusal;
  readonly ships?: readonly JournalShip[];
}): void {
  // Written synchronously. `process.exit` follows immediately, and a pipe write
  // that the runtime queued would be lost before it reaches the caller.
  writeSync(1, JSON.stringify(result));
}
