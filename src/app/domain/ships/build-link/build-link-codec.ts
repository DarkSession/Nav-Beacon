import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { FittedModule } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { PRE_ENGINEERED_MODULES } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import type { PreEngineeredVariant } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { getPreEngineeredJournalModifiers } from '@elite-dangerous-almanac/core/ships/pre-engineered-stats';
import type {
  LoadoutEvent,
  LoadoutModule,
  ModuleEngineering,
} from '@elite-dangerous-almanac/core/ships/slef';
import { ArithmeticDecoder, ArithmeticEncoder } from './build-link-arithmetic';
import { RawBitReader, RawBitWriter } from '../../build-link/build-link-bits';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import { decodeBuildLinkBody, encodeBuildLinkBody } from './build-link-payload';
import type { VerifiedBuildLinkBody } from './build-link-payload';
export { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
export type { BuildLinkCodecErrorCode } from '../../build-link/build-link-codec-error';

/**
 * Pinned non-uniform symbol models, carried as table data. Every entry is an integer weight list; a
 * symbol's arithmetic interval is its weight's share of the list's total, so a table that pins
 * these weights makes skewed values cheaper than uniform coding while remaining canonical: both
 * renderers read the same frozen numbers. Bit packing ignores models entirely, which keeps every
 * adaptive cost decision and every packed body identical with or without them. An optional entry
 * a table leaves out prices its symbol uniformly, so a table pinning fewer models is still a
 * table this codec reads.
 */
export interface BuildLinkSymbolModels {
  /** Weights for an ordinary record's grade: [below maximum, maximum]. */
  readonly GRADE_IS_MAX: readonly number[];
  /** Weights for an ordinary record's experimental effect: [absent, present]. */
  readonly EXPERIMENTAL_PRESENT: readonly number[];
  /** Weights for an identity's contextual-set membership: [global fallback, in context]. */
  readonly CONTEXT_HIT: readonly number[];
  /** Weights for an engineering record's back-reference flag: [written out, a reference]. */
  readonly ENGINEERING_REFERENCE?: readonly number[];
  /**
   * Weights for a module-sequence repeat flag: [a new identity, an earlier distinct one]. The
   * "same as previous" flag beside it carries no model at all: how often a loadout repeats the
   * article in the mount before it is a property of the build rather than of builds, so a
   * static prior loses on one reference or the other, and a per-run adaptive context on a
   * two-valued flag is misled by its own first few symbols (both measured).
   */
  readonly IDENTITY_REPEATED?: readonly number[];
  /** Weights for an absolute-layout identity's default flag: [chosen, the slot's default]. */
  readonly IDENTITY_IS_DEFAULT?: readonly number[];
  /** Weights for a baseline-layout changed slot: [emptied, filled]. */
  readonly BASELINE_SLOT_PRESENT?: readonly number[];
  /** Weights for an explicit enabled state: [absent, off, on]. */
  readonly POWER_ON: readonly number[];
  /** Weights for an explicit priority: [absent, 0, 1, 2, 3, 4]. */
  readonly POWER_PRIORITY: readonly number[];
  /**
   * Geometric decay [numerator, denominator] over contextual-set positions; equal terms mean
   * uniform. A table orders each candidate set by how likely its entries are to be chosen, and
   * this decay is what turns that order into cheaper early positions. It is independent of
   * `CONTEXT_ADAPTATION`, which models the back-reference streams rather than candidate sets.
   */
  readonly CONTEXT_INDEX_DECAY: readonly number[];
  /**
   * Smallest weight the decay may fall to, which caps how much more a late position costs than
   * an early one. A steep decay without a floor prices the tail of a 464-candidate set far above
   * uniform coding, and a popularity order is a prior rather than a certainty. A table that
   * omits the key floors at one, which is where an unbounded geometric run ends anyway.
   */
  readonly CONTEXT_INDEX_FLOOR?: number;
  /**
   * Adaptive-context increment; zero disables adaptation. When positive, back-reference indexes
   * — per-module engineering references and repeated-module dictionary indexes — are coded
   * against a per-run frequency context seeded uniformly and bumped by this amount after each coded
   * symbol, so a target referenced repeatedly in one build gets cheaper each time. Adaptation is
   * deliberately confined to reference streams: the grammar's back-referencing already dedupes
   * repeats out of the candidate-set literal streams, so adapting those penalises every new
   * distinct value instead (measured on the reference Corvette). Both sides replay the identical
   * symbol sequence, which is what keeps the adaptation canonical.
   */
  readonly CONTEXT_ADAPTATION: number;
  /** One weight per compact-alphabet character for the ship name, in exact alphabet order. */
  readonly NAME_CHARACTERS: readonly number[];
  /** One weight per compact-alphabet character for the ship ident, in exact alphabet order. */
  readonly IDENT_CHARACTERS: readonly number[];
}

export interface BuildLinkCodecTables {
  readonly $generated: {
    readonly tableVersion: number;
    /** SHA-256 over the table's content; a table whose hash moves is a new encoding. */
    readonly contentHash: string;
  };
  /** Optional pinned symbol models; a table without them prices every symbol uniformly. */
  readonly MODELS?: BuildLinkSymbolModels;
  readonly SHIPS: readonly string[];
  readonly MODULES: readonly string[];
  readonly POWERED_MODULES: readonly number[];
  readonly BLUEPRINTS: readonly string[];
  readonly BLUEPRINT_GRADES: readonly (readonly number[])[];
  readonly EXPERIMENTAL_EFFECTS: readonly string[];
  readonly SLOTS_BY_SHIP: Readonly<Record<string, readonly string[]>>;
  readonly FIXED_MODULES_BY_SHIP: Readonly<
    Record<string, readonly { readonly slot: string; readonly module: number }[]>
  >;
  readonly DEFAULT_MODULES_BY_SHIP: Readonly<Record<string, readonly (number | null)[]>>;
  readonly MODULE_SETS: readonly (readonly number[])[];
  readonly MODULE_SET_BY_SHIP: Readonly<Record<string, readonly number[]>>;
  readonly BLUEPRINT_SETS: readonly (readonly number[])[];
  readonly BLUEPRINT_SET_BY_MODULE: readonly number[];
  readonly EXPERIMENTAL_SETS: readonly (readonly number[])[];
  readonly EXPERIMENTAL_SET_BY_MODULE: readonly number[];
  readonly PRE_ENGINEERED_VARIANTS: readonly {
    readonly module: number;
    readonly blueprint: number;
    readonly grade: number;
    readonly acquisition: string;
    readonly experimental: number | null;
  }[];
  readonly PRE_ENGINEERED_SET_BY_MODULE: readonly (readonly number[])[];
}

export interface BuildLinkCodec {
  encodeBuildLinkFragment(loadout: ShipLoadout): string;
  decodeBuildLinkFragment(fragment: string): ShipLoadout;
  decodeVerifiedBuildLinkBody(body: VerifiedBuildLinkBody): ShipLoadout;
}

/**
 * A bounded symbol's model: pinned cumulative frequencies, or an adaptive per-run context keyed
 * by the identity of `adaptOver`. Only back-reference dictionaries key adaptive contexts — the
 * module repeat dictionary and each fitted module's engineering dictionary — never candidate-set
 * literals, whose repeats the grammar already dedupes into those dictionaries.
 */
type BoundedSymbolModel = readonly number[] | AdaptiveSymbolModel;
type AdaptiveSymbolModel = { readonly adaptOver: readonly number[] };

function isAdaptiveModel(model: BoundedSymbolModel): model is AdaptiveSymbolModel {
  return !Array.isArray(model);
}

/** Runtime form of the pinned models: cumulative frequencies ready for the arithmetic coder. */
interface SymbolModels {
  readonly gradeIsMax: readonly number[];
  readonly experimentalPresent: readonly number[];
  readonly contextHit: readonly number[];
  readonly engineeringReference: readonly number[] | undefined;
  readonly identityRepeated: readonly number[] | undefined;
  readonly identityIsDefault: readonly number[] | undefined;
  readonly baselineSlotPresent: readonly number[] | undefined;
  readonly powerOn: readonly number[];
  readonly powerPriority: readonly number[];
  readonly nameCharacters: readonly number[];
  readonly identCharacters: readonly number[];
  readonly adaptationIncrement: number;
  /** The static positional model for an index into a candidate set. */
  contextModel(context: readonly number[]): BoundedSymbolModel | undefined;
  /** The adaptive model for a back-reference index, keyed by the per-run dictionary `key`. */
  adaptiveModel(key: readonly number[]): BoundedSymbolModel | undefined;
}

interface CodecContext {
  readonly tableVersion: number;
  readonly tables: BuildLinkCodecTables;
  readonly models: SymbolModels | null;
  readonly moduleBits: number;
  readonly poweredModuleSet: ReadonlySet<number>;
  readonly shipIndex: ReadonlyMap<string, number>;
  readonly moduleIndex: ReadonlyMap<string, number>;
  readonly blueprintIndex: ReadonlyMap<string, number>;
  readonly experimentalIndex: ReadonlyMap<string, number>;
  readonly slotIndexByShip: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

const TABLE_VERSION_BITS = 10;
/**
 * Ship name and ident are each bounded so that metadata can never crowd a loadout out of the
 * 500-character codec value. Two 32-unit labels cost at most 66 bytes of the 377-byte body, which
 * what leaves room for a hull grown to the mounts `CODEC_TABLE_CAPACITY` budgets for. The bound
 * is deliberately on the low side: every table's decoder shares it, so raising it later is free
 * while lowering it would strand links already published.
 */
const MAX_STRING_UNITS = 32;
const COMPACT_STRING_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
const COMPACT_STRING_CHARACTERS = new Set(COMPACT_STRING_ALPHABET);
/**
 * Model weight totals stay far below the coder's 2^62 exactness bound; the cap only keeps a
 * table from pinning something absurd.
 */
const MAX_MODEL_WEIGHT_TOTAL = 2 ** 24;
const CONTEXT_INDEX_FIRST_WEIGHT = 2 ** 16;
const MAX_CONTEXT_INDEX_DECAY_DENOMINATOR = 64;
const MAX_CONTEXT_ADAPTATION_INCREMENT = 2 ** 16;

/**
 * Deterministic per-run adaptive frequency contexts. Every context starts uniform (weight one per
 * candidate) and the coded symbol's weight grows by the pinned increment after each use, so a
 * value repeated anywhere in one build gets a shorter interval on its later occurrences. Contexts
 * are keyed by the identity of their dictionary array: encoder, decoder, and reserialization
 * each build the same per-run dictionaries, so the same key resolves the same context.
 *
 * Adaptation lives only here, in the renderers and the arithmetic reader — never at
 * symbol-capture or cost-model time — so the packed render, the packed-bit cost proxy, and every
 * adaptive layout decision remain model-independent, and canonical reserialization replays the
 * identical count evolution.
 */
class AdaptiveContexts {
  private readonly stateByKey = new Map<readonly number[], { counts: number[]; total: number }>();

  constructor(private readonly increment: number) {}

  cumulativeFor(key: readonly number[], valueCount: number): number[] {
    const state = this.stateFor(key, valueCount);
    let total = 0;
    const cumulative = [0];
    for (let index = 0; index < valueCount; index += 1) {
      total += state.counts[index]!;
      cumulative.push(total);
    }
    return cumulative;
  }

  recordUse(key: readonly number[], valueCount: number, value: number): void {
    const state = this.stateFor(key, valueCount);
    // Freezing the counts near the cap is deterministic on both sides and keeps totals far
    // below the coder's exactness bound.
    if (state.total + this.increment > MAX_MODEL_WEIGHT_TOTAL) return;
    state.counts[value]! += this.increment;
    state.total += this.increment;
  }

  private stateFor(
    key: readonly number[],
    valueCount: number,
  ): { counts: number[]; total: number } {
    let state = this.stateByKey.get(key);
    if (state === undefined) {
      state = { counts: [], total: 0 };
      this.stateByKey.set(key, state);
    }
    // A back-reference dictionary grows between uses; later symbols see the wider context.
    while (state.counts.length < valueCount) {
      state.counts.push(1);
      state.total += 1;
    }
    return state;
  }
}

export function createBuildLinkCodec(
  tableVersion: number,
  tables: BuildLinkCodecTables,
): BuildLinkCodec {
  if (
    !Number.isInteger(tableVersion) ||
    tableVersion < 1 ||
    tableVersion >= 2 ** TABLE_VERSION_BITS ||
    tables.$generated.tableVersion !== tableVersion
  ) {
    throw new Error('The build-link codec table version is invalid.');
  }
  return new TableBoundBuildLinkCodec(createCodecContext(tableVersion, tables));
}

class TableBoundBuildLinkCodec implements BuildLinkCodec {
  constructor(private readonly context: CodecContext) {}

  readonly encodeBuildLinkFragment = (loadout: ShipLoadout): string =>
    encodeWithTable(this.context, loadout);

  readonly decodeBuildLinkFragment = (fragment: string): ShipLoadout =>
    this.decodeVerifiedBuildLinkBody(decodeBuildLinkBody(fragment));

  readonly decodeVerifiedBuildLinkBody = (body: VerifiedBuildLinkBody): ShipLoadout =>
    decodeBodyWithTable(this.context, body);
}

/**
 * Encode a loadout into the application-owned, table-versioned value placed after `#`.
 * SLEF parsing and reconstruction remain the Almanac's responsibility; this module
 * only serialises the minimal non-derivable build state.
 */
function encodeWithTable(codec: CodecContext, loadout: ShipLoadout): string {
  return encodeBuildLinkBody(canonicalBody(codec, writeWithTable(codec, loadout).symbols));
}

function writeWithTable(codec: CodecContext, loadout: ShipLoadout): SymbolWriter {
  const writer = new SymbolWriter();
  const shipIndex = requireIdentity(codec, codec.shipIndex, loadout.shipSymbol, 'ship');
  const canonicalShip = codec.tables.SHIPS[shipIndex];
  const slots = codec.tables.SLOTS_BY_SHIP[canonicalShip];
  const fixedModules = codec.tables.FIXED_MODULES_BY_SHIP[canonicalShip];
  const slotIndex = codec.slotIndexByShip.get(canonicalShip);
  if (!slots || !fixedModules || !slotIndex) {
    throw new BuildLinkCodecError('unknownIdentity', `No codec slots exist for ${canonicalShip}.`);
  }
  const fixedModuleBySlot = new Map(fixedModules.map((fixed) => [normalise(fixed.slot), fixed]));

  writer.writeBounded(shipIndex, codec.tables.SHIPS.length);
  writer.writeBoolean(loadout.shipName !== null);
  writer.writeBoolean(loadout.shipIdent !== null);
  if (loadout.shipName !== null) writer.writeString(loadout.shipName, codec.models?.nameCharacters);
  if (loadout.shipIdent !== null)
    writer.writeString(loadout.shipIdent, codec.models?.identCharacters);

  const modules = loadout.fittedModules();
  const modulesBySlot = new Map<string, (typeof modules)[number]>();
  const moduleIndexes: Array<number | null> = slots.map(() => null);
  for (const module of modules) {
    const encodedSlot = slotIndex.get(normalise(module.slot));
    if (encodedSlot === undefined) {
      const fixed = fixedModuleBySlot.get(normalise(module.slot));
      if (fixed) {
        if (modulesBySlot.has(fixed.slot)) {
          throw new BuildLinkCodecError(
            'invalidPayload',
            `Slot ${fixed.slot} appears more than once.`,
          );
        }
        if (
          requireIdentity(codec, codec.moduleIndex, module.symbol, 'module', module.slot) !==
          fixed.module
        ) {
          throw new BuildLinkCodecError(
            'invalidPayload',
            `Fixed slot ${fixed.slot} does not contain its pinned module.`,
          );
        }
        if (module.engineering !== undefined) {
          throw new BuildLinkCodecError(
            'invalidPayload',
            `Fixed slot ${fixed.slot} cannot carry engineering.`,
          );
        }
        modulesBySlot.set(fixed.slot, module);
        continue;
      }
      throw new BuildLinkCodecError(
        'unknownIdentity',
        `Slot ${module.slot} is absent from codec table ${codec.tableVersion} for ${canonicalShip}.`,
        { slot: module.slot },
      );
    }
    const slot = slots[encodedSlot];
    if (modulesBySlot.has(slot)) {
      throw new BuildLinkCodecError('invalidPayload', `Slot ${slot} appears more than once.`);
    }
    modulesBySlot.set(slot, module);
    moduleIndexes[encodedSlot] = requireIdentity(
      codec,
      codec.moduleIndex,
      module.symbol,
      'module',
      module.slot,
    );
  }

  const defaults = codec.tables.DEFAULT_MODULES_BY_SHIP[canonicalShip];
  const pristine =
    moduleIndexes.every((moduleIndex, index) => {
      const module = moduleAt(modulesBySlot, slots[index]);
      return (
        moduleIndex === defaults[index] &&
        (!moduleDrawsPower(codec, moduleIndex) ||
          (module?.on === undefined && module?.priority === undefined)) &&
        module?.engineering === undefined
      );
    }) &&
    fixedModules.every(({ slot, module: moduleIndex }) => {
      const module = moduleAt(modulesBySlot, slot);
      return (
        !moduleDrawsPower(codec, moduleIndex) ||
        (module?.on === undefined && module?.priority === undefined)
      );
    });
  writer.writeBoolean(pristine);
  if (!pristine) {
    writeModuleIdentities(codec, writer, canonicalShip, slots, defaults, moduleIndexes);
    const occupiedSlots = indexesWhere(moduleIndexes, (moduleIndex) => moduleIndex !== null);
    const occupiedModules = occupiedSlots.map((index) => moduleAt(modulesBySlot, slots[index])!);
    const powerStates: PowerState[] = [
      ...occupiedModules.flatMap((module, occupiedIndex) =>
        moduleDrawsPower(codec, moduleIndexes[occupiedSlots[occupiedIndex]!]!)
          ? [{ on: module.on, priority: module.priority }]
          : [],
      ),
      ...fixedModules.flatMap(({ slot, module: moduleIndex }) => {
        if (!moduleDrawsPower(codec, moduleIndex)) return [];
        const module = moduleAt(modulesBySlot, slot);
        return [{ on: module?.on, priority: module?.priority }];
      }),
    ];
    writePowerStates(codec.models, writer, powerStates);
    writeEngineeringStates(
      codec,
      writer,
      occupiedModules.map((module, occupiedIndex) =>
        module.engineering === undefined
          ? undefined
          : engineeringStateFromModule(
              codec,
              moduleIndexes[occupiedSlots[occupiedIndex]!]!,
              module,
            ),
      ),
      moduleIndexes,
      occupiedSlots,
      occupiedModules.map((module) => module.slot),
    );
  }
  return writer;
}

/** Decode an envelope-verified body produced by the bound encoder for the active table. */
function decodeBodyWithTable(codec: CodecContext, body: Uint8Array): ShipLoadout {
  let state: CodecState;
  try {
    const source = new RawBitReader(body);
    const tableVersion = source.readBits(TABLE_VERSION_BITS);
    if (tableVersion !== codec.tableVersion) {
      throw new BuildLinkCodecError(
        'unsupportedTableVersion',
        `Build-link table version ${tableVersion} is not supported by the loaded table.`,
      );
    }
    const shipCount = codec.tables.SHIPS.length;
    const shipTagWidth = bitsRequired(shipCount + 1);
    const representationTag = source.readBits(shipTagWidth);
    const arithmetic = representationTag >= shipCount;
    const reader: CodecReader = arithmetic
      ? new ArithmeticSymbolReader(source, codec.models)
      : new PackedSymbolReader(source);
    let shipIndex = representationTag;
    if (arithmetic) {
      const markerCount = 2 ** shipTagWidth - shipCount;
      const remainder = representationTag - shipCount;
      const groupCount = arithmeticShipGroupCount(shipCount, markerCount, remainder);
      const group = groupCount === 1 ? 0 : reader.readBounded(groupCount);
      shipIndex = group * markerCount + remainder;
      if (shipIndex >= shipCount) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'The build-link representation is invalid.',
        );
      }
    }
    state = readCodecState(codec, reader, shipIndex);
    if (!arithmetic && !source.done) {
      throw new BuildLinkCodecError('invalidPayload', 'The build-link payload has trailing data.');
    }
    if (!bytesEqual(writeCodecState(codec, state), body)) {
      throw new BuildLinkCodecError('invalidPayload', 'The build-link encoding is not canonical.');
    }
  } catch (error) {
    if (error instanceof BuildLinkCodecError) throw error;
    throw new BuildLinkCodecError('invalidPayload', 'The build-link payload is invalid.');
  }
  try {
    return reconstructLoadout(codec, state);
  } catch (error) {
    if (error instanceof BuildLinkCodecError) throw error;
    throw new BuildLinkCodecError(
      'reconstructionFailed',
      'The build link is valid but its loadout could not be reconstructed.',
      { cause: error },
    );
  }
}

