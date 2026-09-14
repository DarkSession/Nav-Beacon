import { BuildMetrics } from '@elite-dangerous-almanac/core/ships/build-metrics';
import { ShipLoadout, type FittedModule } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { getBlueprintsForModule } from '@elite-dangerous-almanac/core/ships/engineering-options';
import { PRE_ENGINEERED_MODULES } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { getPreEngineeredJournalModifiers } from '@elite-dangerous-almanac/core/ships/pre-engineered-stats';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import type { EngineeringModifier, LoadoutEvent } from '@elite-dangerous-almanac/core/ships/slef';
import { ArithmeticEncoder } from './build-link-arithmetic';
import { BuildLinkCodecError, createBuildLinkCodec } from './build-link-codec';
import { encodeBuildLinkBody } from './build-link-payload';
import {
  decodeBuildLinkFragment as decodeBuildLinkFragmentOnDemand,
  encodeBuildLinkFragment as encodeBuildLinkFragmentOnDemand,
} from './build-link-codec-loader';
import {
  BUILD_LINK_FINAL_ALPHABET,
  decodeBuildLinkPayload,
  encodeBuildLinkPayload,
} from '../../build-link/build-link-radix';
import codecTable1Json from './codec-table-1.json';
import realisticEngineeredCorvette from './realistic-engineered-corvette.fixture.json';
import { makeFullyEngineeredAnaconda, minimalState } from './build-link-codec.spec-helpers';

const codecTable1 = codecTable1Json;
const { decodeBuildLinkFragment, encodeBuildLinkFragment } = createBuildLinkCodec(1, codecTable1);

