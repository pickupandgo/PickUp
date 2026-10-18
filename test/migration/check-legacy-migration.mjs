#!/usr/bin/env node
/**
 * Migration safety check for the payment-flow migrations (decisions N1 and N3).
 *
 * Applies the pending migrations with `prisma migrate deploy` to throwaway copies of databases
 * that hold real-shaped data, and proves for each copy:
 *
 *   1. no pre-existing row changed: every table is fingerprinted over the columns it had before
 *      the migration (row count + hash of every row), and the fingerprints must be identical;
 *   2. bookings registered before fare quotes became LEGACY_BOOKING_LEVEL with no quote snapshot,
 *      no stop was invented, no existing collection names a stop, no stop has lifecycle data,
 *      and the applied-migrations history only gained rows;
 *   3. the migrated schema is identical to a fresh install (catalog fingerprint: tables, columns,
 *      constraints, indexes, triggers, functions, enums, comments);
 *   4. each applied migration that has a down.sql rolls back, newest first, to exactly the schema
 *      before it without touching a row, and `migrate deploy` re-applies them to the same schema
 *      again (up / down / up).
 *
 * On throwaway databases it also proves that every down.sql works on an empty schema, lands on
 * the schema built from the earlier migration files alone, and refuses to run once the data it
 * would drop exists (a QUOTE_PER_STOP booking, a quote with more than 5 drops, a collection for a
 * single drop, a stop with lifecycle data, a drop with its own collection, a partially paid
 * booking, a settlement finding, a payable earning funded by several collections). The stop
 * lifecycle migration drops no data, so its down.sql has nothing to refuse; the fresh install
 * proves a drop is reached, collected and paid through the Phase 3 and 4 rules, and that an
 * earning funded by two drop QRs is payable only once both are settled (Phase 5), with every
 * guard on. After every deploy it checks each earning's cash / online split and payout amount
 * against its own sources (Phase 5 backfill), and that the migration recorded no financial event
 * (Phase 7: the event log starts empty). On the fresh install it also proves the fixture writes
 * are in the event log, that no role can change, delete or forge an event, and that the Phase 7
 * down.sql files refuse once a reconciliation run, a finding or an event exists. It prints the
 * read-only preflight inventory (prisma/sql/preflight-payment-flow.sql) of every source before
 * migrating it.
 *
 * Sources are never written: each one is copied with CREATE DATABASE ... TEMPLATE (which needs no
 * other connection to the source: stop the dev backend and Prisma Studio first). Every database
 * this script creates is named *_migcheck_test and is dropped at the end unless --keep is given.
 * A source that has nothing pending is skipped. Local Postgres only: it refuses any host other
 * than localhost / 127.0.0.1.
 *
 * Usage (from raj_backend, Docker Postgres running):
 *   node test/migration/check-legacy-migration.mjs [--keep] [source-db ...]
 * Default sources: multipleride_legacy_snapshot_test, multipleride_phase1_snapshot_test,
 * multipleride (dev), multipleride_e2e.
 * Server URL: MIGCHECK_SERVER_URL, else the integration-test server (database "postgres").
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');
const SNAPSHOT_MIGRATION = '20261015120000_booking_quote_snapshot';
const STOP_SCHEMA_MIGRATION = '20261016120000_per_stop_obligation_schema';
const STOP_LIFECYCLE_MIGRATION = '20261017120000_payment_gate_stop_lifecycle';
const ENUMS_MIGRATION = '20261018120000_partially_paid_mixed_enums';
const OBLIGATION_MIGRATION = '20261018120100_obligation_collections';
const MIXED_EARNINGS_MIGRATION = '20261019120000_mixed_earnings_payout_hold';
const REFUND_ENUM_MIGRATION = '20261020120000_partially_refunded_enum';
const REFUNDS_MIGRATION = '20261020120100_refunds';
const EVENTS_MIGRATION = '20261021120000_financial_events';
const FINDINGS_MIGRATION = '20261021120100_reconciliation_findings';
const PREFLIGHT_SQL = path.join(ROOT, 'prisma', 'sql', 'preflight-payment-flow.sql');
const DEFAULT_SOURCES = [
  'multipleride_legacy_snapshot_test',
  'multipleride_phase1_snapshot_test',
  'multipleride',
  'multipleride_e2e',
];
const FRESH_DB = 'multipleride_fresh_migcheck_test';
const LEVELS_DB = 'multipleride_levels_migcheck_test';
const DEFAULT_SERVER_URL =
  'postgresql://multipleride:multipleride_dev_password@localhost:5433/postgres';

const problems = [];
const created = new Set();
/** Sources the migrations were proven on, and sources that were already migrated. */
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

function migrationSql(name, file = 'migration.sql') {
  return readFileSync(path.join(MIGRATIONS_DIR, name, file), 'utf8');
}

