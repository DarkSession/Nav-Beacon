import { expect, type Locator, type Page, type Route } from '@playwright/test';
import englishMessages from '../src/app/i18n/locales/en.json';
import { reachShellAction } from './shell';

/**
 * The Commander service, stubbed at the network boundary.
 *
 * Every account journey starts at the answer the same-origin service gives, so
 * the stub is the service rather than a seeded browser store: what is under
 * test is what this browser does with an answer, and a store written by hand
 * would skip the half of the behaviour that reads one.
 *
 * One handle drives the whole service. A journey changes what an address
 * answers between presses — a session that signs in, an exchange that comes
 * back with a conflict, a fleet refresh Frontier holds — and reads back what
 * the browser actually sent, which is how a journey proves that a note, a
 * fragment or another Commander's record never left this machine.
 */

/** The Commander the stubbed service knows. */
export const CUSTOMER_ID = '900001';
export const COMMANDER_NAME = 'CMDR Jameson';

/** The anti-forgery value the session hands out, echoed on every write. */
export const ANTI_FORGERY = 'anti-forgery-1';

/** Where this browser keeps what it knows about an account. */
export const COMMANDER_STATE_KEY = 'ednb:commander-state';

/**
 * The one address the browser is allowed to leave this origin for.
 *
 * Held here so a journey can watch the deliberate sign-in navigation without
 * ever reaching Frontier: the route below answers it with a page of its own
 * (constitution I).
 */
export const FRONTIER_SIGN_IN = 'https://auth.frontierstore.net/auth?state=stub';

/** One answer the stubbed service gives, or no answer at all. */
export type ServiceAnswer = { readonly status: number; readonly body?: unknown } | 'unreachable';

/** One record-exchange request, as the browser sent it. */
export interface SentExchange {
  readonly sinceRevision: number;
  readonly changes: readonly Record<string, unknown>[];
}

/** The stubbed service, as the journey that installed it drives it. */
export interface CommanderService {
  /** What `GET api/session` answers. */
  session: 'signed-in' | 'anonymous' | 'unreachable';
  /** What each `POST api/records/synchronise` answers, given what was sent. */
  exchange: (request: SentExchange) => ServiceAnswer;
  /** What `GET api/fleet` and `POST api/fleet/refresh` answer. */
  fleet: (asked: 'read' | 'refresh') => ServiceAnswer;
  /** Every record exchange the browser has sent, in order. */
  readonly sent: SentExchange[];
  /** Every Commander address the browser has asked for, in order. */
  readonly asked: string[];
}

/** The session body, in the exact shape the browser accepts. */
function sessionBody(): Record<string, unknown> {
  return {
    signedIn: true,
    customerId: CUSTOMER_ID,
    commanderName: COMMANDER_NAME,
    antiForgeryToken: ANTI_FORGERY,
  };
}

/**
 * Installs the stubbed service on this page.
 *
 * Installed before the first navigation, because the account state is read
 * while the application boots: a route added after `goto` would leave the first
 * session read to be answered by the development server, which answers every
 * address with the application itself.
 */
