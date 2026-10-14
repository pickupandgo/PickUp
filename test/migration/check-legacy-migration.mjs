#!/usr/bin/env node
/**
 * Migration safety check (payment flow Phase 1, decisions N1 and N3).
 *
 * Applies the pending migrations with `prisma migrate deploy` to throwaway copies of databases
 * that hold real-shaped data, and proves for each copy:
 *
 *   1. no pre-existing row changed: every table is fingerprinted over the columns it had before
 *      the migration (row count + hash of every row), and the fingerprints must be identical;
 *   2. every existing booking became LEGACY_BOOKING_LEVEL with no quote snapshot and no stops,
 *      and the applied-migrations history only gained rows;
 *   3. the migrated schema is identical to a fresh install (catalog fingerprint: tables, columns,
 *      constraints, indexes, triggers, functions, enums, comments);
 *   4. down.sql rolls the snapshot migration back to the previous schema without touching a row,
 *      and `migrate deploy` re-applies it to the same schema again (up / down / up).
 *
 * It also proves on throwaway databases that down.sql refuses to run once a QUOTE_PER_STOP booking
 * (or a quote with more than 5 drops) exists, and prints the read-only preflight inventory
 * (prisma/sql/preflight-payment-flow.sql) of every source before migrating it.
 *
 * Sources are never written: each one is copied with CREATE DATABASE ... TEMPLATE (which needs no
 * other connection to the source: stop the dev backend and Prisma Studio first). Every database
 * this script creates is named *_migcheck_test and is dropped at the end unless --keep is given.
 * Local Postgres only: it refuses any host other than localhost / 127.0.0.1.
 *
 * Usage (from raj_backend, Docker Postgres running):
 *   node test/migration/check-legacy-migration.mjs [--keep] [source-db ...]
 * Default sources: multipleride_legacy_snapshot_test, multipleride, multipleride_e2e.
 * Server URL: MIGCHECK_SERVER_URL, else the integration-test server (database "postgres").
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');
const SNAPSHOT_MIGRATION = '20261015120000_booking_quote_snapshot';
const DOWN_SQL = path.join(MIGRATIONS_DIR, SNAPSHOT_MIGRATION, 'down.sql');
const PREFLIGHT_SQL = path.join(ROOT, 'prisma', 'sql', 'preflight-payment-flow.sql');
const DEFAULT_SOURCES = ['multipleride_legacy_snapshot_test', 'multipleride', 'multipleride_e2e'];
const FRESH_DB = 'multipleride_fresh_migcheck_test';
const PREVIOUS_DB = 'multipleride_previous_migcheck_test';
const DEFAULT_SERVER_URL =
  'postgresql://multipleride:multipleride_dev_password@localhost:5433/postgres';

const problems = [];
const created = new Set();
/** Sources the migration was proven on, and sources that were already migrated. */
const checked = new Set();
const skipped = new Set();

function fail(scope, message) {
  problems.push(`[${scope}] ${message}`);
  console.log(`  FAIL ${message}`);
}

function pass(message) {
  console.log(`  ok   ${message}`);
}

/** Identifiers come from the catalog or from this file; still, only plain names are accepted. */
function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

function serverUrl() {
  const url = new URL(process.env.MIGCHECK_SERVER_URL ?? DEFAULT_SERVER_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Refusing to run against ${url.hostname}: local Postgres only`);
  }
  url.pathname = '/postgres';
  return url;
}

function databaseUrl(name) {
  const url = serverUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

async function withDatabase(name, work) {
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(admin, name, template) {
  if (!name.endsWith('_migcheck_test')) {
    throw new Error(`Refusing to create ${name}: only *_migcheck_test databases are created`);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${ident(name)}`);
  try {
    await admin.query(
      template
        ? `CREATE DATABASE ${ident(name)} TEMPLATE ${ident(template)}`
        : `CREATE DATABASE ${ident(name)}`,
    );
  } catch (error) {
    if (template && /being accessed by other users/.test(String(error))) {
      throw new Error(
        `${template} has open connections (dev backend, Prisma Studio, psql?). Close them and retry`,
      );
    }
    throw error;
  }
  created.add(name);
}

function migrateDeploy(name) {
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl(name) }, stdio: 'pipe' },
  );
}

function migrationNames() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// ---------------------------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------------------------