describe('build-link codec', () => {
  it('round-trips the minimal state imported through the Almanac', () => {
    const source = makeImportedEngineeredBuild();

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));
    const reimported = ShipLoadout.fromSlef(
      decoded.toSlefString({
        header: { appName: 'Elite Dangerous Ship Builder', appVersion: 1 },
      }),
    );

    expect(minimalState(decoded)).toEqual(minimalState(source));
    expect(minimalState(reimported)).toEqual(minimalState(source));
    expect(decoded.fittedModuleAt('FrameShiftDrive')?.engineering?.Modifiers).toEqual(
      source.fittedModuleAt('FrameShiftDrive')?.engineering?.Modifiers,
    );
    expect(decoded.fittedModuleAt('FrameShiftDrive')?.effectiveStats).toEqual(
      source.fittedModuleAt('FrameShiftDrive')?.effectiveStats,
    );
  });

  it('assumes complete engineering quality and omits all credit values', () => {
    const source = makeImportedEngineeredBuild(true, 0.73123456789);
    const withoutCredits = makeImportedEngineeredBuild(false, 0.73123456789);

    const encoded = encodeBuildLinkFragment(source);
    const decoded = decodeBuildLinkFragment(encoded);

    expect(decoded.fittedModuleAt('FrameShiftDrive')?.engineering?.Quality).toBe(1);
    expect(source.sourcePurchase).not.toBeNull();
    expect(decoded.sourcePurchase).toBeNull();
    expect(encoded).toBe(encodeBuildLinkFragment(withoutCredits));
    expect(decoded.toLoadoutEvent().HullValue).toBe(source.toLoadoutEvent().HullValue);
    expect(decoded.toLoadoutEvent().ModulesValue).toBe(source.toLoadoutEvent().ModulesValue);
    expect(decoded.toLoadoutEvent().Rebuy).toBe(source.toLoadoutEvent().Rebuy);
  });

  it('compacts common ASCII metadata without changing Unicode fallback semantics', () => {
    const cases = [
      { name: 'Astraea', ident: 'TST-42', length: 30 },
      { name: 'Astraea 星', ident: 'TST-42', length: 38 },
      { name: '星', ident: null, length: 21 },
      { name: 'THE WANDERING STAR 42', ident: 'AB-123', length: 44 },
    ];
    for (const { name, ident, length } of cases) {
      const source = ShipLoadout.fromLoadout({
        Ship: 'SideWinder',
        ShipName: name,
        ...(ident === null ? {} : { ShipIdent: ident }),
        Modules: [],
      });
      const fragment = encodeBuildLinkFragment(source);
      const decoded = decodeBuildLinkFragment(fragment);

      expect(fragment).toHaveLength(length);
      expect(decoded.shipName).toBe(name);
      expect(decoded.shipIdent).toBe(ident);
      expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
    }
  });

  it('pins the compact metadata alphabet and its tagged lengths', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';
    // The alphabet is exactly two labels wide at the 32-unit bound, so it takes both to pin it.
    const name = alphabet.slice(0, 32);
    const ident = alphabet.slice(32);
    const compact = ShipLoadout.fromLoadout({
      Ship: 'SideWinder',
      ShipName: name,
      ShipIdent: ident,
      Modules: [],
    });
    const compactFragment = encodeBuildLinkFragment(compact);
    const metadataOffset = 10 + testBitsRequired(codecTable1.SHIPS.length) + 2;
    const identOffset = metadataOffset + 8 + name.length * 6;

    // An odd header is a compact character count: 2 * 32 + 1, inside a single varuint byte.
    expect(readPayloadBits(compactFragment, metadataOffset, 8)).toBe(65);
    expect(readPayloadBits(compactFragment, identOffset, 8)).toBe(65);
    for (let index = 0; index < alphabet.length; index += 1) {
      const offset =
        index < name.length
          ? metadataOffset + 8 + index * 6
          : identOffset + 8 + (index - name.length) * 6;
      expect(readPayloadBits(compactFragment, offset, 6)).toBe(index);
    }
    expect(decodeBuildLinkFragment(compactFragment).shipName).toBe(name);
    expect(decodeBuildLinkFragment(compactFragment).shipIdent).toBe(ident);

    // An even header is a UTF-8 byte count. The widest label the codec accepts is 2 * 32, so
    // every header it writes fits one byte and a longer one can only come from outside.
    const fallback = ShipLoadout.fromLoadout({
      Ship: 'SideWinder',
      ShipName: 'é'.repeat(16),
      Modules: [],
    });
    const fallbackFragment = encodeBuildLinkFragment(fallback);

    expect(readPayloadBits(fallbackFragment, metadataOffset, 8)).toBe(64);
    expect(decodeBuildLinkFragment(fallbackFragment).shipName).toBe('é'.repeat(16));
    // A two-byte header still parses, and is then refused for what it claims rather than ignored.
    expect(() =>
      decodeBuildLinkFragment(handcraftedMetadataFragment(128, [{ value: 0x41, width: 8 }])),
    ).toThrowError('A build-link string is too long.');
  });

  it('rejects non-canonical, truncated, and malformed tagged metadata', () => {
    expectCodecError(
      () => decodeBuildLinkFragment(handcraftedMetadataFragment(2, [{ value: 65, width: 8 }])),
      'invalidPayload',
    );
    expectCodecError(
      () => decodeBuildLinkFragment(handcraftedMetadataFragment(129, [], false)),
      'invalidPayload',
    );
    expectCodecError(
      () => decodeBuildLinkFragment(handcraftedMetadataFragment(2, [{ value: 0xff, width: 8 }])),
      'invalidPayload',
    );
  });

  it('normalises imported zero-quality engineering without a special effect', () => {
    const source = ShipLoadout.default('Krait_MkII');
    source.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', { grade: 1, quality: 0 });

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));

    expect(decoded.fittedModuleAt('FrameShiftDrive')?.engineering).toMatchObject({
      BlueprintName: 'FSD_LongRange',
      Level: 1,
      Quality: 1,
    });
    expect(
      decoded.fittedModuleAt('FrameShiftDrive')?.engineering?.ExperimentalEffect,
    ).toBeUndefined();
  });

  it('omits partial engineering quality from the canonical build model', () => {
    const source = ShipLoadout.default('Krait_MkII');
    const floatEscape = ShipLoadout.default('Krait_MkII');
    source.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', {
      grade: 5,
      quality: 0.9438,
    });
    floatEscape.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', {
      grade: 5,
      quality: 0.943812345,
    });

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));

    expect(decoded.fittedModuleAt('FrameShiftDrive')?.engineering?.Quality).toBe(1);
    expect(encodeBuildLinkFragment(source)).toBe(encodeBuildLinkFragment(floatEscape));
  });

  it('uses pinned slot order instead of carrying SLEF module-array order', () => {
    const source = ShipLoadout.default('Krait_MkII');
    const event = source.toLoadoutEvent({ moduleOrder: 'slots' });
    const reordered = ShipLoadout.fromLoadout({ ...event, Modules: [...event.Modules].reverse() });

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(reordered));

    expect(minimalState(decoded)).toEqual(minimalState(reordered));
  });

  it('round-trips dense power states through their compact value modes', () => {
    const allEnabled = ShipLoadout.default('Krait_MkII');
    const allDisabled = ShipLoadout.default('Krait_MkII');
    const priorityOnly = ShipLoadout.default('Krait_MkII');
    const partlySpecified = ShipLoadout.default('Krait_MkII');

    for (const module of allEnabled.fittedModules()) allEnabled.setModuleEnabled(module.slot, true);
    for (const module of allDisabled.fittedModules()) {
      allDisabled.setModuleEnabled(module.slot, false);
      allDisabled.setModulePriority(module.slot, 3);
    }
    for (const module of priorityOnly.fittedModules()) {
      priorityOnly.setModulePriority(module.slot, 2);
      partlySpecified.setModulePriority(module.slot, 2);
    }
    partlySpecified.setModuleEnabled(partlySpecified.fittedModules()[0]!.slot, true);

    for (const source of [allEnabled, allDisabled, priorityOnly, partlySpecified]) {
      expect(minimalState(decodeBuildLinkFragment(encodeBuildLinkFragment(source)))).toEqual(
        minimalState(source),
      );
    }
  });

  it('omits power fields only where the Almanac prices the module at no draw', () => {
    // The link carries a power state wherever the mount card offers one, and the card offers one
    // wherever the Almanac has not said the module draws nothing. A figure it does not publish is
    // not a zero (constitution IV), so the plant, the tank, the rack and the bulkhead all keep the
    // priority a Commander set on them; the approach suite, which the Almanac prices at 0 MW, has
    // nothing to power and nothing to group and costs the link no bits.
    const stock = ShipLoadout.default('Krait_MkII');
    const priced = ShipLoadout.default('Krait_MkII');
    priced.setModuleEnabled('PlanetaryApproachSuite', false);
    priced.setModulePriority('PlanetaryApproachSuite', 4);
    const event = stock.toLoadoutEvent({ moduleOrder: 'slots' });
    const withoutCargoHatch = ShipLoadout.fromLoadout({
      ...event,
      Modules: event.Modules.filter(({ Slot }) => Slot.toLowerCase() !== 'cargohatch'),
    });

    expect(encodeBuildLinkFragment(priced)).toBe(encodeBuildLinkFragment(stock));
    expect(
      decodeBuildLinkFragment(encodeBuildLinkFragment(priced)).fittedModuleAt(
        'PlanetaryApproachSuite',
      ),
    ).toMatchObject({ on: undefined, priority: undefined });
    expect(encodeBuildLinkFragment(withoutCargoHatch)).toBe(encodeBuildLinkFragment(stock));
  });

  it('carries the power state of every mount whose draw the Almanac leaves unpublished', () => {
    // Reported 2026-08-26: a build arrived from a link with the priority on its plant unset. Table
    // 1 listed only the modules the Almanac prices above zero, which left out every power plant,
    // fuel tank, cargo rack, reinforcement, passenger cabin and bulkhead in the game.
    const source = ShipLoadout.default('Krait_MkII');
    const unpublished = ['PowerPlant', 'FuelTank', 'Armour', 'Slot04_Size5'] as const;
    for (const slot of unpublished) {
      source.setModuleEnabled(slot, false);
      source.setModulePriority(slot, 4);
    }
    source.setModuleEnabled('CargoHatch', false);
    source.setModulePriority('CargoHatch', 3);

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));

    for (const slot of unpublished) {
      expect(decoded.fittedModuleAt(slot), slot).toMatchObject({ on: false, priority: 4 });
    }
    expect(decoded.fittedModuleAt('CargoHatch')).toMatchObject({
      symbol: 'ModularCargoBayDoor',
      on: false,
      priority: 3,
    });
    expect(minimalState(decoded)).toEqual(minimalState(source));
  });

  it('round-trips every pinned hull in empty and stock configurations', () => {
    const corpus = SHIPS.flatMap(({ symbol }) => [
      ShipLoadout.empty(symbol),
      ShipLoadout.default(symbol),
    ]);

    for (const source of corpus) {
      expect(minimalState(decodeBuildLinkFragment(encodeBuildLinkFragment(source)))).toEqual(
        minimalState(source),
      );
    }

    const longest = corpus
      .map((loadout) => ({
        ship: loadout.shipSymbol,
        length: `https://ships.example/#${encodeBuildLinkFragment(loadout)}`.length,
      }))
      .sort((left, right) => right.length - left.length || left.ship.localeCompare(right.ship))[0];
    expect(longest).toEqual({ ship: 'Anaconda', length: 41 });
  });

  it('normalises an external partial-quality capture to a completed blueprint', () => {
    const source = ShipLoadout.fromSlef(
      realisticEngineeredCorvette as Parameters<typeof ShipLoadout.fromSlef>[0],
    );
    const fragment = encodeBuildLinkFragment(source);
    const decoded = decodeBuildLinkFragment(fragment);
    // The application models a selected grade as a completed blueprint even when a journal capture
    // reports the partial roll that happened to produce the imported modifiers.
    expect(source.fittedModuleAt('SmallHardpoint2')?.engineering?.Quality).toBe(0.9438);
    expect(decoded.fittedModuleAt('SmallHardpoint2')?.engineering?.Quality).toBe(1);

    expect(minimalState(decoded)).toEqual(minimalState(source, true));
    expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
    expect(fragment).toBe(
      'b.26da!i-2iAMHR6!JZRgv2A4OO8ezAd.KALtMaTu1R3sY,Lfi0zRNpDcH3ulwYrH!KjCD0l0tW3jj!i',
    );
    expect(`https://ships.example/#${fragment}`).toHaveLength(103);
  });

  it('preserves package-identified pre-engineered variants and their effective stats', () => {
    const source = ShipLoadout.fromLoadout({
      Ship: 'Krait_MkII',
      Modules: [
        {
          Slot: 'LargeHardpoint1',
          Item: 'Hpt_Mining_AbrBlstr_Fixed_Small',
          Engineering: {
            BlueprintName: 'Weapon_LongRange',
            Level: 5,
            Quality: 1,
            Modifiers: [
              { Label: 'DistributorDraw', Value: 1, OriginalValue: 2 },
              { Label: 'FalloffRange', Value: 5_000, OriginalValue: 1_000 },
              { Label: 'Integrity', Value: 20, OriginalValue: 40 },
              { Label: 'MaximumRange', Value: 5_000, OriginalValue: 1_000 },
              { Label: 'PowerDraw', Value: 0.17, OriginalValue: 0.34 },
              { Label: 'ThermalLoad', Value: 1, OriginalValue: 2 },
            ],
          },
        },
      ],
    });

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));
    expect(encodeBuildLinkFragment(source)).toBe('b.5SJLJs0jX!Cg!H@ZISp');
    const sourceModule = source.fittedModuleAt('LargeHardpoint1')!;
    const decodedModule = decoded.fittedModuleAt('LargeHardpoint1')!;

    expect(sourceModule.preEngineeredVariant).not.toBeNull();
    expect(decodedModule.preEngineeredVariant).toEqual(sourceModule.preEngineeredVariant);
    expect(decodedModule.effectiveStats).toEqual(sourceModule.effectiveStats);
  });

  it('round-trips every package-identifiable fixed pre-engineered variant', () => {
    const identifiable = PRE_ENGINEERED_MODULES.filter(({ modifiers }) => modifiers?.length);
    expect(identifiable).toHaveLength(79);

    for (const variant of identifiable) {
      const source = ShipLoadout.fromLoadout({
        Ship: 'Krait_MkII',
        Modules: [
          {
            Slot: 'LargeHardpoint1',
            Item: variant.symbol,
            Engineering: {
              BlueprintName: variant.blueprintSymbol,
              Level: variant.grade,
              Quality: 1,
              ...(variant.experimentalEffectSymbol === undefined
                ? {}
                : { ExperimentalEffect: variant.experimentalEffectSymbol }),
              Modifiers: getPreEngineeredJournalModifiers(variant),
            },
          },
        ],
      });
      const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));

      expect(decoded.fittedModuleAt('LargeHardpoint1')?.preEngineeredVariant).toEqual(
        source.fittedModuleAt('LargeHardpoint1')?.preEngineeredVariant,
      );
      expect(decoded.fittedModuleAt('LargeHardpoint1')?.effectiveStats).toEqual(
        source.fittedModuleAt('LargeHardpoint1')?.effectiveStats,
      );
    }
  });

  it('pins the modifier block published for every fixed variant', () => {
    // The pre-engineered record can restore every package variant from its published modifier
    // block. Pin both sets so a variant losing that block cannot pass unnoticed.
    const withoutModifiers = PRE_ENGINEERED_MODULES.filter(({ modifiers }) => !modifiers?.length);
    const withModifiers = PRE_ENGINEERED_MODULES.filter(({ modifiers }) => modifiers?.length);
    expect(withoutModifiers).toHaveLength(0);
    expect(new Set(withModifiers)).toEqual(new Set(PRE_ENGINEERED_MODULES));
  });

  it('pins which Mercenary articles the shop sells with an experimental effect', () => {
    // Twelve of the 25 arrive with an effect already on them. The record encodes the effect against
    // that pinned value rather than writing it out, so a row gaining or losing one changes the bit
    // layout of every link that names it. Pin the ten so it cannot move unnoticed.
    const baked = PRE_ENGINEERED_MODULES.filter(
      ({ acquisition, experimentalEffectSymbol }) =>
        acquisition === 'mercenary' && experimentalEffectSymbol !== undefined,
    );

    expect(
      baked.map(({ symbol, blueprintSymbol, grade, experimentalEffectSymbol }) => [
        symbol,
        blueprintSymbol,
        grade,
        experimentalEffectSymbol,
      ]),
    ).toEqual([
      [
        'Hpt_Slugshot_Gimbal_Small',
        'FragmentCannonSmall_DoubleScreaming',
        1,
        'special_screening_shell',
      ],
      [
        'Hpt_Slugshot_Gimbal_Large',
        'FragmentCannonLarge_DoubleScreaming',
        1,
        'special_screening_shell',
      ],
      ['Hpt_MiningLaser_Fixed_Small', 'MiningLaser_LongRange', 1, 'special_incendiary_rounds'],
      ['Hpt_MultiCannon_Fixed_Medium', 'MultiCannon_Rapid', 1, 'special_phasing_sequence'],
      ['Hpt_Railgun_Fixed_Medium', 'RailGun_LongShot', 1, 'special_feedback_cascade_cooled'],
      ['Hpt_BasicMissileRack_Fixed_Medium', 'SeekerMissileRack_Drag', 1, 'special_drag_munitions'],
      [
        'Hpt_BasicMissileRack_Fixed_Medium',
        'SeekerMissileRack_LightWeightThermal',
        1,
        'special_thermal_cascade',
      ],
      [
        'Hpt_BasicMissileRack_Fixed_Medium',
        'SeekerMissileRackMedium_Lockdown',
        1,
        'special_fsd_interrupt',
      ],
      [
        'Hpt_BasicMissileRack_Fixed_Large',
        'SeekerMissileRackLarge_Lockdown',
        1,
        'special_fsd_interrupt',
      ],
      [
        'Hpt_PulseLaserBurst_Gimbal_Medium',
        'BurstLaser_Regenerative',
        1,
        'special_regeneration_sequence',
      ],
      ['Hpt_Cannon_Fixed_Huge', 'Cannon_ForceImpact', 1, 'special_force_shell'],
      [
        'Hpt_BasicMissileRack_Fixed_Large',
        'SeekerMissileRackLarge_ExposingMissiles',
        1,
        'special_drag_munitions',
      ],
    ]);
  });

  it('fits every Mercenary purchase stating exactly the modifiers its article moves', () => {
    // What makes the pre-engineered record sufficient for a purchase. The package publishes no
    // fixed stat block for a Mercenary article. What it moves is whatever its baked experimental
    // effect moves, and the fitted module states that and nothing else. That is the same block
    // `getPreEngineeredJournalModifiers` reports, which is what the record replays. An article
    // moving nothing carries no `Modifiers` key rather than an empty array, so the two are
    // compared through `?? []`.
    let covered = 0;
    for (const variant of mercenaryVariants()) {
      const build = ShipLoadout.empty('Anaconda');
      const fitted = build.fittedModuleAt(fitMercenaryVariant(build, variant))!;

      expect(fitted.engineering?.Level).toBe(variant.grade);
      expect(fitted.engineering?.ExperimentalEffect).toBe(variant.experimentalEffectSymbol);
      expect(fitted.engineering?.Modifiers ?? []).toEqual(
        getPreEngineeredJournalModifiers(variant),
      );
      covered += 1;
    }

    expect(covered).toBe(25);

    // One named article proves the block is not empty for all of them.
    const baked = mercenaryVariants().find(({ symbol }) => symbol === 'Hpt_Railgun_Fixed_Medium')!;
    const withEffect = ShipLoadout.empty('Krait_MkII');
    withEffect.setPreEngineeredVariant('LargeHardpoint1', baked);

    expect(
      withEffect.fittedModuleAt('LargeHardpoint1')?.engineering?.Modifiers?.length,
    ).toBeGreaterThan(0);
  });

  it('round-trips every baked Mercenary article fitted in the application', () => {
    // The shape a Commander reaches by buying one from the candidate list, which no capture is
    // involved in. The record carries the identity alone, so this is what proves the effect, the
    // modifiers it moves and the stats they resolve to survive the trip for all twelve.
    const covered: string[] = [];
    for (const variant of mercenaryVariants()) {
      if (variant.experimentalEffectSymbol === undefined) continue;
      const source = ShipLoadout.empty('Anaconda');
      const slot = fitMercenaryVariant(source, variant);
      const before = source.fittedModuleAt(slot)!;
      expect(before.preEngineeredVariant).toEqual(variant);

      const fragment = encodeBuildLinkFragment(source);
      const decoded = decodeBuildLinkFragment(fragment);
      const after = decoded.fittedModuleAt(slot)!;

      expect(after.preEngineeredVariant).toEqual(variant);
      expect(after.engineering?.ExperimentalEffect).toBe(variant.experimentalEffectSymbol);
      expect(after.engineering?.Modifiers).toEqual(before.engineering?.Modifiers);
      expect(after.effectiveStats).toEqual(before.effectiveStats);
      expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
      covered.push(variant.blueprintSymbol);
    }

    expect(covered).toHaveLength(12);
  });

  it('round-trips every complete Mercenary purchase capture', () => {
    for (const variant of mercenaryVariants()) {
      const slot = mercenarySlot(variant);
      const source = mercenaryBuild(
        variant,
        variant.grade,
        getPreEngineeredJournalModifiers(variant),
        variant.experimentalEffectSymbol,
      );
      const sourceModule = source.fittedModuleAt(slot)!;
      expect(sourceModule.preEngineeredVariant).toEqual(variant);
      expect(sourceModule.engineering?.Modifiers).toEqual(
        getPreEngineeredJournalModifiers(variant),
      );

      const fragment = encodeBuildLinkFragment(source);
      const decoded = decodeBuildLinkFragment(fragment);
      const decodedModule = decoded.fittedModuleAt(slot)!;

      expect(decodedModule.preEngineeredVariant).toEqual(variant);
      expect(decodedModule.engineering?.Level).toBe(variant.grade);
      expect(decodedModule.effectiveStats).toEqual(sourceModule.effectiveStats);
      expect(BuildMetrics.of(decoded).buildCost().mercCoins).toBe(
        BuildMetrics.of(source).buildCost().mercCoins,
      );
      expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
    }
  });

  it('refuses a Mercenary purchase whose capture states modifiers the record cannot restore', () => {
    // The package publishes no modifier block for a Mercenary purchase, so the pre-engineered
    // record restores none. A capture that states them would decode as a stock module, which is
    // why this is refused rather than encoded.
    for (const variant of mercenaryVariants()) {
      const slot = mercenarySlot(variant);
      const source = mercenaryBuild(variant, variant.grade, [
        { Label: 'Mass', Value: 3, OriginalValue: 2 },
      ]);
      const sourceModule = source.fittedModuleAt(slot)!;
      expect(sourceModule.preEngineeredVariant).toEqual(variant);
      expect(sourceModule.engineering?.Modifiers).toHaveLength(1);

      // The ordinary record is the fallback, and no Mercenary blueprint offers the purchase grade
      // as a craftable one, so it cannot spell this either.
      const error = expectCodecError(() => encodeBuildLinkFragment(source), 'invalidPayload');
      expect(error.message).toContain(slot);
    }
  });

  it('refuses a Mercenary purchase whose modifiers an experimental effect cannot account for', () => {
    // With an effect applied the record does restore modifiers — the effect's. Comparing counts
    // would wave this through and decode the module to entirely different values, so the record is
    // taken only when it reproduces the module's own modifiers.
    const variant = mercenaryVariants().find(
      ({ symbol }) => symbol === 'Int_PowerDistributor_Size5_Class5',
    )!;
    const source = ShipLoadout.fromLoadout({
      Ship: 'Krait_MkII',
      Modules: [
        {
          Slot: 'Slot01_Size6',
          Item: variant.symbol,
          Engineering: {
            BlueprintName: variant.blueprintSymbol,
            Level: variant.grade,
            Quality: 1,
            ExperimentalEffect: 'special_powerdistributor_capacity',
            Modifiers: [
              { Label: 'WeaponsCapacity', Value: 30, OriginalValue: 41 },
              { Label: 'SystemsCapacity', Value: 32, OriginalValue: 29 },
              { Label: 'EnginesCapacity', Value: 32, OriginalValue: 29 },
            ],
          },
        },
      ],
    });
    const sourceModule = source.fittedModuleAt('Slot01_Size6')!;
    expect(sourceModule.preEngineeredVariant).toEqual(variant);
    expect(sourceModule.engineering?.Modifiers).toHaveLength(3);

    const error = expectCodecError(() => encodeBuildLinkFragment(source), 'invalidPayload');
    expect(error.message).toContain('Slot01_Size6');
  });

  it('round-trips a Mercenary purchase whose capture agrees with its experimental effect', () => {
    // The record does describe this one: the effect is pinned in the record, and the capture states
    // exactly the modifiers that effect contributes, so decoding reproduces them. The application
    // cannot reach this state itself — the package rejects an uncatalogued variant effect — so a
    // journal or SLEF capture is the only way in, which is exactly what a shared link must carry.
    const variant = mercenaryVariants().find(
      ({ symbol }) => symbol === 'Int_PowerDistributor_Size5_Class5',
    )!;
    const experimentalEffectSymbol = 'special_powerdistributor_capacity';
    const faithful = getPreEngineeredJournalModifiers({ ...variant, experimentalEffectSymbol });
    expect(faithful.length).toBeGreaterThan(0);

    const source = ShipLoadout.fromLoadout({
      Ship: 'Krait_MkII',
      Modules: [
        {
          Slot: 'Slot01_Size6',
          Item: variant.symbol,
          Engineering: {
            BlueprintName: variant.blueprintSymbol,
            Level: variant.grade,
            Quality: 1,
            ExperimentalEffect: experimentalEffectSymbol,
            Modifiers: faithful,
          },
        },
      ],
    });
    const sourceModule = source.fittedModuleAt('Slot01_Size6')!;
    expect(sourceModule.preEngineeredVariant).toEqual(variant);

    const fragment = encodeBuildLinkFragment(source);
    const decoded = decodeBuildLinkFragment(fragment);
    const decodedModule = decoded.fittedModuleAt('Slot01_Size6')!;

    expect(decodedModule.engineering?.ExperimentalEffect).toBe(experimentalEffectSymbol);
    expect(decodedModule.engineering?.Modifiers).toEqual(sourceModule.engineering?.Modifiers);
    expect(decodedModule.effectiveStats).toEqual(sourceModule.effectiveStats);
    expect(decodedModule.preEngineeredVariant?.acquisition).toBe('mercenary');
    expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
  });

  it('keeps the fitted grade of a Mercenary variant upgraded past its purchase', () => {
    // Every one of them, including the six the package gives no ordinary engineering menu: table 1
    // records their variants' own blueprints, so the ordinary record can name the climbed grade.
    for (const variant of mercenaryVariants()) {
      const grades = blueprintGrades(variant.blueprintSymbol);
      expect(grades).not.toContain(variant.grade);

      for (const grade of grades) {
        const slot = mercenarySlot(variant);
        const source = mercenaryBuild(variant, grade);
        const sourceModule = source.fittedModuleAt(slot)!;
        expect(sourceModule.preEngineeredVariant).toEqual(variant);
        expect(sourceModule.engineering?.Level).toBe(grade);

        const fragment = encodeBuildLinkFragment(source);
        const decoded = decodeBuildLinkFragment(fragment);
        const decodedModule = decoded.fittedModuleAt(slot)!;

        expect(decodedModule.engineering?.Level).toBe(grade);
        expect(decodedModule.preEngineeredVariant).toEqual(variant);
        expect(BuildMetrics.of(decoded).buildCost().mercCoins).toBe(
          BuildMetrics.of(source).buildCost().mercCoins,
        );
        expect(minimalState(decoded)).toEqual(minimalState(source));
        expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
        // The crafted grade must survive as engineering, not merely as a number: the decoded
        // module carries the blueprint's regenerated modifiers and stats that differ from stock.
        expect(decodedModule.engineering?.Modifiers?.length ?? 0).toBeGreaterThan(0);
        expect(decodedModule.effectiveStats).not.toEqual(stockStats(variant.symbol));
      }
    }
  });

  it('names the slot when a module carrying engineering has no recipe for it', () => {
    // The advanced small mining laser accepts no blueprint, so a capture that engineers one cannot
    // be spelled. FR-022b wants the refusal to say which slot, not merely that one exists.
    const source = ShipLoadout.fromLoadout({
      Ship: 'SideWinder',
      Modules: [
        {
          Slot: 'SmallHardpoint1',
          Item: 'Hpt_MiningLaser_Fixed_Small_Advanced',
          Engineering: { BlueprintName: 'Weapon_LongRange', Level: 3, Quality: 1 },
        },
      ],
    });

    const error = expectCodecError(() => encodeBuildLinkFragment(source), 'invalidPayload');
    expect(error.message).toContain('SmallHardpoint1');
    expect(error.message).toContain('Hpt_MiningLaser_Fixed_Small_Advanced');
  });

  it('spells the six articles the package gives no engineering menu of their own', () => {
    // These sit on modules the package reports no ordinary blueprint for. Table 1 lists their
    // variants' blueprints all the same, because a bought article can be climbed past the grade it
    // was sold at and only an ordinary record can say so — without them the pre-engineered record
    // would silently restore the purchase grade, and the encoder refused instead, so the link
    // vanished the moment a Commander engineered one (2026-08-22).
    const menuless = PRE_ENGINEERED_MODULES.filter(
      (variant) => variant.acquisition === 'mercenary' && !hasOwnEngineeringMenu(variant.symbol),
    );
    expect(menuless.map(({ symbol }) => symbol).sort()).toEqual([
      'Hpt_CausticMissile_Fixed_Medium',
      'Hpt_MiningLaser_Fixed_Small',
      'Hpt_Mining_AbrBlstr_Fixed_Small',
      'Int_CargoRack_Size5_Class1',
      'Int_CargoRack_Size6_Class1',
      'Int_ModuleReinforcement_Size5_Class2',
    ]);

    for (const variant of menuless) {
      // Nothing but its own variants' blueprints: the set exists so a climbed article can be
      // spelled, not to invent an engineering menu the package does not offer.
      const owned = PRE_ENGINEERED_MODULES.filter(({ symbol }) => symbol === variant.symbol).map(
        ({ blueprintSymbol }) => blueprintSymbol,
      );
      expect([...ordinaryBlueprints(variant.symbol)].sort()).toEqual([...new Set(owned)].sort());
    }
  });

  it('refers a repeated engineering record back to its own module', () => {
    // Three mounts of one module, two rolls, and the third mount repeats the first. The
    // dictionary the third refers into belongs to the module, so its index covers two records
    // rather than every record in the build.
    const repeated = shieldBoosterKrait([
      'ShieldBooster_Resistive',
      'ShieldBooster_HeavyDuty',
      'ShieldBooster_Resistive',
      'ShieldBooster_HeavyDuty',
    ]);
    const distinct = shieldBoosterKrait([
      'ShieldBooster_Resistive',
      'ShieldBooster_HeavyDuty',
      'ShieldBooster_Thermic',
      'ShieldBooster_Kinetic',
    ]);

    const fragment = encodeBuildLinkFragment(repeated);
    const decoded = decodeBuildLinkFragment(fragment);

    expect(minimalState(decoded)).toEqual(minimalState(repeated));
    expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
    expect(decoded.fittedModuleAt('TinyHardpoint3')?.engineering).toEqual(
      decoded.fittedModuleAt('TinyHardpoint1')?.engineering,
    );
    expect(fragment.length).toBeLessThan(encodeBuildLinkFragment(distinct).length);
  });

  it('writes a pre-engineered record in full on a module that already has ordinary records', () => {
    // A pre-engineered record carries an identity rather than a state, so it never joins a
    // module's dictionary and never refers into one, however many ordinary records precede it.
    const variant = PRE_ENGINEERED_MODULES.find(
      ({ symbol, acquisition }) =>
        symbol.toLowerCase() === 'hpt_multicannon_fixed_medium' && acquisition === 'communityGoal',
    )!;
    const source = ShipLoadout.default('Krait_MkII');
    for (const slot of ['LargeHardpoint1', 'LargeHardpoint2', 'LargeHardpoint3']) {
      const candidate = source
        .modulesForSlot(slot)
        .find((module) => module.symbol.toLowerCase() === 'hpt_multicannon_fixed_medium')!;
      source.setModule(slot, candidate);
    }
    source.applyBlueprint('LargeHardpoint1', 'Weapon_Efficient', { grade: 5, quality: 1 });
    source.applyBlueprint('LargeHardpoint2', 'Weapon_Efficient', { grade: 5, quality: 1 });
    source.setPreEngineeredVariant('LargeHardpoint3', variant);

    const fragment = encodeBuildLinkFragment(source);
    const decoded = decodeBuildLinkFragment(fragment);

    expect(minimalState(decoded)).toEqual(minimalState(source));
    expect(encodeBuildLinkFragment(decoded)).toBe(fragment);
    expect(decoded.fittedModuleAt('LargeHardpoint3')?.preEngineeredVariant).toEqual(variant);
    expect(decoded.fittedModuleAt('LargeHardpoint2')?.engineering?.BlueprintName).toBe(
      'Weapon_Efficient',
    );
  });

  it('rejects a repeated engineering literal and an out-of-range dictionary index', () => {
    // The messages matter here: a hand-built body is non-canonical in other ways too, and the
    // canonical-form check would reject it whatever the records said. Naming the error proves
    // the reader refused the record rather than the body around it.
    const repeatedLiteral = expectCodecError(
      () =>
        decodeBuildLinkFragment(
          craftedShieldBoosterEngineering([{ blueprint: 0 }, { blueprint: 0 }]),
        ),
      'invalidPayload',
    );
    expect(repeatedLiteral.message).toBe('A repeated engineering record is not canonical.');

    const outOfRange = expectCodecError(
      () =>
        decodeBuildLinkFragment(
          craftedShieldBoosterEngineering([
            { blueprint: 0 },
            { blueprint: 1 },
            { blueprint: 2 },
            { reference: 3 },
          ]),
        ),
      'invalidPayload',
    );
    expect(outOfRange.message).toBe('A bounded integer is invalid.');
  });

  it('round-trips festive modules as package-owned pre-engineered variants', async () => {
    const cases = PRE_ENGINEERED_MODULES.filter(({ blueprintSymbol }) =>
      blueprintSymbol.startsWith('Decorative_'),
    );
    expect(cases).toHaveLength(3);
    for (const variant of cases) {
      const source = ShipLoadout.empty('Krait_MkII');
      source.setPreEngineeredVariant('MediumHardpoint1', variant);
      const modifiers = source.fittedModuleAt('MediumHardpoint1')?.engineering?.Modifiers;
      expect(modifiers?.length).toBeGreaterThan(0);

      const fragment = await encodeBuildLinkFragmentOnDemand(source);
      const decoded = await decodeBuildLinkFragmentOnDemand(fragment);

      expect(readPayloadBits(fragment, 0, 10)).toBe(1);
      if (variant.blueprintSymbol === 'Decorative_Green') {
        expect(fragment).toBe('b.5S25TzaeLjTwhwDXHrX');
      }
      expect(`https://ships.example/#${fragment}`.length).toBeLessThanOrEqual(500);
      expect(minimalState(decoded)).toEqual(minimalState(source));
      expect(decoded.fittedModuleAt('MediumHardpoint1')?.engineering?.Modifiers).toEqual(modifiers);
      expect(decoded.fittedModuleAt('MediumHardpoint1')?.preEngineeredVariant).toEqual(variant);
      expect(decoded.fittedModuleAt('MediumHardpoint1')?.effectiveStats).toEqual(
        source.fittedModuleAt('MediumHardpoint1')?.effectiveStats,
      );
      expect(await encodeBuildLinkFragmentOnDemand(decoded)).toBe(fragment);
    }
  });

  it('preserves unrelated engineered state when decoding a festive pre-engineered module', () => {
    const source = ShipLoadout.fromLoadout({
      Ship: 'Krait_MkII',
      Modules: [
        {
          Slot: 'MediumHardpoint1',
          Item: 'Hpt_FlakMortar_Turret_Medium',
        },
        { Slot: 'LargeHardpoint1', Item: 'Hpt_MultiCannon_Fixed_Medium' },
      ],
    });
    source.applyBlueprint('LargeHardpoint1', 'Weapon_HighCapacity', {
      grade: 5,
      quality: 1,
    });
    const festive = PRE_ENGINEERED_MODULES.find(
      ({ blueprintSymbol }) => blueprintSymbol === 'Decorative_Green',
    )!;
    source.setPreEngineeredVariant('MediumHardpoint1', festive);
    const ordinaryBefore = source.fittedModuleAt('LargeHardpoint1')!;

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));
    const ordinaryAfter = decoded.fittedModuleAt('LargeHardpoint1')!;

    expect(ordinaryAfter.engineering).toEqual(ordinaryBefore.engineering);
    expect(ordinaryAfter.effectiveStats).toEqual(ordinaryBefore.effectiveStats);
    expect(ordinaryAfter.effectiveStats?.burstInterval).toBe(
      ordinaryBefore.effectiveStats?.burstInterval,
    );
  });

  it('stores the table version as the first field inside the payload', () => {
    const encoded = encodeBuildLinkFragment(ShipLoadout.empty('SideWinder'));

    expect(readPayloadBits(encoded, 0, 10)).toBe(1);
    expect(readPayloadBits(withPayloadTableVersion(encoded, 1_023), 0, 10)).toBe(1_023);
  });

  it('pins the reviewed pre-release table 1 content hash', async () => {
    // Table 1 is regenerated in place while the application and link format remain unpublished.
    // Once released, a changed hash belongs under the next table number.
    const { contentHash, tableVersion } = codecTable1.$generated;
    const { $generated: _omitted, ...payload } = codecTable1;

    expect(contentHash).toBe('c3d1b5811a5eccec4e2101b82c68cf1960f7328435e8232b21082a58aabec370');
    expect(await canonicalHash(payload)).toBe(contentHash);
    expect(tableVersion).toBe(1);
  });

  it('encodes both grades of a two-grade blueprint without a redundant bounded symbol', () => {
    const blueprintIndex = codecTable1.BLUEPRINTS.indexOf('FSD_LongRange');
    const table2 = {
      ...codecTable1,
      $generated: { ...codecTable1.$generated, tableVersion: 2 },
      BLUEPRINT_GRADES: codecTable1.BLUEPRINT_GRADES.map((grades, index) =>
        index === blueprintIndex ? [1, 5] : grades,
      ),
    };
    const codec2 = createBuildLinkCodec(2, table2);

    for (const grade of [1, 5]) {
      const source = ShipLoadout.default('Krait_MkII');
      source.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', { grade, quality: 1 });
      const decoded = codec2.decodeBuildLinkFragment(codec2.encodeBuildLinkFragment(source));

      expect(decoded.fittedModuleAt('FrameShiftDrive')?.engineering).toMatchObject({
        BlueprintName: 'FSD_LongRange',
        Level: grade,
        Quality: 1,
      });
    }
  });

  it('shares one codec implementation across independent table versions', () => {
    const table2 = {
      ...codecTable1,
      $generated: { ...codecTable1.$generated, tableVersion: 2 },
      SHIPS: [codecTable1.SHIPS[1]!, codecTable1.SHIPS[0]!, ...codecTable1.SHIPS.slice(2)],
    };
    const codec2 = createBuildLinkCodec(2, table2);
    const source = ShipLoadout.default('SideWinder');
    const nestedSource = ShipLoadout.empty('Eagle');
    let nestedFragment: string | undefined;
    const reentrantSource = new Proxy(source, {
      get(loadout, property) {
        if (property === 'shipSymbol') {
          nestedFragment = encodeBuildLinkFragment(nestedSource);
        }
        const value: unknown = Reflect.get(loadout, property, loadout);
        return typeof value === 'function' ? value.bind(loadout) : value;
      },
    });
    const encoded = codec2.encodeBuildLinkFragment(reentrantSource);

    expect(readPayloadBits(encoded, 0, 10)).toBe(2);
    expect(readPayloadBits(encoded, 10, testBitsRequired(table2.SHIPS.length))).toBe(1);
    expect(minimalState(codec2.decodeBuildLinkFragment(encoded))).toEqual(minimalState(source));
    expect(readPayloadBits(nestedFragment!, 0, 10)).toBe(1);
    expect(decodeBuildLinkFragment(nestedFragment!).shipSymbol).toBe('Eagle');
    expectCodecError(() => decodeBuildLinkFragment(encoded), 'unsupportedTableVersion');
    expect(() => createBuildLinkCodec(2, codecTable1)).toThrowError(
      'The build-link codec table version is invalid.',
    );
  });

  it('does not widen global experimental indexes at an exact power of two', () => {
    const source = ShipLoadout.default('Krait_MkII');
    source.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', {
      grade: 5,
      quality: 1,
      experimentalEffectSymbol: 'special_fsd_heavy',
    });
    source.applyBlueprint('PowerPlant', 'PowerPlant_Armoured', {
      grade: 5,
      quality: 1,
    });
    const moduleIndex = codecTable1.MODULES.indexOf(
      source.fittedModuleAt('FrameShiftDrive')!.symbol,
    );
    const emptySetIndex = codecTable1.EXPERIMENTAL_SETS.length;
    const tableWithEffectCount = (effectCount: number) => ({
      ...codecTable1,
      $generated: { ...codecTable1.$generated, tableVersion: 2 },
      EXPERIMENTAL_EFFECTS: [
        ...codecTable1.EXPERIMENTAL_EFFECTS,
        ...Array.from(
          { length: effectCount - codecTable1.EXPERIMENTAL_EFFECTS.length },
          (_value, index) => `TestEffect_${index}`,
        ),
      ],
      EXPERIMENTAL_SETS: [...codecTable1.EXPERIMENTAL_SETS, []],
      EXPERIMENTAL_SET_BY_MODULE: codecTable1.EXPERIMENTAL_SET_BY_MODULE.map((set, index) =>
        index === moduleIndex ? emptySetIndex : set,
      ),
    });

    const at127 = createBuildLinkCodec(2, tableWithEffectCount(127));
    const at128 = createBuildLinkCodec(2, tableWithEffectCount(128));
    const fragment = at127.encodeBuildLinkFragment(source);

    expect(at128.encodeBuildLinkFragment(source)).toBe(fragment);
    expect(minimalState(at128.decodeBuildLinkFragment(fragment))).toEqual(minimalState(source));
  });

  it('loads the payload-declared table on demand', async () => {
    const source = ShipLoadout.default('Krait_MkII');
    const encoded = await encodeBuildLinkFragmentOnDemand(source);

    expect(minimalState(await decodeBuildLinkFragmentOnDemand(encoded))).toEqual(
      minimalState(source),
    );
    expect(readPayloadBits(encoded, 0, 10)).toBe(1);
    expect(
      minimalState(await decodeBuildLinkFragmentOnDemand(encodeBuildLinkFragment(source))),
    ).toEqual(minimalState(source));
    await expect(
      decodeBuildLinkFragmentOnDemand(withPayloadTableVersion(encoded, 513)),
    ).rejects.toMatchObject({ code: 'unsupportedTableVersion' });

    const corrupted = decodePayload(encoded);
    corrupted[0]! ^= 1;
    await expect(
      decodeBuildLinkFragmentOnDemand(`b.${encodeBuildLinkPayload(corrupted)}`),
    ).rejects.toMatchObject({ code: 'integrityCheckFailed' });
  });

  it('keeps the frozen literal special-build link stable in the decode direction', () => {
    // Freeze before release; once table 1 ships, never regenerate this fixture to make a build pass.
    // Re-frozen 2026-09-01 with table 1 itself, when its candidate sets took a popularity order.
    const preEngineered = decodeBuildLinkFragment('b.5SJLJs0jX!Cg!H@ZISp');

    expect(preEngineered.shipSymbol).toBe('Krait_MkII');
    expect(preEngineered.shipName).toBeNull();
    expect(preEngineered.shipIdent).toBeNull();
    expect(
      preEngineered
        .slots()
        .filter(({ immovableReason }) => immovableReason === 'requiredSlot')
        .every(({ module }) => module !== null),
    ).toBe(true);
    expect(preEngineered.fittedModuleAt('LargeHardpoint1')).toMatchObject({
      preEngineeredVariant: {
        symbol: 'Hpt_Mining_AbrBlstr_Fixed_Small',
        blueprintSymbol: 'Weapon_LongRange',
        grade: 5,
        acquisition: 'communityGoal',
      },
      effectiveStats: {
        integrity: 20,
        powerDraw: 0.17,
        distributorDraw: 1,
        thermalLoad: 1,
        falloffRange: 5_000,
        maximumRange: 5_000,
      },
    });
  });

  it('meets the reference link-length targets', () => {
    const baseUrl = 'https://ships.example/';
    const large = makeFullyEngineeredAnaconda();
    const emptyFragment = encodeBuildLinkFragment(ShipLoadout.empty('SideWinder'));
    const typicalFragment = encodeBuildLinkFragment(ShipLoadout.default('Krait_MkII'));
    const largeFragment = encodeBuildLinkFragment(large);
    const emptyLink = `${baseUrl}#${emptyFragment}`;
    const typicalLink = `${baseUrl}#${typicalFragment}`;
    const largeLink = `${baseUrl}#${largeFragment}`;
    // Freeze before release; once table 1 ships, never regenerate these fixtures to make a build pass.
    expect([emptyFragment, typicalFragment, largeFragment]).toEqual([
      'b.1S..A@YX6Cjy!R',
      'b.vz,jdQ_4',
      'b.8oUeO4wu5ZrfCrTfzkyEp9VJ1NAj-M4u5tBFFEp3.:aLg6tfRJSrwSAe4Dz6jB',
    ]);
    expect([emptyLink.length, typicalLink.length, largeLink.length]).toEqual([39, 33, 87]);

    expect(emptyLink.length).toBeLessThan(100);
    expect(typicalLink.length).toBeLessThan(300);
    expect(largeLink.length).toBeLessThanOrEqual(500);
    expect(minimalState(decodeBuildLinkFragment(largeFragment))).toEqual(minimalState(large));
    for (const fragment of [emptyFragment, typicalFragment, largeFragment]) {
      expect(encodeBuildLinkFragment(decodeBuildLinkFragment(fragment))).toBe(fragment);
    }

    encodeBuildLinkFragment(large);
    const encodeStarted = performance.now();
    const measuredFragment = encodeBuildLinkFragment(large);
    const encodeDuration = performance.now() - encodeStarted;
    const decodeStarted = performance.now();
    decodeBuildLinkFragment(measuredFragment);
    const decodeDuration = performance.now() - decodeStarted;
    expect(encodeDuration).toBeLessThan(50);
    expect(decodeDuration).toBeLessThan(50);
  });

  it('accepts a leading fragment marker', () => {
    const source = ShipLoadout.default('SideWinder');
    const encoded = encodeBuildLinkFragment(source);

    expect(decodeBuildLinkFragment(`#${encoded}`).shipSymbol).toBe(source.shipSymbol);
  });

  it('refuses unsupported table versions and envelopes', () => {
    const encoded = encodeBuildLinkFragment(ShipLoadout.empty('SideWinder'));

    expectCodecError(
      () => decodeBuildLinkFragment(withPayloadTableVersion(encoded, 513)),
      'unsupportedTableVersion',
    );
    expectCodecError(() => decodeBuildLinkFragment('b1.AAAA'), 'unsupportedEnvelope');
  });

  it('reconstructs every omitted stocked mount with the package default', () => {
    const source = ShipLoadout.fromLoadout({ Ship: 'SideWinder', Modules: [] });

    const fixedSlots = source
      .slots()
      .filter(({ immovableReason }) => immovableReason === 'requiredSlot');
    expect(fixedSlots).toHaveLength(8);
    expect(fixedSlots.every(({ module }) => module !== null)).toBe(true);
    expect(source.fittedModuleAt('CargoHatch')).not.toBeNull();
    // The eight required mounts, the cargo hatch and the planetary approach suite: the ten the
    // package stocks from the hull defaults when its source names none.
    expect(source.importOutcomes).toHaveLength(10);
    expect(source.importOutcomes.every(({ action }) => action === 'defaulted')).toBe(true);
    expect(source.fittedModuleAt('PlanetaryApproachSuite')).not.toBeNull();
    expect(encodeBuildLinkFragment(source)).toBe('b.1S..A@YMcJZp8M');
  });

  it('keeps a removable mount empty across a link when the payload records it empty', () => {
    // Reconstruction stocks the approach suite when its source names none, because a journal
    // event cannot tell a decision from a gap. A codec value gives every mount its own
    // occupancy bit, so removing the suite is a decision the link has to carry (FR-019).
    const source = ShipLoadout.default('SideWinder');
    source.removeModule('PlanetaryApproachSuite');

    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(source));

    expect(decoded.fittedModuleAt('PlanetaryApproachSuite')).toBeNull();
    expect(minimalState(decoded)).toEqual(minimalState(source));
  });

  it('refuses a slot the pinned table cannot spell', () => {
    // The table is frozen at its version while the Almanac keeps moving, so a hull that gains a
    // mount the table never recorded must be refused rather than encoded into a published link.
    const pruned = {
      ...codecTable1,
      $generated: { ...codecTable1.$generated, tableVersion: 2 },
      SLOTS_BY_SHIP: {
        ...codecTable1.SLOTS_BY_SHIP,
        SideWinder: codecTable1.SLOTS_BY_SHIP.SideWinder.filter(
          (slot) => slot !== 'SmallHardpoint1',
        ),
      },
    };
    const codec2 = createBuildLinkCodec(2, pruned);

    const error = expectCodecError(
      () => codec2.encodeBuildLinkFragment(ShipLoadout.default('SideWinder')),
      'unknownIdentity',
    );
    expect(error.message).toContain('SmallHardpoint1');
  });

  it('refuses a module identity the pinned table cannot spell', () => {
    const source = ShipLoadout.default('SideWinder');
    const symbol = source.fittedModules().find(({ slot }) => slot === 'SmallHardpoint1')!.symbol;
    const index = codecTable1.MODULES.findIndex(
      (entry) => entry.toLowerCase() === symbol.toLowerCase(),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const pruned = {
      ...codecTable1,
      $generated: { ...codecTable1.$generated, tableVersion: 2 },
      MODULES: codecTable1.MODULES.map((entry, at) => (at === index ? 'Absent_Module' : entry)),
    };
    const codec2 = createBuildLinkCodec(2, pruned);

    const error = expectCodecError(() => codec2.encodeBuildLinkFragment(source), 'unknownIdentity');
    expect(error.message).toContain(symbol);
  });

  it('refuses truncated and malformed encodings', () => {
    expectCodecError(() => decodeBuildLinkFragment('b.'), 'invalidEncoding');
    expectCodecError(() => decodeBuildLinkFragment(`b.${'A'.repeat(499)}`), 'invalidEncoding');
    expectCodecError(() => decodeBuildLinkFragment('b.AAAA'), 'invalidPayload');
    expectCodecError(() => decodeBuildLinkFragment('b.not%base70'), 'invalidEncoding');
    const canonical = encodeBuildLinkFragment(ShipLoadout.default('Krait_MkII'));
    expectCodecError(
      () => decodeBuildLinkFragment(`${canonical.slice(0, -1)}!`),
      'invalidEncoding',
    );
  });

  it('always ends Base70 fragments with an autolinker-safe alphanumeric digit', () => {
    for (const { symbol } of SHIPS) {
      for (const source of [ShipLoadout.empty(symbol), ShipLoadout.default(symbol)]) {
        expect(BUILD_LINK_FINAL_ALPHABET).toContain(encodeBuildLinkFragment(source).at(-1));
      }
    }
  });

  it('rejects a semantically valid but non-canonical index-set mode', () => {
    expectCodecError(
      () => decodeBuildLinkFragment(nonCanonicalEmptySidewinder()),
      'invalidPayload',
    );
  });

  it('pins combination-rank boundaries and rejects invalid ranks and preferred-mode ties', () => {
    const slots = codecTable1.SLOTS_BY_SHIP.SideWinder;
    const cases = [
      { removed: [slots[0]!, slots[1]!], rank: 0 },
      { removed: [slots[17]!, slots[18]!], rank: 170 },
    ];
    for (const { removed, rank } of cases) {
      const source = ShipLoadout.default('SideWinder');
      removed.forEach((slot) => source.removeModule(slot));
      const fragment = encodeBuildLinkFragment(source);

      expect(readPayloadBits(fragment, 20, 2)).toBe(3);
      expect(readPayloadBits(fragment, 22, 5)).toBe(2);
      expect(readPayloadBits(fragment, 27, 8)).toBe(rank);
      expect(minimalState(decodeBuildLinkFragment(fragment))).toEqual(minimalState(source));
    }

    const invalidRank = ShipLoadout.default('SideWinder');
    invalidRank.removeModule(slots[17]!);
    invalidRank.removeModule(slots[18]!);
    expectCodecError(
      () =>
        decodeBuildLinkFragment(withPayloadBits(encodeBuildLinkFragment(invalidRank), 27, 8, 171)),
      'invalidPayload',
    );

    const preferredIncluded = ShipLoadout.default('SideWinder');
    preferredIncluded.removeModule(slots[0]!);
    const preferredFragment = encodeBuildLinkFragment(preferredIncluded);
    expect(readPayloadBits(preferredFragment, 20, 2)).toBe(1);
    expectCodecError(
      () => decodeBuildLinkFragment(withPayloadBits(preferredFragment, 20, 2, 3)),
      'invalidPayload',
    );
  });

  it('rejects non-canonical uniform and all-defined power submodes', () => {
    expectCodecError(
      () => decodeBuildLinkFragment(nonCanonicalUniformPriority()),
      'invalidPayload',
    );
    expectCodecError(
      () => decodeBuildLinkFragment(nonCanonicalAllDefinedEnabledState()),
      'invalidPayload',
    );
  });

  it('uses arithmetic coding only when its final body is shorter', () => {
    const dense = encodeBuildLinkFragment(makeFullyEngineeredAnaconda());
    const shipCount = codecTable1.SHIPS.length;
    const tagWidth = testBitsRequired(shipCount + 1);

    expect(readPayloadBits(dense, 10, tagWidth)).toBeGreaterThanOrEqual(shipCount);
    expect(
      readPayloadBits(encodeBuildLinkFragment(ShipLoadout.empty('SideWinder')), 10, tagWidth),
    ).toBeLessThan(shipCount);
    expectCodecError(
      () =>
        decodeBuildLinkFragment(
          'b.K0sHIwAq0MqZOAnrkyWdTvF5Px1CSCHkHbs9/.VvX,@2y9UOqj8YkgFciGNH9_l3LnvS.rtR3x74NVG7',
        ),
      'invalidPayload',
    );

    const arithmeticEmpty = nonCanonicalArithmeticEmptySidewinder();
    expectCodecError(() => decodeBuildLinkFragment(arithmeticEmpty), 'invalidPayload');
  });

  it('rejects every re-checksummed arithmetic truncation and trailing-data form', () => {
    const fragment = encodeBuildLinkFragment(makeFullyEngineeredAnaconda());
    const payload = decodePayload(fragment);
    const body = payload.subarray(0, payload.length - 4);
    for (let length = 0; length < body.length; length += 1) {
      const truncated = new Uint8Array(length + 4);
      truncated.set(body.subarray(0, length));
      // Either refusal is the same refusal, and both are honest. The truncation
      // is re-checksummed, so nothing the codec can check says the body was cut:
      // it is handed a well-formed payload, and reading it off the end either
      // breaks the payload's own structure or names an index no candidate set
      // holds. Which of the two a given length lands on is the table's widths,
      // not the truncation. What this sweep is about is that every one of them
      // is refused.
      expectCodecError(
        () => decodeBuildLinkFragment(encodePayload(truncated)),
        ['invalidPayload', 'unknownIdentity'],
      );
    }
    for (const suffix of [[0], [0xff], [0, 0], [0xff, 0x55]]) {
      const extended = new Uint8Array(body.length + suffix.length + 4);
      extended.set(body);
      extended.set(suffix, body.length);
      expectCodecError(() => decodeBuildLinkFragment(encodePayload(extended)), 'invalidPayload');
    }

    const alternateSuffix = decodePayload(fragment);
    const finalBodyByte = body.length - 1;
    alternateSuffix[finalBodyByte]! ^= 0x80;
    expectCodecError(
      () => decodeBuildLinkFragment(encodePayload(alternateSuffix)),
      'invalidPayload',
    );
  });

  it('either rejects re-checksummed mutations or stabilizes accepted reconstructed state', () => {
    const references = [
      encodeBuildLinkFragment(ShipLoadout.empty('SideWinder')),
      encodeBuildLinkFragment(ShipLoadout.default('Krait_MkII')),
      encodeBuildLinkFragment(makeFullyEngineeredAnaconda()),
    ];
    let state = 0x6d2b_79f5;
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const payload = decodePayload(references[iteration % references.length]!);
      const bodyBits = (payload.length - 4) * 8;
      const bit = (state >>> 0) % bodyBits;
      payload[Math.floor(bit / 8)]! ^= 1 << (bit % 8);
      const mutated = encodePayload(payload);
      try {
        const decoded = decodeBuildLinkFragment(mutated);
        const canonical = encodeBuildLinkFragment(decoded);
        expect(minimalState(decodeBuildLinkFragment(canonical))).toEqual(minimalState(decoded));
        expect(encodeBuildLinkFragment(decodeBuildLinkFragment(canonical))).toBe(canonical);
      } catch (error) {
        expect(error).toBeInstanceOf(BuildLinkCodecError);
      }
    }
  });

  it('preserves surrogate pairs and rejects unpaired UTF-16 surrogates', () => {
    const valid = ShipLoadout.fromLoadout({
      Ship: 'SideWinder',
      ShipName: 'Astraea 🚀',
      Modules: [],
    });
    expect(decodeBuildLinkFragment(encodeBuildLinkFragment(valid)).shipName).toBe('Astraea 🚀');

    for (const invalidName of ['\ud800', '\udc00', '\ud800A', '\ud800\ud800']) {
      const target = ShipLoadout.empty('SideWinder');
      const source = new Proxy(target, {
        get(loadout, property) {
          if (property === 'shipName') return invalidName;
          const value: unknown = Reflect.get(loadout, property, loadout);
          return typeof value === 'function' ? value.bind(loadout) : value;
        },
      });
      expectCodecError(() => encodeBuildLinkFragment(source), 'invalidPayload');
    }
  });

  it('accepts metadata at the string-unit bound and rejects the unit beyond it', () => {
    const atBound = ShipLoadout.fromLoadout({
      Ship: 'SideWinder',
      ShipName: 'A'.repeat(32),
      ShipIdent: 'é'.repeat(16),
      Modules: [],
    });
    const decoded = decodeBuildLinkFragment(encodeBuildLinkFragment(atBound));

    expect(decoded.shipName).toBe(atBound.shipName);
    expect(decoded.shipIdent).toBe(atBound.shipIdent);

    for (const ShipName of ['A'.repeat(33), 'é'.repeat(17)]) {
      const source = ShipLoadout.fromLoadout({ Ship: 'SideWinder', ShipName, Modules: [] });
      expect(() => encodeBuildLinkFragment(source)).toThrowError(
        'A build-link string is too long.',
      );
    }
  });

  it('keeps the largest reference build inside the envelope with metadata at its bound', () => {
    const named = structuredClone(realisticEngineeredCorvette) as unknown as {
      data: { ShipName: string; ShipIdent: string };
    }[];
    // The widest metadata the codec accepts: 32 UTF-8 bytes each, both on its largest build.
    named[0]!.data.ShipName = 'é'.repeat(16);
    named[0]!.data.ShipIdent = 'é'.repeat(16);
    const source = ShipLoadout.fromSlef(named as Parameters<typeof ShipLoadout.fromSlef>[0]);

    const fragment = encodeBuildLinkFragment(source);
    const decoded = decodeBuildLinkFragment(fragment);

    // FR-021 counts a complete codec value, `b.` included.
    expect(fragment.length).toBeLessThanOrEqual(500);
    expect(decoded.shipName).toBe('é'.repeat(16));
    expect(decoded.shipIdent).toBe('é'.repeat(16));
  });

  it('refuses to encode a body its own decoder length limit would reject', () => {
    // 500 characters including `b.` leave 498 encoded digits, which carry 377 bytes of body.
    expectCodecError(() => encodeBuildLinkBody(new Uint8Array(378).fill(0xff)), 'invalidPayload');
    expect(encodeBuildLinkBody(new Uint8Array(377).fill(0xff))).toHaveLength(500);
  });

  it('validates table-one fields before reconstructing a build', () => {
    const empty = encodeBuildLinkFragment(ShipLoadout.empty('SideWinder'));
    const stock = encodeBuildLinkFragment(ShipLoadout.default('SideWinder'));

    expectCodecError(
      () => decodeBuildLinkFragment(withPayloadBits(empty, 10, 6, 63)),
      'invalidPayload',
    );
    expectCodecError(
      () => decodeBuildLinkFragment(withPayloadBits(empty, 21, 5, 31)),
      'invalidPayload',
    );
    expectCodecError(
      () => decodeBuildLinkFragment(withPayloadBits(stock, 18, 1, 0)),
      'invalidPayload',
    );
    expectCodecError(() => decodeBuildLinkFragment(withTrailingByte(empty)), 'invalidPayload');
  });

  it('distinguishes a valid payload from an Almanac reconstruction failure', () => {
    const encoded = encodeBuildLinkFragment(ShipLoadout.default('SideWinder'));
    const reconstruction = vi.spyOn(ShipLoadout, 'fromLoadout').mockImplementationOnce(() => {
      throw new TypeError('Synthetic Almanac failure');
    });

    try {
      expectCodecError(() => decodeBuildLinkFragment(encoded), 'reconstructionFailed');
    } finally {
      reconstruction.mockRestore();
    }
  });

  it('refuses a payload changed after export', () => {
    const encoded = encodeBuildLinkFragment(ShipLoadout.default('SideWinder'));
    const payload = decodePayload(encoded);
    payload[0]! ^= 0b100;
    const tampered = `b.${encodeBuildLinkPayload(payload)}`;

    expectCodecError(() => decodeBuildLinkFragment(tampered), 'integrityCheckFailed');
  });
});

