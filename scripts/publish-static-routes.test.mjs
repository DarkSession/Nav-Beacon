import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  advertisedAddresses,
  attribute,
  documentFor,
  fileFor,
  pruneEmptyDirectories,
  renderedFileFor,
} from './publish-static-routes.mjs';
import { withoutXmlComments } from './search/published-addresses.mjs';
import { sitemapDocument } from './generate-sitemap.mjs';

/**
 * The step that decides what a crawler is served.
 *
 * The guard worth naming is the one a deployment step cannot have: a
 * substitution that silently did nothing is a failure here, rather than a
 * published address quietly carrying the site's root as its identity.
 */

const ORIGIN = 'https://navbeacon.app';

const INDEX = [
  '<!doctype html>',
  '<html lang="en"><head>',
  '<title>Nav Beacon</title>',
  `<link rel="canonical" href="${ORIGIN}/" />`,
  '<meta name="description" content="What this is." />',
  '<meta name="twitter:description" content="What this is." />',
  '<meta name="twitter:title" content="Nav Beacon" />',
  `<meta name="twitter:image" content="${ORIGIN}/assets/link-card.png" />`,
  '<meta property="og:description" content="What this is." />',
  '<meta property="og:title" content="Nav Beacon" />',
  `<meta property="og:url" content="${ORIGIN}/" />`,
  `<meta property="og:image" content="${ORIGIN}/assets/link-card.png" />`,
  '<meta property="og:image:alt" content="Nav Beacon" />',
  '</head><body></body></html>',
].join('\n');

const HEAD = {
  title: 'Anaconda · Nav Beacon',
  description: 'Anaconda: every figure and the slot layout.',
  canonical: `${ORIGIN}/ships/Anaconda`,
  image: `${ORIGIN}/assets/ships/Anaconda/illustration.png`,
  imageAlt: 'Anaconda · Nav Beacon',
};

describe('reading the map', () => {
  it('lists the addresses a sitemap advertises', () => {
    assert.deepEqual(advertisedAddresses(sitemapDocument([{ address: `${ORIGIN}/ships` }])), [
      `${ORIGIN}/ships`,
    ]);
  });

  it('reads no address out of a comment', () => {
    const commented = `<urlset>
      <url><loc>${ORIGIN}/ships</loc></url>
      <!-- <url><loc>${ORIGIN}/ghost</loc></url> -->
    </urlset>`;

    assert.deepEqual(advertisedAddresses(commented), [`${ORIGIN}/ships`]);
  });

  it('refuses a comment one pass cannot cut rather than reading half of it', () => {
    // `<!<!-- -->--` leaves `<!--` behind, so a single pass turns the rest of
    // the file into a comment for one reader and not for the other. Refusing is
    // what keeps the deployment and the policy checker reading one file.
    const nested = `<urlset>
      <!<!-- -->-- <loc>${ORIGIN}/ghost</loc> -->
      <url><loc>${ORIGIN}/ships</loc></url>
    </urlset>`;

    assert.throws(() => advertisedAddresses(nested), /nested or contains/);
  });

  it('refuses a map that advertises nothing', () => {
    assert.throws(() => advertisedAddresses('<urlset></urlset>'), /No <loc>/);
  });

  it('cuts a comment without swallowing the markup after it', () => {
    assert.equal(withoutXmlComments('<a/><!-- gone --><b/>'), '<a/><b/>');
  });
});

describe('where a published address is written', () => {
  it('writes an address below the root as a file below the root', () => {
    assert.equal(fileFor(`${ORIGIN}/ships/Anaconda`, ORIGIN), 'ships/Anaconda.html');
  });

  it('writes a top-level address as a file, never as a directory', () => {
    // `ships/index.html` would answer 301 to `/ships/`, which would make the
    // address the sitemap and the canonical both name the one that does not
    // answer.
    assert.equal(fileFor(`${ORIGIN}/ships`, ORIGIN), 'ships.html');
  });

  it('writes the root as index.html, which is the file that answers it', () => {
    // The root used to be refused here, because a redirect is not an address.
    // It is the start page now, and `index.html` is the only file that answers
    // it — a directory document would answer 301 to itself.
    assert.equal(fileFor(`${ORIGIN}/`, ORIGIN), 'index.html');
  });

  it('refuses an address that is not under the origin, and one that names a directory', () => {
    assert.throws(() => fileFor('https://example.test/ships', ORIGIN), /not an address under/);
    assert.throws(() => fileFor(`${ORIGIN}/ships/`, ORIGIN), /ends in a slash/);
  });
});