type OrdinaryEngineeringState = {
  readonly kind: 'ordinary';
  readonly blueprint: number;
  readonly level: number;
  readonly experimental: number | null;
};

type PreEngineeredState = {
  readonly kind: 'preEngineered';
  readonly variant: number;
  readonly experimental: number | null;
};

type CodecEngineeringState = OrdinaryEngineeringState | PreEngineeredState;

type CodecState = {
  readonly shipIndex: number;
  readonly shipName: string | undefined;
  readonly shipIdent: string | undefined;
  readonly pristine: boolean;
  readonly moduleIndexes: readonly (number | null)[];
  readonly powerStates: readonly PowerState[];
  readonly engineeringStates: readonly (CodecEngineeringState | undefined)[];
};

function readCodecState(
  codec: CodecContext,
  reader: CodecReader,
  packedShipIndex?: number,
): CodecState {
  const shipIndex = packedShipIndex ?? reader.readBounded(codec.tables.SHIPS.length);
  const ship = codec.tables.SHIPS[shipIndex];
  if (!ship) throw unknownTableIndex(codec, 'ship', shipIndex);
  const slots = codec.tables.SLOTS_BY_SHIP[ship];
  const fixedModules = codec.tables.FIXED_MODULES_BY_SHIP[ship];

  const hasShipName = reader.readBoolean();
  const hasShipIdent = reader.readBoolean();
  const shipName = hasShipName ? reader.readString(codec.models?.nameCharacters) : undefined;
  const shipIdent = hasShipIdent ? reader.readString(codec.models?.identCharacters) : undefined;
  const pristine = reader.readBoolean();
  const moduleIndexes = pristine
    ? [...codec.tables.DEFAULT_MODULES_BY_SHIP[ship]]
    : readModuleIdentities(codec, reader, ship, slots);
  const occupiedSlots = indexesWhere(moduleIndexes, (moduleIndex) => moduleIndex !== null);
  const powerLayout = powerStateLayout(codec, moduleIndexes, occupiedSlots, fixedModules);
  const powerStateCount = powerLayout.occupied.length + powerLayout.fixed.length;
  const powerStates = pristine
    ? Array.from({ length: powerStateCount }, () => ({ on: undefined, priority: undefined }))
    : readPowerStates(codec.models, reader, powerStateCount);
  const engineeringStates = pristine
    ? occupiedSlots.map(() => undefined)
    : readEngineeringStates(codec, reader, moduleIndexes, occupiedSlots);
  if (!pristine && isPristineState(codec, ship, moduleIndexes, powerStates, engineeringStates)) {
    throw new BuildLinkCodecError(
      'invalidPayload',
      'A stock loadout must use the pristine representation.',
    );
  }

  return {
    shipIndex,
    shipName,
    shipIdent,
    pristine,
    moduleIndexes,
    powerStates,
    engineeringStates,
  };
}

function writeCodecState(codec: CodecContext, state: CodecState): Uint8Array {
  const writer = new SymbolWriter();
  writer.writeBounded(state.shipIndex, codec.tables.SHIPS.length);
  writer.writeBoolean(state.shipName !== undefined);
  writer.writeBoolean(state.shipIdent !== undefined);
  if (state.shipName !== undefined)
    writer.writeString(state.shipName, codec.models?.nameCharacters);
  if (state.shipIdent !== undefined)
    writer.writeString(state.shipIdent, codec.models?.identCharacters);
  writer.writeBoolean(state.pristine);
  if (!state.pristine) {
    const ship = codec.tables.SHIPS[state.shipIndex] as CodecShip;
    const slots = codec.tables.SLOTS_BY_SHIP[ship];
    const defaults = codec.tables.DEFAULT_MODULES_BY_SHIP[ship];
    const occupiedSlots = indexesWhere(state.moduleIndexes, (moduleIndex) => moduleIndex !== null);
    writeModuleIdentities(codec, writer, ship, slots, defaults, state.moduleIndexes);
    writePowerStates(codec.models, writer, state.powerStates);
    writeEngineeringStates(
      codec,
      writer,
      state.engineeringStates,
      state.moduleIndexes,
      occupiedSlots,
      occupiedSlots.map((slotIndex) => slots[slotIndex]!),
    );
  }
  return canonicalBody(codec, writer.symbols);
}