export async function installCommanderService(
  page: Page,
  initial: Partial<Pick<CommanderService, 'session' | 'exchange' | 'fleet'>> = {},
): Promise<CommanderService> {
  const service: CommanderService = {
    session: initial.session ?? 'anonymous',
    exchange: initial.exchange ?? (() => ({ status: 200, body: acceptedExchange() })),
    fleet: initial.fleet ?? (() => ({ status: 200, body: fleetAnswer() })),
    sent: [],
    asked: [],
  };

  const answer = async (route: Route, given: ServiceAnswer) => {
    if (given === 'unreachable') {
      await route.abort('failed').catch(() => {});
      return;
    }
    await route
      .fulfill({
        status: given.status,
        contentType: 'application/json',
        body: JSON.stringify(given.body ?? {}),
      })
      .catch(() => {});
  };

  await page.route('**/api/session', async (route) => {
    service.asked.push('session');
    if (service.session === 'unreachable') {
      await answer(route, 'unreachable');
      return;
    }
    await answer(
      route,
      service.session === 'signed-in' ? { status: 200, body: sessionBody() } : { status: 401 },
    );
  });

  await page.route('**/api/auth/frontier', async (route) => {
    service.asked.push('sign-in');
    await answer(route, { status: 200, body: { authorisationUri: FRONTIER_SIGN_IN } });
  });

  await page.route('**/api/session/sign-out', async (route) => {
    service.asked.push('sign-out');
    service.session = 'anonymous';
    await answer(route, { status: 204 });
  });

  await page.route('**/api/account', async (route) => {
    service.asked.push('delete-account');
    service.session = 'anonymous';
    await answer(route, { status: 204 });
  });

  await page.route('**/api/records/synchronise', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}') as SentExchange;
    service.asked.push('synchronise');
    service.sent.push(sent);
    await answer(route, service.exchange(sent));
  });

  await page.route('**/api/fleet', async (route) => {
    service.asked.push('fleet');
    await answer(route, service.fleet('read'));
  });

  await page.route('**/api/fleet/refresh', async (route) => {
    service.asked.push('fleet-refresh');
    await answer(route, service.fleet('refresh'));
  });

  // Frontier itself, answered here rather than reached. The navigation is the
  // behaviour under test; the page it lands on is not.
  await page.route('https://auth.frontierstore.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Frontier</title>' }),
  );

  return service;
}

/** One accepted record exchange, with nothing in the account's own stream. */
export function acceptedExchange(
  overrides: {
    accountRevision?: number;
    results?: readonly Record<string, unknown>[];
    records?: readonly Record<string, unknown>[];
    tombstones?: readonly Record<string, unknown>[];
  } = {},
): Record<string, unknown> {
  return {
    accountRevision: overrides.accountRevision ?? 1,
    results: overrides.results ?? [],
    records: overrides.records ?? [],
    tombstones: overrides.tombstones ?? [],
  };
}

/**
 * Every change in one sent exchange answered as applied.
 *
 * The service numbers its results by the index of the change they answer, so
 * this is written from what the browser actually sent rather than from a count
 * a journey guessed.
 */
export function everyChangeApplied(
  request: SentExchange,
  accountRevision = 1,
): Record<string, unknown> {
  return acceptedExchange({
    accountRevision,
    results: request.changes.map((change, index) => ({
      ...indexed(change, index),
      outcome: 'applied',
      revision: accountRevision,
    })),
  });
}

/** One result's index, and the record it is about where the change names one. */
function indexed(change: Record<string, unknown>, index: number): Record<string, unknown> {
  const id = recordIdOf(change);
  return id === null ? { index } : { index, id };
}

/**
 * The first change of one sent exchange refused as a conflict.
 *
 * A conflict is a refusal rather than an acceptance: the service applies none
 * of the batch and names what it holds for the change it could not take. A
 * `record` of `null` is the account's own deletion marker, which is what raises
 * the deletion conflict a Commander answers (020/FR-010, 020/FR-026).
 */
export function firstChangeConflicts(
  request: SentExchange,
  remote: Record<string, unknown> | null = null,
  accountRevision = 2,
): ServiceAnswer {
  return {
    status: 409,
    body: {
      code: 'conflict',
      accountRevision,
      results: request.changes.map((change, index) =>
        index === 0
          ? {
              ...indexed(change, index),
              outcome: 'conflict',
              revision: accountRevision,
              record: remote,
            }
          : { ...indexed(change, index), outcome: 'not-applied' },
      ),
    },
  };
}

