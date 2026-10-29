import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// Deliberately refuses every non-local or non-dedicated database; never resets existing data.
const target = new URL(process.env.TEST_DATABASE_URL ?? '');
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !/^\/[a-z0-9_]+_profile_migration_test$/.test(target.pathname)) {
  throw new Error('Requires NODE_ENV=test and a local dedicated *_profile_migration_test database');
}
const root = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const newest = '20261029130000_driver_profile_details';
const client = new pg.Client({ connectionString: target.toString() });
try {
  await client.connect();
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(tables.rowCount, 0, 'Database must be empty; existing data will never be reset');
  const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name < newest).map(entry => entry.name).sort();
  for (const directory of directories) await client.query(await readFile(path.join(root, directory, 'migration.sql'), 'utf8'));
  const oldTables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const users = await client.query("INSERT INTO users(phone,role) VALUES ('+919999990101','DRIVER'),('+919999990102','DRIVER') RETURNING id");
  const approved = await client.query("INSERT INTO drivers(user_id,approval_status,approved_at,profile_name) VALUES ($1,'APPROVED',now(),'Historical Approved') RETURNING id", [users.rows[0].id]);
  const pending = await client.query("INSERT INTO drivers(user_id,profile_name) VALUES ($1,'Historical Pending') RETURNING id", [users.rows[1].id]);
  await client.query(await readFile(path.join(root, newest, 'migration.sql'), 'utf8'));
  const a = (await client.query('SELECT profile_name,profile_version FROM drivers WHERE id=$1', [approved.rows[0].id])).rows[0];
  const p = (await client.query('SELECT profile_name,profile_version FROM drivers WHERE id=$1', [pending.rows[0].id])).rows[0];
  assert.deepEqual(a, { profile_name: 'Historical Approved', profile_version: 1 });
  assert.deepEqual(p, { profile_name: 'Historical Pending', profile_version: 2 });
  const newUser = await client.query("INSERT INTO users(phone,role) VALUES ('+919999990103','DRIVER') RETURNING id");
  const fresh = await client.query('INSERT INTO drivers(user_id) VALUES ($1) RETURNING profile_version', [newUser.rows[0].id]);
  assert.equal(fresh.rows[0].profile_version, 2);
  assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows, oldTables);
  await assert.rejects(client.query('UPDATE drivers SET profile_version=1 WHERE id=$1', [pending.rows[0].id]), /PROFILE_CONTRACT_DOWNGRADE_FORBIDDEN/);
  console.log(JSON.stringify({ priorMigrations: directories.length, newMigration: newest, preservedTables: oldTables.length, approvedPreserved: true, pendingRequiresV2: true, newAccountsV2: true, downgradeBlocked: true }));
} catch (error) {
  // Do not echo connection configuration or SQL parameter data.
  console.error(`Profile migration verification failed (${error instanceof assert.AssertionError ? 'assertion' : error?.code ?? 'execution'}).`);
  process.exitCode = 1;
} finally { await client.end(); }