function makeImportedEngineeredBuild(includeCredits = true, quality = 1): ShipLoadout {
  const assembled = ShipLoadout.default('Krait_MkII');
  assembled.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', {
    grade: 5,
    quality,
    experimentalEffectSymbol: 'special_fsd_heavy',
  });
  assembled.setModuleEnabled('FrameShiftDrive', false);
  assembled.setModulePriority('FrameShiftDrive', 4);
  const exported = assembled.toLoadoutEvent({ moduleOrder: 'slots' });
  const event: LoadoutEvent = {
    event: 'Loadout',
    Ship: exported.Ship,
    ShipName: 'Astraea 星',
    ShipIdent: 'TST-42',
    ...(includeCredits
      ? {
          HullValue: 12_345_678.5,
          ModulesValue: 9_876_543.25,
          Rebuy: 1_111_111.125,
        }
      : {}),
    Modules: exported.Modules.map(({ Value: _value, ...module }, index) =>
      includeCredits && index % 3 === 0 ? { ...module, Value: index * 1000 + 0.5 } : module,
    ),
  };
  return ShipLoadout.fromSlef([
    {
      header: { appName: 'Elite Dangerous Ship Builder', appVersion: 1 },
      data: event,
    },
  ]);
}

function blueprintGrades(fdname: string): readonly number[] {
  const index = codecTable1.BLUEPRINTS.indexOf(fdname);
  const grades = codecTable1.BLUEPRINT_GRADES[index] as readonly number[] | undefined;
  if (!grades) throw new Error(`Blueprint ${fdname} is absent from codec table 1.`);
  return grades;
}

