import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { makeFullyEngineeredAnaconda, minimalState } from './build-link-codec.spec-helpers';
import { createBuildLinkCodec } from './build-link-codec';
import type { BuildLinkSymbolModels } from './build-link-codec';
import codecTable1 from './codec-table-1.json';
import realisticEngineeredCorvette from './realistic-engineered-corvette.fixture.json';

/**
 * Table 1 carries the symbol models the generator pins alongside its catalogue. The boolean and
 * power skews are defensible priors for real builds (grades are usually maximal, engineered
 * modules usually carry an experimental effect, identities are almost always contextual,
 * explicit enabled states are usually `on`, a changed mount is usually filled rather than
 * emptied). Names get English-like character weights while idents get callsign-like ones
 * (uppercase, digits, dash). Back-reference indexes use per-run adaptive contexts;
 * candidate-set literals stay static because the grammar's own back-referencing leaves them
 * repetition-poor. The context-index decay pays because the table orders every candidate set by
 * a popularity prior, and its floor bounds what a late position costs when that prior is wrong.
 */
const shippedModels: BuildLinkSymbolModels = codecTable1.MODELS;
const modelledCodec = createBuildLinkCodec(1, codecTable1);
/**
 * The models' own effect is measured against the same table without its models block. Bit
 * packing ignores models entirely, so the unmodelled codec reproduces every packed body — and
 * with it every empty and stock reference — byte for byte.
 */
const { MODELS: _strippedForBaseline, ...unmodelledTable } = codecTable1;
const baselineCodec = createBuildLinkCodec(1, unmodelledTable);

