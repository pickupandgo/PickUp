'use strict';
// Actual non-owner runtime LOGIN, disposable synthetic DB only. All probes roll back.
const a = require('node:assert/strict'),
  { randomUUID, createHash } = require('node:crypto');
const { photo } = require('./photo.cjs');
const { Client } =
  require('node:module').createRequire('/app/package.json')('pg');
const checks = [];
const u = new URL(process.env.DATABASE_URL);
a.equal(u.hostname, '172.29.63.2');
a.equal(u.pathname, '/mr_joint_backend_e2e');
a.equal(u.username, 'mr_app');
const c = new Client({
  connectionString: u.href,
  connectionTimeoutMillis: 3000,
});
async function test(name, fn) {
  await c.query('SAVEPOINT probe');
  try {
    await fn();
    checks.push({ name, result: 'PASS' });
  } catch (e) {
    checks.push({ name, result: 'FAIL', code: e.code || e.name });
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT probe');
  }
}
async function deny(sql, params, code = '42501') {
  try {
    await c.query(sql, params);
  } catch (e) {
    a.equal(e.code, code);
    return;
  }
  throw Error('UNEXPECTED_ALLOWED_OPERATION');
}
(async () => {
  await c.connect();
  try {
    const role = (
      await c.query(
        'SELECT current_user,rolsuper,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    a.equal(role.current_user, 'mr_app');
    a.ok(
      !role.rolsuper &&
        !role.rolcreaterole &&
        !role.rolcreatedb &&
        !role.rolinherit,
    );
    const source = (
      await c.query(
        'SELECT * FROM delivery_proofs WHERE verified_at IS NOT NULL ORDER BY id LIMIT 1',
      )
    ).rows[0];
    a.ok(
      source,
      'Actual HTTP flow must have verified a real synthetic photo first',
    );
    a.equal(
      source.checksum_sha256,
      createHash('sha256').update(photo()).digest('hex'),
    );
    a.notEqual(
      (
        await c.query(
          "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='delivery_proofs'::regclass",
        )
      ).rows[0].owner,
      'mr_app',
    );
    await c.query('BEGIN');
    await test('runtime SELECT of actual verified proof succeeds', async () =>
      a.equal(
        (
          await c.query('SELECT id FROM delivery_proofs WHERE id=$1', [
            source.id,
          ])
        ).rowCount,
        1,
      ));
    await test('runtime INSERT of new pending proof succeeds', async () => {
      const r = await c.query(
        'INSERT INTO delivery_proofs(id,payment_trip_id,engine_trip_id,engine_stop_id,sequence,owner_subject,key,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING verified_at',
        [
          randomUUID(),
          source.payment_trip_id,
          source.engine_trip_id,
          source.engine_stop_id,
          source.sequence,
          source.owner_subject,
          'delivery-proofs/grant-probe/' + randomUUID(),
          source.content_type,
          source.size_bytes,
        ],
      );
      a.equal(r.rows[0].verified_at, null);
    });
    const allowed = [
      'checksum_sha256',
      'storage_version_id',
      'storage_etag',
      'verified_at',
    ];
    for (const col of allowed)
      await test(
        'column UPDATE allowed on ' + col + ' without rewriting receipt',
        async () =>
          a.equal(
            (
              await c.query(
                `UPDATE delivery_proofs SET ${col}=${col} WHERE id=$1`,
                [source.id],
              )
            ).rowCount,
            1,
          ),
      );
    const immutable = [
      'id',
      'payment_trip_id',
      'engine_trip_id',
      'engine_stop_id',
      'sequence',
      'owner_subject',
      'key',
      'content_type',
      'size_bytes',
      'created_at',
    ];
    for (const col of immutable)
      await test('column UPDATE denied on ' + col, () =>
        deny(`UPDATE delivery_proofs SET ${col}=${col} WHERE id=$1`, [
          source.id,
        ]),
      );
    await test('DELETE denied even with empty predicate', () =>
      deny('DELETE FROM delivery_proofs WHERE false'));
    await test('TRUNCATE denied', () => deny('TRUNCATE delivery_proofs'));
    await test('unrestricted UPDATE privilege absent', async () =>
      a.equal(
        (
          await c.query(
            "SELECT has_table_privilege(current_user,'delivery_proofs','UPDATE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      ));
    await test('verified checksum rewrite denied by invoker trigger', () =>
      deny(
        "UPDATE delivery_proofs SET checksum_sha256=repeat('a',64) WHERE id=$1",
        [source.id],
        '23514',
      ));
    await test('verified version rewrite denied by invoker trigger', () =>
      deny(
        "UPDATE delivery_proofs SET storage_version_id='synthetic-forbidden-rewrite' WHERE id=$1",
        [source.id],
        '23514',
      ));
    await test('verification state reset denied by invoker trigger', () =>
      deny(
        'UPDATE delivery_proofs SET verified_at=NULL WHERE id=$1',
        [source.id],
        '23514',
      ));
    await test('preverified INSERT denied; API verification cannot be skipped', () =>
      deny(
        'INSERT INTO delivery_proofs SELECT $1::uuid,payment_trip_id,engine_trip_id,engine_stop_id,sequence,owner_subject,$2,content_type,size_bytes,checksum_sha256,storage_version_id,storage_etag,created_at,verified_at FROM delivery_proofs WHERE id=$3',
        [randomUUID(), 'delivery-proofs/forbidden/' + randomUUID(), source.id],
        '23514',
      ));
    await test('schema CREATE denied', () =>
      deny('CREATE TABLE public.forbidden_proof_privilege_probe(id int)'));
    await c.query('ROLLBACK');
    const actual = (
      await c.query(
        'SELECT checksum_sha256,storage_version_id,storage_etag,verified_at FROM delivery_proofs WHERE id=$1',
        [source.id],
      )
    ).rows[0];
    for (const col of allowed) a.deepEqual(actual[col], source[col]);
    console.log(
      JSON.stringify({
        result: checks.some((x) => x.result === 'FAIL') ? 'FAIL' : 'PASS',
        passed: checks.filter((x) => x.result === 'PASS').length,
        failed: checks.filter((x) => x.result === 'FAIL').length,
        checks,
        all_probes_rolled_back: true,
        actual_API_verification_required_first: true,
        receipt_unchanged: true,
      }),
    );
    process.exitCode = checks.some((x) => x.result === 'FAIL') ? 1 : 0;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
})().catch((e) => {
  console.log(
    JSON.stringify({ result: 'FAIL', fatal: e.code || e.name, checks }),
  );
  process.exitCode = 1;
});
