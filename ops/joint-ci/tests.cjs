'use strict';
// Black-box HTTP only. Both APIs use their unmodified default entrypoints.
const a = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mode = process.argv[2],
  checks = [];
let state = {};
const E = 'http://127.0.0.1:3000',
  B = 'https://127.0.0.1:3443';
const tokens = {};
const subjects = {
  admin: 'ci_admin',
  customer: 'ci_customer',
  other: 'ci_other_customer',
  driver: 'ci_driver',
  pending: 'ci_pending_driver',
};
class SafeFailure extends Error {
  constructor(code) {
    super(code);
    this.safe = code;
  }
}
async function request(
  base,
  method,
  path,
  { as, token, body, status = 200, headers = {} } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(as
        ? { authorization: 'Bearer ' + tokens[as] }
        : token
          ? { authorization: 'Bearer ' + token }
          : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
  });
  let b = {};
  try {
    b = await r.json();
  } catch {}
  if (![].concat(status).includes(r.status)) {
    const code = b.code || b.error?.code || 'NO_CODE';
    throw new SafeFailure(
      'HTTP_' +
        r.status +
        '_EXPECTED_' +
        [].concat(status).join('_') +
        '_' +
        String(code).replace(/[^A-Z0-9_]/g, ''),
    );
  }
  return b;
}
const eng = (m, p, as, body, status = 200) =>
  request(E, m, p, { as, body, status });
const back = (m, p, as, body, status = 200, headers = {}) =>
  request(B, m, p, { as, body, status, headers });
const internal = (
  m,
  p,
  body,
  status = 200,
  key = process.env.PAYMENT_BACKEND_INTERNAL_API_KEY,
) =>
  request(B, m, p, {
    body,
    status,
    headers: {
      'x-internal-api-key': key,
      'x-request-id': 'joint-' + randomUUID(),
    },
  });
const remote = (id) => internal('GET', '/v1/internal/bookings/' + id);
const byRef = (ref) => internal('GET', '/v1/internal/bookings/by-ref/' + ref);
const quote = () =>
  back(
    'POST',
    '/v1/fare/quotes',
    'customer',
    {
      pickup: { latitude: 26.2389, longitude: 73.0243 },
      drops: [{ latitude: 26.2967, longitude: 73.0351 }],
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 12.5,
    },
    201,
  );
const book = (q, status = 201) =>
  eng(
    'POST',
    '/rides',
    'customer',
    { quoteId: q.quoteId, paymentMethod: 'PAY_AT_PICKUP' },
    status,
  );
