'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { request } = require('node:https');
const { readFileSync } = require('node:fs');
const checks = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => checks.push({ name, result: 'PASS' }));
}
async function req(path, { method = 'GET', body, token, mock = false } = {}) {
  const r = await fetch(
    (mock ? 'https://127.0.0.1:3443' : 'http://127.0.0.1:3000') + path,
    {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    },
  );
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, body: data };
}
const control = (path, body) =>
  req('/__test/' + path, { mock: true, method: 'POST', body });
async function token(subject, fault) {
  return (await control('token', { subject, fault })).body.token;
}
async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await req('/health/ready');
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error('STARTUP_FAILED');
}
(async () => {
  await waitForReady();
  await check('default image startup and public liveness', async () =>
    assert.deepEqual(await req('/health'), {
      status: 200,
      body: { status: 'ok' },
    }),
  );
  await check('readiness uses migrated PostgreSQL', async () =>
    assert.deepEqual(await req('/health/ready'), {
      status: 200,
      body: { status: 'ok', database: 'ok' },
    }),
  );
  for (const path of [
    '/drivers',
    '/rides/00000000-0000-4000-8000-000000000000',
    '/trips/history/customer/ci-customer',
  ])
    await check('anonymous denied ' + path, async () =>
      assert.equal((await req(path)).status, 401),
    );
  await check('malformed token denied', async () =>
    assert.equal((await req('/drivers', { token: 'not-a-jwt' })).status, 401),
  );
  for (const fault of [
    'expired',
    'wrong-audience',
    'wrong-issuer',
    'wrong-key',
    'unknown-kid',
  ])
    await check('JWT ' + fault + ' denied', async () =>
      assert.equal(
        (await req('/drivers', { token: await token('ci-customer', fault) }))
          .status,
        401,
      ),
    );
  const customer = await token('ci-customer'),
    driver = await token('ci-driver'),
    other = await token('ci-other');
  await check('valid JWT fetched through HTTPS mock JWKS', async () =>
    assert.equal(
      (await req('/trips/history/customer/ci-customer', { token: customer }))
        .status,
      200,
    ),
  );
  await check('cross-customer history denied', async () =>
    assert.equal(
      (await req('/trips/history/customer/ci-customer', { token: other }))
        .status,
      403,
    ),
  );
  for (const mode of ['unavailable', 'malformed', 'auth-denied'])
    await check('Backend ' + mode + ' fails closed', async () => {
      await control('mode', { mode });
      const r = await req('/rides', {
        method: 'POST',
        body: { quoteId: randomUUID(), paymentMethod: 'PAY_AT_PICKUP' },
        token: customer,
      });
      assert.equal(r.status, 503);
      await control('mode', { mode: 'normal' });
    });
  await check(
    'driver eligibility and synthetic position persisted',
    async () => {
      const r = await req('/drivers/ci-driver/location', {
        method: 'PATCH',
        token: driver,
        body: {
          latitude: 12,
          longitude: 77,
          accuracy: 5,
          capturedAt: Date.now(),
        },
      });
      assert.equal(r.status, 200);
      assert.equal(
        (
          await req('/drivers/ci-driver/availability', {
            method: 'PATCH',
            token: driver,
            body: { isAvailable: true },
          })
        ).status,
        200,
      );
    },
  );
  await check('client monetary amounts rejected', async () =>
    assert.equal(
      (
        await req('/rides', {
          method: 'POST',
          token: customer,
          body: {
            quoteId: randomUUID(),
            paymentMethod: 'PAY_AT_PICKUP',
            amountPaise: 1,
          },
        })
      ).status,
      400,
    ),
  );
  const quoteId = randomUUID(),
    body = { quoteId, paymentMethod: 'PAY_AT_PICKUP' };
  let rideId, tripId;
  await check('quote registration and engine-selected offer', async () => {
    const r = await req('/rides', { method: 'POST', token: customer, body });
    assert.equal(r.status, 201);
    assert.equal(r.body.ride.bookingStatus, 'OPEN');
    rideId = r.body.ride.id;
    assert.ok(rideId);
  });
  await check('booking replay preserves identity', async () => {
    const r = await req('/rides', { method: 'POST', token: customer, body });
    assert.equal(r.status, 201);
    assert.equal(r.body.ride.id, rideId);
  });
  await check('another customer cannot read booking', async () =>
    assert.equal((await req('/rides/' + rideId, { token: other })).status, 403),
  );
  await check(
    'assignment reports only driver subject to Backend mock',
    async () => {
      const r = await req('/rides/' + rideId + '/accept', {
        method: 'POST',
        token: driver,
        body: {},
      });
      assert.equal(r.status, 201);
      tripId = r.body.trip.id;
      assert.ok(tripId);
      assert.ok(r.body.trip.paymentTripId);
    },
  );
  await check('trip arrival uses internal Backend status contract', async () =>
    assert.equal(
      (
        await req('/trips/' + tripId + '/arrive', {
          method: 'POST',
          token: driver,
          body: {},
        })
      ).status,
      201,
    ),
  );
  await check('other driver cannot read assigned trip', async () =>
    assert.equal((await req('/trips/' + tripId, { token: other })).status, 403),
  );
  const state = (await req('/__test/state', { mock: true })).body;
  await check('all Backend calls authenticated and contract-scoped', () => {
    assert.ok(state.calls.length >= 6);
    for (const c of state.calls) {
      assert.ok(c.contractValid);
      assert.ok(c.internalKeyValid);
      assert.ok(c.requestIdValid);
      assert.equal(c.customerBearerForwarded, false);
      assert.ok(c.path.startsWith('/v1/internal/'));
    }
  });
  for (const [name, options] of [
    ['untrusted CA', { ca: [] }],
    [
      'wrong hostname',
      { ca: readFileSync('/ci-ca.pem'), servername: 'wrong.invalid' },
    ],
  ])
    await check(
      'TLS rejects ' + name,
      () =>
        new Promise((resolve, reject) => {
          const r = request(
            {
              hostname: '127.0.0.1',
              port: 3443,
              path: '/jwks',
              rejectUnauthorized: true,
              ...options,
            },
            (res) => {
              res.resume();
              reject(Error('TLS_NOT_REJECTED'));
            },
          );
          r.once('error', (e) => {
            const allowed =
              name === 'untrusted CA'
                ? ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']
                : ['ERR_TLS_CERT_ALTNAME_INVALID'];
            allowed.includes(e.code)
              ? resolve()
              : reject(Error('INVALID_TLS_FAILURE'));
          });
          r.end();
        }),
    );
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks,
      HTTP_checks: checks.length,
      Backend_mock_calls: state.calls.length,
      real_money_operations: false,
      real_Backend_contacted: false,
      JWKS: 'ephemeral HTTPS RSA keys',
      production_mode: true,
    }),
  );
})().catch((e) => {
  console.log(
    JSON.stringify({
      result: 'FAIL',
      checks,
      failed_after: checks.length,
      category: e?.code || e?.message || 'TEST_FAILURE',
    }),
  );
  process.exitCode = 1;
});
