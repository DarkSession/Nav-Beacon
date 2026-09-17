#!/usr/bin/env node
/**
 * Repository policy checks for feature 007's own source.
 *
 * Weapon output and the weapons capacitor are two package answers this
 * application shows and does not have. Every rule here is about a way that
 * could stop being true without anything failing: a second call site would
 * still return a plausible damage figure, a division of two package amounts
 * would still print a percentage, an `Infinity` handed to a formatter would
 * still render something, and a deep import would still compile. None of them
 * can be a type or a unit test — a rule proven by the absence of a line has no
 * call site to test. Exit code 0 means every rule passed; a violation prints
 * its file, line and reason.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ARITHMETIC, ROOT, filesUnder, runPolicy, runRules, scan } from './common.mjs';

/** The one place that may ask the package about weapons or the capacitor. */
export const PROJECTION = 'src/app/domain/ships/offence';

/** Feature 007's own source. The import rule applies inside these. */
export const OWNED = [
  PROJECTION,
  'src/app/features/build-workspace/outfitting/offence-analysis',
  'src/app/features/build-workspace/outfitting/offence-summary',
];

/** Everything the rules read, so a new consumer is found wherever it is added. */
export const SCOPE = ['src/app'];

/**
 * The leaf subpaths this capability may import.
 *
 * The package publishes its data as one module per subject and the application
 * imports the leaf rather than a barrel, so a build carries the subjects this
 * screen reads instead of the whole almanac (constitution II).
 *
 * Only the subjects this capability actually reads. `ships/ammunition` was
 * listed before and is not: every ammunition field is on the list no canvas
 * draws, so allowing the subpath here would pre-authorise the one import this
 * rule exists to catch.
 */
export const ALLOWED_SUBPATHS = [
  '@elite-dangerous-almanac/core/ships/ship-loadout',
  // Almanac 0.2.0 moved every calculation off `ShipLoadout` and onto
  // `BuildMetrics`, which is a leaf of its own. The loadout subpath stays: it
  // is still what holds and edits the build.
  '@elite-dangerous-almanac/core/ships/build-metrics',
  '@elite-dangerous-almanac/core/ships/weapons',
  '@elite-dangerous-almanac/core/ships/weapons-capacitor',
  '@elite-dangerous-almanac/core/ships/modules',
  '@elite-dangerous-almanac/core/ships/gunsights',
  '@elite-dangerous-almanac/core/ships/ships',
  '@elite-dangerous-almanac/core/ships/slots',
];

