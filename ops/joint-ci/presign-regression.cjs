'use strict';
const a = require('node:assert/strict');
const { loadConfig } = require('/app/dist/config/app-config.js');
const {
  DocumentStorageService,
} = require('/app/dist/onboarding/document-storage.service.js');
(async () => {
  const c = loadConfig();
  a.equal(c.nodeEnv, 'test');
  a.equal(c.documents.storage.endpoint, 'https://172.29.63.5:9000');
  const s = new DocumentStorageService(c);
  const p = await s.uploadUrl({
    key: 'delivery-proofs/synthetic/1/regression',
    documentId: 'regression',
    contentType: 'image/png',
    sizeBytes: 512,
  });
  const u = new URL(p.url),
    empty = u.searchParams.get('x-amz-checksum-crc32') === 'AAAAAA==';
  if (process.argv[2] === 'legacy') a.equal(empty, true);
  else {
    a.equal(process.argv[2], 'fixed');
    a.equal(u.searchParams.get('x-amz-checksum-crc32'), null);
    a.equal(u.searchParams.get('x-amz-sdk-checksum-algorithm'), null);
  }
  a.equal(p.headers['x-amz-server-side-encryption'], 'AES256');
  console.log(
    JSON.stringify({
      result: 'PASS',
      mode: process.argv[2],
      nonempty_photo_size: 512,
      empty_body_CRC32_signed: empty,
      URL_or_credentials_logged: false,
      network_request_performed: false,
    }),
  );
})().catch((e) => {
  console.error('PRESIGN_REGRESSION_FAILED ' + e.name);
  process.exitCode = 1;
});
