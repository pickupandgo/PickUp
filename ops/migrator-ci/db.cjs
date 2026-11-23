'use strict';
const a = require('node:assert/strict'),
  fs = require('node:fs'),
  tls = require('node:tls'),
  { createHash } = require('node:crypto');
const { Client } = require('/app/node_modules/pg');
const inventory = JSON.parse(fs.readFileSync('/release/inventory.json'));
const ident = (s) => '"' + s.replaceAll('"', '""') + '"';
async function connect() {
  a.equal(process.env.MR_MIGRATOR_CI, 'true');
  const u = new URL(process.env.DATABASE_URL);
  a.equal(u.hostname, '127.0.0.1');
  a.ok(['mr_migrator_upgrade_ci', 'mr_migrator_fresh_ci'].includes(u.pathname.slice(1)));
  a.ok(u.password.startsWith('dummy_migrator_ci_'));
  const c = new Client({
    host: u.hostname,
    port: 5432,
    database: u.pathname.slice(1),
    user: u.username,
    password: u.password,
    connectionTimeoutMillis: 3000,
    ssl: { ca: fs.readFileSync('/ci-ca.pem'), rejectUnauthorized: true },
  });
  await c.connect();
  a.equal(c.connection.stream.authorized, true);
  a.equal(tls.checkServerIdentity(u.hostname, c.connection.stream.getPeerCertificate()), undefined);
  return c;
}
async function history(c, count) {
  const rows = (await c.query('SELECT * FROM _prisma_migrations ORDER BY migration_name,id')).rows;
  a.equal(rows.length, count);
  for (let x = 0; x < count; x++) {
    const r = rows[x],
      e = inventory.migrations[x];
    a.equal(r.migration_name, e.name);
    a.equal(r.checksum, e.sha256);
    a.ok(r.finished_at && !r.rolled_back_at && r.applied_steps_count === 1);
    a.equal(r.logs, null);
  }
  return rows;
}
async function snapshot(c) {
  const tables = (
    await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  a.equal(tables.length, 44);
  const data = {};
  for (const { tablename: t } of tables) {
    if (t === '_prisma_migrations') continue;
    const r = (
      await c.query(
        `SELECT count(*)::int AS rows,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]') AS contents FROM public.${ident(t)} t`,
      )
    ).rows[0];
    data[t] = { rows: r.rows, sha256: createHash('sha256').update(r.contents).digest('hex') };
  }
  return data;
}
async function schema(c) {
  const queries = [
    "SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    "SELECT c.relname,t.conname,pg_get_constraintdef(t.oid) AS definition FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.conname",
    "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
    "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,args",
  ];
  let rows = [];
  for (const q of queries) rows.push((await c.query(q)).rows);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
module.exports = { a, fs, ident, inventory, connect, history, snapshot, schema };
