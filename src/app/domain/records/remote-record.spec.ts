import { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import { SUITS } from '@elite-dangerous-almanac/core/equipment/suits';
import { PERSONAL_WEAPONS } from '@elite-dangerous-almanac/core/equipment/weapons';
import { newLoadout } from '../equipment/loadout/loadout-edit';
import { CATALOGUE_MOUNTS } from '../equipment/loadout/loadout-mounts';
import { toStoredLoadout } from '../equipment/loadout/stored-loadout.serializer';
import { toBuildSnapshotV1 } from '../ships/build/build-snapshot.serializer';
import { parseRemoteRecord, parseRemoteTombstone } from './remote-record';

describe('remote record contract', () => {
  it('accepts exact package-reconstructable ship and equipment records', async () => {
    expect(await parseRemoteRecord(shipRecord())).toMatchObject({ ok: true });
    expect(await parseRemoteRecord(equipmentRecord())).toMatchObject({ ok: true });
  });

  it.each([
    'note',
    'sourceNamed',
    'revisionId',
    'deviceClaim',
    'hullSymbol',
    'validation',
    'calculatedValue',
    'catalogueFact',
    'price',
  ])('rejects the excluded field %s', async (field) => {
    expect(await parseRemoteRecord({ ...shipRecord(), [field]: null })).toMatchObject({
      ok: false,
    });
  });

  it('rejects unknown fields at every nested ship level', async () => {
    const record = shipRecord('Anaconda');
    const first = record.build.modules[0]!;
    const candidates = [
      { ...record, build: { ...record.build, cargoCapacity: 0 } },
      { ...record, build: { ...record.build, modules: [{ ...first, health: 1 }] } },
      {
        ...record,
        build: {
          ...record.build,
          modules: [
            {
              ...first,
              preEngineered: {
                symbol: first.symbol,
                blueprint: 'x',
                grade: 1,
                acquisition: 'x',
                experimental: null,
                modifiers: [],
              },
            },
          ],
        },
      },
    ];

    for (const candidate of candidates) {
      expect(await parseRemoteRecord(candidate)).toMatchObject({ ok: false });
    }
  });

  it('rejects unknown hulls, modules and invalid hull-slot combinations', async () => {
    const record = shipRecord('Anaconda');
    const first = record.build.modules[0]!;
    const candidates = [
      { ...record, build: { ...record.build, shipSymbol: 'UnknownHull' } },
      {
        ...record,
        build: { ...record.build, modules: [{ ...first, symbol: 'UnknownModule' }] },
      },
      {
        ...record,
        build: { ...record.build, modules: [{ ...first, slot: 'NotARealSlot' }] },
      },
    ];

    for (const candidate of candidates) {
      expect(await parseRemoteRecord(candidate)).toMatchObject({ ok: false });
    }
  });

  it('requires completed ordinary engineering', async () => {
    const record = shipRecord('Anaconda');
    const first = record.build.modules[0]!;
    const candidate = {
      ...record,
      build: {
        ...record.build,
        modules: [
          {
            ...first,
            engineering: { blueprint: null, grade: 1, quality: 0.5, experimental: null },
          },
        ],
      },
    };

    expect(await parseRemoteRecord(candidate)).toMatchObject({ ok: false });
  });

  it('rejects unknown suits, invalid grades and mount combinations', async () => {
    const record = equipmentRecord();
    const loadout = record.loadout;
    const weapon = PERSONAL_WEAPONS.find(
      (candidate) => candidate.slot !== CATALOGUE_MOUNTS[0]!.kind,
    )!;
    const wrongMount = {
      symbol: weapon.symbol,
      grade: Number(Object.keys(weapon.grades)[0]),
      modifications: [null, null, null, null],
    };
    const candidates = [
      { ...record, loadout: { ...loadout, suitFamily: 'unknown-suit' } },
      { ...record, loadout: { ...loadout, suitGrade: 99 } },
      { ...record, loadout: { ...loadout, weapons: [wrongMount, null, null] } },
      { ...record, loadout: { ...loadout, suitModifications: ['weapon_scope', null, null, null] } },
    ];

    for (const candidate of candidates) {
      expect(await parseRemoteRecord(candidate)).toMatchObject({ ok: false });
    }
  });

  /**
   * The envelope, which is where a record from a newer server stops.
   *
   * A version this browser does not know stays remote and unopened rather than
   * being read under this version's rules: a v2 record carrying the v1 key set
   * would otherwise be adopted into local storage as a v1 record, which is what
   * 020/FR-012 forbids. The identity, kind and timestamps are the same
   * boundary — a record this browser cannot place in time or in a library is
   * not one it can hold.
   */
  it.each([
    ['a format it does not know', { format: 'ednb.remote-record.v2' }],
    ['a version it does not know', { version: 2 }],
    ['an identity that is not a UUID', { id: 'not-a-uuid' }],
    ['a kind that is neither working nor named', { kind: 'archived' }],
    ['a creation instant it cannot read', { createdAt: 'the day before' }],
    ['a modification instant it cannot read', { modifiedAt: '2026-13-45T99:00:00.000Z' }],
  ])('leaves a record with %s unopened', async (_case, override) => {
    expect(await parseRemoteRecord({ ...shipRecord(), ...override })).toMatchObject({ ok: false });
  });

  it('refuses an equipment record whose name is neither text nor absent', async () => {
    expect(await parseRemoteRecord({ ...equipmentRecord(), name: 7 })).toMatchObject({ ok: false });
  });

  it('accepts only the exact tombstone shape', () => {
    const tombstone = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', revision: 4 };

    expect(parseRemoteTombstone(tombstone)).toEqual(tombstone);
    expect(parseRemoteTombstone({ ...tombstone, name: 'retained' })).toBeNull();
  });
});

function shipRecord(hull = 'SideWinder') {
  return {
    format: 'ednb.remote-record' as const,
    version: 1 as const,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tool: 'ship' as const,
    kind: 'working' as const,
    createdAt: '2026-09-11T12:00:00.000Z',
    modifiedAt: '2026-09-11T12:00:00.000Z',
    build: toBuildSnapshotV1(ShipLoadout.default(hull)),
  };
}

function equipmentRecord() {
  const loadout = newLoadout(SUITS[0]!.family)!;
  return {
    format: 'ednb.remote-record' as const,
    version: 1 as const,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tool: 'equipment' as const,
    kind: 'named' as const,
    name: 'Ground loadout',
    createdAt: '2026-09-11T12:00:00.000Z',
    modifiedAt: '2026-09-11T12:00:00.000Z',
    loadout: toStoredLoadout(loadout),
  };
}