/** The blueprints table 1 lets a record over this module name, in table order. */
function ordinaryBlueprints(symbol: string): readonly string[] {
  const moduleIndex = codecTable1.MODULES.indexOf(symbol);
  const setIndex = codecTable1.BLUEPRINT_SET_BY_MODULE[moduleIndex];
  const set = setIndex === undefined ? [] : codecTable1.BLUEPRINT_SETS[setIndex];
  return set.map((index) => codecTable1.BLUEPRINTS[index]);
}

/** Whether the package offers this module an engineering menu of its own, variants aside. */
function hasOwnEngineeringMenu(symbol: string): boolean {
  return getBlueprintsForModule(symbol).length > 0;
}

function stockStats(symbol: string): unknown {
  const stock = ShipLoadout.fromLoadout({
    Ship: 'Krait_MkII',
    Modules: [{ Slot: 'LargeHardpoint1', Item: symbol }],
  });
  return stock.fittedModuleAt('LargeHardpoint1')?.effectiveStats;
}

function mercenaryVariants(): readonly (typeof PRE_ENGINEERED_MODULES)[number][] {
  const variants = PRE_ENGINEERED_MODULES.filter(({ acquisition }) => acquisition === 'mercenary');
  expect(variants).toHaveLength(25);
  return variants;
}

