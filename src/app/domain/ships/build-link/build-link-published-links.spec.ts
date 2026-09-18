import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildLinkCodecTables } from './build-link-codec';
import { createBuildLinkCodec } from './build-link-codec';
import {
  CURRENT_TABLE_VERSION,
  decodeBuildLinkFragment,
  encodeBuildLinkFragment,
} from './build-link-codec-loader';
import { minimalState } from './build-link-codec.spec-helpers';
import codecTable1Json from './codec-table-1.json';
import codecTable2Json from './codec-table-2.json';
import publishedLinks from './published-build-links.fixture.json';

/**
 * The table every corpus version is read against, keyed by the version a link names.
 *
 * Minting a table adds a row here and a version to the corpus. The first test below fails
 * until both arrive, which is what keeps an earlier table from quietly falling out of use.
 */
const TABLE_BY_VERSION: Readonly<Record<string, BuildLinkCodecTables>> = {
  1: codecTable1Json as BuildLinkCodecTables,
  2: codecTable2Json as BuildLinkCodecTables,
};

const corpus = Object.entries(publishedLinks).map(([version, entries]) => ({
  version: Number(version),
  entries,
}));

/**
 * Which mount holds which package variant, by the blueprint the package identifies it from.
 *
 * `minimalState` reads a module's blueprint and grade, and a package variant's blueprint and grade
 * are usually craftable as ordinary engineering too. A decode that lost the variant and left the
 * ordinary roll behind would therefore project the same state, so the identity is read separately.
 */
function variantsOf(build: ShipLoadout): Record<string, string> {
  return Object.fromEntries(
    build
      .fittedModules()
      .filter((module) => module.preEngineeredVariant !== null)
      .map((module) => [module.slot.toLowerCase(), module.preEngineeredVariant!.blueprintSymbol])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Links that have been out in the world, and the builds they have to keep opening.
 *
 * A build link is a promise with no expiry: a Commander who saved one opens it against the
 * table that wrote it, however many tables have been minted since. The corpus is how that
 * promise is tested rather than asserted — every entry is a real fragment, pinned to the build
 * it was shared as, and nothing removes one.
 */
describe('published build links', () => {
  it('holds links for every table version a link can name', () => {
    const versions = corpus.map(({ version }) => version).sort((left, right) => left - right);

    expect(versions).toEqual(
      Array.from({ length: CURRENT_TABLE_VERSION }, (_unused, index) => index + 1),
    );
    expect(
      Object.keys(TABLE_BY_VERSION)
        .map(Number)
        .sort((left, right) => left - right),
    ).toEqual(versions);
    for (const { entries } of corpus) expect(entries.length).toBeGreaterThan(0);
  });

  it('opens every published link on the build it was shared as', async () => {
    for (const { version, entries } of corpus) {
      // Read twice: once the way the application reads an arriving link, which picks the table
      // from the payload itself, and once against the table the corpus files the link under. The
      // second is what proves the entry is filed where it belongs, and that the table it names is
      // still the one that made it.
      const pinned = createBuildLinkCodec(version, TABLE_BY_VERSION[version]!);

      for (const { fragment, opensTo, variants } of entries) {
        const build = await decodeBuildLinkFragment(fragment);

        expect(minimalState(build)).toEqual(opensTo);
        expect(variantsOf(build)).toEqual(variants);
        expect(minimalState(pinned.decodeBuildLinkFragment(fragment))).toEqual(opensTo);
      }
    }
  });

  it('rewrites every published link with the current table on the same build', async () => {
    // A link is allowed to arrive in an older format and leave in the newest one, which is what
    // the workspace does the moment an older link opens. What is not allowed is the build moving
    // on the way through.
    for (const { entries } of corpus) {
      for (const { fragment, opensTo, variants } of entries) {
        const rewritten = await encodeBuildLinkFragment(await decodeBuildLinkFragment(fragment));
        const reread = await decodeBuildLinkFragment(rewritten);

        expect(minimalState(reread)).toEqual(opensTo);
        expect(variantsOf(reread)).toEqual(variants);
      }
    }
  });
});
