import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  assertTestDatabase,
  RESTRICTED_ROLE,
  restrictedRolePassword,
  TEST_DATABASE_URL,
} from './test-database';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Rebuilds the test database from the real migration files, then creates a login role with the
 * real production grants so one suite can prove the app works under least privilege.
 */
export default async function globalSetup(): Promise<void> {
  const databaseName = assertTestDatabase(TEST_DATABASE_URL);

  await withClient(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });

  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'pipe' },
  );

  const grants = readFileSync(path.join(ROOT, 'prisma', 'sql', '02-app-grants.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('\\'))
    .join('\n')
    .replace(/\bmr_app\b/g, RESTRICTED_ROLE);

  await withClient(async (client) => {
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      RESTRICTED_ROLE,
    ]);
    if (existing.rowCount) {
      await client.query(`DROP OWNED BY ${RESTRICTED_ROLE}`);
      await client.query(`DROP ROLE ${RESTRICTED_ROLE}`);
    }
    await client.query(
      `CREATE ROLE ${RESTRICTED_ROLE} LOGIN PASSWORD '${restrictedRolePassword}' CONNECTION LIMIT 50`,
    );
    await client.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO ${RESTRICTED_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${RESTRICTED_ROLE}`);
    await client.query(grants);
  });
}

async function withClient(work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}
