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
 *   - RazorpayX bank validation and payouts: PAYOUT_PROVIDER=simulated + signed webhooks;
 *   - the customer paying a pickup or drop QR (Razorpay test mode can't pay a QR code):
 *     COLLECTION_LINK_PROVIDER=simulated + a signed qr_code.credited (payment flow Phase 4).
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
/** Wallet float the admin credits before the first cash collection (cash debits the fee). */
const WALLET_FLOAT_PAISE = 200_000;
/** Minutes between backend start and the scheduled weekly run used for this test. */
const RUN_LEAD_MINUTES = 3;

const report = { startedAt: new Date().toISOString(), steps: [], idempotency: [], ids: {} };
let backend;
let jwksServer;
/** Read-only queries on the e2e database (webhook outcomes, audit trail). */
let db;

/**
 * Inserts a historical PREPAID_UPI booking (LEGACY_BOOKING_LEVEL) the way it exists in a
 * database migrated from before fare quotes. The API and the application role can't create one:
 * the insert guard refuses it, so the table owner disables only that guard, in one transaction.
 */
async function insertLegacyPrepaidBooking({ externalRef, customerId, feeRuleId, farePaise }) {
  await db.query('BEGIN');
  try {
    await db.query('ALTER TABLE bookings DISABLE TRIGGER trg_bookings_insert_guard');
    const result = await db.query(
      `INSERT INTO bookings (external_ref, customer_id, vehicle_category, fare_estimate_minor,
         final_fare_minor, payment_method, fee_rule_id, payment_model, confirmed_at)
       VALUES ($1, $2, 'MINI_TRUCK', $3, $3, 'PREPAID_UPI', $4, 'LEGACY_BOOKING_LEVEL', now())
       RETURNING id`,
      [externalRef, customerId, farePaise, feeRuleId],
    );
    // The insert queued the deferred snapshot check; Postgres refuses ALTER TABLE while a table
    // has pending trigger events, so run it now (it passes for LEGACY rows).
    await db.query('SET CONSTRAINTS trg_bookings_snapshot IMMEDIATE');
    await db.query('ALTER TABLE bookings ENABLE TRIGGER trg_bookings_insert_guard');
    await db.query('COMMIT');
    return result.rows[0].id;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

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
  /** A Firebase-shaped ID token. `authTime` is the (re-)authentication time, in seconds. */
  const sign = (subject, { authTime, phoneNumber } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iat: now,
        exp: now + 3600,
        auth_time: authTime ?? now,
        ...(phoneNumber ? { phone_number: phoneNumber } : {}),
        firebase: { sign_in_provider: 'phone' },
      },
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
  const driverPhone = phone();
  const driverAccount = provision(e2eUrl, [
    'create-driver', '--phone', driverPhone, '--subject', subjects.driver, '--approve', '--name', 'Ramesh Kumar',
  ]);
  const customerAccount = provision(e2eUrl, ['create-customer', '--phone', phone(), '--subject', subjects.customer]);
  const feeRule = provision(e2eUrl, [
    'create-fee-rule', '--type', 'PERCENTAGE', '--value', '10',
    '--reason', 'E2E run: approved V1 platform fee, 10% of the fare',
  ]);
  check(feeRule.roundingMode === 'HALF_UP', 'fee rule rounds HALF_UP');
  // Development rates only (pricing/README.md): no production pricing exists yet.
  const pricing = provision(e2eUrl, [
    'create-pricing-version', '--code', `PROTOTYPE-E2E-${randomBytes(3).toString('hex').toUpperCase()}`,
    '--file', path.join(ROOT, 'pricing', 'prototype-leg-distance-v1.json'),
    '--reason', 'E2E run: development prototype rates, not approved for production',
  ]);
  check(pricing.developmentOnly === true, 'the prototype pricing version is marked development only');

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
    COLLECTION_LINK_PROVIDER: 'simulated',
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
  const driver = { name: 'DRIVER_TOKEN', token: idp.sign(subjects.driver, { phoneNumber: driverPhone }) };
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

  await step(0, 'Driver bank account: change request, phone OTP step-up, bank validation, admin approval', async () => {
    const details = {
      accountHolderName: 'Ramesh Kumar',
      ifsc: 'HDFC0001234',
      accountNumber: '000011112222',
      confirmAccountNumber: '000011112222',
    };
    const challenge = await call('POST', '/v1/bank-account/change-requests', { as: driver, expect: [201] });
    const changeRequestId = challenge.body.changeRequestId;
    check(challenge.body.status === 'PENDING_STEP_UP', 'change request waits for the step-up');
    check(challenge.body.stepUp?.method === 'FIREBASE_PHONE_REAUTH', 'step-up is a Firebase phone OTP re-auth');
    const confirmRoute = `/v1/bank-account/change-requests/${changeRequestId}/confirm`;
    // The existing session alone (signed in before the request) can never set a payout account.
    const stolen = await call('POST', confirmRoute, { as: driver, body: details, expect: [403] });
    check(stolen.body.error.code === 'STEP_UP_REQUIRED', 'the existing session is refused (STEP_UP_REQUIRED)');
    // The app re-authenticates with an OTP: a fresh ID token with auth_time after the request.
    const requestedAt = Math.floor(Date.parse(challenge.body.createdAt) / 1000);
    while (Math.floor(Date.now() / 1000) <= requestedAt) {
      await sleep(200);
    }
    const reauthenticated = {
      name: 'DRIVER_STEP_UP_TOKEN',
      token: idp.sign(subjects.driver, { phoneNumber: driverPhone }),
    };
    const submitted = await call('POST', confirmRoute, { as: reauthenticated, body: details, expect: [201] });
    const replay = await call('POST', confirmRoute, { as: reauthenticated, body: details, expect: [409] });
    idempotent('a used change request cannot be confirmed again', replay.body.error.code === 'BANK_CHANGE_REQUEST_CLOSED');
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
    check(approved.body.changeRequest?.changeRequestId === changeRequestId, 'approval shows the step-up evidence');
    report.ids.bankAccountId = bankAccountId;
    report.ids.changeRequestId = changeRequestId;
    return { bankAccountId, changeRequestId, providerValidationId: favId, nameMatch: 'MATCH' };
  });

  await step('1a', 'New bookings: server fare quote, registered from the quote, PREPAID_UPI refused, unpaid pickup handover refused', async () => {
    const route = {
      pickup: { latitude: 26.2389, longitude: 73.0243 },
      drops: [
        { latitude: 26.3448, longitude: 73.0458 },
        { latitude: 26.3448, longitude: 73.0858 },
      ],
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 12.5,
    };
    const quoted = await call('POST', '/v1/fare/quotes', { as: customer, body: route, expect: [201] });
    const quote = quoted.body;
    check(quote.pricingVersion.pricingVersionId === pricing.pricingVersionId, 'priced by the version in effect');
    check(quote.drops.length === 2, 'one amount per drop');
    check(quote.payablePaise === quote.drops[0].payablePaise + quote.drops[1].payablePaise, 'drops add up to the total');
    const tampered = await call('POST', '/v1/fare/quotes', {
      as: customer,
      body: { ...route, farePaise: 1 },
      expect: [400],
    });
    check(tampered.body.error.code === 'VALIDATION_FAILED', 'the app cannot send an amount');

    const registration = {
      externalRef: `E2E-PICKUP-${randomUUID()}`,
      customerSubject: subjects.customer,
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
    };
    const registered = await engine('POST', '/v1/internal/bookings', registration, [201]);
    check(registered.body.paymentModel === 'QUOTE_PER_STOP', 'registered from the quote');
    check(registered.body.payablePaise === quote.payablePaise, 'the booking freezes the quoted total');
    check(registered.body.platformFeePaise === Math.round(quote.payablePaise / 10), 'the 10% fee is frozen');
    check(
      registered.body.stops.map((stop) => stop.payablePaise).join() === quote.drops.map((drop) => drop.payablePaise).join(),
      'one stop per quoted drop, same amounts',
    );
    const again = await engine('POST', '/v1/internal/bookings', registration, [200]);
    idempotent('registering the same ref and quote again returns the same booking', again.body.bookingId === registered.body.bookingId);
    const reused = await engine('POST', '/v1/internal/bookings', { ...registration, externalRef: `E2E-REUSE-${randomUUID()}` }, [409]);
    idempotent('a quote is redeemed once', reused.body.error.code === 'QUOTE_ALREADY_USED');

    const second = await call('POST', '/v1/fare/quotes', { as: customer, body: route, expect: [201] });
    const prepaid = await engine('POST', '/v1/internal/bookings', {
      ...registration,
      externalRef: `E2E-PREPAID-${randomUUID()}`,
      quoteId: second.body.quoteId,
      paymentMethod: 'PREPAID_UPI',
    }, [422]);
    check(prepaid.body.error.code === 'PAYMENT_METHOD_NOT_OFFERED', 'PREPAID_UPI is refused for new bookings');
    const engineFare = await engine('POST', '/v1/internal/bookings', {
      ...registration,
      externalRef: `E2E-FARE-${randomUUID()}`,
      quoteId: second.body.quoteId,
      confirmedFarePaise: 1,
    }, [400]);
    check(engineFare.body.error.code === 'VALIDATION_FAILED', 'the engine cannot send a fare');

    // Pickup gate (payment flow Phase 3): at the pickup the payment is required first; the
    // handover and the start are refused until the booking is paid.
    const assigned = await engine('POST', `/v1/internal/bookings/${registered.body.bookingId}/assign`, {
      driverSubject: subjects.driver,
    }, [200]);
    const pickupTripId = assigned.body.trip.tripId;
    const arrived = await engine('POST', `/v1/internal/trips/${pickupTripId}/status`, { status: 'DRIVER_ARRIVED' }, [200]);
    const gate = arrived.body.paymentGate;
    check(
      gate.stage === 'PICKUP' && gate.paymentState === 'PAYMENT_REQUIRED' && gate.amountPaise === quote.payablePaise && !gate.handoverAllowed,
      'payment required at the pickup, handover not allowed',
    );
    const handover = await engine('POST', `/v1/internal/trips/${pickupTripId}/status`, { status: 'PICKUP_VERIFIED' }, [409]);
    check(
      handover.body.error.code === 'PAYMENT_REQUIRED' && handover.body.error.details.stage === 'PICKUP',
      'an unpaid pickup handover is refused',
    );
    const start = await engine('POST', `/v1/internal/trips/${pickupTripId}/status`, { status: 'IN_TRANSIT' }, [409]);
    check(start.body.error.code === 'PAYMENT_REQUIRED', 'an unpaid trip cannot start');
    report.ids.pickupBookingId = registered.body.bookingId;
    report.ids.pickupTripId = pickupTripId;
    return {
      quoteId: quote.quoteId,
      bookingId: registered.body.bookingId,
      payablePaise: quote.payablePaise,
      paymentGate: gate,
    };
  });

  await step(1, 'Payment created (historical prepaid booking): driver assigned, Razorpay order created', async () => {
    // The online money path below (Checkout -> settlement -> payout) runs on a historical
    // PREPAID_UPI booking, which the API can no longer create. It is inserted as data, the way
    // such rows exist in a database migrated from before quotes. Phase 11 replaces this flow with
    // pay at pickup by QR.
    const externalRef = `E2E-LEGACY-${randomUUID()}`;
    bookingId = await insertLegacyPrepaidBooking({
      externalRef,
      customerId: customerAccount.customerId,
      feeRuleId: feeRule.feeRuleId,
      farePaise: FARE_PAISE,
    });
    const registered = await engine('GET', `/v1/internal/bookings/by-ref/${externalRef}`, undefined, [200]);
    check(registered.body.paymentModel === 'LEGACY_BOOKING_LEVEL', 'historical booking keeps its legacy model');
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

    // Control: a Rs 300 trip paid and completed but never settled by Razorpay (historical prepaid).
    const controlBooking = await insertLegacyPrepaidBooking({
      externalRef: `E2E-CONTROL-${randomUUID()}`,
      customerId: customerAccount.customerId,
      feeRuleId: feeRule.feeRuleId,
      farePaise: CONTROL_FARE_PAISE,
    });
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

  // -------------------------------------------------------------------------------------------
  // Payment flow Phase 4: one collection per obligation. PAY_AT_PICKUP: the booking, collected
  // at the pickup. PAY_AT_DELIVERY priced per drop: the drop the driver is at. The server
  // resolves every amount from the frozen booking; the app's amount is only an echo. Cash debits
  // the obligation's frozen fee from the driver wallet once; a QR is confirmed only by what the
  // provider reports (webhook, driver refresh or admin sync, all through one finalizer).
  // -------------------------------------------------------------------------------------------
  const phase4Events = [];
  let walletId;
  let pickupCash;
  let pickupQr;
  let delivery;

  /** A booking registered from a fresh fare quote, assigned to the driver. */
  async function bookFromQuote(label, paymentMethod, drops) {
    const quoted = await call('POST', '/v1/fare/quotes', {
      as: customer,
      body: { pickup: { latitude: 26.2389, longitude: 73.0243 }, drops, vehicleCategory: 'MINI_TRUCK', weightKg: 12.5 },
      expect: [201],
    });
    const registered = await engine('POST', '/v1/internal/bookings', {
      externalRef: `E2E-${label}-${randomUUID()}`,
      customerSubject: subjects.customer,
      quoteId: quoted.body.quoteId,
      paymentMethod,
    }, [201]);
    check(
      registered.body.paymentModel === 'QUOTE_PER_STOP' && registered.body.paymentMethod === paymentMethod,
      `${paymentMethod} booking registered from the quote`,
    );
    check(registered.body.payablePaise === quoted.body.payablePaise, 'the booking freezes the quoted total');
    const assigned = await engine('POST', `/v1/internal/bookings/${registered.body.bookingId}/assign`, {
      driverSubject: subjects.driver,
    }, [200]);
    return { booking: registered.body, bookingId: registered.body.bookingId, tripId: assigned.body.trip.tripId };
  }

  /** The driver records a collection for the obligation the trip is at. */
  const collectAt = (atTripId, body, expect, key = randomUUID()) =>
    call('POST', `/v1/trips/${atTripId}/collections`, {
      as: driver,
      headers: { 'Idempotency-Key': { value: key, shown: key } },
      body,
      expect,
    });
  const tripStatus = (atTripId, status, expect = [200]) =>
    engine('POST', `/v1/internal/trips/${atTripId}/status`, { status }, expect);
  const stopStatus = (atTripId, sequence, status, expect = [200]) =>
    engine('POST', `/v1/internal/trips/${atTripId}/stops/${sequence}/status`, { status }, expect);
  const walletNow = async () => (await call('GET', '/v1/wallet', { as: driver, expect: [200] })).body;
  const earningOf = async (ofBookingId) => {
    const list = await call('GET', `/v1/admin/earnings?driverId=${driverAccount.driverId}&limit=100`, {
      as: admin,
      expect: [200],
    });
    const mine = list.body.items.filter((item) => item.bookingId === ofBookingId);
    check(mine.length === 1, 'exactly one earning for the booking');
    return mine[0];
  };

  /** The customer scans and pays a collection's QR (simulated provider). */
  async function customerPaysQr(collectionId) {
    const view = await call('GET', `/v1/admin/collections/${collectionId}`, { as: admin, expect: [200] });
    const qrCodeId = view.body.providerReferenceId;
    const paid = await call('POST', `/v1/dev/simulate/qr-codes/${qrCodeId}/payments`, {
      as: admin,
      body: {},
      expect: [200],
    });
    return { qrCodeId, qrCode: paid.body.qrCode, payment: paid.body.payment };
  }

  /** Razorpay's signed webhook for a QR payment (qr_code.credited or payment.captured). */
  async function deliverQrEvent(event, paid) {
    const payload =
      event === 'qr_code.credited'
        ? { payment: { entity: paid.payment }, qr_code: { entity: paid.qrCode } }
        : { payment: { entity: paid.payment } };
    const webhook = signedEvent(secrets.razorpayWebhook, event, payload);
    phase4Events.push(webhook.eventId);
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    return { webhook, ...(await webhookEvent('payment_events', webhook.eventId)) };
  }

  /** Razorpay settles a customer payment to Nikhil Enterprises (signed settlement.processed). */
  async function settle(settledPaymentId, amountPaise) {
    const settled = await call('POST', '/v1/dev/simulate/settlements', {
      as: admin,
      body: { providerPaymentId: settledPaymentId, amountPaise },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayWebhook, 'settlement.processed', {
      settlement: { entity: settled.body.entity },
    });
    phase4Events.push(webhook.eventId);
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    const event = await webhookEvent('payment_events', webhook.eventId);
    check(event.outcome === 'SETTLEMENT_SYNCED' && !event.problem, 'webhook pulled the settlement data');
    return settled.body.settledPayment;
  }

  await step(12, 'PAY_AT_PICKUP in cash: amount from the frozen booking, fee debited from the wallet once, handover after payment, earning settled in cash', async () => {
    // The step 1a booking, still at the pickup and unpaid.
    const atBookingId = report.ids.pickupBookingId;
    const atTripId = report.ids.pickupTripId;
    const at = await engine('GET', `/v1/internal/bookings/${atBookingId}`, undefined, [200]);
    const owed = at.body.payablePaise;
    const fee = at.body.platformFeePaise;
    const gate = at.body.paymentGate;
    check(
      gate.stage === 'PICKUP' && gate.paymentState === 'PAYMENT_REQUIRED' && gate.amountPaise === owed && gate.cashFeePaise === fee,
      'the pickup gate asks for the frozen total; cash costs the frozen platform fee',
    );
    const empty = await walletNow();
    walletId = empty.walletId;
    check(empty.balancePaise === 0, 'the driver wallet starts empty');
    const broke = await collectAt(atTripId, { method: 'CASH', amountPaise: owed }, [409]);
    check(broke.body.error.code === 'INSUFFICIENT_BALANCE', 'cash with an empty wallet is refused: the wallet never goes negative');
    const fundKey = randomUUID();
    await call('POST', `/v1/admin/wallets/${walletId}/adjustments`, {
      as: admin,
      headers: { 'Idempotency-Key': { value: fundKey, shown: fundKey } },
      body: { direction: 'CREDIT', amountPaise: WALLET_FLOAT_PAISE, reason: 'E2E run: float for the cash platform fees' },
      expect: [201],
    });
    const wrong = await collectAt(atTripId, { method: 'CASH', amountPaise: owed - 100 }, [422]);
    check(
      wrong.body.error.code === 'COLLECTION_AMOUNT_MISMATCH' && wrong.body.error.details.expectedPaise === owed,
      'a different amount is refused: the app only echoes what is owed',
    );
    const asDrop = await collectAt(atTripId, { method: 'CASH', amountPaise: owed, stopSequence: 1 }, [400]);
    check(asDrop.body.error.code === 'VALIDATION_FAILED', 'the pickup obligation is the whole booking, not a drop');

    const key = randomUUID();
    const collected = await collectAt(atTripId, { method: 'CASH', amountPaise: owed }, [201], key);
    const collection = collected.body;
    check(
      collection.stage === 'PICKUP' && collection.stopSequence === null && collection.status === 'COMPLETED' &&
        collection.amountPaise === owed && collection.platformFeePaise === fee,
      'one completed cash collection for the booking, with the frozen fee',
    );
    check(
      collection.bookingPaymentStatus === 'PAID' && collection.paymentGate.paymentState === 'PAYMENT_CONFIRMED' &&
        collection.paymentGate.handoverAllowed === true,
      'booking PAID; the handover is allowed',
    );
    const replay = await collectAt(atTripId, { method: 'CASH', amountPaise: owed }, [200, 201], key);
    const after = await walletNow();
    idempotent(
      'cash retried with the same Idempotency-Key returns the same collection and debits the wallet once',
      replay.body.collectionId === collection.collectionId && replay.body.replayed === true &&
        after.balancePaise === WALLET_FLOAT_PAISE - fee,
    );
    const again = await collectAt(atTripId, { method: 'ONLINE_QR', amountPaise: owed }, [409]);
    check(again.body.error.code === 'BOOKING_ALREADY_PAID', 'a paid booking takes no second collection');

    await tripStatus(atTripId, 'PICKUP_VERIFIED');
    await tripStatus(atTripId, 'IN_TRANSIT');
    for (const stop of at.body.stops) {
      await stopStatus(atTripId, stop.sequence, 'ARRIVED');
      await stopStatus(atTripId, stop.sequence, 'DELIVERED');
    }
    const completed = await tripStatus(atTripId, 'COMPLETED');
    check(completed.body.status === 'COMPLETED' && completed.body.paidWith === 'CASH', 'booking COMPLETED, paid in cash');
    const earning = await earningOf(atBookingId);
    check(earning.settlement === 'CASH' && earning.status === 'SETTLED_IN_CASH', 'earning SETTLED_IN_CASH');
    check(
      earning.grossAmountPaise === owed && earning.platformFeePaise === fee && earning.netAmountPaise === owed - fee,
      'gross = collected, fee = frozen fee',
    );
    check(earning.collectionId === collection.collectionId, 'the earning names its cash collection');
    pickupCash = { bookingId: atBookingId, collectionId: collection.collectionId, earningId: earning.earningId, netPaise: owed - fee, feePaise: fee };
    return {
      bookingId: atBookingId,
      collectionId: collection.collectionId,
      amountPaise: owed,
      feePaise: fee,
      walletBalancePaise: after.balancePaise,
      earning: { earningId: earning.earningId, settlement: earning.settlement, status: earning.status },
    };
  });

  await step(13, 'PAY_AT_PICKUP by QR: booking-linked QR, signed qr_code.credited, every confirmation path agrees, earning payable once Razorpay settles', async () => {
    const { booking, bookingId: qrBookingId, tripId: qrTripId } = await bookFromQuote('PICKUP-QR', 'PAY_AT_PICKUP', [
      { latitude: 26.2967, longitude: 73.0351 },
    ]);
    const owed = booking.payablePaise;
    const fee = booking.platformFeePaise;
    const arrived = await tripStatus(qrTripId, 'DRIVER_ARRIVED');
    check(arrived.body.paymentGate.paymentState === 'PAYMENT_REQUIRED', 'payment required at the pickup');
    const walletBefore = (await walletNow()).balancePaise;

    const shown = await collectAt(qrTripId, { method: 'ONLINE_QR', amountPaise: owed }, [201]);
    const collectionId = shown.body.collectionId;
    check(
      shown.body.status === 'PENDING' && shown.body.qr?.product === 'QR_CODE' && shown.body.amountPaise === owed &&
        shown.body.paymentGate.paymentState === 'PAYMENT_PROCESSING' && shown.body.paymentGate.handoverAllowed === false,
      'a pending QR for the booking total; no handover while it is unpaid',
    );
    const again = await collectAt(qrTripId, { method: 'ONLINE_QR', amountPaise: owed }, [200, 201]);
    idempotent(
      'asking for the QR again shows the same live QR (one live collection per obligation)',
      again.body.collectionId === collectionId && again.body.replayed === true,
    );
    const early = await tripStatus(qrTripId, 'PICKUP_VERIFIED', [409]);
    check(early.body.error.code === 'PAYMENT_REQUIRED', 'no handover before the payment is confirmed');

    const paid = await customerPaysQr(collectionId);
    check(
      paid.qrCode.notes.collection_id === collectionId && paid.qrCode.notes.booking_id === qrBookingId &&
        paid.qrCode.notes.stage === 'PICKUP' && paid.qrCode.notes.stop_sequence === undefined,
      'the QR names its obligation in its notes: collection, booking, PICKUP',
    );
    const credited = await deliverQrEvent('qr_code.credited', paid);
    await sendWebhook('/v1/webhooks/razorpay', credited.webhook, 'RAZORPAY_SIGNATURE');
    const event = await webhookEvent('payment_events', credited.webhook.eventId);
    check(credited.outcome === 'APPLIED' && !credited.problem, 'qr_code.credited applied: the backend re-read the QR from the provider');
    idempotent('repeated qr_code.credited delivery is stored and applied once', event.rows === 1);
    const captured = await deliverQrEvent('payment.captured', paid);
    const refreshed = await call('GET', `/v1/trips/${qrTripId}/collections/${collectionId}`, { as: driver, expect: [200] });
    const synced = await call('POST', `/v1/admin/collections/${collectionId}/sync`, { as: admin, body: {}, expect: [200] });
    idempotent(
      'payment.captured, the driver refresh and the admin sync find the QR already paid (one finalizer)',
      captured.outcome === 'ALREADY_APPLIED' && refreshed.body.status === 'COMPLETED' && synced.body.outcome === 'ALREADY_APPLIED',
    );
    check(
      refreshed.body.providerPaymentId === paid.payment.id && refreshed.body.bookingPaymentStatus === 'PAID' &&
        refreshed.body.paymentGate.handoverAllowed === true,
      'booking PAID by the QR payment; the handover is allowed',
    );
    const reuse = await call('POST', `/v1/dev/simulate/qr-codes/${paid.qrCodeId}/payments`, { as: admin, body: {}, expect: [404] });
    idempotent('a paid QR takes no second payment (single use)', reuse.status === 404);
    check((await walletNow()).balancePaise === walletBefore, 'a QR payment debits nothing from the wallet');

    await tripStatus(qrTripId, 'PICKUP_VERIFIED');
    await tripStatus(qrTripId, 'IN_TRANSIT');
    await stopStatus(qrTripId, 1, 'ARRIVED');
    await stopStatus(qrTripId, 1, 'DELIVERED');
    const completed = await tripStatus(qrTripId, 'COMPLETED');
    check(completed.body.status === 'COMPLETED' && completed.body.paidWith === 'ONLINE_QR', 'booking COMPLETED, paid by QR');
    let earning = await earningOf(qrBookingId);
    check(
      earning.settlement === 'ONLINE' && earning.status === 'AWAITING_SETTLEMENT' && earning.collectionId === collectionId,
      'ONLINE earning AWAITING_SETTLEMENT, funded by the QR collection',
    );
    check(
      earning.grossAmountPaise === owed && earning.platformFeePaise === fee && earning.netAmountPaise === owed - fee,
      'gross = collected, fee = frozen fee',
    );
    const settledPayment = await settle(paid.payment.id, owed);
    const settlements = await call('GET', `/v1/admin/settlements?bookingId=${qrBookingId}`, { as: admin, expect: [200] });
    check(settlements.body.length === 1 && settlements.body[0].amountPaise === owed, 'exactly one settlement, for the QR payment');
    earning = (await call('GET', `/v1/admin/earnings/${earning.earningId}`, { as: admin, expect: [200] })).body;
    check(earning.status === 'PAYABLE' && earning.merchantSettled === true, 'earning PAYABLE once Razorpay settled the QR payment');
    pickupQr = {
      bookingId: qrBookingId,
      collectionId,
      providerPaymentId: paid.payment.id,
      earningId: earning.earningId,
      netPaise: owed - fee,
    };
    return {
      bookingId: qrBookingId,
      collectionId,
      qrCodeId: paid.qrCodeId,
      providerPaymentId: paid.payment.id,
      providerSettlementId: settledPayment.providerSettlementId,
      earning: { earningId: earning.earningId, status: earning.status },
    };
  });

  await step(14, 'PAY_AT_DELIVERY, three drops paid cash, QR, cash: each drop collected at that drop for its own amount; PARTIALLY_PAID, then PAID; one MIXED earning', async () => {
    const { booking, bookingId: dropsBookingId, tripId: dropsTripId } = await bookFromQuote('DELIVERY', 'PAY_AT_DELIVERY', [
      { latitude: 26.2967, longitude: 73.0351 },
      { latitude: 26.3448, longitude: 73.0458 },
      { latitude: 26.3448, longitude: 73.0858 },
    ]);
    check(booking.stops.length === 3, 'three drops, each with its own frozen payable');
    const owed = Object.fromEntries(booking.stops.map((stop) => [stop.sequence, stop.payablePaise]));
    const before = await call('GET', `/v1/admin/bookings/${dropsBookingId}`, { as: admin, expect: [200] });
    const share = Object.fromEntries(before.body.stops.map((stop) => [stop.sequence, stop.platformFeeSharePaise]));
    check(share[1] + share[2] + share[3] === booking.platformFeePaise, "the drops' fee shares add up to the frozen fee");
    // Nothing is owed at the pickup of a pay-at-delivery booking.
    for (const status of ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT']) {
      await tripStatus(dropsTripId, status);
    }
    const walletBefore = (await walletNow()).balancePaise;

    // Drop 1: only this drop, for exactly its amount.
    const atFirst = await stopStatus(dropsTripId, 1, 'ARRIVED');
    check(
      atFirst.body.paymentGate.stage === 'DROP' && atFirst.body.paymentGate.stopSequence === 1 &&
        atFirst.body.paymentGate.paymentState === 'PAYMENT_REQUIRED' && atFirst.body.paymentGate.amountPaise === owed[1],
      "at drop 1, drop 1's own payable is owed",
    );
    const noStop = await collectAt(dropsTripId, { method: 'CASH', amountPaise: owed[1] }, [422]);
    check(noStop.body.error.code === 'STOP_REQUIRED', 'stopSequence is required for a booking paid drop by drop');
    const future = await collectAt(dropsTripId, { method: 'CASH', amountPaise: owed[3], stopSequence: 3 }, [409]);
    check(
      future.body.error.code === 'COLLECTION_NOT_ALLOWED' && future.body.error.details.reason === 'NOT_CURRENT' &&
        future.body.error.details.currentStop === 1,
      'a future drop cannot be paid instead of the current one',
    );
    const whole = await collectAt(dropsTripId, { method: 'CASH', amountPaise: booking.payablePaise, stopSequence: 1 }, [422]);
    check(
      whole.body.error.code === 'COLLECTION_AMOUNT_MISMATCH' && whole.body.error.details.expectedPaise === owed[1],
      'the booking total is refused for one drop',
    );
    const unpaid = await stopStatus(dropsTripId, 1, 'DELIVERED', [409]);
    check(unpaid.body.error.code === 'PAYMENT_REQUIRED', 'an unpaid drop cannot be DELIVERED');
    // A QR is shown, then the receiver pays cash instead: the QR is closed first and can never
    // pay anything afterwards (a stale QR never pays another drop).
    const staleQr = await collectAt(dropsTripId, { method: 'ONLINE_QR', amountPaise: owed[1], stopSequence: 1 }, [201]);
    const staleView = await call('GET', `/v1/admin/collections/${staleQr.body.collectionId}`, { as: admin, expect: [200] });
    const cashKey = randomUUID();
    const first = await collectAt(dropsTripId, { method: 'CASH', amountPaise: owed[1], stopSequence: 1 }, [201], cashKey);
    check(
      first.body.stage === 'DELIVERY' && first.body.stopSequence === 1 && first.body.status === 'COMPLETED' &&
        first.body.platformFeePaise === share[1],
      "drop 1 paid in cash; drop 1's fee share debited",
    );
    check(first.body.bookingPaymentStatus === 'PARTIALLY_PAID' && first.body.paymentGate.handoverAllowed === true, 'booking PARTIALLY_PAID; drop 1 may be handed over');
    const closed = await call('GET', `/v1/admin/collections/${staleQr.body.collectionId}`, { as: admin, expect: [200] });
    check(closed.body.status === 'FAILED' && closed.body.failureReason === 'CANCELLED_FOR_CASH', "drop 1's QR closed when cash was taken");
    const lateScan = await call('POST', `/v1/dev/simulate/qr-codes/${staleView.body.providerReferenceId}/payments`, {
      as: admin,
      body: {},
      expect: [404],
    });
    check(lateScan.status === 404, 'the closed QR takes no payment');
    const replay = await collectAt(dropsTripId, { method: 'CASH', amountPaise: owed[1], stopSequence: 1 }, [200, 201], cashKey);
    idempotent(
      'drop cash retried with the same Idempotency-Key: same collection, one fee debit',
      replay.body.collectionId === first.body.collectionId && replay.body.replayed === true &&
        (await walletNow()).balancePaise === walletBefore - share[1],
    );
    await stopStatus(dropsTripId, 1, 'DELIVERED');

    // Drop 2: QR. The driver's screen polls and sees it paid before Razorpay's webhook arrives.
    await stopStatus(dropsTripId, 2, 'ARRIVED');
    const shown = await collectAt(dropsTripId, { method: 'ONLINE_QR', amountPaise: owed[2], stopSequence: 2 }, [201]);
    check(
      shown.body.status === 'PENDING' && shown.body.stopSequence === 2 && shown.body.amountPaise === owed[2] &&
        shown.body.bookingPaymentStatus === 'PARTIALLY_PAID',
      'a QR for drop 2 only, for its own amount',
    );
    const paid = await customerPaysQr(shown.body.collectionId);
    check(
      paid.qrCode.notes.collection_id === shown.body.collectionId && paid.qrCode.notes.booking_id === dropsBookingId &&
        paid.qrCode.notes.stage === 'DELIVERY' && paid.qrCode.notes.stop_sequence === '2' &&
        paid.qrCode.notes.booking_stop_id === before.body.stops[1].stopId,
      'the QR names its booking, stage and drop in its notes',
    );
    const polled = await call('GET', `/v1/trips/${dropsTripId}/collections/${shown.body.collectionId}`, { as: driver, expect: [200] });
    check(
      polled.body.status === 'COMPLETED' && polled.body.bookingPaymentStatus === 'PARTIALLY_PAID' &&
        polled.body.paymentGate.stopSequence === 2 && polled.body.paymentGate.handoverAllowed === true,
      'the driver refresh re-read the QR from the provider: drop 2 paid, booking still PARTIALLY_PAID',
    );
    const credited = await deliverQrEvent('qr_code.credited', paid);
    idempotent('qr_code.credited after the driver refresh finds drop 2 already paid', credited.outcome === 'ALREADY_APPLIED');
    check((await walletNow()).balancePaise === walletBefore - share[1], 'the QR drop debits nothing from the wallet');
    await stopStatus(dropsTripId, 2, 'DELIVERED');

    // Drop 3: drop 2's payment never covers it; cash.
    const atThird = await stopStatus(dropsTripId, 3, 'ARRIVED');
    check(
      atThird.body.paymentStatus === 'PARTIALLY_PAID' && atThird.body.paymentGate.stopSequence === 3 &&
        atThird.body.paymentGate.paymentState === 'PAYMENT_REQUIRED' && atThird.body.paymentGate.amountPaise === owed[3],
      "drop 2's payment does not cover drop 3",
    );
    const third = await collectAt(dropsTripId, { method: 'CASH', amountPaise: owed[3], stopSequence: 3 }, [201]);
    check(third.body.bookingPaymentStatus === 'PAID' && third.body.platformFeePaise === share[3], 'booking PAID after the last drop');
    const last = await stopStatus(dropsTripId, 3, 'DELIVERED');
    check(last.body.paidWith === 'MIXED' && last.body.trip.status === 'PAYMENT_CONFIRMED', 'every drop delivered; paid partly in cash, partly by QR');
    const completed = await tripStatus(dropsTripId, 'COMPLETED');
    check(completed.body.status === 'COMPLETED' && completed.body.paymentStatus === 'PAID', 'booking COMPLETED and PAID');
    const walletAfter = (await walletNow()).balancePaise;
    check(walletAfter === walletBefore - share[1] - share[3], "the wallet paid the two cash drops' fee shares, each once");

    const earning = await earningOf(dropsBookingId);
    check(
      earning.settlement === 'MIXED' && earning.status === 'AWAITING_SETTLEMENT' && earning.collectionId === null && earning.paymentId === null,
      'one MIXED earning, AWAITING_SETTLEMENT',
    );
    check(
      earning.grossAmountPaise === booking.payablePaise && earning.platformFeePaise === booking.platformFeePaise &&
        earning.netAmountPaise === booking.payablePaise - booking.platformFeePaise,
      'gross = what the three drops collected, fee = the frozen fee',
    );
    const chain = await call('GET', `/v1/admin/bookings/${dropsBookingId}`, { as: admin, expect: [200] });
    check(chain.body.booking.paymentStatus === 'PAID' && chain.body.stops.every((stop) => stop.status === 'DELIVERED' && stop.paymentConfirmedAt), 'every drop DELIVERED with its payment confirmed');
    const completedCollections = chain.body.collections.filter((entry) => entry.status === 'COMPLETED');
    check(
      completedCollections.map((entry) => `${entry.stopSequence}:${entry.method}`).join() === '1:CASH,2:ONLINE_QR,3:CASH',
      'one completed collection per drop: cash, QR, cash',
    );
    const sources = new Map(chain.body.earning.collections.map((link) => [link.collectionId, link]));
    check(
      sources.size === 3 &&
        completedCollections.every((entry) => {
          const link = sources.get(entry.collectionId);
          return link && link.method === entry.method && link.amountPaise === owed[entry.stopSequence] &&
            link.platformFeePaise === share[entry.stopSequence];
        }),
      'the earning keeps every source: method, amount and fee share of each drop',
    );

    // Razorpay settles the QR drop. Recorded, but a MIXED earning stays AWAITING_SETTLEMENT:
    // per-collection settlement and the payout of mixed earnings are payment flow Phase 5.
    await settle(paid.payment.id, owed[2]);
    const settled = await call('GET', `/v1/admin/bookings/${dropsBookingId}`, { as: admin, expect: [200] });
    check(settled.body.merchantSettlement?.providerPaymentId === paid.payment.id, "the QR drop's settlement is recorded against the booking");
    check(settled.body.earning.status === 'AWAITING_SETTLEMENT' && settled.body.earning.merchantSettled === false, 'the MIXED earning is not made payable (Phase 5)');
    delivery = {
      bookingId: dropsBookingId,
      earningId: earning.earningId,
      netPaise: earning.netAmountPaise,
      collectionIds: completedCollections.map((entry) => entry.collectionId),
    };
    return {
      bookingId: dropsBookingId,
      drops: completedCollections.map((entry) => ({
        stopSequence: entry.stopSequence,
        method: entry.method,
        amountPaise: entry.amountPaise,
        platformFeePaise: entry.platformFeePaise,
      })),
      paymentStatusAfterDrop: { 1: first.body.bookingPaymentStatus, 2: polled.body.bookingPaymentStatus, 3: third.body.bookingPaymentStatus },
      walletDebitedPaise: walletBefore - walletAfter,
      earning: { earningId: earning.earningId, settlement: earning.settlement, status: settled.body.earning.status, sources: sources.size },
    };
  });

  await step(15, 'Payout of the QR-collected pickup earning; the cash and MIXED earnings stay out', async () => {
    const key = randomUUID();
    const prepared = await call('POST', '/v1/admin/payout-batches', {
      as: admin,
      headers: { 'Idempotency-Key': { value: key, shown: key } },
      body: {},
      expect: [201],
    });
    const qrBatchId = prepared.body.batch.batchId;
    const detail = await call('GET', `/v1/admin/payout-batches/${qrBatchId}`, { as: admin, expect: [200] });
    const payout = detail.body.payouts.find((candidate) => candidate.driverId === driverAccount.driverId);
    check(payout, 'a payout for the driver');
    const full = await call('GET', `/v1/admin/payouts/${payout.payoutId}`, { as: admin, expect: [200] });
    const items = full.body.items.map((item) => item.earningId);
    check(items.length === 1 && items[0] === pickupQr.earningId, 'only the settled QR earning is in the payout');
    check(full.body.amountPaise === pickupQr.netPaise && full.body.tdsAmountPaise === 0, "transfer = the QR earning's net, TDS 0");
    const executed = await call('POST', `/v1/admin/payout-batches/${qrBatchId}/execute`, { as: admin, expect: [200] });
    check(executed.body.results.find((entry) => entry.payoutId === payout.payoutId)?.result === 'SUBMITTED', 'payout accepted by the provider');
    const sent = await call('GET', `/v1/admin/payouts/${payout.payoutId}`, { as: admin, expect: [200] });
    check(sent.body.bankAccountId === bankAccountId, 'sent to the approved bank account');
    const moved = await call('POST', `/v1/dev/simulate/payouts/${sent.body.providerPayoutId}`, {
      as: admin,
      body: { status: 'processed' },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayxWebhook, 'payout.processed', { payout: { entity: moved.body.entity } });
    await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
    check((await webhookEvent('payout_events', webhook.eventId)).outcome === 'APPLIED', 'payout.processed applied');
    const paidEarning = await call('GET', `/v1/admin/earnings/${pickupQr.earningId}`, { as: admin, expect: [200] });
    check(paidEarning.body.status === 'PAID' && paidEarning.body.paidAt, 'QR earning PAID after the provider confirmed the payout');
    for (const [label, id, status] of [
      ['pickup cash', pickupCash.earningId, 'SETTLED_IN_CASH'],
      ['MIXED', delivery.earningId, 'AWAITING_SETTLEMENT'],
    ]) {
      const other = await call('GET', `/v1/admin/earnings/${id}`, { as: admin, expect: [200] });
      check(other.body.status === status, `${label} earning stays ${status}`);
    }
    const chain = await call('GET', `/v1/admin/bookings/${pickupQr.bookingId}`, { as: admin, expect: [200] });
    check(
      chain.body.collections.length === 1 && chain.body.collections[0].providerPaymentId === pickupQr.providerPaymentId &&
        chain.body.merchantSettlement?.providerPaymentId === pickupQr.providerPaymentId &&
        chain.body.earning.paidOut === true && chain.body.earning.payoutHistory[0]?.utr,
      'money trail: QR collection, merchant settlement, payout with UTR',
    );
    return { batchId: qrBatchId, payoutId: payout.payoutId, amountPaise: full.body.amountPaise, utr: moved.body.entity.utr };
  });

  await step(16, 'Phase 4 audit: collections, wallet fee debits and earning sources reconcile', async () => {
    const bookingIds = [pickupCash.bookingId, pickupQr.bookingId, delivery.bookingId];
    for (const reportName of ['earning-mismatches', 'payout-mismatches', 'cash-fee-mismatches', 'stale-collections', 'wallet-mismatches']) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      const text = JSON.stringify(findings.body);
      check(bookingIds.every((id) => !text.includes(id)) && !text.includes(walletId), `${reportName}: nothing for the Phase 4 bookings or the wallet`);
    }
    for (const reportName of ['webhook-anomalies', 'unprocessed-webhooks']) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      const text = JSON.stringify(findings.body);
      check(phase4Events.every((eventId) => !text.includes(eventId)), `${reportName}: none of the Phase 4 webhooks`);
    }
    const summary = await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] });
    check(summary.body.paidPaise === NET_PAISE + pickupQr.netPaise, 'driver summary: both paid-out earnings');
    check(summary.body.settledInCashPaise === pickupCash.netPaise, 'driver summary: the pickup cash trip, kept as cash');
    check(summary.body.awaitingSettlementPaise === 27_000 + delivery.netPaise, 'driver summary: the unsettled control trip and the MIXED earning');
    // Read-only queries on the e2e database: one row per source, one fee debit per cash collection.
    const sources = await db.query(
      `SELECT c.booking_id::text AS booking_id, s.sequence, c.method::text AS method, c.status::text AS status,
              c.amount_paise::int AS amount, c.platform_fee_paise::int AS fee,
              t.idempotency_key, t.amount_paise::int AS debit, l.earning_id::text AS earning_id,
              l.amount_paise::int AS linked_amount, c.id::text AS collection_id
       FROM payment_collections c
       LEFT JOIN booking_stops s ON s.id = c.booking_stop_id
       LEFT JOIN driver_wallet_transactions t ON t.id = c.wallet_transaction_id
       LEFT JOIN earning_collections l ON l.collection_id = c.id
       WHERE c.booking_id = ANY($1::uuid[])
       ORDER BY c.created_at`,
      [bookingIds],
    );
    const completedRows = sources.rows.filter((row) => row.status === 'COMPLETED');
    check(completedRows.length === 5, 'five completed collections: pickup cash, pickup QR, three drops');
    check(
      completedRows.every((row) => row.earning_id !== null && row.linked_amount === row.amount),
      'every completed collection funds its earning, for its own amount',
    );
    check(
      completedRows.filter((row) => row.method === 'CASH').every(
        (row) => row.idempotency_key === `cash-ride-fee:collection:${row.collection_id}` && row.debit === row.fee,
      ),
      'one fee debit per cash collection, keyed to that collection, of exactly its fee',
    );
    check(
      sources.rows.filter((row) => row.method === 'ONLINE_QR').every((row) => row.idempotency_key === null),
      'no QR collection touches the wallet',
    );
    const ledger = await db.query(
      `SELECT COUNT(*)::int AS debits, COALESCE(SUM(amount_paise), 0)::int AS total
       FROM driver_wallet_transactions WHERE wallet_id = $1::uuid AND type = 'CASH_RIDE_FEE'`,
      [walletId],
    );
    const debitedFees = completedRows.filter((row) => row.method === 'CASH').reduce((sum, row) => sum + row.fee, 0);
    check(ledger.rows[0].debits === 3 && ledger.rows[0].total === debitedFees, 'three cash fee debits in the ledger, nothing else');
    check((await walletNow()).balancePaise === WALLET_FLOAT_PAISE - debitedFees, 'wallet = float - the cash fees');
    report.ids.phase4 = {
      pickupCashBookingId: pickupCash.bookingId,
      pickupQrBookingId: pickupQr.bookingId,
      deliveryBookingId: delivery.bookingId,
      walletId,
    };
    return {
      collections: sources.rows.map((row) => ({
        bookingId: row.booking_id,
        stopSequence: row.sequence,
        method: row.method,
        status: row.status,
        amountPaise: row.amount,
        feeDebitPaise: row.debit,
      })),
      cashFeeDebits: ledger.rows[0],
    };
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
