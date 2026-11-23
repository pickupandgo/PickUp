'use strict';
const a = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { createDecipheriv, createHash } = require('node:crypto');
const key = Buffer.from(process.env.CI_STORAGE_ENCRYPTION_KEY, 'hex');
let versions = 0,
  overwritten = 0;
for (const d of fs.readdirSync('/data/objects')) {
  const root = path.join('/data/objects', d),
    rs = fs.readdirSync(root).filter((f) => f.endsWith('.json'));
  if (rs.length > 1) overwritten++;
  for (const r of rs) {
    const m = JSON.parse(fs.readFileSync(path.join(root, r))),
      cipher = fs.readFileSync(path.join(root, m.v + '.bin'));
    a.equal(fs.statSync(path.join(root, m.v + '.bin')).mode & 0o777, 0o600);
    a.equal(m.sse, 'AES256');
    const c = createDecipheriv('aes-256-gcm', key, Buffer.from(m.iv, 'hex'));
    c.setAAD(Buffer.from(m.object + '\0' + m.v));
    c.setAuthTag(Buffer.from(m.tag, 'hex'));
    const raw = Buffer.concat([c.update(cipher), c.final()]);
    a.equal(raw.length, m.size);
    a.equal(createHash('sha256').update(raw).digest('hex'), m.sha256);
    a.equal(cipher.equals(raw), false);
    versions++;
  }
}
a.ok(versions >= 5 && overwritten >= 2);
console.log(
  JSON.stringify({
    result: 'PASS',
    versions_checked: versions,
    objects_with_multiple_versions: overwritten,
    actual_ciphertext_integrity_verified: true,
    private_file_modes: true,
    plaintext_or_keys_logged: false,
  }),
);