/** The application record identity one sent change is about, where it has one. */
function recordIdOf(change: Record<string, unknown>): string | null {
  const record = change['record'];
  if (record !== null && typeof record === 'object' && 'id' in record) {
    const id = (record as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return typeof change['id'] === 'string' ? change['id'] : null;
}

/**
 * The package-produced ship model, in the shape the service stores it.
 *
 * It states the hull and the Commander's own names for the ship, and no
 * modules: the package populates every fixed mount with that hull's default,
 * and a mount it defaulted is ordinary build state. Written out here rather
 * than produced from the package, because the end-to-end suite runs in Node and
 * the package's subpaths are resolved by the application's build rather than by
 * Node.
 */
export function ownedShipModel(
  hullSymbol: string,
  shipName: string,
  shipIdent: string,
): Record<string, unknown> {
  return { hullSymbol, shipName, shipIdent, modules: [] };
}

/** One owned ship, as the fleet answer carries it. */
export function ownedShip(
  shipId: number,
  model: Record<string, unknown>,
  sourceDate = '2026-09-01',
  sourceLine = 3,
): Record<string, unknown> {
  return { shipId, sourceDate, sourceLine, model };
}

/** One fleet answer, in the exact shape both fleet addresses send. */
export function fleetAnswer(
  overrides: {
    result?: string;
    ships?: readonly Record<string, unknown>[];
    coverage?: Record<string, unknown> | null;
    pending?: boolean;
    failure?: string | null;
    packageRefusal?: Record<string, unknown> | null;
  } = {},
): Record<string, unknown> {
  return {
    result: overrides.result ?? 'current',
    ships: overrides.ships ?? [],
    coverage:
      overrides.coverage === undefined
        ? {
            startDate: '2026-08-18',
            cursorDate: '2026-09-02',
            cursorLine: 7,
            storedShips: { date: '2026-09-01', line: 3, complete: true },
            nextPermittedRefreshAt: null,
          }
        : overrides.coverage,
    pending: overrides.pending ?? false,
    failure: overrides.failure ?? null,
    packageRefusal: overrides.packageRefusal ?? null,
  };
}

/** The stored-build layer, whichever of its two views is showing. */
export function library(page: Page): Locator {
  return page.getByRole('dialog', { name: englishMessages['library.title'] });
}

/** The Commander account modal. */
export function accountDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: englishMessages['account.title'] });
}

/** The question asked before an account is deleted. */
export function deletionConfirmation(page: Page): Locator {
  return page.getByRole('dialog', { name: englishMessages['account.delete.title'] });
}

/** The layer that asks what happens to one record the account disagrees about. */
export function conflictLayer(page: Page): Locator {
  return page.getByRole('dialog', {
    name: new RegExp(
      `^(${englishMessages['sync.conflict.stale.title']}|${englishMessages['sync.conflict.deleted.title']})$`,
    ),
  });
}

/**
 * Opens the account modal from the frame, at whichever width.
 *
 * The action is named for the Commander once there is one, so the name it is
 * reached by is the one the frame is drawing rather than a fixed label.
 */
export async function openAccountDialog(page: Page, signedIn = false): Promise<void> {
  await reachShellAction(
    page,
    new RegExp(`^${signedIn ? COMMANDER_NAME : englishMessages['account.action']}$`),
  );
  await expect(accountDialog(page)).toBeVisible();
}

/** Shows the ships the Commander owns, inside the stored-build layer. */
export async function showOwnedShips(page: Page): Promise<void> {
  await library(page)
    .getByRole('button', { name: englishMessages['fleet.title'], exact: true })
    .click();
}

/** Every record this browser holds, by name. */
export async function recordNames(page: Page): Promise<readonly (string | null)[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ednb:record:'))
      .map(
        (key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { name?: string }).name ?? null,
      ),
  );
}

/** What this browser has accepted for this account, exactly as it is stored. */
export async function storedCommanderState(page: Page): Promise<string> {
  return page.evaluate((key) => localStorage.getItem(key) ?? '', COMMANDER_STATE_KEY);
}