function reconstructLoadout(codec: CodecContext, state: CodecState): ShipLoadout {
  const ship = codec.tables.SHIPS[state.shipIndex] as CodecShip;
  const slots = codec.tables.SLOTS_BY_SHIP[ship];
  const fixedModules = codec.tables.FIXED_MODULES_BY_SHIP[ship];
  const occupiedSlots = indexesWhere(state.moduleIndexes, (moduleIndex) => moduleIndex !== null);
  const powerLayout = powerStateLayout(codec, state.moduleIndexes, occupiedSlots, fixedModules);
  const powerByOccupiedIndex = new Map(
    powerLayout.occupied.map((occupiedIndex, powerIndex) => [
      occupiedIndex,
      state.powerStates[powerIndex]!,
    ]),
  );
  const fixedPowerOffset = powerLayout.occupied.length;
  const powerByFixedIndex = new Map(
    powerLayout.fixed.map((fixedIndex, powerIndex) => [
      fixedIndex,
      state.powerStates[fixedPowerOffset + powerIndex]!,
    ]),
  );

  const modules: LoadoutModule[] = occupiedSlots.map((slotIndex, occupiedIndex) => {
    const moduleIndex = state.moduleIndexes[slotIndex]!;
    const item = codec.tables.MODULES[moduleIndex];
    if (!item) throw unknownTableIndex(codec, 'module', moduleIndex);
    const { on, priority } = powerByOccupiedIndex.get(occupiedIndex) ?? EMPTY_POWER_STATE;
    const engineering = state.engineeringStates[occupiedIndex];
    const resolvedEngineering =
      engineering?.kind === 'preEngineered'
        ? resolvePreEngineeredEngineering(codec, engineering)
        : undefined;
    return {
      Slot: slots[slotIndex],
      Item: item,
      ...(on === undefined ? {} : { On: on }),
      ...(priority === undefined ? {} : { Priority: priority }),
      ...(resolvedEngineering === undefined ? {} : { Engineering: resolvedEngineering }),
    };
  });
  fixedModules.forEach(({ slot, module }, fixedIndex) => {
    const item = codec.tables.MODULES[module];
    if (!item) throw unknownTableIndex(codec, 'fixed module', module);
    const { on, priority } = powerByFixedIndex.get(fixedIndex) ?? EMPTY_POWER_STATE;
    modules.push({
      Slot: slot,
      Item: item,
      ...(on === undefined ? {} : { On: on }),
      ...(priority === undefined ? {} : { Priority: priority }),
    });
  });

  const event: LoadoutEvent = {
    event: 'Loadout',
    Ship: ship,
    ...(state.shipName === undefined ? {} : { ShipName: state.shipName }),
    ...(state.shipIdent === undefined ? {} : { ShipIdent: state.shipIdent }),
    Modules: modules,
  };
  const loadout = ShipLoadout.fromLoadout(event);
  refuseAnArticleThePackageWouldNotFit(loadout);
  emptyTheMountsThePayloadLeavesEmpty(loadout, slots, state.moduleIndexes);
  occupiedSlots.forEach((slotIndex, occupiedIndex) => {
    const engineering = state.engineeringStates[occupiedIndex];
    if (engineering?.kind !== 'ordinary') return;
    const blueprint = codec.tables.BLUEPRINTS[engineering.blueprint];
    if (!blueprint) throw unknownTableIndex(codec, 'engineering blueprint', engineering.blueprint);
    const experimental =
      engineering.experimental === null
        ? undefined
        : codec.tables.EXPERIMENTAL_EFFECTS[engineering.experimental];
    if (engineering.experimental !== null && experimental === undefined) {
      throw unknownTableIndex(codec, 'experimental effect', engineering.experimental);
    }
    loadout.applyBlueprint(slots[slotIndex], blueprint, {
      grade: engineering.level,
      quality: 1,
      ...(experimental === undefined ? {} : { experimentalEffectSymbol: experimental }),
    });
  });
  return loadout;
}

/**
 * Refuse a payload whose article the installed package declines to fit.
 *
 * A published table holds the catalogue of the release it was minted from, so a link can
 * name a fit a later release withdraws. Reconstruction goes through a journal `Loadout`,
 * which the package repairs rather than rejects: it empties a removable mount it cannot
 * resolve and stocks a core mount with the hull's own article. Either leaves a build the
 * Commander never fitted, and the envelope says nothing is wrong, so the link has to be
 * refused here instead (constitution IV).
 *
 * The package's own report is the source. Only an outcome naming the article the payload
 * supplied counts: a `defaulted` mount with no source symbol is a mount this payload
 * records as empty, which the hull stocks; `emptyTheMountsThePayloadLeavesEmpty` clears
 * the removable ones, and the package refuses to empty the rest.
 *
 * The mount travels as a structured value, because the message is an internal English
 * string that is never rendered: what the Commander reads is built from the code and the
 * slot (build-link contract, "Error presentation").
 */
function refuseAnArticleThePackageWouldNotFit(loadout: ShipLoadout): void {
  const refused = loadout.importOutcomes.find(
    (outcome) =>
      (outcome.action === 'emptied' || outcome.action === 'defaulted') &&
      outcome.sourceSymbol !== null,
  );
  if (!refused) return;
  throw new BuildLinkCodecError(
    'reconstructionFailed',
    `The build link records ${refused.sourceSymbol} in ${refused.slot}, ` +
      'which the installed catalogue does not fit there.',
    { slot: refused.slot },
  );
}

/**
 * Empty the removable mounts the payload records as empty.
 *
 * Reconstruction stocks armour, the core internals, the cargo hatch and the planetary
 * approach suite from the hull defaults when its source names none, because a journal
 * `Loadout` cannot say whether a missing entry is a decision or a gap. A codec value can:
 * every mount the hull has carries its own occupancy bit, so an empty removable mount is a
 * Commander's decision and has to survive the link (FR-019). The mounts a build cannot fly
 * without are stocked either way, and the package refuses to empty them, so they are left
 * as reconstruction made them.
 */
function emptyTheMountsThePayloadLeavesEmpty(
  loadout: ShipLoadout,
  slots: readonly string[],
  moduleIndexes: readonly (number | null)[],
): void {
  const removable = new Set(
    loadout
      .slots()
      .filter((slot) => slot.removable)
      .map((slot) => slot.key.toLowerCase()),
  );
  slots.forEach((slot, slotIndex) => {
    if (moduleIndexes[slotIndex] !== null) return;
    if (!removable.has(slot.toLowerCase())) return;
    if (loadout.fittedModuleAt(slot) === null) return;
    loadout.removeModule(slot);
  });
}

function isPristineState(
  codec: CodecContext,
  ship: CodecShip,
  moduleIndexes: readonly (number | null)[],
  powerStates: readonly PowerState[],
  engineeringStates: readonly (CodecEngineeringState | undefined)[],
): boolean {
  const defaults = codec.tables.DEFAULT_MODULES_BY_SHIP[ship];
  return (
    moduleIndexes.every((moduleIndex, index) => moduleIndex === defaults[index]) &&
    powerStates.every(({ on, priority }) => on === undefined && priority === undefined) &&
    engineeringStates.every((engineering) => engineering === undefined)
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

type CodecShip = string;
type PowerState = { on: boolean | undefined; priority: number | undefined };
const EMPTY_POWER_STATE: PowerState = { on: undefined, priority: undefined };
type CodecFittedModule = FittedModule;

function moduleDrawsPower(codec: CodecContext, moduleIndex: number | null): boolean {
  return moduleIndex !== null && codec.poweredModuleSet.has(moduleIndex);
}

function powerStateLayout(
  codec: CodecContext,
  moduleIndexes: readonly (number | null)[],
  occupiedSlots: readonly number[],
  fixedModules: readonly { readonly module: number }[],
): { readonly occupied: number[]; readonly fixed: number[] } {
  return {
    occupied: indexesWhere(occupiedSlots, (slotIndex) =>
      moduleDrawsPower(codec, moduleIndexes[slotIndex]!),
    ),
    fixed: indexesWhere(fixedModules, ({ module }) => moduleDrawsPower(codec, module)),
  };
}
type ModuleIdentityContext = {
  context: readonly number[];
  defaultIndex: number | null;
};
type ModuleIdentityEntry = ModuleIdentityContext & { moduleIndex: number };

function writeModuleIdentities(
  codec: CodecContext,
  writer: CodecWriter,
  ship: CodecShip,
  slots: readonly string[],
  defaults: readonly (number | null)[],
  modules: readonly (number | null)[],
): void {
  const { changed, occupied, baselineCost, absoluteCost } = moduleIdentityLayoutCosts(
    codec,
    ship,
    slots,
    defaults,
    modules,
  );
  const useBaseline = baselineCost <= absoluteCost;
  writer.writeBoolean(useBaseline);

  if (useBaseline) {
    writeIndexSet(writer, slots.length, changed);
    const entries: ModuleIdentityEntry[] = [];
    for (const slotIndex of changed) {
      const moduleIndex = modules[slotIndex];
      writer.writeBoolean(moduleIndex !== null, codec.models?.baselineSlotPresent);
      if (moduleIndex !== null) {
        entries.push({
          moduleIndex,
          context: moduleSetForSlot(codec, ship, slotIndex),
          defaultIndex: null,
        });
      }
    }
    writeModuleIdentitySequence(codec, writer, entries);
    return;
  }

  writeIndexSet(writer, slots.length, occupied);
  writeModuleIdentitySequence(
    codec,
    writer,
    occupied.map((slotIndex) => ({
      moduleIndex: modules[slotIndex]!,
      context: moduleSetForSlot(codec, ship, slotIndex),
      defaultIndex: defaults[slotIndex] ?? null,
    })),
  );
}

function readModuleIdentities(
  codec: CodecContext,
  reader: CodecReader,
  ship: CodecShip,
  slots: readonly string[],
): Array<number | null> {
  const defaults = codec.tables.DEFAULT_MODULES_BY_SHIP[ship] as readonly (number | null)[];
  const useBaseline = reader.readBoolean();
  let modules: Array<number | null>;
  if (useBaseline) {
    modules = [...defaults];
    const changed = readIndexSet(reader, slots.length);
    const present = changed.map(() => reader.readBoolean(codec.models?.baselineSlotPresent));
    const presentSlots = changed.filter((_slotIndex, index) => present[index]);
    const identities = readModuleIdentitySequence(
      codec,
      reader,
      presentSlots.map((slotIndex) => ({
        context: moduleSetForSlot(codec, ship, slotIndex),
        defaultIndex: null,
      })),
    );
    let identityIndex = 0;
    for (const [changedIndex, slotIndex] of changed.entries()) {
      const module = present[changedIndex] ? identities[identityIndex++]! : null;
      if (module === defaults[slotIndex]) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'A baseline change restates the default module.',
        );
      }
      modules[slotIndex] = module;
    }
  } else {
    modules = slots.map(() => null);
    const occupied = readIndexSet(reader, slots.length);
    const identities = readModuleIdentitySequence(
      codec,
      reader,
      occupied.map((slotIndex) => ({
        context: moduleSetForSlot(codec, ship, slotIndex),
        defaultIndex: defaults[slotIndex] ?? null,
      })),
    );
    occupied.forEach((slotIndex, index) => {
      modules[slotIndex] = identities[index]!;
    });
  }

  return modules;
}

function moduleIdentityLayoutCosts(
  codec: CodecContext,
  ship: CodecShip,
  slots: readonly string[],
  defaults: readonly (number | null)[],
  modules: readonly (number | null)[],
): {
  changed: number[];
  occupied: number[];
  baselineCost: number;
  absoluteCost: number;
} {
  const changed = indexesWhere(modules, (moduleIndex, index) => moduleIndex !== defaults[index]);
  const occupied = indexesWhere(modules, (moduleIndex) => moduleIndex !== null);
  const baselineEntries = changed.flatMap((slotIndex): ModuleIdentityEntry[] => {
    const moduleIndex = modules[slotIndex];
    return moduleIndex === null
      ? []
      : [{ moduleIndex, context: moduleSetForSlot(codec, ship, slotIndex), defaultIndex: null }];
  });
  const absoluteEntries = occupied.map((slotIndex): ModuleIdentityEntry => ({
    moduleIndex: modules[slotIndex]!,
    context: moduleSetForSlot(codec, ship, slotIndex),
    defaultIndex: defaults[slotIndex] ?? null,
  }));
  return {
    changed,
    occupied,
    baselineCost:
      indexSetBitCost(slots.length, changed) +
      changed.length +
      moduleIdentitySequenceBitCost(codec, baselineEntries),
    absoluteCost:
      indexSetBitCost(slots.length, occupied) +
      moduleIdentitySequenceBitCost(codec, absoluteEntries),
  };
}

function writeModuleIdentitySequence(
  codec: CodecContext,
  writer: CodecWriter,
  entries: readonly ModuleIdentityEntry[],
): void {
  if (entries.length === 0) return;
  if (entries.length === 1) {
    const entry = entries[0]!;
    writeModuleIdentity(codec, writer, entry.moduleIndex, entry.context, entry.defaultIndex);
    return;
  }

  const useReferences =
    referencedModuleIdentityBitCost(codec, entries) < plainModuleIdentityBitCost(codec, entries);
  writer.writeBoolean(useReferences);
  if (!useReferences) {
    for (const entry of entries) {
      writeModuleIdentity(codec, writer, entry.moduleIndex, entry.context, entry.defaultIndex);
    }
    return;
  }

  const distinct: number[] = [];
  let previous: number | undefined;
  entries.forEach((entry, index) => {
    if (index > 0) {
      // The "same as previous" flag stays unmodelled deliberately; see `IDENTITY_REPEATED`.
      const sameAsPrevious = entry.moduleIndex === previous;
      writer.writeBoolean(sameAsPrevious);
      if (sameAsPrevious) return;
      const repeated = distinct.includes(entry.moduleIndex);
      writer.writeBoolean(repeated, codec.models?.identityRepeated);
      if (repeated) {
        writeIndexInSet(codec.models?.adaptiveModel(distinct), writer, entry.moduleIndex, distinct);
        previous = entry.moduleIndex;
        return;
      }
    }
    writeModuleIdentity(codec, writer, entry.moduleIndex, entry.context, entry.defaultIndex);
    distinct.push(entry.moduleIndex);
    previous = entry.moduleIndex;
  });
}

