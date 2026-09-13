import {
  cachedFleetFor,
  isSettledFleetResult,
  parseFleetCache,
  withFleetCached,
  type CachedFleet,
} from './fleet-cache';

const OWNER = '900001';
const OTHER = '900002';

function cached(overrides: Partial<CachedFleet> = {}): CachedFleet {
  return {
    customerId: OWNER,
    acceptedAt: '2026-09-10T08:00:00.000Z',
    result: 'current',
    ships: [{ shipId: 12 }],
    coverage: null,
    ...overrides,
  };
}

describe('the fleet a browser keeps', () => {
  it('reads a complete entry back', () => {
    expect(parseFleetCache([cached()])).toEqual([cached()]);
  });

  it.each(['current', 'empty', 'incomplete'])('caches the settled result "%s"', (result) => {
    expect(isSettledFleetResult(result as never)).toBe(true);
  });

  it.each(['waiting', 'failed', 'authorisation-expired'])(
    'never caches "%s", so the fleet already accepted stands',
    (result) => {
      expect(isSettledFleetResult(result as never)).toBe(false);
      expect(parseFleetCache([cached({ result: result as never })])).toEqual([]);
    },
  );

  const dropped: readonly (readonly [string, unknown])[] = [
    ['a cache that is not a list', {}],
    ['an entry that is not an object', 'a ship'],
    ['an entry under something that is not a Customer ID', { ...cached(), customerId: 'x' }],
    ['an entry with an unreadable instant', { ...cached(), acceptedAt: 'whenever' }],
    ['an entry whose ships are not a list', { ...cached(), ships: 'twelve' }],
    ['an entry whose ship is not an object', { ...cached(), ships: [12] }],
    ['an entry carrying a field nobody agreed on', { ...cached(), pending: true }],
    ['an entry whose coverage does not read', { ...cached(), coverage: { startDate: 'x' } }],
  ];

  it.each(dropped)('drops %s', (_name, entry) => {
    expect(parseFleetCache(Array.isArray(entry) ? entry : [entry])).toEqual([]);
  });

  it('keeps one entry per account, and reads back the one asked for', () => {
    const cache = withFleetCached([cached()], cached({ customerId: OTHER, ships: [] }));

    expect(cachedFleetFor(cache, OWNER)?.ships.length).toBe(1);
    expect(cachedFleetFor(cache, OTHER)?.ships.length).toBe(0);
    expect(cachedFleetFor(cache, '900003')).toBeNull();
  });

  it('replaces the entry for one account rather than adding a second', () => {
    const cache = withFleetCached([cached()], cached({ ships: [{ shipId: 3 }, { shipId: 4 }] }));

    expect(cache.length).toBe(1);
    expect(cache[0].ships.length).toBe(2);
  });

  it('keeps the first entry when a stored value names one account twice', () => {
    const parsed = parseFleetCache([cached(), cached({ ships: [] })]);

    expect(parsed.length).toBe(1);
    expect(parsed[0].ships.length).toBe(1);
  });
});
