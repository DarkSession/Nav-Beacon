import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The widest bounded symbol the packed writer accepts, and so the codec's structural ceiling. */
export const CODEC_SYMBOL_BITS = 31;

/**
 * The growth each codec-table dimension is budgeted for.
 *
 * No dimension is capped by the codec itself: every width is derived from the table it is
 * generated with, and the binary layout keeps working until a bounded symbol would need more
 * than 31 bits — around 2^31 entries everywhere. What a larger table does change is the size
 * of every link, and links are bounded by the 500-character envelope. These limits are the
 * table sizes the string budget in `docs/ship-link-codec.md` is sized against, so exceeding
 * one is a deliberate re-budgeting decision rather than a routine regeneration: raise the
 * limit, re-check the budget, and mint the next table version.
 */
export const CODEC_TABLE_CAPACITY = Object.freeze({
  /** Hull index and the combined representation tag, `ceil(log2(h + 1))` bits: eight at 128. */
  SHIPS: 128,
  /** Global module index, used only where a module is absent from its slot's candidates. */
  MODULES: 2_048,
  /** Global blueprint index, used only where a blueprint is absent from its module's set. */
  BLUEPRINTS: 256,
  /** Global experimental-effect index, on the same fallback path as blueprints. */
  EXPERIMENTAL_EFFECTS: 256,
  /** Outfittable mounts on one hull; every index set over a loadout is this wide. */
  SLOTS_PER_SHIP: 48,
  /** Mounts carried as stock because they offer no choice of module, such as the cargo hatch. */
  FIXED_MODULES_PER_SHIP: 4,
  /** Grades one blueprint can offer, which the game's own range already bounds. */
  BLUEPRINT_GRADES: 5,
  /** Largest per-slot module candidate list: one contextual index per fitted module. */
  MODULE_CANDIDATE_SET: 1_024,
  /** Largest per-module blueprint candidate list: one index per engineered module. */
  BLUEPRINT_CANDIDATE_SET: 32,
  /** Largest per-module experimental candidate list: one index per engineered module. */
  EXPERIMENTAL_CANDIDATE_SET: 32,
  /** Largest per-module pre-engineered variant list: one index per pre-engineered module. */
  PRE_ENGINEERED_CANDIDATE_SET: 32,
});

const maximumLength = (values) => values.reduce((largest, value) => Math.max(largest, value), 0);

/** Every dimension of a generated table, measured the way the link budget counts them. */
export function codecTableDimensions(table) {
  return {
    SHIPS: table.SHIPS.length,
    MODULES: table.MODULES.length,
    BLUEPRINTS: table.BLUEPRINTS.length,
    EXPERIMENTAL_EFFECTS: table.EXPERIMENTAL_EFFECTS.length,
    SLOTS_PER_SHIP: maximumLength(Object.values(table.SLOTS_BY_SHIP).map((slots) => slots.length)),
    FIXED_MODULES_PER_SHIP: maximumLength(
      Object.values(table.FIXED_MODULES_BY_SHIP).map((modules) => modules.length),
    ),
    BLUEPRINT_GRADES: maximumLength(table.BLUEPRINT_GRADES.map((grades) => grades.length)),
    MODULE_CANDIDATE_SET: maximumLength(table.MODULE_SETS.map((set) => set.length)),
    BLUEPRINT_CANDIDATE_SET: maximumLength(table.BLUEPRINT_SETS.map((set) => set.length)),
    EXPERIMENTAL_CANDIDATE_SET: maximumLength(table.EXPERIMENTAL_SETS.map((set) => set.length)),
    PRE_ENGINEERED_CANDIDATE_SET: maximumLength(
      table.PRE_ENGINEERED_SET_BY_MODULE.map((set) => set.length),
    ),
  };
}

/** Refuse a table whose growth invalidates the link-size and string budget. */
export function assertTableWithinCapacity(table) {
  const dimensions = codecTableDimensions(table);
  const exceeded = Object.entries(dimensions).filter(
    ([dimension, actual]) => actual > CODEC_TABLE_CAPACITY[dimension],
  );
  if (exceeded.length === 0) return dimensions;
  throw new Error(
    `Codec table growth exceeds the capacity its link budget is sized for:\n${exceeded
      .map(
        ([dimension, actual]) =>
          `  ${dimension}: ${actual}, budgeted for ${CODEC_TABLE_CAPACITY[dimension]}`,
      )
      .join(
        '\n',
      )}\nWidths derive from the table, so this is a link-size decision, not a codec failure:\n` +
      `re-check the budget in docs/ship-link-codec.md — including MAX_STRING_UNITS — raise the\n` +
      `limit deliberately, and mint the next table version.`,
  );
}

