import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const tableDirectoryPath = 'src/app/domain/equipment/loadout-link';
const tableFileName = 'equipment-link-table-1.json';
const committedTablePath = join(repositoryRoot, tableDirectoryPath, tableFileName);

/** The generator's own payload hash, so the table is checked the way it was written. */
const canonicalise = (value) => {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
};
const contentHashOf = (payload) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalise(payload)))
    .digest('hex');

/**
 * A tree the generator resolves its own table from.
 *
 * The output path is fixed beside the script, so the table this generator would write can only be
 * moved by moving the script. Its scripts are copied rather than linked, because Node reports a
 * symlinked module at its real path and the copy would have read the repository's own table.
 */
const treeWithGenerator = async (t, prefix) => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, tableDirectoryPath), { recursive: true });
  await cp(join(repositoryRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
  for (const name of ['node_modules', 'package.json']) {
    await symlink(join(repositoryRoot, name), join(root, name));
  }
  return root;
};

const runGenerator = (root) =>
  spawnSync(process.execPath, [join(root, 'scripts/generate-equipment-link-codec-tables.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });

test('the committed table still holds the content its declared hash names', async () => {
  const { $generated: generated, ...payload } = JSON.parse(
    await readFile(committedTablePath, 'utf8'),
  );

  assert.equal(generated.tableVersion, 1);
  assert.equal(generated.contentHash, contentHashOf(payload));
});

test('refuses to run at all once the published table has been edited', async (t) => {
  const root = await treeWithGenerator(t, 'ednb-equipment-edited-');
  const tablePath = join(root, tableDirectoryPath, tableFileName);

  // The hash the file declares travels with an edit, so a check that read it back would accept
  // this table and write over it in silence. Hashing the payload is what catches the edit.
  const table = JSON.parse(await readFile(committedTablePath, 'utf8'));
  table.SUITS = [...table.SUITS, 'TamperedSuit'];
  const tamperedContent = `${JSON.stringify(table)}\n`;
  await writeFile(tablePath, tamperedContent);

  const result = runGenerator(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /content does not match its declared hash/);
  assert.equal(await readFile(tablePath, 'utf8'), tamperedContent);
});

test('refuses to run at all once the published table is missing', async (t) => {
  const root = await treeWithGenerator(t, 'ednb-equipment-absent-');

  // A deleted table is a refusal rather than a table written afresh from the installed package:
  // every `e.` link already shared names version 1, and only the file it was minted from decodes
  // one.
  const result = runGenerator(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Equipment codec table 1 is missing/);
  assert.equal(
    await readFile(join(root, tableDirectoryPath, tableFileName), 'utf8').catch(() => null),
    null,
  );
});

test('rewrites nothing when the catalogue still produces the committed table', async (t) => {
  const root = await treeWithGenerator(t, 'ednb-equipment-stable-');
  const tablePath = join(root, tableDirectoryPath, tableFileName);
  const committed = await readFile(committedTablePath, 'utf8');
  await writeFile(tablePath, committed);

  const result = runGenerator(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  // The generator writes its own spacing; prettier gives the committed file its. Comparing the
  // parsed content is what says the table did not move.
  assert.deepEqual(JSON.parse(await readFile(tablePath, 'utf8')), JSON.parse(committed));
});
