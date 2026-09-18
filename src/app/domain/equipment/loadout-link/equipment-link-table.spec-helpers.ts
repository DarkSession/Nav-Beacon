import type { EquipmentLinkCodecTables } from './equipment-link-codec';
import table from './equipment-link-table-1.json';

/**
 * A table for a version this application does not publish.
 *
 * Version selection has nothing to select between while one table is committed,
 * and a second committed table is a package upgrade rather than a test fixture.
 * This is table 1's content under another version number, which is enough to
 * drive the selection: the loader picks by the number the payload names, and
 * what the chosen table holds is the codec's business, not the loader's.
 */
export function testOnlyEquipmentTable(tableVersion: number): EquipmentLinkCodecTables {
  return { ...table, $generated: { ...table.$generated, tableVersion } };
}
