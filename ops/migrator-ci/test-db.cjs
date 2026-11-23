'use strict';
const { a, connect, history, snapshot, schema } = require('./db.cjs');
const checks = [];
(async () => {
  const c = await connect();
  try {
    a.equal((await c.query('SHOW server_version')).rows[0].server_version, '16.15');
    const mode = process.argv[2],
      n = mode === 'before' ? 32 : 33,
      h = await history(c, n);
    const t = (
      await c.query(
        "SELECT t.tgenabled,p.prosecdef,pg_get_userbyid(p.proowner) AS owner FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='delivery_proofs'::regclass AND t.tgname='delivery_proof_immutable_binding_and_receipt'",
      )
    ).rows;
    if (mode === 'before') a.equal(t.length, 0);
    else {
      a.equal(t.length, 1);
      a.equal(t[0].tgenabled, 'O');
      a.equal(t[0].prosecdef, false);
      a.equal(t[0].owner, 'ci_owner');
    }
    if (mode === 'trigger-tests') {
      await c.query('BEGIN');
      const id = '00000000-0000-4000-8000-000000000011';
      async function deny(name, sql, params = []) {
        await c.query('SAVEPOINT probe');
        let code;
        try {
          await c.query(sql, params);
        } catch (e) {
          code = e.code;
        }
        await c.query('ROLLBACK TO SAVEPOINT probe');
        a.equal(code, '23514', name);
        checks.push({ name, result: 'PASS' });
      }
      for (const [col, expr] of Object.entries({
        id: 'gen_random_uuid()',
        payment_trip_id: 'gen_random_uuid()',
        engine_trip_id: 'gen_random_uuid()',
        engine_stop_id: 'gen_random_uuid()',
        sequence: 'sequence+1',
        owner_subject: "'forbidden'",
        key: "key||'-changed'",
        content_type: "'image/jpeg'",
        size_bytes: 'size_bytes+1',
        created_at: "created_at+interval '1 day'",
      }))
        await deny('immutable ' + col, `UPDATE delivery_proofs SET ${col}=${expr} WHERE id=$1`, [
          id,
        ]);
      for (const [col, expr] of Object.entries({
        checksum_sha256: "repeat('b',64)",
        storage_version_id: "'changed'",
        storage_etag: "'changed'",
        verified_at: "verified_at+interval '1 day'",
      }))
        await deny(
          'verified receipt ' + col,
          `UPDATE delivery_proofs SET ${col}=${expr} WHERE id=$1`,
          [id],
        );
      await deny(
        'pending partial receipt',
        "UPDATE delivery_proofs SET checksum_sha256=repeat('b',64) WHERE id='00000000-0000-4000-8000-000000000010'",
      );
      await deny(
        'preverified INSERT',
        "INSERT INTO delivery_proofs SELECT gen_random_uuid(),payment_trip_id,engine_trip_id,engine_stop_id,sequence,owner_subject,key||'-copy',content_type,size_bytes,checksum_sha256,storage_version_id,storage_etag,created_at,verified_at FROM delivery_proofs WHERE id=$1",
        [id],
      );
      await c.query(
        "UPDATE delivery_proofs SET checksum_sha256=repeat('c',64),storage_version_id='synthetic-test-version',storage_etag='synthetic-test-etag',verified_at=now() WHERE id='00000000-0000-4000-8000-000000000010'",
      );
      checks.push({
        name: 'pending row can receive complete synthetic transaction-test receipt',
        result: 'PASS',
      });
      await c.query('ROLLBACK');
    }
    console.log(
      JSON.stringify({
        result: 'PASS',
        mode,
        PostgreSQL: '16.15',
        history: h,
        data: await snapshot(c),
        schema_sha256: await schema(c),
        trigger_present: t.length === 1,
        checks,
        probe_count: checks.length,
        no_API_started: true,
        synthetic_records_only: true,
      }),
    );
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
})().catch((e) => {
  console.log(JSON.stringify({ result: 'FAIL', code: e.code || e.name, checks }));
  process.exitCode = 1;
});
