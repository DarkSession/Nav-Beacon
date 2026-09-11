import { PRE_ENGINEERED_MODULES } from '@elite-dangerous-almanac/core/ships/pre-engineered';
import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import { toBuildSnapshotV1 } from '../../ships/build/build-snapshot.serializer';
import { mapOwnedShip, type OwnedShipModel, type OwnedShipModule } from './owned-ship';

const SHIP_ID = 17;
const SOURCE_DATE = '2026-09-01';
const SOURCE_LINE = 42;

/** The model the service stores: the package's own build, without the excluded fields. */
function modelOf(loadout: ShipLoadout): OwnedShipModel {
  const snapshot = toBuildSnapshotV1(loadout);

  return {
    hullSymbol: snapshot.shipSymbol,
    shipName: snapshot.shipName,
    shipIdent: snapshot.shipIdent,
    modules: snapshot.modules.map((module): OwnedShipModule => ({
      slot: module.slot,
      symbol: module.symbol,
      enabled: module.enabled,
      priority: module.priority,
      preEngineered: module.preEngineered,
      engineering:
        module.engineering === null
          ? null
          : {
              blueprint: module.engineering.blueprint,
              grade: module.engineering.grade,
              experimental: module.engineering.experimental,
            },
    })),
  };
}

function payloadOf(model: OwnedShipModel): Record<string, unknown> {
  return { shipId: SHIP_ID, sourceDate: SOURCE_DATE, sourceLine: SOURCE_LINE, model };
}

/** An engineered, partly powered-down ship, as a journal states one. */
function engineeredShip(): ShipLoadout {
  const loadout = ShipLoadout.default('Anaconda');
  loadout.applyBlueprint('FrameShiftDrive', 'FSD_LongRange', {
    grade: 5,
    quality: 1,
    experimentalEffectSymbol: 'special_fsd_heavy',
  });
  loadout.setModuleEnabled('Radar', false);
  loadout.setModulePriority('Radar', 3);
  return loadout;
}

/** The same ship, named and identified the way a Commander registered it. */
function engineeredModel(): OwnedShipModel {
  return { ...modelOf(engineeredShip()), shipName: 'Bold Endeavour', shipIdent: 'BE-01' };
}

/** A ship carrying one pre-engineered article, identified by the package. */
function preEngineeredShip(): { readonly loadout: ShipLoadout; readonly slot: string } {
  const variant = PRE_ENGINEERED_MODULES.find((candidate) => candidate.experimentalEffectSymbol)!;
  const loadout = ShipLoadout.default('Anaconda');
  const slot = loadout
    .slots('hardpoint')
    .find((candidate) =>
      loadout.modulesForSlot(candidate.key).some((module) => module.symbol === variant.symbol),
    )!;
  const module = loadout
    .modulesForSlot(slot.key)
    .find((candidate) => candidate.symbol === variant.symbol)!;
  loadout.setModule(slot.key, module);
  loadout.setPreEngineeredVariant(slot.key, variant);
  return { loadout, slot: slot.key };
}

function withModule(model: OwnedShipModel, slot: string, change: Partial<OwnedShipModule>) {
  return {
    ...model,
    modules: model.modules.map((module) =>
      module.slot === slot ? { ...module, ...change } : module,
    ),
  };
}

