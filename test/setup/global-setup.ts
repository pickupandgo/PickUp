import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { assertTestDatabase, TEST_DATABASE_URL } from './test-database';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Creates the engine test database when missing, then rebuilds it from the real migration files
 * (the same `prisma migrate deploy` production runs), so the suite always tests the migrated
 * schema, CHECK constraints and outbox guard included.
 */
export default async function globalSetup(): Promise<void> {
  const databaseName = assertTestDatabase(TEST_DATABASE_URL);

  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';
  await withClient(maintenance.toString(), async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (!existing.rowCount) {
      // The name was checked above: only [a-z0-9_] and the _test suffix.
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  });

  await withClient(TEST_DATABASE_URL, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });

  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'deploy',
    ],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    },
  );
}

async function withClient(
  url: string,
  work: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}
