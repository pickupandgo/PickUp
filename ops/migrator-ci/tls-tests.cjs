'use strict';
const a = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const base = new URL(process.env.DATABASE_URL),
  results = [];
for (const mode of ['trusted', 'wrong-CA', 'wrong-hostname']) {
  const u = new URL(base);
  if (mode === 'wrong-CA') u.searchParams.set('sslcert', '/bad-ca.pem');
  if (mode === 'wrong-hostname') u.hostname = '172.29.64.2';
  const r = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'status'], {
    cwd: '/app',
    env: { ...process.env, DATABASE_URL: u.href },
    encoding: 'utf8',
    timeout: 30000,
  });
  if (mode === 'trusted') a.equal(r.status, 0);
  else {
    a.notEqual(r.status, 0);
    a.match(r.stdout + r.stderr, /TLS|certificate|P1011/i);
  }
  results.push({ mode, result: 'PASS', CLI_exit: r.status });
}
console.log(
  JSON.stringify({
    result: 'PASS',
    Prisma_schema_engine_strict_TLS: true,
    checks: results,
    URL_or_credentials_logged: false,
  }),
);
