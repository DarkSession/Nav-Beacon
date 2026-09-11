import { fleetBody } from '../../../application/fleet/fleet.spec-helpers';
import { parseFleetAnswer, parseFleetRefusal } from './fleet-answer';

const RESULTS = ['current', 'empty', 'incomplete', 'waiting', 'failed', 'authorisation-expired'];

const FAILURES = [
  'frontier-unavailable',
  'response-too-large',
  'line-too-large',
  'line-malformed',
  'package-refused',
  'projection-unavailable',
];

describe('the fleet wire contract', () => {
  it('reads a complete settled answer back', () => {
    const body = fleetBody({ ships: [{ shipId: 12 }] });

    expect(parseFleetAnswer(body)).toEqual({
      result: 'current',
      ships: [{ shipId: 12 }],
      coverage: {
        startDate: '2026-08-18',
        cursorDate: '2026-09-02',
        cursorLine: 7,
        storedShips: { date: '2026-09-01', line: 3, complete: true },
        nextPermittedRefreshAt: null,
      },
      pending: false,
      failure: null,
      packageRefusal: null,
    });
  });

  it.each(RESULTS)('reads the published result "%s"', (result) => {
    expect(parseFleetAnswer(fleetBody({ result }))?.result).toBe(result);
  });

  it.each(FAILURES)('reads the published failure "%s"', (failure) => {
    const answer = parseFleetAnswer(fleetBody({ result: 'failed', failure }));

    expect(answer?.failure).toBe(failure);
  });

  it('carries the package refusal exactly as the package stated it', () => {
    const refusal = {
      code: 'invalidLoadout',
      constraint: 'stringRequired',
      path: 'entries[0].Ship',
      message: 'A ship name is required.',
    };

    const answer = parseFleetAnswer(
      fleetBody({ result: 'failed', failure: 'package-refused', packageRefusal: refusal }),
    );

    expect(answer?.packageRefusal).toEqual(refusal);
  });

  it('takes a refusal the package published no message for', () => {
    // Every locale but English today. The absence is the contract, not a fault.
    const answer = parseFleetAnswer(
      fleetBody({
        result: 'failed',
        failure: 'package-refused',
        packageRefusal: {
          code: 'unknown-identity',
          constraint: null,
          path: null,
          message: null,
        },
      }),
    );

    expect(answer?.packageRefusal?.message).toBeNull();
  });

  it('reads the instant a waiting answer names', () => {
    const answer = parseFleetAnswer(
      fleetBody({
        result: 'waiting',
        coverage: {
          startDate: '2026-08-18',
          cursorDate: '2026-09-02',
          cursorLine: 0,
          storedShips: null,
          nextPermittedRefreshAt: '2026-09-11T11:00:00.000Z',
        },
      }),
    );

    expect(answer?.coverage?.nextPermittedRefreshAt).toBe('2026-09-11T11:00:00.000Z');
  });

  it('takes the absent coverage a first refresh answers with', () => {
    expect(parseFleetAnswer(fleetBody({ coverage: null }))?.coverage).toBeNull();
  });

  const refusals: readonly (readonly [string, unknown])[] = [
    ['a body that is not an object', 'current'],
    ['a result this contract does not publish', fleetBody({ result: 'stale' })],
    ['a failure this contract does not publish', fleetBody({ failure: 'tired' })],
    ['a field nobody agreed on', { ...fleetBody(), shipCount: 2 }],
    [
      'a missing field',
      (() => {
        const { pending: _pending, ...rest } = fleetBody();
        return rest;
      })(),
    ],
    ['ships that are not a list', fleetBody({ ships: {} })],
    ['a pending flag that is not a boolean', fleetBody({ pending: 'yes' })],
    ['a coverage block missing its cursor', fleetBody({ coverage: { startDate: '2026-08-18' } })],
    [
      'a coverage date that is not a date',
      fleetBody({
        coverage: {
          startDate: '2026-13-40',
          cursorDate: '2026-09-02',
          cursorLine: 0,
          storedShips: null,
          nextPermittedRefreshAt: null,
        },
      }),
    ],
    [
      'a refusal carrying no code',
      fleetBody({ packageRefusal: { code: '', constraint: null, path: null, message: null } }),
    ],
    [
      'a refusal carrying a field nobody agreed on',
      fleetBody({
        packageRefusal: { code: 'x', constraint: null, path: null, message: null, hint: 'y' },
      }),
    ],
  ];

  it.each(refusals)('refuses %s', (_name, body) => {
    expect(parseFleetAnswer(body)).toBeNull();
  });

  describe('a Problem Details refusal', () => {
    it.each(['unauthorised', 'invalid-anti-forgery', 'fleet-unavailable'])(
      'reads the published code "%s"',
      (code) => {
        expect(parseFleetRefusal(401, { code })).toEqual({ kind: 'refused', status: 401, code });
      },
    );

    it('reads a code it does not know as unknown, rather than as something it does', () => {
      expect(parseFleetRefusal(500, { code: 'teapot' })).toEqual({
        kind: 'refused',
        status: 500,
        code: 'unknown',
      });
    });

    it('reads a body that is not Problem Details at all', () => {
      expect(parseFleetRefusal(502, null)).toEqual({
        kind: 'refused',
        status: 502,
        code: 'unknown',
      });
    });
  });
});
