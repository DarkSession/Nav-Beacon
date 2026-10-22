#!/usr/bin/env node
/**
 * Holds every generated document to the package it was rendered from.
 *
 * Feature 015 renders 51 of the 53 advertised addresses at build time, so what
 * a crawler reads is a file rather than a frame. That file is written once and
 * then never looked at again — which is the whole problem. A component that
 * stops rendering a hull's mass lock, a formatter that starts rounding, a
 * publishing step that overwrites a body with a shell: each of those leaves a
 * build that exits 0, 52 addresses answering 200, and every head correct. None
 * of the existing gates compares a body to anything.
 *
 * So this one does, and it fails the build rather than letting a document that
 * has stopped matching the package be published (015/FR-020).
 *
 * **It is a script test rather than an end-to-end one** because the comparison
 * needs the package itself, which a browser cannot import — and because
 * `pnpm run test:scripts` already runs in CI, where the end-to-end production
 * suite is a separate job (`contracts/prerendered-document.md`).
 *
 * Run through `node --test`, like every other gate in this directory.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SHIPS } from '@elite-dangerous-almanac/core/ships/ships';
import {
  contentBearingAddresses,
  declaredOrigin,
  documentHead,
  hullAddressSegment,
} from './search/published-addresses.mjs';
import { SHELL, fileFor } from './publish-static-routes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where `ng build` leaves the application. */
export const OUTPUT = 'dist/navbeacon/browser';

/** The file that declares where this application is published. */
const ORIGIN_SOURCE = 'src/app/platform/browser/site-address.ts';

/** The catalogue a document carries before any bundle has run. */
const BUNDLED_ENGLISH = 'src/app/i18n/locales/en.json';

/**
 * A document, read the way a browser reads it.
 *
 * Parsed rather than pattern-matched. Every one of the readers below used to be
 * a regular expression over the file — `<script[\s\S]*?</script>`, `<[^>]+>`
 * and the rest — and each of them was wrong in a way that mattered here: an
 * attribute value holding a `>` ends a tag early, a comment opened `<!-->` is
 * closed immediately, and a document is 293 KB of exactly the markup those
 * cases live in. A parser is what knows; this gate exists to be believed, so it
 * asks one.
 *
 * `jsdom` rather than a browser, for the reason this whole file is a script
 * test: the comparison needs the package, and a browser cannot import it.
 */
let lastSource = null;
let lastParse = null;

/**
 * The document, parsed, with its scripts and styles already gone.
 *
 * One document at a time, remembered: the gate asks three questions of every
 * file — its text, its markup and its headings — and parsing 293 KB three times
 * over 52 files is twenty seconds a contributor waits for nothing.
 *
 * Scripts and styles are cut here rather than by each reader because no reader
 * below wants them. The bundle's own module preloads and Angular's serialized
 * transfer state both sit in the body, and reading either as content would let
 * a figure that appears nowhere a reader can see it satisfy every assertion in
 * this file.
 */
function parse(source) {
  if (source !== lastSource) {
    const parsed = new JSDOM(source).window.document;
    for (const raw of parsed.querySelectorAll('script, style')) {
      raw.remove();
    }
    lastParse = parsed;
    lastSource = source;
  }
  return lastParse;
}

/**
 * The same, for a reader that must find a body rather than be given one.
 *
 * A parser always produces a `<body>`, including for a file that declares none
 * — which is precisely the failure this gate is here to catch, a publishing
 * step that overwrote a document with something that has no body at all. So the
 * question is asked of the file before it is parsed.
 */
function parseBody(source) {
  if (!source.includes('<body')) {
    throw new Error('The document has no <body>.');
  }
  return parse(source).body;
}

/**
 * Everything under `root` that a reader would read, in document order.
 *
 * Text nodes joined by a space rather than `textContent`'s concatenation,
 * because a document puts a figure and its unit in separate elements: the
 * catalogue draws `220` and `m/s` as two spans, and run together they are
 * `220m/s`, which is a figure this gate would then report as missing from the
 * document that plainly states it. A word boundary is what an element boundary
 * is, so that is what it is read as. Comments carry no text and are never here.
 */
