import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('server coverage threshold cannot be below 80', () => {
  const result = spawnSync('bash', ['scripts/check-server-coverage.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SERVER_COVERAGE_THRESHOLD: '79' },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be an integer of at least 80/);
});
