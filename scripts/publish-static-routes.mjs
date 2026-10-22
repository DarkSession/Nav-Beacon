#!/usr/bin/env node
/**
 * Writes the document each published address answers with.
 *
 * Two mechanisms, because they answer different callers. `404.html` catches
 * every address, which is what a Commander following a deep link needs — but
 * GitHub Pages serves it with a 404 status, and a crawler drops a 404 whatever
 * the body says, canonical link included. So every address the sitemap
 * advertises is also written as a file that answers 200.
 *
 * `<address>.html`, not `<address>/index.html`. Pages serves `/ships` from
 * `ships.html` with a 200 and no redirect; from a directory it answers 301 to
 * `/ships/`, which would make the address the sitemap and the canonical both
 * advertise the one address that does not answer.
 *
 * The copy is not byte for byte. A document that kept the root's canonical,
 * card and title would tell a crawler to index `/` instead — the same outcome
 * the 404 status had, reached a different way. Each address's document carries
 * its own canonical, `og:url`, title, description and card image, resolved in
 * bundled English from the same catalogue the running application resolves them
 * from. Every substitution is checked rather than assumed, because a silent
 * no-op here looks exactly like a published address.
 *
 * **What the head is applied to changed with feature 015.** Until then there was
 * one template — the built `index.html` — copied to all 53 addresses, which was
 * harmless because every body was an empty `<app-root>`. The build now renders a
 * body for the 51 content-bearing addresses, and copying a shell over them would
 * overwrite every one: a build that passes every head assertion here and ships
 * nothing. So the template is per address — that address's own rendered document
 * — and only the two head-only addresses are still written from the shell
 * (`contracts/address-set.md` §5).
 *
 * **The shell is `index.csr.html` now, not `index.html`.** `index.html` is the
 * root's rendered document, because GitHub Pages resolves `/` to that file and
 * to no other. So the content-free shell Angular emits beside it is what
 * `404.html` is copied from, and what the two benches are written from. A
 * `404.html` still copied from `index.html` would answer every unmatched
 * address with the start page's content (address-set.md §3).
 *
 * It reads the sitemap through `readSitemap`, the same function the policy
 * checker reads it through, so there is no second spelling of the cut for the
 * two to disagree over. Being a script rather than a deployment step also puts
 * what a crawler is served under `pnpm run test:scripts` and under the
 * production journey, where it can be run twice.
 *
 *   node scripts/publish-static-routes.mjs [output directory]
 */
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentBearingAddresses,
  declaredOrigin,
  documentHead,
  readSitemap,
} from './search/published-addresses.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where `ng build` leaves the application. */
export const DEFAULT_OUTPUT = 'dist/navbeacon/browser';

/** The file that declares where this application is published. */
const ORIGIN_SOURCE = 'src/app/platform/browser/site-address.ts';

/** The catalogue a document carries before any bundle has run. */
const BUNDLED_ENGLISH = 'src/app/i18n/locales/en.json';

/**
 * The addresses a sitemap advertises, or a refusal naming why it cannot be read.
 *
 * `readSitemap` is shared with the policy checker so the two cannot read one
 * file differently. Here a defect is fatal: a map this cannot read is a map the
 * gate read some other way, and publishing from it would write files for
 * addresses nobody advertised.
 */
export function advertisedAddresses(sitemap) {
  const { addresses, defect } = readSitemap(sitemap);
  if (defect !== null) {
    throw new Error(`sitemap.xml cannot be published from. ${defect}`);
  }
  return addresses;
}

/**
 * An attribute value, with the four characters that would end it escaped.
 *
 * What escapes it has to reach the document unread. Every substitution below
 * therefore passes a function to `String.replace` rather than a replacement
 * string: in a replacement string `$&`, `` $` ``, `$'` and `$1`-`$9` are
 * expanded after this has run, which splices the matched markup — quotes and
 * all — back in behind the escaping. A value holding one is not hypothetical:
 * it is a message somebody translates or a name a package pin move introduces.
 * `src/app/i18n/locale-registry.ts` keeps the same rule for the same reason.
 */
