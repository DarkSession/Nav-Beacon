import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HULL_PARENT,
  SITE_CARD,
  contentBearing,
  contentBearingAddresses,
  declaredOrigin,
  documentHead,
  documentTitle,
  hullAddressSegment,
  hullCard,
  interpolate,
  publishedAddresses,
} from './published-addresses.mjs';

/**
 * The module three readers share.
 *
 * What is worth testing here is not that it lists addresses — it is that the
 * strings it composes are the strings the running application composes. A
 * document published with one title and rewritten with another tells a crawler
 * and a Commander two different names for one page, and neither of them would
 * ever see the other.
 */

const ORIGIN = 'https://navbeacon.app';

/** Two hulls is enough to prove the shape and the ordering. */
const SHIPS = [
  { symbol: 'Empire_Trader', name: 'Imperial Clipper' },
  { symbol: 'Anaconda', name: 'Anaconda' },
];

const CATALOGUE = {
  'app.name': 'Nav Beacon',
  'app.document-title': '{{page}} · {{app}}',
  'app.document-title.default': 'Nav Beacon – Elite Dangerous Commander Tools',
  'app.description': 'Nav Beacon is a set of Elite Dangerous tools.',
  'catalogue.title': 'Ship Builder',
  'catalogue.description': 'Browse every hull.',
  'hullDetail.title': '{{hull}}',
  'hullDetail.description': '{{hull}}: every figure and the slot layout.',
};

describe('published addresses', () => {
  it('lists the top-level routes and one address per hull', () => {
    const addresses = publishedAddresses({ origin: ORIGIN, ships: SHIPS });

    assert.deepEqual(
      addresses.map((entry) => entry.address),
      [
        // The product's own address, which used to be a redirect and so used to
        // be absent from the map entirely.
        `${ORIGIN}/`,
        `${ORIGIN}/ships`,
        `${ORIGIN}/outfitting`,
        `${ORIGIN}/equipment`,
        // Addressed by the hull's name with an underscore for each space, and
        // sorted by that address rather than left in the package's order: a pin
        // move that reorders the catalogue then does not rewrite the whole
        // sitemap and hide the one hull it actually added (001/FR-005).
        `${ORIGIN}/${HULL_PARENT}/Anaconda`,
        `${ORIGIN}/${HULL_PARENT}/Imperial_Clipper`,
      ],
    );
  });

  it('spells a name with a space as one address segment', () => {
    assert.equal(hullAddressSegment('Type-11 Prospector'), 'Type-11_Prospector');
    assert.equal(hullAddressSegment('Anaconda'), 'Anaconda');
    assert.equal(hullAddressSegment('Fer-de-Lance'), 'Fer-de-Lance');
  });

  it('gives a hull its own illustration as its card, and everything else the mark', () => {
    const addresses = publishedAddresses({ origin: ORIGIN, ships: SHIPS });

    assert.equal(addresses[0].image, SITE_CARD);
    // The illustration is still filed under the symbol: the address names the
    // hull and the identity does not change with it.
    assert.equal(addresses.at(-1).image, hullCard('Empire_Trader'));
  });

  it('refuses to build addresses without an origin to put them under', () => {
    assert.throws(() => publishedAddresses({ ships: SHIPS }), /origin/);
  });

  it('reads the origin out of the file that declares it, and refuses a file that does not', () => {
    assert.equal(declaredOrigin("export const SITE_ORIGIN = 'https://navbeacon.app';"), ORIGIN);
    assert.throws(() => declaredOrigin('export const NOTHING = 1;'), /SITE_ORIGIN/);
  });
});

