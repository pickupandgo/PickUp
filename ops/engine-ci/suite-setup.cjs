'use strict';
// Replaces the legacy globalSetup: NO DROP, schema reset, .env loading or remote
// migrations. Both schemas were initialized separately by this runner's harness.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { Client } = createRequire('/app/package.json')('pg');
module.exports = async () => {
  const u = new URL(process.env.ENGINE_TEST_DATABASE_URL);
  assert.equal(u.hostname, '172.29.63.2');
  assert.equal(u.port, '5432');
  assert.equal(u.pathname, '/mr_engine_suite_test');
  assert.equal(u.username, 'ci_owner');
  assert.ok(u.password.startsWith('dummy_engine_ci_'));
  const c = new Client({
    connectionString: u.href,
    connectionTimeoutMillis: 3000,
  });
  await c.connect();
  try {
    const result = await c.query(
      'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    assert.equal(result.rows[0].n, 4);
    const empty = await c.query(
      'SELECT count(*)::int AS n FROM engine_bookings',
    );
    assert.equal(empty.rows[0].n, 0);
  } finally {
    await c.end();
  }
};