/** Column names of every table, in order, except Prisma's own history table. */
async function tableColumns(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS table_name, array_agg(a.attname::text ORDER BY a.attnum) AS columns
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND c.relname <> '_prisma_migrations'
     GROUP BY c.relname
     ORDER BY c.relname`);
  return Object.fromEntries(rows.map((row) => [row.table_name, row.columns]));
}

/** Row count and a hash of every row, over the given columns only. */
async function rowFingerprints(client, columnsByTable) {
  const result = {};
  for (const [table, columns] of Object.entries(columnsByTable)) {
    const { rows } = await client.query(`
      SELECT count(*)::text AS n, md5(COALESCE(string_agg(r, E'\\n' ORDER BY r), '')) AS h
        FROM (SELECT json_build_array(${columns.map(ident).join(', ')})::text AS r
                FROM ${ident(table)}) rows_as_json`);
    result[table] = { rows: Number(rows[0].n), hash: rows[0].h };
  }
  return result;
}

/** One line per schema object; equal lists mean equal schemas. */
async function catalog(client) {
  const { rows } = await client.query(`
    SELECT kind || ' ' || name || ' :: ' || definition AS line FROM (
      SELECT 'table' AS kind, c.relname AS name,
             c.relkind::text || COALESCE(' -- ' || obj_description(c.oid, 'pg_class'), '') AS definition
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND c.relname <> '_prisma_migrations'
      UNION ALL
      SELECT 'column', c.relname || '.' || a.attname,
             format_type(a.atttypid, a.atttypmod)
               || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
               || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
               || COALESCE(' -- ' || col_description(c.oid, a.attnum), '')
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> '_prisma_migrations'
      UNION ALL
      SELECT 'constraint', cl.relname || '.' || con.conname,
             pg_get_constraintdef(con.oid, true)
               || CASE WHEN con.condeferrable THEN ' DEFERRABLE' ELSE '' END
               || CASE WHEN con.condeferred THEN ' INITIALLY DEFERRED' ELSE '' END
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
       WHERE con.connamespace = 'public'::regnamespace AND con.contype <> 't'
         AND cl.relname <> '_prisma_migrations'
      UNION ALL
      SELECT 'index', i.indexname, i.indexdef
        FROM pg_indexes i
       WHERE i.schemaname = 'public' AND i.tablename <> '_prisma_migrations'
      UNION ALL
      SELECT 'trigger', c.relname || '.' || t.tgname,
             pg_get_triggerdef(t.oid, true) || ' [enabled=' || t.tgenabled::text || ']'
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
      UNION ALL
      SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             md5(pg_get_functiondef(p.oid))
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
      UNION ALL
      SELECT 'enum', t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typnamespace = 'public'::regnamespace
       GROUP BY t.typname
    ) objects
    ORDER BY 1`);
  return rows.map((row) => row.line);
}

function compareCatalogs(scope, label, actual, expected) {
  const want = new Set(expected);
  const have = new Set(actual);
  const missing = expected.filter((line) => !have.has(line));
  const extra = actual.filter((line) => !want.has(line));
  if (missing.length === 0 && extra.length === 0) {
    pass(`${label} (${actual.length} schema objects)`);
    return;
  }
  fail(scope, `${label}: ${missing.length} missing, ${extra.length} unexpected schema objects`);
  for (const line of missing.slice(0, 15)) {
    console.log(`         - ${line}`);
  }
  for (const line of extra.slice(0, 15)) {
    console.log(`         + ${line}`);
  }
}

function compareRows(scope, label, actual, expected) {
  const changed = Object.keys(expected).filter(
    (table) =>
      !actual[table] ||
      actual[table].rows !== expected[table].rows ||
      actual[table].hash !== expected[table].hash,
  );
  const total = Object.values(expected).reduce((sum, table) => sum + table.rows, 0);
  if (changed.length === 0) {
    pass(`${label}: ${total} rows in ${Object.keys(expected).length} tables unchanged`);
    return;
  }
  fail(scope, `${label}: rows changed in ${changed.join(', ')}`);
}

async function migrationHistory(client) {
  const { rows } = await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
      FROM _prisma_migrations ORDER BY migration_name`);
  return rows.map((row) => ({
    name: row.migration_name,
    line: JSON.stringify(row),
    finished: row.finished_at !== null && row.rolled_back_at === null,
  }));
}