function readingOrderText(root) {
  const parts = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === child.TEXT_NODE) {
        parts.push(child.nodeValue ?? '');
      } else if (child.nodeType === child.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** A document's body, as a reader reads it. */
export function readableText(document) {
  return readingOrderText(parseBody(document));
}

/**
 * The same text with digit grouping removed, for comparing a figure to a number.
 *
 * The document states an Imperial Cutter's hull mass as `1,100 t`, because the
 * application groups thousands. That is presentation, which constitution IV
 * permits — it is altering a value that is forbidden — so the comparison has to
 * be insensitive to it while staying sensitive to everything else. Removing the
 * separator keeps this gate able to catch what it is for: a rounded figure
 * (`1.1 kt`), a substituted one, or a missing one all still fail.
 *
 * The separator is a comma because documents are bundled English and nothing
 * else (015/FR-011). A German document would group with a full stop, and there
 * is no German document to read.
 */
export function ungrouped(text) {
  return text.replace(/(\d),(?=\d{3}\b)/g, '$1');
}

/**
 * A document's body as markup.
 *
 * The prohibitions below are checked against this rather than against the
 * readable text, because most of what a document must not carry does not appear
 * as text at all: a build link is an `href`, a cross-origin request is a `src`.
 * Checking those against stripped text is a check that can never fail, which is
 * worse than no check — it reports "no violations" for a document it has not
 * looked at.
 */
export function bodyMarkup(document) {
  return parseBody(document).innerHTML;
}

/**
 * Every `<h1>` a document carries, in document order.
 *
 * No body is required. A caller may hand this a fragment, and a heading is a
 * heading wherever it is.
 */
export function headings(document) {
  return [...parse(document).querySelectorAll('h1')].map((heading) => readingOrderText(heading));
}

/**
 * The figures a hull's document has to state, as the package reports them.
 *
 * Presented, never re-derived: each value is the package's own, formatted the
 * way the rendered document formats it, and a figure this cannot find in the
 * document is a figure a reader cannot find either (015/FR-002, FR-004).
 *
 * Hardpoint sizes are the package's 1-4, which the document names as small,
 * medium, large and huge — the one place a value is translated rather than
 * printed, and it is a naming, not an arithmetic.
 */
const HARDPOINT_CLASS = { 1: 'Small', 2: 'Medium', 3: 'Large', 4: 'Huge' };

export function hullFigures(ship) {
  const counted = { Huge: 0, Large: 0, Medium: 0, Small: 0 };
  for (const mount of ship.hardpoints ?? []) {
    const name = HARDPOINT_CLASS[mount.size];
    if (name !== undefined) {
      counted[name] += 1;
    }
  }

  return [
    { what: 'manufacturer', find: ship.manufacturer },
    { what: 'maximum speed', find: `${ship.maximumSpeed} m/s` },
    { what: 'base shield', find: `${ship.baseShieldStrength} MJ` },
    { what: 'hull mass', find: `${ship.hullMass} t` },
    { what: 'crew', find: `Crew ${ship.crew}` },
    { what: 'mass lock', find: `Mass lock ${ship.masslock}` },
    ...Object.entries(counted)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({
        what: `${count} ${name.toLowerCase()} hardpoint${count === 1 ? '' : 's'}`,
        find: `${count} ${name}`,
      })),
  ];
}

/**
 * What a document must not contain, whatever else it says.
 *
 * Each of these is something a build knows and a published static file has no
 * business stating: a Commander's own work, or a value that belongs to the
 * deployment rather than to the address (015/FR-007, constitution I and 9.1.0).
 */