/**
 * Fits a Mercenary variant into whichever build slot accepts it, and names that slot.
 *
 * `setPreEngineeredVariant` is the application's own path and it throws on a slot the article does
 * not belong in. A test that walks all 25 has to find each one its own mount.
 */
function fitMercenaryVariant(
  build: ShipLoadout,
  variant: (typeof PRE_ENGINEERED_MODULES)[number],
): string {
  for (const { key: slot } of build.slots()) {
    try {
      build.setPreEngineeredVariant(slot, variant);
    } catch {
      continue;
    }
    if (build.fittedModuleAt(slot)?.preEngineeredVariant != null) return slot;
  }
  throw new Error(`No slot accepts ${variant.symbol} / ${variant.blueprintSymbol}.`);
}

function mercenarySlot(variant: (typeof PRE_ENGINEERED_MODULES)[number]): string {
  return fitMercenaryVariant(ShipLoadout.empty('Anaconda'), variant);
}

function mercenaryBuild(
  variant: (typeof PRE_ENGINEERED_MODULES)[number],
  grade: number,
  modifiers?: readonly EngineeringModifier[],
  experimentalEffectSymbol?: string,
): ShipLoadout {
  const slot = mercenarySlot(variant);
  return ShipLoadout.fromLoadout({
    Ship: 'Anaconda',
    Modules: [
      {
        Slot: slot,
        Item: variant.symbol,
        Engineering: {
          BlueprintName: variant.blueprintSymbol,
          Level: grade,
          Quality: 1,
          ...(experimentalEffectSymbol === undefined
            ? {}
            : { ExperimentalEffect: experimentalEffectSymbol }),
          ...(modifiers === undefined ? {} : { Modifiers: modifiers }),
        },
      },
    ],
  });
}

