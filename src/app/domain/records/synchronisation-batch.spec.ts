import { FIXTURE_IDS, NAMED_RECORD_V1 } from './fixtures/records';
import { decodeAndMigrate } from '../ships/build/record-migrations';
import type { RemoteRecord } from './remote-record';
import { toRemoteRecord } from './remote-record.serializer';
import {
  MAXIMUM_CHANGES,
  planSynchronisationBatch,
  recordBytes,
  type ChangeCandidate,
} from './synchronisation-batch';

function remote(id: string, padding = 0): RemoteRecord {
  const decoded = decodeAndMigrate(JSON.parse(NAMED_RECORD_V1), FIXTURE_IDS.named);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  const record = toRemoteRecord(decoded.record);
  if (record.tool !== 'ship') {
    throw new Error('The ship fixture is not a ship record.');
  }
  return {
    ...record,
    id,
    build: { ...record.build, shipName: 'x'.repeat(padding) || record.build.shipName },
  };
}

function identity(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function upload(index: number, padding = 0): ChangeCandidate {
  const id = identity(index);
  return {
    operationId: `operation-${String(index)}`,
    recordId: id,
    change: { type: 'write', record: remote(id, padding), baseRevision: null },
  };
}

describe('filling one synchronisation request', () => {
  it('carries every change that fits', () => {
    const plan = planSynchronisationBatch([upload(1), upload(2)], 3);

    expect(plan.changes).toHaveLength(2);
    expect(plan.operationIds).toEqual(['operation-1', 'operation-2']);
    expect(plan.recordIds).toEqual([identity(1), identity(2)]);
    expect(plan.deferred).toHaveLength(0);
    expect(plan.oversized).toHaveLength(0);
  });

  it('carries a hundred changes and defers the hundred and first', () => {
    const candidates = Array.from({ length: MAXIMUM_CHANGES + 1 }, (_entry, index) =>
      upload(index),
    );

    const plan = planSynchronisationBatch(candidates, 0);

    expect(plan.changes).toHaveLength(MAXIMUM_CHANGES);
    expect(plan.deferred).toHaveLength(1);
    expect(plan.deferred[0]?.operationId).toBe(`operation-${String(MAXIMUM_CHANGES)}`);
  });

  it('defers what a full request cannot hold and keeps its order', () => {
    // Each padded record is under its own bound and a sixteenth of a
    // mebibyte, so the request fills before the twentieth.
    const candidates = Array.from({ length: 20 }, (_entry, index) => upload(index, 60_000));

    const plan = planSynchronisationBatch(candidates, 0);

    expect(plan.changes.length).toBeLessThan(20);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(plan.deferred.map((candidate) => candidate.operationId)).toEqual(
      candidates.slice(plan.changes.length).map((candidate) => candidate.operationId),
    );
  });

  it('sets aside a record over its own bound rather than deferring it', () => {
    const plan = planSynchronisationBatch([upload(1, 70_000), upload(2)], 0);

    expect(plan.oversized.map((candidate) => candidate.recordId)).toEqual([identity(1)]);
    expect(plan.recordIds).toEqual([identity(2)]);
    expect(plan.deferred).toHaveLength(0);
  });

  it('measures only a write against the record bound', () => {
    expect(recordBytes({ type: 'renew', id: identity(1) })).toBe(0);
    expect(recordBytes({ type: 'delete', id: identity(1), baseRevision: 2 })).toBe(0);
    expect(recordBytes(upload(1).change)).toBeGreaterThan(0);
  });

  it('carries deletes and renewals, which have no record to measure', () => {
    const plan = planSynchronisationBatch(
      [
        {
          operationId: 'operation-delete',
          recordId: identity(1),
          change: { type: 'delete', id: identity(1), baseRevision: 4 },
        },
        {
          operationId: 'operation-renew',
          recordId: identity(2),
          change: { type: 'renew', id: identity(2) },
        },
      ],
      9,
    );

    expect(plan.changes).toHaveLength(2);
    expect(plan.oversized).toHaveLength(0);
  });
});