/** Every budgeted limit must still be a table the binary layout can address at all. */
export function assertCapacityWithinCodecLimits() {
  const ceiling = 2 ** CODEC_SYMBOL_BITS;
  // A hull count also feeds the `ceil(log2(h + 1))` representation tag, and an index set writes
  // its selected count against `slots + 1`, so both stop one entry short of the symbol ceiling.
  const ceilingFor = (dimension) =>
    dimension === 'SHIPS' || dimension === 'SLOTS_PER_SHIP' ? ceiling - 1 : ceiling;
  const exceeded = Object.entries(CODEC_TABLE_CAPACITY).filter(
    ([dimension, budgeted]) => budgeted > ceilingFor(dimension),
  );
  if (exceeded.length > 0) {
    throw new Error(
      `Budgeted capacity exceeds what a ${CODEC_SYMBOL_BITS}-bit bounded symbol can address:\n` +
        exceeded.map(([dimension, budgeted]) => `  ${dimension}: ${budgeted}`).join('\n'),
    );
  }
}

const bitsRequired = (valueCount) => {
  let width = 1;
  let capacity = 2;
  while (capacity < valueCount) {
    width += 1;
    capacity *= 2;
  }
  return width;
};
const contextualIndexBits = (valueCount) => (valueCount <= 1 ? 0 : bitsRequired(valueCount));
const varUintBits = (value) => 8 * Math.max(1, Math.ceil(bitsRequired(value + 1) / 7));

/**
 * An upper bound, in bits, on the largest body a table of these dimensions can produce.
 *
 * Two properties of the writer make a bound this simple sound. Every adaptive structure is
 * written in whichever mode costs least, so pricing one arbitrary mode — here the bitmap index
 * set, the sparse power form, and literal identities — can only over-count. And the canonical
 * body is the shorter of the packed and arithmetic renderings, so the packed cost bounds both.
 * The build priced is the worst one those dimensions admit: every mount filled and engineered,
 * every identity reached through its widest index, both labels at their unit bound in UTF-8.
 *
 * It takes dimensions rather than a table so that the declared capacity can be priced as if it
 * were a table — which is what makes the advertised growth a promise rather than a hope.
 */
export function worstCaseBodyBits(dimensions, maxStringUnits) {
  const slots = dimensions.SLOTS_PER_SHIP;
  const fixed = dimensions.FIXED_MODULES_PER_SHIP;
  const grades = dimensions.BLUEPRINT_GRADES;

  // Default-match bit, contextual-membership bit, then the wider of the contextual and global index.
  const identity =
    2 +
    Math.max(
      contextualIndexBits(dimensions.MODULE_CANDIDATE_SET),
      bitsRequired(dimensions.MODULES),
    );
  const experimental =
    2 +
    Math.max(
      contextualIndexBits(dimensions.EXPERIMENTAL_CANDIDATE_SET),
      bitsRequired(dimensions.EXPERIMENTAL_EFFECTS),
    );
  const ordinary =
    1 +
    Math.max(
      contextualIndexBits(dimensions.BLUEPRINT_CANDIDATE_SET),
      bitsRequired(dimensions.BLUEPRINTS),
    ) +
    1 +
    (grades > 2 ? bitsRequired(grades - 1) : 0) +
    experimental;
  const preEngineered =
    contextualIndexBits(dimensions.PRE_ENGINEERED_CANDIDATE_SET) + 1 + experimental;
  // The leading bit is the record's back-reference flag, and it over-counts twice over: a record
  // whose module has no dictionary yet carries no flag at all, and a record that does refer back
  // costs an index into one module's records rather than the whole literal priced here.
  const engineering = 1 + Math.max(ordinary, preEngineered);
  const label = varUintBits(2 * maxStringUnits) + 8 * maxStringUnits;

  return (
    10 + // table version
    bitsRequired(dimensions.SHIPS + 1) + // representation tag
    2 + // label presence
    2 * label +
    1 + // pristine marker
    1 +
    (2 + slots) +
    1 +
    slots * identity + // layout mode, occupancy bitmap, reference mode, identities
    1 +
    2 +
    (2 + slots + fixed) +
    (slots + fixed) * 5 + // power: marker, mode, sparse set, values
    1 +
    1 +
    (2 + slots) +
    1 +
    slots * engineering + // engineering: presence, subset, reference mode, records
    7 // final byte padding
  );
}

/**
 * Bytes of body a full-length link holds, after its `b.` prefix and four-byte CRC-32.
 *
 * The prefix counts against the limit because FR-021 bounds a complete codec value, so 500
 * characters leave 498 encoded digits.
 */
