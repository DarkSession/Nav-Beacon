import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FIXTURE_IDS, NAMED_RECORD_V1 } from '../../domain/records/fixtures/records';
import type { LocalRecord } from '../../domain/records/local-record';
import { toRemoteRecord } from '../../domain/records/remote-record.serializer';
import { decodeAndMigrate } from '../../domain/ships/build/record-migrations';
import { CommanderApi } from './commander-api';
import SESSION_RESPONSE_CONTRACT from './session-response.contract.json';

/**
 * Every address this client asks for, resolved against the deployment base.
 *
 * The application is served from the root of its own domain and, for every
 * pull request, from a directory of a second one. A leading `/` is invisible
 * at the root and fatal one directory down, so the base address is part of
 * what is under test here rather than an assumption around it.
 */
const ROOT = 'https://navbeacon.app/';
const SUB_PATH = 'https://preview.test/Nav-Beacon-Preview/pr-12/';

interface Exchange {
  readonly address: string;
  readonly init: RequestInit;
}

/** A browsing context that answers from a script and records what was asked. */
class FakeView {
  readonly exchanges: Exchange[] = [];
  readonly assigned: string[] = [];
  readonly replaced: string[] = [];

  /** The answers, by the path the request resolved to, last one repeated. */
  answers: Response[] = [];
  /** Set to throw from `fetch`, for a request that never arrives. */
  failure: Error | null = null;

  readonly location: { origin: string; href: string; assign: (to: string) => void };
  readonly history = {
    state: { marker: 1 },
    replaceState: (_state: unknown, _title: string, address: string) => {
      this.replaced.push(address);
    },
  };

  constructor(base: string, search = '') {
    const origin = new URL(base).origin;
    this.location = {
      origin,
      href: `${base}${search}`,
      assign: (to: string) => this.assigned.push(to),
    };
  }

  async fetch(address: URL | string, init: RequestInit): Promise<Response> {
    this.exchanges.push({ address: String(address), init });
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.answers.length > 1
      ? (this.answers.shift() ?? new Response(null, { status: 500 }))
      : (this.answers[0] ?? new Response(null, { status: 500 }));
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(base: string, search = ''): { api: CommanderApi; view: FakeView } {
  const view = new FakeView(base, search);
  TestBed.configureTestingModule({
    providers: [{ provide: DOCUMENT, useValue: { baseURI: base, defaultView: view } }],
  });
  return { api: TestBed.inject(CommanderApi), view };
}

function namedRecord(): LocalRecord {
  const decoded = decodeAndMigrate(JSON.parse(NAMED_RECORD_V1), FIXTURE_IDS.named);
  if (!decoded.ok) {
    throw new Error('The fixture did not decode.');
  }
  return decoded.record;
}

const SESSION = {
  signedIn: true,
  customerId: '900001',
  commanderName: 'CMDR Jameson',
  antiForgeryToken: 'token-1',
};

describe('the Commander API client', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('resolving addresses against the deployment base', () => {
    it.each([
      ['api/session', 'session'],
      ['api/auth/frontier', 'sign-in'],
      ['api/session/sign-out', 'sign-out'],
      ['api/account', 'account deletion'],
      ['api/records/synchronise', 'record synchronisation'],
    ])('asks for %s at the root of a domain', async (path) => {
      const { api, view } = client(ROOT);
      view.answers = [json(SESSION), json({ authorisationUri: 'https://auth.frontier.test/go' })];

      await api.readSession();
      await api.startSignIn();
      await api.signOut('token-1');
      await api.deleteAccount('token-1');
      await api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1');

      expect(view.exchanges.map((exchange) => exchange.address)).toContain(`${ROOT}${path}`);
    });

    it.each([
      ['api/session', 'session'],
      ['api/auth/frontier', 'sign-in'],
      ['api/session/sign-out', 'sign-out'],
      ['api/account', 'account deletion'],
      ['api/records/synchronise', 'record synchronisation'],
    ])('asks for %s under a sub-path base address', async (path) => {
      const { api, view } = client(SUB_PATH);
      view.answers = [json(SESSION), json({ authorisationUri: 'https://auth.frontier.test/go' })];

      await api.readSession();
      await api.startSignIn();
      await api.signOut('token-1');
      await api.deleteAccount('token-1');
      await api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1');

      expect(view.exchanges.map((exchange) => exchange.address)).toContain(`${SUB_PATH}${path}`);
    });

    it('never asks for a root-absolute path from a sub-path deployment', async () => {
      const { api, view } = client(SUB_PATH);
      view.answers = [json(SESSION)];

      await api.readSession();
      await api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1');

      for (const exchange of view.exchanges) {
        expect(new URL(exchange.address).pathname.startsWith('/Nav-Beacon-Preview/pr-12/')).toBe(
          true,
        );
      }
    });

    it('refuses a base address on another origin', async () => {
      const view = new FakeView(ROOT);
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DOCUMENT,
            useValue: { baseURI: 'https://elsewhere.test/', defaultView: view },
          },
        ],
      });
      const api = TestBed.inject(CommanderApi);

      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
      expect(view.exchanges).toHaveLength(0);
    });