function readModuleIdentitySequence(
  codec: CodecContext,
  reader: CodecReader,
  contexts: readonly ModuleIdentityContext[],
): number[] {
  if (contexts.length === 0) return [];
  const useReferences = contexts.length > 1 && reader.readBoolean();
  const modules: number[] = [];
  const distinct: number[] = [];
  let previous: number | undefined;
  for (const [index, context] of contexts.entries()) {
    let moduleIndex: number;
    if (useReferences && index > 0 && reader.readBoolean()) {
      moduleIndex = previous!;
    } else if (useReferences && index > 0 && reader.readBoolean(codec.models?.identityRepeated)) {
      moduleIndex = readIndexFromSet(
        codec,
        reader,
        distinct,
        'module back-reference',
        codec.models?.adaptiveModel(distinct),
      );
      if (moduleIndex === previous) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'A module back-reference is not canonical.',
        );
      }
    } else {
      moduleIndex = readModuleIdentity(codec, reader, context.context, context.defaultIndex);
      if (useReferences && distinct.includes(moduleIndex)) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'A repeated module identity is not canonical.',
        );
      }
      distinct.push(moduleIndex);
    }
    modules.push(moduleIndex);
    previous = moduleIndex;
  }

  return modules;
}

function moduleIdentitySequenceBitCost(
  codec: CodecContext,
  entries: readonly ModuleIdentityEntry[],
): number {
  if (entries.length < 2) return plainModuleIdentityBitCost(codec, entries);
  return (
    1 +
    Math.min(
      plainModuleIdentityBitCost(codec, entries),
      referencedModuleIdentityBitCost(codec, entries),
    )
  );
}

function plainModuleIdentityBitCost(
  codec: CodecContext,
  entries: readonly ModuleIdentityEntry[],
): number {
  return entries.reduce(
    (cost, entry) =>
      cost + moduleIdentityBitCost(codec, entry.moduleIndex, entry.context, entry.defaultIndex),
    0,
  );
}

function referencedModuleIdentityBitCost(
  codec: CodecContext,
  entries: readonly ModuleIdentityEntry[],
): number {
  const distinct: number[] = [];
  let previous: number | undefined;
  return entries.reduce((cost, entry, index) => {
    if (index > 0 && entry.moduleIndex === previous) return cost + 1;
    if (index > 0 && distinct.includes(entry.moduleIndex)) {
      previous = entry.moduleIndex;
      return cost + 2 + contextualIndexBits(distinct.length);
    }
    const prefix = index === 0 ? 0 : 2;
    distinct.push(entry.moduleIndex);
    previous = entry.moduleIndex;
    return (
      cost +
      prefix +
      moduleIdentityBitCost(codec, entry.moduleIndex, entry.context, entry.defaultIndex)
    );
  }, 0);
}

function moduleIdentityBitCost(
  codec: CodecContext,
  moduleIndex: number,
  context: readonly number[],
  defaultIndex: number | null,
): number {
  const defaultBits = defaultIndex === null ? 0 : 1;
  if (defaultIndex === moduleIndex) return defaultBits;
  if (context.length === 0) return defaultBits + codec.moduleBits;
  return (
    defaultBits +
    1 +
    (context.includes(moduleIndex) ? contextualIndexBits(context.length) : codec.moduleBits)
  );
}

function writeModuleIdentity(
  codec: CodecContext,
  writer: CodecWriter,
  moduleIndex: number,
  context: readonly number[],
  defaultIndex: number | null,
): void {
  if (defaultIndex !== null) {
    writer.writeBoolean(moduleIndex === defaultIndex, codec.models?.identityIsDefault);
    if (moduleIndex === defaultIndex) return;
  }
  writeContextualIndex(codec.models, writer, moduleIndex, context, codec.tables.MODULES.length);
}

function readModuleIdentity(
  codec: CodecContext,
  reader: CodecReader,
  context: readonly number[],
  defaultIndex: number | null,
): number {
  if (defaultIndex !== null && reader.readBoolean(codec.models?.identityIsDefault))
    return defaultIndex;
  const moduleIndex = readContextualIndex(codec, reader, context, codec.tables.MODULES.length);
  if (!codec.tables.MODULES[moduleIndex]) throw unknownTableIndex(codec, 'module', moduleIndex);
  return moduleIndex;
}

function writePowerStates(
  models: SymbolModels | null,
  writer: CodecWriter,
  modules: readonly PowerState[],
): void {
  const overrides = indexesWhere(
    modules,
    ({ on, priority }) => on !== undefined || priority !== undefined,
  );
  writer.writeBoolean(overrides.length > 0);
  if (overrides.length === 0) return;

  const mode = powerMode(modules, overrides);
  writer.writeBounded(mode, 3);
  if (mode === 0) {
    writeFixedPowerStates(models, writer, modules);
  } else if (mode === 1) {
    writeIndexSet(writer, modules.length, overrides);
    for (const index of overrides) {
      const module = modules[index]!;
      writer.writeBounded(encodeOn(module.on), 3, models?.powerOn);
      writer.writeBounded(encodePriority(module.priority), 6, models?.powerPriority);
    }
  } else {
    writeBaselinePowerStates(models, writer, modules);
  }
}

function readPowerStates(
  models: SymbolModels | null,
  reader: CodecReader,
  moduleCount: number,
): PowerState[] {
  const states: PowerState[] = Array.from({ length: moduleCount }, () => ({
    on: undefined,
    priority: undefined,
  }));
  if (!reader.readBoolean()) return states;

  const mode = reader.readBounded(3);
  let decoded: PowerState[];
  switch (mode) {
    case 0:
      decoded = readFixedPowerStates(models, reader, moduleCount);
      break;
    case 1:
      for (const index of readIndexSet(reader, moduleCount)) {
        states[index] = {
          on: decodeOn(reader.readBounded(3, models?.powerOn)),
          priority: decodePriority(reader.readBounded(6, models?.powerPriority)),
        };
      }
      decoded = states;
      break;
    case 2:
      decoded = readBaselinePowerStates(models, reader, moduleCount);
      break;
    default:
      throw new BuildLinkCodecError('invalidPayload', 'A power-state mode is invalid.');
  }
  const overrides = indexesWhere(
    decoded,
    ({ on, priority }) => on !== undefined || priority !== undefined,
  );
  if (overrides.length === 0 || mode !== powerMode(decoded, overrides)) {
    throw new BuildLinkCodecError('invalidPayload', 'Power-state mode is not canonical.');
  }
  return decoded;
}

function powerMode(modules: readonly PowerState[], overrides: readonly number[]): 0 | 1 | 2 {
  const costs = [
    fixedPowerBitCost(modules),
    indexSetBitCost(modules.length, overrides) + overrides.length * 5,
    baselinePowerBitCost(modules),
  ];
  return costs.indexOf(Math.min(...costs)) as 0 | 1 | 2;
}

function baselinePowerBitCost(modules: readonly PowerState[]): number {
  const onChanges = indexesWhere(modules, ({ on }) => on !== true);
  const onUniform = onChanges.every((index) => modules[index]!.on === modules[onChanges[0]!]!.on);
  const priorityChanges = indexesWhere(modules, ({ priority }) => priority !== 1);
  const prioritiesDefined = priorityChanges.every(
    (index) => modules[index]!.priority !== undefined,
  );
  return (
    1 +
    (onChanges.length === 0
      ? 0
      : indexSetBitCost(modules.length, onChanges) + 1 + (onUniform ? 1 : onChanges.length)) +
    1 +
    (priorityChanges.length === 0
      ? 0
      : indexSetBitCost(modules.length, priorityChanges) +
        1 +
        priorityChanges.length * (prioritiesDefined ? 2 : 3))
  );
}

function writeBaselinePowerStates(
  models: SymbolModels | null,
  writer: CodecWriter,
  modules: readonly PowerState[],
): void {
  const onChanges = indexesWhere(modules, ({ on }) => on !== true);
  writer.writeBoolean(onChanges.length > 0);
  if (onChanges.length > 0) {
    writeIndexSet(writer, modules.length, onChanges);
    const uniform = onChanges.every((index) => modules[index]!.on === modules[onChanges[0]!]!.on);
    writer.writeBoolean(uniform);
    if (uniform) writer.writeBoolean(modules[onChanges[0]!]!.on === false);
    else for (const index of onChanges) writer.writeBoolean(modules[index]!.on === false);
  }

  const priorityChanges = indexesWhere(modules, ({ priority }) => priority !== 1);
  writer.writeBoolean(priorityChanges.length > 0);
  if (priorityChanges.length > 0) {
    writeIndexSet(writer, modules.length, priorityChanges);
    const allDefined = priorityChanges.every((index) => modules[index]!.priority !== undefined);
    writer.writeBoolean(allDefined);
    for (const index of priorityChanges) {
      const priority = modules[index]!.priority;
      if (allDefined) writer.writeBits(encodeDefinedPriorityDeviation(priority!), 2);
      else writer.writeBounded(encodePriority(priority), 6, models?.powerPriority);
    }
  }
}

function readBaselinePowerStates(
  models: SymbolModels | null,
  reader: CodecReader,
  moduleCount: number,
): PowerState[] {
  const states: PowerState[] = Array.from({ length: moduleCount }, () => ({
    on: true,
    priority: 1,
  }));
  if (reader.readBoolean()) {
    const onChanges = readIndexSet(reader, moduleCount);
    if (onChanges.length === 0) {
      throw new BuildLinkCodecError('invalidPayload', 'A baseline power-state set is empty.');
    }
    const uniform = reader.readBoolean();
    if (uniform) {
      const on = reader.readBoolean() ? false : undefined;
      for (const index of onChanges) states[index]!.on = on;
    } else {
      for (const index of onChanges) states[index]!.on = reader.readBoolean() ? false : undefined;
    }
    const canonicalUniform = onChanges.every(
      (index) => states[index]!.on === states[onChanges[0]!]!.on,
    );
    if (uniform !== canonicalUniform) {
      throw new BuildLinkCodecError(
        'invalidPayload',
        'A baseline enabled-state mode is not canonical.',
      );
    }
  }

  if (reader.readBoolean()) {
    const priorityChanges = readIndexSet(reader, moduleCount);
    if (priorityChanges.length === 0) {
      throw new BuildLinkCodecError('invalidPayload', 'A baseline priority set is empty.');
    }
    const allDefined = reader.readBoolean();
    for (const index of priorityChanges) {
      const priority = allDefined
        ? decodeDefinedPriorityDeviation(reader.readBits(2))
        : decodePriority(reader.readBounded(6, models?.powerPriority));
      if (priority === 1) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'A baseline power-state change restates the default priority.',
        );
      }
      states[index]!.priority = priority;
    }
    const canonicalAllDefined = priorityChanges.every(
      (index) => states[index]!.priority !== undefined,
    );
    if (allDefined !== canonicalAllDefined) {
      throw new BuildLinkCodecError('invalidPayload', 'A baseline priority mode is not canonical.');
    }
  }
  return states;
}

function encodeDefinedPriorityDeviation(priority: number): number {
  if (priority === 0) return 0;
  if (priority >= 2 && priority <= 4) return priority - 1;
  throw new BuildLinkCodecError(
    'invalidPayload',
    'A defined baseline priority deviation must be 0 or from 2 to 4.',
  );
}

function decodeDefinedPriorityDeviation(value: number): number {
  return value === 0 ? 0 : value + 1;
}

function fixedPowerBitCost(modules: readonly PowerState[]): number {
  const on = modules.map((module) => module.on);
  const allOnSame = on.every((value) => value === on[0]);
  const allOnDefined = on.every((value) => value !== undefined);
  const onCost = allOnSame ? 2 : 3 + (allOnDefined ? modules.length : modules.length * 2);
  const priority = modules.map((module) => module.priority);
  const allPrioritiesSame = priority.every((value) => value === priority[0]);
  return onCost + (allPrioritiesSame ? 4 : 1 + modules.length * 3);
}