const SHIELD_BOOSTER = 'Hpt_ShieldBooster_Size0_Class5';

/** A stock Krait Mk II whose utility mounts carry one shield booster per named blueprint. */
function shieldBoosterKrait(blueprints: readonly string[]): ShipLoadout {
  const source = ShipLoadout.default('Krait_MkII');
  blueprints.forEach((blueprint, index) => {
    const slot = `TinyHardpoint${index + 1}`;
    const candidate = source
      .modulesForSlot(slot)
      .find((module) => module.symbol.toLowerCase() === SHIELD_BOOSTER.toLowerCase())!;
    source.setModule(slot, candidate);
    source.applyBlueprint(slot, blueprint, { grade: 5, quality: 1 });
  });
  return source;
}

/**
 * A hand-built packed body for the same shield-booster Krait, with its engineering records
 * written one at a time.
 *
 * The encoder never spells a repeated literal or an index its dictionary does not hold, so the
 * only way to present the reader with one is to write the body here. Everything ahead of the
 * records is deliberately plain — the stock loadout with four changed utility mounts and no
 * power state — and every index set is written as a bitmap, which the reader accepts; the
 * canonical-form check that would refuse the bitmap runs after the records are read.
 */
function craftedShieldBoosterEngineering(
  records: readonly { readonly blueprint?: number; readonly reference?: number }[],
): string {
  const ship = 'Krait_MkII';
  const slots = codecTable1.SLOTS_BY_SHIP[ship];
  const defaults = codecTable1.DEFAULT_MODULES_BY_SHIP[ship] as readonly (number | null)[];
  const booster = codecTable1.MODULES.findIndex(
    (symbol) => symbol.toLowerCase() === SHIELD_BOOSTER.toLowerCase(),
  );
  const changed = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.startsWith('TinyHardpoint'))
    .slice(0, records.length)
    .map(({ index }) => index);
  const modules = defaults.map((module, index) => (changed.includes(index) ? booster : module));
  const occupied = modules.flatMap((module, index) => (module === null ? [] : [index]));
  const engineerable = (module: number): boolean =>
    codecTable1.BLUEPRINT_SETS[codecTable1.BLUEPRINT_SET_BY_MODULE[module]!]!.length > 0 ||
    (codecTable1.PRE_ENGINEERED_SET_BY_MODULE[module] ?? []).length > 0;
  const eligible = occupied.flatMap((slotIndex, position) =>
    engineerable(modules[slotIndex]!) ? [position] : [],
  );
  const engineered = changed.map((slotIndex) => eligible.indexOf(occupied.indexOf(slotIndex)));
  const candidates = codecTable1.MODULE_SETS[codecTable1.MODULE_SET_BY_SHIP[ship][changed[0]!]!]!;
  const blueprintSet = codecTable1.BLUEPRINT_SETS[codecTable1.BLUEPRINT_SET_BY_MODULE[booster]!]!;

  const bits: number[] = [];
  writeTestBits(bits, 1, 10);
  writeTestBits(bits, codecTable1.SHIPS.indexOf(ship), testBitsRequired(codecTable1.SHIPS.length));
  writeTestBits(bits, 0, 1); // ship name absent
  writeTestBits(bits, 0, 1); // ship ident absent
  writeTestBits(bits, 0, 1); // not the pristine stock loadout
  writeTestBits(bits, 1, 1); // baseline-relative layout
  writeTestBitmap(bits, slots.length, changed);
  for (const _slotIndex of changed) writeTestBits(bits, 1, 1); // every changed mount is filled
  writeTestBits(bits, 1, 1); // the identity sequence uses back-references
  writeTestBits(bits, 1, 1); // the booster is in its mount's candidate set
  writeTestBits(bits, candidates.indexOf(booster), testBitsRequired(candidates.length));
  for (const _slotIndex of changed.slice(1)) writeTestBits(bits, 1, 1); // same as the previous
  writeTestBits(bits, 0, 1); // no power overrides
  writeTestBits(bits, 1, 1); // engineering present
  writeTestBits(bits, 0, 1); // not every eligible module
  writeTestBitmap(bits, eligible.length, engineered);
  writeTestBits(bits, 1, 1); // engineering records use back-references

  let dictionary = 0;
  for (const [index, { blueprint, reference }] of records.entries()) {
    if (index > 0) writeTestBits(bits, reference === undefined ? 0 : 1, 1);
    if (reference !== undefined) {
      if (dictionary > 1) writeTestBits(bits, reference, testBitsRequired(dictionary));
      continue;
    }
    writeTestBits(bits, 1, 1); // the blueprint is in the module's own set
    writeTestBits(bits, blueprint!, testBitsRequired(blueprintSet.length));
    writeTestBits(bits, 1, 1); // the maximum grade
    writeTestBits(bits, 0, 1); // no experimental effect
    dictionary += 1;
  }
  return encodeTestBits(bits);
}

