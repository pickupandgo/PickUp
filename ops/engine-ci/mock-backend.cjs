'use strict';
// Test fixture ONLY. Not copied into the published image; no external requests.
const { createServer } = require('node:https');
const { readFileSync, mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const jwt =
  require('node:module').createRequire('/app/package.json')('jsonwebtoken');
mkdirSync('/tmp/mock-pki', { mode: 0o700 });
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
    '/CN=engine-ci.invalid',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-keyout',
    '/tmp/mock-pki/key.pem',
    '-out',
    '/tmp/mock-pki/ca.pem',
  ],
  { stdio: 'ignore' },
);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: 'jwk' }),
  kid: 'engine-ci-only',
  alg: 'RS256',
  use: 'sig',
};
let mode = 'normal';
const calls = [],
  bookings = new Map();
const quote = (id) => ({
  quoteId: id,
  vehicleCategory: 'MINI_TRUCK',
  weightKg: 10,
  pickup: { latitude: 12, longitude: 77 },
  distanceMeters: 1500,
  farePaise: 25000,
  taxPaise: 0,
  payablePaise: 25000,
  currency: 'INR',
  drops: [
    {
      sequence: 1,
      latitude: 12.01,
      longitude: 77.01,
      distanceMeters: 1500,
      payablePaise: 25000,
    },
  ],
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  redeemed: false,
});
const responseBooking = (b) => ({
  bookingId: b.id,
  externalRef: b.externalRef,
  status: b.status,
  paymentMethod: b.paymentMethod,
  paymentStatus: 'UNPAID',
  paymentModel: 'QUOTE_PER_STOP',
  quoteId: b.quoteId,
  payablePaise: 25000,
  stops: [{ sequence: 1, payablePaise: 25000, status: 'PENDING' }],
  paymentGate: {
    stage: 'PICKUP',
    stopSequence: null,
    paymentState: 'UNPAID',
    amountPaise: 25000,
    handoverAllowed: false,
  },
  cancellationReason: null,
  trip: b.trip,
});
const server = createServer(
  {
    key: readFileSync('/tmp/mock-pki/key.pem'),
    cert: readFileSync('/tmp/mock-pki/ca.pem'),
  },
  async (req, res) => {
    try {
      const url = new URL(req.url, 'https://127.0.0.1:3443');
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 16384) throw Error('TOO_LARGE');
        chunks.push(c);
      }
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : {};
      const send = (status, data) => {
        res.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
      if (url.pathname === '/__test/health') return send(200, { status: 'ok' });
      if (url.pathname === '/__test/token') {
        const now = Math.floor(Date.now() / 1000),
          fault = body.fault;
        const token = jwt.sign(
          {
            sub: body.subject || 'ci-customer',
            iat: now,
            auth_time: now,
            exp: now + (fault === 'expired' ? -100 : 600),
            iss:
              fault === 'wrong-issuer'
                ? 'https://wrong.invalid'
                : 'https://engine-ci.invalid',
            aud: fault === 'wrong-audience' ? 'wrong-audience' : 'mr-engine-ci',
          },
          fault === 'wrong-key' ? other.privateKey : keys.privateKey,
          {
            algorithm: 'RS256',
            keyid: fault === 'unknown-kid' ? 'missing-kid' : jwk.kid,
          },
        );
        return send(200, { token });
      }
      if (url.pathname === '/__test/mode') {
        mode = body.mode;
        return send(200, { ok: true });
      }
      if (url.pathname === '/__test/state')
        return send(200, { calls, bookingCount: bookings.size });
      const call = {
        method: req.method,
        path: url.pathname,
        bodyKeys: Object.keys(body).sort(),
        internalKeyValid:
          req.headers['x-internal-api-key'] === process.env.CI_INTERNAL_KEY,
        requestIdValid: /^[A-Za-z0-9._-]{8,64}$/.test(
          req.headers['x-request-id'] || '',
        ),
        customerBearerForwarded: !!req.headers.authorization,
        contractValid: true,
      };
      calls.push(call);
      if (!call.internalKeyValid || mode === 'auth-denied')
        return send(401, { error: { code: 'INTERNAL_AUTH_FAILED' } });
      if (!call.requestIdValid || call.customerBearerForwarded)
        call.contractValid = false;
      if (
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
        )
      )
        call.contractValid = false;
      if (body.status === 'PAYMENT_CONFIRMED') call.contractValid = false;
      if (mode === 'unavailable')
        return send(503, { error: { code: 'SYNTHETIC_UNAVAILABLE' } });
      if (mode === 'malformed') return send(200, { invalid: true });
      const eligibility = url.pathname.match(
        /^\/v1\/internal\/drivers\/by-subject\/([^/]+)\/eligibility$/,
      );
      if (req.method === 'GET' && eligibility) {
        const subject = decodeURIComponent(eligibility[1]);
        return send(200, {
          driverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          subject,
          eligible: subject === 'ci-driver',
          reasons: subject === 'ci-driver' ? [] : ['NOT_APPROVED'],
          vehicleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          vehicleCategory: 'MINI_TRUCK',
          checkedAt: new Date().toISOString(),
        });
      }
      const fare = url.pathname.match(
        /^\/v1\/internal\/fare-quotes\/([0-9a-f-]+)$/i,
      );
      if (req.method === 'GET' && fare) return send(200, quote(fare[1]));
      if (req.method === 'POST' && url.pathname === '/v1/internal/bookings') {
        if (
          call.bodyKeys.join(',') !==
          'customerSubject,externalRef,paymentMethod,quoteId'
        )
          call.contractValid = false;
        let b = bookings.get(body.externalRef);
        if (!b) {
          b = {
            id: randomUUID(),
            ...body,
            status: 'SEARCHING_DRIVER',
            trip: null,
          };
          bookings.set(body.externalRef, b);
        }
        return send(201, responseBooking(b));
      }
      const bookingPath = url.pathname.match(
        /^\/v1\/internal\/bookings\/([0-9a-f-]+)(?:\/(assign|searching))?$/i,
      );
      if (bookingPath) {
        const b = [...bookings.values()].find((b) => b.id === bookingPath[1]);
        if (!b) return send(404, { error: { code: 'BOOKING_NOT_FOUND' } });
        if (req.method === 'POST' && bookingPath[2] === 'assign') {
          if (call.bodyKeys.join(',') !== 'driverSubject')
            call.contractValid = false;
          b.status = 'DRIVER_ASSIGNED';
          b.trip = b.trip || {
            tripId: randomUUID(),
            status: 'DRIVER_ASSIGNED',
          };
        }
        return send(200, responseBooking(b));
      }
      const statusPath = url.pathname.match(
        /^\/v1\/internal\/trips\/([0-9a-f-]+)\/status$/i,
      );
      if (req.method === 'POST' && statusPath) {
        const b = [...bookings.values()].find(
          (b) => b.trip?.tripId === statusPath[1],
        );
        if (!b) return send(404, { error: { code: 'TRIP_NOT_FOUND' } });
        if (call.bodyKeys.join(',') !== 'status') call.contractValid = false;
        b.trip.status = body.status;
        return send(200, responseBooking(b));
      }
      call.contractValid = false;
      return send(500, { error: { code: 'UNEXPECTED_MOCK_ROUTE' } });
    } catch {
      res.writeHead(500);
      res.end('{}');
    }
  },
);
server.listen(3443, '127.0.0.1', () => console.log('SYNTHETIC_MOCK_READY'));
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