describe('build-link codec pinned symbol models', () => {
  it('round-trips the reference corpus canonically under the modelled table', () => {
    for (const { label, source, assumeFullQuality } of referenceCorpus()) {
      const fragment = modelledCodec.encodeBuildLinkFragment(source);
      const decoded = modelledCodec.decodeBuildLinkFragment(fragment);

      expect(minimalState(decoded), label).toEqual(minimalState(source, assumeFullQuality));
      expect(modelledCodec.encodeBuildLinkFragment(decoded), label).toBe(fragment);
    }
  });

  it('round-trips empty and stock configurations for every pinned hull', () => {
    for (const { symbol } of SHIPS) {
      for (const source of [ShipLoadout.empty(symbol), ShipLoadout.default(symbol)]) {
        const fragment = modelledCodec.encodeBuildLinkFragment(source);

        expect(minimalState(modelledCodec.decodeBuildLinkFragment(fragment))).toEqual(
          minimalState(source),
        );
      }
    }
  });

  it('freezes the reference corpus literals in the encode direction', () => {
    // Freeze before release; once table 1 ships, never regenerate these fixtures to make a
    // build pass. The decode direction and canonical reserialization are covered by the
    // round-trip test above.
    const fragments = referenceCorpus().map(({ source }) =>
      modelledCodec.encodeBuildLinkFragment(source),
    );

    expect(fragments).toEqual([
      'b.1S..A@YX6Cjy!R',
      'b.vz,jdQ_4',
      'b.8oUeO4wu5ZrfCrTfzkyEp9VJ1NAj-M4u5tBFFEp3.:aLg6tfRJSrwSAe4Dz6jB',
      'b.26da!i-2iAMHS,JA/pnkvFzkv/qWhnG0:VZE5Xj174k_cKfe,tswuTTtsPcQguIp!rTAKknjmMBGaE',
      'b.7yvr6:PyEpDGgEs9aI:gxA@uHybdm4IM',
    ]);
  });

  it('never lengthens a reference link and shrinks the engineered references', () => {
    const rows = referenceCorpus().map(({ label, source }) => {
      const baselineLength = baselineCodec.encodeBuildLinkFragment(source).length;
      const modelledLength = modelledCodec.encodeBuildLinkFragment(source).length;
      return { label, baselineLength, modelledLength };
    });
    // Both columns are pinned because `docs/ship-link-codec.md` publishes them as the models'
    // measured effect. A runner shows no console output for a passing spec, so a printed table
    // would let either column drift unnoticed; an assertion cannot.
    expect(rows).toEqual([
      { label: 'empty Sidewinder', baselineLength: 16, modelledLength: 16 },
      { label: 'stock Krait Mk II', baselineLength: 10, modelledLength: 10 },
      { label: 'engineered Anaconda', baselineLength: 73, modelledLength: 64 },
      { label: 'supplied engineered Corvette', baselineLength: 102, modelledLength: 80 },
      { label: 'named stock Krait Mk II', baselineLength: 38, modelledLength: 34 },
    ]);

    for (const { label, baselineLength, modelledLength } of rows) {
      expect(modelledLength, label).toBeLessThanOrEqual(baselineLength);
    }
    for (const engineered of ['engineered Anaconda', 'supplied engineered Corvette']) {
      const row = rows.find(({ label }) => label === engineered)!;
      expect(row.modelledLength, engineered).toBeLessThan(row.baselineLength);
    }
  });

  it('spells every empty and stock hull link identically with and without models', () => {
    // Every empty and stock hull keeps its packed rendering, and bit packing ignores models, so
    // the two tables must agree character for character. That is stricter than merely never
    // lengthening, and it is the claim the codec document makes.
    let longest = 0;
    for (const { symbol } of SHIPS) {
      for (const source of [ShipLoadout.empty(symbol), ShipLoadout.default(symbol)]) {
        const modelledFragment = modelledCodec.encodeBuildLinkFragment(source);
        longest = Math.max(longest, modelledFragment.length);
        expect(modelledFragment, symbol).toBe(baselineCodec.encodeBuildLinkFragment(source));
      }
    }
    expect(longest).toBe(18);
  });

  it('shrinks compact metadata under the character model', () => {
    const named = makeNamedBuild('Interstellar Explorer', 'IX-01');

    const baselineFragment = baselineCodec.encodeBuildLinkFragment(named);
    const modelledFragment = modelledCodec.encodeBuildLinkFragment(named);

    expect(modelledFragment.length).toBeLessThan(baselineFragment.length);
    const decoded = modelledCodec.decodeBuildLinkFragment(modelledFragment);
    expect(decoded.shipName).toBe('Interstellar Explorer');
    expect(decoded.shipIdent).toBe('IX-01');
  });

  it('round-trips fallback UTF-8 metadata, which the character model does not touch', () => {
    const named = makeNamedBuild('Astraea 星', 'TST-42');

    const decoded = modelledCodec.decodeBuildLinkFragment(
      modelledCodec.encodeBuildLinkFragment(named),
    );

    expect(decoded.shipName).toBe('Astraea 星');
    expect(decoded.shipIdent).toBe('TST-42');
  });

  it('round-trips canonically under other decay and floor pairs', () => {
    // The decay models candidate-set positions and composes with the reference-stream
    // adaptation; both are active here. A table that pins no floor falls back to a weight of
    // one, which is where an unbounded geometric run ends anyway.
    const source = makeFullyEngineeredAnaconda();
    for (const models of [
      { ...shippedModels, CONTEXT_INDEX_DECAY: [63, 64], CONTEXT_INDEX_FLOOR: undefined },
      { ...shippedModels, CONTEXT_INDEX_DECAY: [1, 2], CONTEXT_INDEX_FLOOR: 1_024 },
    ]) {
      const decayCodec = createBuildLinkCodec(1, { ...codecTable1, MODELS: models });

      const fragment = decayCodec.encodeBuildLinkFragment(source);
      const decoded = decayCodec.decodeBuildLinkFragment(fragment);

      expect(minimalState(decoded)).toEqual(minimalState(source));
      expect(decayCodec.encodeBuildLinkFragment(decoded)).toBe(fragment);
    }
  });

  it('pins the largest adaptation increment the reference corpus does not pay for', () => {
    // Per-module engineering dictionaries hold the repetition the reference streams used to
    // carry, so the pinned increment leaves every reference link exactly where switching
    // adaptation off leaves it. A larger increment does cost: each new reference target pays
    // for the counts its predecessors built up, which the diverse Corvette feels first.
    const withIncrement = (increment: number) =>
      createBuildLinkCodec(1, {
        ...codecTable1,
        MODELS: { ...shippedModels, CONTEXT_ADAPTATION: increment },
      });
    const lengths = (codec: ReturnType<typeof createBuildLinkCodec>) =>
      referenceCorpus().map(({ source }) => codec.encodeBuildLinkFragment(source).length);
    const corvette = referenceCorpus().find(
      ({ label }) => label === 'supplied engineered Corvette',
    )!.source;

    expect(lengths(modelledCodec)).toEqual(lengths(withIncrement(0)));
    expect(withIncrement(1_024).encodeBuildLinkFragment(corvette).length).toBeGreaterThan(
      modelledCodec.encodeBuildLinkFragment(corvette).length,
    );

    const fragment = modelledCodec.encodeBuildLinkFragment(corvette);
    const decoded = modelledCodec.decodeBuildLinkFragment(fragment);
    expect(minimalState(decoded)).toEqual(minimalState(corvette, true));
    expect(modelledCodec.encodeBuildLinkFragment(decoded)).toBe(fragment);
  });

  it('shrinks a callsign ident under the ident character model', () => {
    // A short ident like TST-42 saves a handful of bits, which byte padding can absorb; the
    // bound-length callsign makes the model's saving visible in whole characters.
    const named = makeNamedBuild(null, 'REG-0042-ALPHA-NINER-XRAY-04-TST');

    const baselineFragment = baselineCodec.encodeBuildLinkFragment(named);
    const modelledFragment = modelledCodec.encodeBuildLinkFragment(named);

    expect(modelledFragment.length).toBeLessThan(baselineFragment.length);
    const decoded = modelledCodec.decodeBuildLinkFragment(modelledFragment);
    expect(decoded.shipName).toBeNull();
    expect(decoded.shipIdent).toBe('REG-0042-ALPHA-NINER-XRAY-04-TST');
    const shortIdent = makeNamedBuild(null, 'TST-42');
    expect(modelledCodec.encodeBuildLinkFragment(shortIdent).length).toBeLessThanOrEqual(
      baselineCodec.encodeBuildLinkFragment(shortIdent).length,
    );
  });

  it('rejects malformed model weight tables', () => {
    const withModels = (models: unknown) => () =>
      createBuildLinkCodec(1, {
        ...codecTable1,
        MODELS: models as BuildLinkSymbolModels,
      });
    const expectedError = 'The build-link codec table models are invalid.';

    expect(withModels({ ...shippedModels, GRADE_IS_MAX: [0, 1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, GRADE_IS_MAX: [1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, GRADE_IS_MAX: [1, 1.5] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, GRADE_IS_MAX: [2 ** 24, 1] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, POWER_ON: [1, 1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, ENGINEERING_REFERENCE: [0, 1] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, IDENTITY_REPEATED: [1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, IDENTITY_IS_DEFAULT: [1, 1.5] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, BASELINE_SLOT_PRESENT: [2 ** 24, 1] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_FLOOR: 0 })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_FLOOR: 1.5 })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_FLOOR: 2 ** 17 })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_DECAY: [2, 1] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_DECAY: [1, 128] })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, CONTEXT_INDEX_DECAY: [1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, CONTEXT_ADAPTATION: -1 })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, CONTEXT_ADAPTATION: 1.5 })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, CONTEXT_ADAPTATION: 2 ** 17 })).toThrowError(
      expectedError,
    );
    expect(withModels({ ...shippedModels, NAME_CHARACTERS: [1] })).toThrowError(expectedError);
    expect(withModels({ ...shippedModels, IDENT_CHARACTERS: [1] })).toThrowError(expectedError);
  });
});

type CorpusEntry = {
  readonly label: string;
  readonly source: ShipLoadout;
  readonly assumeFullQuality?: boolean;
};

function referenceCorpus(): readonly CorpusEntry[] {
  return [
    { label: 'empty Sidewinder', source: ShipLoadout.empty('SideWinder') },
    { label: 'stock Krait Mk II', source: ShipLoadout.default('Krait_MkII') },
    { label: 'engineered Anaconda', source: makeFullyEngineeredAnaconda() },
    {
      label: 'supplied engineered Corvette',
      source: ShipLoadout.fromSlef(
        realisticEngineeredCorvette as Parameters<typeof ShipLoadout.fromSlef>[0],
      ),
      assumeFullQuality: true,
    },
    {
      label: 'named stock Krait Mk II',
      source: makeNamedBuild('Interstellar Explorer', 'IX-01'),
    },
  ];
}

function makeNamedBuild(name: string | null, ident: string): ShipLoadout {
  const stock = ShipLoadout.default('Krait_MkII').toLoadoutEvent({ moduleOrder: 'slots' });
  return ShipLoadout.fromLoadout({
    ...stock,
    ...(name === null ? {} : { ShipName: name }),
    ShipIdent: ident,
  });
}