function writeTestBitmap(bits: number[], valueCount: number, indexes: readonly number[]): void {
  writeTestBits(bits, 0, 2); // bitmap mode
  for (let index = 0; index < valueCount; index += 1) {
    writeTestBits(bits, indexes.includes(index) ? 1 : 0, 1);
  }
}

function decodePayload(fragment: string): Uint8Array {
  return decodeBuildLinkPayload(fragment.slice('b.'.length));
}

function withPayloadTableVersion(fragment: string, version: number): string {
  return withPayloadBits(fragment, 0, 10, version);
}

function readPayloadBits(fragment: string, offset: number, width: number): number {
  const payload = decodePayload(fragment);
  let value = 0;
  for (let bit = 0; bit < width; bit += 1) {
    const absolute = offset + bit;
    const byteIndex = Math.floor(absolute / 8);
    const mask = 1 << (absolute % 8);
    if ((payload[byteIndex]! & mask) !== 0) value |= 1 << bit;
  }
  return value;
}

function testBitsRequired(valueCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(valueCount)));
}

function withPayloadBits(fragment: string, offset: number, width: number, value: number): string {
  const payload = decodePayload(fragment);
  for (let bit = 0; bit < width; bit += 1) {
    const absolute = offset + bit;
    const byteIndex = Math.floor(absolute / 8);
    const mask = 1 << (absolute % 8);
    if ((value & (1 << bit)) === 0) payload[byteIndex]! &= ~mask;
    else payload[byteIndex]! |= mask;
  }
  return encodePayload(payload);
}

