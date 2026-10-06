#!/usr/bin/env node
/**
 * Local end-to-end proof of the approved V1 money flow, through the HTTP API only (no app UI):
 *
 *   Rs 500 fare, 10% platform fee (Rs 50), Rs 450 driver earning,
 *   customer UPI -> Razorpay -> Nikhil Enterprises -> merchant settlement -> driver earning
 *   payable -> weekly payout batch at the scheduled time -> RazorpayX payout -> verified bank.
 *
 * What is real: the backend build (dist/), the database schema (prisma migrate deploy), the ops
 * CLI, authentication (RS256 tokens checked against a JWKS endpoint), signature-verified
 * webhooks, the weekly scheduler, and Razorpay TEST-mode order creation.
 * What is simulated (Razorpay test mode cannot do it, or the account is not activated yet):
 *   - the customer completing UPI checkout: a signed payment.captured webhook;
 *   - Razorpay merchant settlement: SETTLEMENT_PROVIDER=simulated + a signed settlement.processed;
 *   - RazorpayX bank validation and payouts: PAYOUT_PROVIDER=simulated + signed webhooks.
 * Simulated providers are refused by config validation in production and with live keys.
 *
 * Isolation: a separate database (multipleride_e2e, dropped and recreated each run), a separate
 * port (3100), freshly generated secrets and signing key. The dev database and backend are not
 * touched. Every request is printed as an equivalent curl command (secrets as placeholders).
 *
 * Usage (from raj_backend, after `npm run build`, with Docker Postgres running):
 *   node test/e2e/run-local-e2e.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const E2E_DATABASE = 'multipleride_e2e';
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const TIME_ZONE = 'Asia/Kolkata';
const ISSUER = 'https://securetoken.google.com/multipleride-e2e';
const AUDIENCE = 'multipleride-e2e';
const FARE_PAISE = 50_000;
const FEE_PAISE = 5_000;
const NET_PAISE = 45_000;
const CONTROL_FARE_PAISE = 30_000;
/** Minutes between backend start and the scheduled weekly run used for this test. */
const RUN_LEAD_MINUTES = 3;

const report = { startedAt: new Date().toISOString(), steps: [], idempotency: [], ids: {} };
let backend;
let jwksServer;
/** Read-only queries on the e2e database (webhook outcomes, audit trail). */
let db;

/** Stored rows and processing outcome of one webhook event id. */
async function webhookEvent(table, eventId) {
  // Constant table names only.
  if (table !== 'payment_events' && table !== 'payout_events') {
    throw new Error('unexpected table');
  }
  const result = await db.query(
    `SELECT COUNT(*)::int AS rows, MAX(outcome) AS outcome, MAX(processing_error) AS problem
     FROM ${table} WHERE event_id = $1`,
    [eventId],
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

function loadDevEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!existsSync(envFile)) {
    throw new Error('.env not found in raj_backend');
  }
  process.loadEnvFile(envFile);
  if (!process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
    throw new Error('Refusing to run: RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_)');
  }
  if (!existsSync(path.join(ROOT, 'dist', 'main.js'))) {
    throw new Error('dist/main.js not found: run `npm run build` first');
  }
  const devUrl = new URL(process.env.DATABASE_URL ?? '');
  const e2eUrl = new URL(devUrl);
  e2eUrl.pathname = `/${E2E_DATABASE}`;
  const serverUrl = new URL(devUrl);
  serverUrl.pathname = '/postgres';
  if (!e2eUrl.pathname.endsWith('_e2e')) {
    throw new Error('Refusing to run against a database whose name does not end with _e2e');
  }
  return { e2eUrl: e2eUrl.toString(), serverUrl: serverUrl.toString() };
}