function hasDown(name) {
  return existsSync(path.join(MIGRATIONS_DIR, name, 'down.sql'));
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

/**
 * Collections that name a drop, and drops with lifecycle data, at any schema level (0 before the
 * migrations that add them). A source migrated from an earlier phase has none; one already at a
 * later phase (the e2e database after an E2E run) has its own, which a migration must not change.
 */
const STOP_DATA_SQL = `
           CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = 'payment_collections'
                                    AND column_name = 'booking_stop_id') THEN 0
                ELSE (xpath('/row/n/text()', query_to_xml(
                        'SELECT count(*) AS n FROM payment_collections WHERE booking_stop_id IS NOT NULL',
                        false, true, '')))[1]::text::int
           END AS collections_for_one_drop,
           CASE WHEN to_regclass('public.booking_stops') IS NULL THEN 0
                ELSE (xpath('/row/n/text()', query_to_xml(
                        'SELECT count(*) AS n FROM booking_stops s
                          WHERE COALESCE(to_jsonb(s) ->> ''status'', ''PENDING'') <> ''PENDING''
                             OR to_jsonb(s) ->> ''arrived_at'' IS NOT NULL
                             OR to_jsonb(s) ->> ''payment_confirmed_at'' IS NOT NULL
                             OR to_jsonb(s) ->> ''delivered_at'' IS NOT NULL
                             OR to_jsonb(s) ->> ''failed_at'' IS NOT NULL
                             OR to_jsonb(s) ->> ''cancelled_at'' IS NOT NULL
                             OR to_jsonb(s) ->> ''resolved_at'' IS NOT NULL',
                        false, true, '')))[1]::text::int
           END AS stops_with_lifecycle`;

/** What a source holds before it is migrated, for the checks that depend on its level. */
async function sourceState(client) {
  const { rows } = await client.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'bookings'
                      AND column_name = 'payment_model') AS has_payment_model,
           CASE WHEN to_regclass('public.booking_stops') IS NULL THEN 0
                ELSE (xpath('/row/n/text()', query_to_xml(
                        'SELECT count(*) AS n FROM booking_stops', false, true, '')))[1]::text::int
           END AS stops,
           (SELECT count(*)::int FROM payment_collections
             WHERE method = 'ONLINE_QR' AND status = 'PENDING') AS pending_qrs,
           ${STOP_DATA_SQL}`);
  return rows[0];
}

/** Bookings registered before fare quotes are LEGACY_BOOKING_LEVEL, with no quote snapshot. */
async function checkLegacyMarking(scope, client) {
  const { rows } = await client.query(`
    SELECT count(*)::int AS bookings,
           count(*) FILTER (WHERE payment_model <> 'LEGACY_BOOKING_LEVEL')::int AS not_legacy,
           count(*) FILTER (WHERE fare_quote_id IS NOT NULL OR pricing_version_id IS NOT NULL
                               OR fare_paise IS NOT NULL OR tax_paise IS NOT NULL
                               OR platform_fee_paise IS NOT NULL)::int AS with_snapshot
      FROM bookings`);
  const [state] = rows;
  if (state.not_legacy === 0 && state.with_snapshot === 0) {
    pass(`all ${state.bookings} bookings are LEGACY_BOOKING_LEVEL, with no quote snapshot`);
  } else {
    fail(scope, `legacy marking: ${JSON.stringify(state)}`);
  }
}

/**
 * No stop was invented (the same number as before, all on QUOTE_PER_STOP bookings), no existing
 * collection was made to name a stop, and no stop gained lifecycle data: a source migrated from
 * before those migrations has none of either; one already past them keeps exactly its own.
 */
async function checkStops(scope, client, before) {
  const { rows } = await client.query(`
    SELECT (SELECT count(*)::int FROM booking_stops) AS stops,
           (SELECT count(*)::int FROM booking_stops s JOIN bookings b ON b.id = s.booking_id
             WHERE b.payment_model <> 'QUOTE_PER_STOP') AS stops_on_legacy,
           (SELECT count(*)::int FROM payment_collections
             WHERE method = 'ONLINE_QR' AND status = 'PENDING') AS pending_qrs,
           ${STOP_DATA_SQL}`);
  const [state] = rows;
  if (
    state.stops === before.stops &&
    state.stops_on_legacy === 0 &&
    state.collections_for_one_drop === before.collections_for_one_drop &&
    state.stops_with_lifecycle === before.stops_with_lifecycle &&
    state.pending_qrs === before.pending_qrs
  ) {
    pass(
      `stops: ${state.stops} (none invented, none on a legacy booking); collections naming a ` +
        `drop: ${state.collections_for_one_drop} and drops with lifecycle data: ` +
        `${state.stops_with_lifecycle}, as before; ${state.pending_qrs} in-flight QR ` +
        'collection(s) still PENDING',
    );
  } else {
    fail(scope, `stops and collections: ${JSON.stringify({ before, after: state })}`);
  }
}

/**
 * Payment flow Phase 5: every earning's cash / online split and payout amount are what its own
 * sources say (its linked collections, by method, or its single source: a CASH earning all cash,
 * an ONLINE one all online), and every link's net amount is its amount minus its fee.
 */
async function checkEarningSplit(scope, client) {
  const { rows } = await client.query(`
    SELECT count(*)::int AS earnings,
           count(*) FILTER (WHERE e.settlement = 'CASH')::int AS cash,
           count(*) FILTER (WHERE e.settlement = 'ONLINE')::int AS online,
           count(*) FILTER (WHERE e.settlement = 'MIXED')::int AS mixed,
           count(*) FILTER (WHERE NOT (
               e.cash_collected_paise = CASE WHEN l.n > 0 THEN l.cash
                   WHEN e.settlement = 'CASH' THEN e.gross_amount_paise ELSE 0 END
               AND e.online_collected_paise = CASE WHEN l.n > 0 THEN l.online
                   WHEN e.settlement = 'CASH' THEN 0 ELSE e.gross_amount_paise END
               AND e.cash_fee_paise = CASE WHEN l.n > 0 THEN l.cash_fee
                   WHEN e.settlement = 'CASH' THEN e.platform_fee_paise ELSE 0 END
               AND e.online_fee_paise = CASE WHEN l.n > 0 THEN l.online_fee
                   WHEN e.settlement = 'CASH' THEN 0 ELSE e.platform_fee_paise END
               AND e.payout_amount_paise = CASE e.settlement WHEN 'CASH' THEN 0
                   WHEN 'ONLINE' THEN e.net_amount_paise
                   ELSE e.online_collected_paise - e.online_fee_paise END))::int AS wrong,
           (SELECT count(*)::int FROM earning_collections
             WHERE net_amount_paise <> amount_paise - platform_fee_paise) AS wrong_links
      FROM driver_earnings e
     CROSS JOIN LATERAL (
           SELECT count(*) AS n,
                  coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0) AS cash,
                  coalesce(sum(amount_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online,
                  coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_fee,
                  coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'ONLINE_QR'), 0)
                      AS online_fee
             FROM earning_collections WHERE earning_id = e.id) l`);
  const [state] = rows;
  if (state.wrong === 0 && state.wrong_links === 0) {
    pass(
      `earning split: ${state.earnings} earnings (${state.cash} cash, ${state.online} online, ` +
        `${state.mixed} mixed) split and payout amount as their sources say; link nets correct`,
    );
  } else {
    fail(scope, `earning split: ${JSON.stringify(state)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// down.sql
// ---------------------------------------------------------------------------------------------

/** Runs a migration's down.sql. Resolves with null on success, or the database error message. */
async function runDown(client, name) {
  try {
    await client.query(migrationSql(name, 'down.sql'));
  } catch (error) {
    await client.query('ROLLBACK');
    return error instanceof Error ? error.message : String(error);
  }
  // As down.sql says: forget the migration so `prisma migrate deploy` applies it again.
  const { rows } = await client.query(
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present",
  );
  if (rows[0].present) {
    await client.query('DELETE FROM _prisma_migrations WHERE migration_name = $1', [name]);
  }
  return null;
}

async function expectRefused(scope, client, name, pattern, label) {
  const refused = await runDown(client, name);
  if (refused && pattern.test(refused)) {
    pass(`${name} down.sql refuses to run once ${label}`);
  } else {
    fail(scope, `${name} down.sql with ${label}: ${refused ?? 'it ran'}`);
  }
}

/**
 * A QUOTE_PER_STOP PAY_AT_DELIVERY booking with two drops, assigned to a driver, written as
 * registration and assignment write it (every guard on).
 */
const PER_STOP_BOOKING_SQL = `
DO $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_user UUID;
    v_customer UUID;
    v_driver_user UUID;
    v_driver UUID;
    v_version UUID;
    v_rule UUID;
    v_quote UUID;
    v_stop1 UUID;
    v_stop2 UUID;
    v_booking UUID;
BEGIN
    INSERT INTO users (phone, role) VALUES ('+919999900001', 'CUSTOMER') RETURNING id INTO v_user;
    INSERT INTO customers (user_id) VALUES (v_user) RETURNING id INTO v_customer;
    INSERT INTO users (phone, role) VALUES ('+919999900003', 'DRIVER') RETURNING id INTO v_driver_user;
    INSERT INTO drivers (user_id, approval_status, approved_at, legal_name)
         VALUES (v_driver_user, 'APPROVED', v_now, 'Migration Check')
      RETURNING id INTO v_driver;
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
         VALUES (v_customer, v_version, 'MIGCHECK', 1000, 26.2389, 73.0243, 2000, 50000, 0, 50000,
                 v_now + interval '10 minutes', v_now - interval '1 minute')
      RETURNING id INTO v_quote;
    INSERT INTO fare_quote_stops (quote_id, sequence, latitude, longitude, distance_meters,
                                  fare_paise, tax_paise, payable_paise)
         VALUES (v_quote, 1, 26.3, 73.0458, 1000, 20000, 0, 20000)
      RETURNING id INTO v_stop1;
    INSERT INTO fare_quote_stops (quote_id, sequence, latitude, longitude, distance_meters,
                                  fare_paise, tax_paise, payable_paise)
         VALUES (v_quote, 2, 26.31, 73.0458, 1000, 30000, 0, 30000)
      RETURNING id INTO v_stop2;
    UPDATE fare_quotes SET redeemed_at = v_now WHERE id = v_quote;
    INSERT INTO bookings (external_ref, customer_id, vehicle_category, fare_estimate_minor,
                          final_fare_minor, payment_method, fee_rule_id, payment_model,
                          fare_quote_id, pricing_version_id, fare_paise, tax_paise,
                          platform_fee_paise, confirmed_at)
         VALUES ('MIGCHECK-1', v_customer, 'MIGCHECK', 50000, 50000, 'PAY_AT_DELIVERY', v_rule,
                 'QUOTE_PER_STOP', v_quote, v_version, 50000, 0, 5000, v_now)
      RETURNING id INTO v_booking;
    INSERT INTO booking_stops (booking_id, fare_quote_stop_id, sequence, fare_paise, tax_paise,
                               payable_paise, platform_fee_share_paise)
         VALUES (v_booking, v_stop1, 1, 20000, 0, 20000, 2000),
                (v_booking, v_stop2, 2, 30000, 0, 30000, 3000);
    INSERT INTO trips (booking_id, driver_id) VALUES (v_booking, v_driver);
END;
$$;`;

/**
 * The first drop reached through the stop lifecycle (Phase 3), every guard on: the trip passes
 * the pickup (pay at delivery: nothing owed there) and starts, the drop is reached, and the trip
 * moves to DROP_PROGRESS with it.
 */
const STOP_ARRIVED_SQL = `
BEGIN;
UPDATE trips SET status = 'DRIVER_ARRIVED', arrived_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'IN_TRANSIT', started_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE booking_stops SET status = 'ARRIVED', arrived_at = now()
 WHERE sequence = 1 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'DROP_PROGRESS'
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
COMMIT;`;

/**
 * A QR shown for the drop the driver is at, as per-drop collection (Phase 4) writes it: every guard
 * on (the current drop, its own payable amount, the booking's trip and driver).
 */
const DROP_COLLECTION_SQL = `
INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method, amount_paise,
                                 collected_by_driver_id, status, provider, provider_product,
                                 provider_reference_id, idempotency_key)
SELECT b.id, s.id, t.id, 'DELIVERY', 'ONLINE_QR', s.payable_paise, t.driver_id, 'PENDING',
       'RAZORPAY', 'QR_CODE', 'qr_migcheck_drop_1', 'migcheck-drop-1'
  FROM bookings b
  JOIN booking_stops s ON s.booking_id = b.id AND s.sequence = 1
  JOIN trips t ON t.booking_id = b.id
 WHERE b.external_ref = 'MIGCHECK-1';`;

/**
 * Razorpay reports that QR paid: the collection completes, the drop's payment is confirmed and the
 * booking becomes PARTIALLY_PAID (one of its two drops), in one transaction, every guard on.
 */
const DROP_PAID_SQL = `
BEGIN;
UPDATE payment_collections
   SET status = 'COMPLETED', provider_payment_id = 'pay_migcheckdrop1', payment_method = 'UPI',
       completed_at = now()
 WHERE idempotency_key = 'migcheck-drop-1';
UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
 WHERE sequence = 1 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE bookings SET payment_status = 'PARTIALLY_PAID' WHERE external_ref = 'MIGCHECK-1';
COMMIT;`;

/** A settled payment that matches none of ours, recorded for review (Phase 5). */
const SETTLEMENT_FINDING_SQL = `
INSERT INTO settlement_findings (kind, provider_payment_id, provider_settlement_id, settled_at,
                                 settled_amount_paise, source)
VALUES ('UNKNOWN_PAYMENT', 'pay_migcheckunknown1', 'setl_migcheckfinding1', now(), 12345,
        'SIMULATED');`;

/**
 * Drop 1 handed over; drop 2 reached, paid by its own QR and handed over; the trip and the
 * booking completed; and the earning written as trip completion writes it (Phase 5): ONLINE,
 * funded by both QR collections (no payment or collection of its own), with its cash / online
 * split and payout amount, and one link per collection. Every guard on.
 */
const MULTI_COLLECTION_EARNING_SQL = `
BEGIN;
UPDATE booking_stops SET status = 'DELIVERED', delivered_at = now()
 WHERE sequence = 1 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE booking_stops SET status = 'ARRIVED', arrived_at = now()
 WHERE sequence = 2 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method, amount_paise,
                                 collected_by_driver_id, status, provider, provider_product,
                                 provider_reference_id, idempotency_key)
SELECT b.id, s.id, t.id, 'DELIVERY', 'ONLINE_QR', s.payable_paise, t.driver_id, 'PENDING',
       'RAZORPAY', 'QR_CODE', 'qr_migcheck_drop_2', 'migcheck-drop-2'
  FROM bookings b
  JOIN booking_stops s ON s.booking_id = b.id AND s.sequence = 2
  JOIN trips t ON t.booking_id = b.id
 WHERE b.external_ref = 'MIGCHECK-1';
COMMIT;
BEGIN;
UPDATE payment_collections
   SET status = 'COMPLETED', provider_payment_id = 'pay_migcheckdrop2', payment_method = 'UPI',
       completed_at = now()
 WHERE idempotency_key = 'migcheck-drop-2';
UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
 WHERE sequence = 2 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE bookings SET payment_status = 'PAID' WHERE external_ref = 'MIGCHECK-1';
COMMIT;
BEGIN;
UPDATE booking_stops SET status = 'DELIVERED', delivered_at = now()
 WHERE sequence = 2 AND booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'DELIVERED', delivered_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE trips SET status = 'COMPLETED', completed_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');
UPDATE bookings SET status = 'DRIVER_ASSIGNED' WHERE external_ref = 'MIGCHECK-1';
UPDATE bookings SET status = 'COMPLETED', completed_at = now() WHERE external_ref = 'MIGCHECK-1';
DO $$
DECLARE
    v_booking RECORD;
    v_earning UUID;
BEGIN
    SELECT b.id, b.fee_rule_id, t.id AS trip_id, t.driver_id
      INTO v_booking
      FROM bookings b JOIN trips t ON t.booking_id = b.id
     WHERE b.external_ref = 'MIGCHECK-1';
    INSERT INTO driver_earnings (booking_id, trip_id, driver_id, settlement, status,
                                 gross_amount_paise, platform_fee_paise, net_amount_paise,
                                 fee_rule_id, cash_collected_paise, online_collected_paise,
                                 cash_fee_paise, online_fee_paise, payout_amount_paise)
         VALUES (v_booking.id, v_booking.trip_id, v_booking.driver_id, 'ONLINE',
                 'AWAITING_SETTLEMENT', 50000, 5000, 45000, v_booking.fee_rule_id, 0, 50000, 0,
                 5000, 45000)
      RETURNING id INTO v_earning;
    INSERT INTO earning_collections (collection_id, earning_id, booking_id, method, amount_paise,
                                     platform_fee_paise, net_amount_paise)
    SELECT c.id, v_earning, c.booking_id, c.method, c.amount_paise, s.platform_fee_share_paise,
           c.amount_paise - s.platform_fee_share_paise
      FROM payment_collections c
      JOIN booking_stops s ON s.id = c.booking_stop_id
     WHERE c.booking_id = v_booking.id AND c.status = 'COMPLETED';
END;
$$;
COMMIT;`;

/** Razorpay's settlement of one drop's QR payment, as the settlement sync records it. */
const dropSettlementSql = (drop) => `
INSERT INTO payment_settlements (provider_payment_id, provider_settlement_id, settled_at,
                                 amount_paise, booking_id, collection_id, source)
SELECT c.provider_payment_id, 'setl_migcheckdrop${drop}', now(), c.amount_paise, c.booking_id,
       c.id, 'SIMULATED'
  FROM payment_collections c
 WHERE c.idempotency_key = 'migcheck-drop-${drop}';`;

/** The earning funded by both drops becomes PAYABLE (the settlement sync's promotion). */
const MULTI_COLLECTION_PAYABLE_SQL = `
UPDATE driver_earnings SET status = 'PAYABLE', payable_at = now()
 WHERE booking_id = (SELECT id FROM bookings WHERE external_ref = 'MIGCHECK-1');`;

/**
 * Payment flow Phase 6: an admin's provider refund of drop 1's QR payment on the completed
 * booking, written as the refunds service writes it (every guard on): recorded PENDING with the
 * booking REFUND_PENDING, accepted by the provider (PROCESSING), then processed (COMPLETED) with
 * the booking PARTIALLY_REFUNDED. The collection's refunded amount is kept by the database.
 */
const REFUND_SQL = `
INSERT INTO users (phone, role) VALUES ('+919999900004', 'ADMIN');
BEGIN;
INSERT INTO payment_refunds (booking_id, booking_stop_id, source_collection_id, kind, status,
                             refund_case, amount_paise, reason, requested_by_user_id,
                             idempotency_key, provider, provider_payment_id)
SELECT c.booking_id, c.booking_stop_id, c.id, 'PROVIDER', 'PENDING', 'COMPLETED_BOOKING',
       c.amount_paise, 'Migration check refund', u.id, 'migcheck-refund-1', 'RAZORPAY',
       c.provider_payment_id
  FROM payment_collections c, users u
 WHERE c.idempotency_key = 'migcheck-drop-1' AND u.phone = '+919999900004';
UPDATE bookings SET payment_status = 'REFUND_PENDING' WHERE external_ref = 'MIGCHECK-1';
COMMIT;
UPDATE payment_refunds
   SET status = 'PROCESSING', provider_refund_id = 'rfnd_migcheck00001', provider_status = 'pending'
 WHERE idempotency_key = 'migcheck-refund-1';
BEGIN;
UPDATE payment_refunds
   SET status = 'COMPLETED', provider_status = 'processed', completed_at = now()
 WHERE idempotency_key = 'migcheck-refund-1';
UPDATE bookings SET payment_status = 'PARTIALLY_REFUNDED' WHERE external_ref = 'MIGCHECK-1';
COMMIT;`;

/** A second refund of drop 1, already refunded in full: the database refuses it. */
const OVER_REFUND_SQL = `
INSERT INTO payment_refunds (booking_id, booking_stop_id, source_collection_id, kind, status,
                             refund_case, amount_paise, reason, requested_by_user_id,
                             idempotency_key, provider, provider_payment_id)
SELECT c.booking_id, c.booking_stop_id, c.id, 'PROVIDER', 'PENDING', 'COMPLETED_BOOKING', 1,
       'Migration check over-refund', u.id, 'migcheck-refund-2', 'RAZORPAY', c.provider_payment_id
  FROM payment_collections c, users u
 WHERE c.idempotency_key = 'migcheck-drop-1' AND u.phone = '+919999900004';`;

/** Phase 7: an event written by hand, not by a financial record's trigger: refused. */
const FORGED_EVENT_SQL = `
INSERT INTO financial_events (occurred_at, transaction_id, entity_type, entity_id, action, changes,
                              actor_type, db_role)
VALUES (now(), 1, 'BOOKING', gen_random_uuid(), 'CREATED', '{}', 'ADMIN', 'migcheck');`;

/** Phase 7: a scheduled reconciliation run, leased and finished as the runs service does. */
const RECONCILIATION_RUN_SQL = `
INSERT INTO reconciliation_runs (job, triggered_by, lease_expires_at)
VALUES ('RECONCILIATION', 'SCHEDULE', clock_timestamp() + interval '30 minutes');
UPDATE reconciliation_runs
   SET status = 'COMPLETED', finished_at = clock_timestamp(), summary = '{"checks": []}'
 WHERE job = 'RECONCILIATION' AND status = 'RUNNING';`;

/** Phase 7: a finding of that run, then resolved with a note by the fixture admin. */
const RECONCILIATION_FINDING_SQL = `
INSERT INTO reconciliation_findings (category, kind, severity, source, fingerprint, entity_type,
                                     entity_id, first_run_id, last_run_id)
SELECT 'WALLET_MISMATCH', 'MIGCHECK_FINDING', 'INFO', 'DATABASE', 'MIGCHECK_FINDING|1', 'TEST',
       'migcheck', r.id, r.id
  FROM reconciliation_runs r WHERE r.job = 'RECONCILIATION';
UPDATE reconciliation_findings
   SET status = 'RESOLVED', resolved_at = now(),
       resolved_by_user_id = (SELECT id FROM users WHERE phone = '+919999900004'),
       resolution_note = 'Migration check: reviewed and closed'
 WHERE fingerprint = 'MIGCHECK_FINDING|1';`;

/**
 * Phase 6, after every deploy: no collection shows a refund it never had, no refund was invented,
 * and (reported, not failed) every booking's payment status is what its money says.
 */
async function checkRefunds(scope, client, before) {
  const { rows } = await client.query(`
    SELECT (SELECT count(*)::int FROM payment_refunds) AS refunds,
           (SELECT count(*)::int FROM payment_collections WHERE refunded_paise <> 0) AS refunded,
           (SELECT count(*)::int FROM bookings
             WHERE payment_status::text <> booking_money_status(id)) AS mismatched`);
  const [row] = rows;
  if (row.refunds === before.refunds) {
    pass(`refunds unchanged by the migration (${row.refunds})`);
  } else {
    fail(scope, `refunds went from ${before.refunds} to ${row.refunds}`);
  }
  if (row.refunded === 0 || before.refunds > 0) {
    pass('no collection shows a refunded amount it never had');
  } else {
    fail(scope, `${row.refunded} collection(s) show a refunded amount without any refund`);
  }
  console.log(
    `  info ${row.mismatched} booking(s) whose payment status differs from booking_money_status` +
      (row.mismatched > 0 ? ' (review before refunding them)' : ''),
  );
}

/** Rows in the financial event log, or 0 before 20261021120000 created it. */
async function financialEventCount(client) {
  const { rows } = await client.query(
    "SELECT to_regclass('public.financial_events') IS NOT NULL AS present",
  );
  if (!rows[0].present) {
    return 0;
  }
  return (await client.query('SELECT count(*)::int AS n FROM financial_events')).rows[0].n;
}

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
    await client.query(PER_STOP_BOOKING_SQL);
    pass('a QUOTE_PER_STOP booking passes every guard when written like registration does');
    await client.query(STOP_ARRIVED_SQL);
    pass('a drop is reached through the stop lifecycle with every guard on');
    await expectRefused(
      'fresh',
      client,
      STOP_SCHEMA_MIGRATION,
      /booking stops have lifecycle data/,
      'a stop has lifecycle data',
    );
    await client.query(DROP_COLLECTION_SQL);
    pass('a QR is shown for the drop the driver is at with every guard on');
    await client.query(DROP_PAID_SQL);
    pass('a paid drop confirms its payment and partly pays its booking with every guard on');
    await expectRefused(
      'fresh',
      client,
      OBLIGATION_MIGRATION,
      /drops have their own collections/,
      'a drop has its own collection',
    );
    await expectRefused(
      'fresh',
      client,
      ENUMS_MIGRATION,
      /some bookings are PARTIALLY_PAID/,
      'a booking is partially paid',
    );
    await expectRefused(
      'fresh',
      client,
      STOP_SCHEMA_MIGRATION,
      /collections for single drops exist/,
      'a collection names a drop',
    );
    await expectRefused(
      'fresh',
      client,
      SNAPSHOT_MIGRATION,
      /QUOTE_PER_STOP bookings exist/,
      'a QUOTE_PER_STOP booking exists',
    );

    // Payment flow Phase 5: a settlement finding; then the trip finished with both drops paid
    // by their own QR, its earning funded by both, payable only once both are settled.
    await client.query(SETTLEMENT_FINDING_SQL);
    pass('a settlement finding is recorded with every guard on');
    await expectRefused(
      'fresh',
      client,
      MIXED_EARNINGS_MIGRATION,
      /settlement findings are recorded/,
      'a settlement finding is recorded',
    );
    await client.query(MULTI_COLLECTION_EARNING_SQL);
    pass('a trip paid by two drop QRs completes with one earning funded by both, every guard on');
    await client.query(dropSettlementSql(1));
    const early = await client.query(MULTI_COLLECTION_PAYABLE_SQL).then(
      () => null,
      (error) => (error instanceof Error ? error.message : String(error)),
    );
    if (early && /online collections have no merchant settlement yet/.test(early)) {
      pass('that earning is not payable while one of its QRs is unsettled');
    } else {
      fail('fresh', `payable with one QR unsettled: ${early ?? 'it was allowed'}`);
    }
    await client.query(dropSettlementSql(2));
    await client.query(MULTI_COLLECTION_PAYABLE_SQL);
    pass('it becomes payable once both QRs are settled');
    await expectRefused(
      'fresh',
      client,
      MIXED_EARNINGS_MIGRATION,
      /earnings funded by several collections have been made payable/,
      'an earning funded by several collections is payable',
    );

    // Payment flow Phase 6: a provider refund of drop 1, recorded, accepted and processed.
    await client.query(REFUND_SQL);
    const refunded = await client.query(`
      SELECT c.refunded_paise::text AS refunded, b.payment_status::text AS status
        FROM payment_collections c JOIN bookings b ON b.id = c.booking_id
       WHERE c.idempotency_key = 'migcheck-drop-1'`);
    if (refunded.rows[0]?.refunded === '20000' && refunded.rows[0]?.status === 'PARTIALLY_REFUNDED') {
      pass('a provider refund of one drop completes with every guard on: refunded_paise kept, booking PARTIALLY_REFUNDED');
    } else {
      fail('fresh', `refund effects: ${JSON.stringify(refunded.rows[0] ?? null)}`);
    }
    const over = await client.query(OVER_REFUND_SQL).then(
      () => null,
      (error) => (error instanceof Error ? error.message : String(error)),
    );
    if (over && /never exceed what was collected/.test(over)) {
      pass('a refund beyond what the drop collected is refused');
    } else {
      fail('fresh', `over-refund: ${over ?? 'it was allowed'}`);
    }
    await expectRefused(
      'fresh',
      client,
      REFUNDS_MIGRATION,
      /refunds are recorded/,
      'a refund is recorded',
    );
    await expectRefused(
      'fresh',
      client,
      REFUND_ENUM_MIGRATION,
      /some bookings are PARTIALLY_REFUNDED/,
      'a booking is partially refunded',
    );

    // Payment flow Phase 7: every fixture write above is in the financial event log, which no
    // role can change; a reconciliation run and a resolved finding are recorded with every guard
    // on, and each down.sql then refuses (newest first).
    const { rows: logRows } = await client.query(`
      SELECT count(*)::int AS events,
             count(DISTINCT entity_type)::int AS entity_types,
             count(*) FILTER (WHERE action = 'STATUS_CHANGED')::int AS status_changes,
             bool_and(actor_type = 'UNATTRIBUTED' AND db_role = session_user) AS unattributed
        FROM financial_events`);
    const [log] = logRows;
    if (log.events > 0 && log.entity_types >= 6 && log.status_changes > 0 && log.unattributed) {
      pass(
        `the fixture writes are in the financial event log: ${log.events} events over ` +
          `${log.entity_types} record types, unattributed and naming the database role`,
      );
    } else {
      fail('fresh', `financial event log: ${JSON.stringify(log)}`);
    }
    for (const [label, sql, pattern] of [
      ['changed', "UPDATE financial_events SET origin = 'migcheck'", /append-only/],
      ['deleted', 'DELETE FROM financial_events', /append-only/],
      ['truncated', 'TRUNCATE financial_events', /append-only/],
      ['written directly', FORGED_EVENT_SQL, /written only by the financial record triggers/],
    ]) {
      const refused = await client.query(sql).then(
        () => null,
        (error) => (error instanceof Error ? error.message : String(error)),
      );
      if (refused && pattern.test(refused)) {
        pass(`a financial event can't be ${label}, even by the owner`);
      } else {
        fail('fresh', `financial event ${label}: ${refused ?? 'it was allowed'}`);
      }
    }
    await client.query(RECONCILIATION_RUN_SQL);
    pass('a reconciliation run is recorded and finished with every guard on');
    await expectRefused(
      'fresh',
      client,
      FINDINGS_MIGRATION,
      /reconciliation runs are recorded/,
      'a reconciliation run is recorded',
    );
    await client.query(RECONCILIATION_FINDING_SQL);
    pass('a reconciliation finding is recorded and resolved by an admin with every guard on');
    await expectRefused(
      'fresh',
      client,
      FINDINGS_MIGRATION,
      /reconciliation findings are recorded/,
      'a reconciliation finding is recorded',
    );
    await expectRefused(
      'fresh',
      client,
      EVENTS_MIGRATION,
      /financial events are recorded/,
      'financial events are recorded',
    );
    compareCatalogs(
      'fresh',
      'schema unchanged after the refused rollbacks',
      await catalog(client),
      reference,
    );
  });
  return reference;
}