describe('owned-ship mapping', () => {
  it('maps a complete engineered model back to the build the journal stated', () => {
    const expected = {
      ...toBuildSnapshotV1(engineeredShip()),
      shipName: 'Bold Endeavour',
      shipIdent: 'BE-01',
    };

    const result = mapOwnedShip(payloadOf(engineeredModel()));

    expect(result.ok).toBe(true);
    expect(result.ok && toBuildSnapshotV1(result.ship.loadout)).toEqual(expected);
  });

  it('carries the Frontier identity and the source date-line tuple', () => {
    const result = mapOwnedShip(payloadOf(engineeredModel()));

    expect(result.ok && result.ship.shipId).toBe(SHIP_ID);
    expect(result.ok && result.ship.sourceDate).toBe(SOURCE_DATE);
    expect(result.ok && result.ship.sourceLine).toBe(SOURCE_LINE);
  });

  it('leaves the ship name, ident and power decisions on the package build', () => {
    const result = mapOwnedShip(payloadOf(engineeredModel()));

    expect(result.ok && result.ship.loadout.shipName).toBe('Bold Endeavour');
    expect(result.ok && result.ship.loadout.shipIdent).toBe('BE-01');
    expect(result.ok && result.ship.loadout.fittedModuleAt('Radar')?.on).toBe(false);
    expect(result.ok && result.ship.loadout.fittedModuleAt('Radar')?.priority).toBe(3);
  });

  it('maps a stock model of every installed hull', () => {
    for (const ship of SHIPS) {
      const result = mapOwnedShip(payloadOf(modelOf(ShipLoadout.default(ship.symbol))));

      expect(result.ok).toBe(true);
      expect(result.ok && result.ship.loadout.shipSymbol).toBe(ship.symbol);
    }
  });

  it('maps a pre-engineered article from its identity alone', () => {
    const { loadout, slot } = preEngineeredShip();

    const result = mapOwnedShip(payloadOf(modelOf(loadout)));

    expect(result.ok).toBe(true);
    expect(result.ok && toBuildSnapshotV1(result.ship.loadout)).toEqual(toBuildSnapshotV1(loadout));
    expect(
      result.ok && result.ship.loadout.fittedModuleAt(slot)?.preEngineeredVariant,
    ).not.toBeNull();
  });

  it('completes the stored grade as a finished roll, with no quality field of its own', () => {
    const model = engineeredModel();
    const engineered = model.modules.find((module) => module.slot === 'FrameShiftDrive')!;

    expect(Object.keys(engineered.engineering!).sort()).toEqual([
      'blueprint',
      'experimental',
      'grade',
    ]);

    const result = mapOwnedShip(payloadOf(model));

    expect(
      result.ok && result.ship.loadout.fittedModuleAt('FrameShiftDrive')?.engineering?.Quality,
    ).toBe(1);
  });
});

