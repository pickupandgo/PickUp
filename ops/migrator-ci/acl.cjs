'use strict';
const fs = require('node:fs'),
  a = require('node:assert/strict');
const ROLE = 'mr_backend_app_20261121',
  TABLE = 'public.delivery_proofs';
const allowed = ['checksum_sha256', 'storage_version_id', 'storage_etag', 'verified_at'];
const qi = (s) => '"' + s.replaceAll('"', '""') + '"',
  ql = (s) => "'" + s.replaceAll("'", "''") + "'";
const CAT = `WITH r AS (SELECT c.oid,c.relowner,c.relacl FROM pg_class c WHERE c.oid='public.delivery_proofs'::regclass),
 g AS (
 SELECT 'table'::text AS scope,''::text AS column_name,pg_get_userbyid(x.grantor) AS grantor,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type,x.is_grantable
 FROM r CROSS JOIN LATERAL aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) x
 UNION ALL
 SELECT 'column',at.attname::text,pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable
 FROM r JOIN pg_attribute at ON at.attrelid=r.oid AND at.attnum>0 AND NOT at.attisdropped CROSS JOIN LATERAL aclexplode(at.attacl) x)
 SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY scope,column_name,grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) AS acl FROM g`;
async function catalog(c) {
  return (await c.query(`SELECT acl,md5(acl::text) AS fingerprint FROM (${CAT}) s`)).rows[0];
}
function guard(db, operator, owner, fingerprint) {
  return `DO $release$ BEGIN
 IF current_database()<>${ql(db)} OR current_user<>${ql(operator)} THEN RAISE EXCEPTION 'Exact database/operator mismatch'; END IF;
 IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='${TABLE}'::regclass)<>${ql(owner)} THEN RAISE EXCEPTION 'Owner changed'; END IF;
 IF (SELECT md5(acl::text) FROM (${CAT}) s)<>${ql(fingerprint)} THEN RAISE EXCEPTION 'ACL changed; stop and recapture'; END IF;
END $release$;\n`;
}
function desired() {
  return `DO $release$ DECLARE col text; BEGIN
 IF NOT has_table_privilege('${ROLE}','${TABLE}','SELECT') OR NOT has_table_privilege('${ROLE}','${TABLE}','INSERT') THEN RAISE EXCEPTION 'Required SELECT/INSERT absent'; END IF;
 IF has_table_privilege('${ROLE}','${TABLE}','UPDATE') OR has_table_privilege('${ROLE}','${TABLE}','DELETE') OR has_table_privilege('${ROLE}','${TABLE}','TRUNCATE') OR has_table_privilege('${ROLE}','${TABLE}','TRIGGER') OR has_table_privilege('${ROLE}','${TABLE}','REFERENCES') THEN RAISE EXCEPTION 'Excess effective table privilege'; END IF;
 FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='${TABLE}'::regclass AND attnum>0 AND NOT attisdropped LOOP
  IF has_column_privilege('${ROLE}','${TABLE}',col,'UPDATE') IS DISTINCT FROM (col=ANY(ARRAY['checksum_sha256','storage_version_id','storage_etag','verified_at'])) THEN RAISE EXCEPTION 'Unexpected effective column UPDATE'; END IF;
 END LOOP;
END $release$;\n`;
}
async function plan(c, expectedDatabase) {
  const info = (
    await c.query(
      "SELECT current_database() AS db,current_user AS operator,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.delivery_proofs'::regclass",
    )
  ).rows[0];
  a.equal(info.db, expectedDatabase);
  a.notEqual(info.operator, ROLE);
  a.notEqual(info.owner, ROLE);
  const role = (
    await c.query(
      'SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=$1',
      [ROLE],
    )
  ).rows[0];
  a.ok(role, 'Expected runtime role missing');
  a.ok(!role.rolsuper && !role.rolcreaterole && !role.rolcreatedb && !role.rolbypassrls);
  a.equal(
    (await c.query("SELECT pg_has_role($1,$2,'MEMBER') AS member", [ROLE, info.owner])).rows[0]
      .member,
    false,
    'Runtime can assume table owner',
  );
  a.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='public' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1)",
        [ROLE],
      )
    ).rows[0].n,
    0,
    'Runtime owns schema',
  );
  a.equal(
    (
      await c.query(
        'SELECT count(*)::int AS n FROM pg_database WHERE datname=current_database() AND datdba=(SELECT oid FROM pg_roles WHERE rolname=$1)',
        [ROLE],
      )
    ).rows[0].n,
    0,
    'Runtime owns database',
  );
  const before = await catalog(c),
    direct = before.acl.filter((g) => g.grantee === ROLE);
  a.ok(!direct.some((g) => g.is_grantable));
  a.ok(!before.acl.some((g) => g.grantor === ROLE), 'Dependent grants require separate review');
  for (const g of before.acl) {
    if (g.grantee === 'PUBLIC') throw Error('PUBLIC proof privileges require separate approval');
    if (
      g.grantee !== ROLE &&
      ['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'INSERT'].includes(g.privilege_type)
    )
      a.equal(
        (await c.query("SELECT pg_has_role($1,$2,'MEMBER') AS member", [ROLE, g.grantee])).rows[0]
          .member,
        false,
        'Inherited/assumable writer requires separate review',
      );
  }
  const has = (
    await c.query(
      "SELECT has_table_privilege($1,$2,'SELECT') AS s,has_table_privilege($1,$2,'INSERT') AS i",
      [ROLE, TABLE],
    )
  ).rows[0];
  a.ok(has.s && has.i, 'Preserve existing SELECT/INSERT; do not silently add absent access');
  const columns = (
    await c.query(
      "SELECT attname FROM pg_attribute WHERE attrelid='public.delivery_proofs'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",
    )
  ).rows.map((r) => r.attname);
  const grantors = [...new Set([info.owner, ...direct.map((g) => g.grantor)])];
  for (const g of grantors)
    a.ok(
      (await c.query("SELECT pg_has_role(current_user,$1,'SET') AS allowed", [g])).rows[0].allowed,
      'Cannot preserve original grantor in exact rollback',
    );
  const header = "BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n";
  let apply = header + guard(info.db, info.operator, info.owner, before.fingerprint);
  for (const g of grantors) {
    apply += 'SET LOCAL ROLE ' + qi(g) + ';\n';
    apply += `REVOKE UPDATE,DELETE,TRUNCATE ON ${TABLE} FROM ${qi(ROLE)};\nREVOKE UPDATE (${columns.map(qi).join(',')}) ON ${TABLE} FROM ${qi(ROLE)};\nRESET ROLE;\n`;
  }
  apply +=
    'SET LOCAL ROLE ' +
    qi(info.owner) +
    `;\nGRANT SELECT,INSERT ON ${TABLE} TO ${qi(ROLE)};\nGRANT UPDATE (${allowed.map(qi).join(',')}) ON ${TABLE} TO ${qi(ROLE)};\nRESET ROLE;\n` +
    desired() +
    `SELECT md5(acl::text) AS post_acl_fingerprint FROM (${CAT}) s;\nCOMMIT;\n`;
  let rollback = header + guard(info.db, info.operator, info.owner, '__EXPECTED_POST_ACL_MD5__');
  for (const g of grantors) {
    rollback +=
      'SET LOCAL ROLE ' + qi(g) + `;\nREVOKE ALL PRIVILEGES ON ${TABLE} FROM ${qi(ROLE)};\n`;
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'])
      rollback += `REVOKE ${p} (${columns.map(qi).join(',')}) ON ${TABLE} FROM ${qi(ROLE)};\n`;
    rollback += 'RESET ROLE;\n';
  }
  for (const g of direct)
    rollback +=
      'SET LOCAL ROLE ' +
      qi(g.grantor) +
      `;\nGRANT ${g.privilege_type}${g.scope === 'column' ? ' (' + qi(g.column_name) + ')' : ''} ON ${TABLE} TO ${qi(ROLE)}${g.is_grantable ? ' WITH GRANT OPTION' : ''};\nRESET ROLE;\n`;
  rollback += guard(info.db, info.operator, info.owner, before.fingerprint) + 'COMMIT;\n';
  return {
    scope: {
      database: info.db,
      operator: info.operator,
      owner: info.owner,
      role: ROLE,
      table: TABLE,
      before_acl_md5: before.fingerprint,
    },
    before,
    apply,
    rollback,
    allowed_update_columns: allowed,
  };
}
module.exports = { ROLE, TABLE, allowed, CAT, catalog, plan, desired };
if (require.main === module)
  (async () => {
    const { connect, snapshot } = require('./db.cjs');
    const c = await connect();
    try {
      a.equal(process.argv[2], 'ci-test');
      await c.query(
        `CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; GRANT SELECT,INSERT,UPDATE,DELETE ON ${TABLE} TO ${ROLE}; GRANT SELECT(key),UPDATE(owner_subject) ON ${TABLE} TO ${ROLE};`,
      );
      const data = await snapshot(c),
        p = await plan(c, 'mr_migrator_upgrade_ci');
      // A stale before-state must be rejected atomically without applying the change.
      let stale = false;
      try {
        await c.query(p.apply.replace(p.scope.before_acl_md5, '0'.repeat(32)));
      } catch {
        stale = true;
        await c.query('ROLLBACK');
      }
      a.ok(stale);
      a.equal((await catalog(c)).fingerprint, p.scope.before_acl_md5);
      await c.query(p.apply);
      const post = await catalog(c);
      await c.query(desired());
      const q = (
        await c.query(
          "SELECT column_name FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='delivery_proofs' AND grantee=$1 AND privilege_type='UPDATE' ORDER BY column_name",
          [ROLE],
        )
      ).rows.map((x) => x.column_name);
      a.deepEqual(q, [...allowed].sort());
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE ' + qi(ROLE));
      let denied = false;
      try {
        await c.query('UPDATE delivery_proofs SET owner_subject=owner_subject WHERE false');
      } catch (e) {
        a.equal(e.code, '42501');
        denied = true;
      }
      await c.query('ROLLBACK');
      a.ok(denied);
      a.ok(/^[a-f0-9]{32}$/.test(post.fingerprint));
      await c.query(p.rollback.replace('__EXPECTED_POST_ACL_MD5__', post.fingerprint));
      a.equal((await catalog(c)).fingerprint, p.scope.before_acl_md5);
      a.deepEqual(await snapshot(c), data);
      console.log(
        JSON.stringify({
          result: 'PASS',
          role: ROLE,
          stale_ACL_fails_closed: true,
          scope_only_Backend_delivery_proofs: true,
          required_SELECT_INSERT_preserved: true,
          only_four_UPDATE_columns: true,
          effective_DELETE_TRUNCATE_and_table_UPDATE_denied: true,
          unauthorized_column_write_denied: true,
          exact_grantor_and_table_and_column_ACL_rollback: true,
          all_existing_records_unchanged: true,
          real_RDS_contact: false,
        }),
      );
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  })().catch((e) => {
    console.log(JSON.stringify({ result: 'FAIL', code: e.code || e.name }));
    process.exitCode = 1;
  });