    it('asks for nothing where there is no browsing context', async () => {
      TestBed.configureTestingModule({
        providers: [{ provide: DOCUMENT, useValue: { baseURI: ROOT, defaultView: null } }],
      });
      const api = TestBed.inject(CommanderApi);

      expect(api.callbackResult()).toBeNull();
      await expect(api.startSignIn()).resolves.toBe(false);
      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
      await expect(api.signOut('token-1')).resolves.toBe(false);
      await expect(
        api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1'),
      ).resolves.toEqual({ kind: 'unavailable' });
    });

    it('sends the session cookie and no cached answer', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json(SESSION)];

      await api.readSession();

      expect(view.exchanges[0]?.init).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
      });
    });
  });

  describe('reading the session', () => {
    /**
     * The server writes this answer and this browser refuses any other property
     * set, so both read `session-response.contract.json`. Reading the contract
     * here is what keeps the fixture below from becoming this browser's own
     * private idea of the answer: a property one side adds alone is a session
     * this browser cannot read and a Commander who cannot sign in at all
     * (020/FR-001, 020/FR-003).
     */
    it('accepts the contract’s property set and nothing beside it', async () => {
      expect(Object.keys(SESSION).sort()).toEqual([...SESSION_RESPONSE_CONTRACT.signedIn].sort());

      const { api, view } = client(ROOT);
      view.answers = [json({ ...SESSION, state: 'signed-in' }), json(SESSION)];

      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
      await expect(api.readSession()).resolves.toMatchObject({ kind: 'signed-in' });
    });

    it('reads a signed-in session', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json(SESSION)];

      await expect(api.readSession()).resolves.toEqual({
        kind: 'signed-in',
        account: { customerId: '900001', commanderName: 'CMDR Jameson' },
        antiForgeryToken: 'token-1',
      });
    });

    it('reads no session as anonymous', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json({}, 401)];

      await expect(api.readSession()).resolves.toEqual({ kind: 'anonymous' });
    });

    it('reads a refused request as unavailable', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json({}, 503)];

      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
    });

    it.each([
      ['an unknown field', { ...SESSION, extra: 1 }],
      ['a missing field', { signedIn: true, customerId: '1', commanderName: 'A' }],
      ['a signed-out body', { ...SESSION, signedIn: false }],
      ['a customer id that is not one', { ...SESSION, customerId: '0900001' }],
      ['an empty Commander name', { ...SESSION, commanderName: '  ' }],
      ['an empty anti-forgery token', { ...SESSION, antiForgeryToken: '' }],
      ['a body that is not an object', [1, 2]],
    ])('refuses a session body with %s', async (_case, body) => {
      const { api, view } = client(ROOT);
      view.answers = [json(body)];

      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
    });

    it('reads a request that never arrives as unavailable', async () => {
      const { api, view } = client(ROOT);
      view.failure = new TypeError('Failed to fetch');

      await expect(api.readSession()).resolves.toEqual({ kind: 'unavailable' });
    });
  });

  describe('starting a sign-in', () => {
    it('navigates to the address Frontier was asked for', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json({ authorisationUri: 'https://auth.frontier.test/go?state=1' })];

      await expect(api.startSignIn()).resolves.toBe(true);
      expect(view.assigned).toEqual(['https://auth.frontier.test/go?state=1']);
    });

    it.each([
      ['an address that is not secure', { authorisationUri: 'http://auth.frontier.test/go' }],
      ['an address that is not one', { authorisationUri: 'not an address' }],
      ['a second field', { authorisationUri: 'https://auth.frontier.test/go', extra: 1 }],
      ['no address at all', {}],
      ['an address that is not text', { authorisationUri: 7 }],
    ])('navigates nowhere for %s', async (_case, body) => {
      const { api, view } = client(ROOT);
      view.answers = [json(body)];

      await expect(api.startSignIn()).resolves.toBe(false);
      expect(view.assigned).toHaveLength(0);
    });

    it('navigates nowhere when the request is refused', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json({}, 500)];

      await expect(api.startSignIn()).resolves.toBe(false);
    });

    it('navigates nowhere when the request never arrives', async () => {
      const { api, view } = client(ROOT);
      view.failure = new TypeError('Failed to fetch');

      await expect(api.startSignIn()).resolves.toBe(false);
    });
  });

  describe('reading the sign-in callback', () => {
    it('reads the outcome and takes it out of the address', () => {
      const { api, view } = client(SUB_PATH, '?account=signed-in&keep=1');

      expect(api.callbackResult()).toBe('signed-in');
      expect(view.replaced).toEqual(['/Nav-Beacon-Preview/pr-12/?keep=1']);
    });

    it('reads a refused correlation', () => {
      const { api } = client(ROOT, '?account=fresh-sign-in-required');

      expect(api.callbackResult()).toBe('fresh-sign-in-required');
    });

    it.each(['?account=something-else', '', '?other=1'])(
      'reads nothing from %s and leaves the address alone',
      (search) => {
        const { api, view } = client(ROOT, search);

        expect(api.callbackResult()).toBeNull();
        expect(view.replaced).toHaveLength(0);
      },
    );
  });

  describe('state-changing requests', () => {
    it.each([
      ['signs out', (api: CommanderApi) => api.signOut('token-1'), 'api/session/sign-out', 'POST'],
      [
        'deletes the account',
        (api: CommanderApi) => api.deleteAccount('token-1'),
        'api/account',
        'DELETE',
      ],
    ])('%s with the anti-forgery header', async (_case, call, path, method) => {
      const { api, view } = client(ROOT);
      view.answers = [json({})];

      await expect(call(api)).resolves.toBe(true);
      expect(view.exchanges[0]?.address).toBe(`${ROOT}${path}`);
      expect(view.exchanges[0]?.init.method).toBe(method);
      expect(view.exchanges[0]?.init.headers).toEqual({ 'X-CSRF-TOKEN': 'token-1' });
    });

    it('reads a refusal as a failure', async () => {
      const { api, view } = client(ROOT);
      view.answers = [json({}, 400)];

      await expect(api.signOut('token-1')).resolves.toBe(false);
    });

    it('reads a request that never arrives as a failure', async () => {
      const { api, view } = client(ROOT);
      view.failure = new TypeError('Failed to fetch');

      await expect(api.deleteAccount('token-1')).resolves.toBe(false);
    });
  });

  describe('exchanging record changes', () => {
    it('sends the cursor, the changes and the anti-forgery header', async () => {
      const { api, view } = client(SUB_PATH);
      view.answers = [json({ accountRevision: 4, results: [], records: [], tombstones: [] })];
      const record = toRemoteRecord(namedRecord());

      await api.synchroniseRecords(
        {
          sinceRevision: 3,
          changes: [
            { type: 'write', record, baseRevision: 2 },
            { type: 'delete', id: FIXTURE_IDS.working, baseRevision: null },
            { type: 'renew', id: FIXTURE_IDS.loadout },
          ],
        },
        'token-1',
      );

      const exchange = view.exchanges[0];
      expect(exchange?.address).toBe(`${SUB_PATH}api/records/synchronise`);
      expect(exchange?.init.method).toBe('POST');
      expect(exchange?.init.headers).toEqual({
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': 'token-1',
      });
      expect(JSON.parse(String(exchange?.init.body))).toEqual({
        sinceRevision: 3,
        changes: [
          { type: 'write', record: JSON.parse(JSON.stringify(record)), baseRevision: 2 },
          { type: 'delete', id: FIXTURE_IDS.working },
          { type: 'renew', id: FIXTURE_IDS.loadout },
        ],
      });
    });

    it('reads an accepted response', async () => {
      const { api, view } = client(ROOT);
      const record = JSON.parse(JSON.stringify(toRemoteRecord(namedRecord())));
      view.answers = [
        json({
          accountRevision: 14,
          results: [{ index: 0, outcome: 'applied', id: FIXTURE_IDS.named, revision: 13 }],
          records: [{ revision: 13, record }],
          tombstones: [{ id: FIXTURE_IDS.working, revision: 14 }],
        }),
      ];

      const response = await api.synchroniseRecords({ sinceRevision: 12, changes: [] }, 'token-1');

      expect(response).toMatchObject({
        kind: 'accepted',
        accountRevision: 14,
        results: [{ index: 0, outcome: 'applied', id: FIXTURE_IDS.named, revision: 13 }],
        tombstones: [{ id: FIXTURE_IDS.working, revision: 14 }],
      });
      expect(response.kind === 'accepted' && response.records[0]?.record.id).toBe(
        FIXTURE_IDS.named,
      );
    });

    it('reads a refusal as its status and code', async () => {
      const { api, view } = client(ROOT);
      view.answers = [
        json(
          {
            type: 'about:blank',
            title: 'One change conflicts with the account.',
            status: 409,
            code: 'conflict',
            accountRevision: 12,
            results: [
              { index: 0, outcome: 'conflict', id: FIXTURE_IDS.named, revision: 9, record: null },
            ],
          },
          409,
        ),
      ];

      await expect(
        api.synchroniseRecords({ sinceRevision: 8, changes: [] }, 'token-1'),
      ).resolves.toMatchObject({
        kind: 'refused',
        status: 409,
        code: 'conflict',
        accountRevision: 12,
        results: [{ index: 0, outcome: 'conflict', remote: { kind: 'deleted' } }],
      });
    });

    it('reads a refusal with no readable body as its status', async () => {
      const { api, view } = client(ROOT);
      view.answers = [new Response('not json', { status: 401 })];

      await expect(
        api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1'),
      ).resolves.toMatchObject({ kind: 'refused', status: 401, code: 'unknown', results: [] });
    });

    it('reads an accepted answer it cannot read as unavailable', async () => {
      const { api, view } = client(ROOT);
      view.answers = [new Response('not json', { status: 200 })];

      await expect(
        api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1'),
      ).resolves.toEqual({ kind: 'unavailable' });
    });

    it('reads a request that never arrives as unavailable', async () => {
      const { api, view } = client(ROOT);
      view.failure = new TypeError('Failed to fetch');

      await expect(
        api.synchroniseRecords({ sinceRevision: 0, changes: [] }, 'token-1'),
      ).resolves.toEqual({ kind: 'unavailable' });
    });
  });
});