function writeFixedPowerStates(
  models: SymbolModels | null,
  writer: CodecWriter,
  modules: readonly PowerState[],
): void {
  const on = modules.map((module) => module.on);
  const onMode = on.every((value) => value === undefined)
    ? 0
    : on.every((value) => value === true)
      ? 1
      : on.every((value) => value === false)
        ? 2
        : 3;
  writer.writeBits(onMode, 2);
  if (onMode === 3) {
    const allDefined = on.every((value) => value !== undefined);
    writer.writeBoolean(allDefined);
    for (const value of on) {
      if (allDefined) writer.writeBoolean(value!);
      else writer.writeBounded(encodeOn(value), 3, models?.powerOn);
    }
  }

  const priorities = modules.map((module) => module.priority);
  const uniform = priorities.every((value) => value === priorities[0]);
  writer.writeBoolean(uniform);
  if (uniform) writer.writeBounded(encodePriority(priorities[0]), 6, models?.powerPriority);
  else {
    for (const priority of priorities) {
      writer.writeBounded(encodePriority(priority), 6, models?.powerPriority);
    }
  }
}

function readFixedPowerStates(
  models: SymbolModels | null,
  reader: CodecReader,
  moduleCount: number,
): PowerState[] {
  const onMode = reader.readBits(2);
  let on: Array<boolean | undefined>;
  if (onMode === 0) on = Array<boolean | undefined>(moduleCount).fill(undefined);
  else if (onMode === 1) on = Array<boolean | undefined>(moduleCount).fill(true);
  else if (onMode === 2) on = Array<boolean | undefined>(moduleCount).fill(false);
  else {
    const allDefined = reader.readBoolean();
    on = allDefined
      ? Array.from({ length: moduleCount }, () => reader.readBoolean())
      : Array.from({ length: moduleCount }, () => decodeOn(reader.readBounded(3, models?.powerOn)));
    if (allDefined !== on.every((value) => value !== undefined)) {
      throw new BuildLinkCodecError(
        'invalidPayload',
        'A fixed enabled-state definition mode is not canonical.',
      );
    }
    if (on.every((value) => value === on[0])) {
      throw new BuildLinkCodecError(
        'invalidPayload',
        'A uniform enabled state must use its fixed mode.',
      );
    }
  }
  const uniformPriority = reader.readBoolean();
  const priority = uniformPriority
    ? Array<number | undefined>(moduleCount).fill(
        decodePriority(reader.readBounded(6, models?.powerPriority)),
      )
    : Array.from({ length: moduleCount }, () =>
        decodePriority(reader.readBounded(6, models?.powerPriority)),
      );
  if (uniformPriority !== priority.every((value) => value === priority[0])) {
    throw new BuildLinkCodecError('invalidPayload', 'A fixed priority mode is not canonical.');
  }
  return on.map((value, index) => ({ on: value, priority: priority[index] }));
}

function writeEngineeringStates(
  codec: CodecContext,
  writer: CodecWriter,
  states: readonly (CodecEngineeringState | undefined)[],
  moduleIndexes: readonly (number | null)[],
  occupiedSlots: readonly number[],
  occupiedSlotNames: readonly string[],
): void {
  const engineered = indexesWhere(states, (engineering) => engineering !== undefined);
  writer.writeBoolean(engineered.length > 0);
  if (engineered.length === 0) return;

  const eligible = engineeringEligibleIndexes(codec, moduleIndexes, occupiedSlots);
  const ineligible = engineered.find((occupiedIndex) => !eligible.includes(occupiedIndex));
  if (ineligible !== undefined) {
    const slot = occupiedSlotNames[ineligible];
    const symbol = codec.tables.MODULES[moduleIndexes[occupiedSlots[ineligible]!]!] ?? 'the module';
    throw new BuildLinkCodecError(
      'invalidPayload',
      `${slot === undefined ? '' : `Slot ${slot}: `}${symbol} carries engineering, but codec ` +
        `table ${codec.tableVersion} records no engineering recipe for it.`,
    );
  }
  const all = engineered.length === eligible.length;
  writer.writeBoolean(all);
  if (!all) {
    writeIndexSet(
      writer,
      eligible.length,
      engineered.map((occupiedIndex) => eligible.indexOf(occupiedIndex)),
    );
  }
  const records = engineered.map((occupiedIndex) => ({
    moduleIndex: moduleIndexes[occupiedSlots[occupiedIndex]!]!,
    engineering: states[occupiedIndex]!,
  }));
  const references = engineeringReferences(records);
  const plainCost = records.reduce(
    (cost, record) => cost + engineeringRecordBitCost(codec, record),
    0,
  );
  const referenceCost = records.reduce((cost, record, index) => {
    const { dictionarySize, reference } = references[index]!;
    return (
      cost +
      (dictionarySize === 0 ? 0 : 1) +
      (reference === null
        ? engineeringRecordBitCost(codec, record)
        : contextualIndexBits(dictionarySize))
    );
  }, 0);
  const useReferences = records.length > 1 && referenceCost < plainCost;
  if (records.length > 1) writer.writeBoolean(useReferences);

  for (const [index, { moduleIndex, engineering }] of records.entries()) {
    const { dictionary, dictionarySize, reference } = references[index]!;
    if (useReferences && dictionarySize > 0) {
      writer.writeBoolean(reference !== null, codec.models?.engineeringReference);
      if (reference !== null) {
        if (dictionarySize > 1) {
          writer.writeBounded(reference, dictionarySize, codec.models?.adaptiveModel(dictionary));
        }
        continue;
      }
    }
    writeEngineering(codec, writer, moduleIndex, engineering);
  }
}

function readEngineeringStates(
  codec: CodecContext,
  reader: CodecReader,
  moduleIndexes: readonly (number | null)[],
  occupiedSlots: readonly number[],
): Array<CodecEngineeringState | undefined> {
  const states: Array<CodecEngineeringState | undefined> = occupiedSlots.map(() => undefined);
  if (!reader.readBoolean()) return states;

  const eligible = engineeringEligibleIndexes(codec, moduleIndexes, occupiedSlots);
  const all = reader.readBoolean();
  const engineered = all
    ? eligible
    : readIndexSet(reader, eligible.length).map((index) => eligible[index]!);
  const useReferences = engineered.length > 1 && reader.readBoolean();
  const dictionaries = new EngineeringDictionaries();
  for (const [recordIndex, occupiedIndex] of engineered.entries()) {
    const moduleIndex = moduleIndexes[occupiedSlots[occupiedIndex]!]!;
    const dictionary = dictionaries.forModule(moduleIndex);
    const dictionarySize = dictionary.entries.length;
    if (
      useReferences &&
      dictionarySize > 0 &&
      reader.readBoolean(codec.models?.engineeringReference)
    ) {
      const reference =
        dictionarySize === 1
          ? 0
          : reader.readBounded(dictionarySize, codec.models?.adaptiveModel(dictionary.entries));
      const referenced = dictionary.states[reference];
      if (referenced === undefined) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'An engineering back-reference is invalid.',
        );
      }
      states[occupiedIndex] = referenced;
      continue;
    }

    const engineering = readEngineering(codec, reader, moduleIndex);
    if (useReferences && engineering.kind === 'ordinary') {
      const key = engineeringStateKey(engineering);
      if (dictionary.keys.includes(key)) {
        throw new BuildLinkCodecError(
          'invalidPayload',
          'A repeated engineering record is not canonical.',
        );
      }
      dictionary.keys.push(key);
      dictionary.entries.push(recordIndex);
      dictionary.states.push(engineering);
    }
    states[occupiedIndex] = engineering;
  }
  return states;
}

function engineeringStateKey(engineering: OrdinaryEngineeringState): string {
  return JSON.stringify([engineering.blueprint, engineering.level, engineering.experimental]);
}

type EngineeringRecord = {
  readonly moduleIndex: number;
  readonly engineering: CodecEngineeringState;
};

/**
 * The distinct ordinary records already written for one fitted module, in the order they first
 * appeared. Keying the dictionary on the module rather than the whole build is what makes a
 * reference cheap: a mount repeats its own roll — eight identical shield boosters, a rack of one
 * weapon — far more often than two different modules happen to carry the same record, and an
 * index into one module's short list costs a fraction of an index into every record in the
 * build. Each module also owns its adaptive context for free, because the context is keyed by
 * the identity of the dictionary array.
 */
type EngineeringDictionary = {
  /** Record index of each entry; its array identity keys the module's adaptive context. */
  readonly entries: number[];
  readonly keys: string[];
  readonly states: CodecEngineeringState[];
};

class EngineeringDictionaries {
  private readonly byModule = new Map<number, EngineeringDictionary>();

  forModule(moduleIndex: number): EngineeringDictionary {
    let dictionary = this.byModule.get(moduleIndex);
    if (dictionary === undefined) {
      dictionary = { entries: [], keys: [], states: [] };
      this.byModule.set(moduleIndex, dictionary);
    }
    return dictionary;
  }
}

type EngineeringReference = {
  /** The module's dictionary array, whose identity keys its adaptive context. */
  readonly dictionary: readonly number[];
  /** How many entries that dictionary holds when this record is written. */
  readonly dictionarySize: number;
  /** Position of this record in the dictionary, or null when it is written out in full. */
  readonly reference: number | null;
};

function engineeringReferences(records: readonly EngineeringRecord[]): EngineeringReference[] {
  const dictionaries = new EngineeringDictionaries();
  return records.map(({ moduleIndex, engineering }, index) => {
    const dictionary = dictionaries.forModule(moduleIndex);
    const dictionarySize = dictionary.entries.length;
    // A pre-engineered record carries an identity rather than a state, so it never joins a
    // dictionary and never refers back to one.
    if (engineering.kind !== 'ordinary') {
      return { dictionary: dictionary.entries, dictionarySize, reference: null };
    }
    const key = engineeringStateKey(engineering);
    const reference = dictionary.keys.indexOf(key);
    if (reference === -1) {
      dictionary.keys.push(key);
      dictionary.entries.push(index);
      dictionary.states.push(engineering);
    }
    return {
      dictionary: dictionary.entries,
      dictionarySize,
      reference: reference === -1 ? null : reference,
    };
  });
}

function engineeringRecordBitCost(codec: CodecContext, record: EngineeringRecord): number {
  const writer = new SymbolWriter();
  writeEngineering(codec, writer, record.moduleIndex, record.engineering);
  return writer.length;
}

function engineeringEligibleIndexes(
  codec: CodecContext,
  moduleIndexes: readonly (number | null)[],
  occupiedSlots: readonly number[],
): number[] {
  return indexesWhere(occupiedSlots, (slotIndex) => {
    const moduleIndex = moduleIndexes[slotIndex]!;
    return (
      blueprintSetForModule(codec, moduleIndex).length > 0 ||
      preEngineeredSetForModule(codec, moduleIndex).length > 0
    );
  });
}

function writeIndexSet(writer: CodecWriter, valueCount: number, indexes: readonly number[]): void {
  const mode = indexSetMode(valueCount, indexes);
  writer.writeBits(mode, 2);
  if (mode === 0) {
    const included = new Set(indexes);
    for (let index = 0; index < valueCount; index += 1) {
      writer.writeBoolean(included.has(index));
    }
    return;
  }

  if (mode === 3) {
    writer.writeBounded(indexes.length, valueCount + 1);
    const combinations = combinationCount(valueCount, indexes.length);
    const width = combinationRankWidth(combinations);
    if (width > 0) {
      writer.writeBounded(combinationRank(valueCount, indexes), combinations);
    }
    return;
  }

  const encodedIndexes =
    mode === 1
      ? indexes
      : indexesWhere(
          Array.from({ length: valueCount }, () => false),
          (_value, index) => !indexes.includes(index),
        );
  writer.writeBounded(encodedIndexes.length, valueCount + 1);
  for (const index of encodedIndexes) writer.writeBounded(index, valueCount);
}

function readIndexSet(reader: CodecReader, valueCount: number): number[] {
  const mode = reader.readBits(2);
  let indexes: number[];
  if (mode === 0) {
    indexes = [];
    for (let index = 0; index < valueCount; index += 1) {
      if (reader.readBoolean()) indexes.push(index);
    }
  } else if (mode === 1 || mode === 2) {
    const encodedIndexes = readSparseIndexes(reader, valueCount);
    indexes =
      mode === 1
        ? encodedIndexes
        : indexesWhere(
            Array.from({ length: valueCount }, () => false),
            (_value, index) => !encodedIndexes.includes(index),
          );
  } else {
    const count = reader.readBounded(valueCount + 1);
    if (count > valueCount) {
      throw new BuildLinkCodecError('invalidPayload', 'An index set contains too many values.');
    }
    const combinations = combinationCount(valueCount, count);
    const width = combinationRankWidth(combinations);
    const rank = width === 0 ? 0 : reader.readBounded(combinations);
    if (rank >= combinations) {
      throw new BuildLinkCodecError('invalidPayload', 'An index-set rank is invalid.');
    }
    indexes = combinationUnrank(valueCount, count, rank);
  }
  return indexes;
}

function indexSetBitCost(valueCount: number, indexes: readonly number[]): number {
  return 2 + indexSetDataBitCost(valueCount, indexes, indexSetMode(valueCount, indexes));
}