export function attribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Text between tags, with the two characters that would open one escaped. */
export function text(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Replaces the `content` of one `<meta>`, or refuses.
 *
 * Refuses rather than adds. `index.html` ships every tag this rewrites, so a
 * miss means the head has changed shape and the substitution that was supposed
 * to carry this address's identity did nothing — which looks, in the output
 * directory, exactly like a published address.
 */
export function withMeta(document, attributeName, key, value) {
  const tag = new RegExp(
    `(<meta\\b[^>]*?\\b${attributeName}\\s*=\\s*(["'])${key}\\2[^>]*?\\bcontent\\s*=\\s*")[\\s\\S]*?(")`,
  );
  if (!tag.test(document)) {
    throw new Error(`The head carries no <meta ${attributeName}="${key}"> to rewrite.`);
  }
  return document.replace(
    tag,
    (_whole, opening, _quote, closing) => `${opening}${attribute(value)}${closing}`,
  );
}

/** Replaces the canonical link's address, or refuses. */
export function withCanonical(document, address) {
  const tag = /(<link\b[^>]*?\brel\s*=\s*(["'])canonical\2[^>]*?\bhref\s*=\s*")[^"]*(")/;
  if (!tag.test(document)) {
    throw new Error('The head declares no canonical link to rewrite.');
  }
  return document.replace(
    tag,
    (_whole, opening, _quote, closing) => `${opening}${attribute(address)}${closing}`,
  );
}

/** Replaces the document title, or refuses. */
export function withTitle(document, title) {
  const tag = /(<title>)[\s\S]*?(<\/title>)/;
  if (!tag.test(document)) {
    throw new Error('The head carries no <title> to rewrite.');
  }
  return document.replace(tag, (_whole, opening, closing) => `${opening}${text(title)}${closing}`);
}

/** One address's document, built from the root's. */
export function documentFor(index, head) {
  let document = withTitle(index, head.title);
  document = withCanonical(document, head.canonical);
  document = withMeta(document, 'name', 'description', head.description);
  document = withMeta(document, 'property', 'og:description', head.description);
  document = withMeta(document, 'name', 'twitter:description', head.description);
  document = withMeta(document, 'property', 'og:title', head.title);
  document = withMeta(document, 'name', 'twitter:title', head.title);
  document = withMeta(document, 'property', 'og:url', head.canonical);
  document = withMeta(document, 'property', 'og:image', head.image);
  document = withMeta(document, 'property', 'og:image:alt', head.imageAlt);
  document = withMeta(document, 'name', 'twitter:image', head.image);
  return document;
}

/**
 * The path a published address is written to, relative to the output.
 *
 * An address below the root is a file below the root — `/ships/Anaconda`
 * becomes `ships/Anaconda.html` — because that is an address, not a directory
 * redirect. The root itself is `index.html`, which is the file that answers it.
 */
export function fileFor(address, origin) {
  const route = address.startsWith(`${origin}/`) ? address.slice(origin.length + 1) : null;
  if (route === null) {
    throw new Error(`"${address}" is not an address under ${origin}.`);
  }
  // The root is served from `index.html` — there is no other file it could be,
  // and a directory document would answer 301 to itself. It goes through the
  // same head substitution as every other address rather than being skipped, so
  // the committed file is held to the same message keys the running application
  // resolves.
  if (route.length === 0) {
    return 'index.html';
  }
  if (route.endsWith('/')) {
    throw new Error(`"${route}" ends in a slash, so it names a directory rather than an address.`);
  }
  return `${route}.html`;
}

/**
 * The content-free shell, and where it lives in the built output.
 *
 * Angular writes it as `index.csr.html` once the root is prerendered, because
 * `index.html` is then the root's own document. Three things read it: this
 * script for `404.html` and the two head-only addresses, and the service
 * worker for its navigation fallback (`ngsw-config.json`).
 */
export const SHELL = 'index.csr.html';

/**
 * Where the builder leaves the document it rendered for one address.
 *
 * Angular's prerenderer writes `<route>/index.html` unconditionally
 * (`@angular/build`, `prerender.js`), which is the layout this deployment
 * cannot publish: GitHub Pages answers a directory with a 301. The root is
 * already `index.html` and stays there; everything else is moved to
 * `<address>.html` by the loop below (research decision 4, address-set.md §2).
 */
export function renderedFileFor(address, origin) {
  const file = fileFor(address, origin);
  return file === 'index.html' ? file : `${file.slice(0, -'.html'.length)}/index.html`;
}

/**
 * Removes directories the builder's layout left behind, deepest first.
 *
 * A directory that still holds something is kept, so this cannot remove an
 * asset directory: only the `ships/Anaconda/` shapes whose single `index.html`
 * has just been republished as `ships/Anaconda.html` disappear.
 */
export async function pruneEmptyDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let remaining = entries.length;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (await pruneEmptyDirectories(join(directory, entry.name))) {
      remaining -= 1;
    }
  }

  if (remaining === 0) {
    await rm(directory, { recursive: true, force: true });
    return true;
  }
  return false;
}

async function main() {
  const output = join(ROOT, process.argv[2] ?? DEFAULT_OUTPUT);

  const origin = declaredOrigin(await readFile(join(ROOT, ORIGIN_SOURCE), 'utf8'));
  const catalogue = JSON.parse(await readFile(join(ROOT, BUNDLED_ENGLISH), 'utf8'));
  const shell = await readFile(join(output, SHELL), 'utf8');
  const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8');

  // Every address the map advertises has to answer, and every address that
  // answers has to be one this application serves. The known set is built from
  // the same module the map was, so the only way the two disagree is a sitemap
  // edited by hand. It carries the content-bearing verdict, so which template
  // an address is written from is read from one place rather than inferred here
  // (015/FR-021).
  const known = new Map(contentBearingAddresses({ origin }).map((entry) => [entry.address, entry]));

  // Before the loop, and from the shell rather than from any address's
  // document. Pages serves this for every address it cannot match, so a body
  // here is a body served under every address at once.
  await writeFile(join(output, '404.html'), shell, 'utf8');

  let published = 0;
  let generated = 0;
  for (const address of advertisedAddresses(sitemap)) {
    const entry = known.get(address);
    if (entry === undefined) {
      throw new Error(`"${address}" is advertised but is not an address this application serves.`);
    }

    const rendered = join(output, renderedFileFor(address, origin));
    let template = shell;
    if (entry.contentBearing) {
      // Read rather than defaulted. A content-bearing address whose document
      // the build did not produce must fail here: falling back to the shell
      // would publish an empty body under a correct head, which is precisely
      // what this feature exists to stop and precisely what no other check
      // would notice (015/FR-021, address-set.md §5).
      try {
        template = await readFile(rendered, 'utf8');
      } catch {
        throw new Error(
          `"${address}" carries content but the build rendered no document for it. ` +
            `Expected ${renderedFileFor(address, origin)}. ` +
            'Publishing the shell instead would ship an empty body under a correct head.',
        );
      }
      generated += 1;
    }

    const file = join(output, fileFor(address, origin));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, documentFor(template, documentHead(entry, catalogue, origin)), 'utf8');

    // The file the builder wrote goes once its content has been published to
    // the address's own name. Left behind, Pages would resolve `/ships` to
    // `ships/` with a 301 rather than to `ships.html` with a 200 — the redirect
    // this whole layout exists to avoid.
    //
    // The *file*, never its directory: `ships/` holds the 49 hull documents as
    // well as the catalogue's own `index.html`, and `ships` is published before
    // any hull is. Removing the directory here deletes 49 documents that have
    // not been written yet, and the build still exits 0. The empty directories
    // are pruned after the loop instead, when there is nothing left to lose.
    if (rendered !== file) {
      await rm(rendered, { force: true });
    }

    published += 1;
  }

  await pruneEmptyDirectories(output);

  console.log(
    `Published ${published} addresses as documents that answer 200, ` +
      `${generated} of them carrying a rendered body, beside 404.html.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
