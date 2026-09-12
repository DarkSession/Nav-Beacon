import { decodeAndMigrate } from '../ships/build/record-migrations';
import {
  FIXTURE_IDS,
  LOADOUT_RECORD_V2,
  NAMED_RECORD_V1,
  WORKING_RECORD_V1,
} from './fixtures/records';
import type { LocalRecord } from './local-record';
import { parseRemoteRecord } from './remote-record';
import { toRemoteRecord } from './remote-record.serializer';

/** The note the named fixture carries. It may never leave this browser. */
const NOTE = 'Long-range fit.';

function record(bytes: string, id: string): LocalRecord {
  const decoded = decodeAndMigrate(JSON.parse(bytes), id);
  if (!decoded.ok) {
    throw new Error(`The fixture did not decode: ${decoded.detail}`);
  }
  return decoded.record;
}

const NAMED_BUILD = (): LocalRecord => record(NAMED_RECORD_V1, FIXTURE_IDS.named);
const WORKING_BUILD = (): LocalRecord => record(WORKING_RECORD_V1, FIXTURE_IDS.working);
const LOADOUT = (): LocalRecord => record(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout);

/** Every key the value carries, at every depth. */
function keysOf(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => keysOf(entry));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
}

describe('the remote record one local record becomes', () => {
  it('produces records the strict contract parser accepts', async () => {
    for (const local of [NAMED_BUILD(), WORKING_BUILD(), LOADOUT()]) {
      expect(
        await parseRemoteRecord(JSON.parse(JSON.stringify(toRemoteRecord(local)))),
      ).toMatchObject({ ok: true });
    }
  });

  it('carries a saved build’s name as the build’s ship name', () => {
    const remote = toRemoteRecord(NAMED_BUILD());

    expect(remote.tool === 'ship' && remote.build.shipName).toBe('Anaconda explorer');
  });

  it('leaves a working build’s own ship name where it is', () => {
    const remote = toRemoteRecord(WORKING_BUILD());

    expect(remote.tool === 'ship' && remote.build.shipName).toBe('Gimel');
    expect(remote.kind).toBe('working');
  });

  it('carries a saved loadout’s name in the name the contract gives it', () => {
    const remote = toRemoteRecord(LOADOUT());

    expect(remote.tool === 'equipment' && remote.name).toBe('Silent Entry');
  });

  it('serialises no note into a request', () => {
    const request = JSON.stringify([NAMED_BUILD(), WORKING_BUILD(), LOADOUT()].map(toRemoteRecord));

    expect(request).not.toContain(NOTE);
    expect(request).not.toContain('note');
  });

  it.each(['note', 'sourceNamed', 'revisionId', 'validation', 'hullSymbol', 'suitFamily'])(
    'emits no %s at any depth of a ship record',
    (excluded) => {
      expect(keysOf(toRemoteRecord(NAMED_BUILD()))).not.toContain(excluded);
    },
  );

  it.each(['note', 'sourceNamed', 'revisionId', 'validation', 'hullSymbol'])(
    'emits no %s at any depth of an equipment record',
    (excluded) => {
      expect(keysOf(toRemoteRecord(LOADOUT()))).not.toContain(excluded);
    },
  );

  it('emits no second suit-family copy beside the loadout', () => {
    const remote = toRemoteRecord(LOADOUT());

    expect(Object.keys(remote)).not.toContain('suitFamily');
    expect(remote.tool === 'equipment' && remote.loadout.suitFamily).toBe('utilitysuit');
  });

  it('drops a field a caller added to the record it was handed', () => {
    // The allowlist is what makes this true: a device claim, a note or a
    // calculated figure on the value handed in has no field to land in
    // (020/FR-007, 020/FR-012).
    const carrying = {
      ...NAMED_BUILD(),
      note: NOTE,
      deviceClaim: 'tab-1',
      powerBudget: 12.5,
    } as unknown as LocalRecord;

    const keys = keysOf(toRemoteRecord(carrying));

    expect(keys).not.toContain('deviceClaim');
    expect(keys).not.toContain('powerBudget');
    expect(JSON.stringify(toRemoteRecord(carrying))).not.toContain(NOTE);
  });

  it('keeps the record identity, kind and times the account needs', () => {
    const remote = toRemoteRecord(NAMED_BUILD());

    expect(remote).toMatchObject({
      format: 'ednb.remote-record',
      version: 1,
      id: FIXTURE_IDS.named,
      kind: 'named',
      createdAt: '2026-01-02T03:04:05.000Z',
      modifiedAt: '2026-01-02T03:04:05.000Z',
    });
  });
});
