#!/usr/bin/env node
/**
 * Writes the list of addresses the build renders a document for.
 *
 * `prerender.routesFile` in `angular.json` names this file, and
 * `discoverRoutes: false` beside it means this list is the whole set: the
 * builder renders these addresses and no others. So what is written here
 * decides, exactly, which of the 53 advertised addresses answer with a body.
 *
 * **Derived, never listed.** The addresses come from `contentBearingAddresses`,
 * which is `publishedAddresses` — the same function the sitemap is written from
 * — with feature 015's content-bearing verdict attached. A hull that arrives
 * with a pin move arrives here with nothing to remember, and a hull that leaves
 * leaves (constitution II, 015/FR-006, 015/SC-009).
 *
 * **Not committed, deliberately.** It is a build input regenerated on every
 * build, so it cannot drift from the address list the way a committed file
 * could. The sitemap stays committed for the opposite reason: a hull arriving
 * or leaving should show up in review, and that is the file where it does.
 *
 * It is written outside the builder's own output directory, because `ng build`
 * empties that before it reads anything.
 *
 * The builder joins each line with the configured `baseHref`, so the sub-path
 * preview build needs no separate handling here.
 *
 *   node scripts/generate-prerender-routes.mjs [output file]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentBearingAddresses, declaredOrigin } from './search/published-addresses.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The file that declares where this application is published. */
const ORIGIN_SOURCE = 'src/app/platform/browser/site-address.ts';

/** Where the builder is told to look for it. */
export const DEFAULT_ROUTES_FILE = 'dist/prerender-routes.txt';

/**
 * The routes file's content for one address list.
 *
 * A leading slash on each, which is the form the builder resolves against the
 * base href. The root is `/` rather than the empty string, which would be a
 * blank line the builder reads as no route at all.
 */
export function prerenderRoutes(addresses) {
  const routes = addresses.filter((entry) => entry.contentBearing).map((entry) => `/${entry.path}`);

  if (routes.length === 0) {
    // A build that rendered nothing would still exit 0 and publish 52 shells,
    // which is today's behaviour wearing this feature's name. Refuse instead.
    throw new Error('No content-bearing addresses, so there is nothing to render.');
  }

  return `${routes.join('\n')}\n`;
}

async function main() {
  const origin = declaredOrigin(await readFile(join(ROOT, ORIGIN_SOURCE), 'utf8'));
  const file = join(ROOT, process.argv[2] ?? DEFAULT_ROUTES_FILE);
  const content = prerenderRoutes(contentBearingAddresses({ origin }));

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');

  const count = content.trimEnd().split('\n').length;
  console.log(`Wrote ${count} addresses to render, derived from the installed package.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