/** Every existing booking is LEGACY_BOOKING_LEVEL, with no quote snapshot and no stops. */
async function checkLegacyRows(scope, client) {
  const { rows } = await client.query(`
    SELECT count(*)::int AS bookings,
           count(*) FILTER (WHERE payment_model <> 'LEGACY_BOOKING_LEVEL')::int AS not_legacy,
           count(*) FILTER (WHERE fare_quote_id IS NOT NULL OR pricing_version_id IS NOT NULL
                               OR fare_paise IS NOT NULL OR tax_paise IS NOT NULL
                               OR platform_fee_paise IS NOT NULL)::int AS with_snapshot,
           (SELECT count(*)::int FROM booking_stops) AS stops
      FROM bookings`);
  const [state] = rows;
  if (state.not_legacy === 0 && state.with_snapshot === 0 && state.stops === 0) {
    pass(`all ${state.bookings} bookings are LEGACY_BOOKING_LEVEL, no snapshot, no stops`);
  } else {
    fail(scope, `legacy marking: ${JSON.stringify(state)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// down.sql
// ---------------------------------------------------------------------------------------------

/** Runs down.sql. Resolves with null on success, or the database error message. */
async function runDown(client) {
  try {
    await client.query(readFileSync(DOWN_SQL, 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    return error instanceof Error ? error.message : String(error);
  }
  // As down.sql says: forget the migration so `prisma migrate deploy` applies it again.
  const { rows } = await client.query(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present",
  );
  if (rows[0].present) {
    await client.query('DELETE FROM _prisma_migrations WHERE migration_name = $1', [
      SNAPSHOT_MIGRATION,
    ]);
  }
  return null;
}

/** A booking registered from a quote, written as registration writes it (all guards on). */
const QUOTE_BOOKING_SQL = `
DO $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_user UUID;
    v_customer UUID;
    v_version UUID;
    v_rule UUID;
    v_quote UUID;
    v_stop UUID;
    v_booking UUID;
BEGIN
    INSERT INTO users (phone, role) VALUES ('+919999900001', 'CUSTOMER') RETURNING id INTO v_user;
    INSERT INTO customers (user_id) VALUES (v_user) RETURNING id INTO v_customer;
    INSERT INTO pricing_versions (code, model, config, effective_from, active, reason,
                                  deactivated_at, deactivation_reason)
         VALUES ('MIGCHECK-1', 'LEG_DISTANCE_V1', '{}'::jsonb, v_now - interval '1 minute', FALSE,
                 'Migration check fixture', v_now, 'Migration check fixture')
      RETURNING id INTO v_version;
    INSERT INTO fee_rules (category, rule_type, value, rounding_mode, effective_from, reason)
         VALUES ('MIGCHECK', 'PERCENTAGE', 10, 'HALF_UP', v_now - interval '1 minute',
                 'Migration check fixture')
      RETURNING id INTO v_rule;
    INSERT INTO fare_quotes (customer_id, pricing_version_id, vehicle_category, weight_grams,
                             pickup_latitude, pickup_longitude, distance_meters, fare_paise,
                             tax_paise, payable_paise, expires_at, created_at)
         VALUES (v_customer, v_version, 'MIGCHECK', 1000, 26.2389, 73.0243, 1000, 50000, 0, 50000,
                 v_now + interval '10 minutes', v_now - interval '1 minute')
      RETURNING id INTO v_quote;
    INSERT INTO fare_quote_stops (quote_id, sequence, latitude, longitude, distance_meters,
                                  fare_paise, tax_paise, payable_paise)
         VALUES (v_quote, 1, 26.3, 73.0458, 1000, 50000, 0, 50000)
      RETURNING id INTO v_stop;
    UPDATE fare_quotes SET redeemed_at = v_now WHERE id = v_quote;
    INSERT INTO bookings (external_ref, customer_id, vehicle_category, fare_estimate_minor,
                          final_fare_minor, payment_method, fee_rule_id, payment_model,
                          fare_quote_id, pricing_version_id, fare_paise, tax_paise,
                          platform_fee_paise, confirmed_at)
         VALUES ('MIGCHECK-1', v_customer, 'MIGCHECK', 50000, 50000, 'PAY_AT_PICKUP', v_rule,
                 'QUOTE_PER_STOP', v_quote, v_version, 50000, 0, 5000, v_now)
      RETURNING id INTO v_booking;
    INSERT INTO booking_stops (booking_id, fare_quote_stop_id, sequence, fare_paise, tax_paise,
                               payable_paise, platform_fee_share_paise)
         VALUES (v_booking, v_stop, 1, 50000, 0, 50000, 5000);
END;
$$;`;

/** A quote with 6 drops (allowed once FARE_MAX_DROPS is raised), never booked. */
const SIX_DROP_QUOTE_SQL = `
DO $$
DECLARE
    v_user UUID;
    v_customer UUID;
    v_version UUID;
    v_quote UUID;
BEGIN
    INSERT INTO users (phone, role) VALUES ('+919999900002', 'CUSTOMER') RETURNING id INTO v_user;
    INSERT INTO customers (user_id) VALUES (v_user) RETURNING id INTO v_customer;
    INSERT INTO pricing_versions (code, model, config, effective_from, active, reason,
                                  deactivated_at, deactivation_reason)
         VALUES ('MIGCHECK-2', 'LEG_DISTANCE_V1', '{}'::jsonb, now() - interval '1 minute', FALSE,
                 'Migration check fixture', now(), 'Migration check fixture')
      RETURNING id INTO v_version;
    INSERT INTO fare_quotes (customer_id, pricing_version_id, vehicle_category, weight_grams,
                             pickup_latitude, pickup_longitude, distance_meters, fare_paise,
                             tax_paise, payable_paise, expires_at)
         VALUES (v_customer, v_version, 'MIGCHECK', 1000, 26.2389, 73.0243, 6000, 6000, 0, 6000,
                 now() + interval '10 minutes')
      RETURNING id INTO v_quote;
    INSERT INTO fare_quote_stops (quote_id, sequence, latitude, longitude, distance_meters,
                                  fare_paise, tax_paise, payable_paise)
         SELECT v_quote, n, 26.3, 73.0458, 1000, 1000, 0, 1000 FROM generate_series(1, 6) AS n;
END;
$$;`;

// ---------------------------------------------------------------------------------------------
// Preflight (read-only inventory), run through pg so no psql is needed
// ---------------------------------------------------------------------------------------------

async function printPreflight(client) {
  const titles = [];
  const sql = readFileSync(PREFLIGHT_SQL, 'utf8')
    .split(/\r?\n/)
    .filter((line) => {
      const echo = /^\\echo\s+'(.*)'\s*$/.exec(line);
      if (echo) {
        titles.push(echo[1]);
        return false;
      }
      return !line.startsWith('\\');
    })
    .join('\n');
  const results = await client.query(sql);
  // BEGIN READ ONLY, one SELECT per title, ROLLBACK.
  const selects = Array.isArray(results) ? results.slice(1, -1) : [];
  if (selects.length !== titles.length) {
    console.log('  (preflight output could not be matched to its sections)');
    return;
  }
  titles.forEach((title, index) => {
    console.log(`  ${title}`);
    const rows = selects[index].rows;
    if (rows.length === 0) {
      console.log('      (none)');
    }
    for (const row of rows) {
      console.log(
        `      ${Object.entries(row)
          .map(([key, value]) => `${key}=${value instanceof Date ? value.toISOString() : value}`)
          .join('  ')}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

/** A fresh install through Prisma: the reference schema, and the down.sql refusal checks. */
async function freshReference(admin) {
  console.log(`\n== Fresh install (${FRESH_DB})`);
  await createDatabase(admin, FRESH_DB);
  migrateDeploy(FRESH_DB);
  const reference = await withDatabase(FRESH_DB, catalog);
  pass(`prisma migrate deploy from empty: ${reference.length} schema objects`);

  await withDatabase(FRESH_DB, async (client) => {
    await client.query(QUOTE_BOOKING_SQL);
    pass('a QUOTE_PER_STOP booking passes every guard when written like registration does');
    const refused = await runDown(client);
    if (refused && /QUOTE_PER_STOP bookings exist/.test(refused)) {
      pass('down.sql refuses to run once a QUOTE_PER_STOP booking exists');
    } else {
      fail('fresh', `down.sql with a QUOTE_PER_STOP booking: ${refused ?? 'it ran'}`);
    }
    compareCatalogs(
      'fresh',
      'schema unchanged after the refused rollback',
      await catalog(client),
      reference,
    );
  });
  return reference;
}

/**
 * The schema before the snapshot migration, built by applying every earlier migration file
 * directly (independently of down.sql); then the snapshot migration itself is applied the same
 * way and must give the fresh-install schema.
 */
async function previousReference(admin, fresh) {
  console.log(`\n== Previous schema (${PREVIOUS_DB})`);
  const names = migrationNames();
  if (names.at(-1) !== SNAPSHOT_MIGRATION) {
    throw new Error(`Expected ${SNAPSHOT_MIGRATION} to be the latest migration`);
  }
  await createDatabase(admin, PREVIOUS_DB);
  return withDatabase(PREVIOUS_DB, async (client) => {
    for (const name of names.slice(0, -1)) {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
    }
    const previous = await catalog(client);
    pass(`migrations up to ${names.at(-2)}: ${previous.length} schema objects`);

    await client.query(
      readFileSync(path.join(MIGRATIONS_DIR, SNAPSHOT_MIGRATION, 'migration.sql'), 'utf8'),
    );
    compareCatalogs(
      'previous',
      'previous schema + snapshot migration = fresh install',
      await catalog(client),
      fresh,
    );

    await client.query(SIX_DROP_QUOTE_SQL);
    const refused = await runDown(client);
    if (refused && /more than 5 drops/.test(refused)) {
      pass('down.sql refuses to run once a quote has more than 5 drops');
    } else {
      fail('previous', `down.sql with a 6-drop quote: ${refused ?? 'it ran'}`);
    }
    return previous;
  });
}

async function checkSource(admin, source, references) {
  const scope = source;
  const copy = `${source.replace(/_test$/, '')}_migcheck_test`;
  console.log(`\n== ${source} (checked on the copy ${copy})`);
  await createDatabase(admin, copy, source);

  const before = await withDatabase(copy, async (client) => {
    await printPreflight(client);
    const columns = await tableColumns(client);
    return {
      columns,
      rows: await rowFingerprints(client, columns),
      history: await migrationHistory(client),
    };
  });
  const pending = migrationNames().filter(
    (name) => !before.history.some((row) => row.name === name && row.finished),
  );
  console.log(`  pending migrations: ${pending.join(', ') || '(none)'}`);
  if (!pending.includes(SNAPSHOT_MIGRATION)) {
    // Nothing to prove on a database that is already migrated (e.g. dev after the upgrade).
    console.log(`  skipped: ${SNAPSHOT_MIGRATION} is already applied here`);
    skipped.add(source);
    return;
  }
  checked.add(source);

  migrateDeploy(copy);
  await withDatabase(copy, async (client) => {
    compareRows(
      scope,
      'up: pre-existing rows',
      await rowFingerprints(client, before.columns),
      before.rows,
    );
    await checkLegacyRows(scope, client);
    const history = await migrationHistory(client);
    const kept = before.history.every((row) => history.some((after) => after.line === row.line));
    const applied = pending.every((name) =>
      history.some((row) => row.name === name && row.finished),
    );
    if (kept && applied && history.length === before.history.length + pending.length) {
      pass(`migration history kept, ${pending.length} migration(s) applied`);
    } else {
      fail(scope, 'migration history was rewritten or is incomplete');
    }
    compareCatalogs(scope, 'up: schema = fresh install', await catalog(client), references.fresh);
  });

  await withDatabase(copy, async (client) => {
    const refused = await runDown(client);
    if (refused) {
      fail(scope, `down.sql failed: ${refused}`);
      return;
    }
    compareRows(
      scope,
      'down: pre-existing rows',
      await rowFingerprints(client, before.columns),
      before.rows,
    );
    compareCatalogs(
      scope,
      'down: schema = previous schema',
      await catalog(client),
      references.previous,
    );
  });

  migrateDeploy(copy);
  await withDatabase(copy, async (client) => {
    compareRows(
      scope,
      'up again: pre-existing rows',
      await rowFingerprints(client, before.columns),
      before.rows,
    );
    await checkLegacyRows(scope, client);
    compareCatalogs(
      scope,
      'up again: schema = fresh install',
      await catalog(client),
      references.fresh,
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const sources = args.filter((arg) => !arg.startsWith('--'));
  const admin = new pg.Client({ connectionString: serverUrl().toString() });
  await admin.connect();
  try {
    const fresh = await freshReference(admin);
    const previous = await previousReference(admin, fresh);
    for (const source of sources.length > 0 ? sources : DEFAULT_SOURCES) {
      try {
        await checkSource(admin, source, { fresh, previous });
      } catch (error) {
        fail(source, error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    if (!keep) {
      for (const name of created) {
        await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
      }
    }
    await admin.end();
  }

  if (checked.size === 0) {
    problems.push('[sources] no source still needed the migration, so nothing was proven');
  }
  console.log('');
  console.log(`Checked: ${[...checked].join(', ') || '(none)'}`);
  if (skipped.size > 0) {
    console.log(`Skipped (already migrated): ${[...skipped].join(', ')}`);
  }
  if (problems.length > 0) {
    console.log(`MIGRATION CHECK FAILED (${problems.length}):`);
    for (const problem of problems) {
      console.log(`  ${problem}`);
    }
    process.exitCode = 1;
  } else {
    console.log('MIGRATION CHECK PASSED');
  }
  if (keep) {
    console.log(`Kept: ${[...created].join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
