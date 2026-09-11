import { decodeAndMigrate } from '../ships/build/record-migrations';
import { FIXTURE_IDS, LOADOUT_RECORD_V2, NAMED_RECORD_V1 } from './fixtures/records';
import type { RemoteEquipmentRecord, RemoteShipRecord } from './remote-record';
import { toRemoteRecord } from './remote-record.serializer';
import { remoteRecordsEqual } from './remote-record.equality';

function ship(): RemoteShipRecord {
  const decoded = decodeAndMigrate(JSON.parse(NAMED_RECORD_V1), FIXTURE_IDS.named);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  const record = toRemoteRecord(decoded.record);
  if (record.tool !== 'ship') {
    throw new Error('The ship fixture is not a ship record.');
  }
  return record;
}

function loadout(): RemoteEquipmentRecord {
  const decoded = decodeAndMigrate(JSON.parse(LOADOUT_RECORD_V2), FIXTURE_IDS.loadout);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  const record = toRemoteRecord(decoded.record);
  if (record.tool !== 'equipment') {
    throw new Error('The loadout fixture is not an equipment record.');
  }
  return record;
}

describe('whether two versions of one record are the same record', () => {
  it('accepts a version that came back through the service unchanged', () => {
    expect(remoteRecordsEqual(ship(), JSON.parse(JSON.stringify(ship())))).toBe(true);
    expect(remoteRecordsEqual(loadout(), JSON.parse(JSON.stringify(loadout())))).toBe(true);
  });

  it('accepts the same instant spelled with another offset', () => {
    const local = ship();
    const returned = {
      ...local,
      modifiedAt: new Date(Date.parse(local.modifiedAt)).toISOString().replace('Z', '+00:00'),
    };

    expect(remoteRecordsEqual(local, returned)).toBe(true);
  });

  it('accepts a payload whose keys came back in another order', () => {
    const local = ship();
    const reordered: RemoteShipRecord = {
      ...local,
      build: Object.fromEntries(
        Object.entries(local.build).reverse(),
      ) as unknown as RemoteShipRecord['build'],
    };

    expect(remoteRecordsEqual(local, reordered)).toBe(true);
  });

  it.each([
    ['a different identity', { id: FIXTURE_IDS.working }],
    ['a different named state', { kind: 'working' as const }],
    ['a different modification time', { modifiedAt: '2026-02-02T03:04:05.000Z' }],
    ['a different creation time', { createdAt: '2025-02-02T03:04:05.000Z' }],
  ])('refuses %s', (_case, difference) => {
    expect(remoteRecordsEqual(ship(), { ...ship(), ...difference })).toBe(false);
  });

  it('refuses a different ship name, which is where a saved name travels', () => {
    const local = ship();

    expect(
      remoteRecordsEqual(local, { ...local, build: { ...local.build, shipName: 'Another' } }),
    ).toBe(false);
  });

  it('refuses a build that differs by one module', () => {
    const local = ship();
    const changed: RemoteShipRecord = {
      ...local,
      build: {
        ...local.build,
        modules: local.build.modules.map((module) => ({ ...module, enabled: false })),
      },
    };

    expect(remoteRecordsEqual(local, changed)).toBe(false);
  });

  it('refuses a build with one module fewer', () => {
    const local = ship();

    expect(remoteRecordsEqual(local, { ...local, build: { ...local.build, modules: [] } })).toBe(
      false,
    );
  });

  it('refuses a different equipment name', () => {
    expect(remoteRecordsEqual(loadout(), { ...loadout(), name: 'Another' })).toBe(false);
  });

  it('refuses a different loadout', () => {
    const local = loadout();

    expect(
      remoteRecordsEqual(local, {
        ...local,
        loadout: { ...local.loadout, suitGrade: local.loadout.suitGrade + 1 },
      }),
    ).toBe(false);
  });

  it('refuses two records of different tools', () => {
    const equipment = loadout();

    expect(remoteRecordsEqual(ship(), { ...equipment, id: FIXTURE_IDS.named })).toBe(false);
    expect(remoteRecordsEqual({ ...equipment, id: FIXTURE_IDS.named }, ship())).toBe(false);
  });

  it('refuses an instant that is not one', () => {
    expect(remoteRecordsEqual(ship(), { ...ship(), modifiedAt: 'not an instant' })).toBe(false);
  });
});