function indexSetMode(valueCount: number, indexes: readonly number[]): 0 | 1 | 2 | 3 {
  return indexSetModeForCount(valueCount, indexes.length);
}

function indexSetModeForCount(valueCount: number, selectedCount: number): 0 | 1 | 2 | 3 {
  // A one-value universe is a one-bit bitmap. Sparse modes would otherwise win only by a
  // tie-break and then attempt to emit a bounded symbol with a cardinality of one.
  if (valueCount <= 1) return 0;
  const costs = [
    indexSetDataBitCostForCount(valueCount, selectedCount, 0),
    indexSetDataBitCostForCount(valueCount, selectedCount, 1),
    indexSetDataBitCostForCount(valueCount, selectedCount, 2),
    indexSetDataBitCostForCount(valueCount, selectedCount, 3),
  ];
  const minimum = Math.min(...costs);
  return costs.indexOf(minimum) as 0 | 1 | 2 | 3;
}

function indexSetDataBitCost(
  valueCount: number,
  indexes: readonly number[],
  mode: 0 | 1 | 2 | 3,
): number {
  return indexSetDataBitCostForCount(valueCount, indexes.length, mode);
}

function indexSetDataBitCostForCount(
  valueCount: number,
  selectedCount: number,
  mode: 0 | 1 | 2 | 3,
): number {
  if (mode === 0) return valueCount;
  if (mode === 3) {
    const rankWidth = combinationRankWidth(combinationCount(valueCount, selectedCount));
    return rankWidth <= 31 ? bitsRequired(valueCount + 1) + rankWidth : Number.POSITIVE_INFINITY;
  }
  const encodedCount = mode === 1 ? selectedCount : valueCount - selectedCount;
  return bitsRequired(valueCount + 1) + encodedCount * bitsRequired(valueCount);
}

function combinationCount(valueCount: number, selectedCount: number): number {
  const smaller = Math.min(selectedCount, valueCount - selectedCount);
  let result = 1;
  for (let index = 1; index <= smaller; index += 1) {
    result = (result * (valueCount - smaller + index)) / index;
  }
  return Math.round(result);
}

function combinationRank(valueCount: number, indexes: readonly number[]): number {
  let rank = 0;
  let previous = -1;
  for (let position = 0; position < indexes.length; position += 1) {
    for (let candidate = previous + 1; candidate < indexes[position]!; candidate += 1) {
      rank += combinationCount(valueCount - candidate - 1, indexes.length - position - 1);
    }
    previous = indexes[position]!;
  }
  return rank;
}

function combinationRankWidth(combinations: number): number {
  return combinations <= 1 ? 0 : Math.ceil(Math.log2(combinations));
}

function combinationUnrank(valueCount: number, selectedCount: number, rank: number): number[] {
  const indexes: number[] = [];
  let previous = -1;
  for (let position = 0; position < selectedCount; position += 1) {
    for (let candidate = previous + 1; candidate < valueCount; candidate += 1) {
      const count = combinationCount(valueCount - candidate - 1, selectedCount - position - 1);
      if (rank < count) {
        indexes.push(candidate);
        previous = candidate;
        break;
      }
      rank -= count;
    }
  }
  return indexes;
}

function readSparseIndexes(reader: CodecReader, valueCount: number): number[] {
  const count = reader.readBounded(valueCount + 1);
  if (count > valueCount) {
    throw new BuildLinkCodecError('invalidPayload', 'An index set contains too many values.');
  }
  const indexes: number[] = [];
  for (let position = 0; position < count; position += 1) {
    const index = reader.readBounded(valueCount);
    if (index >= valueCount || (indexes.at(-1) ?? -1) >= index) {
      throw new BuildLinkCodecError('invalidPayload', 'An index set is not strictly ordered.');
    }
    indexes.push(index);
  }
  return indexes;
}

function writeContextualIndex(
  models: SymbolModels | null,
  writer: CodecWriter,
  value: number,
  context: readonly number[],
  globalValueCount: number,
): void {
  if (context.length === 0) {
    writer.writeBounded(value, globalValueCount);
    return;
  }
  const contextualIndex = context.indexOf(value);
  writer.writeBoolean(contextualIndex !== -1, models?.contextHit);
  if (contextualIndex === -1) writer.writeBounded(value, globalValueCount);
  else if (context.length > 1) {
    writer.writeBounded(contextualIndex, context.length, models?.contextModel(context));
  }
}

function readContextualIndex(
  codec: CodecContext,
  reader: CodecReader,
  context: readonly number[],
  globalValueCount: number,
): number {
  if (context.length === 0) return reader.readBounded(globalValueCount);
  if (reader.readBoolean(codec.models?.contextHit)) {
    return readIndexFromSet(
      codec,
      reader,
      context,
      'contextual identity',
      codec.models?.contextModel(context),
    );
  }
  const value = reader.readBounded(globalValueCount);
  if (context.includes(value)) {
    throw new BuildLinkCodecError('invalidPayload', 'A contextual identity is not canonical.');
  }
  return value;
}

function readIndexFromSet(
  codec: CodecContext,
  reader: CodecReader,
  context: readonly number[],
  kind: string,
  model?: BoundedSymbolModel,
): number {
  const width = contextualIndexBits(context.length);
  const contextualIndex = width === 0 ? 0 : reader.readBounded(context.length, model);
  const value = context[contextualIndex];
  if (value === undefined) throw unknownTableIndex(codec, kind, contextualIndex);
  return value;
}

function writeIndexInSet(
  model: BoundedSymbolModel | undefined,
  writer: CodecWriter,
  value: number,
  context: readonly number[],
): void {
  const contextualIndex = context.indexOf(value);
  if (contextualIndex === -1) {
    throw new BuildLinkCodecError(
      'unknownIdentity',
      `The identity is absent from its contextual set.`,
    );
  }
  const width = contextualIndexBits(context.length);
  if (width > 0) writer.writeBounded(contextualIndex, context.length, model);
}

function contextualIndexBits(valueCount: number): number {
  return valueCount <= 1 ? 0 : bitsRequired(valueCount);
}

function moduleSetForSlot(
  codec: CodecContext,
  ship: CodecShip,
  slotIndex: number,
): readonly number[] {
  const setIndex = codec.tables.MODULE_SET_BY_SHIP[ship][slotIndex];
  const set = codec.tables.MODULE_SETS[setIndex];
  if (!set) throw unknownTableIndex(codec, 'module candidate set', setIndex);
  return set;
}

function blueprintSetForModule(codec: CodecContext, moduleIndex: number): readonly number[] {
  const setIndex = codec.tables.BLUEPRINT_SET_BY_MODULE[moduleIndex];
  const set = setIndex === undefined ? undefined : codec.tables.BLUEPRINT_SETS[setIndex];
  if (!set) throw unknownTableIndex(codec, 'blueprint set', setIndex ?? -1);
  return set;
}

function experimentalSetForModule(codec: CodecContext, moduleIndex: number): readonly number[] {
  const setIndex = codec.tables.EXPERIMENTAL_SET_BY_MODULE[moduleIndex];
  const set = setIndex === undefined ? undefined : codec.tables.EXPERIMENTAL_SETS[setIndex];
  if (!set) throw unknownTableIndex(codec, 'experimental-effect set', setIndex ?? -1);
  return set;
}

function preEngineeredSetForModule(codec: CodecContext, moduleIndex: number): readonly number[] {
  return codec.tables.PRE_ENGINEERED_SET_BY_MODULE[moduleIndex] ?? [];
}

function resolvePreEngineeredVariant(codec: CodecContext, index: number): PreEngineeredVariant {
  const identity = codec.tables.PRE_ENGINEERED_VARIANTS[index];
  if (!identity) throw unknownTableIndex(codec, 'pre-engineered variant', index);
  const symbol = codec.tables.MODULES[identity.module];
  const blueprint = codec.tables.BLUEPRINTS[identity.blueprint];
  const variant = PRE_ENGINEERED_MODULES.find(
    (candidate) =>
      normalise(candidate.symbol) === normalise(symbol) &&
      normalise(candidate.blueprintSymbol) === normalise(blueprint) &&
      candidate.grade === identity.grade &&
      candidate.acquisition === identity.acquisition,
  );
  if (!variant) throw unknownTableIndex(codec, 'pre-engineered variant', index);
  return variant;
}

function preEngineeredVariantIndex(codec: CodecContext, variant: PreEngineeredVariant): number {
  const module = codec.moduleIndex.get(normalise(variant.symbol));
  const blueprint = codec.blueprintIndex.get(normalise(variant.blueprintSymbol));
  if (module === undefined || blueprint === undefined) return -1;
  return codec.tables.PRE_ENGINEERED_VARIANTS.findIndex(
    (identity) =>
      identity.module === module &&
      identity.blueprint === blueprint &&
      identity.grade === variant.grade &&
      identity.acquisition === variant.acquisition,
  );
}

function pinnedPreEngineeredExperimentalIndex(codec: CodecContext, index: number): number | null {
  const experimental = codec.tables.PRE_ENGINEERED_VARIANTS[index]?.experimental;
  if (experimental === null) return null;
  if (experimental === undefined || !codec.tables.EXPERIMENTAL_EFFECTS[experimental]) {
    throw unknownTableIndex(codec, 'pre-engineered experimental effect', experimental ?? -1);
  }
  return experimental;
}

function resolvePreEngineeredEngineering(
  codec: CodecContext,
  engineering: PreEngineeredState,
): ModuleEngineering {
  const variant = resolvePreEngineeredVariant(codec, engineering.variant);
  const experimental =
    engineering.experimental === null
      ? undefined
      : codec.tables.EXPERIMENTAL_EFFECTS[engineering.experimental];
  if (engineering.experimental !== null && experimental === undefined) {
    throw unknownTableIndex(codec, 'experimental effect', engineering.experimental);
  }
  const resolvedVariant = {
    ...variant,
    ...(experimental === undefined
      ? { experimentalEffectSymbol: undefined }
      : { experimentalEffectSymbol: experimental }),
  } as PreEngineeredVariant;
  const modifiers = getPreEngineeredJournalModifiers(resolvedVariant);
  return {
    BlueprintName: variant.blueprintSymbol,
    Level: variant.grade,
    Quality: 1,
    ...(experimental === undefined ? {} : { ExperimentalEffect: experimental }),
    ...(modifiers.length === 0 ? {} : { Modifiers: modifiers }),
  };
}

/**
 * Whether a pre-engineered record would reconstruct the engineering a module actually carries.
 *
 * The record carries an identity, not a state: decoding replays the variant's own grade and the
 * modifier block the package publishes for it, composed with any experimental effect. That is
 * sufficient for every acquisition the package identifies *by* that block — a reward article is
 * recognised from its stat signature, so a module carrying the identity carries the state, and the
 * record restores exactly what identified it.
 *
 * A Mercenary article is the exception, because it is the one identified from a blueprint instead.
 * Its identity therefore says nothing about its state, and it can hold engineering the record
 * cannot describe: the purchase-exclusive blueprint crafts grades 2 to 5 with the identity
 * surviving the upgrade. For those the record is used only where it reproduces the module's
 * engineering. A capture stating modifiers has to state the ones the record replays. A capture
 * stating none says nothing the record can contradict — the Almanac reads the purchase untouched
 * either way and derives the same article — so the record reproduces it. A capture out of an
 * exchange that keeps only the blueprint and the grade arrives that way, and the ordinary record
 * cannot rescue it: the purchase-exclusive blueprint sells at a grade its own crafting menu does
 * not offer.
 *
 * Anything else takes the ordinary record — blueprint and grade, with the Almanac re-deriving the
 * purchase identity on reconstruction — and where that cannot spell the module the encoder refuses.
 * A link that opens as a different build than the one shared is worse than no link.
 */
function preEngineeredRecordReproduces(
  codec: CodecContext,
  record: PreEngineeredState,
  engineering: ModuleEngineering,
  variant: PreEngineeredVariant,
): boolean {
  if (engineering.Level !== variant.grade) return false;
  if (variant.acquisition !== 'mercenary') return true;
  if ((engineering.Modifiers ?? []).length === 0) return true;
  return sameModifiers(
    resolvePreEngineeredEngineering(codec, record).Modifiers,
    engineering.Modifiers,
  );
}

function sameModifiers(
  left: ModuleEngineering['Modifiers'],
  right: ModuleEngineering['Modifiers'],
): boolean {
  const signature = (modifiers: ModuleEngineering['Modifiers']): string =>
    [...(modifiers ?? [])]
      .map((modifier) => `${normalise(String(modifier.Label))}=${String(modifier.Value)}`)
      .sort()
      .join('|');
  return signature(left) === signature(right);
}

function indexesWhere<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => boolean,
): number[] {
  const indexes: number[] = [];
  values.forEach((value, index) => {
    if (predicate(value, index)) indexes.push(index);
  });
  return indexes;
}

