import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from '../setup/test-database';

/*
 * Building throwaway databases from the real migration files, for tests that need a database at
 * an earlier schema level (data written by an older release, then upgraded). They live on the
 * integration-test server and their names must end in _test, like every database tests touch.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
const DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;

/** Every migration folder, in the order Prisma applies them. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The migrations up to and including `last`. */
export function migrationsThrough(last: string): string[] {
  const names = migrationNames();
  const index = names.indexOf(last);
  if (index < 0) {
    throw new Error(`Unknown migration ${last}`);
  }
  return names.slice(0, index + 1);
}

/** The migrations after `last`. */
export function migrationsAfter(last: string): string[] {
  const names = migrationNames();
  const index = names.indexOf(last);
  if (index < 0) {
    throw new Error(`Unknown migration ${last}`);
  }
  return names.slice(index + 1);
}

function serverUrl(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Connection URL of a throwaway test database (owner credentials of the test server). */
export function throwawayDatabaseUrl(name: string): string {
  if (!DATABASE_NAME.test(name)) {
    throw new Error(`Refusing database "${name}": the name must end with _test`);
  }
  return serverUrl(name);
}

async function onServer(work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: serverUrl('postgres') });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

/** Drops (if it exists) and creates an empty database. */
export async function recreateDatabase(name: string): Promise<void> {
  throwawayDatabaseUrl(name);
  await onServer(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

export async function dropDatabase(name: string): Promise<void> {
  throwawayDatabaseUrl(name);
  await onServer(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

/** Applies migration files in order, each as one script, exactly as their SQL is written. */
export async function applyMigrations(client: Client, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await client.query(readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
  }
}

export interface TableFingerprint {
  readonly rows: number;
  readonly hash: string;
}

/** Column names of every table, in order. */
export async function tableColumns(client: Client): Promise<Record<string, string[]>> {
  const { rows } = await client.query<{ table_name: string; columns: string[] }>(`
    SELECT c.relname AS table_name, array_agg(a.attname::text ORDER BY a.attnum) AS columns
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND c.relname <> '_prisma_migrations'
     GROUP BY c.relname`);
  return Object.fromEntries(rows.map((row) => [row.table_name, row.columns]));
}

/**
 * Row count and a hash of every row of each table, over the given columns only, so a table can
 * be compared before and after a migration that adds columns.
 */
export async function rowFingerprints(
  client: Client,
  columnsByTable: Record<string, readonly string[]>,
): Promise<Record<string, TableFingerprint>> {
  const result: Record<string, TableFingerprint> = {};
  for (const [table, columns] of Object.entries(columnsByTable)) {
    // Names come from the catalog (tableColumns); only plain identifiers are accepted.
    for (const name of [table, ...columns]) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        throw new Error(`Unexpected identifier ${name}`);
      }
    }
    const list = columns.map((column) => `"${column}"`).join(', ');
    const { rows } = await client.query<{ n: string; h: string }>(`
      SELECT count(*)::text AS n, md5(COALESCE(string_agg(r, E'\\n' ORDER BY r), '')) AS h
        FROM (SELECT json_build_array(${list})::text AS r FROM "${table}") rows_as_json`);
    const [row] = rows;
    if (!row) {
      throw new Error(`No fingerprint for ${table}`);
    }
    result[table] = { rows: Number(row.n), hash: row.h };
  }
  return result;
}