export function prohibitions(applicationVersion) {
  return [
    {
      what: 'the application version',
      // Stamped by CI immediately before `ng build`, so a body carrying it
      // bakes a CI-only value into static HTML (research decision 14).
      pattern: new RegExp(applicationVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    },
    {
      what: 'a build',
      // A build lives in the fragment and belongs to the Commander who made
      // it. One reaching a published file is Commander data in a static asset,
      // which is the thing constitution I forbids most plainly (015/FR-007,
      // FR-017).
      //
      // `&amp;` as well as `&`, because the markup this is checked against is a
      // parser's serialization and a parser writes a bare `&` in an attribute
      // back out escaped. A second query parameter would otherwise slip past a
      // gate that catches the first.
      pattern: /(?:[#?&]|&amp;)build=/,
    },
    {
      what: 'a shared build or loadout',
      // The two link codecs' own prefixes, as `build-link.spec.ts` and
      // `equipment-link.spec.ts` pin them. A build is a Commander's, and one
      // reaching a published file would be a Commander's work committed to this
      // repository by a build machine (015/FR-007, FR-017).
      pattern: /#(?:b|e)\.[A-Za-z0-9]/,
    },
    {
      what: 'a saved record',
      // Saved records live in this browser under `ednb:record:<id>` and are
      // never sent anywhere (constitution I). A document naming that prefix has
      // either serialized one or is about to be read as though it had.
      pattern: /ednb:record:/,
    },
    {
      what: 'a browsing session',
      // The catalogue's stored view is Commander data too — smaller, but the
      // same kind. The build knows no session and must not appear to
      // (015/FR-009a).
      pattern: /ednb:(?:catalogue|tab|update-applied)/,
    },
    {
      what: 'runtime environment configuration',
      // A document is a static asset, produced by the build from the pinned
      // package (constitution 9.1.0). A machine's own address baked into one is
      // configuration the deployment cannot change, and it is how a document
      // built on a contributor's laptop differs from the one CI publishes.
      pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|process\.env/,
    },
    {
      what: 'a cross-origin request',
      // `productionOutputViolations` already walks the whole output for these.
      // Repeated here because that check runs over files and this one runs per
      // address, so a violation names the document that carries it.
      pattern: /(?:src|href)\s*=\s*["']https?:\/\/(?!navbeacon\.app)/,
    },
  ];
}

/** Every violation in the built output, or an empty list. */
export async function prerenderedDocumentViolations(output) {
  const violations = [];
  const fail = (file, message) => violations.push(`${file}: ${message}`);

  const origin = declaredOrigin(await readFile(join(ROOT, ORIGIN_SOURCE), 'utf8'));
  const catalogue = JSON.parse(await readFile(join(ROOT, BUNDLED_ENGLISH), 'utf8'));
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const forbidden = prohibitions(version);
  const byName = new Map([...SHIPS].map((ship) => [hullAddressSegment(ship.name), ship]));

  const shell = join(output, SHELL);
  if (!existsSync(shell)) {
    fail(SHELL, 'The content-free shell is missing, so the navigation fallback has no file.');
    return violations;
  }

  for (const entry of contentBearingAddresses({ origin })) {
    const name = fileFor(entry.address, origin);
    const file = join(output, name);

    if (!existsSync(file)) {
      fail(name, `"${entry.address}" is advertised but answers with no document.`);
      continue;
    }

    const document = await readFile(file, 'utf8');
    const body = readableText(document);
    const figures = ungrouped(body);
    const markup = bodyMarkup(document);

    // 4. The head still matches what `documentHead` composes for this address.
    const head = documentHead(entry, catalogue, origin);
    if (!document.includes(`<title>${head.title}</title>`)) {
      fail(name, `states a title that is not "${head.title}".`);
    }
    if (!document.includes(`href="${head.canonical}"`)) {
      fail(name, `carries no canonical for ${head.canonical}.`);
    }

    // 3. Nothing prohibited, in any document, generated or not.
    for (const rule of forbidden) {
      if (rule.pattern.test(markup)) {
        fail(name, `states ${rule.what}, which a published document may not carry.`);
      }
    }

    if (!entry.contentBearing) {
      // 1's other half: a head-only address must stay head-only. A body here
      // means the routes file gained an address nobody ruled on.
      if (body.length > 0) {
        fail(name, 'carries a body, but is recorded as having no content to state.');
      }
      continue;
    }

    // 1. A content-bearing address has a document with something in it. An
    // empty `<app-root>` is the signature of the publishing step having
    // overwritten what the builder produced (address-set.md §5).
    if (body.length === 0) {
      fail(name, 'carries an empty body, so the shell was published over it.');
      continue;
    }

    // 5. The first heading names this address's subject.
    const [first] = headings(document);
    if (first === undefined) {
      fail(name, 'carries no <h1>, so a reader cannot tell what it is about.');
    }

    const ship = byName.get(name.replace(/^ships\//, '').replace(/\.html$/, ''));
    if (ship === undefined) {
      continue;
    }

    if (first !== ship.name) {
      fail(name, `opens with "${first}" rather than with "${ship.name}".`);
    }

    // 2. Every figure the contract names, as the package reports it.
    for (const figure of hullFigures(ship)) {
      if (!figures.includes(figure.find)) {
        fail(name, `states no ${figure.what} — expected "${figure.find}".`);
      }
    }
  }

  return violations;
}

async function main() {
  const output = join(ROOT, process.argv[2] ?? OUTPUT);
  const violations = await prerenderedDocumentViolations(output);

  if (violations.length > 0) {
    console.error('prerendered documents: violations');
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('prerendered documents: every document matches the package');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