function moduleAt<T>(modules: ReadonlyMap<string, T>, slot: string | undefined): T | undefined {
  return slot === undefined ? undefined : modules.get(slot);
}

function engineeringStateFromModule(
  codec: CodecContext,
  moduleIndex: number,
  module: CodecFittedModule,
): CodecEngineeringState {
  const engineering = module.engineering!;
  if (engineering.Level === undefined) {
    throw new BuildLinkCodecError(
      'invalidPayload',
      `Slot ${module.slot}: ordinary and pre-engineered state requires a grade.`,
    );
  }
  const preEngineeredIndex =
    module.preEngineeredVariant === null
      ? -1
      : preEngineeredVariantIndex(codec, module.preEngineeredVariant);
  if (module.preEngineeredVariant !== null && preEngineeredIndex === -1) {
    throw new BuildLinkCodecError(
      'unknownIdentity',
      `Slot ${module.slot}: the pre-engineered variant fitted to ${module.symbol} is absent from ` +
        `codec table ${codec.tableVersion}.`,
    );
  }
  const experimental =
    engineering.ExperimentalEffect === undefined
      ? null
      : requireIdentity(
          codec,
          codec.experimentalIndex,
          engineering.ExperimentalEffect,
          'experimental effect',
          module.slot,
        );
  const variant = module.preEngineeredVariant;
  if (variant !== null && preEngineeredIndex !== -1) {
    const record = {
      kind: 'preEngineered',
      variant: preEngineeredIndex,
      experimental,
    } as const;
    if (preEngineeredRecordReproduces(codec, record, engineering, variant)) {
      if (!preEngineeredSetForModule(codec, moduleIndex).includes(preEngineeredIndex)) {
        throw new BuildLinkCodecError(
          'unknownIdentity',
          `Slot ${module.slot}: the pre-engineered variant is unavailable for ${module.symbol}.`,
        );
      }
      return record;
    }
    // The record cannot restore this module, so the ordinary record must. Where the module has no
    // ordinary blueprint set the ordinary record cannot name a blueprint for it either, and the
    // refusal belongs here, where the slot is known, rather than as an unattributed error later.
    if (blueprintSetForModule(codec, moduleIndex).length === 0) {
      throw new BuildLinkCodecError(
        'unknownIdentity',
        `Slot ${module.slot}: codec table ${codec.tableVersion} records no ordinary blueprint for ` +
          `${module.symbol}, so its engineering cannot be encoded apart from the ` +
          `${variant.acquisition} variant's own.`,
      );
    }
  }

  const blueprint = requireIdentity(
    codec,
    codec.blueprintIndex,
    engineering.BlueprintName,
    'engineering blueprint',
    module.slot,
  );
  const grades = codec.tables.BLUEPRINT_GRADES[blueprint] as readonly number[];
  if (!Number.isInteger(engineering.Level) || !grades.includes(engineering.Level)) {
    throw new BuildLinkCodecError(
      'invalidPayload',
      `Slot ${module.slot}: grade ${engineering.Level} is unavailable for blueprint ` +
        `${engineering.BlueprintName}.`,
    );
  }
  return {
    kind: 'ordinary',
    blueprint,
    level: engineering.Level,
    experimental,
  };
}

function writeEngineering(
  codec: CodecContext,
  writer: CodecWriter,
  moduleIndex: number,
  engineering: CodecEngineeringState,
): void {
  const ordinaryAvailable = blueprintSetForModule(codec, moduleIndex).length > 0;
  const preEngineeredAvailable = preEngineeredSetForModule(codec, moduleIndex).length > 0;
  const special = engineering.kind === 'preEngineered';
  if (special && !preEngineeredAvailable) {
    throw new BuildLinkCodecError(
      'unknownIdentity',
      'The pre-engineered variant is unavailable for its fitted module.',
    );
  }
  if (!special && !ordinaryAvailable) {
    throw new BuildLinkCodecError(
      'unknownIdentity',
      'Ordinary engineering is unavailable for its fitted module.',
    );
  }
  if (ordinaryAvailable && preEngineeredAvailable) writer.writeBoolean(special);
  if (engineering.kind === 'preEngineered') {
    if (!preEngineeredSetForModule(codec, moduleIndex).includes(engineering.variant)) {
      throw new BuildLinkCodecError(
        'unknownIdentity',
        'The pre-engineered variant is unavailable for its fitted module.',
      );
    }
    const preEngineeredSet = preEngineeredSetForModule(codec, moduleIndex);
    writeIndexInSet(
      codec.models?.contextModel(preEngineeredSet),
      writer,
      engineering.variant,
      preEngineeredSet,
    );
    writeExperimentalWithDefault(
      codec,
      writer,
      moduleIndex,
      engineering.experimental,
      pinnedPreEngineeredExperimentalIndex(codec, engineering.variant),
    );
    return;
  }

  const grades = codec.tables.BLUEPRINT_GRADES[engineering.blueprint] as readonly number[];
  const maximumGrade = grades.at(-1)!;
  if (!Number.isInteger(engineering.level) || !grades.includes(engineering.level)) {
    throw new BuildLinkCodecError(
      'invalidPayload',
      'Engineering grade is unavailable for its blueprint.',
    );
  }
  writeContextualIndex(
    codec.models,
    writer,
    engineering.blueprint,
    blueprintSetForModule(codec, moduleIndex),
    codec.tables.BLUEPRINTS.length,
  );
  if (grades.length > 1) {
    writer.writeBoolean(engineering.level === maximumGrade, codec.models?.gradeIsMax);
    if (engineering.level !== maximumGrade && grades.length > 2) {
      writer.writeBounded(grades.indexOf(engineering.level), grades.length - 1);
    }
  }
  writeExperimental(codec, writer, moduleIndex, engineering.experimental);
}

function readEngineering(
  codec: CodecContext,
  reader: CodecReader,
  moduleIndex: number,
): CodecEngineeringState {
  const ordinaryAvailable = blueprintSetForModule(codec, moduleIndex).length > 0;
  const preEngineeredAvailable = preEngineeredSetForModule(codec, moduleIndex).length > 0;
  const special = preEngineeredAvailable && (!ordinaryAvailable || reader.readBoolean());
  if (special) {
    const preEngineeredSet = preEngineeredSetForModule(codec, moduleIndex);
    const variantIndex = readIndexFromSet(
      codec,
      reader,
      preEngineeredSet,
      'pre-engineered variant',
      codec.models?.contextModel(preEngineeredSet),
    );
    const experimental = readExperimentalWithDefault(
      codec,
      reader,
      moduleIndex,
      pinnedPreEngineeredExperimentalIndex(codec, variantIndex),
    );
    return {
      kind: 'preEngineered',
      variant: variantIndex,
      experimental,
    };
  }

  const blueprintIndex = readContextualIndex(
    codec,
    reader,
    blueprintSetForModule(codec, moduleIndex),
    codec.tables.BLUEPRINTS.length,
  );
  if (!codec.tables.BLUEPRINTS[blueprintIndex]) {
    throw unknownTableIndex(codec, 'engineering blueprint', blueprintIndex);
  }
  const grades = codec.tables.BLUEPRINT_GRADES[blueprintIndex] as readonly number[];
  const maximumGrade = grades.at(-1)!;
  let level = maximumGrade;
  if (grades.length > 1 && !reader.readBoolean(codec.models?.gradeIsMax)) {
    const gradeIndex = grades.length === 2 ? 0 : reader.readBounded(grades.length - 1);
    if (gradeIndex >= grades.length - 1) {
      throw new BuildLinkCodecError(
        'invalidPayload',
        'Engineering grade encoding is not canonical.',
      );
    }
    level = grades[gradeIndex];
  }
  if (level === undefined) throw unknownTableIndex(codec, 'engineering grade', -1);

  const experimental = readExperimental(codec, reader, moduleIndex);
  return {
    kind: 'ordinary',
    blueprint: blueprintIndex,
    level,
    experimental,
  };
}

function writeExperimental(
  codec: CodecContext,
  writer: CodecWriter,
  moduleIndex: number,
  experimental: number | null,
): void {
  writer.writeBoolean(experimental !== null, codec.models?.experimentalPresent);
  if (experimental === null) return;
  writeContextualIndex(
    codec.models,
    writer,
    experimental,
    experimentalSetForModule(codec, moduleIndex),
    codec.tables.EXPERIMENTAL_EFFECTS.length,
  );
}

function readExperimental(
  codec: CodecContext,
  reader: CodecReader,
  moduleIndex: number,
): number | null {
  if (!reader.readBoolean(codec.models?.experimentalPresent)) return null;
  const experimentalIndex = readContextualIndex(
    codec,
    reader,
    experimentalSetForModule(codec, moduleIndex),
    codec.tables.EXPERIMENTAL_EFFECTS.length,
  );
  if (!codec.tables.EXPERIMENTAL_EFFECTS[experimentalIndex]) {
    throw unknownTableIndex(codec, 'experimental effect', experimentalIndex);
  }
  return experimentalIndex;
}

function writeExperimentalWithDefault(
  codec: CodecContext,
  writer: CodecWriter,
  moduleIndex: number,
  experimental: number | null,
  defaultEffect: number | null,
): void {
  if (defaultEffect === null) {
    writeExperimental(codec, writer, moduleIndex, experimental);
    return;
  }
  const matchesDefault = experimental === defaultEffect;
  writer.writeBoolean(!matchesDefault);
  if (!matchesDefault) writeExperimental(codec, writer, moduleIndex, experimental);
}

function readExperimentalWithDefault(
  codec: CodecContext,
  reader: CodecReader,
  moduleIndex: number,
  defaultEffect: number | null,
): number | null {
  if (defaultEffect === null) return readExperimental(codec, reader, moduleIndex);
  return reader.readBoolean() ? readExperimental(codec, reader, moduleIndex) : defaultEffect;
}

function encodeOn(value: boolean | undefined): number {
  return value === undefined ? 0 : value ? 2 : 1;
}

function decodeOn(value: number): boolean | undefined {
  if (value === 0) return undefined;
  if (value === 1) return false;
  if (value === 2) return true;
  throw new BuildLinkCodecError('invalidPayload', 'A module enabled state is invalid.');
}

function encodePriority(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new BuildLinkCodecError('invalidPayload', 'A module priority is invalid.');
  }
  return value + 1;
}

function decodePriority(value: number): number | undefined {
  if (value === 0) return undefined;
  if (value <= 5) return value - 1;
  throw new BuildLinkCodecError('invalidPayload', 'A module priority is invalid.');
}

function createIndex(values: readonly string[]): Map<string, number> {
  return new Map(values.map((value, index) => [normalise(value), index]));
}

function requireIdentity(
  codec: CodecContext,
  index: ReadonlyMap<string, number>,
  value: string,
  kind: string,
  slot?: string,
): number {
  const result = index.get(normalise(value));
  if (result === undefined) {
    throw new BuildLinkCodecError(
      'unknownIdentity',
      `${slot === undefined ? '' : `Slot ${slot}: `}${kind} identity ${value} is absent from ` +
        `codec table ${codec.tableVersion}.`,
      { slot: slot ?? null },
    );
  }
  return result;
}

function unknownTableIndex(codec: CodecContext, kind: string, index: number): BuildLinkCodecError {
  return new BuildLinkCodecError(
    'unknownIdentity',
    `${kind} index ${index} is absent from codec table ${codec.tableVersion}.`,
  );
}

function normalise(value: string): string {
  return value.toLowerCase();
}

type EncodedSymbol = {
  readonly value: number;
  readonly valueCount: number;
  /** The symbol's model, if any; only the arithmetic renderer reads it. */
  readonly model?: BoundedSymbolModel;
};

interface CodecWriter {
  writeBoolean(value: boolean, model?: BoundedSymbolModel): void;
  writeBits(value: number, width: number): void;
  writeBounded(value: number, valueCount: number, model?: BoundedSymbolModel): void;
  writeString(value: string, characters?: readonly number[]): void;
}

interface CodecReader {
  readBoolean(model?: BoundedSymbolModel): boolean;
  readBits(width: number): number;
  readBounded(valueCount: number, model?: BoundedSymbolModel): number;
  readString(characters?: readonly number[]): string;
}

class SymbolWriter implements CodecWriter {
  readonly symbols: EncodedSymbol[] = [];
  private bitLength = 0;

  get length(): number {
    return this.bitLength;
  }

  writeBoolean(value: boolean, model?: BoundedSymbolModel): void {
    this.writeSymbol(value ? 1 : 0, 2, model);
  }

  writeBits(value: number, width: number): void {
    if (!Number.isInteger(width) || width < 1 || width > 31) {
      throw new BuildLinkCodecError('invalidPayload', 'A bit width is invalid.');
    }
    this.writeSymbol(value, 2 ** width);
  }

  writeBounded(value: number, valueCount: number, model?: BoundedSymbolModel): void {
    this.writeSymbol(value, valueCount, model);
  }

