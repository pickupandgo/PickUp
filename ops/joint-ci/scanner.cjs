'use strict';
// Controlled synthetic scanner, not a claim of production antivirus coverage.
// Downloads the exact signed version, hashes bytes independently, verifies PNG
// CRCs and decompression, and detects the standard EICAR fixture marker.
const http = require('node:http'),
  { createHash } = require('node:crypto');
const { inspect } = require('./photo.cjs');
const records = [];
let unavailable = false;
http
  .createServer(async (req, res) => {
    const send = (s, b) => {
      res.writeHead(s, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      if (req.url === '/__test/state') return send(200, { records });
      if (req.url === '/__test/unavailable') {
        unavailable = body.enabled === true;
        return send(200, { ok: true });
      }
      if (
        req.url !== '/scan' ||
        req.method !== 'POST' ||
        req.headers.authorization !== 'Bearer ' + process.env.CI_SCANNER_TOKEN
      )
        return send(401, { error: 'DENIED' });
      if (unavailable)
        return send(503, { error: 'SYNTHETIC_SCANNER_UNAVAILABLE' });
      const u = new URL(body.downloadUrl);
      if (
        u.origin !== 'http://172.29.63.5:9000' ||
        !u.pathname.startsWith('/mr-proof-ci/delivery-proofs/') ||
        !u.searchParams.get('versionId')
      )
        return send(400, { error: 'FORBIDDEN_SCAN_TARGET' });
      const r = await fetch(u, {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!r.ok) throw Error('DOWNLOAD_FAILED');
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 1024 * 1024) throw Error('TOO_LARGE');
      const sha256 = createHash('sha256').update(b).digest('hex'),
        found = inspect(b);
      if (
        b.length !== body.sizeBytes ||
        sha256 !== body.sha256 ||
        !found ||
        found.contentType !== body.contentType
      )
        return send(422, { error: 'ACTUAL_BYTE_INTEGRITY_FAILURE' });
      const result = found.infected ? 'INFECTED' : 'CLEAN';
      records.push({
        versionId: u.searchParams.get('versionId'),
        sha256,
        bytes: b.length,
        result,
        PNG_CRC_and_pixels_verified: true,
      });
      return send(200, {
        result,
        sha256,
        detectedContentType: found.contentType,
      });
    } catch {
      return send(500, { error: 'SCAN_FAILED' });
    }
  })
  .listen(9080, '0.0.0.0', () => console.log('SYNTHETIC_BYTE_SCANNER_READY'));