/** Any import of the package, so a barrel or an unlisted subpath is caught too. */
export const ALMANAC_IMPORT = /from\s+(['"])(@elite-dangerous-almanac\/core[^'"]*)\1/;

/**
 * The package answers this capability is made of.
 *
 * Damage at range and shot convergence are package calculations like the other
 * two — `damageFalloff` attenuates one weapon's damage and `projectGunsight`
 * places one hull's hardpoints — so they are confined to the projection for the
 * same reason: a second call site is a second opinion nothing reconciles.
 */
export const PACKAGE_CALLS = [
  'weaponMetrics(',
  'weaponsCapacitorMetrics(',
  'damageFalloff(',
  'projectGunsight(',
  'getShipGunsight(',
];

/**
 * The package fields that are measured rather than counted.
 *
 * A slot key, a symbol and an enabled flag are identities. These are
 * measurements: damage, energy, heat, distance, piercing, megajoules and
 * seconds. Combining any two of them makes a figure the Almanac did not
 * publish — a share, a percentage, an alpha strike or a target result — which
 * is the one thing this application is never allowed to show (constitution II
 * and IV), and is exactly what the canvas's own `· 67%` legend is.
 *
 * `clipSize` and `hopper` are on the list although this capability's allow-list
 * excludes the ammunition subject: the import rule covers this feature's own
 * source, and this rule also reads every file elsewhere that consumes the
 * projection, where an ammunition figure could arrive by another route.
 */
export const FIGURE_FIELDS = [
  'damagePerShot',
  'damagePerSecond',
  'sustainedDamagePerSecond',
  'energyPerSecond',
  'sustainedEnergyPerSecond',
  'heatPerSecond',
  'sustainedHeatPerSecond',
  'thermalLoad',
  'powerDraw',
  'rateOfFire',
  'sustainedRateOfFire',
  'kinetic',
  'thermal',
  'explosive',
  'caustic',
  'absolute',
  'antiXeno',
  'unclassified',
  'maximumRange',
  'falloffRange',
  'armourPiercing',
  'maximumBoundary',
  'falloffBoundary',
  'capacity',
  'rechargeRate',
  'clipSize',
  'hopper',
];

/** One of those fields, read off something. */
const FIGURE_READ = new RegExp(`\\.(?:${FIGURE_FIELDS.join('|')})\\b`);

/**
 * The package sentinel, named literally outside the projection.
 *
 * `Infinity` is what the weapons capacitor's `timeToDrain` returns where the
 * recharge keeps pace, and it means something a number cannot say. The
 * projection turns it into a named state; a surface that tested for the
 * sentinel itself would be re-deciding, in a template, a meaning the projection
 * already settled — and a surface that handed it to a formatter would print a
 * raw `Infinity` where the canvas's own glyph belongs (FR-007,
 * `data-model.md`). Both spellings are matched, because the second is the same
 * value written the long way.
 */
export const SENTINEL = /(?<![.\w])Infinity\b|Number\.POSITIVE_INFINITY/;

const isOwned = (name) => OWNED.some((owned) => name.startsWith(owned));
const isProjection = (name) => name.startsWith(PROJECTION);

/**
 * The Almanac specifiers one source imports, with their line numbers.
 *
 * The rules below call this rather than re-deriving it, so the code the suite
 * exercises is the code the gate enforces.
 */
export function almanacImportSites(source) {
  return scan(source, (text) => ALMANAC_IMPORT.exec(text)?.[2] ?? null);
}

/** Just the specifiers, for a caller that does not need the lines. */
export function almanacImports(source) {
  return almanacImportSites(source).map(({ hit }) => hit);
}

/** The package call sites in one source, with their line numbers. */
export function packageCallSites(source) {
  return scan(source, (text) => PACKAGE_CALLS.find((call) => text.includes(call)));
}

/** Just the calls, for a caller that does not need the lines. */
export function packageCalls(source) {
  return packageCallSites(source).map(({ hit }) => hit);
}

/** The lines where one source combines two package figures. */
export function combinedFigures(source) {
  return scan(source, (text) => FIGURE_READ.test(text) && ARITHMETIC.test(text));
}

/** The lines where one source names a package sentinel itself. */
export function sentinelReads(source) {
  return scan(source, (text) => SENTINEL.test(text));
}

const RULES = [
  {
    name: 'the Almanac is reached through its leaf subpaths',
    async run(violations) {
      for (const name of await filesUnder(OWNED, ['.ts'])) {
        const source = await readFile(resolve(ROOT, name), 'utf8');
        for (const { line, hit } of almanacImportSites(source)) {
          if (ALLOWED_SUBPATHS.includes(hit)) {
            continue;
          }
          violations.push({
            file: name,
            line,
            reason: `"${hit}" is not one of this capability's leaf subpaths; a barrel import pulls the whole almanac into the bundle and an unlisted subject is a capability nobody specified`,
          });
        }
      }
    },
  },
  {
    name: 'one place asks the package',
    async run(violations) {
      for (const name of await filesUnder(SCOPE, ['.ts', '.html'])) {
        if (isProjection(name)) {
          continue;
        }
        const source = await readFile(resolve(ROOT, name), 'utf8');
        for (const { line, hit } of packageCallSites(source)) {
          violations.push({
            file: name,
            line,
            reason: `"${hit.slice(0, -1)}" is asked outside ${PROJECTION}; both surfaces read one projection of one answer, and a second call site is a second opinion nothing reconciles (FR-001)`,
          });
        }
      }
    },
  },
  {
    name: 'no figure is combined with another',
    async run(violations) {
      for (const name of await filesUnder(SCOPE, ['.ts', '.html'])) {
        if (isProjection(name)) {
          continue;
        }
        const source = await readFile(resolve(ROOT, name), 'utf8');
        if (!isOwned(name) && !source.includes('domain/ships/offence')) {
          continue;
        }
        for (const { line } of combinedFigures(source)) {
          violations.push({
            file: name,
            line,
            reason:
              'a package figure is arithmetically combined; a damage share, a percentage, an alpha strike or a target result this application worked out is this application claiming a value the Almanac did not publish (FR-001, FR-002, FR-003)',
          });
        }
      }
    },
  },
  {
    name: 'no surface reads a package sentinel itself',
    async run(violations) {
      for (const name of await filesUnder(OWNED, ['.ts', '.html'])) {
        if (isProjection(name)) {
          continue;
        }
        const source = await readFile(resolve(ROOT, name), 'utf8');
        for (const { line } of sentinelReads(source)) {
          violations.push({
            file: name,
            line,
            reason: `an infinity is named outside ${PROJECTION}; a recharge that keeps pace is a state the projection already decided, and a surface that re-decides it can print a raw "Infinity" where the canvas's glyph belongs (FR-007)`,
          });
        }
      }
    },
  },
];

/** Re-exported for this feature's own suite, which asserts the reading directly. */
export { scan };

export const check = () => runRules(RULES);

await runPolicy('offence ownership policy', check, import.meta.url);
