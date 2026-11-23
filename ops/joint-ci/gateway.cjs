'use strict';
// Real forwarding, NOT a business mock. Only JWKS and explicit fault injection
// are fixtures. Normal Backend status/headers/body pass through unchanged.
const https = require('node:https'),
  http = require('node:http');
const { mkdirSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const jwt =
  require('node:module').createRequire('/app/package.json')('jsonwebtoken');
mkdirSync('/tmp/joint-pki', { mode: 0o700 });
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=joint-ci.invalid',
    '-addext',
    'subjectAltName=IP:127.0.0.1,IP:172.29.63.3',
    '-keyout',
    '/tmp/joint-pki/key.pem',
    '-out',
    '/tmp/joint-pki/ca.pem',
  ],
  { stdio: 'ignore' },
);
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'joint-ci-only',
  alg: 'RS256',
  use: 'sig',
};
const calls = [];
let fault = null;
const allowed =
  /^\/(?:health(?:\/live|\/ready)?|v1\/(?:internal\/(?:drivers|fare-quotes|bookings|trips|delivery-proofs)(?:\/.*)?|fare\/quotes(?:\/.*)?|wallet|admin\/wallets\/[0-9a-f-]+\/adjustments|trips\/[0-9a-f-]+\/collections))$/i;
const server = https.createServer(
  {
    key: readFileSync('/tmp/joint-pki/key.pem'),
    cert: readFileSync('/tmp/joint-pki/ca.pem'),
  },
  async (req, res) => {
    try {
      const path = req.url.split('?')[0];
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 65536) throw Error('TOO_LARGE');
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks);
      const body = raw.length ? JSON.parse(raw.toString()) : {};
      const send = (s, x) => {
        res.writeHead(s, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(x));
      };
      if (path === '/jwks') return send(200, { keys: [jwk] });
      if (path === '/__test/health') return send(200, { status: 'ok' });
      if (path === '/__test/token') {
        const now = Math.floor(Date.now() / 1000);
        const t = jwt.sign(
          {
            sub: body.subject,
            iat: now,
            auth_time: now,
            exp: now + (body.fault === 'expired' ? -100 : 600),
            firebase: { sign_in_provider: 'phone' },
            iss: 'https://engine-ci.invalid',
            aud:
              body.fault === 'wrong-audience'
                ? 'wrong-audience'
                : 'mr-engine-ci',
          },
          pair.privateKey,
          { algorithm: 'RS256', keyid: jwk.kid },
        );
        return send(200, { token: t });
      }
      if (path === '/__test/state') return send(200, { calls });
      if (path === '/__test/fault') {
        fault = body.mode
          ? {
              mode: body.mode,
              path: body.path,
              method: body.method || 'GET',
              remaining: body.times || 1,
            }
          : null;
        return send(200, { ok: true });
      }
      if (!allowed.test(path))
        return send(403, { error: { code: 'JOINT_TEST_ROUTE_NOT_ALLOWED' } });
      const event = {
        method: req.method,
        path,
        internal: path.startsWith('/v1/internal/'),
        bodyKeys: Object.keys(body).sort(),
        keyPresent: !!req.headers['x-internal-api-key'],
        requestIdValid: /^[A-Za-z0-9._-]{8,64}$/.test(
          req.headers['x-request-id'] || '',
        ),
        bearerPresent: !!req.headers.authorization,
        forbiddenMoneyField:
          Object.keys(body).some((k) =>
            [
              'amount',
              'amountPaise',
              'fare',
              'farePaise',
              'payablePaise',
              'paymentStatus',
              'taxPaise',
              'price',
            ].includes(k),
          ) || body.status === 'PAYMENT_CONFIRMED',
        fault: null,
        backendStatus: null,
        forwarded: false,
      };
      calls.push(event);
      let active = null;
      if (
        fault &&
        fault.remaining > 0 &&
        fault.path === path &&
        fault.method === req.method
      ) {
        active = fault.mode;
        fault.remaining--;
        event.fault = active;
      }
      if (active === 'unavailable')
        return send(503, {
          error: { code: 'SYNTHETIC_CONNECTION_UNAVAILABLE' },
        });
      const headers = { ...req.headers, host: '172.29.63.4:3000' };
      delete headers.connection;
      if (active === 'wrong-key')
        headers['x-internal-api-key'] =
          'dummy_joint_intentionally_wrong_key_0123456789';
      const upstream = http.request(
        {
          hostname: '172.29.63.4',
          port: 3000,
          path: req.url,
          method: req.method,
          headers,
          timeout: 5000,
        },
        (answer) => {
          const received = [];
          answer.on('data', (c) => received.push(c));
          answer.on('end', () => {
            event.backendStatus = answer.statusCode;
            const payload = Buffer.concat(received);
            if (
              active === 'drop-after-commit' &&
              answer.statusCode >= 200 &&
              answer.statusCode < 300
            ) {
              res.destroy();
              return;
            }
            if (active === 'malformed')
              return send(200, { deliberately_corrupted_contract: true });
            const h = { ...answer.headers };
            delete h.connection;
            delete h['transfer-encoding'];
            res.writeHead(answer.statusCode, h);
            res.end(payload);
          });
        },
      );
      event.forwarded = true;
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        event.connectionFailed = true;
        if (!res.headersSent)
          send(503, {
            error: { code: 'SYNTHETIC_UPSTREAM_CONNECTION_FAILED' },
          });
        else res.destroy();
      });
      upstream.end(raw);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('{}');
    }
  },
);
server.listen(3443, '0.0.0.0', () =>
  console.log('JOINT_SYNTHETIC_GATEWAY_READY'),
);
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