export function envelopeBodyBytes(maxLinkCharacters) {
  // The terminal digit is Base62 and every other digit Base70; leading zero bytes are literal.
  const capacity = 62n * 70n ** BigInt(maxLinkCharacters - 'b.'.length - 1);
  let bytes = 0n;
  for (let value = 1n; value * 256n <= capacity; value *= 256n) bytes += 1n;
  return Number(bytes) - 4;
}

/** The codec's own bounds, read from source so this budget cannot drift away from them. */
export async function readCodecConstants() {
  const read = async (file, name) => {
    const source = await readFile(
      new URL(`../src/app/domain/ships/build-link/${file}`, import.meta.url),
      'utf8',
    );
    const match = new RegExp(`const ${name} = ([\\d_]+)`).exec(source);
    if (!match) throw new Error(`Cannot read ${name} from ${file}; the codec bound moved.`);
    return Number(match[1].replaceAll('_', ''));
  };
  return {
    maxStringUnits: await read('build-link-codec.ts', 'MAX_STRING_UNITS'),
    maxLinkCharacters: await read('build-link-payload.ts', 'MAX_LINK_CHARACTERS'),
  };
}

const fitsEnvelope = (dimensions, { maxStringUnits, maxLinkCharacters }) => ({
  bytes: Math.ceil(worstCaseBodyBits(dimensions, maxStringUnits) / 8),
  limit: envelopeBodyBytes(maxLinkCharacters),
});

/**
 * Refuse capacity that promises more growth than a link can carry.
 *
 * This is the check that keeps the budget honest, because the label bound is the only lever it
 * leaves and that lever moves one way. `MAX_STRING_UNITS` is shared by every table's decoder, so
 * raising it later is free while lowering it would strand links already published — which means
 * the capacity a table is allowed to reach has to be affordable at today's bound, not at one this
 * project would be unable to choose by then.
 */
export function assertCapacityFitsEnvelope(constants) {
  const { bytes, limit } = fitsEnvelope(CODEC_TABLE_CAPACITY, constants);
  if (bytes > limit) {
    throw new Error(
      `A table grown to the budgeted capacity would need up to ${bytes} bytes, beyond the ${limit} a\n` +
        `${constants.maxLinkCharacters}-character codec value carries. The advertised growth has to be\n` +
        `growth the format can actually absorb, so lower a capacity — SLOTS_PER_SHIP is much the most\n` +
        `expensive, at roughly 44 bits each — or raise the envelope. Lowering MAX_STRING_UNITS\n` +
        `(currently ${constants.maxStringUnits}) buys 2 bytes per unit but cannot be undone once links exist.`,
    );
  }
  return { bytes, limit };
}

/** Report what the table as generated can reach, well inside what capacity already promises. */
export function assertTableFitsEnvelope(table, constants) {
  const { bytes, limit } = fitsEnvelope(codecTableDimensions(table), constants);
  if (bytes > limit) {
    throw new Error(
      `The largest build this table can express needs up to ${bytes} bytes, beyond the ${limit} a\n` +
        `${constants.maxLinkCharacters}-character codec value carries.`,
    );
  }
  return { bytes, limit };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(new URL(import.meta.url));

/**
 * Check every committed table against the budget, without regenerating one.
 *
 * The generator makes the same assertions when it writes a table; this runs
 * them against what is actually in the repository, so a table that was hand
 * edited, or a codec bound that moved underneath one, fails the build rather
 * than waiting for the next regeneration.
 *
 * Every table is read, not only the current one. A published table still
 * decodes the links shared against it, so it has to stay inside the budget its
 * links were measured against for as long as it is readable.
 */
if (isMain) {
  const directory = new URL('../src/app/domain/ships/build-link/', import.meta.url);
  const tableFiles = (await readdir(directory))
    .filter((name) => /^codec-table-\d+\.json$/.test(name))
    .sort((left, right) => tableVersionOf(left) - tableVersionOf(right));
  if (tableFiles.length === 0) throw new Error('No build-link codec table is committed.');
  const constants = await readCodecConstants();

  assertCapacityWithinCodecLimits();
  const budgeted = assertCapacityFitsEnvelope(constants);

  for (const name of tableFiles) {
    const table = JSON.parse(await readFile(new URL(name, directory)));

    assertTableWithinCapacity(table);
    const envelope = assertTableFitsEnvelope(table, constants);

    process.stdout.write(
      `Codec capacity: the largest build table ${tableVersionOf(name)} can express needs up to ` +
        `${envelope.bytes} of the ${envelope.limit} bytes a ${constants.maxLinkCharacters}-character ` +
        `value carries (${budgeted.bytes} once grown to the budgeted capacity).\n`,
    );
  }
}

function tableVersionOf(name) {
  return Number(/\d+/.exec(name)?.[0]);
}
