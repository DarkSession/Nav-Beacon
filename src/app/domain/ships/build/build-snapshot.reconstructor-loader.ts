import type { ShipLoadout } from '@elite-dangerous-almanac/core/ships/ship-loadout';
import type { BuildSnapshotV1 } from './build-snapshot';
import type { ReconstructionResult } from './build-snapshot.reconstructor';

/**
 * The reconstructor, reached without carrying the catalogue it reads.
 *
 * Every answer here is `build-snapshot.reconstructor`'s own, unchanged. What
 * this module adds is where the code behind it arrives. Reconstruction is
 * `ShipLoadout`, and `ShipLoadout` carries the complete outfitting catalogue —
 * three quarters of a megabyte of game data — so importing the reconstructor
 * puts that catalogue wherever the importer sits.
 *
 * A screen that fits modules is the right place for it. The shell is not, and
 * the record layer sits in the shell: the Commander account is mounted beside
 * the frame on every screen, and record exchange starts with the application
 * rather than with a screen (`app.ts`, `app.config.ts`). Reached through here,
 * the catalogue arrives with the first stored build something asks about, the
 * way the codec arrives with the first build link
 * (`ships/build-link/build-link-codec-loader.ts`). A Commander who signs in and
 * exchanges records pays for it; one who never does, never does.
 */
export async function reconstructFromSnapshot(
  snapshot: BuildSnapshotV1,
): Promise<ReconstructionResult> {
  const reconstructor = await import('./build-snapshot.reconstructor');
  return reconstructor.reconstructFromSnapshot(snapshot);
}

/** Whether the package fitted every module the snapshot named, where it named it. */
export async function fittedAsStored(
  snapshot: BuildSnapshotV1,
  loadout: ShipLoadout,
): Promise<boolean> {
  const reconstructor = await import('./build-snapshot.reconstructor');
  return reconstructor.fittedAsStored(snapshot, loadout);
}
