'use strict';
const assert = require('node:assert/strict');
const { Client } =
  require('node:module').createRequire('/app/package.json')('pg');
const tables = [
  'engine_bookings',
  'engine_stops',
  'engine_offers',
  'engine_trips',
  'engine_outbox',
  'engine_driver_positions',
];
(async () => {
  const u = new URL(process.env.DATABASE_URL);
  assert.equal(u.hostname, '172.29.63.2');
  assert.equal(u.pathname, '/mr_engine_synthetic_test');
  const c = new Client({
    connectionString: u.href,
    connectionTimeoutMillis: 3000,
  });
  await c.connect();
  try {
    assert.equal(
      (await c.query('SHOW server_version')).rows[0].server_version,
      '16.15',
    );
    const migrations = await c.query(
      'SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NULL AS not_rolled_back FROM _prisma_migrations ORDER BY migration_name',
    );
    assert.equal(migrations.rows.length, 4);
    assert.ok(migrations.rows.every((r) => r.finished && r.not_rolled_back));
    if (process.argv[2] === 'seed') {
      const b = await c.query(
        "SELECT id FROM engine_bookings WHERE status='ASSIGNED' ORDER BY id LIMIT 1",
      );
      assert.equal(b.rowCount, 1);
      await c.query(
        "INSERT INTO engine_outbox(booking_id,kind,mode,payload) VALUES($1,'SEARCHING','EVENT','{}'::jsonb)",
        [b.rows[0].id],
      );
    }
    const snapshot = {};
    for (const t of tables) {
      const r = await c.query(
        `SELECT count(*)::int AS rows,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM ${t} t`,
      );
      snapshot[t] = r.rows[0];
    }
    console.log(
      JSON.stringify({
        result: 'PASS',
        database: 'mr_engine_synthetic_test',
        PostgreSQL: '16.15',
        migrations: migrations.rows.map(({ migration_name, checksum }) => ({
          migration_name,
          checksum,
        })),
        snapshot,
        real_data: false,
      }),
    );
  } finally {
    await c.end();
  }
})().catch(() => {
  console.error('SYNTHETIC_DATABASE_PROBE_FAILED');
  process.exitCode = 1;
});
