'use strict';
// Deliberately limited S3-protocol CI fixture, NOT an AWS service or production S3 emulator.
// Real SigV4 checks, streamed bytes, CRC32/SHA256 integrity, AES-GCM files and immutable
// on-disk object versions. No successful verification receipts are supplied by this service.
const http = require('node:https'),
  fs = require('node:fs'),
  path = require('node:path');
const {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} = require('node:crypto');
const { crc32 } = require('./photo.cjs');
const key = Buffer.from(process.env.CI_STORAGE_ENCRYPTION_KEY, 'hex');
if (key.length !== 32) throw Error('INVALID_FIXTURE_KEY');
const access = process.env.CI_STORAGE_ACCESS_KEY,
  secret = process.env.CI_STORAGE_SECRET;
if (!access.startsWith('dummy_') || !secret.startsWith('dummy_'))
  throw Error('DUMMY_ONLY');
fs.mkdirSync('/data/objects', { recursive: true, mode: 0o700 });
const digest = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, b) => createHmac('sha256', k).update(b).digest();
const pct = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
function authorize(req, u, raw) {
  const auth = req.headers.authorization,
    q = u.searchParams;
  let cred, headers, sig, date, ph;
  if (auth) {
    const m =
      /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(
        auth,
      );
    if (!m) return false;
    [, cred, headers, sig] = m;
    date = req.headers['x-amz-date'];
    ph = req.headers['x-amz-content-sha256'] || digest(raw);
  } else {
    if (q.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') return false;
    cred = q.get('X-Amz-Credential');
    headers = q.get('X-Amz-SignedHeaders');
    sig = q.get('X-Amz-Signature');
    date = q.get('X-Amz-Date');
    ph = q.get('X-Amz-Content-Sha256') || 'UNSIGNED-PAYLOAD';
  }
  if (!cred || !headers || !sig || !/^\d{8}T\d{6}Z$/.test(date || ''))
    return false;
  const bits = cred.split('/');
  if (
    bits.length !== 5 ||
    bits[0] !== access ||
    bits[1] !== date.slice(0, 8) ||
    bits[2] !== 'ap-south-1' ||
    bits[3] !== 's3' ||
    bits[4] !== 'aws4_request'
  )
    return false;
  const timestamp = Date.parse(
    date.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      '$1-$2-$3T$4:$5:$6Z',
    ),
  );
  const ttl = auth ? 300 : Number(q.get('X-Amz-Expires'));
  if (
    !Number.isFinite(ttl) ||
    ttl < 1 ||
    ttl > 900 ||
    Date.now() - timestamp > ttl * 1000 ||
    timestamp - Date.now() > 30000
  )
    return false;
  if (ph !== 'UNSIGNED-PAYLOAD' && ph !== digest(raw)) return false;
  const hs = headers.split(';');
  if (!hs.includes('host') || hs.some((h) => !req.headers[h])) return false;
  const canonicalHeaders = hs
    .map(
      (h) =>
        h + ':' + String(req.headers[h]).trim().replace(/\s+/g, ' ') + '\n',
    )
    .join('');
  const entries = [...q]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) =>
      a[0] < b[0]
        ? -1
        : a[0] > b[0]
          ? 1
          : a[1] < b[1]
            ? -1
            : a[1] > b[1]
              ? 1
              : 0,
    );
  const canonical = [
    req.method,
    u.pathname,
    entries.map(([k, v]) => k + '=' + v).join('&'),
    canonicalHeaders,
    headers,
    ph,
  ].join('\n');
  const scope = bits.slice(1).join('/'),
    str = ['AWS4-HMAC-SHA256', date, scope, digest(canonical)].join('\n');
  const signing = hmac(
    hmac(hmac(hmac('AWS4' + secret, bits[1]), bits[2]), 's3'),
    'aws4_request',
  );
  const actual = hmac(signing, str).toString('hex');
  return (
    /^[a-f0-9]{64}$/.test(sig) &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(actual))
  );
}
const audit = { put: 0, head: 0, get: 0, denied: 0, crc_failures: 0 };
function xml(res, status, code) {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end('<Error><Code>' + code + '</Code></Error>');
}
http
  .createServer(
    {
      key: fs.readFileSync('/ci-key.pem'),
      cert: fs.readFileSync('/ci-ca.pem'),
    },
    async (req, res) => {
      try {
        const u = new URL(req.url, 'https://172.29.63.5:9000');
        if (u.pathname === '/__test/health') {
          res.end('ok');
          return;
        }
        if (u.pathname === '/__test/audit') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(audit));
          return;
        }
        if (
          req.headers.host !== '172.29.63.5:9000' ||
          !u.pathname.startsWith('/mr-proof-ci/delivery-proofs/')
        )
          return xml(res, 403, 'AccessDenied');
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 1024 * 1024) return xml(res, 413, 'TooLarge');
          chunks.push(c);
        }
        const raw = Buffer.concat(chunks);
        if (!authorize(req, u, raw)) {
          audit.denied++;
          return xml(res, 403, 'SignatureDoesNotMatch');
        }
        const object = u.pathname.slice('/mr-proof-ci/'.length);
        if (!/^delivery-proofs\/[a-f0-9-]+\/\d+\/[a-f0-9-]+$/.test(object))
          return xml(res, 403, 'AccessDenied');
        const dir = path.join('/data/objects', digest(object));
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (req.method === 'PUT') {
          const metadata =
            u.searchParams.get('x-amz-meta-documentid') ||
            req.headers['x-amz-meta-documentid'];
          const sse =
            u.searchParams.get('x-amz-server-side-encryption') ||
            req.headers['x-amz-server-side-encryption'];
          if (
            sse !== 'AES256' ||
            !metadata ||
            raw.length !== Number(req.headers['content-length'])
          )
            return xml(res, 400, 'InvalidArgument');
          const crc =
            u.searchParams.get('x-amz-checksum-crc32') ||
            req.headers['x-amz-checksum-crc32'];
          if (crc) {
            const b = Buffer.alloc(4);
            b.writeUInt32BE(crc32(raw));
            if (crc !== b.toString('base64')) {
              audit.crc_failures++;
              return xml(res, 400, 'BadDigest');
            }
          }
          const v = randomUUID(),
            iv = randomBytes(12),
            cipher = createCipheriv('aes-256-gcm', key, iv);
          cipher.setAAD(Buffer.from(object + '\0' + v));
          const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
          const record = {
            v,
            object,
            size: raw.length,
            type: req.headers['content-type'],
            documentid: metadata,
            sse,
            etag: createHash('md5').update(raw).digest('hex'),
            sha256: digest(raw),
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
          };
          fs.writeFileSync(path.join(dir, v + '.bin'), encrypted, {
            mode: 0o600,
            flag: 'wx',
          });
          fs.writeFileSync(
            path.join(dir, v + '.json'),
            JSON.stringify(record),
            {
              mode: 0o600,
              flag: 'wx',
            },
          );
          fs.writeFileSync(path.join(dir, 'latest.tmp'), v, { mode: 0o600 });
          fs.renameSync(path.join(dir, 'latest.tmp'), path.join(dir, 'latest'));
          audit.put++;
          res.writeHead(200, {
            etag: '"' + record.etag + '"',
            'x-amz-version-id': v,
            'x-amz-server-side-encryption': 'AES256',
          });
          res.end();
          return;
        }
        if (!['HEAD', 'GET'].includes(req.method))
          return xml(res, 405, 'MethodNotAllowed');
        const v =
          u.searchParams.get('versionId') ||
          fs.readFileSync(path.join(dir, 'latest'), 'utf8');
        if (!/^[a-f0-9-]{36}$/.test(v)) return xml(res, 404, 'NoSuchVersion');
        const record = JSON.parse(
          fs.readFileSync(path.join(dir, v + '.json'), 'utf8'),
        );
        if (record.v !== v || record.object !== object)
          throw Error('BINDING_FAILURE');
        const headers = {
          'content-length': record.size,
          'content-type': record.type,
          etag: '"' + record.etag + '"',
          'x-amz-version-id': v,
          'x-amz-meta-documentid': record.documentid,
          'x-amz-server-side-encryption': record.sse,
          'cache-control': 'no-store',
        };
        if (req.method === 'HEAD') {
          audit.head++;
          res.writeHead(200, headers);
          res.end();
          return;
        }
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(record.iv, 'hex'),
        );
        decipher.setAAD(Buffer.from(object + '\0' + v));
        decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
        const bytes = Buffer.concat([
          decipher.update(fs.readFileSync(path.join(dir, v + '.bin'))),
          decipher.final(),
        ]);
        if (digest(bytes) !== record.sha256)
          throw Error('DISK_INTEGRITY_FAILURE');
        audit.get++;
        res.writeHead(200, headers);
        res.end(bytes);
      } catch (e) {
        if (!res.headersSent)
          xml(
            res,
            e.code === 'ENOENT' ? 404 : 500,
            e.code === 'ENOENT' ? 'NoSuchKey' : 'FixtureIntegrityFailure',
          );
        else res.destroy();
      }
    },
  )
  .listen(9000, '0.0.0.0', () =>
    console.log('SYNTHETIC_ENCRYPTED_VERSION_STORAGE_READY'),
  );
