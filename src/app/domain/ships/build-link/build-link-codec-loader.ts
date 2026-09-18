import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildLinkCodec, BuildLinkCodecTables } from './build-link-codec';
import { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
import { decodeBuildLinkBody } from './build-link-payload';
import type { VerifiedBuildLinkBody } from './build-link-payload';

export { BuildLinkCodecError } from '../../build-link/build-link-codec-error';
export type { BuildLinkCodecErrorCode } from '../../build-link/build-link-codec-error';

/**
 * The table a new link is written with.
 *
 * Every table below it stays readable for as long as a link naming it can exist, which is
 * indefinitely: a Commander who saved a link last year opens it against the table that made
 * it. Raising this number is what a catalogue move costs, and it never edits an earlier table.
 */
export const CURRENT_TABLE_VERSION = 2;
const CODECS_BY_TABLE_VERSION = new Map<number, Promise<BuildLinkCodec>>();

/** Encode with the current table, loading the codec and table snapshot only when first used. */
export async function encodeBuildLinkFragment(loadout: ShipLoadout): Promise<string> {
  const codec = await loadCodec(CURRENT_TABLE_VERSION);
  return codec.encodeBuildLinkFragment(loadout);
}

/** Decode with the payload-declared table, loading only that immutable JSON snapshot. */
export async function decodeBuildLinkFragment(fragment: string): Promise<ShipLoadout> {
  const body = decodeBuildLinkBody(fragment);
  const tableVersion = readPayloadTableVersion(body);
  const codec = await loadCodec(tableVersion);
  return codec.decodeVerifiedBuildLinkBody(body);
}

function readPayloadTableVersion(body: VerifiedBuildLinkBody): number {
  if (body.length < 2) {
    throw new BuildLinkCodecError('invalidPayload', 'The build-link payload is truncated.');
  }
  return body[0]! | ((body[1]! & 0b11) << 8);
}

function loadCodec(tableVersion: number): Promise<BuildLinkCodec> {
  const cached = CODECS_BY_TABLE_VERSION.get(tableVersion);
  if (cached) return cached;
  const loading = createCodec(tableVersion).catch((error: unknown) => {
    CODECS_BY_TABLE_VERSION.delete(tableVersion);
    throw error;
  });
  CODECS_BY_TABLE_VERSION.set(tableVersion, loading);
  return loading;
}

async function createCodec(tableVersion: number): Promise<BuildLinkCodec> {
  const [codecModule, tables] = await Promise.all([
    import('./build-link-codec'),
    loadTables(tableVersion),
  ]);
  return codecModule.createBuildLinkCodec(tableVersion, tables);
}

async function loadTables(tableVersion: number): Promise<BuildLinkCodecTables> {
  switch (tableVersion) {
    case 1:
      return (await import('./codec-table-1.json')).default as BuildLinkCodecTables;
    case 2:
      return (await import('./codec-table-2.json')).default as BuildLinkCodecTables;
    default:
      throw new BuildLinkCodecError(
        'unsupportedTableVersion',
        `Build-link table version ${tableVersion} is not supported.`,
      );
  }
}
