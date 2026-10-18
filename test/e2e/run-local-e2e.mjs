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
 *     COLLECTION_LINK_PROVIDER=simulated + a signed qr_code.credited (payment flow Phase 4);
 *   - Razorpay processing a refund: REFUND_PROVIDER=simulated + a signed refund.processed
 *     (payment flow Phase 6; live refunds stay off until verified, OPEN_DECISIONS D-72).
 * Simulated providers are refused by config validation in production and with live keys.
 *
 * Payment flow Phase 5 (steps 12-19): every earning records its cash and online parts and its
 * payout amount; an earning funded by several collections is payable only once every online
 * collection is settled; a payout carries exactly the payout amounts; a failed payout puts its
 * earnings ON_HOLD until an admin releases them (N10).
 *
 * Payment flow Phase 6 (steps 20-23): admin-requested refunds. A cancelled QR booking refunded
 * through the provider, a cash return with the platform fee credited back to the wallet once,
 * a refund after the earning was paid out (no clawback, reported), and the audit.
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
    opsAdmin: `adm_e2e_ops_${randomBytes(6).toString('hex')}`,
    driver: `drv_e2e_${randomBytes(6).toString('hex')}`,
    customer: `cus_e2e_${randomBytes(6).toString('hex')}`,
  };
  console.log('Provisioning two admins, driver (KYC name Ramesh Kumar), customer and the 10% fee rule');
  provision(e2eUrl, ['create-admin', '--phone', phone(), '--subject', subjects.admin]);
  // A second admin for the Phase 5 payout steps (admin batch and settlement actions are rate
  // limited per admin).
  provision(e2eUrl, ['create-admin', '--phone', phone(), '--subject', subjects.opsAdmin]);
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
    REFUND_PROVIDER: 'simulated',
    // Payment flow Phase 7: the jobs run when the flow starts them (step 24), on rows of any age.
    // Provider reads are off: the Checkout payment of step 1 is fabricated, so Razorpay could
    // never confirm it; the database checks and the recovery job use the simulated providers.
    COLLECTION_RECOVERY_INTERVAL_MINUTES: '0',
    COLLECTION_RECOVERY_MIN_AGE_MINUTES: '0',
    RECONCILIATION_INTERVAL_MINUTES: '0',
    RECONCILIATION_MIN_AGE_MINUTES: '0',
    RECONCILIATION_PROVIDER_CHECKS: 'false',
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
  console.log('Shell variables in the commands below: BASE, ADMIN_TOKEN, OPS_ADMIN_TOKEN, DRIVER_TOKEN,');
  console.log('CUSTOMER_TOKEN, INTERNAL_API_KEY and the webhook signatures (HMAC-SHA256 of the body with');
  console.log('the webhook secret).');

  const admin = { name: 'ADMIN_TOKEN', token: idp.sign(subjects.admin) };
  const opsAdmin = { name: 'OPS_ADMIN_TOKEN', token: idp.sign(subjects.opsAdmin) };
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
    return { ...settled.body.settledPayment, webhook };
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
    check(
      earning.cashCollectedPaise === owed && earning.onlineCollectedPaise === 0 && earning.cashFeePaise === fee &&
        earning.netCashPaise === owed - fee && earning.payoutAmountPaise === 0,
      'all of it is cash, already with the driver: payout amount 0 (Phase 5)',
    );
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
    check(
      earning.onlineCollectedPaise === owed && earning.cashCollectedPaise === 0 && earning.onlineFeePaise === fee &&
        earning.payoutAmountPaise === owed - fee,
      'all of it online: the payout amount is the net (Phase 5)',
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

    // Payment flow Phase 5: the cash drops are already with the driver; only drop 2's QR net is
    // owed through a payout, once Razorpay settles drop 2.
    const cashPaise = owed[1] + owed[3];
    const cashFeePaise = share[1] + share[3];
    const payoutPaise = owed[2] - share[2];
    check(
      earning.cashCollectedPaise === cashPaise && earning.onlineCollectedPaise === owed[2] &&
        earning.cashFeePaise === cashFeePaise && earning.onlineFeePaise === share[2],
      'the split: cash = drops 1 and 3, online = drop 2, each with its own fee share',
    );
    check(
      earning.netCashPaise === cashPaise - cashFeePaise && earning.payoutAmountPaise === payoutPaise &&
        earning.netCashPaise + earning.payoutAmountPaise === earning.netAmountPaise,
      "payout amount = drop 2's QR net; the cash part (net of its fees) is not paid out",
    );
    const summaryBefore = await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] });
    check(
      summaryBefore.body.awaitingSettlementPaise === 27_000 + payoutPaise,
      'driver summary: only the QR part of the MIXED earning awaits a settlement',
    );
    check(
      summaryBefore.body.settledInCashPaise === pickupCash.netPaise + cashPaise - cashFeePaise,
      'driver summary: the cash drops count as already settled in cash',
    );

    // Razorpay settles the QR drop: the MIXED earning's only online collection, so it is payable.
    await settle(paid.payment.id, owed[2]);
    const settled = await call('GET', `/v1/admin/bookings/${dropsBookingId}`, { as: admin, expect: [200] });
    check(
      settled.body.merchantSettlements.length === 1 &&
        settled.body.merchantSettlements[0].providerPaymentId === paid.payment.id &&
        settled.body.merchantSettlements[0].collectionId === shown.body.collectionId,
      "the QR drop's settlement is recorded against its own collection",
    );
    check(
      settled.body.collections
        .filter((entry) => entry.status === 'COMPLETED')
        .map((entry) => `${entry.stopSequence}:${entry.settlement ? 'settled' : '-'}:${entry.earningId === earning.earningId}`)
        .join() === '1:-:true,2:settled:true,3:-:true',
      'the money trail shows each drop, its settlement state and the earning it funds',
    );
    check(
      settled.body.earning.status === 'PAYABLE' && settled.body.earning.merchantSettled === true &&
        settled.body.earning.onlineSettledPaise === owed[2] && settled.body.earning.payableAt,
      'the MIXED earning is PAYABLE once its QR drop is settled (Phase 5)',
    );
    delivery = {
      bookingId: dropsBookingId,
      earningId: earning.earningId,
      netPaise: earning.netAmountPaise,
      netCashPaise: cashPaise - cashFeePaise,
      payoutPaise,
      providerPaymentId: paid.payment.id,
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
      earning: {
        earningId: earning.earningId,
        settlement: earning.settlement,
        status: settled.body.earning.status,
        sources: sources.size,
        cashCollectedPaise: cashPaise,
        onlineCollectedPaise: owed[2],
        netCashPaise: cashPaise - cashFeePaise,
        payoutAmountPaise: payoutPaise,
      },
    };
  });

  await step(15, 'Payout of the pickup QR and MIXED earnings, each for its payout amount; the cash earning stays out', async () => {
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
    const items = new Map(full.body.items.map((item) => [item.earningId, item.amountPaise]));
    check(
      items.size === 2 && items.get(pickupQr.earningId) === pickupQr.netPaise &&
        items.get(delivery.earningId) === delivery.payoutPaise,
      "the settled QR earning for its net, the MIXED earning for its QR drop's net only",
    );
    check(!items.has(pickupCash.earningId), 'the pickup cash earning (payout amount 0) is not in the payout');
    check(
      full.body.amountPaise === pickupQr.netPaise + delivery.payoutPaise &&
        full.body.grossAmountPaise === full.body.amountPaise && full.body.tdsAmountPaise === 0,
      'transfer = the sum of the payout amounts, TDS 0',
    );
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
    for (const [label, id] of [
      ['pickup QR', pickupQr.earningId],
      ['MIXED', delivery.earningId],
    ]) {
      const paidEarning = await call('GET', `/v1/admin/earnings/${id}`, { as: admin, expect: [200] });
      check(paidEarning.body.status === 'PAID' && paidEarning.body.paidAt, `${label} earning PAID after the provider confirmed the payout`);
    }
    const cashEarning = await call('GET', `/v1/admin/earnings/${pickupCash.earningId}`, { as: admin, expect: [200] });
    check(cashEarning.body.status === 'SETTLED_IN_CASH', 'pickup cash earning stays SETTLED_IN_CASH');
    const chain = await call('GET', `/v1/admin/bookings/${pickupQr.bookingId}`, { as: admin, expect: [200] });
    check(
      chain.body.collections.length === 1 && chain.body.collections[0].providerPaymentId === pickupQr.providerPaymentId &&
        chain.body.merchantSettlement?.providerPaymentId === pickupQr.providerPaymentId &&
        chain.body.earning.paidOut === true && chain.body.earning.payoutHistory[0]?.utr,
      'money trail: QR collection, merchant settlement, payout with UTR',
    );
    const mixedChain = await call('GET', `/v1/admin/bookings/${delivery.bookingId}`, { as: admin, expect: [200] });
    check(
      mixedChain.body.earning.paidOut === true && mixedChain.body.earning.payoutHistory.length === 1 &&
        mixedChain.body.earning.payoutHistory[0].payoutItemAmountPaise === delivery.payoutPaise &&
        mixedChain.body.earning.payoutHistory[0].utr,
      "money trail of the MIXED booking: its payout carried the QR drop's net, with UTR",
    );
    return {
      batchId: qrBatchId,
      payoutId: payout.payoutId,
      amountPaise: full.body.amountPaise,
      items: Object.fromEntries(items),
      utr: moved.body.entity.utr,
    };
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
    check(
      summary.body.paidPaise === NET_PAISE + pickupQr.netPaise + delivery.payoutPaise,
      'driver summary: paid out = the prepaid and QR nets and the MIXED earning\'s QR net',
    );
    check(
      summary.body.settledInCashPaise === pickupCash.netPaise + delivery.netCashPaise,
      'driver summary: kept as cash = the pickup cash trip and the cash drops of the MIXED trip',
    );
    check(summary.body.awaitingSettlementPaise === 27_000, 'driver summary: only the unsettled control trip awaits a settlement');
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

  // -------------------------------------------------------------------------------------------
  // Payment flow Phase 5: an earning funded by several online collections is payable only once
  // every one of them is settled, and a failed payout holds its earnings for an admin (N10).
  // Admin actions here use a second admin (batch and sync actions are rate limited per admin).
  // -------------------------------------------------------------------------------------------
  const payoutEvents = [];
  let split;

  await step(17, 'PAY_AT_DELIVERY, three drops paid QR, cash, QR: one MIXED earning, payable only once both QR drops are settled; repeated and concurrent settlement deliveries change nothing', async () => {
    const { booking, bookingId: splitBookingId, tripId: splitTripId } = await bookFromQuote('DELIVERY-SPLIT', 'PAY_AT_DELIVERY', [
      { latitude: 26.2967, longitude: 73.0351 },
      { latitude: 26.3448, longitude: 73.0458 },
      { latitude: 26.3448, longitude: 73.0858 },
    ]);
    const owed = Object.fromEntries(booking.stops.map((stop) => [stop.sequence, stop.payablePaise]));
    const before = await call('GET', `/v1/admin/bookings/${splitBookingId}`, { as: admin, expect: [200] });
    const share = Object.fromEntries(before.body.stops.map((stop) => [stop.sequence, stop.platformFeeSharePaise]));
    for (const status of ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT']) {
      await tripStatus(splitTripId, status);
    }
    const walletBefore = (await walletNow()).balancePaise;

    // Drop 1: QR, confirmed by Razorpay's signed qr_code.credited.
    await stopStatus(splitTripId, 1, 'ARRIVED');
    const firstQr = await collectAt(splitTripId, { method: 'ONLINE_QR', amountPaise: owed[1], stopSequence: 1 }, [201]);
    const firstPaid = await customerPaysQr(firstQr.body.collectionId);
    const credited = await deliverQrEvent('qr_code.credited', firstPaid);
    check(credited.outcome === 'APPLIED' && !credited.problem, "drop 1's QR payment applied from the signed webhook");
    await stopStatus(splitTripId, 1, 'DELIVERED');

    // Drop 2: cash, its fee share debited from the wallet.
    await stopStatus(splitTripId, 2, 'ARRIVED');
    const cash = await collectAt(splitTripId, { method: 'CASH', amountPaise: owed[2], stopSequence: 2 }, [201]);
    check(cash.body.status === 'COMPLETED' && cash.body.platformFeePaise === share[2], "drop 2 paid in cash; drop 2's fee share debited");
    await stopStatus(splitTripId, 2, 'DELIVERED');

    // Drop 3: QR, confirmed by the driver app's refresh.
    await stopStatus(splitTripId, 3, 'ARRIVED');
    const thirdQr = await collectAt(splitTripId, { method: 'ONLINE_QR', amountPaise: owed[3], stopSequence: 3 }, [201]);
    const thirdPaid = await customerPaysQr(thirdQr.body.collectionId);
    const polled = await call('GET', `/v1/trips/${splitTripId}/collections/${thirdQr.body.collectionId}`, { as: driver, expect: [200] });
    check(polled.body.status === 'COMPLETED' && polled.body.bookingPaymentStatus === 'PAID', "drop 3's QR paid: booking PAID");
    await stopStatus(splitTripId, 3, 'DELIVERED');
    const completed = await tripStatus(splitTripId, 'COMPLETED');
    check(completed.body.status === 'COMPLETED' && completed.body.paymentStatus === 'PAID', 'booking COMPLETED and PAID');
    check((await walletNow()).balancePaise === walletBefore - share[2], "the wallet paid only the cash drop's fee share");

    const onlinePaise = owed[1] + owed[3];
    const onlineFeePaise = share[1] + share[3];
    const payoutPaise = onlinePaise - onlineFeePaise;
    const listed = await earningOf(splitBookingId);
    check(
      listed.settlement === 'MIXED' && listed.status === 'AWAITING_SETTLEMENT' && listed.cashCollectedPaise === owed[2] &&
        listed.onlineCollectedPaise === onlinePaise && listed.cashFeePaise === share[2] &&
        listed.onlineFeePaise === onlineFeePaise && listed.payoutAmountPaise === payoutPaise,
      'one MIXED earning: cash = drop 2, online = drops 1 and 3; payout amount = the two QR nets',
    );
    const earningId = listed.earningId;
    const earningNow = async () => (await call('GET', `/v1/admin/earnings/${earningId}`, { as: admin, expect: [200] })).body;
    const settlementsOfBooking = async () =>
      (await call('GET', `/v1/admin/settlements?bookingId=${splitBookingId}`, { as: admin, expect: [200] })).body;

    // Razorpay settles drop 1 first: drop 3 is still unsettled, so the earning keeps waiting.
    const firstSettlement = await settle(firstPaid.payment.id, owed[1]);
    let earning = await earningNow();
    check(
      earning.status === 'AWAITING_SETTLEMENT' && earning.merchantSettled === false && earning.onlineSettledPaise === owed[1],
      'drop 1 settled, drop 3 not: still AWAITING_SETTLEMENT, with what is settled so far',
    );
    check(
      earning.sources.map((source) => `${source.stopSequence}:${source.method}:${source.settled}`).join() ===
        '1:ONLINE_QR:true,2:CASH:false,3:ONLINE_QR:false',
      'each source shows its own settlement state',
    );

    // The same settlement.processed delivered again, then two admin syncs at once: nothing new.
    await sendWebhook('/v1/webhooks/razorpay', firstSettlement.webhook, 'RAZORPAY_SIGNATURE');
    const replayed = await webhookEvent('payment_events', firstSettlement.webhook.eventId);
    idempotent('repeated settlement.processed delivery is stored once', replayed.rows === 1);
    const syncs = await Promise.all([
      call('POST', '/v1/admin/settlements/sync', { as: opsAdmin, body: {}, expect: [200] }),
      call('POST', '/v1/admin/settlements/sync', { as: opsAdmin, body: {}, expect: [200] }),
    ]);
    const settledOnce = await settlementsOfBooking();
    idempotent(
      'two admin settlement syncs at once record nothing again and promote nothing',
      syncs.every((sync) => sync.body.recorded === 0 && sync.body.earningsPromoted === 0) && settledOnce.length === 1,
    );
    check((await earningNow()).status === 'AWAITING_SETTLEMENT', 'still waiting for drop 3');

    // Razorpay settles drop 3: every online collection is settled, the earning is payable.
    await settle(thirdPaid.payment.id, owed[3]);
    earning = await earningNow();
    check(
      earning.status === 'PAYABLE' && earning.merchantSettled === true && earning.onlineSettledPaise === onlinePaise &&
        earning.payableAt,
      'PAYABLE once drop 3 is settled too',
    );
    const chain = await call('GET', `/v1/admin/bookings/${splitBookingId}`, { as: admin, expect: [200] });
    check(
      chain.body.merchantSettlements.length === 2 &&
        chain.body.merchantSettlements.map((entry) => entry.collectionId).sort().join() ===
          [firstQr.body.collectionId, thirdQr.body.collectionId].sort().join(),
      'two merchant settlements, one per QR drop',
    );
    check(
      chain.body.collections
        .filter((entry) => entry.status === 'COMPLETED')
        .map((entry) => `${entry.stopSequence}:${entry.method}:${entry.settlement ? 'settled' : '-'}`)
        .join() === '1:ONLINE_QR:settled,2:CASH:-,3:ONLINE_QR:settled',
      'the money trail shows every drop and its settlement state',
    );
    check((await settlementsOfBooking()).length === 2, 'exactly two settlements for the booking');
    split = {
      bookingId: splitBookingId,
      earningId,
      netCashPaise: owed[2] - share[2],
      payoutPaise,
      providerPaymentIds: [firstPaid.payment.id, thirdPaid.payment.id],
    };
    return {
      bookingId: splitBookingId,
      earningId,
      drops: { 1: 'ONLINE_QR', 2: 'CASH', 3: 'ONLINE_QR' },
      cashCollectedPaise: owed[2],
      onlineCollectedPaise: onlinePaise,
      payoutAmountPaise: payoutPaise,
      statusAfterFirstSettlement: 'AWAITING_SETTLEMENT',
      statusAfterSecondSettlement: earning.status,
    };
  });

  await step(18, 'RazorpayX fails the payout: the earning goes ON_HOLD (N10), nothing re-queued on its own; an admin releases it and a new payout pays it once', async () => {
    const prepare = async () => {
      const key = randomUUID();
      const prepared = await call('POST', '/v1/admin/payout-batches', {
        as: opsAdmin,
        headers: { 'Idempotency-Key': { value: key, shown: key } },
        body: {},
        expect: [201],
      });
      const batch = prepared.body.batch;
      const detail = await call('GET', `/v1/admin/payout-batches/${batch.batchId}`, { as: opsAdmin, expect: [200] });
      const mine = detail.body.payouts.find((candidate) => candidate.driverId === driverAccount.driverId);
      return { batchId: batch.batchId, payout: mine ?? null };
    };
    const payoutView = async (id) => (await call('GET', `/v1/admin/payouts/${id}`, { as: opsAdmin, expect: [200] })).body;
    const earningNow = async () => (await call('GET', `/v1/admin/earnings/${split.earningId}`, { as: opsAdmin, expect: [200] })).body;
    const deliver = async (event, entity) => {
      const webhook = signedEvent(secrets.razorpayxWebhook, event, { payout: { entity } });
      payoutEvents.push(webhook.eventId);
      await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
      await sendWebhook('/v1/webhooks/razorpayx', webhook, 'RAZORPAYX_SIGNATURE');
      return webhookEvent('payout_events', webhook.eventId);
    };

    const first = await prepare();
    check(first.payout, 'a payout for the driver');
    const firstView = await payoutView(first.payout.payoutId);
    check(
      firstView.items.length === 1 && firstView.items[0].earningId === split.earningId &&
        firstView.items[0].amountPaise === split.payoutPaise && firstView.amountPaise === split.payoutPaise,
      "only the MIXED earning, for its two QR drops' net",
    );
    await call('POST', `/v1/admin/payout-batches/${first.batchId}/execute`, { as: opsAdmin, expect: [200] });
    const sent = await payoutView(first.payout.payoutId);
    check(sent.status === 'SUBMITTED' && sent.providerPayoutId, 'payout accepted by the provider');
    const failed = await call('POST', `/v1/dev/simulate/payouts/${sent.providerPayoutId}`, {
      as: opsAdmin,
      body: { status: 'failed', failureReason: 'E2E run: beneficiary bank offline' },
      expect: [200],
    });
    const failedEvent = await deliver('payout.failed', failed.body.entity);
    check(failedEvent.outcome === 'APPLIED', 'payout.failed applied');
    idempotent('repeated payout.failed delivery is stored and applied once', failedEvent.rows === 1);
    const failedView = await payoutView(first.payout.payoutId);
    check(failedView.status === 'FAILED' && failedView.items[0].status === 'RELEASED', 'payout FAILED; its item released');
    let earning = await earningNow();
    check(
      earning.status === 'ON_HOLD' && /^PAYOUT_FAILED: /.test(earning.holdReason) && earning.paidAt === null,
      'the earning is ON_HOLD for an admin and never marked paid',
    );
    const next = await prepare();
    idempotent('the next batch does not re-queue the held earning on its own', next.payout === null);

    const reason = 'E2E run: bank back online, ticket E2E-5150';
    const released = await call('POST', `/v1/admin/earnings/${split.earningId}/release`, {
      as: opsAdmin,
      body: { reason },
      expect: [200],
    });
    check(released.body.status === 'PAYABLE', 'an admin releases it: PAYABLE again (both QR drops are settled)');
    const releasedAgain = await call('POST', `/v1/admin/earnings/${split.earningId}/release`, {
      as: opsAdmin,
      body: { reason },
      expect: [200],
    });
    const releases = await db.query(
      `SELECT COUNT(*)::int AS n FROM admin_actions WHERE action = 'EARNING_RELEASED' AND target_id = $1`,
      [split.earningId],
    );
    idempotent(
      'releasing it again changes nothing (one release recorded)',
      releasedAgain.body.status === 'PAYABLE' && releases.rows[0].n === 1,
    );

    const retry = await prepare();
    check(retry.payout && retry.payout.payoutId !== first.payout.payoutId, 'a new payout carries the released earning');
    const retryView = await payoutView(retry.payout.payoutId);
    check(
      retryView.amountPaise === split.payoutPaise && retryView.items.length === 1 &&
        retryView.items[0].earningId === split.earningId && retryView.items[0].amountPaise === split.payoutPaise,
      'for the same payout amount',
    );
    await call('POST', `/v1/admin/payout-batches/${retry.batchId}/execute`, { as: opsAdmin, expect: [200] });
    const resent = await payoutView(retry.payout.payoutId);
    check(
      resent.status === 'SUBMITTED' && resent.providerPayoutId && resent.providerPayoutId !== sent.providerPayoutId,
      'a new transfer, not the failed one',
    );
    const processed = await call('POST', `/v1/dev/simulate/payouts/${resent.providerPayoutId}`, {
      as: opsAdmin,
      body: { status: 'processed' },
      expect: [200],
    });
    const processedEvent = await deliver('payout.processed', processed.body.entity);
    idempotent(
      'repeated payout.processed delivery is stored and applied once',
      processedEvent.outcome === 'APPLIED' && processedEvent.rows === 1,
    );
    earning = await earningNow();
    check(earning.status === 'PAID' && earning.paidAt, 'PAID, by the new payout');
    const chain = await call('GET', `/v1/admin/bookings/${split.bookingId}`, { as: opsAdmin, expect: [200] });
    check(
      chain.body.earning.payoutHistory
        .map((entry) => `${entry.payoutStatus}:${entry.payoutItemStatus}:${entry.payoutItemAmountPaise}`)
        .join() === `FAILED:RELEASED:${split.payoutPaise},PROCESSED:PAID:${split.payoutPaise}`,
      'money trail: the failed payout and the paid one, each for the payout amount',
    );
    const audit = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM payout_items WHERE earning_id = $1::uuid AND status = 'PAID') AS paid_items,
         (SELECT COUNT(*)::int FROM admin_actions
           WHERE action = 'PAYOUT_FAILED_EARNINGS_HELD' AND target_id = $2) AS holds`,
      [split.earningId, first.payout.payoutId],
    );
    check(audit.rows[0].paid_items === 1, 'one paid payout item: the earning is paid once');
    check(audit.rows[0].holds === 1, 'the hold is audited once, against the failed payout');
    return {
      failedPayoutId: first.payout.payoutId,
      failureReason: failedView.failureReason,
      holdReason: 'PAYOUT_FAILED',
      paidPayoutId: retry.payout.payoutId,
      amountPaise: retryView.amountPaise,
      utr: processed.body.entity.utr,
    };
  });

  await step(19, 'Phase 5 audit: reconciliation clean for every booking paid by collection; payouts, summary and wallet add up', async () => {
    const bookingIds = [pickupCash.bookingId, pickupQr.bookingId, delivery.bookingId, split.bookingId];
    const earningIds = [pickupCash.earningId, pickupQr.earningId, delivery.earningId, split.earningId];
    const paymentIds = [pickupQr.providerPaymentId, delivery.providerPaymentId, ...split.providerPaymentIds];
    for (const reportName of [
      'earning-mismatches',
      'payout-mismatches',
      'cash-fee-mismatches',
      'stale-collections',
      'wallet-mismatches',
      'payable-without-bank-account',
      'settlement-anomalies',
    ]) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      const text = JSON.stringify(findings.body);
      check(
        [...bookingIds, ...earningIds, ...paymentIds, walletId].every((id) => !text.includes(id)),
        `${reportName}: nothing for the bookings paid by collection, their payments or the wallet`,
      );
    }
    for (const [reportName, events] of [
      ['webhook-anomalies', phase4Events],
      ['unprocessed-webhooks', phase4Events],
      ['payout-webhook-anomalies', payoutEvents],
      ['unprocessed-payout-webhooks', payoutEvents],
    ]) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      const text = JSON.stringify(findings.body);
      check(events.every((eventId) => !text.includes(eventId)), `${reportName}: none of this run's webhooks`);
    }

    const summary = (await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] })).body;
    const paidOut = NET_PAISE + pickupQr.netPaise + delivery.payoutPaise + split.payoutPaise;
    check(summary.paidPaise === paidOut, 'driver summary: paid out = every online part, once');
    check(
      summary.settledInCashPaise === pickupCash.netPaise + delivery.netCashPaise + split.netCashPaise,
      'driver summary: kept as cash = every cash part (net of its fee), never paid out',
    );
    check(
      summary.awaitingSettlementPaise === 27_000 && summary.payablePaise === 0 && summary.inPayoutPaise === 0 &&
        summary.onHoldPaise === 0,
      'driver summary: nothing payable, in payout or on hold; only the unsettled control trip waits',
    );
    const payouts = (await call('GET', '/v1/payouts', { as: driver, expect: [200] })).body;
    const processedTotal = payouts
      .filter((payout) => payout.status === 'PROCESSED')
      .reduce((sum, payout) => sum + payout.amountPaise, 0);
    check(processedTotal === paidOut, 'the processed payouts add up to what the summary shows as paid');
    check(payouts.filter((payout) => payout.status === 'FAILED').length === 1, 'one failed payout, kept in the history');

    const items = await db.query(
      `SELECT COUNT(*) FILTER (WHERE i.amount_paise <> e.payout_amount_paise)::int AS wrong_amounts,
              COUNT(*) FILTER (WHERE i.status IN ('INCLUDED', 'PAID'))::int AS live_items,
              COUNT(DISTINCT e.id) FILTER (WHERE i.status IN ('INCLUDED', 'PAID'))::int AS live_earnings,
              COUNT(*) FILTER (WHERE e.settlement = 'CASH')::int AS cash_items
       FROM payout_items i JOIN driver_earnings e ON e.id = i.earning_id
       WHERE e.driver_id = $1::uuid`,
      [driverAccount.driverId],
    );
    const [itemState] = items.rows;
    check(itemState.wrong_amounts === 0, "every payout item carries exactly its earning's payout amount");
    check(itemState.live_items === itemState.live_earnings, 'no earning is carried by two live payout items');
    check(itemState.cash_items === 0, 'no cash earning was ever put in a payout');
    const ledger = await db.query(
      `SELECT COUNT(*)::int AS debits, COALESCE(SUM(amount_paise), 0)::int AS total
       FROM driver_wallet_transactions WHERE wallet_id = $1::uuid AND type = 'CASH_RIDE_FEE'`,
      [walletId],
    );
    check(ledger.rows[0].debits === 4, 'four cash fee debits: pickup cash and the three cash drops');
    check((await walletNow()).balancePaise === WALLET_FLOAT_PAISE - ledger.rows[0].total, 'wallet = float - the cash fees');
    report.ids.phase5 = { splitBookingId: split.bookingId, splitEarningId: split.earningId };
    return { summary, processedPayoutsPaise: processedTotal, payoutItems: itemState, cashFeeDebits: ledger.rows[0] };
  });

  // -------------------------------------------------------------------------------------------
  // Payment flow Phase 6: refunds. The technical system only: every refund is requested by an
  // admin with a reason, for an amount the server computes; a provider refund is completed only
  // by what Razorpay reports (REFUND_PROVIDER=simulated + a signed refund.processed here); a cash
  // return is recorded with the admin's explicit fee decision. The refund policy stays open
  // (OPEN_DECISIONS L-7 to L-10, L-21): nothing is refunded, debited or recovered on its own.
  // -------------------------------------------------------------------------------------------
  const refundEvents = [];
  const refundIds = [];
  const refundAt = (body, key = randomUUID(), expect = [201]) =>
    call('POST', '/v1/admin/refunds', {
      as: opsAdmin,
      headers: { 'Idempotency-Key': { value: key, shown: key } },
      body: { reason: 'E2E run: refund requested by ops, ticket E2E-6006', ...body },
      expect,
    });
  /** Razorpay processes a refund and says so through the signed refund.processed webhook. */
  async function refundProcessed(providerRefundId) {
    const moved = await call('POST', `/v1/dev/simulate/refunds/${providerRefundId}`, {
      as: admin,
      body: { status: 'processed' },
      expect: [200],
    });
    const webhook = signedEvent(secrets.razorpayWebhook, 'refund.processed', {
      refund: { entity: moved.body.entity },
    });
    refundEvents.push(webhook.eventId);
    await sendWebhook('/v1/webhooks/razorpay', webhook, 'RAZORPAY_SIGNATURE');
    return { webhook, entity: moved.body.entity, ...(await webhookEvent('payment_events', webhook.eventId)) };
  }
  const reviewList = async () =>
    (await call('GET', '/v1/admin/reconciliation/paid-cancelled-bookings', { as: admin, expect: [200] })).body;
  const refundAnomalies = async () =>
    (await call('GET', '/v1/admin/reconciliation/refund-anomalies', { as: admin, expect: [200] })).body;
  let refundedQr;

  await step(20, 'Provider refund of a cancelled PAY_AT_PICKUP QR booking: admin request, Razorpay refund (X-Refund-Idempotency), signed refund.processed, REFUNDED once', async () => {
    const { booking, bookingId: qrBookingId, tripId: qrTripId } = await bookFromQuote('REFUND-QR', 'PAY_AT_PICKUP', [
      { latitude: 26.2967, longitude: 73.0351 },
    ]);
    const owed = booking.payablePaise;
    await tripStatus(qrTripId, 'DRIVER_ARRIVED');
    const shown = await collectAt(qrTripId, { method: 'ONLINE_QR', amountPaise: owed }, [201]);
    const collectionId = shown.body.collectionId;
    const paid = await customerPaysQr(collectionId);
    const credited = await deliverQrEvent('qr_code.credited', paid);
    check(credited.outcome === 'APPLIED' && !credited.problem, 'the QR payment applied: booking PAID');
    const cancelled = await engine('POST', `/v1/internal/bookings/${qrBookingId}/cancel`, {
      reason: 'E2E run: customer cancelled before pickup',
    }, [200]);
    check(cancelled.body.status === 'CANCELLED' && cancelled.body.paymentStatus === 'PAID', 'cancelled, still PAID: nothing refunded on its own');
    check(
      (await reviewList()).some((finding) => finding.bookingId === qrBookingId && finding.amountPaise === owed),
      'listed for refund review for the whole amount',
    );

    const key = randomUUID();
    const requested = await refundAt({ bookingId: qrBookingId, sourceCollectionId: collectionId, kind: 'PROVIDER' }, key);
    const refund = requested.body.refund;
    check(
      requested.body.created === true && requested.body.submission === 'PROCESSING' && refund.status === 'PROCESSING' &&
        refund.kind === 'PROVIDER' && refund.amountPaise === owed && refund.refundCase === 'CANCELLED_BEFORE_HANDOVER' &&
        refund.providerPaymentId === paid.payment.id && /^rfnd_/.test(refund.providerRefundId ?? ''),
      'the server computed the amount from the collection and Razorpay accepted the refund',
    );
    refundIds.push(refund.refundId);
    const replay = await refundAt({ bookingId: qrBookingId, sourceCollectionId: collectionId, kind: 'PROVIDER' }, key, [200]);
    idempotent(
      'refund retried with the same Idempotency-Key returns the same refund',
      replay.body.created === false && replay.body.refund.refundId === refund.refundId,
    );
    const second = await refundAt({ bookingId: qrBookingId, sourceCollectionId: collectionId, kind: 'PROVIDER' }, randomUUID(), [409]);
    idempotent('a second refund of the same collection is refused while one is in progress', second.body.error.code === 'REFUND_IN_PROGRESS');
    let chain = await call('GET', `/v1/admin/bookings/${qrBookingId}`, { as: admin, expect: [200] });
    check(chain.body.booking.paymentStatus === 'REFUND_PENDING', 'booking REFUND_PENDING while Razorpay processes it');

    const processed = await refundProcessed(refund.providerRefundId);
    check(processed.outcome === 'REFUND_APPLIED' && !processed.problem, 'refund.processed applied');
    await sendWebhook('/v1/webhooks/razorpay', processed.webhook, 'RAZORPAY_SIGNATURE');
    idempotent('repeated refund.processed delivery is stored and applied once', (await webhookEvent('payment_events', processed.webhook.eventId)).rows === 1);
    const again = signedEvent(secrets.razorpayWebhook, 'refund.processed', { refund: { entity: processed.entity } });
    refundEvents.push(again.eventId);
    await sendWebhook('/v1/webhooks/razorpay', again, 'RAZORPAY_SIGNATURE');
    idempotent('the same refund state in a new event changes nothing', (await webhookEvent('payment_events', again.eventId)).outcome === 'REFUND_ALREADY_APPLIED');
    const synced = await call('POST', `/v1/admin/refunds/${refund.refundId}/sync`, { as: admin, expect: [200] });
    idempotent('an admin sync after the webhook finds it already applied', synced.body.outcome === 'REFUND_ALREADY_APPLIED');

    const completed = (await call('GET', `/v1/admin/refunds/${refund.refundId}`, { as: admin, expect: [200] })).body;
    check(completed.status === 'COMPLETED' && completed.completedAt && completed.providerReference, 'refund COMPLETED, with the bank reference');
    chain = await call('GET', `/v1/admin/bookings/${qrBookingId}`, { as: admin, expect: [200] });
    check(chain.body.booking.paymentStatus === 'REFUNDED', 'booking REFUNDED');
    check(
      chain.body.collections.length === 1 && chain.body.collections[0].status === 'COMPLETED' &&
        chain.body.collections[0].amountPaise === owed && chain.body.collections[0].refundedPaise === owed,
      'the collection keeps its facts and shows what was refunded of it',
    );
    check(chain.body.refunds.length === 1 && chain.body.refunds[0].status === 'COMPLETED', 'the money trail lists the refund');
    check(!(await reviewList()).some((finding) => finding.bookingId === qrBookingId), 'off the refund review list');
    const more = await refundAt({ bookingId: qrBookingId, sourceCollectionId: collectionId, kind: 'PROVIDER' }, randomUUID(), [409]);
    check(more.body.error.code === 'REFUND_SOURCE_NOT_REFUNDABLE', 'nothing is left to refund');
    refundedQr = { bookingId: qrBookingId, collectionId, refundId: refund.refundId, amountPaise: owed };
    return {
      bookingId: qrBookingId,
      collectionId,
      refundId: refund.refundId,
      providerRefundId: refund.providerRefundId,
      amountPaise: owed,
      bookingPaymentStatus: chain.body.booking.paymentStatus,
    };
  });

  await step(21, 'Cash returned on the completed step 12 cash trip: explicit fee decision, platform fee credited back to the wallet once, earning untouched and reported (L-21)', async () => {
    const walletBefore = (await walletNow()).balancePaise;
    const earningBefore = (await call('GET', `/v1/admin/earnings/${pickupCash.earningId}`, { as: admin, expect: [200] })).body;
    const body = { bookingId: pickupCash.bookingId, sourceCollectionId: pickupCash.collectionId, kind: 'CASH_RETURNED' };
    const undecided = await refundAt(body, randomUUID(), [422]);
    check(undecided.body.error.code === 'REFUND_FEE_TREATMENT_REQUIRED', 'a cash return needs the admin decision on the cash fee');
    const online = await refundAt({ ...body, kind: 'PROVIDER' }, randomUUID(), [422]);
    check(online.body.error.code === 'REFUND_SOURCE_INVALID', 'cash is never refunded through Razorpay');

    const key = randomUUID();
    const recorded = await refundAt({ ...body, feeTreatment: 'CREDITED_TO_WALLET' }, key);
    const refund = recorded.body.refund;
    check(
      recorded.body.created === true && recorded.body.submission === null && refund.status === 'COMPLETED' &&
        refund.kind === 'CASH_RETURNED' && refund.refundCase === 'COMPLETED_BOOKING' &&
        refund.feeTreatment === 'CREDITED_TO_WALLET' && refund.feeCreditPaise === pickupCash.feePaise &&
        refund.walletTransactionId,
      'cash return recorded COMPLETED; the platform fee credited back, as decided',
    );
    refundIds.push(refund.refundId);
    const replay = await refundAt({ ...body, feeTreatment: 'CREDITED_TO_WALLET' }, key, [200]);
    const walletAfter = (await walletNow()).balancePaise;
    idempotent(
      'cash return retried with the same Idempotency-Key: same refund, the fee credited once',
      replay.body.created === false && replay.body.refund.refundId === refund.refundId &&
        walletAfter === walletBefore + pickupCash.feePaise,
    );
    const transactions = (await call('GET', '/v1/wallet/transactions', { as: driver, expect: [200] })).body.items;
    const credits = transactions.filter((entry) => entry.type === 'REFUND_REVERSAL');
    check(
      credits.length === 1 && credits[0].direction === 'CREDIT' && credits[0].amountPaise === pickupCash.feePaise &&
        credits[0].referenceType === 'REFUND' && credits[0].referenceId === refund.refundId,
      'one REFUND_REVERSAL credit in the ledger, for this cash return',
    );
    const earningAfter = (await call('GET', `/v1/admin/earnings/${pickupCash.earningId}`, { as: admin, expect: [200] })).body;
    check(
      earningAfter.status === 'SETTLED_IN_CASH' && earningAfter.netAmountPaise === earningBefore.netAmountPaise,
      'the cash earning keeps its financial truth: nothing is clawed back',
    );
    check(
      (await refundAnomalies()).some(
        (finding) => finding.problem === 'REFUND_ON_CASH_EARNING' && finding.bookingId === pickupCash.bookingId,
      ),
      'reconciliation reports it for a decision (L-21)',
    );
    const chain = await call('GET', `/v1/admin/bookings/${pickupCash.bookingId}`, { as: admin, expect: [200] });
    check(chain.body.booking.paymentStatus === 'REFUNDED', 'booking REFUNDED');
    return {
      bookingId: pickupCash.bookingId,
      refundId: refund.refundId,
      feeCreditPaise: refund.feeCreditPaise,
      walletBalancePaise: walletAfter,
    };
  });

  await step(22, 'Refund of a step 17 QR drop after its earning was paid out: the earning stays PAID (no clawback), the booking PARTIALLY_REFUNDED, reported (L-21)', async () => {
    const chainBefore = await call('GET', `/v1/admin/bookings/${split.bookingId}`, { as: admin, expect: [200] });
    const drop1 = chainBefore.body.collections.find((entry) => entry.stopSequence === 1 && entry.status === 'COMPLETED');
    check(drop1 && drop1.method === 'ONLINE_QR', "drop 1's QR collection");
    const walletBefore = (await walletNow()).balancePaise;
    const requested = await refundAt({
      bookingId: split.bookingId,
      sourceCollectionId: drop1.collectionId,
      stopSequence: 1,
      kind: 'PROVIDER',
    });
    const refund = requested.body.refund;
    check(
      refund.status === 'PROCESSING' && refund.stopSequence === 1 && refund.amountPaise === drop1.amountPaise &&
        refund.refundCase === 'COMPLETED_BOOKING',
      "a refund of drop 1's money only, computed from that drop's collection",
    );
    refundIds.push(refund.refundId);
    const processed = await refundProcessed(refund.providerRefundId);
    check(processed.outcome === 'REFUND_APPLIED', 'refund.processed applied');
    const earning = (await call('GET', `/v1/admin/earnings/${split.earningId}`, { as: admin, expect: [200] })).body;
    check(earning.status === 'PAID' && earning.paidAt, 'the earning paid out stays PAID: nothing recovered automatically');
    const chain = await call('GET', `/v1/admin/bookings/${split.bookingId}`, { as: admin, expect: [200] });
    check(chain.body.booking.paymentStatus === 'PARTIALLY_REFUNDED', 'booking PARTIALLY_REFUNDED: drops 2 and 3 not refunded');
    check(
      (await refundAnomalies()).some(
        (finding) => finding.problem === 'REFUND_AFTER_PAYOUT' && finding.bookingId === split.bookingId &&
          finding.earningId === split.earningId && finding.payoutId,
      ),
      'reconciliation reports the refund after the payout, with the payout (L-21)',
    );
    check((await walletNow()).balancePaise === walletBefore, 'a provider refund never touches the driver wallet');
    return {
      bookingId: split.bookingId,
      refundId: refund.refundId,
      amountPaise: refund.amountPaise,
      earningStatus: earning.status,
      bookingPaymentStatus: chain.body.booking.paymentStatus,
    };
  });

  await step(23, 'Phase 6 audit: refunds, refunded amounts, booking statuses, the fee credit and the audit trail reconcile', async () => {
    const bookingIds = [refundedQr.bookingId, pickupCash.bookingId, split.bookingId];
    const integrity = (await refundAnomalies()).filter((finding) =>
      ['REFUNDED_TOTAL_MISMATCH', 'REFUNDS_EXCEED_SOURCE', 'BOOKING_REFUND_STATUS_MISMATCH', 'FEE_CREDIT_MISMATCH',
        'STALE_PENDING_REFUND', 'STALE_PROCESSING_REFUND'].includes(finding.problem),
    );
    check(integrity.length === 0, 'refund-anomalies: no integrity finding (only the L-21 flags for a decision)');
    for (const reportName of ['wallet-mismatches', 'webhook-anomalies', 'unprocessed-webhooks']) {
      const findings = await call('GET', `/v1/admin/reconciliation/${reportName}`, { as: admin, expect: [200] });
      const text = JSON.stringify(findings.body);
      check(
        [walletId, ...refundEvents].every((id) => !text.includes(id)),
        `${reportName}: nothing for the wallet or this run's refund webhooks`,
      );
    }
    const rows = await db.query(
      `SELECT r.kind, r.status, r.amount_paise::int AS amount, r.booking_id::text AS booking_id,
              b.payment_status::text AS booking_status, booking_money_status(b.id) AS money_status
         FROM payment_refunds r JOIN bookings b ON b.id = r.booking_id
        ORDER BY r.created_at`,
    );
    check(rows.rows.length === 3 && rows.rows.every((row) => row.status === 'COMPLETED'), 'three refunds, all COMPLETED');
    check(rows.rows.every((row) => row.booking_status === row.money_status), "every booking's payment status is what its money says");
    const collections = await db.query(
      `SELECT COUNT(*) FILTER (WHERE c.refunded_paise <> COALESCE(s.total, 0))::int AS mismatched,
              COALESCE(SUM(c.refunded_paise), 0)::int AS refunded
         FROM payment_collections c
         LEFT JOIN (SELECT source_collection_id, SUM(amount_paise) AS total FROM payment_refunds
                     WHERE status = 'COMPLETED' GROUP BY 1) s ON s.source_collection_id = c.id`,
    );
    check(
      collections.rows[0].mismatched === 0 &&
        collections.rows[0].refunded === rows.rows.reduce((sum, row) => sum + row.amount, 0),
      'refunded_paise is exactly the completed refunds, collection by collection',
    );
    const audit = await db.query(
      `SELECT action, COUNT(*)::int AS n FROM admin_actions
        WHERE target_type = 'PAYMENT_REFUND' GROUP BY 1 ORDER BY 1`,
    );
    const actions = Object.fromEntries(audit.rows.map((row) => [row.action, row.n]));
    check(
      actions.REFUND_REQUESTED === 2 && actions.CASH_RETURN_RECORDED === 1 && actions.REFUND_COMPLETED === 2,
      'audit trail: two provider refunds requested and completed, one cash return recorded',
    );
    const ledger = await db.query(
      `SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount_paise), 0)::int AS total
         FROM driver_wallet_transactions WHERE type = 'REFUND_REVERSAL'`,
    );
    check(
      ledger.rows[0].entries === 1 && ledger.rows[0].total === pickupCash.feePaise,
      'one REFUND_REVERSAL ledger credit: the cash fee credited back with the cash return',
    );
    const summary = (await call('GET', '/v1/earnings/summary', { as: driver, expect: [200] })).body;
    const paidOut = NET_PAISE + pickupQr.netPaise + delivery.payoutPaise + split.payoutPaise;
    check(summary.paidPaise === paidOut, 'driver summary: what was paid out is unchanged (no clawback)');
    report.ids.phase6 = { refundIds, bookingIds };
    return { refunds: rows.rows.length, auditActions: actions, refundReversal: ledger.rows[0] };
  });

  /** An admin starts a reconciliation job; waits for it on the database (no polling noise). */
  async function runJob(job, since) {
    const started = await call('POST', '/v1/admin/reconciliation/runs', {
      as: admin,
      body: since ? { job, since } : { job },
      expect: [202],
    });
    check(
      started.body.job === job && started.body.status === 'RUNNING' && started.body.triggeredBy === 'ADMIN',
      `${job} run started by the admin (202, RUNNING)`,
    );
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const row = await db.query('SELECT status FROM reconciliation_runs WHERE id = $1', [started.body.id]);
      if (row.rows[0]?.status !== 'RUNNING') {
        break;
      }
      await sleep(250);
    }
    const finished = await call('GET', `/v1/admin/reconciliation/runs/${started.body.id}`, { as: admin, expect: [200] });
    check(finished.body.status === 'COMPLETED' && finished.body.error === null, `${job} run COMPLETED`);
    return finished.body;
  }

  await step(24, 'Phase 7: a QR paid while its webhook was missed is recovered once by the job, every change is in the audit trail, reconciliation records what it finds for an admin', async () => {
    const since = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
    const { booking, bookingId: lostBookingId, tripId: lostTripId } = await bookFromQuote('RECOVERY', 'PAY_AT_PICKUP', [
      { latitude: 26.2967, longitude: 73.0351 },
    ]);
    await tripStatus(lostTripId, 'DRIVER_ARRIVED');
    const qrBody = { method: 'ONLINE_QR', amountPaise: booking.payablePaise };
    let shown = await collectAt(lostTripId, qrBody, [201, 429]);
    if (shown.status === 429) {
      // The steps above used this driver's collection limit (20 a minute); a refused request
      // never reached the backend, so waiting for the window and asking again is safe.
      console.log('    (driver collection rate limit reached by the earlier steps: waiting for the window)');
      await sleep(61_000);
      shown = await collectAt(lostTripId, qrBody, [201]);
    }
    const collectionId = shown.body.collectionId;
    // The customer pays; the webhook is lost and the driver's app never refreshes.
    const paid = await customerPaysQr(collectionId);
    const pending = await call('GET', `/v1/admin/collections/${collectionId}`, { as: admin, expect: [200] });
    check(pending.body.status === 'PENDING', 'paid at the provider, still PENDING here');

    const recovery = await runJob('COLLECTION_RECOVERY', since);
    check(recovery.summary.recovered === 1 && recovery.summary.complete === true, 'the recovery job applied exactly one payment');
    const recovered = await call('GET', `/v1/admin/collections/${collectionId}`, { as: admin, expect: [200] });
    check(
      recovered.body.status === 'COMPLETED' && recovered.body.providerPaymentId === paid.payment.id,
      'collection COMPLETED with the payment the provider reported',
    );
    const lostChain = await call('GET', `/v1/admin/bookings/${lostBookingId}`, { as: admin, expect: [200] });
    check(lostChain.body.booking.paymentStatus === 'PAID', 'booking PAID');

    // Nothing silent: the recovery is a finding, and the change is in the log as the job.
    const findings = await call(
      'GET',
      `/v1/admin/reconciliation/findings?kind=COLLECTION_RECOVERED&entityId=${collectionId}`,
      { as: admin, expect: [200] },
    );
    const [finding] = findings.body.items;
    check(
      findings.body.items.length === 1 && finding.severity === 'INFO' && finding.source === 'RECOVERY' &&
        finding.category === 'PROVIDER_PAID_INTERNAL_PENDING' && finding.bookingId === lostBookingId,
      'one COLLECTION_RECOVERED finding (INFO) names the booking',
    );
    const trail = await call('GET', `/v1/admin/audit/financial-events?entityId=${collectionId}&order=asc`, {
      as: admin,
      expect: [200],
    });
    const [created] = trail.body.items;
    const transitions = trail.body.items.filter((event) => event.action === 'STATUS_CHANGED');
    check(created?.action === 'CREATED' && created.actorType === 'DRIVER', 'audit: the driver showed the QR');
    check(
      transitions.length === 1 && transitions[0].statusFrom === 'PENDING' && transitions[0].statusTo === 'COMPLETED' &&
        transitions[0].actorType === 'SYSTEM' && transitions[0].requestId === recovery.id &&
        transitions[0].origin === 'job COLLECTION_RECOVERY',
      'audit: the recovery job completed it, under its run id',
    );
    check(
      lostChain.body.auditTrailComplete === true && lostChain.body.auditTrail[0].entityType === 'BOOKING' &&
        lostChain.body.auditTrail[0].actorType === 'ENGINE' &&
        lostChain.body.auditTrail.some((event) => event.action === 'PAYMENT_STATUS_CHANGED' && event.requestId === recovery.id),
      "the booking chain carries the booking's trail, from registration by the trip engine to its payment",
    );

    // The webhook arrives late; a second run finds nothing to do.
    const late = await deliverQrEvent('qr_code.credited', paid);
    idempotent('the late qr_code.credited finds the QR already applied by the recovery job', late.outcome === 'ALREADY_APPLIED');
    const again = await runJob('COLLECTION_RECOVERY', since);
    const after = await call('GET', `/v1/admin/audit/financial-events?entityId=${collectionId}`, { as: admin, expect: [200] });
    const sighted = await call('GET', `/v1/admin/reconciliation/findings/${finding.id}`, { as: admin, expect: [200] });
    idempotent(
      'a second recovery run changes nothing: no new event, no new sighting',
      again.summary.recovered === 0 && after.body.items.length === trail.body.items.length && sighted.body.occurrences === 1,
    );
    const lateEvent = await call('GET', `/v1/admin/audit/webhook-events?eventId=${late.webhook.eventId}`, {
      as: admin,
      expect: [200],
    });
    check(
      lateEvent.body.items.length === 1 && lateEvent.body.items[0].outcome === 'ALREADY_APPLIED' &&
        !('payload' in lateEvent.body.items[0]),
      'audit: the late webhook and what it did, without its payload',
    );

    // A full reconciliation over everything this run did (steps 1 to 24).
    const reconciliation = await runJob('RECONCILIATION');
    const checks = reconciliation.summary.checks;
    check(
      checks.length > 20 && checks.every((entry) => !String(entry.note ?? '').startsWith('failed')),
      `every database check ran (${checks.length})`,
    );
    check(reconciliation.summary.providerChecks === false && reconciliation.summary.scoped === false, 'a full run, database checks only');
    const integrity = await db.query(
      `SELECT kind, count(*)::int AS n FROM reconciliation_findings
        WHERE last_run_id = $1 AND severity = 'CRITICAL'
          AND category IN ('WALLET_MISMATCH', 'EARNING_SOURCE_MISMATCH', 'DUPLICATE_PROVIDER_EVENT')
        GROUP BY 1 ORDER BY 1`,
      [reconciliation.id],
    );
    check(
      integrity.rows.length === 0,
      `no critical wallet, earning-source or duplicate-money finding after the whole flow (${JSON.stringify(integrity.rows)})`,
    );
    const bySeverity = await db.query(
      `SELECT severity, count(*)::int AS n FROM reconciliation_findings
        WHERE last_run_id = $1 GROUP BY 1 ORDER BY 1`,
      [reconciliation.id],
    );

    // An admin closes the recovery finding with a note; a resolution never changes.
    const note = 'Checked against the provider: paid once, applied once by the recovery job';
    const resolved = await call('POST', `/v1/admin/reconciliation/findings/${finding.id}/resolve`, {
      as: admin,
      body: { note },
      expect: [200],
    });
    check(resolved.body.status === 'RESOLVED' && resolved.body.resolutionNote === note, 'finding RESOLVED with the note');
    const twice = await call('POST', `/v1/admin/reconciliation/findings/${finding.id}/resolve`, {
      as: admin,
      body: { note: 'A second resolution attempt' },
      expect: [409],
    });
    idempotent('a resolved finding is never resolved again', twice.body.error.code === 'RECONCILIATION_FINDING_RESOLVED');
    const decisions = await db.query(
      `SELECT action, COUNT(*)::int AS n FROM admin_actions
        WHERE action IN ('RECONCILIATION_RUN_REQUESTED', 'RECONCILIATION_FINDING_RESOLVED')
        GROUP BY 1 ORDER BY 1`,
    );
    const decided = Object.fromEntries(decisions.rows.map((row) => [row.action, row.n]));
    check(
      decided.RECONCILIATION_RUN_REQUESTED === 3 && decided.RECONCILIATION_FINDING_RESOLVED === 1,
      'audit: three runs requested and one finding resolved, each by the admin',
    );

    // The event log is append-only, for the table owner too.
    const rewrite = await db
      .query("UPDATE financial_events SET origin = 'rewritten' WHERE entity_id = $1", [collectionId])
      .then(() => null, (error) => error.message);
    check(rewrite !== null && /append-only/.test(rewrite), 'the financial event log refuses to be rewritten');
    const summary = await call('GET', '/v1/admin/reconciliation/summary', { as: admin, expect: [200] });
    check(
      summary.body.latestRuns.COLLECTION_RECOVERY.id === again.id &&
        summary.body.latestRuns.RECONCILIATION.id === reconciliation.id,
      'the summary shows the latest run of each job',
    );
    report.ids.phase7 = {
      bookingId: lostBookingId,
      collectionId,
      recoveryRunIds: [recovery.id, again.id],
      reconciliationRunId: reconciliation.id,
      findingId: finding.id,
    };
    return {
      recovered: recovery.summary.recovered,
      events: trail.body.items.length,
      findingsBySeverity: Object.fromEntries(bySeverity.rows.map((row) => [row.severity, row.n])),
      openFindings: summary.body.openFindings.total,
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
