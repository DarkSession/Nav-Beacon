import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import {
  OUTPUT,
  bodyMarkup,
  headings,
  hullFigures,
  prerenderedDocumentViolations,
  prohibitions,
  readableText,
  ungrouped,
} from './check-prerendered-documents.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT = join(ROOT, OUTPUT);

/**
 * The gate that holds a published document to the package.
 *
 * Every assertion here doctors a real built document and requires the gate to
 * notice. A gate nobody has watched fail is a gate nobody has tested: the
 * defects it exists for — a body overwritten by a shell, a figure that stopped
 * matching, a version baked into static HTML — all leave a build that exits 0
 * and 53 addresses answering 200, so "it passed" tells you nothing on its own
 * (015/FR-020).
 *
 * These need a build. Where there is none they skip rather than fail, because a
 * missing `dist/` means the suite was run without `pnpm run build` and not that
 * anything is wrong; CI runs the build before `test:scripts`.
 */
const built = existsSync(BUILT);

/** A copy of the built output, and the copy's path. */
async function copyOfOutput() {
  const root = await mkdtemp(join(tmpdir(), 'ednb-documents-'));
  await cp(BUILT, root, { recursive: true });
  return root;
}

/** Doctors one document in a copy of the output and returns what the gate said. */
async function afterEditing(file, edit) {
  const root = await copyOfOutput();
  try {
    const path = join(root, file);
    await writeFile(path, edit(await readFile(path, 'utf8')), 'utf8');
    return await prerenderedDocumentViolations(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('reading a document', () => {
  it('reads the body and not the head', () => {
    assert.equal(
      readableText('<html><head><title>No</title></head><body>Yes</body></html>'),
      'Yes',
    );
  });

  it('reads no text out of a script', () => {
    // The load-bearing one. The bundle's module preloads and its serialized
    // transfer state both sit in the body, so a naive tag strip would count a
    // figure that appears nowhere a reader can see it.
    assert.equal(
      readableText('<body><script>var mass = "400 t";</script>Anaconda</body>'),
      'Anaconda',
    );
  });

  it('reads no text out of a comment or a style block', () => {
    assert.equal(readableText('<body><!-- 400 t --><style>.a{}</style>Adder</body>'), 'Adder');
  });

  it('refuses a document with no body rather than reading the whole file', () => {
    assert.throws(() => readableText('<html><head></head></html>'), /no <body>/);
  });

  it('lists every h1 in document order', () => {
    assert.deepEqual(headings('<body><h1>First</h1><h1 class="x">Second</h1></body>'), [
      'First',
      'Second',
    ]);
  });

  it('reads a heading through the markup inside it', () => {
    assert.deepEqual(headings('<h1><span>Viper</span> <em>Mk IV</em></h1>'), ['Viper Mk IV']);
  });
});

describe('comparing a figure to a number', () => {
  it('ignores digit grouping, which is presentation', () => {
    assert.equal(ungrouped('Hull mass 1,100 t'), 'Hull mass 1100 t');
  });

  it('leaves a comma that is not grouping alone', () => {
    assert.equal(ungrouped('Faulcon DeLacy, Core Dynamics'), 'Faulcon DeLacy, Core Dynamics');
    assert.equal(ungrouped('1,10 t'), '1,10 t');
  });

  it('still tells a rounded figure from an exact one', () => {
    // The property that makes the tolerance safe: grouping is forgiven and
    // arithmetic is not (constitution IV).
    assert.ok(!ungrouped('Hull mass 1.1 kt').includes('1100 t'));
  });
});

describe('the figures a hull document must state', () => {
  it('names every figure the contract lists, from the package', () => {
    const anaconda = [...SHIPS].find((ship) => ship.name === 'Anaconda');
    const figures = hullFigures(anaconda);
    const named = figures.map((figure) => figure.what);

    for (const required of [
      'manufacturer',
      'maximum speed',
      'base shield',
      'hull mass',
      'crew',
      'mass lock',
    ]) {
      assert.ok(named.includes(required), `${required} is not checked.`);
    }
    assert.ok(named.some((what) => what.endsWith('huge hardpoint')));
    assert.deepEqual(
      figures.find((figure) => figure.what === 'manufacturer'),
      { what: 'manufacturer', find: anaconda.manufacturer },
    );
  });

  it('counts hardpoints by class from the package rather than from the document', () => {
    const vulture = [...SHIPS].find((ship) => ship.name === 'Vulture');
    const named = hullFigures(vulture).map((figure) => figure.what);

    // Two large and nothing else, so nothing else may be claimed.
    assert.ok(named.includes('2 large hardpoints'));
    assert.ok(!named.some((what) => what.includes('huge')));
    assert.ok(!named.some((what) => what.includes('small')));
  });
});

describe('what a document may not carry', () => {
  it('names the application version among the prohibitions', () => {
    const [version] = prohibitions('9.9.9');

    assert.match(version.what, /application version/);
    assert.ok(version.pattern.test('You are now running version 9.9.9.'));
  });

  it('reads the version as a literal rather than as a pattern', () => {
    // `.` in a version is a dot, not "any character". Without escaping,
    // `0.2.0` would match `0x2y0` and, worse, would not be the check it claims.
    const [version] = prohibitions('1.2.3');

    assert.ok(!version.pattern.test('1x2y3'));
  });

  it('allows this application’s own origin and refuses another', () => {
    const cross = prohibitions('0.0.0').find((rule) => rule.what.includes('cross-origin'));

    assert.ok(!cross.pattern.test('<img src="https://navbeacon.app/assets/a.png">'));
    assert.ok(cross.pattern.test('<img src="https://example.test/tracker.js">'));
  });

  it('refuses a build, wherever in an address it was hidden', () => {
    const build = prohibitions('0.0.0').find((rule) => rule.what === 'a build');

    assert.ok(build.pattern.test('<a href="/outfitting#build=AbCd">'));
    assert.ok(build.pattern.test('<a href="/outfitting?build=AbCd">'));
    assert.ok(!build.pattern.test('<a href="/outfitting">'));
  });

  it('refuses a shared build or loadout in the shape the codecs actually write', () => {
    // The two codecs' own prefixes rather than the word "build": what a
    // Commander shares is `#b.…` and `#e.…`, and a document carrying one would
    // be a Commander's work committed by a build machine.
    const shared = prohibitions('0.0.0').find((rule) => rule.what.includes('shared build'));

    assert.ok(shared.pattern.test('<a href="/outfitting#b.A1B2c3">'));
    assert.ok(shared.pattern.test('<a href="/equipment#e.A1B2c3">'));
    assert.ok(!shared.pattern.test('<a href="/outfitting">'));
    // Not every fragment is a payload. The shell's own skip link is one.
    assert.ok(!shared.pattern.test('<a href="#main">'));
  });

  it('refuses a saved record and a browsing session, by the keys they are stored under', () => {
    const record = prohibitions('0.0.0').find((rule) => rule.what === 'a saved record');
    const session = prohibitions('0.0.0').find((rule) => rule.what === 'a browsing session');

    assert.ok(record.pattern.test('{"ednb:record:7f3":{"title":"My Cutter"}}'));
    assert.ok(!record.pattern.test('<p>A record of every hull.</p>'));
    assert.ok(session.pattern.test('sessionStorage.getItem("ednb:catalogue")'));
    assert.ok(!session.pattern.test('<p>The catalogue.</p>'));
  });

  it('refuses a machine’s own address baked into a document', () => {
    // What separates a document built on a contributor's laptop from the one CI
    // publishes, and the plainest form of runtime configuration in a static
    // asset.
    const configured = prohibitions('0.0.0').find((rule) =>
      rule.what.includes('runtime environment'),
    );

    assert.ok(configured.pattern.test('<link href="http://localhost:4200/main.js">'));
    assert.ok(configured.pattern.test('<script>window.api = process.env.API</script>'));
    assert.ok(!configured.pattern.test('<link href="https://navbeacon.app/main.js">'));
  });
});

describe('the gate, against the built output', { skip: built ? false : 'no build to read' }, () => {
  it('passes on the output as it is built', async () => {
    assert.deepEqual(await prerenderedDocumentViolations(BUILT), []);
  });

  it('fails when a body has been overwritten by the shell', async () => {
    // The defect the whole feature turns on. Every head stays correct, every
    // address answers 200, and nothing a reader wants is served.
    const found = await afterEditing('ships/Anaconda.html', (document) =>
      document.replace(/<body[^>]*>[\s\S]*<\/body>/, '<body><app-root></app-root></body>'),
    );

    assert.equal(found.length, 1);
    assert.match(found[0], /ships\/Anaconda\.html: carries an empty body/);
  });

  it('fails when a figure stops matching the package', async () => {
    // Every occurrence: a hull's document carries the catalogue behind it, so
    // the manufacturer appears once per hull that shares it. Replacing the
    // first would leave the figure still findable and the gate right to pass.
    const found = await afterEditing('ships/Anaconda.html', (document) =>
      document.replaceAll('Faulcon DeLacy', 'Lakon Spaceways'),
    );

    assert.ok(found.some((violation) => /states no manufacturer/.test(violation)));
  });

  it('fails when a figure is rounded rather than stated', async () => {
    // The figure alone, without its unit: the document puts `1,100` and `t` in
    // separate elements, so `1,100 t` is a string that exists only after the
    // markup has been stripped.
    const found = await afterEditing('ships/Imperial_Cutter.html', (document) =>
      document.replaceAll('1,100', '1.1 k'),
    );

    assert.ok(found.some((violation) => /states no hull mass/.test(violation)));
  });

  it('fails when a document states the application version', async () => {
    const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    const found = await afterEditing('index.html', (document) =>
      document.replace('</body>', `<p>App version ${version}</p></body>`),
    );

    assert.ok(found.some((violation) => /states the application version/.test(violation)));
  });

  it('fails when a document reaches another origin', async () => {
    // In an attribute, which is the only place a request URL ever is. Checking
    // stripped text for one is a check that cannot fail.
    const found = await afterEditing('index.html', (document) =>
      document.replace('</body>', '<img src="https://example.test/pixel.gif"></body>'),
    );

    assert.ok(found.some((violation) => /cross-origin/.test(violation)));
  });

  it('fails when a document carries somebody’s build', async () => {
    const found = await afterEditing('index.html', (document) =>
      document.replace('</body>', '<a href="/outfitting#build=AbCdEf">Mine</a></body>'),
    );

    assert.ok(found.some((violation) => /states a build/.test(violation)));
  });

  it('fails when a head no longer matches what the address advertises', async () => {
    const found = await afterEditing('ships/Anaconda.html', (document) =>
      document.replace(/<title>[^<]*<\/title>/, '<title>Something else</title>'),
    );

    assert.ok(found.some((violation) => /states a title that is not/.test(violation)));
  });

  it('fails when a document opens with the wrong subject', async () => {
    const found = await afterEditing('ships/Anaconda.html', (document) =>
      document.replace(/<h1([^>]*)>Anaconda<\/h1>/, '<h1$1>Shipyard</h1>'),
    );

    assert.ok(found.some((violation) => /opens with "Shipyard"/.test(violation)));
  });

  it('fails when an advertised address answers with no document at all', async () => {
    const root = await copyOfOutput();
    try {
      await rm(join(root, 'ships/Vulture.html'));

      const found = await prerenderedDocumentViolations(root);

      assert.ok(found.some((violation) => /answers with no document/.test(violation)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when the content-free shell is missing', async () => {
    // Without it the service worker's navigation fallback and `404.html` have
    // no file, and every repeat visit would fall back to a document that
    // states one address's content (address-set.md §3).
    const root = await copyOfOutput();
    try {
      await rm(join(root, 'index.csr.html'));

      const found = await prerenderedDocumentViolations(root);

      assert.ok(found.some((violation) => /content-free shell is missing/.test(violation)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when a head-only address gains a body', async () => {
    // Which would mean the routes file grew an address nobody ruled on.
    const found = await afterEditing('outfitting.html', (document) =>
      document.replace('<app-root></app-root>', '<app-root><h1>Build</h1></app-root>'),
    );

    assert.ok(found.some((violation) => /recorded as having no content/.test(violation)));
  });
});
