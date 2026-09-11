import { decodeAndMigrate } from '../ships/build/record-migrations';
import {
  FIXTURE_IDS,
  LOADOUT_RECORD_V2,
  NAMED_RECORD_V1,
  UNKNOWN_HULL_RECORD,
  UNKNOWN_SUIT_RECORD,
  WORKING_RECORD_V1,
} from './fixtures/records';
import type { LocalRecord } from './local-record';
import { copyLocalRecord, isReconstructable } from './record-draft';
import { adoptRemoteRecord } from './remote-record.adopter';
import type { RemoteRecord, RemoteShipRecord } from './remote-record';
import { toRemoteRecord } from './remote-record.serializer';

function local(bytes: string, id: string): LocalRecord {
  const decoded = decodeAndMigrate(JSON.parse(bytes), id);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  return decoded.record;
}

function remote(bytes: string, id: string): RemoteRecord {
  return toRemoteRecord(local(bytes, id));
}

const CONTEXT = {
  revisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  note: null,
  sourceNamed: null,
};

describe('the local record one remote record becomes', () => {
  it('takes a named build, with the package’s own verdict on it', () => {
    const adoption = adoptRemoteRecord(remote(NAMED_RECORD_V1, FIXTURE_IDS.named), CONTEXT);

    expect(adoption.ok).toBe(true);
    if (!adoption.ok) {
      return;
    }
    expect(adoption.draft).toMatchObject({
      id: FIXTURE_IDS.named,
      kind: 'named',
      name: 'Anaconda explorer',
      payload: { tool: 'ship' },
    });
    expect(
      adoption.draft.payload.tool === 'ship' && adoption.draft.payload.validation,
    ).toBeDefined();
  });

  it('leaves a working build unnamed', () => {
    const adoption = adoptRemoteRecord(remote(WORKING_RECORD_V1, FIXTURE_IDS.working), CONTEXT);

    expect(adoption.ok && adoption.draft.name).toBeNull();
  });

  it('takes a loadout and the name the contract gives it', () => {
    const adoption = adoptRemoteRecord(remote(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout), CONTEXT);

    expect(adoption.ok).toBe(true);
    expect(adoption.ok && adoption.draft.name).toBe('Silent Entry');
    expect(adoption.ok && adoption.draft.payload.tool).toBe('equipment');
  });

  it('keeps the note and the named source the local copy carried', () => {
    const adoption = adoptRemoteRecord(remote(NAMED_RECORD_V1, FIXTURE_IDS.named), {
      ...CONTEXT,
      note: 'Long-range fit.',
      sourceNamed: { recordId: FIXTURE_IDS.working, baseRevisionId: 'r1' },
    });

    expect(adoption.ok && adoption.draft.note).toBe('Long-range fit.');
    expect(adoption.ok && adoption.draft.sourceNamed).toEqual({
      recordId: FIXTURE_IDS.working,
      baseRevisionId: 'r1',
    });
  });

  it('falls back to the ident and then the hull for a named build with no ship name', () => {
    const record = remote(NAMED_RECORD_V1, FIXTURE_IDS.named) as RemoteShipRecord;
    const withIdent: RemoteShipRecord = {
      ...record,
      build: { ...record.build, shipName: null, shipIdent: 'NB-01' },
    };
    const withNeither: RemoteShipRecord = {
      ...record,
      build: { ...record.build, shipName: null, shipIdent: null },
    };

    expect(adoptRemoteRecord(withIdent, CONTEXT)).toMatchObject({ draft: { name: 'NB-01' } });
    expect(adoptRemoteRecord(withNeither, CONTEXT)).toMatchObject({
      draft: { name: record.build.shipSymbol },
    });
  });

  it('refuses a build naming a hull this installation does not carry', () => {
    const record = remote(NAMED_RECORD_V1, FIXTURE_IDS.named) as RemoteShipRecord;
    const unknown: RemoteShipRecord = {
      ...record,
      build: { ...record.build, shipSymbol: 'Nonexistent_Hull' },
    };

    expect(adoptRemoteRecord(unknown, CONTEXT).ok).toBe(false);
  });

  it('refuses a loadout naming a suit this installation does not carry', () => {
    const record = remote(UNKNOWN_SUIT_RECORD, FIXTURE_IDS.unknownSuit);

    expect(adoptRemoteRecord(record, CONTEXT).ok).toBe(false);
  });
});

describe('what may be offered to the account', () => {
  it('accepts records the package still carries', () => {
    expect(isReconstructable(local(NAMED_RECORD_V1, FIXTURE_IDS.named))).toBe(true);
    expect(isReconstructable(local(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout))).toBe(true);
  });

  it('refuses a build naming a hull this installation does not carry', () => {
    expect(isReconstructable(local(UNKNOWN_HULL_RECORD, FIXTURE_IDS.unknownHull))).toBe(false);
  });

  it('refuses a loadout naming a suit this installation does not carry', () => {
    expect(isReconstructable(local(UNKNOWN_SUIT_RECORD, FIXTURE_IDS.unknownSuit))).toBe(false);
  });
});

describe('one record under a second identity', () => {
  const identity = { id: FIXTURE_IDS.working, revisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };

  it('keeps a build, its name, its note and the verdict stored with it', () => {
    const copy = copyLocalRecord(local(NAMED_RECORD_V1, FIXTURE_IDS.named), identity);

    expect(copy).toMatchObject({
      id: FIXTURE_IDS.working,
      revisionId: identity.revisionId,
      kind: 'named',
      name: 'Anaconda explorer',
      note: 'Long-range fit.',
      payload: { tool: 'ship', validation: { valid: true, complete: true } },
    });
  });

  it('keeps a loadout', () => {
    const copy = copyLocalRecord(local(LOADOUT_RECORD_V2, FIXTURE_IDS.loadout), identity);

    expect(copy).toMatchObject({ id: FIXTURE_IDS.working, payload: { tool: 'equipment' } });
  });

  it('cannot copy a loadout the package no longer carries', () => {
    expect(copyLocalRecord(local(UNKNOWN_SUIT_RECORD, FIXTURE_IDS.unknownSuit), identity)).toBeNull();
  });
});