async function recreateDatabase(serverUrl, e2eUrl) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    // Constant identifier, guarded above: never a user-supplied name.
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DATABASE}`);
  } finally {
    await client.end();
  }
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: e2eUrl }, stdio: 'pipe' },
  );
}

/** A local identity provider: an RS256 key published as a JWKS, like Firebase's endpoint. */
async function startJwks() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `e2e-${randomBytes(4).toString('hex')}`;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  jwksServer = createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
      });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
  const sign = (subject) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'phone' } },
      privateKey,
      { algorithm: 'RS256', keyid: kid, subject, issuer: ISSUER, audience: AUDIENCE },
    );
  };
  return { url, sign };
}

function provision(e2eUrl, args) {
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, 'dist', 'cli', 'provision.js'), ...args],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: e2eUrl, AUTH_PROVIDER: 'firebase', NODE_ENV: 'development' },
      encoding: 'utf8',
    },
  );
  return JSON.parse(output);
}

const phone = () => `+91${randomInt(6_000_000_000, 9_999_999_999)}`;

/** Wall-clock weekday (1 = Monday) and HH:MM of an instant in India. */
function indiaWallClock(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  return { weekday, time: `${parts.hour}:${parts.minute}` };
}

async function startBackend(env) {
  const logFile = path.join(tmpdir(), 'multipleride-e2e-backend.log');
  const log = createWriteStream(logFile);
  backend = spawn(process.execPath, [path.join(ROOT, 'dist', 'main.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.pipe(log);
  backend.stderr.pipe(log);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) {
      throw new Error(`Backend exited with code ${backend.exitCode}; see ${logFile}`);
    }
    try {
      const response = await fetch(`${BASE}/health/ready`);
      if (response.ok) {
        return logFile;
      }
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Backend did not become ready; see ${logFile}`);
}

// ---------------------------------------------------------------------------------------------
// HTTP helpers (every call is printed as an equivalent curl command)
// ---------------------------------------------------------------------------------------------

function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function printCurl(method, route, headerNames, body) {
  const parts = [`curl -sS -X ${method} "$BASE${route}"`];
  for (const header of headerNames) {
    parts.push(`-H "${header}"`);
  }
  if (body !== undefined) {
    parts.push('-H "Content-Type: application/json"', `-d ${shellQuote(body)}`);
  }
  console.log(`    $ ${parts.join(' ')}`);
}

/**
 * @param {{ as?: { name: string, token: string }, body?: unknown, raw?: string,
 *           headers?: Record<string, { value: string, shown: string }>, expect: number[] }} options
 */