const trace = async () => (await request(B, 'GET', '/__test/state')).calls;
const fault = (mode, path, method = 'GET') =>
  request(B, 'POST', '/__test/fault', { body: { mode, path, method } });
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, result: 'PASS' });
  } catch (e) {
    checks.push({
      name,
      result: 'FAIL',
      failure:
        e.safe ||
        (e.code && /^[A-Z_]+$/.test(e.code) ? e.code : e.name || 'Error'),
    });
  }
}
function requireState(...keys) {
  for (const k of keys)
    if (!state[k])
      throw new SafeFailure('PREREQUISITE_FAILED_' + k.toUpperCase());
}
async function ready() {
  for (let i = 0; i < 50; i++) {
    try {
      await eng('GET', '/health/ready');
      await request(B, 'GET', '/health/ready');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new SafeFailure('PAIR_READINESS_TIMEOUT');
}
async function mint() {
  for (const [name, subject] of Object.entries(subjects))
    tokens[name] = (
      await request(B, 'POST', '/__test/token', { body: { subject } })
    ).token;
}
async function baseline() {
  await check(
    'both default-entrypoint APIs connect to disposable PostgreSQL and become ready',
    ready,
  );
  await mint();
  await check('Backend liveness', () => request(B, 'GET', '/health/live'));
  await check('Engine liveness', async () =>
    a.equal((await eng('GET', '/health')).status, 'ok'),
  );
  await check('Backend anonymous request denied', () =>
    back('GET', '/v1/wallet', null, undefined, 401),
  );
  await check('Engine anonymous request denied', () =>
    eng('GET', '/trips/history/customer/ci_customer', null, undefined, 401),
  );
  for (const invalid of ['wrong-audience', 'expired']) {
    const token = (
      await request(B, 'POST', '/__test/token', {
        body: { subject: 'ci_customer', fault: invalid },
      })
    ).token;
    await check('Backend rejects ' + invalid + ' JWT', () =>
      request(B, 'GET', '/v1/wallet', { token, status: 401 }),
    );
    await check('Engine rejects ' + invalid + ' JWT', () =>
      request(E, 'GET', '/trips/history/customer/ci_customer', {
        token,
        status: 401,
      }),
    );
  }
  await check('valid synthetic JWT reaches Engine history', () =>
    eng('GET', '/trips/history/customer/ci_customer', 'customer'),
  );
  await check('Engine denies cross-subject history path', () =>
    eng(
      'GET',
      '/trips/history/customer/ci_other_customer',
      'customer',
      undefined,
      403,
    ),
  );
  const path = '/v1/internal/drivers/by-subject/ci_driver/eligibility';
  await check('real Backend internal API requires an internal key', () =>
    request(B, 'GET', path, { status: 401 }),
  );
  await check('real Backend internal API rejects wrong internal key', () =>
    internal(
      'GET',
      path,
      undefined,
      401,
      'dummy_engine_ci_wrong_01234567890123456789',
    ),
  );
  await check('public JWT cannot replace internal API key', () =>
    back('GET', path, 'customer', undefined, 401),
  );
  await check(
    'real Backend accepts internal key and returns eligible synthetic driver',
    async () => a.equal((await internal('GET', path)).eligible, true),
  );
  await check('pending synthetic driver ineligible at Backend', async () =>
    a.equal(
      (
        await internal(
          'GET',
          '/v1/internal/drivers/by-subject/ci_pending_driver/eligibility',
        )
      ).eligible,
      false,
    ),
  );
  await check('unknown driver handled without data exposure', () =>
    internal(
      'GET',
      '/v1/internal/drivers/by-subject/ci_missing/eligibility',
      undefined,
      404,
    ),
  );
  await check(
    'Engine refuses availability for ineligible driver using actual Backend',
    () =>
      eng(
        'PATCH',
        '/drivers/ci_pending_driver/availability',
        'pending',
        { isAvailable: true },
        403,
      ),
  );
  await check('Engine refuses customer impersonating another driver', () =>
    eng(
      'PATCH',
      '/drivers/ci_driver/availability',
      'customer',
      { isAvailable: true },
      403,
    ),
  );
}
async function business() {
  await ready();
  await mint();
  await check('publish synthetic fresh driver location', () =>
    eng('PATCH', '/drivers/ci_driver/location', 'driver', {
      latitude: 26.2389,
      longitude: 73.0243,
      accuracy: 5,
      capturedAt: Date.now(),
    }),
  );
  await check(
    'Engine verifies eligible driver with real Backend before online',
    () =>
      eng('PATCH', '/drivers/ci_driver/availability', 'driver', {
        isAvailable: true,
      }),
  );
  await check(
    'real Backend computes synthetic versioned fare without external maps',
    async () => {
      state.quote = await quote();
      a.ok(state.quote.quoteId);
      a.ok(state.quote.payablePaise > 0);
    },
  );
  await check(
    'client-supplied amount rejected before registration',
    async () => {
      requireState('quote');
      const before = (await trace()).filter(
        (x) => x.path === '/v1/internal/bookings' && x.method === 'POST',
      ).length;
      const r = await eng(
        'POST',
        '/rides',
        'customer',
        {
          quoteId: state.quote.quoteId,
          paymentMethod: 'PAY_AT_PICKUP',
          farePaise: 1,
        },
        400,
      );
      a.equal(r.code, 'CLIENT_AMOUNT_REJECTED');
      a.equal(
        (await trace()).filter(
          (x) => x.path === '/v1/internal/bookings' && x.method === 'POST',
        ).length,
        before,
      );
    },
  );
  await check(
    'real Engine registers real Backend booking with immutable quote contract',
    async () => {
      requireState('quote');
      const r = (await book(state.quote)).ride;
      a.ok(r.id);
      a.ok(r.paymentBookingId);
      a.equal(r.externalRef, 'ENG-' + r.id);
      a.equal(r.payablePaise, state.quote.payablePaise);
      Object.assign(state, {
        rideId: r.id,
        bookingId: r.paymentBookingId,
        externalRef: r.externalRef,
      });
      const b = await byRef(r.externalRef);
      a.equal(b.bookingId, r.paymentBookingId);
      a.equal(b.quoteId, state.quote.quoteId);
      a.equal(b.payablePaise, state.quote.payablePaise);
    },
  );
  await check(
    'internal registration uses exact keys, internal authentication and request ID; no bearer or money',
    async () => {
      requireState('rideId');
      const entries = (await trace()).filter(
        (x) => x.path === '/v1/internal/bookings' && x.method === 'POST',
      );
      a.ok(entries.length);
      for (const e of entries) {
        a.deepEqual(e.bodyKeys, [
          'customerSubject',
          'externalRef',
          'paymentMethod',
          'quoteId',
        ]);
        a.ok(e.keyPresent && e.requestIdValid && e.forwarded);
        a.equal(e.bearerPresent, false);
        a.equal(e.forbiddenMoneyField, false);
        a.ok([200, 201].includes(e.backendStatus));
      }
    },
  );
  await check(
    'registration replay preserves same Engine and Backend booking',
    async () => {
      requireState('quote', 'rideId');
      const r = (await book(state.quote)).ride;
      a.equal(r.id, state.rideId);
      a.equal(r.paymentBookingId, state.bookingId);
    },
  );
  await check('another customer cannot read the ride', async () => {
    requireState('rideId');
    await eng('GET', '/rides/' + state.rideId, 'other', undefined, 404);
  });
  await check(
    'eligible driver receives and accepts offer; real Backend trip linked',
    async () => {
      requireState('rideId');
      const offers = (await eng('GET', '/ride-requests/ci_driver', 'driver'))
        .requests;
      a.ok(offers.some((x) => x.rideId === state.rideId));
      const v = await eng(
        'POST',
        '/rides/' + state.rideId + '/accept',
        'driver',
        {},
        201,
      );
      a.ok(v.trip.id && v.trip.paymentTripId);
      state.tripId = v.trip.id;
      state.paymentTripId = v.trip.paymentTripId;
      const b = await remote(state.bookingId);
      a.equal(b.status, 'DRIVER_ASSIGNED');
      a.equal(b.trip.tripId, state.paymentTripId);
    },
  );
  await check(
    'arrival synchronizes to actual Backend before progress',
    async () => {
      requireState('tripId');
      const v = await eng(
        'POST',
        '/trips/' + state.tripId + '/arrive',
        'driver',
        {},
        201,
      );
      a.equal(v.tripStatus, 'DRIVER_ARRIVED');
      a.equal(v.paymentSync, 'DELIVERED');
      a.equal(v.paymentGate.paymentState, 'PAYMENT_REQUIRED');
    },
  );
  await check(
    'unpaid pickup denies OTP verification and withholds customer OTP',
    async () => {
      requireState('tripId');
      const r = await eng(
        'POST',
        '/trips/' + state.tripId + '/pickup/verify-otp',
        'driver',
        { otp: '0000' },
        409,
      );
      a.equal(r.code, 'PAYMENT_REQUIRED');
      const o = await eng(
        'GET',
        '/rides/' + state.rideId + '/otps',
        'customer',
      );
      a.equal(o.pickup.otp, null);
      a.equal(o.pickup.withheld, 'PAYMENT_REQUIRED');
      a.equal((await remote(state.bookingId)).trip.status, 'DRIVER_ARRIVED');
    },
  );
  await check(
    'synthetic-only wallet float permits CASH collection; no provider enabled',
    async () => {
      requireState('paymentTripId');
      const w = await back('GET', '/v1/wallet', 'driver');
      a.ok(w.walletId);
      await back(
        'POST',
        '/v1/admin/wallets/' + w.walletId + '/adjustments',
        'admin',
        {
          direction: 'CREDIT',
          amountPaise: 200000,
          reason: 'Synthetic joint CI wallet float; no real money',
        },
        201,
        { 'idempotency-key': randomUUID() },
      );
      const b = await remote(state.bookingId);
      a.equal(b.paymentGate.handoverAllowed, false);
      const payload = {
          method: 'CASH',
          amountPaise: b.paymentGate.amountPaise,
        },
        key = randomUUID();
      const cash = await back(
        'POST',
        '/v1/trips/' + state.paymentTripId + '/collections',
        'driver',
        payload,
        201,
        { 'idempotency-key': key },
      );
      a.equal(cash.status, 'COMPLETED');
      a.equal(cash.bookingPaymentStatus, 'PAID');
      a.equal(cash.paymentGate.handoverAllowed, true);
      const replay = await back(
        'POST',
        '/v1/trips/' + state.paymentTripId + '/collections',
        'driver',
        payload,
        201,
        { 'idempotency-key': key },
      );
      a.equal(replay.collectionId, cash.collectionId);
    },
  );
  await check(
    'paid synthetic gate releases OTP; wrong OTP denied; valid OTP synchronizes Backend first',
    async () => {
      requireState('tripId');
      const o = await eng(
        'GET',
        '/rides/' + state.rideId + '/otps',
        'customer',
      );
      a.match(o.pickup.otp, /^\d{4}$/);
      await eng(
        'POST',
        '/trips/' + state.tripId + '/pickup/verify-otp',
        'driver',
        { otp: o.pickup.otp === '0000' ? '1111' : '0000' },
        400,
      );
      const r = await eng(
        'POST',
        '/trips/' + state.tripId + '/pickup/verify-otp',
        'driver',
        { otp: o.pickup.otp },
        201,
      );
      a.equal(r.tripStatus, 'PICKUP_VERIFIED');
      a.equal(r.paymentSync, 'DELIVERED');
      a.equal((await remote(state.bookingId)).trip.status, 'PICKUP_VERIFIED');
    },
  );
  await check(
    'both services complete synthetic one-stop trip with gated handover',
    async () => {
      requireState('tripId');
      await eng('POST', '/trips/' + state.tripId + '/start', 'driver', {}, 201);
      const [s] = (await eng('GET', '/trips/' + state.tripId, 'driver')).trip
        .stops;
      const arrived = await eng(
        'POST',
        '/trips/' + state.tripId + '/stop/arrive',
        'driver',
        { stopId: s.id },
        201,
      );
      a.equal(arrived.paymentGate.handoverAllowed, true);
      const o = await eng(
        'GET',
        '/rides/' + state.rideId + '/otps',
        'customer',
      );
      await eng(
        'POST',
        '/trips/' + state.tripId + '/stop/verify-otp',
        'driver',
        { stopId: s.id, otp: o.stops[0].otp },
        201,
      );
      await eng(
        'POST',
        '/trips/' + state.tripId + '/stop/confirm-delivery',
        'driver',
        { stopId: s.id, photo: { uri: 'file://synthetic-only.jpg' } },
        201,
      );
      const done = await eng(
        'POST',
        '/trips/' + state.tripId + '/complete',
        'driver',
        {},
        201,
      );
      a.equal(done.tripStatus, 'COMPLETED');
      const b = await remote(state.bookingId);
      a.equal(b.status, 'COMPLETED');
      a.equal(b.paidWith, 'CASH');
      a.equal(b.trip.status, 'COMPLETED');
      const repeated = await eng(
        'POST',
        '/trips/' + state.tripId + '/complete',
        'driver',
        {},
        201,
      );
      a.equal(repeated.changed, false);
    },
  );
}
async function faults() {
  await ready();
  await mint();
  for (const kind of ['wrong-key', 'malformed', 'unavailable'])
    await check(
      'Engine fails closed on ' +
        kind +
        ' from actual Backend route then recovers',
      async () => {
        const q = await quote(),
          path = '/v1/internal/fare-quotes/' + q.quoteId;
        await fault(kind, path);
        const r = await book(q, 503);
        a.ok(
          [
            'PAYMENT_BACKEND_UNAVAILABLE',
            'PAYMENT_BACKEND_CONTRACT_ERROR',
          ].includes(r.code),
        );
        const f = (await trace())
          .filter((x) => x.path === path && x.fault === kind)
          .at(-1);
        a.ok(f);
        if (kind === 'wrong-key') {
          a.equal(f.forwarded, true);
          a.equal(f.backendStatus, 401);
        }
        if (kind === 'malformed') {
          a.equal(f.forwarded, true);
          a.equal(f.backendStatus, 200);
        }
        const retry = (await book(q)).ride;
        a.ok(retry.paymentBookingId);
      },
    );
  await check(
    'lost response after real Backend registration retries same reference with no duplicate booking',
    async () => {
      const q = await quote();
      await fault('drop-after-commit', '/v1/internal/bookings', 'POST');
      const lost = await book(q, 503);
      a.equal(lost.code, 'PAYMENT_BACKEND_UNAVAILABLE');
      const pending = (
        await eng('GET', '/rides/recovery?quoteId=' + q.quoteId, 'customer')
      ).ride;
      a.ok(pending.id);
      const b = await byRef('ENG-' + pending.id);
      a.equal(b.quoteId, q.quoteId);
      const r = (await book(q)).ride;
      a.equal(r.id, pending.id);
      a.equal(r.paymentBookingId, b.bookingId);
      const entries = (await trace()).filter(
        (x) => x.method === 'POST' && x.path === '/v1/internal/bookings',
      );
      const i = entries.findIndex((x) => x.fault === 'drop-after-commit');
      a.ok(i >= 0);
      a.equal(entries[i].backendStatus, 201);
      a.equal(entries[i + 1].backendStatus, 200);
    },
  );
  await check(
    'Engine own runtime role cannot connect to Backend database',
    async () => {
      const { Client } =
        require('node:module').createRequire('/app/package.json')('pg');
      const u = new URL(process.env.DATABASE_URL);
      u.pathname = '/mr_joint_backend_e2e';
      const c = new Client({
        connectionString: u.href,
        connectionTimeoutMillis: 2000,
      });
      let code;
      try {
        await c.connect();
      } catch (e) {
        code = e.code;
      } finally {
        await c.end().catch(() => {});
      }
      a.equal(code, '42501');
    },
  );
}
async function restart() {
  state = JSON.parse(require('node:fs').readFileSync('/state.json', 'utf8'));
  await mint();
  await check('both services regain database readiness after ' + mode, ready);
  await check(
    'persisted Engine ride and Backend booking retain original correlation after ' +
      mode,
    async () => {
      const r = (await eng('GET', '/rides/' + state.rideId, 'customer')).ride;
      a.equal(r.paymentBookingId, state.bookingId);
      const b = await byRef(state.externalRef);
      a.equal(b.bookingId, state.bookingId);
      a.equal(b.trip.tripId, state.paymentTripId);
      a.equal(b.status, 'COMPLETED');
    },
  );
  await check(
    'Engine reconnects to real Backend for new booking after ' + mode,
    async () => {
      const q = await quote();
      const r = (await book(q)).ride;
      a.ok(r.paymentBookingId);
      a.equal((await remote(r.paymentBookingId)).quoteId, q.quoteId);
    },
  );
}
(async () => {
  if (mode === 'baseline') await baseline();
  else if (mode === 'business') await business();
  else if (mode === 'faults') await faults();
  else if (/^after-(backend|engine)-restart$/.test(mode)) await restart();
  else throw new SafeFailure('UNKNOWN_MODE');
  const failed = checks.filter((x) => x.result === 'FAIL').length;
  console.log(
    JSON.stringify({
      result: failed ? 'FAIL' : 'PASS',
      mode,
      passed: checks.length - failed,
      failed,
      checks,
      ...(mode === 'business' ? { state } : {}),
    }),
  );
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.log(
    JSON.stringify({
      result: 'FAIL',
      mode,
      checks,
      fatal: e.safe || e.name || 'Error',
    }),
  );
  process.exitCode = 1;
});