describe('the document an address answers with', () => {
  it('carries its own canonical, title, description and card', () => {
    const document = documentFor(INDEX, HEAD);

    assert.match(document, /<title>Anaconda · Nav Beacon<\/title>/);
    assert.match(document, new RegExp(`rel="canonical" href="${ORIGIN}/ships/Anaconda"`));
    assert.match(document, new RegExp(`property="og:url" content="${ORIGIN}/ships/Anaconda"`));
    assert.match(document, /name="description" content="Anaconda: every figure/);
    assert.match(document, /property="og:description" content="Anaconda: every figure/);
    assert.match(document, /name="twitter:description" content="Anaconda: every figure/);
    assert.match(document, /assets\/ships\/Anaconda\/illustration\.png/);
  });

  it('keeps nothing of the root document it was made from', () => {
    const document = documentFor(INDEX, HEAD);

    assert.ok(!document.includes(`href="${ORIGIN}/"`));
    assert.ok(!document.includes(`content="${ORIGIN}/"`));
    assert.ok(!document.includes('content="What this is."'));
  });

  it('refuses a head that has changed shape rather than publishing an address unchanged', () => {
    // A substitution that silently did nothing looks, in the output directory,
    // exactly like a published address — and tells a crawler to index the root
    // instead, which is the outcome the 404 status had.
    const withoutCanonical = INDEX.replace(/<link rel="canonical"[^>]*>/, '');

    assert.throws(() => documentFor(withoutCanonical, HEAD), /canonical/);
    assert.throws(() => documentFor(INDEX.replace(/<title>[^<]*<\/title>/, ''), HEAD), /<title>/);
    assert.throws(
      () => documentFor(INDEX.replace(/<meta property="og:image:alt"[^>]*>/, ''), HEAD),
      /og:image:alt/,
    );
  });

  it('escapes what would otherwise end the attribute it is written into', () => {
    assert.equal(
      attribute('a "quoted" <tag> & more'),
      'a &quot;quoted&quot; &lt;tag&gt; &amp; more',
    );

    const document = documentFor(INDEX, { ...HEAD, description: 'He said "no" & left' });
    assert.match(document, /content="He said &quot;no&quot; &amp; left"/);
  });

  it('writes a dollar sign as a dollar sign rather than as what it once matched', () => {
    // `$&`, `` $` ``, `$'` and `$1` are expanded by a replacement string after
    // the escaping has run, which splices the matched markup — quotes and all —
    // back in behind it. A value holding one is a message somebody translates
    // or a name a package pin move introduces, so the attribute it lands in has
    // to survive it.
    const injection = "Costs $1 $& $` $' $$";
    const document = documentFor(INDEX, { ...HEAD, title: injection, description: injection });

    // `&` is an entity in both, as it is for any other value; every dollar
    // sign is itself, and nothing the pattern matched came back with it.
    assert.equal(document.match(/<title>([^<]*)<\/title>/)[1], "Costs $1 $&amp; $` $' $$");
    assert.match(document, /content="Costs \$1 \$&amp; \$` \$' \$\$"/);
    // One description tag, not a document that grew a second one out of a value.
    assert.equal(document.match(/<meta name="description"/g).length, 1);
  });
});

/**
 * Where the builder leaves a document, and where it has to end up.
 *
 * Angular's prerenderer writes `<route>/index.html` for every address it
 * renders. GitHub Pages answers a directory with a 301, so publishing that
 * layout would make every advertised address a redirect to an address the
 * sitemap does not carry — the problem feature 011 fixed, re-created by the
 * feature that was meant to build on it (`contracts/address-set.md` §2).
 */
describe('where the builder leaves each document', () => {
  it('leaves an address below the root inside a directory of its own', () => {
    assert.equal(renderedFileFor(`${ORIGIN}/ships/Anaconda`, ORIGIN), 'ships/Anaconda/index.html');
    assert.equal(renderedFileFor(`${ORIGIN}/ships`, ORIGIN), 'ships/index.html');
  });

  it('leaves the root where the root is published, so it is never moved', () => {
    // The one address whose rendered file and published file are the same, and
    // the reason the fallback had to move instead: Pages resolves `/` to
    // `index.html` and to no other file (research decision 9).
    assert.equal(renderedFileFor(`${ORIGIN}/`, ORIGIN), 'index.html');
    assert.equal(renderedFileFor(`${ORIGIN}/`, ORIGIN), fileFor(`${ORIGIN}/`, ORIGIN));
  });

  it('names a different file from the published one for every other address', () => {
    // Which is what makes the move a move. An address whose two names matched
    // would be republished onto itself and its directory left standing.
    for (const path of ['ships', 'ships/Anaconda', 'outfitting']) {
      assert.notEqual(
        renderedFileFor(`${ORIGIN}/${path}`, ORIGIN),
        fileFor(`${ORIGIN}/${path}`, ORIGIN),
      );
    }
  });
});

/**
 * Publishing over the rendered documents rather than over a shell.
 *
 * The defect this stands against does not look like a defect: the build
 * succeeds, all 53 addresses answer 200, every head is correct, and every body
 * is empty. Nothing else in the pipeline notices, because nothing else compares
 * a body to anything. So the assertion is on the *template* — that a document
 * with content in it survives being published (015/FR-005, address-set.md §5).
 */
describe('publishing a document that already has a body', () => {
  const RENDERED = INDEX.replace(
    '<body></body>',
    '<body><app-root><h1>Anaconda</h1><p>Faulcon DeLacy</p></app-root></body>',
  );

  it('keeps the rendered body and replaces only the head', () => {
    const published = documentFor(RENDERED, HEAD);

    assert.match(published, /<h1>Anaconda<\/h1>/);
    assert.match(published, /Faulcon DeLacy/);
    assert.match(published, /<title>Anaconda · Nav Beacon<\/title>/);
    assert.match(published, new RegExp(`rel="canonical" href="${ORIGIN}/ships/Anaconda"`));
  });

  it('leaves a body it was given empty, empty', () => {
    // The two head-only addresses, which are still written from the shell.
    // Their behaviour is unchanged by this feature and must stay that way.
    const published = documentFor(INDEX, HEAD);

    assert.match(published, /<body><\/body>/);
  });

  it('refuses a rendered document whose head has changed shape', () => {
    // Unchanged from the rule this file already held, restated against the new
    // template: a substitution that silently did nothing on a *rendered*
    // document looks even more like success than it did on a shell, because
    // the body is right.
    const headless = RENDERED.replace(/<title>[^<]*<\/title>/, '');

    assert.throws(() => documentFor(headless, HEAD), /no <title>/);
  });
});

/**
 * The empty directories the move leaves behind.
 *
 * `ships/` holds the 49 hull documents as well as the catalogue's own rendered
 * `index.html`, and `ships` is published before any hull is — so removing a
 * document's directory as each is published deletes 49 documents that have not
 * been written yet, and the build still exits 0.
 */
describe('pruning what the move leaves behind', () => {
  /** A directory tree under a temporary root, and the root's path. */
  async function tree(shape) {
    const root = await mkdtemp(join(tmpdir(), 'ednb-prune-'));
    for (const [path, content] of Object.entries(shape)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }
    return root;
  }

  it('removes a directory whose only document has been republished', async () => {
    const root = await tree({ 'ships/Anaconda/.keep': '', 'ships/Anaconda.html': 'x' });
    await rm(join(root, 'ships/Anaconda/.keep'));

    await pruneEmptyDirectories(root);

    assert.equal(existsSync(join(root, 'ships/Anaconda')), false);
    assert.equal(existsSync(join(root, 'ships/Anaconda.html')), true);
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a directory that still holds something', async () => {
    // The guard that stops this from being a recursive delete of the output.
    // `assets/` holds artwork and no document, and must be untouched.
    const root = await tree({ 'assets/ships/anaconda.png': 'png', 'index.html': 'x' });

    await pruneEmptyDirectories(root);

    assert.equal(existsSync(join(root, 'assets/ships/anaconda.png')), true);
    await rm(root, { recursive: true, force: true });
  });

  it('removes a directory left empty only because its children were', async () => {
    const root = await tree({ 'a/b/c/.keep': '', 'index.html': 'x' });
    await rm(join(root, 'a/b/c/.keep'));

    await pruneEmptyDirectories(root);

    assert.equal(existsSync(join(root, 'a')), false);
    assert.equal(existsSync(join(root, 'index.html')), true);
    await rm(root, { recursive: true, force: true });
  });
});
