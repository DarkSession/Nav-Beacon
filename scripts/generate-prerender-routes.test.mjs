import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prerenderRoutes } from './generate-prerender-routes.mjs';
import { HULL_PARENT, contentBearingAddresses } from './search/published-addresses.mjs';

/**
 * The list that decides which addresses answer with a body.
 *
 * `discoverRoutes: false` beside it in `angular.json` means this file is the
 * whole set: an address missing from it is an address that ships the empty
 * shell feature 015 exists to replace, and nothing about the build would say
 * so. The counts here are therefore against the package rather than against
 * literals, so a pin move cannot make this file wrong in a way a passing test
 * hides (015/FR-006, 015/SC-009).
 */
describe('the prerender routes file', () => {
  const ORIGIN = 'https://navbeacon.app';
  const addresses = contentBearingAddresses({ origin: ORIGIN });
  const lines = prerenderRoutes(addresses).trimEnd().split('\n');

  it('names one address per content-bearing address, and no other', () => {
    assert.equal(lines.length, addresses.filter((entry) => entry.contentBearing).length);
  });

  it('renders the root, the catalogue and every hull the package carries', () => {
    const hulls = addresses.filter((entry) => entry.path.startsWith(`${HULL_PARENT}/`));

    assert.ok(lines.includes('/'));
    assert.ok(lines.includes(`/${HULL_PARENT}`));
    assert.equal(lines.filter((line) => line.startsWith(`/${HULL_PARENT}/`)).length, hulls.length);
    for (const hull of hulls) {
      assert.ok(lines.includes(`/${hull.path}`), `${hull.path} is not rendered.`);
    }
  });

  it('renders neither bench', () => {
    assert.ok(!lines.includes('/outfitting'));
    assert.ok(!lines.includes('/equipment'));
  });

  it('writes the root as a slash rather than a blank line', () => {
    // The empty path spelled straight through would be an empty line, which
    // the builder reads as no route at all — so the root would silently keep
    // today's content-free `index.html` and nothing would fail.
    assert.equal(lines[0], '/');
    assert.ok(!lines.some((line) => line.length === 0));
  });

  it('gives every route a leading slash and no trailing one', () => {
    // The form the builder resolves against the base href. A trailing slash
    // would name a directory, and GitHub Pages answers a directory with a 301
    // (`contracts/address-set.md` §2).
    for (const line of lines) {
      assert.ok(line.startsWith('/'), `"${line}" has no leading slash.`);
      assert.ok(line === '/' || !line.endsWith('/'), `"${line}" names a directory.`);
    }
  });

  it('ends with a newline, so a route is never joined to the next', () => {
    assert.ok(prerenderRoutes(addresses).endsWith('\n'));
  });

  it('names no address twice', () => {
    assert.equal(new Set(lines).size, lines.length);
  });

  it('refuses to write a file that would render nothing', () => {
    // A build that rendered no address would exit 0 and publish 53 shells —
    // today's behaviour, wearing this feature's name and passing its head
    // assertions. Loud is the only acceptable failure here.
    assert.throws(
      () => prerenderRoutes(addresses.map((entry) => ({ ...entry, contentBearing: false }))),
      /nothing to render/,
    );
  });
});
