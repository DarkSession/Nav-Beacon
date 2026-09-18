/**
 * The 500-character promise, checked against the table this repository ships.
 *
 * FR-021 bounds a complete codec value at 500 characters including its `b.`
 * prefix. That bound is only meaningful for the worst build a Commander can
 * actually make: the installed hull with the most mounts, every one of them
 * filled, every one engineered, both labels at their length limit and every
 * identity reached through its widest index. This prices exactly that build
 * against the committed table, so a table regeneration that would push a real
 * build past the envelope fails here rather than at the moment someone tries
 * to share one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEC_TABLE_CAPACITY,
  assertCapacityWithinCodecLimits,
  assertTableWithinCapacity,
  codecTableDimensions,
  envelopeBodyBytes,
  readCodecConstants,
  worstCaseBodyBits,
} from './build-link-codec-capacity.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const table = JSON.parse(
  await readFile(resolve(ROOT, 'src/app/domain/ships/build-link/codec-table-2.json'), 'utf8'),
);
const constants = await readCodecConstants();

/** The installed hulls with the most mounts, and how many that is. */
function widestHulls() {
  const counts = Object.entries(table.SLOTS_BY_SHIP).map(([ship, slots]) => [ship, slots.length]);
  const most = counts.reduce((largest, [, count]) => Math.max(largest, count), 0);
  return { most, ships: counts.filter(([, count]) => count === most).map(([ship]) => ship) };
}

describe('the link envelope, against the committed table', () => {
  it('prices the widest installed hull rather than a typical one', () => {
    const { most, ships } = widestHulls();

    assert.ok(ships.length > 0, 'the table carries no hull with any mounts');
    // The dimension the budget is priced against is the real maximum, not an
    // assumption about which hull happens to be the largest this release.
    assert.equal(codecTableDimensions(table).SLOTS_PER_SHIP, most);
    assert.ok(
      most <= CODEC_TABLE_CAPACITY.SLOTS_PER_SHIP,
      `${ships.join(', ')} carries ${most} mounts, beyond the budgeted ${CODEC_TABLE_CAPACITY.SLOTS_PER_SHIP}`,
    );
  });

  it('keeps that hull, fully fitted and fully engineered, inside 500 characters', () => {
    const bits = worstCaseBodyBits(codecTableDimensions(table), constants.maxStringUnits);
    const bytes = Math.ceil(bits / 8);
    const limit = envelopeBodyBytes(constants.maxLinkCharacters);

    assert.equal(constants.maxLinkCharacters, 500);
    assert.ok(
      bytes <= limit,
      `the largest build the committed table can express needs ${bytes} bytes, beyond the ${limit} ` +
        `a ${constants.maxLinkCharacters}-character value carries`,
    );
  });

  it('keeps the same promise once the table grows to its budgeted capacity', () => {
    // The budget is a promise about growth, not only about today's table: a new
    // release adding hulls and modules must not silently spend the envelope.
    const bytes = Math.ceil(worstCaseBodyBits(CODEC_TABLE_CAPACITY, constants.maxStringUnits) / 8);

    assert.ok(bytes <= envelopeBodyBytes(constants.maxLinkCharacters));
  });

  it('passes the repository’s own capacity assertions', () => {
    assertCapacityWithinCodecLimits();
    assert.deepEqual(codecTableDimensions(table), assertTableWithinCapacity(table));
  });
});