describe('what a published document says', () => {
  const hull = () =>
    publishedAddresses({ origin: ORIGIN, ships: SHIPS }).find(
      (entry) => entry.path === `${HULL_PARENT}/Anaconda`,
    );

  it('names the hull in the title and in the description', () => {
    const head = documentHead(hull(), CATALOGUE, ORIGIN);

    assert.equal(head.title, 'Anaconda · Nav Beacon');
    assert.equal(head.description, 'Anaconda: every figure and the slot layout.');
  });

  it('carries the card as an address a chat client can fetch, described by the title', () => {
    const head = documentHead(hull(), CATALOGUE, ORIGIN);

    assert.equal(head.image, `${ORIGIN}/assets/ships/Anaconda/illustration.png`);
    assert.equal(head.imageAlt, head.title);
    assert.equal(head.canonical, `${ORIGIN}/${HULL_PARENT}/Anaconda`);
  });

  it('states the product once on the root address, and names the screen elsewhere', () => {
    // The root is the start page, and its own name is the product's name, so
    // the tab carries the product's title rather than its name twice over.
    const [root, catalogue] = publishedAddresses({ origin: ORIGIN, ships: SHIPS });

    assert.equal(
      documentHead(root, CATALOGUE, ORIGIN).title,
      'Nav Beacon – Elite Dangerous Commander Tools',
    );
    assert.equal(
      documentHead(root, CATALOGUE, ORIGIN).description,
      'Nav Beacon is a set of Elite Dangerous tools.',
    );
    assert.equal(documentHead(catalogue, CATALOGUE, ORIGIN).title, 'Ship Builder · Nav Beacon');
  });

  it('leaves a placeholder with no value as nothing rather than as its own name', () => {
    assert.equal(interpolate('{{hull}} and {{missing}}', { hull: 'Adder' }), 'Adder and ');
  });

  it('falls back to the application title where the page has no name', () => {
    assert.equal(documentTitle(CATALOGUE, null), 'Nav Beacon – Elite Dangerous Commander Tools');
    assert.equal(documentTitle(CATALOGUE, '   '), 'Nav Beacon – Elite Dangerous Commander Tools');
  });
});

/**
 * Which advertised addresses carry content a build can state.
 *
 * The property under test is that the two consumers of this verdict cannot
 * disagree, because there is only one verdict. A build that generated 50
 * documents and a gate that expected 51 would not fail here — it would fail
 * with a message about a missing file, days later, in a job nobody attached to
 * this decision (015/FR-021).
 */
describe('the content-bearing registry', () => {
  const ORIGIN = 'https://navbeacon.app';

  it('answers for every advertised address exactly once', () => {
    const addresses = contentBearingAddresses({ origin: ORIGIN });
    const advertised = publishedAddresses({ origin: ORIGIN });

    assert.equal(addresses.length, advertised.length);
    assert.deepEqual(
      addresses.map((entry) => entry.path),
      advertised.map((entry) => entry.path),
    );
    assert.equal(new Set(addresses.map((entry) => entry.path)).size, addresses.length);
  });

  it('generates the root, the catalogue and every hull', () => {
    const bearing = contentBearingAddresses({ origin: ORIGIN }).filter(
      (entry) => entry.contentBearing,
    );

    assert.ok(bearing.some((entry) => entry.path === ''));
    assert.ok(bearing.some((entry) => entry.path === HULL_PARENT));
    // Every hull, counted against the package rather than against 49 — a pin
    // move that adds a hull must not need this number edited (015/SC-009).
    const hulls = publishedAddresses({ origin: ORIGIN }).filter((entry) =>
      entry.path.startsWith(`${HULL_PARENT}/`),
    );
    assert.equal(
      bearing.filter((entry) => entry.path.startsWith(`${HULL_PARENT}/`)).length,
      hulls.length,
    );
    assert.equal(bearing.length, hulls.length + 2);
  });

  it('generates no document for the two benches, and says why for each', () => {
    const free = contentBearingAddresses({ origin: ORIGIN }).filter(
      (entry) => !entry.contentBearing,
    );

    assert.deepEqual(
      free.map((entry) => entry.path),
      ['outfitting', 'equipment'],
    );
    for (const entry of free) {
      // A reason, not a bare exclusion. An address left out because nobody got
      // to it cannot be described in a sentence that survives review.
      assert.equal(typeof entry.reason, 'string');
      assert.ok(entry.reason.length > 0);
    }
  });

  it('carries no reason where a document is generated', () => {
    for (const entry of contentBearingAddresses({ origin: ORIGIN })) {
      if (entry.contentBearing) {
        assert.equal(entry.reason, null);
      }
    }
  });

  it('keeps every field the address already had', () => {
    // The verdict is attached to the address, not a parallel list keyed by
    // path. A second list would be a second thing to keep in step.
    const [root] = contentBearingAddresses({ origin: ORIGIN });

    assert.equal(root.path, '');
    assert.equal(root.address, `${ORIGIN}/`);
    assert.equal(root.titleKey, 'app.name');
    assert.equal(root.image, SITE_CARD);
  });

  it('treats an address nobody has ruled on as content-bearing', () => {
    // The default matters: a new address that someone forgot to classify gets
    // a document, which is visible, rather than silently getting none. The
    // reconciliation gate is what makes the omission fail the build; this is
    // what makes the failure mode the loud one.
    assert.deepEqual(contentBearing('a-new-address'), {
      path: 'a-new-address',
      contentBearing: true,
      reason: null,
    });
  });
});
