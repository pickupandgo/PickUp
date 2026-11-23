'use strict';
const a = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const i = JSON.parse(fs.readFileSync('/release/inventory.json'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const files = [];
function walk(p) {
  for (const d of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, d.name);
    if (d.isDirectory()) walk(f);
    else {
      a.ok(d.isFile());
      files.push(f.replace('/app/', ''));
    }
  }
}
walk('/app/prisma/migrations');
a.deepEqual(files.sort(), Object.keys(i.all_history_files).sort());
for (const f of files) a.equal(hash(fs.readFileSync('/app/' + f)), i.all_history_files[f]);
a.equal(hash(fs.readFileSync('/app/prisma/schema.prisma')), i.schema_sha256);
a.equal(hash(fs.readFileSync('/app/package-lock.json')), i.lock_sha256);
a.equal(i.count, 33);
a.equal(i.only_pending_migration.name, '20261123120000_delivery_proof_immutability');
a.equal(
  i.only_pending_migration.sha256,
  'a68679aba90da7daacc685793adb39f38c6087056e91b8f5db8ea2a0bd60649c',
);
for (const f of ['/app/.env', '/app/.env.production', '/app/.git', '/app/src', '/app/dist'])
  a.equal(fs.existsSync(f), false);
a.equal(require('/app/node_modules/prisma/package.json').version, '7.10.0');
console.log(
  JSON.stringify({
    result: 'PASS',
    migration_count: 33,
    all_history_files: files.length,
    history_and_schema_and_lock_match_source: true,
    expected_new_checksum: true,
    Prisma: '7.10.0',
    API_code_or_environment_files: false,
  }),
);