function withTrailingByte(fragment: string): string {
  const payload = decodePayload(fragment);
  const body = payload.subarray(0, payload.length - 4);
  const expanded = new Uint8Array(payload.length + 1);
  expanded.set(body);
  expanded[body.length] = 0;
  return encodePayload(expanded);
}

function encodePayload(payload: Uint8Array): string {
  const body = payload.subarray(0, payload.length - 4);
  new DataView(payload.buffer, payload.byteOffset).setUint32(body.length, crc32(body), true);
  return `b.${encodeBuildLinkPayload(payload)}`;
}

function handcraftedMetadataFragment(
  header: number,
  values: readonly { readonly value: number; readonly width: number }[],
  includeTail = true,
): string {
  const bits: number[] = [];
  writeTestBits(bits, 1, 10);
  writeTestBits(
    bits,
    codecTable1.SHIPS.indexOf('SideWinder'),
    testBitsRequired(codecTable1.SHIPS.length),
  );
  writeTestBits(bits, 1, 1); // ship name present
  writeTestBits(bits, 0, 1); // ship ident absent
  writeTestVarUint(bits, header);
  values.forEach(({ value, width }) => writeTestBits(bits, value, width));
  if (includeTail) {
    writeTestBits(bits, 1, 1); // pristine default
  }
  return encodeTestBits(bits);
}

function nonCanonicalArithmeticEmptySidewinder(): string {
  const bits: number[] = [];
  const shipCount = codecTable1.SHIPS.length;
  const tagWidth = testBitsRequired(shipCount + 1);
  const markerCount = 2 ** tagWidth - shipCount;
  const shipIndex = codecTable1.SHIPS.indexOf('SideWinder');
  const remainder = shipIndex % markerCount;
  const groupCount = Math.floor((shipCount - 1 - remainder) / markerCount) + 1;
  writeTestBits(bits, 1, 10);
  writeTestBits(bits, shipCount + remainder, tagWidth);

  const encoder = new ArithmeticEncoder((bit) => bits.push(bit));
  encoder.write(Math.floor(shipIndex / markerCount), groupCount);
  const symbols: Array<{ readonly value: number; readonly count: number }> = [
    { value: 0, count: 2 }, // ship name absent
    { value: 0, count: 2 }, // ship ident absent
    { value: 0, count: 2 }, // not the pristine stock loadout
    { value: 0, count: 2 }, // absolute module layout
    { value: 3, count: 4 }, // combination-rank index set
    { value: 0, count: codecTable1.SLOTS_BY_SHIP.SideWinder.length + 1 },
  ];
  symbols.push(
    { value: 0, count: 2 }, // no power overrides
    { value: 0, count: 2 }, // no engineering
  );
  symbols.forEach(({ value, count }) => encoder.write(value, count));
  encoder.finish();
  return encodeTestBits(bits);
}

function nonCanonicalEmptySidewinder(): string {
  const canonical = decodePayload(encodeBuildLinkFragment(ShipLoadout.empty('SideWinder')));
  const canonicalBody = canonical.subarray(0, canonical.length - 4);
  const bits: number[] = [];
  for (let offset = 0; offset < 20; offset += 1) {
    bits.push((canonicalBody[Math.floor(offset / 8)]! >> (offset % 8)) & 1);
  }

  // Mode 1 spells the changed defaults as an included sparse list; bitmap mode is cheaper.
  writeTestBits(bits, 1, 2);
  const defaults = codecTable1.DEFAULT_MODULES_BY_SHIP.SideWinder;
  const changed = defaults.flatMap((module, index) => (module === null ? [] : [index]));
  writeTestBits(bits, changed.length, 5);
  for (const index of changed) writeTestBits(bits, index, 5);
  for (const _index of changed) writeTestBits(bits, 0, 1);
  writeTestBits(bits, 0, 1); // no power overrides
  writeTestBits(bits, 0, 1); // no engineering

  const body = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, offset) => {
    if (bit === 1) body[Math.floor(offset / 8)]! |= 1 << (offset % 8);
  });
  const payload = new Uint8Array(body.length + 4);
  payload.set(body);
  return encodePayload(payload);
}

function nonCanonicalUniformPriority(): string {
  const source = ShipLoadout.default('SideWinder');
  const modules = powerDrawingModules(source);
  for (const module of modules) source.setModuleEnabled(module.slot, true);
  const canonical = decodePayload(encodeBuildLinkFragment(source));
  const bits = copyPayloadBits(canonical, 32);
  writeTestBits(bits, 0, 1); // non-canonical: priorities are uniform, but the flag says mixed
  for (const _module of modules) writeTestBits(bits, 0, 3);
  writeTestBits(bits, 0, 1); // no engineering
  return encodeTestBits(bits);
}

function nonCanonicalAllDefinedEnabledState(): string {
  const source = ShipLoadout.default('SideWinder');
  const modules = powerDrawingModules(source);
  modules.forEach((module, index) => source.setModuleEnabled(module.slot, index % 2 === 0));
  const canonical = decodePayload(encodeBuildLinkFragment(source));
  const bits = copyPayloadBits(canonical, 32);
  writeTestBits(bits, 0, 1); // non-canonical: all values are defined, but the flag says mixed
  modules.forEach((_module, index) => writeTestBits(bits, index % 2 === 0 ? 2 : 1, 2));
  writeTestBits(bits, 1, 1); // priorities are uniformly absent
  writeTestBits(bits, 0, 3);
  writeTestBits(bits, 0, 1); // no engineering
  return encodeTestBits(bits);
}

function powerDrawingModules(source: ShipLoadout): readonly FittedModule[] {
  return source.fittedModules().filter((module) => (module.effectiveStats?.powerDraw ?? 0) > 0);
}

/** Mirrors the canonicalisation in `scripts/generate-build-link-codec-tables.mjs`. */
async function canonicalHash(payload: unknown): Promise<string> {
  const canonicalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalise);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonicalise((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalise(payload)));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function copyPayloadBits(payload: Uint8Array, bitCount: number): number[] {
  const bits: number[] = [];
  for (let offset = 0; offset < bitCount; offset += 1) {
    bits.push((payload[Math.floor(offset / 8)]! >> (offset % 8)) & 1);
  }
  return bits;
}

function encodeTestBits(bits: readonly number[]): string {
  const body = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, offset) => {
    if (bit === 1) body[Math.floor(offset / 8)]! |= 1 << (offset % 8);
  });
  const payload = new Uint8Array(body.length + 4);
  payload.set(body);
  return encodePayload(payload);
}

function writeTestBits(bits: number[], value: number, width: number): void {
  for (let bit = 0; bit < width; bit += 1) bits.push((value >> bit) & 1);
}

function writeTestVarUint(bits: number[], value: number): void {
  let remaining = value;
  do {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    writeTestBits(bits, byte | (remaining > 0 ? 0x80 : 0), 8);
  } while (remaining > 0);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function expectCodecError(
  operation: () => unknown,
  code:
    | InstanceType<typeof BuildLinkCodecError>['code']
    | readonly InstanceType<typeof BuildLinkCodecError>['code'][],
): BuildLinkCodecError {
  try {
    operation();
    expect.fail('Expected the codec to reject the input.');
  } catch (error) {
    expect(error).toBeInstanceOf(BuildLinkCodecError);
    const actual = (error as BuildLinkCodecError).code;
    if (Array.isArray(code)) expect(code).toContain(actual);
    else expect(actual).toBe(code);
    return error as BuildLinkCodecError;
  }
}
