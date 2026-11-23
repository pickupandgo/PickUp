'use strict';
const a = require('node:assert/strict'),
  { randomUUID } = require('node:crypto');
const { photo } = require('./photo.cjs');
const r = require('node:module').createRequire('/app/package.json');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } =
  r('@aws-sdk/client-s3');
const checks = [];
const c = new S3Client({
  endpoint: 'http://172.29.63.5:9000',
  region: 'ap-south-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.CI_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.CI_STORAGE_SECRET,
  },
});
(async () => {
  const id = randomUUID(),
    Key = 'delivery-proofs/' + randomUUID() + '/1/' + id,
    Bucket = 'mr-proof-ci',
    Body = photo();
  const input = {
    Bucket,
    Key,
    Body,
    ContentType: 'image/png',
    ServerSideEncryption: 'AES256',
    Metadata: { documentid: id },
  };
  const p = await c.send(new PutObjectCommand(input));
  a.ok(p.VersionId);
  checks.push('official AWS SDK signed PUT accepted');
  const h = await c.send(new HeadObjectCommand({ Bucket, Key }));
  a.equal(h.VersionId, p.VersionId);
  a.equal(h.ServerSideEncryption, 'AES256');
  a.equal(h.ContentLength, Body.length);
  a.equal(h.Metadata.documentid, id);
  checks.push('HEAD returns actual version size metadata and encryption');
  const second = await c.send(
    new PutObjectCommand({ ...input, Body: photo(99) }),
  );
  a.notEqual(second.VersionId, p.VersionId);
  const g = await c.send(
    new GetObjectCommand({ Bucket, Key, VersionId: p.VersionId }),
  );
  a.deepEqual(Buffer.from(await g.Body.transformToByteArray()), Body);
  checks.push('pinned GET retains original bytes after overwrite');
  let denied = false;
  try {
    await c.send(new PutObjectCommand({ ...input, ChecksumCRC32: 'AAAAAA==' }));
  } catch (e) {
    a.equal(e.name, 'BadDigest');
    denied = true;
  }
  a.equal(denied, true);
  checks.push('wrong CRC32 rejected');
  console.log(
    JSON.stringify({
      result: 'PASS',
      passed: checks.length,
      checks,
      official_AWS_SDK_used: true,
      AWS_service_contacted: false,
    }),
  );
})()
  .catch((e) => {
    console.error('STORAGE_PROTOCOL_TEST_FAILED ' + (e.name || 'UNKNOWN'));
    process.exitCode = 1;
  })
  .finally(() => c.destroy());