  writeString(value: string, characters?: readonly number[]): void {
    if (!isWellFormedUnicode(value)) {
      throw new BuildLinkCodecError('invalidPayload', 'A build-link string is not valid Unicode.');
    }
    const compact = [...value].every((character) => COMPACT_STRING_CHARACTERS.has(character));
    if (compact) {
      if (value.length > MAX_STRING_UNITS) {
        throw new BuildLinkCodecError('invalidPayload', 'A build-link string is too long.');
      }
      this.writeVarUint(value.length * 2 + 1);
      for (const character of value) {
        this.writeBounded(COMPACT_STRING_ALPHABET.indexOf(character), 64, characters);
      }
      return;
    }
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > MAX_STRING_UNITS) {
      throw new BuildLinkCodecError('invalidPayload', 'A build-link string is too long.');
    }
    this.writeVarUint(encoded.length * 2);
    for (const byte of encoded) this.writeBits(byte, 8);
  }

  private writeVarUint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BuildLinkCodecError('invalidPayload', 'An unsigned integer is invalid.');
    }
    let remaining = value;
    do {
      const byte = remaining % 128;
      remaining = Math.floor(remaining / 128);
      this.writeBits(byte | (remaining > 0 ? 0x80 : 0), 8);
    } while (remaining > 0);
  }

  private writeSymbol(value: number, valueCount: number, model?: BoundedSymbolModel): void {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !Number.isSafeInteger(valueCount) ||
      valueCount < 2 ||
      bitsRequired(valueCount) > 31 ||
      value >= valueCount ||
      (Array.isArray(model) && model.length !== valueCount + 1)
    ) {
      throw new BuildLinkCodecError('invalidPayload', 'A bounded integer is invalid.');
    }
    this.symbols.push({ value, valueCount, ...(model === undefined ? {} : { model }) });
    // Adaptive layout decisions deliberately use packed-bit cost as the stable canonical proxy,
    // even when arithmetic rendering ultimately produces the shorter link. Models change only
    // the arithmetic interval widths, never this proxy, so layout choices are model-independent.
    this.bitLength += bitsRequired(valueCount);
  }
}

function canonicalBody(codec: CodecContext, symbols: readonly EncodedSymbol[]): Uint8Array {
  const packed = renderBody(codec, symbols, false);
  const arithmetic = renderBody(codec, symbols, true);
  return arithmetic.length < packed.length ? arithmetic : packed;
}

function renderBody(
  codec: CodecContext,
  symbols: readonly EncodedSymbol[],
  arithmetic: boolean,
): Uint8Array {
  const [ship, ...remaining] = symbols;
  if (ship === undefined || ship.valueCount !== codec.tables.SHIPS.length) {
    throw new BuildLinkCodecError('invalidPayload', 'The codec ship symbol is invalid.');
  }
  const writer = new RawBitWriter();
  const shipCount = codec.tables.SHIPS.length;
  const shipTagWidth = bitsRequired(shipCount + 1);
  const markerCount = 2 ** shipTagWidth - shipCount;
  const remainder = ship.value % markerCount;
  writer.writeBits(codec.tableVersion, TABLE_VERSION_BITS);
  writer.writeBits(arithmetic ? shipCount + remainder : ship.value, shipTagWidth);
  if (arithmetic) {
    const encoder = new ArithmeticEncoder((bit) => writer.writeBoolean(bit === 1));
    const adaptive = new AdaptiveContexts(codec.models?.adaptationIncrement ?? 0);
    const groupCount = arithmeticShipGroupCount(shipCount, markerCount, remainder);
    if (groupCount > 1) encoder.write(Math.floor(ship.value / markerCount), groupCount);
    for (const { value, valueCount, model } of remaining) {
      if (model === undefined) {
        encoder.write(value, valueCount);
      } else if (isAdaptiveModel(model)) {
        encoder.writeWeighted(value, adaptive.cumulativeFor(model.adaptOver, valueCount));
        adaptive.recordUse(model.adaptOver, valueCount, value);
      } else {
        encoder.writeWeighted(value, model);
      }
    }
    encoder.finish();
  } else {
    for (const { value, valueCount } of remaining) {
      writer.writeBits(value, bitsRequired(valueCount));
    }
  }
  return writer.toUint8Array();
}

function arithmeticShipGroupCount(
  shipCount: number,
  markerCount: number,
  remainder: number,
): number {
  return Math.floor((shipCount - 1 - remainder) / markerCount) + 1;
}

abstract class SymbolReader implements CodecReader {
  abstract readBits(width: number): number;
  abstract readBounded(valueCount: number, model?: BoundedSymbolModel): number;

  readBoolean(model?: BoundedSymbolModel): boolean {
    return this.readBounded(2, model) === 1;
  }

  readString(characters?: readonly number[]): string {
    const header = this.readVarUint();
    const compact = header % 2 === 1;
    const length = Math.floor(header / 2);
    if (length > MAX_STRING_UNITS) {
      throw new BuildLinkCodecError('invalidPayload', 'A build-link string is too long.');
    }
    if (compact) {
      return Array.from(
        { length },
        () => COMPACT_STRING_ALPHABET[this.readBounded(64, characters)]!,
      ).join('');
    }
    const encoded = Uint8Array.from({ length }, () => this.readBits(8));
    return new TextDecoder('utf-8', { fatal: true }).decode(encoded);
  }

  private readVarUint(): number {
    let value = 0;
    let factor = 1;
    for (let count = 0; count < 8; count += 1) {
      const byte = this.readBits(8);
      value += (byte & 0x7f) * factor;
      if (!Number.isSafeInteger(value)) {
        throw new BuildLinkCodecError('invalidPayload', 'An encoded integer is too large.');
      }
      if ((byte & 0x80) === 0) return value;
      factor *= 128;
    }
    throw new BuildLinkCodecError('invalidPayload', 'An encoded integer is too long.');
  }
}

class PackedSymbolReader extends SymbolReader {
  constructor(private readonly source: RawBitReader) {
    super();
  }

  readBits(width: number): number {
    return this.source.readBits(width);
  }

  readBounded(valueCount: number, _model?: BoundedSymbolModel): number {
    const value = this.source.readBits(bitsRequired(valueCount));
    if (value >= valueCount) {
      throw new BuildLinkCodecError('invalidPayload', 'A bounded integer is invalid.');
    }
    return value;
  }
}

class ArithmeticSymbolReader extends SymbolReader {
  private readonly decoder: ArithmeticDecoder;
  private readonly adaptive: AdaptiveContexts;

  constructor(source: RawBitReader, models: SymbolModels | null) {
    super();
    this.decoder = new ArithmeticDecoder(() => source.readBitOrZero());
    this.adaptive = new AdaptiveContexts(models?.adaptationIncrement ?? 0);
  }

  readBits(width: number): number {
    if (!Number.isInteger(width) || width < 1 || width > 31) {
      throw new BuildLinkCodecError('invalidPayload', 'A bit width is invalid.');
    }
    return this.decoder.read(2 ** width);
  }

  readBounded(valueCount: number, model?: BoundedSymbolModel): number {
    if (model === undefined) return this.decoder.read(valueCount);
    if (!isAdaptiveModel(model)) {
      if (model.length !== valueCount + 1) {
        throw new BuildLinkCodecError('invalidPayload', 'A bounded integer is invalid.');
      }
      return this.decoder.readWeighted(model);
    }
    const value = this.decoder.readWeighted(
      this.adaptive.cumulativeFor(model.adaptOver, valueCount),
    );
    this.adaptive.recordUse(model.adaptOver, valueCount, value);
    return value;
  }
}

function bitsRequired(valueCount: number): number {
  let width = 1;
  let capacity = 2;
  while (capacity < valueCount) {
    width += 1;
    capacity *= 2;
  }
  return width;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const following = value.charCodeAt(index + 1);
      if (following < 0xdc00 || following > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function createSymbolModels(models: BuildLinkSymbolModels | undefined): SymbolModels | null {
  if (models === undefined) return null;
  const invalidModels = () => new Error('The build-link codec table models are invalid.');
  const cumulativeFrom = (weights: readonly number[], expectedLength: number): number[] => {
    if (!Array.isArray(weights) || weights.length !== expectedLength) throw invalidModels();
    let total = 0;
    const cumulative = [0];
    for (const weight of weights) {
      if (!Number.isSafeInteger(weight) || weight < 1) throw invalidModels();
      total += weight;
      cumulative.push(total);
    }
    if (total > MAX_MODEL_WEIGHT_TOTAL) throw invalidModels();
    return cumulative;
  };
  const optionalCumulativeFrom = (
    weights: readonly number[] | undefined,
    expectedLength: number,
  ): readonly number[] | undefined =>
    weights === undefined ? undefined : cumulativeFrom(weights, expectedLength);
  const decay = models.CONTEXT_INDEX_DECAY;
  if (!Array.isArray(decay) || decay.length !== 2) throw invalidModels();
  const decayNumerator = decay[0]!;
  const decayDenominator = decay[1]!;
  if (
    !Number.isSafeInteger(decayNumerator) ||
    !Number.isSafeInteger(decayDenominator) ||
    decayNumerator < 1 ||
    decayDenominator < decayNumerator ||
    decayDenominator > MAX_CONTEXT_INDEX_DECAY_DENOMINATOR
  ) {
    throw invalidModels();
  }
  const floor = models.CONTEXT_INDEX_FLOOR ?? 1;
  if (!Number.isSafeInteger(floor) || floor < 1 || floor > CONTEXT_INDEX_FIRST_WEIGHT) {
    throw invalidModels();
  }
  const adaptationIncrement = models.CONTEXT_ADAPTATION;
  if (
    !Number.isSafeInteger(adaptationIncrement) ||
    adaptationIncrement < 0 ||
    adaptationIncrement > MAX_CONTEXT_ADAPTATION_INCREMENT
  ) {
    throw invalidModels();
  }
  const contextCumulativeBySize = new Map<number, readonly number[]>();
  const contextIndex = (valueCount: number): readonly number[] | undefined => {
    if (valueCount < 2 || decayNumerator === decayDenominator) return undefined;
    let cumulative = contextCumulativeBySize.get(valueCount);
    if (cumulative === undefined) {
      let weight = CONTEXT_INDEX_FIRST_WEIGHT;
      let total = 0;
      const built = [0];
      for (let index = 0; index < valueCount; index += 1) {
        total += weight;
        built.push(total);
        weight = Math.max(floor, Math.floor((weight * decayNumerator) / decayDenominator));
      }
      // The geometric head is bounded by the decay constants, but the floored tail grows with
      // the candidate set, so the pinned-model cap is enforced here as well.
      if (total > MAX_MODEL_WEIGHT_TOTAL) throw invalidModels();
      cumulative = built;
      contextCumulativeBySize.set(valueCount, cumulative);
    }
    return cumulative;
  };
  return {
    gradeIsMax: cumulativeFrom(models.GRADE_IS_MAX, 2),
    experimentalPresent: cumulativeFrom(models.EXPERIMENTAL_PRESENT, 2),
    contextHit: cumulativeFrom(models.CONTEXT_HIT, 2),
    engineeringReference: optionalCumulativeFrom(models.ENGINEERING_REFERENCE, 2),
    identityRepeated: optionalCumulativeFrom(models.IDENTITY_REPEATED, 2),
    identityIsDefault: optionalCumulativeFrom(models.IDENTITY_IS_DEFAULT, 2),
    baselineSlotPresent: optionalCumulativeFrom(models.BASELINE_SLOT_PRESENT, 2),
    powerOn: cumulativeFrom(models.POWER_ON, 3),
    powerPriority: cumulativeFrom(models.POWER_PRIORITY, 6),
    nameCharacters: cumulativeFrom(models.NAME_CHARACTERS, COMPACT_STRING_ALPHABET.length),
    identCharacters: cumulativeFrom(models.IDENT_CHARACTERS, COMPACT_STRING_ALPHABET.length),
    adaptationIncrement,
    contextModel(context: readonly number[]): BoundedSymbolModel | undefined {
      return contextIndex(context.length);
    },
    adaptiveModel(key: readonly number[]): BoundedSymbolModel | undefined {
      return adaptationIncrement > 0 ? { adaptOver: key } : undefined;
    },
  };
}

function createCodecContext(tableVersion: number, tables: BuildLinkCodecTables): CodecContext {
  return {
    tableVersion,
    tables,
    models: createSymbolModels(tables.MODELS),
    moduleBits: bitsRequired(tables.MODULES.length),
    poweredModuleSet: new Set(tables.POWERED_MODULES),
    shipIndex: createIndex(tables.SHIPS),
    moduleIndex: createIndex(tables.MODULES),
    blueprintIndex: createIndex(tables.BLUEPRINTS),
    experimentalIndex: createIndex(tables.EXPERIMENTAL_EFFECTS),
    slotIndexByShip: new Map(
      tables.SHIPS.map((ship) => [ship, createIndex(tables.SLOTS_BY_SHIP[ship])]),
    ),
  };
}