describe('owned ships the package cannot resolve', () => {
  it('refuses a hull the installed package does not carry', () => {
    const model = { ...modelOf(ShipLoadout.default('Anaconda')), hullSymbol: 'Nonexistent_Hull' };

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unknown-hull' });
    expect(result.ok === false && result.reason).toContain('Nonexistent_Hull');
  });

  it('refuses a module symbol the installed package does not carry', () => {
    const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'FrameShiftDrive', {
      symbol: 'Int_Hyperdrive_Invented',
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unknown-identity' });
    expect(result.ok === false && result.reason).toContain('Int_Hyperdrive_Invented');
  });

  it('refuses a slot key the hull does not have, in the package own words', () => {
    const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'FrameShiftDrive', {
      slot: 'NotARealSlot',
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unsupported-combination' });
    expect(result.ok === false && result.issues.map((issue) => issue.code)).toContain(
      'unknownSlot',
    );
    expect(result.ok === false && result.reason).toBe(
      result.ok === false ? result.issues[0]!.message : '',
    );
  });

  it('refuses a blueprint identity the installed package does not carry', () => {
    const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'FrameShiftDrive', {
      engineering: { blueprint: 'Invented_Blueprint', grade: 5, experimental: null },
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unknown-identity' });
  });

  it('refuses an experimental effect the installed package does not carry', () => {
    const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'FrameShiftDrive', {
      engineering: {
        blueprint: 'FSD_LongRange',
        grade: 5,
        experimental: 'special_invented_effect',
      },
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unknown-identity' });
  });

  it('refuses a pre-engineered identity the installed package does not carry', () => {
    const { loadout, slot } = preEngineeredShip();
    const model = withModule(modelOf(loadout), slot, {
      preEngineered: {
        symbol: 'Hpt_PulseLaser_Fixed_Large',
        blueprint: 'Invented_Blueprint',
        grade: 5,
        acquisition: 'techBroker',
        experimental: null,
      },
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unknown-identity' });
  });

  it('refuses a module the hull cannot take, and keeps no replacement for it', () => {
    // The package answers an unusable fixed mount with the hull default. For a
    // build being edited that default is ordinary state; for a statement about
    // a Commander's real ship it is a module the ship does not have.
    const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'Armour', {
      symbol: 'Sidewinder_Armour_Grade1',
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unsupported-combination' });
    expect(result.ok === false && result.reason).toContain('Sidewinder_Armour_Grade1');
    expect(Object.keys(result).sort()).toEqual(['failure', 'issues', 'ok', 'reason']);
    expect('ship' in result).toBe(false);
  });

  it('refuses a catalogued module the hull will not take in that slot', () => {
    // The module exists; the mount does not take it. Nothing about the package
    // answer names a substitute, so the ship is refused rather than shown with
    // an empty or different mount.
    const anaconda = ShipLoadout.default('Anaconda');
    const model = withModule(modelOf(anaconda), 'PowerDistributor', {
      symbol: 'Int_CargoRack_Size8_Class1',
    });

    const result = mapOwnedShip(payloadOf(model));

    expect(result).toMatchObject({ ok: false, failure: 'unsupported-combination' });
    expect(result.ok === false && result.reason).toContain('Int_CargoRack_Size8_Class1');
    expect('ship' in result).toBe(false);
  });
});

describe('owned-ship payloads outside the stored contract', () => {
  it.each(['hullValue', 'rebuy', 'cargoCapacity', 'hot', 'fuel', 'modulesValue', 'shipType'])(
    'refuses the excluded model field %s',
    (field) => {
      const model = { ...modelOf(ShipLoadout.default('Anaconda')), [field]: 1 };

      expect(mapOwnedShip(payloadOf(model as OwnedShipModel))).toMatchObject({
        ok: false,
        failure: 'malformed',
      });
    },
  );

  it.each(['health', 'ammoInClip', 'engineer', 'blueprintId', 'value'])(
    'refuses the excluded module field %s',
    (field) => {
      const model = withModule(modelOf(ShipLoadout.default('Anaconda')), 'FrameShiftDrive', {
        [field]: 1,
      } as Partial<OwnedShipModule>);

      expect(mapOwnedShip(payloadOf(model))).toMatchObject({ ok: false, failure: 'malformed' });
    },
  );

  it('refuses an engineering block carrying a roll quality or a modifier list', () => {
    const model = engineeredModel();
    const candidates = [
      withModule(model, 'FrameShiftDrive', {
        engineering: {
          blueprint: 'FSD_LongRange',
          grade: 5,
          experimental: null,
          quality: 0.5,
        } as unknown as OwnedShipModule['engineering'],
      }),
      withModule(model, 'FrameShiftDrive', {
        engineering: {
          blueprint: 'FSD_LongRange',
          grade: 5,
          experimental: null,
          modifiers: [],
        } as unknown as OwnedShipModule['engineering'],
      }),
    ];

    for (const candidate of candidates) {
      expect(mapOwnedShip(payloadOf(candidate))).toMatchObject({
        ok: false,
        failure: 'malformed',
      });
    }
  });

  it('refuses a pre-engineered identity carrying a modifier block', () => {
    const { loadout, slot } = preEngineeredShip();
    const model = withModule(modelOf(loadout), slot, {
      preEngineered: {
        symbol: 'Hpt_PulseLaser_Fixed_Large',
        blueprint: 'Weapon_Sturdy',
        grade: 5,
        acquisition: 'techBroker',
        experimental: null,
        modifiers: [],
      } as unknown as OwnedShipModule['preEngineered'],
    });

    expect(mapOwnedShip(payloadOf(model))).toMatchObject({ ok: false, failure: 'malformed' });
  });

  it.each([
    { shipId: -1 },
    { shipId: 1.5 },
    { shipId: '17' },
    { sourceDate: '2026-09-31' },
    { sourceDate: '20260901' },
    { sourceDate: '2026-09-01T00:00:00Z' },
    { sourceLine: -1 },
    { sourceLine: 2.5 },
  ])('refuses the invalid envelope value %o', (change) => {
    const payload = { ...payloadOf(modelOf(ShipLoadout.default('Anaconda'))), ...change };

    expect(mapOwnedShip(payload)).toMatchObject({ ok: false, failure: 'malformed' });
  });

  it.each([
    'not an object',
    null,
    [],
    {},
    { shipId: SHIP_ID, sourceDate: SOURCE_DATE, sourceLine: SOURCE_LINE },
  ])('refuses the payload %o', (value) => {
    expect(mapOwnedShip(value)).toMatchObject({ ok: false, failure: 'malformed' });
  });

  it('refuses an envelope field the contract does not carry', () => {
    const payload = {
      ...payloadOf(modelOf(ShipLoadout.default('Anaconda'))),
      timestamp: '2026-09-01T12:00:00Z',
    };

    expect(mapOwnedShip(payload)).toMatchObject({ ok: false, failure: 'malformed' });
  });

  it('refuses a grade, priority or slot the stored contract bounds', () => {
    const model = engineeredModel();
    const first = model.modules[0]!;
    const candidates = [
      withModule(model, 'FrameShiftDrive', {
        engineering: { blueprint: 'FSD_LongRange', grade: 6, experimental: null },
      }),
      withModule(model, 'Radar', { priority: 9 }),
      { ...model, modules: [first, { ...first, slot: first.slot.toLowerCase() }] },
    ];

    for (const candidate of candidates) {
      expect(mapOwnedShip(payloadOf(candidate))).toMatchObject({
        ok: false,
        failure: 'malformed',
      });
    }
  });
});