/**
 * The schema before each migration that has a down.sql, built by applying the migration files
 * directly, in order (independently of any down.sql). Applying all of them must give the
 * fresh-install schema. Then each down.sql runs on that empty schema, newest first, and must land
 * on the schema before its migration; and one refusal that needs the earlier schema is checked.
 */
async function levelReferences(admin, fresh) {
  console.log(`\n== Schema before each reversible migration (${LEVELS_DB})`);
  const names = migrationNames();
  const reversible = names.filter(hasDown);
  for (const required of [
    SNAPSHOT_MIGRATION,
    STOP_SCHEMA_MIGRATION,
    STOP_LIFECYCLE_MIGRATION,
    ENUMS_MIGRATION,
    OBLIGATION_MIGRATION,
    MIXED_EARNINGS_MIGRATION,
    REFUND_ENUM_MIGRATION,
    REFUNDS_MIGRATION,
    EVENTS_MIGRATION,
    FINDINGS_MIGRATION,
  ]) {
    if (!reversible.includes(required)) {
      throw new Error(`Expected ${required} to have a down.sql`);
    }
  }
  await createDatabase(admin, LEVELS_DB);
  return withDatabase(LEVELS_DB, async (client) => {
    const levels = new Map();
    for (const name of names) {
      if (hasDown(name)) {
        levels.set(name, await catalog(client));
        pass(`schema before ${name}: ${levels.get(name).length} schema objects`);
      }
      await client.query(migrationSql(name));
    }
    compareCatalogs(
      'levels',
      'every migration file applied in order = fresh install',
      await catalog(client),
      fresh,
    );

    for (const name of [...reversible].reverse()) {
      const refused = await runDown(client, name);
      if (refused) {
        fail('levels', `${name} down.sql on an empty schema: ${refused}`);
        return levels;
      }
      compareCatalogs(
        'levels',
        `${name} down.sql = schema before it`,
        await catalog(client),
        levels.get(name),
      );
    }

    // The snapshot migration again (the stop schema doesn't matter here), then a 6-drop quote.
    await client.query(migrationSql(SNAPSHOT_MIGRATION));
    await client.query(SIX_DROP_QUOTE_SQL);
    await expectRefused(
      'levels',
      client,
      SNAPSHOT_MIGRATION,
      /more than 5 drops/,
      'a quote has more than 5 drops',
    );
    return levels;
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
    const refundsTable = await client.query(
      "SELECT to_regclass('public.payment_refunds') IS NOT NULL AS present",
    );
    return {
      columns,
      rows: await rowFingerprints(client, columns),
      history: await migrationHistory(client),
      state: await sourceState(client),
      refunds: refundsTable.rows[0].present
        ? (await client.query('SELECT count(*)::int AS n FROM payment_refunds')).rows[0].n
        : 0,
      events: await financialEventCount(client),
    };
  });
  const pending = migrationNames().filter(
    (name) => !before.history.some((row) => row.name === name && row.finished),
  );
  console.log(`  pending migrations: ${pending.join(', ') || '(none)'}`);
  if (pending.length === 0) {
    // Nothing to prove on a database that is already migrated.
    console.log('  skipped: nothing pending');
    skipped.add(source);
    return;
  }
  checked.add(source);

  /** The checks that hold after every successful deploy. */
  const afterDeploy = async (client, label) => {
    compareRows(
      scope,
      `${label}: pre-existing rows`,
      await rowFingerprints(client, before.columns),
      before.rows,
    );
    if (!before.state.has_payment_model) {
      await checkLegacyMarking(scope, client);
    }
    await checkStops(scope, client, before.state);
    await checkEarningSplit(scope, client);
    await checkRefunds(scope, client, before);
    // Phase 7: the event log starts empty; a migration that changed a financial row would show.
    const events = await financialEventCount(client);
    if (events === before.events) {
      pass(`no financial event recorded by the migration (${events} before and after)`);
    } else {
      fail(scope, `financial events went from ${before.events} to ${events}`);
    }
    compareCatalogs(
      scope,
      `${label}: schema = fresh install`,
      await catalog(client),
      references.fresh,
    );
  };

  migrateDeploy(copy);
  await withDatabase(copy, async (client) => {
    await afterDeploy(client, 'up');
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
  });

  // Roll back what was applied, newest first, as far as down scripts go.
  await withDatabase(copy, async (client) => {
    for (const name of [...pending].reverse()) {
      if (!hasDown(name)) {
        console.log(`  rollback stops at ${name} (it has no down.sql)`);
        break;
      }
      const refused = await runDown(client, name);
      if (refused) {
        fail(scope, `${name} down.sql failed: ${refused}`);
        return;
      }
      compareRows(
        scope,
        `down ${name}: pre-existing rows`,
        await rowFingerprints(client, before.columns),
        before.rows,
      );
      compareCatalogs(
        scope,
        `down ${name}: schema = schema before it`,
        await catalog(client),
        references.levels.get(name),
      );
    }
  });

  migrateDeploy(copy);
  await withDatabase(copy, (client) => afterDeploy(client, 'up again'));
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const sources = args.filter((arg) => !arg.startsWith('--'));
  const admin = new pg.Client({ connectionString: serverUrl().toString() });
  await admin.connect();
  try {
    const fresh = await freshReference(admin);
    const levels = await levelReferences(admin, fresh);
    for (const source of sources.length > 0 ? sources : DEFAULT_SOURCES) {
      try {
        await checkSource(admin, source, { fresh, levels });
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
    problems.push('[sources] no source had a pending migration, so nothing was proven');
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
