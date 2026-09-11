import { FIXTURE_IDS, NAMED_RECORD_V1, UNSUPPORTED_NEWER_RECORD } from './fixtures/records';
import type { LocalRecord } from './local-record';
import { decodeAndMigrate } from '../ships/build/record-migrations';
import { toRemoteRecord } from './remote-record.serializer';
import {
  changeBody,
  parseAcceptedResponse,
  parseRefusal,
  synchronisationBody,
} from './record-synchronisation';

function local(bytes: string, id: string): LocalRecord {
  const decoded = decodeAndMigrate(JSON.parse(bytes), id);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  return decoded.record;
}

const RECORD = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(toRemoteRecord(local(NAMED_RECORD_V1, FIXTURE_IDS.named))));

const ACCEPTED = (changes: Partial<Record<string, unknown>> = {}) => ({
  accountRevision: 14,
  results: [],
  records: [],
  tombstones: [],
  ...changes,
});

describe('the record synchronisation contract', () => {
  describe('what a request carries', () => {
    it('writes only the two fields the service publishes', () => {
      expect(JSON.parse(synchronisationBody({ sinceRevision: 3, changes: [] }))).toEqual({
        sinceRevision: 3,
        changes: [],
      });
    });

    it('omits a base revision a first upload does not have', () => {
      expect(changeBody({ type: 'write', record: RECORD() as never, baseRevision: null })).toEqual({
        type: 'write',
        record: RECORD(),
      });
    });

    it('gives a renewal no base revision at all', () => {
      expect(changeBody({ type: 'renew', id: FIXTURE_IDS.named })).toEqual({
        type: 'renew',
        id: FIXTURE_IDS.named,
      });
    });

    it('carries a delete and the revision it was made against', () => {
      expect(changeBody({ type: 'delete', id: FIXTURE_IDS.named, baseRevision: 7 })).toEqual({
        type: 'delete',
        id: FIXTURE_IDS.named,
        baseRevision: 7,
      });
    });
  });

  describe('reading an accepted response', () => {
    it('reads records, tombstones and results', () => {
      const response = parseAcceptedResponse(
        ACCEPTED({
          results: [
            { index: 0, outcome: 'applied', id: FIXTURE_IDS.named, revision: 13 },
            { index: 1, outcome: 'unchanged', id: FIXTURE_IDS.working, revision: 4 },
          ],
          records: [{ revision: 13, record: RECORD() }],
          tombstones: [{ id: FIXTURE_IDS.working, revision: 14 }],
        }),
      );

      expect(response).toMatchObject({
        kind: 'accepted',
        accountRevision: 14,
        records: [{ revision: 13 }],
        tombstones: [{ id: FIXTURE_IDS.working, revision: 14 }],
        unreadableRecords: [],
      });
      expect(response.kind === 'accepted' && response.results).toHaveLength(2);
    });

    it('lists a streamed record this version cannot read rather than refusing the response', () => {
      const response = parseAcceptedResponse(
        ACCEPTED({
          records: [{ revision: 21, record: JSON.parse(UNSUPPORTED_NEWER_RECORD) }],
        }),
      );

      expect(response).toMatchObject({
        kind: 'accepted',
        records: [],
        unreadableRecords: [{ revision: 21, id: FIXTURE_IDS.unsupported }],
      });
    });

    it('names no identity for an unreadable record that carries none', () => {
      const response = parseAcceptedResponse(ACCEPTED({ records: [{ revision: 2, record: 7 }] }));

      expect(response).toMatchObject({ unreadableRecords: [{ revision: 2, id: null }] });
    });

    it.each([
      ['a body that is not an object', [1]],
      ['an unknown field', ACCEPTED({ extra: 1 })],
      ['a missing field', { accountRevision: 1, results: [], records: [] }],
      ['a cursor that is not a revision', ACCEPTED({ accountRevision: -1 })],
      ['results that are not a list', ACCEPTED({ results: {} })],
      ['a result with no index', ACCEPTED({ results: [{ outcome: 'applied' }] })],
      ['a result with an unknown outcome', ACCEPTED({ results: [{ index: 0, outcome: 'done' }] })],
      [
        'a result identity that is not text',
        ACCEPTED({ results: [{ index: 0, outcome: 'applied', id: 7 }] }),
      ],
      [
        'a result revision that is not one',
        ACCEPTED({ results: [{ index: 0, outcome: 'applied', revision: 1.5 }] }),
      ],
      [
        'a result code that is not text',
        ACCEPTED({ results: [{ index: 0, outcome: 'refused', code: 7 }] }),
      ],
      ['a result that is not an object', ACCEPTED({ results: ['applied'] })],
      ['a stream that is not a list', ACCEPTED({ records: {} })],
      [
        'a stream entry with an unknown field',
        ACCEPTED({ records: [{ revision: 1, record: {}, extra: 1 }] }),
      ],
      ['a stream entry with no revision', ACCEPTED({ records: [{ revision: null, record: {} }] })],
      ['tombstones that are not a list', ACCEPTED({ tombstones: {} })],
      [
        'a tombstone with an unknown field',
        ACCEPTED({ tombstones: [{ id: FIXTURE_IDS.named, revision: 1, extra: 1 }] }),
      ],
    ])('refuses the whole response for %s', (_case, body) => {
      expect(parseAcceptedResponse(body)).toEqual({ kind: 'unavailable' });
    });
  });

  describe('reading a refusal', () => {
    it('reads the code, the account cursor and every indexed result', () => {
      expect(
        parseRefusal(409, {
          status: 409,
          code: 'conflict',
          accountRevision: 12,
          results: [
            { index: 0, outcome: 'conflict', id: FIXTURE_IDS.named, revision: 9, record: RECORD() },
            { index: 1, outcome: 'not-applied' },
          ],
        }),
      ).toMatchObject({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 12,
        results: [
          { index: 0, outcome: 'conflict', remote: { kind: 'record' } },
          { index: 1, outcome: 'not-applied', remote: null },
        ],
      });
    });

    it('reads a deletion conflict as the account holding a marker', () => {
      const refusal = parseRefusal(409, {
        code: 'conflict',
        results: [
          { index: 0, outcome: 'conflict', id: FIXTURE_IDS.named, revision: 9, record: null },
        ],
      });

      expect(refusal).toMatchObject({ results: [{ remote: { kind: 'deleted' } }] });
    });

    it.each([
      ['a record this version cannot read', JSON.parse(UNSUPPORTED_NEWER_RECORD)],
      ['no record field at all', undefined],
    ])('never reads %s as a deletion', (_case, record) => {
      const refusal = parseRefusal(409, {
        code: 'conflict',
        results: [{ index: 0, outcome: 'conflict', id: FIXTURE_IDS.named, revision: 9, record }],
      });

      expect(refusal).toMatchObject({ results: [{ remote: { kind: 'unreadable' } }] });
    });

    it('reads an unpublished code as unknown', () => {
      expect(parseRefusal(400, { code: 'something-else' })).toMatchObject({ code: 'unknown' });
    });

    it('reads a refusal with no body at all', () => {
      expect(parseRefusal(500, null)).toEqual({
        kind: 'refused',
        status: 500,
        code: 'unknown',
        accountRevision: null,
        results: [],
      });
    });

    it('reads results it cannot read as none', () => {
      expect(parseRefusal(400, { code: 'invalid-request', results: [7] })).toMatchObject({
        results: [],
      });
    });
  });
});