async function call(method, route, options) {
  const headers = { accept: 'application/json' };
  const shown = [];
  if (options.as) {
    headers.authorization = `Bearer ${options.as.token}`;
    shown.push(`Authorization: Bearer $${options.as.name}`);
  }
  for (const [name, header] of Object.entries(options.headers ?? {})) {
    headers[name] = header.value;
    shown.push(`${name}: ${header.shown}`);
  }
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  printCurl(method, route, shown, body);
  const response = await fetch(`${BASE}${route}`, { method, headers, body });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!options.expect.includes(response.status)) {
    throw new Error(`${method} ${route} -> HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  return { status: response.status, body: json };
}

function signedEvent(secret, event, payload) {
  const body = JSON.stringify({
    entity: 'event',
    account_id: 'acc_E2ELocalRun01',
    event,
    contains: Object.keys(payload),
    payload,
    created_at: Math.floor(Date.now() / 1000),
  });
  return {
    body,
    eventId: `evt_e2e${randomBytes(8).toString('hex')}`,
    signature: createHmac('sha256', secret).update(body).digest('hex'),
  };
}

function sendWebhook(route, webhook, signatureName) {
  return call('POST', route, {
    raw: webhook.body,
    headers: {
      'X-Razorpay-Signature': { value: webhook.signature, shown: `$${signatureName}` },
      'X-Razorpay-Event-Id': { value: webhook.eventId, shown: webhook.eventId },
    },
    expect: [200],
  });
}

function check(condition, message) {
  if (!condition) {
    throw new Error(`Check failed: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function step(number, title, work) {
  console.log(`\n[${number}] ${title}`);
  try {
    const detail = await work();
    report.steps.push({ step: number, title, result: 'PASS', ...(detail ? { detail } : {}) });
    console.log(`    PASS${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  } catch (error) {
    report.steps.push({ step: number, title, result: 'FAIL', error: error.message });
    console.log(`    FAIL  ${error.message}`);
    throw error;
  }
}

function idempotent(label, ok) {
  report.idempotency.push({ check: label, result: ok ? 'PASS' : 'FAIL' });
  check(ok, label);
}

// ---------------------------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------------------------

async function main() {
  const { e2eUrl, serverUrl } = loadDevEnv();
  console.log(`Database ${E2E_DATABASE}: recreating and migrating`);
  await recreateDatabase(serverUrl, e2eUrl);
  db = new pg.Client({ connectionString: e2eUrl });
  await db.connect();
  const idp = await startJwks();

  const subjects = {
    admin: `adm_e2e_${randomBytes(6).toString('hex')}`,
    driver: `drv_e2e_${randomBytes(6).toString('hex')}`,
    customer: `cus_e2e_${randomBytes(6).toString('hex')}`,
  };
  console.log('Provisioning admin, driver (KYC name Ramesh Kumar), customer and the 10% fee rule');
  provision(e2eUrl, ['create-admin', '--phone', phone(), '--subject', subjects.admin]);
  const driverAccount = provision(e2eUrl, [
    'create-driver', '--phone', phone(), '--subject', subjects.driver, '--approve', '--name', 'Ramesh Kumar',
  ]);
  provision(e2eUrl, ['create-customer', '--phone', phone(), '--subject', subjects.customer]);
  const feeRule = provision(e2eUrl, [
    'create-fee-rule', '--type', 'PERCENTAGE', '--value', '10',
    '--reason', 'E2E run: approved V1 platform fee, 10% of the fare',
  ]);
  check(feeRule.roundingMode === 'HALF_UP', 'fee rule rounds HALF_UP');

  const secrets = {
    internalApiKey: randomBytes(32).toString('hex'),
    razorpayWebhook: randomBytes(24).toString('hex'),
    razorpayxWebhook: randomBytes(24).toString('hex'),
  };
  // This week's run a few minutes from now, so the real scheduler prepares the batch.
  const runAt = new Date(Math.ceil((Date.now() + RUN_LEAD_MINUTES * 60_000) / 60_000) * 60_000);
  const schedule = indiaWallClock(runAt);
  const logFile = await startBackend({
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    LOG_LEVEL: 'warn',
    DATABASE_URL: e2eUrl,
    AUTH_JWKS_URL: idp.url,
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    INTERNAL_API_KEYS: secrets.internalApiKey,
    RAZORPAY_WEBHOOK_SECRET: secrets.razorpayWebhook,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: '',
    SETTLEMENT_PROVIDER: 'simulated',
    SETTLEMENT_SYNC_INTERVAL_MINUTES: '0',
    PAYOUT_PROVIDER: 'simulated',
    RAZORPAYX_ACCOUNT_NUMBER: '',
    RAZORPAYX_KEY_ID: '',
    RAZORPAYX_KEY_SECRET: '',
    RAZORPAYX_WEBHOOK_SECRET: secrets.razorpayxWebhook,
    RAZORPAYX_WEBHOOK_SECRET_PREVIOUS: '',
    PAYOUT_SCHEDULE_ENABLED: 'true',
    PAYOUT_SCHEDULE_WEEKDAY: String(schedule.weekday),
    PAYOUT_SCHEDULE_TIME: schedule.time,
    PAYOUT_SCHEDULE_TIMEZONE: TIME_ZONE,
    PAYOUT_AUTO_EXECUTE: 'false',
    TDS_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  });
  console.log(`Backend on ${BASE} (log: ${logFile}); weekly run set to weekday ${schedule.weekday} ${schedule.time} IST`);
  console.log('Shell variables in the commands below: BASE, ADMIN_TOKEN, DRIVER_TOKEN, CUSTOMER_TOKEN,');
  console.log('INTERNAL_API_KEY and the webhook signatures (HMAC-SHA256 of the body with the webhook secret).');

  const admin = { name: 'ADMIN_TOKEN', token: idp.sign(subjects.admin) };
  const driver = { name: 'DRIVER_TOKEN', token: idp.sign(subjects.driver) };
  const customer = { name: 'CUSTOMER_TOKEN', token: idp.sign(subjects.customer) };
  const engineKey = { 'X-Internal-Api-Key': { value: secrets.internalApiKey, shown: '$INTERNAL_API_KEY' } };
  const engine = (method, route, body, expect = [200, 201]) =>
    call(method, route, { headers: engineKey, body, expect });

  let bankAccountId;
  let bookingId;
  let tripId;
  let orderId;
  let providerPaymentId;
  let earningId;
  let control;
  let batchId;
  let payoutId;
  let providerPayoutId;

  await step(0, 'Driver bank account: submitted, validated by the bank, approved by an admin', async () => {
    const submitted = await call('POST', '/v1/bank-account', {
      as: driver,
      body: {
        accountHolderName: 'Ramesh Kumar',
        ifsc: 'HDFC0001234',
        accountNumber: '000011112222',
        confirmAccountNumber: '000011112222',
      },
      expect: [201],
    });
    bankAccountId = submitted.body.bankAccountId;
    check(submitted.body.status === 'PENDING_VERIFICATION', 'new account is PENDING_VERIFICATION');
    check(submitted.body.payoutsEnabled === false, 'no payouts before approval');
    const early = await call('POST', `/v1/admin/bank-accounts/${bankAccountId}/approve`, {
      as: admin,
      body: {},
      expect: [409],
    });
    check(early.body.error.code === 'BANK_VALIDATION_NOT_ACCEPTABLE', 'cannot approve before the bank answers');
    const detail = await call('GET', `/v1/admin/bank-accounts/${bankAccountId}`, { as: admin, expect: [200] });
    const favId = detail.body.validations[0].providerValidationId;
    const bank = await call('POST', `/v1/dev/simulate/bank-validations/${favId}`, {
      as: admin,
      body: { accountStatus: 'active', registeredName: 'RAMESH KUMAR' },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayxWebhook, 'fund_account.validation.completed', {
      'fund_account.validation': { entity: bank.body.entity },
    });
    await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
    const event = await webhookEvent('payout_events', webhook.eventId);
    check(event.outcome === 'BANK_VALIDATION_APPLIED', 'validation webhook applied');
    const approved = await call('POST', `/v1/admin/bank-accounts/${bankAccountId}/approve`, {
      as: admin,
      body: {},
      expect: [200],
    });
    check(approved.body.status === 'VERIFIED', 'account VERIFIED');
    check(approved.body.validations[0].nameMatchResult === 'MATCH', 'bank name matches KYC name');
    check(approved.body.validations[0].accountStatus === 'ACTIVE', 'bank reports the account active');
    report.ids.bankAccountId = bankAccountId;
    return { bankAccountId, providerValidationId: favId, nameMatch: 'MATCH' };
  });

  await step(1, 'Payment created: booking registered, driver assigned, Razorpay order created', async () => {
    const externalRef = `E2E-${randomUUID()}`;
    const registration = {
      externalRef,
      customerSubject: subjects.customer,
      vehicleCategory: 'MINI_TRUCK',
      paymentMethod: 'PREPAID_UPI',
      confirmedFarePaise: FARE_PAISE,
    };
    const registered = await engine('POST', '/v1/internal/bookings', registration);
    bookingId = registered.body.bookingId;
    const again = await engine('POST', '/v1/internal/bookings', registration);
    idempotent('booking registration repeated with the same externalRef returns the same booking', again.body.bookingId === bookingId);
    const assigned = await engine('POST', `/v1/internal/bookings/${bookingId}/assign`, {
      driverSubject: subjects.driver,
    });
    tripId = assigned.body.trip.tripId;
    const key = randomUUID();
    const idem = { 'Idempotency-Key': { value: key, shown: key } };
    const started = await call('POST', `/v1/bookings/${bookingId}/payment`, {
      as: customer,
      headers: idem,
      expect: [201],
    });
    orderId = started.body.checkout.orderId;
    check(/^order_/.test(orderId), 'a real Razorpay test-mode order id');
    const retried = await call('POST', `/v1/bookings/${bookingId}/payment`, {
      as: customer,
      headers: idem,
      expect: [200, 201],
    });
    idempotent('payment start retried with the same Idempotency-Key returns the same Razorpay order', retried.body.checkout.orderId === orderId);
    report.ids = { ...report.ids, bookingId, tripId, orderId, feeRuleId: registered.body.feeRuleId };
    return { bookingId, tripId, orderId, farePaise: FARE_PAISE };
  });

  await step(2, 'Payment verified: Razorpay payment.captured (signed webhook)', async () => {
    providerPaymentId = `pay_E2E${randomBytes(7).toString('hex')}`;
    const webhook = signedEvent(secrets.razorpayWebhook, 'payment.captured', {
      payment: {
        entity: {
          id: providerPaymentId,
          entity: 'payment',
          amount: FARE_PAISE,
          currency: 'INR',
          status: 'captured',
          order_id: orderId,
          method: 'upi',
          captured: true,
          vpa: 'customer@okaxis',
        },
      },
    });
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    const event = await webhookEvent('payment_events', webhook.eventId);
    check(event.outcome === 'APPLIED', 'payment.captured applied');
    idempotent('repeated payment.captured delivery is stored and applied once', event.rows === 1);
    const forged = signedEvent('not-the-real-webhook-secret-000000000000', 'payment.captured', {});
    await call('POST', '/v1/webhooks/razorpay', {
      raw: forged.body,
      headers: {
        'X-Razorpay-Signature': { value: forged.signature, shown: '$FORGED_SIGNATURE' },
        'X-Razorpay-Event-Id': { value: forged.eventId, shown: forged.eventId },
      },
      expect: [400],
    });
    check((await webhookEvent('payment_events', forged.eventId)).rows === 0, 'forged webhook not stored');
    const booking = await call('GET', `/v1/bookings/${bookingId}`, { as: customer, expect: [200] });
    check(booking.body.paymentStatus === 'PAID', 'booking PAID');
    report.ids.providerPaymentId = providerPaymentId;
    return { providerPaymentId, outcome: event.outcome, bookingPaymentStatus: 'PAID' };
  });

  await step(3, 'Settlement confirmed: Razorpay settles the payment to Nikhil Enterprises', async () => {
    const settled = await call('POST', '/v1/dev/simulate/settlements', {
      as: admin,
      body: { providerPaymentId, amountPaise: FARE_PAISE },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayWebhook, 'settlement.processed', {
      settlement: { entity: settled.body.entity },
    });
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    const event = await webhookEvent('payment_events', webhook.eventId);
    check(event.outcome === 'SETTLEMENT_SYNCED' && !event.problem, 'webhook pulled the settlement data');
    const settlements = await call('GET', `/v1/admin/settlements?bookingId=${bookingId}`, {
      as: admin,
      expect: [200],
    });
    check(settlements.body.length === 1, 'exactly one settlement recorded');
    check(settlements.body[0].amountPaise === FARE_PAISE, 'settlement amount equals the payment');
    const resync = await call('POST', '/v1/admin/settlements/sync', { as: admin, body: {}, expect: [200] });
    idempotent('re-syncing settlements records nothing new', resync.body.recorded === 0);
    report.ids.providerSettlementId = settlements.body[0].providerSettlementId;
    return {
      providerSettlementId: settlements.body[0].providerSettlementId,
      settlementUtr: settlements.body[0].settlementUtr,
    };
  });

  await step(4, 'Trip completion processed (trip engine events)', async () => {
    for (const status of ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED']) {
      await engine('POST', `/v1/internal/trips/${tripId}/status`, { status }, [200]);
    }
    const completed = await engine('POST', `/v1/internal/trips/${tripId}/status`, { status: 'COMPLETED' }, [200]);
    check(completed.body.status === 'COMPLETED' && completed.body.trip.status === 'COMPLETED', 'booking and trip COMPLETED');
    const repeated = await Promise.all([
      engine('POST', `/v1/internal/trips/${tripId}/status`, { status: 'COMPLETED' }, [200]),
      engine('POST', `/v1/internal/trips/${tripId}/status`, { status: 'COMPLETED' }, [200]),
    ]);
    idempotent(
      'repeated and concurrent COMPLETED events are accepted without side effects',
      repeated.every((response) => response.body.trip.status === 'COMPLETED'),
    );
    return { bookingStatus: completed.body.status, tripStatus: completed.body.trip.status };
  });

  await step(5, 'Earning created exactly once: Rs 500 gross, Rs 50 fee, Rs 0 TDS, Rs 450 net', async () => {
    const list = await call('GET', `/v1/admin/earnings?driverId=${driverAccount.driverId}&limit=100`, {
      as: admin,
      expect: [200],
    });
    const mine = list.body.items.filter((item) => item.bookingId === bookingId);
    check(mine.length === 1, 'exactly one earning for the booking');
    const [earning] = mine;
    earningId = earning.earningId;
    check(earning.grossAmountPaise === FARE_PAISE, 'gross Rs 500');
    check(earning.platformFeePaise === FEE_PAISE, 'platform fee Rs 50 (10%, HALF_UP)');
    check(earning.otherDeductionsPaise === 0 && earning.tdsAmountPaise === 0, 'no deductions, no TDS');
    check(earning.tdsPolicy === 'DISABLED' && earning.taxRuleId === null, 'TDS policy DISABLED');
    check(earning.netAmountPaise === NET_PAISE, 'net Rs 450');
    report.ids.earningId = earningId;
    return { earningId, gross: FARE_PAISE, fee: FEE_PAISE, tds: 0, net: NET_PAISE };
  });

  await step(6, 'Earning payable (settled), while an unsettled trip stays AWAITING_SETTLEMENT', async () => {
    const earning = await call('GET', `/v1/admin/earnings/${earningId}`, { as: admin, expect: [200] });
    check(earning.body.status === 'PAYABLE', 'earning PAYABLE');
    check(earning.body.merchantSettled === true && earning.body.payableAt !== null, 'settled and payable');

    // Control: a Rs 300 trip paid and completed but never settled by Razorpay.
    const ref = `E2E-CONTROL-${randomUUID()}`;
    const registered = await engine('POST', '/v1/internal/bookings', {
      externalRef: ref,
      customerSubject: subjects.customer,
      vehicleCategory: 'MINI_TRUCK',
      paymentMethod: 'PREPAID_UPI',
      confirmedFarePaise: CONTROL_FARE_PAISE,
    });
    const controlBooking = registered.body.bookingId;
    const assigned = await engine('POST', `/v1/internal/bookings/${controlBooking}/assign`, {
      driverSubject: subjects.driver,
    });
    const key = randomUUID();
    const started = await call('POST', `/v1/bookings/${controlBooking}/payment`, {
      as: customer,
      headers: { 'Idempotency-Key': { value: key, shown: key } },
      expect: [201],
    });
    await sendWebhook(
      '/v1/webhooks/razorpay',
      signedEvent(secrets.razorpayWebhook, 'payment.captured', {
        payment: {
          entity: {
            id: `pay_E2E${randomBytes(7).toString('hex')}`,
            entity: 'payment',
            amount: CONTROL_FARE_PAISE,
            currency: 'INR',
            status: 'captured',
            order_id: started.body.checkout.orderId,
            method: 'upi',
          },
        },
      }),
      'RAZORPAY_SIGNATURE',
    );
    for (const status of ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED', 'COMPLETED']) {
      await engine('POST', `/v1/internal/trips/${assigned.body.trip.tripId}/status`, { status }, [200]);
    }
    const list = await call('GET', `/v1/admin/earnings?driverId=${driverAccount.driverId}&limit=100`, {
      as: admin,
      expect: [200],
    });
    control = list.body.items.find((item) => item.bookingId === controlBooking);
    check(control?.status === 'AWAITING_SETTLEMENT', 'unsettled control earning is not payable');
    const summary = await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] });
    check(summary.body.payablePaise === NET_PAISE, 'driver sees Rs 450 payable');
    check(summary.body.awaitingSettlementPaise === 27_000, 'driver sees Rs 270 awaiting settlement');
    report.ids.controlEarningId = control.earningId;
    return {
      earningStatus: 'PAYABLE',
      payableAt: earning.body.payableAt,
      controlEarning: { earningId: control.earningId, status: control.status },
    };
  });

  await step(7, 'Weekly batch prepared by the scheduler at the configured run time', async () => {
    const view = await call('GET', '/v1/admin/payout-schedule', { as: admin, expect: [200] });
    const nextRunAt = view.body.nextRunAt;
    check(new Date(nextRunAt).getTime() === runAt.getTime(), 'scheduler reports the configured run time');
    console.log(`    waiting for the scheduler: run at ${nextRunAt} (${schedule.time} IST)`);
    const deadline = new Date(nextRunAt).getTime() + 150_000;
    let batch;
    while (!batch && Date.now() < deadline) {
      await sleep(5_000);
      const batches = await fetch(`${BASE}/v1/admin/payout-batches`, {
        headers: { authorization: `Bearer ${admin.token}` },
      }).then((response) => response.json());
      batch = batches.find((candidate) => candidate.origin === 'SCHEDULE' && candidate.cutoffAt === nextRunAt);
    }
    check(batch, 'the scheduler prepared this week\'s batch');
    batchId = batch.batchId;
    check(batch.status === 'PREPARED', 'prepared, not executed (PAYOUT_AUTO_EXECUTE=false)');
    const detail = await call('GET', `/v1/admin/payout-batches/${batchId}`, { as: admin, expect: [200] });
    const payout = detail.body.payouts.find((candidate) => candidate.driverId === driverAccount.driverId);
    check(payout, 'a payout for the driver');
    payoutId = payout.payoutId;
    const full = await call('GET', `/v1/admin/payouts/${payoutId}`, { as: admin, expect: [200] });
    const items = full.body.items.map((item) => item.earningId);
    check(items.length === 1 && items[0] === earningId, 'only the settled earning is in the payout');
    check(!items.includes(control.earningId), 'the unsettled earning is excluded');
    check(full.body.grossAmountPaise === NET_PAISE && full.body.tdsAmountPaise === 0, 'gross Rs 450, TDS 0');
    check(full.body.amountPaise === NET_PAISE, 'transfer Rs 450');
    const earning = await call('GET', `/v1/admin/earnings/${earningId}`, { as: admin, expect: [200] });
    check(earning.body.status === 'IN_PAYOUT', 'earning IN_PAYOUT');
    const rerun = await call('POST', '/v1/admin/payout-schedule/run', { as: admin, expect: [200] });
    idempotent('running the weekly schedule again returns the same batch', rerun.body.batch?.batchId === batchId);
    report.ids = { ...report.ids, batchId, payoutId, cycleKey: batch.cycleKey };
    return { batchId, cycleKey: batch.cycleKey, cutoffAt: batch.cutoffAt, payoutId, amountPaise: NET_PAISE };
  });

  await step(8, 'Payout created to the verified bank account', async () => {
    const executed = await call('POST', `/v1/admin/payout-batches/${batchId}/execute`, {
      as: admin,
      expect: [200],
    });
    const result = executed.body.results.find((entry) => entry.payoutId === payoutId);
    check(result?.result === 'SUBMITTED', 'payout accepted by the provider');
    const payout = await call('GET', `/v1/admin/payouts/${payoutId}`, { as: admin, expect: [200] });
    providerPayoutId = payout.body.providerPayoutId;
    check(payout.body.bankAccountId === bankAccountId, 'sent to the approved bank account');
    await call('POST', `/v1/admin/payout-batches/${batchId}/execute`, { as: admin, expect: [200] });
    const after = await call('GET', `/v1/admin/payouts/${payoutId}`, { as: admin, expect: [200] });
    idempotent(
      'executing the batch again never creates a second transfer',
      after.body.providerPayoutId === providerPayoutId && after.body.attempts === payout.body.attempts,
    );
    report.ids.providerPayoutId = providerPayoutId;
    return { providerPayoutId, bankAccountId, status: payout.body.status };
  });

  await step(9, 'Provider success: RazorpayX payout.processed (signed webhook)', async () => {
    const moved = await call('POST', `/v1/dev/simulate/payouts/${providerPayoutId}`, {
      as: admin,
      body: { status: 'processed' },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayxWebhook, 'payout.processed', {
      payout: { entity: moved.body.entity },
    });
    await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
    await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
    const event = await webhookEvent('payout_events', webhook.eventId);
    check(event.outcome === 'APPLIED', 'payout.processed applied');
    idempotent('repeated payout.processed delivery is stored and applied once', event.rows === 1);
    return { utr: moved.body.entity.utr, outcome: event.outcome };
  });

  await step(10, 'Earning PAID only after the provider confirmed the payout', async () => {
    const earning = await call('GET', `/v1/admin/earnings/${earningId}`, { as: admin, expect: [200] });
    check(earning.body.status === 'PAID' && earning.body.paidAt, 'earning PAID');
    const payouts = await call('GET', '/v1/payouts', { as: driver, expect: [200] });
    const mine = payouts.body.find((payout) => payout.payoutId === payoutId);
    check(mine?.status === 'PROCESSED' && mine.utr, 'driver sees the processed payout with its UTR');
    check(mine.amountPaise === NET_PAISE && mine.bankAccountLast4 === '2222', 'Rs 450 to the account ending 2222');
    const summary = await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] });
    check(summary.body.paidPaise === NET_PAISE, 'driver summary shows Rs 450 paid');
    const control2 = await call('GET', `/v1/admin/earnings/${control.earningId}`, { as: admin, expect: [200] });
    check(control2.body.status === 'AWAITING_SETTLEMENT', 'unsettled earning still unpaid');
    return { earningStatus: 'PAID', paidAt: earning.body.paidAt, utr: mine.utr };
  });

  await step(11, 'Audit and reconciliation trail', async () => {
    const chain = await call('GET', `/v1/admin/bookings/${bookingId}`, { as: admin, expect: [200] });
    const body = chain.body;
    check(body.booking.status === 'COMPLETED' && body.booking.paymentStatus === 'PAID', 'booking completed and paid');
    check(body.feeRule.value === '10.0000' && body.feeRule.roundingMode === 'HALF_UP', 'pinned 10% HALF_UP rule');
    check(body.customerPayments[0].razorpayPaymentId === providerPaymentId, 'customer payment linked');
    check(body.merchantSettlement?.providerPaymentId === providerPaymentId, 'merchant settlement linked');
    check(body.earning.status === 'PAID' && body.earning.paidOut === true, 'earning paid out');
    const history = body.earning.payoutHistory;
    check(history.length === 1 && history[0].payoutStatus === 'PROCESSED' && history[0].utr, 'payout history with UTR');
    for (const reportName of ['earning-mismatches', 'payout-mismatches']) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      check(
        !JSON.stringify(findings.body).includes(bookingId) && !JSON.stringify(findings.body).includes(payoutId),
        `${reportName}: nothing for this booking or payout`,
      );
    }
    // Read-only audit queries on the e2e database.
    const client = db;
    {
      const actions = await client.query(
        `SELECT action, COUNT(*)::int AS count FROM admin_actions
         WHERE target_id = ANY($1::text[]) GROUP BY action ORDER BY action`,
        [[bankAccountId, batchId, earningId, payoutId]],
      );
      const audited = Object.fromEntries(actions.rows.map((row) => [row.action, row.count]));
      for (const action of ['BANK_ACCOUNT_SUBMITTED', 'BANK_ACCOUNT_APPROVED', 'PAYOUT_BATCH_PREPARED', 'PAYOUT_BATCH_EXECUTED']) {
        check(audited[action] >= 1, `audit entry ${action}`);
      }
      const events = await client.query(
        `SELECT event_type, outcome FROM payment_events WHERE payload::text LIKE '%' || $1 || '%'
         UNION ALL
         SELECT event_type, outcome FROM payout_events WHERE payout_id = $2::uuid
         ORDER BY 1`,
        [providerPaymentId, payoutId],
      );
      const rows = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM driver_earnings WHERE booking_id = $1::uuid) AS earnings,
           (SELECT COUNT(*)::int FROM payment_settlements WHERE booking_id = $1::uuid) AS settlements,
           (SELECT COUNT(*)::int FROM payout_items WHERE earning_id = $2::uuid AND status = 'PAID') AS paid_items,
           (SELECT COUNT(*)::int FROM driver_payouts WHERE driver_id = $3::uuid AND status = 'PROCESSED') AS processed_payouts`,
        [bookingId, earningId, driverAccount.driverId],
      );
      const counts = rows.rows[0];
      check(counts.earnings === 1 && counts.settlements === 1 && counts.paid_items === 1, 'one earning, one settlement, one paid item');
      check(counts.processed_payouts === 1, 'one processed payout');
      return { audited, webhookEvents: events.rows, counts };
    }
  });
}

async function shutdown() {
  if (backend && backend.exitCode === null) {
    backend.kill();
  }
  if (db) {
    await db.end().catch(() => undefined);
  }
  if (jwksServer) {
    await new Promise((resolve) => jwksServer.close(resolve));
  }
}

const reportFile = path.join(tmpdir(), 'multipleride-e2e-report.json');
main()
  .then(async () => {
    await shutdown();
    report.finishedAt = new Date().toISOString();
    report.result = 'PASS';
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log('\nSUMMARY');
    for (const entry of report.steps) {
      console.log(`  [${String(entry.step).padStart(2)}] ${entry.result}  ${entry.title}`);
    }
    for (const entry of report.idempotency) {
      console.log(`  idempotency ${entry.result}  ${entry.check}`);
    }
    console.log(`\nAll steps passed. Report: ${reportFile}`);
  })
  .catch(async (error) => {
    await shutdown();
    report.finishedAt = new Date().toISOString();
    report.result = 'FAIL';
    report.error = error.message;
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.error(`\nE2E FAILED: ${error.message}\nReport: ${reportFile}`);
    process.exit(1);
  });
