#!/usr/bin/env node
/**
 * Engine <-> payment backend contract E2E (payment flow Phase 8, engine integration).
 *
 * Runs the real trip engine build (raj_engine/dist) against the real payment backend build
 * (raj_backend/dist), through the public API of each: the Customer and Driver apps' calls to the
 * engine, the driver's collections and the admin's decisions at the backend, and the engine's
 * internal calls to the backend, which go through a fault-injecting proxy.
 *
 *   Flow A  PAY_AT_PICKUP in cash, 1 drop.
 *   Flow B  PAY_AT_PICKUP by QR (simulated provider, signed webhook), 2 drops, with a lost
 *           registration answer, a lost assignment answer, the backend down while the driver
 *           arrives and an engine crash/restart meanwhile, duplicate requests, a lost delivery
 *           answer, a failed delivery and its retry by the driver.
 *   Flow C  PAY_AT_DELIVERY, 3 drops: a fake customer and a fake / unapproved driver refused,
 *           concurrent confirmations and acceptances, a refused internal key, drop 1 in cash,
 *           drop 2 by QR, drop 3 failed and closed UNDELIVERED by an admin.
 *   S       Security sweep: tokens, removed routes, another driver, and every call the engine
 *           made: only the internal API, never an amount, a payment status or PAYMENT_CONFIRMED.
 *
 * Isolation: two databases created for the run (multipleride_contract_e2e for the backend,
 * multipleride_engine_contract_e2e for the engine; dropped after a passing run), their own ports
 * (3110, 3120), a local JWKS shared by both services (one Firebase project), and freshly
 * generated secrets. The dev database, the dev backend and its in-flight bookings (TAB-QR-001)
 * are never touched. Razorpay is never called: every provider is the simulated one, and the
 * backend's .env must hold Razorpay TEST keys anyway.
 *
 * Usage (from raj_engine, after `npm run build` here and in raj_backend, Docker Postgres up):
 *   node test/contract/run-contract-e2e.mjs [--keep]
 *   (--keep leaves the databases and logs in place after a passing run.)
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND_ROOT = path.resolve(process.env.RAJ_BACKEND_DIR ?? path.join(ENGINE_ROOT, '..', 'raj_backend'));
const BACKEND_DATABASE = 'multipleride_contract_e2e';
const ENGINE_DATABASE = 'multipleride_engine_contract_e2e';
const BACKEND_PORT = 3110;
const ENGINE_PORT = 3120;
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
const ISSUER = 'https://securetoken.google.com/multipleride-contract';
const AUDIENCE = 'multipleride-contract';
const WALLET_FLOAT_PAISE = 200_000;
const KEEP = process.argv.includes('--keep');

const report = { startedAt: new Date().toISOString(), steps: [], checks: 0, ids: {} };
const children = { backend: null, engine: null };
const servers = [];
let engineDb;
let engineEnv;
let logs;

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

function loadSetup() {
  const envFile = path.join(BACKEND_ROOT, '.env');
  if (!existsSync(envFile)) {
    throw new Error(`.env not found in ${BACKEND_ROOT}`);
  }
  // Parsed, not loaded: the backend's settings go to the backend process only.
  const backendEnv = parseEnv(readFileSync(envFile, 'utf8'));
  if (!backendEnv.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
    throw new Error('Refusing to run: the backend RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_)');
  }
  for (const file of ['dist/main.js', 'dist/cli/provision.js']) {
    if (!existsSync(path.join(BACKEND_ROOT, file))) {
      throw new Error(`raj_backend/${file} not found: run \`npm run build\` in raj_backend first`);
    }
  }
  if (!existsSync(path.join(ENGINE_ROOT, 'dist', 'main.js'))) {
    throw new Error('raj_engine/dist/main.js not found: run `npm run build` first');
  }
  const devUrl = new URL(backendEnv.DATABASE_URL ?? '');
  const devName = devUrl.pathname.replace(/^\//, '');
  const urlFor = (name) => {
    if (!/^[a-z0-9_]+_e2e$/.test(name) || name === devName) {
      throw new Error(`Refusing to use database "${name}": only *_e2e databases, never the dev database`);
    }
    const url = new URL(devUrl);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const serverUrl = new URL(devUrl);
  serverUrl.pathname = '/postgres';
  return {
    backendEnv,
    backendUrl: urlFor(BACKEND_DATABASE),
    engineUrl: urlFor(ENGINE_DATABASE),
    serverUrl: serverUrl.toString(),
  };
}

async function withServerClient(serverUrl, work) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabases(setup) {
  await withServerClient(setup.serverUrl, async (client) => {
    // Constant identifiers, checked in loadSetup: never a user-supplied name.
    for (const name of [BACKEND_DATABASE, ENGINE_DATABASE]) {
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${name}`);
    }
  });
  for (const [root, url] of [
    [BACKEND_ROOT, setup.backendUrl],
    [ENGINE_ROOT, setup.engineUrl],
  ]) {
    execFileSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  }
}

async function dropDatabases(setup) {
  await withServerClient(setup.serverUrl, async (client) => {
    for (const name of [BACKEND_DATABASE, ENGINE_DATABASE]) {
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  });
}

/** One identity provider for both services (the apps' Firebase project): a local JWKS. */
async function startJwks() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `contract-${randomBytes(4).toString('hex')}`;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const server = createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await listen(server);
  const sign = (subject, { audience = AUDIENCE } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'phone' } },
      privateKey,
      { algorithm: 'RS256', keyid: kid, subject, issuer: ISSUER, audience },
    );
  };
  return { url: `http://127.0.0.1:${server.address().port}/jwks`, sign };
}

/**
 * Between the engine and the backend: forwards every call and records it, and injects faults on
 * demand: a 503 without forwarding, the call applied but the answer lost (connection dropped), a
 * slow answer, or a wrong internal key (the backend's real 401).
 */
async function startProxy(target) {
  const calls = [];
  const faults = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    let body = null;
    try {
      body = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null;
    } catch {
      body = { unparsable: true };
    }
    const entry = {
      method: request.method,
      path: (request.url ?? '/').split('?')[0],
      body,
      requestId: request.headers['x-request-id'],
      keyPresent: typeof request.headers['x-internal-api-key'] === 'string',
      status: 0,
      fault: null,
      at: Date.now(),
    };
    calls.push(entry);
    const fault = faults.find((candidate) => candidate.times > 0 && candidate.match(entry));
    if (fault) {
      fault.times -= 1;
      entry.fault = fault.mode;
    }
    if (fault?.mode === 'STATUS_503') {
      entry.status = 503;
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'injected by the contract proxy' } }));
      return;
    }
    const headers = { accept: 'application/json' };
    for (const name of ['content-type', 'x-internal-api-key', 'x-request-id']) {
      if (typeof request.headers[name] === 'string') {
        headers[name] = request.headers[name];
      }
    }
    if (fault?.mode === 'BAD_KEY') {
      headers['x-internal-api-key'] = `wrong_${randomBytes(20).toString('hex')}`;
    }
    let upstream;
    let text;
    try {
      upstream = await fetch(`${target}${request.url}`, {
        method: request.method,
        headers,
        body: raw.length > 0 ? raw : undefined,
        redirect: 'manual',
      });
      text = await upstream.text();
    } catch {
      entry.status = 502;
      response.writeHead(502);
      response.end();
      return;
    }
    entry.status = upstream.status;
    if (fault?.mode === 'DROP_AFTER_APPLY') {
      request.socket.destroy();
      return;
    }
    if (fault?.mode === 'DELAY') {
      await sleep(fault.delayMs ?? 1_000);
    }
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    response.end(text);
  });
  await listen(server);
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    fail: (fault) => faults.push({ times: 1, ...fault }),
    clear: () => {
      faults.length = 0;
    },
  };
}

function provision(setup, args) {
  const output = execFileSync(process.execPath, [path.join(BACKEND_ROOT, 'dist', 'cli', 'provision.js'), ...args], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: setup.backendUrl, AUTH_PROVIDER: 'firebase', NODE_ENV: 'development' },
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

const phone = () => `+91${randomInt(6_000_000_000, 9_999_999_999)}`;

function startProcess(name, script, env, readyUrl) {
  const logFile = path.join(tmpdir(), `multipleride-contract-${name}.log`);
  const log = createWriteStream(logFile, { flags: 'a' });
  // The engine loads a .env from its working directory in development: an empty one is used.
  const cwd = name === 'engine' ? mkdtempSync(path.join(tmpdir(), 'mr-contract-engine-')) : BACKEND_ROOT;
  const child = spawn(process.execPath, [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.workDir = cwd;
  children[name] = child;
  return waitReady(name, child, readyUrl, logFile).then(() => logFile);
}

async function waitReady(name, child, url, logFile) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The ${name} exited with code ${child.exitCode}; see ${logFile}`);
    }
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(300);
  }
  throw new Error(`The ${name} did not become ready; see ${logFile}`);
}

async function stopProcess(name) {
  const child = children[name];
  children[name] = null;
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill(); // Windows: terminated at once, like a crash (no graceful shutdown)
  await Promise.race([exited, sleep(10_000)]);
  if (child.workDir && child.workDir !== BACKEND_ROOT) {
    rmSync(child.workDir, { recursive: true, force: true });
  }
}

const startEngine = () => startProcess('engine', path.join(ENGINE_ROOT, 'dist', 'main.js'), engineEnv, `${ENGINE}/health`);

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function listen(server) {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(condition, message) {
  report.checks += 1;
  if (!condition) {
    throw new Error(`Check failed: ${message}`);
  }
}

async function waitFor(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) {
      return last;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function step(id, title, work) {
  console.log(`\n[${id}] ${title}`);
  try {
    const detail = await work();
    report.steps.push({ step: id, title, result: 'PASS', ...(detail ? { detail } : {}) });
    console.log(`    PASS${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  } catch (error) {
    report.steps.push({ step: id, title, result: 'FAIL', error: error.message });
    console.log(`    FAIL  ${error.message}`);
    throw error;
  }
}

/** One HTTP call; `expect` lists the accepted statuses. */
async function http(base, method, route, { token, body, headers = {}, expect = [200, 201] } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${base === ENGINE ? 'engine' : 'backend'} ${route} -> HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  return { status: response.status, body: json };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

async function main() {
  const setup = loadSetup();
  console.log(`Databases ${BACKEND_DATABASE} (backend) and ${ENGINE_DATABASE} (engine): recreating and migrating`);
  await recreateDatabases(setup);
  engineDb = new pg.Client({ connectionString: setup.engineUrl });
  await engineDb.connect();
  const idp = await startJwks();

  const tag = () => randomBytes(5).toString('hex');
  const subjects = {
    admin: `adm_ct_${tag()}`,
    driverA: `drv_ct_a_${tag()}`,
    driverB: `drv_ct_b_${tag()}`,
    driverPending: `drv_ct_pending_${tag()}`,
    customerA: `cus_ct_a_${tag()}`,
    customerB: `cus_ct_b_${tag()}`,
    // Valid Firebase tokens, never provisioned at the payment backend.
    fakeCustomer: `cus_ct_fake_${tag()}`,
    fakeDriver: `drv_ct_fake_${tag()}`,
  };
  console.log('Provisioning at the backend: admin, two approved drivers, one unapproved driver, two customers, fee rule, pricing');
  provision(setup, ['create-admin', '--phone', phone(), '--subject', subjects.admin]);
  for (const [subject, name] of [
    [subjects.driverA, 'Ramesh Kumar'],
    [subjects.driverB, 'Suresh Singh'],
  ]) {
    provision(setup, ['create-driver', '--phone', phone(), '--subject', subject, '--approve', '--name', name]);
  }
  provision(setup, ['create-driver', '--phone', phone(), '--subject', subjects.driverPending, '--name', 'Pending Driver']);
  for (const subject of [subjects.customerA, subjects.customerB]) {
    provision(setup, ['create-customer', '--phone', phone(), '--subject', subject]);
  }
  provision(setup, ['create-fee-rule', '--type', 'PERCENTAGE', '--value', '10', '--reason', 'Contract E2E: approved V1 platform fee, 10%']);
  provision(setup, [
    'create-pricing-version', '--code', `PROTOTYPE-CT-${tag().toUpperCase()}`,
    '--file', path.join(BACKEND_ROOT, 'pricing', 'prototype-leg-distance-v1.json'),
    '--reason', 'Contract E2E: development prototype rates, not approved for production',
  ]);

  const secrets = {
    internalApiKey: randomBytes(32).toString('hex'),
    razorpayWebhook: randomBytes(24).toString('hex'),
  };
  const backendLog = await startProcess('backend', path.join(BACKEND_ROOT, 'dist', 'main.js'), {
    ...process.env,
    ...setup.backendEnv,
    NODE_ENV: 'development',
    PORT: String(BACKEND_PORT),
    LOG_LEVEL: 'warn',
    DATABASE_URL: setup.backendUrl,
    AUTH_PROVIDER: 'firebase',
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
    COLLECTION_RECOVERY_INTERVAL_MINUTES: '0',
    COLLECTION_RECOVERY_MIN_AGE_MINUTES: '0',
    RECONCILIATION_INTERVAL_MINUTES: '0',
    RECONCILIATION_MIN_AGE_MINUTES: '0',
    RECONCILIATION_PROVIDER_CHECKS: 'false',
    RAZORPAYX_ACCOUNT_NUMBER: '',
    RAZORPAYX_KEY_ID: '',
    RAZORPAYX_KEY_SECRET: '',
    RAZORPAYX_WEBHOOK_SECRET: randomBytes(24).toString('hex'),
    RAZORPAYX_WEBHOOK_SECRET_PREVIOUS: '',
    PAYOUT_SCHEDULE_ENABLED: 'false',
    PAYOUT_AUTO_EXECUTE: 'false',
    TDS_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  }, `${BACKEND}/health/ready`);
  const proxy = await startProxy(BACKEND);
  engineEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(ENGINE_PORT),
    DATABASE_URL: setup.engineUrl,
    DATABASE_POOL_MAX: '10',
    AUTH_JWKS_URL: idp.url,
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    PAYMENT_BACKEND_URL: proxy.url,
    PAYMENT_BACKEND_INTERNAL_API_KEY: secrets.internalApiKey,
    PAYMENT_BACKEND_TIMEOUT_MS: '3000',
    // The background sender runs for real.
    OUTBOX_POLL_INTERVAL_MS: '500',
    OUTBOX_LEASE_SECONDS: '10',
    OUTBOX_BASE_BACKOFF_MS: '300',
    OUTBOX_MAX_BACKOFF_MS: '2000',
    OUTBOX_ALERT_AFTER_ATTEMPTS: '5',
    OFFER_TTL_SECONDS: '120',
  };
  const engineLog = await startEngine();
  logs = { backend: backendLog, engine: engineLog };
  console.log(`Backend ${BACKEND} (log ${backendLog}); engine ${ENGINE} (log ${engineLog}); proxy ${proxy.url}`);

  const token = Object.fromEntries(Object.entries(subjects).map(([name, subject]) => [name, idp.sign(subject)]));
  const engine = (method, route, as, body, expect) =>
    http(ENGINE, method, route, { token: as ? token[as] : undefined, body, expect });
  const backend = (method, route, as, body, expect, headers) =>
    http(BACKEND, method, route, { token: as ? token[as] : undefined, body, expect, headers });
  /** The backend's own view (internal API, straight to the backend, not through the proxy). */
  const remote = async (paymentBookingId) =>
    (await http(BACKEND, 'GET', `/v1/internal/bookings/${paymentBookingId}`, {
      headers: { 'x-internal-api-key': secrets.internalApiKey, 'x-request-id': `contract-${tag()}` },
    })).body;
  const remoteByRef = async (externalRef, expect = [200]) =>
    http(BACKEND, 'GET', `/v1/internal/bookings/by-ref/${externalRef}`, {
      headers: { 'x-internal-api-key': secrets.internalApiKey, 'x-request-id': `contract-${tag()}` },
      expect,
    });
  const quote = async (customer, drops) =>
    (await backend('POST', '/v1/fare/quotes', customer, {
      pickup: { latitude: 26.2389, longitude: 73.0243 },
      drops: drops.map(([latitude, longitude]) => ({ latitude, longitude })),
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 12.5,
    }, [201])).body;
  const online = (driver) => engine('PATCH', `/drivers/${subjects[driver]}/availability`, driver, { isAvailable: true }, [200]);
  const book = (customer, driver, quoteId, paymentMethod, expect = [201]) =>
    engine('POST', '/rides', customer, { quoteId, paymentMethod, driverId: subjects[driver] }, expect);
  const collect = (driver, paymentTripId, body, expect = [201], key = randomUUID()) =>
    backend('POST', `/v1/trips/${paymentTripId}/collections`, driver, body, expect, { 'idempotency-key': key });
  const engineRow = async (sql, params) => (await engineDb.query(sql, params)).rows;
  const storedOtps = async (rideId) => {
    const [booking] = await engineRow('SELECT pickup_otp FROM engine_bookings WHERE id = $1', [rideId]);
    const stops = await engineRow('SELECT otp FROM engine_stops WHERE booking_id = $1 ORDER BY sequence', [rideId]);
    return { pickup: booking.pickup_otp, stops: stops.map((row) => row.otp) };
  };
  const callsTo = (pattern, filter = () => true) =>
    proxy.calls.filter((entry) => pattern.test(`${entry.method} ${entry.path}`) && filter(entry));
  const tripStatusCalls = (paymentTripId, status) =>
    callsTo(new RegExp(`^POST /v1/internal/trips/${paymentTripId}/status$`), (entry) => entry.body?.status === status);
  const stopCalls = (paymentTripId, sequence, status) =>
    callsTo(new RegExp(`^POST /v1/internal/trips/${paymentTripId}/stops/${sequence}/status$`), (entry) => entry.body?.status === status);

  /** Wallet float so cash collections can debit the platform fee (the wallet never goes negative). */
  async function fundWallet(driver) {
    const wallet = (await backend('GET', '/v1/wallet', driver, undefined, [200])).body;
    await backend('POST', `/v1/admin/wallets/${wallet.walletId}/adjustments`, 'admin', {
      direction: 'CREDIT',
      amountPaise: WALLET_FLOAT_PAISE,
      reason: 'Contract E2E: float for the cash platform fees',
    }, [201], { 'idempotency-key': randomUUID() });
  }

  /** The customer pays a collection's QR (simulated provider), confirmed by a signed webhook. */
  async function payQrWithWebhook(collectionId) {
    const view = (await backend('GET', `/v1/admin/collections/${collectionId}`, 'admin', undefined, [200])).body;
    const paid = (await backend('POST', `/v1/dev/simulate/qr-codes/${view.providerReferenceId}/payments`, 'admin', {}, [200])).body;
    const event = JSON.stringify({
      entity: 'event',
      account_id: 'acc_ContractE2E01',
      event: 'qr_code.credited',
      contains: ['payment', 'qr_code'],
      payload: { payment: { entity: paid.payment }, qr_code: { entity: paid.qrCode } },
      created_at: Math.floor(Date.now() / 1000),
    });
    await http(BACKEND, 'POST', '/v1/webhooks/razorpay', {
      body: event,
      headers: {
        'x-razorpay-signature': createHmac('sha256', secrets.razorpayWebhook).update(event).digest('hex'),
        'x-razorpay-event-id': `evt_ct${randomBytes(8).toString('hex')}`,
      },
      expect: [200],
    });
    return paid;
  }

  /** The customer's handover codes, as the Customer app reads them (gated by payment). */
  const customerOtps = async (customer, rideId) => (await engine('GET', `/rides/${rideId}/otps`, customer, undefined, [200])).body;

  // ── 0. Wiring ──────────────────────────────────────────────────────────────────────────────
  await step(0, 'Wiring: both services up, the engine needs a verified token, internal calls carry the key', async () => {
    const health = await engine('GET', '/health', null, undefined, [200]);
    check(health.body.status === 'ok', 'engine health');
    const anonymous = await engine('GET', '/trips/history/customer/x', null, undefined, [401]);
    check(anonymous.body.code === 'AUTH_REQUIRED', 'no token: 401 AUTH_REQUIRED');
    const otherProject = await http(ENGINE, 'GET', `/trips/history/customer/${subjects.customerA}`, {
      token: idp.sign(subjects.customerA, { audience: 'another-project' }),
      expect: [401],
    });
    check(otherProject.body.code === 'AUTH_INVALID_TOKEN', 'a token of another Firebase project: 401');
    await engine('GET', `/trips/history/customer/${subjects.customerA}`, 'customerA', undefined, [200]);
    return { engine: ENGINE, backend: BACKEND };
  });

  // ── Flow A: PAY_AT_PICKUP, cash, 1 drop ───────────────────────────────────────────────────
  const A = {};
  await step('A1', 'PAY_AT_PICKUP cash: the client cannot send a fare; the quote is registered (no amount sent) and offered', async () => {
    const priced = await quote('customerA', [[26.2967, 73.0351]]);
    A.quote = priced;
    await online('driverA');
    const tampered = await engine('POST', '/rides', 'customerA', {
      quoteId: priced.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId: subjects.driverA,
      farePaise: 1,
    }, [400]);
    check(tampered.body.code === 'CLIENT_AMOUNT_REJECTED', 'a ride request with an amount is refused');
    check(callsTo(/^POST \/v1\/internal\/bookings$/).length === 0, 'nothing was registered for it');

    const ride = (await book('customerA', 'driverA', priced.quoteId, 'PAY_AT_PICKUP')).body.ride;
    A.rideId = ride.id;
    A.paymentBookingId = ride.paymentBookingId;
    check(ride.status === 'REQUESTED' && ride.externalRef === `ENG-${ride.id}`, 'ride REQUESTED with its stable reference');
    check(ride.payablePaise === priced.payablePaise, 'the ride shows the quoted amount');
    const registration = callsTo(/^POST \/v1\/internal\/bookings$/)[0];
    check(
      JSON.stringify(Object.keys(registration.body).sort()) ===
        JSON.stringify(['customerSubject', 'externalRef', 'paymentMethod', 'quoteId']) &&
        registration.body.customerSubject === subjects.customerA,
      'registration body is exactly { externalRef, customerSubject, quoteId, paymentMethod }',
    );
    const atBackend = (await remoteByRef(ride.externalRef)).body;
    check(
      atBackend.bookingId === ride.paymentBookingId && atBackend.quoteId === priced.quoteId &&
        atBackend.payablePaise === priced.payablePaise && atBackend.paymentModel === 'QUOTE_PER_STOP' &&
        atBackend.paymentMethod === 'PAY_AT_PICKUP',
      'the backend booking is the quote, frozen, under the engine reference',
    );
    await waitFor('SEARCHING reported', async () => (await remote(A.paymentBookingId)).status === 'SEARCHING_DRIVER');
    return { rideId: ride.id, paymentBookingId: ride.paymentBookingId, payablePaise: priced.payablePaise };
  });

  await step('A2', 'The driver accepts: assigned at the backend first, the payment trip id kept by the engine', async () => {
    const offers = (await engine('GET', `/ride-requests/${subjects.driverA}`, 'driverA', undefined, [200])).body.requests;
    check(offers.length === 1 && offers[0].rideId === A.rideId, 'the offer reaches the requested driver');
    const accepted = (await engine('POST', `/rides/${A.rideId}/accept`, 'driverA', {}, [201])).body;
    A.tripId = accepted.trip.id;
    A.paymentTripId = accepted.trip.paymentTripId;
    const atBackend = await remote(A.paymentBookingId);
    check(atBackend.status === 'DRIVER_ASSIGNED' && atBackend.trip.tripId === A.paymentTripId, 'the backend trip is the engine trip');
    const [trip] = await engineRow('SELECT payment_trip_id FROM engine_trips WHERE id = $1', [A.tripId]);
    check(trip.payment_trip_id === A.paymentTripId, 'the payment trip id is persisted');
    return { tripId: A.tripId, paymentTripId: A.paymentTripId };
  });

  await step('A3', 'Unpaid pickup: arrival reported, the pickup gate holds, no OTP is checked, nothing committed', async () => {
    const arrived = (await engine('POST', `/trips/${A.tripId}/arrive`, 'driverA', {}, [201])).body;
    check(arrived.tripStatus === 'DRIVER_ARRIVED' && arrived.paymentSync === 'DELIVERED', 'arrival delivered to the backend');
    check(
      arrived.paymentGate?.stage === 'PICKUP' && arrived.paymentGate.paymentState === 'PAYMENT_REQUIRED' &&
        arrived.paymentGate.handoverAllowed === false,
      'the backend gate: payment required at the pickup',
    );
    const otps = await storedOtps(A.rideId);
    const refused = (await engine('POST', `/trips/${A.tripId}/pickup/verify-otp`, 'driverA', { otp: otps.pickup }, [409])).body;
    check(
      refused.code === 'PAYMENT_REQUIRED' && refused.details.stage === 'PICKUP' && refused.details.amountPaise === A.quote.payablePaise,
      'even the right OTP: 409 PAYMENT_REQUIRED with the amount owed',
    );
    check(tripStatusCalls(A.paymentTripId, 'PICKUP_VERIFIED').length === 0, 'PICKUP_VERIFIED never sent');
    const withheld = await customerOtps('customerA', A.rideId);
    check(withheld.pickup.otp === null && withheld.pickup.withheld === 'PAYMENT_REQUIRED', "the customer's pickup code is withheld");
    const [trip] = await engineRow('SELECT status FROM engine_trips WHERE id = $1', [A.tripId]);
    check(trip.status === 'DRIVER_ARRIVED', 'the engine trip stays DRIVER_ARRIVED');
  });

  await step('A4', 'Cash at the pickup (backend collection), then the OTP: PICKUP_VERIFIED backend first', async () => {
    await fundWallet('driverA');
    const at = await remote(A.paymentBookingId);
    const cash = (await collect('driverA', A.paymentTripId, { method: 'CASH', amountPaise: at.paymentGate.amountPaise })).body;
    check(cash.status === 'COMPLETED' && cash.bookingPaymentStatus === 'PAID' && cash.paymentGate.handoverAllowed, 'cash collected: PAID');
    const otps = await customerOtps('customerA', A.rideId);
    check(/^\d{4}$/.test(otps.pickup.otp ?? ''), "the customer's pickup code is released once paid");
    const wrong = otps.pickup.otp === '0000' ? '1111' : '0000';
    await engine('POST', `/trips/${A.tripId}/pickup/verify-otp`, 'driverA', { otp: wrong }, [400]);
    const verified = (await engine('POST', `/trips/${A.tripId}/pickup/verify-otp`, 'driverA', { otp: otps.pickup.otp }, [201])).body;
    check(verified.tripStatus === 'PICKUP_VERIFIED' && verified.paymentSync === 'DELIVERED', 'PICKUP_VERIFIED committed after the backend');
    check((await remote(A.paymentBookingId)).trip.status === 'PICKUP_VERIFIED', 'backend trip PICKUP_VERIFIED');
  });

  await step('A5', 'Drop and completion: IN_TRANSIT, drop OTP behind the gate, DELIVERED and COMPLETED backend first', async () => {
    await engine('POST', `/trips/${A.tripId}/start`, 'driverA', {}, [201]);
    const [stop] = (await engine('GET', `/trips/${A.tripId}`, 'driverA', undefined, [200])).body.trip.stops;
    const arrived = (await engine('POST', `/trips/${A.tripId}/stop/arrive`, 'driverA', { stopId: stop.id }, [201])).body;
    check(arrived.paymentGate?.stage === 'DROP' && arrived.paymentGate.handoverAllowed === true, 'paid at pickup: the drop may be handed over');
    const otps = await customerOtps('customerA', A.rideId);
    await engine('POST', `/trips/${A.tripId}/stop/verify-otp`, 'driverA', { stopId: stop.id, otp: otps.stops[0].otp }, [201]);
    const delivered = (await engine('POST', `/trips/${A.tripId}/stop/confirm-delivery`, 'driverA', {
      stopId: stop.id,
      photo: { uri: 'file://contract-a-1.jpg' },
    }, [201])).body;
    check(delivered.tripStatus === 'DELIVERED' && delivered.completedStops === 1, 'engine trip DELIVERED');
    const done = (await engine('POST', `/trips/${A.tripId}/complete`, 'driverA', {}, [201])).body;
    check(done.tripStatus === 'COMPLETED' && done.completion === 'COMPLETED', 'engine trip COMPLETED');
    const atBackend = await remote(A.paymentBookingId);
    check(atBackend.status === 'COMPLETED' && atBackend.paidWith === 'CASH' && atBackend.trip.status === 'COMPLETED', 'backend COMPLETED, paid in cash');
    const repeat = (await engine('POST', `/trips/${A.tripId}/complete`, 'driverA', {}, [201])).body;
    check(repeat.changed === false && tripStatusCalls(A.paymentTripId, 'COMPLETED').length === 1, 'completing again changes nothing');
    return { paidWith: atBackend.paidWith, bookingStatus: atBackend.status };
  });

  // ── Flow B: PAY_AT_PICKUP by QR, 2 drops, outages and duplicates ─────────────────────────
  const B = {};
  await step('B1', 'Lost registration answer: retried with the same external reference, one booking at the backend', async () => {
    const priced = await quote('customerA', [[26.2967, 73.0351], [26.3067, 73.0451]]);
    B.quote = priced;
    await online('driverA');
    proxy.fail({ match: (entry) => entry.method === 'POST' && entry.path === '/v1/internal/bookings', mode: 'DROP_AFTER_APPLY' });
    const lost = await book('customerA', 'driverA', priced.quoteId, 'PAY_AT_PICKUP', [503]);
    check(lost.body.code === 'PAYMENT_BACKEND_UNAVAILABLE', 'no answer: 503, nothing dispatched');
    const [pending] = await engineRow('SELECT id, external_ref, status FROM engine_bookings WHERE quote_id = $1', [priced.quoteId]);
    check(pending.status === 'PENDING_REGISTRATION', 'the engine booking waits for its registration');
    check((await remoteByRef(pending.external_ref)).body.quoteId === priced.quoteId, 'the backend did register it');
    const offersBefore = await engineRow('SELECT id FROM engine_offers WHERE booking_id = $1', [pending.id]);
    check(offersBefore.length === 0, 'not offered before the registration is confirmed');

    const ride = (await book('customerA', 'driverA', priced.quoteId, 'PAY_AT_PICKUP')).body.ride;
    B.rideId = ride.id;
    B.paymentBookingId = ride.paymentBookingId;
    check(ride.id === pending.id && ride.externalRef === pending.external_ref, 'the retry is the same booking');
    const registrations = callsTo(/^POST \/v1\/internal\/bookings$/, (entry) => entry.body?.quoteId === priced.quoteId);
    check(
      registrations.length === 2 && registrations.every((entry) => entry.body.externalRef === pending.external_ref) &&
        registrations[1].status === 200,
      'registered twice with the same reference: the backend answered the replay (200)',
    );
    return { rideId: ride.id, externalRef: ride.externalRef };
  });

  await step('B2', 'Lost assignment answer: accepted, then the outbox delivers ASSIGN again (repeat) and keeps the trip id', async () => {
    proxy.fail({ match: (entry) => entry.path === `/v1/internal/bookings/${B.paymentBookingId}/assign`, mode: 'DROP_AFTER_APPLY' });
    const accepted = (await engine('POST', `/rides/${B.rideId}/accept`, 'driverA', {}, [201])).body;
    B.tripId = accepted.trip.id;
    check(accepted.paymentSync === 'PENDING', 'accepted; the assignment answer is still unknown');
    const [trip] = await waitFor('ASSIGN re-delivered by the outbox', async () => {
      const rows = await engineRow('SELECT payment_trip_id FROM engine_trips WHERE id = $1', [B.tripId]);
      return rows[0]?.payment_trip_id ? rows : null;
    });
    B.paymentTripId = trip.payment_trip_id;
    const assigns = callsTo(new RegExp(`^POST /v1/internal/bookings/${B.paymentBookingId}/assign$`));
    check(assigns.length >= 2 && assigns.at(-1).status === 200, 'ASSIGN sent again; the backend answered the repeat');
    check((await remote(B.paymentBookingId)).trip.tripId === B.paymentTripId, 'one trip at the backend');
    return { paymentTripId: B.paymentTripId, assignAttempts: assigns.length };
  });

  await step('B3', 'Backend down while the driver arrives, engine crash meanwhile: the arrival is delivered after the restart', async () => {
    const arrivalPath = `/v1/internal/trips/${B.paymentTripId}/status`;
    proxy.fail({ match: (entry) => entry.path === arrivalPath, mode: 'STATUS_503', times: 1_000 });
    const arrived = (await engine('POST', `/trips/${B.tripId}/arrive`, 'driverA', {}, [201])).body;
    check(arrived.tripStatus === 'DRIVER_ARRIVED' && arrived.paymentSync === 'PENDING', 'committed in the engine, not delivered yet');
    await waitFor('a background retry', async () => tripStatusCalls(B.paymentTripId, 'DRIVER_ARRIVED').length >= 2);
    await stopProcess('engine'); // a crash: the process is terminated
    proxy.clear();
    check((await remote(B.paymentBookingId)).trip.status === 'DRIVER_ASSIGNED', 'the backend does not know yet');
    await startEngine();
    await waitFor('the restarted engine delivers the arrival', async () => (await remote(B.paymentBookingId)).trip.status === 'DRIVER_ARRIVED');
    const [record] = await engineRow(
      `SELECT status, attempts FROM engine_outbox WHERE booking_id = $1 AND payload->>'status' = 'DRIVER_ARRIVED'`,
      [B.rideId],
    );
    // At least the refused first attempt and the delivery (an attempt cut by the crash may not
    // have been recorded).
    check(record.status === 'DELIVERED' && record.attempts >= 2, 'the same outbox record, retried until delivered');
    return { attempts: record.attempts };
  });

  await step('B4', 'Pickup QR: unpaid while the QR is open; paid by a signed qr_code.credited; duplicate verifications commit once', async () => {
    const at = await remote(B.paymentBookingId);
    const qr = (await collect('driverA', B.paymentTripId, { method: 'ONLINE_QR', amountPaise: at.paymentGate.amountPaise })).body;
    check(qr.status === 'PENDING' && qr.paymentGate.paymentState === 'PAYMENT_PROCESSING', 'QR shown, payment processing');
    const otps = await storedOtps(B.rideId);
    const early = (await engine('POST', `/trips/${B.tripId}/pickup/verify-otp`, 'driverA', { otp: otps.pickup }, [409])).body;
    check(early.code === 'PAYMENT_REQUIRED' && early.details.paymentState === 'PAYMENT_PROCESSING', 'no handover while the QR is unpaid');
    await payQrWithWebhook(qr.collectionId);
    await waitFor('booking PAID by the QR', async () => (await remote(B.paymentBookingId)).paymentStatus === 'PAID');
    const results = await Promise.all([0, 1, 2].map(() =>
      http(ENGINE, 'POST', `/trips/${B.tripId}/pickup/verify-otp`, { token: token.driverA, body: { otp: otps.pickup }, expect: [201] })));
    check(results.every((result) => result.body.tripStatus === 'PICKUP_VERIFIED'), 'every duplicate answers PICKUP_VERIFIED');
    check(tripStatusCalls(B.paymentTripId, 'PICKUP_VERIFIED').length === 1, 'PICKUP_VERIFIED sent to the backend once');
    check((await remote(B.paymentBookingId)).trip.status === 'PICKUP_VERIFIED', 'backend trip PICKUP_VERIFIED');
  });

  await step('B5', 'Drop 1: duplicate arrivals reported once; the delivery answer is lost, the retry is a repeat at the backend', async () => {
    await engine('POST', `/trips/${B.tripId}/start`, 'driverA', {}, [201]);
    const stops = (await engine('GET', `/trips/${B.tripId}`, 'driverA', undefined, [200])).body.trip.stops;
    B.stopIds = stops.map((stop) => stop.id);
    await Promise.all([0, 1, 2].map(() =>
      http(ENGINE, 'POST', `/trips/${B.tripId}/stop/arrive`, { token: token.driverA, body: { stopId: B.stopIds[0] }, expect: [201] })));
    check(stopCalls(B.paymentTripId, 1, 'ARRIVED').length === 1, 'drop 1 ARRIVED reported once');
    const otps = await customerOtps('customerA', B.rideId);
    await engine('POST', `/trips/${B.tripId}/stop/verify-otp`, 'driverA', { stopId: B.stopIds[0], otp: otps.stops[0].otp }, [201]);
    proxy.fail({ match: (entry) => entry.path === `/v1/internal/trips/${B.paymentTripId}/stops/1/status`, mode: 'DROP_AFTER_APPLY' });
    const photo = { stopId: B.stopIds[0], photo: { uri: 'file://contract-b-1.jpg' } };
    await engine('POST', `/trips/${B.tripId}/stop/confirm-delivery`, 'driverA', photo, [503]);
    check((await remote(B.paymentBookingId)).stops[0].status === 'DELIVERED', 'applied at the backend');
    const [before] = await engineRow('SELECT status FROM engine_stops WHERE id = $1', [B.stopIds[0]]);
    // The outbox may have re-sent it already; either way the engine applies the answer once.
    const retried = (await engine('POST', `/trips/${B.tripId}/stop/confirm-delivery`, 'driverA', photo, [201])).body;
    check(retried.completedStops === 1 && retried.currentStopIndex === 1, 'drop 1 delivered once in the engine');
    const sends = stopCalls(B.paymentTripId, 1, 'DELIVERED');
    check(sends.length >= 2 && sends.at(-1).status === 200, 'DELIVERED sent again; the backend answered the repeat');
    const records = await engineRow(
      `SELECT status FROM engine_outbox WHERE booking_id = $1 AND kind = 'STOP_STATUS' AND payload->>'status' = 'DELIVERED'`,
      [B.rideId],
    );
    check(records.length === 1 && records[0].status === 'DELIVERED', 'one outbox record for the delivery');
    return { engineStopBeforeRetry: before.status, deliverySends: sends.length };
  });

  await step('B6', 'Drop 2: failed with a reason, retried by the driver, delivered; completion backend first (paid by QR)', async () => {
    await engine('POST', `/trips/${B.tripId}/stop/arrive`, 'driverA', { stopId: B.stopIds[1] }, [201]);
    await engine('POST', `/trips/${B.tripId}/stop/fail`, 'driverA', { stopId: B.stopIds[1] }, [400]);
    const failed = (await engine('POST', `/trips/${B.tripId}/stop/fail`, 'driverA', {
      stopId: B.stopIds[1],
      reason: 'Receiver not at the address',
    }, [201])).body;
    check(failed.paymentSync === 'DELIVERED' && failed.stop.status === 'DELIVERY_FAILED', 'failure reported');
    check((await remote(B.paymentBookingId)).stops[1].status === 'DELIVERY_FAILED', 'backend drop 2 DELIVERY_FAILED');
    check(stopCalls(B.paymentTripId, 2, 'DELIVERY_FAILED')[0].body.reason === 'Receiver not at the address', 'the reason reached the backend');
    await engine('POST', `/trips/${B.tripId}/complete`, 'driverA', {}, [400]);
    const again = (await engine('POST', `/trips/${B.tripId}/stop/arrive`, 'driverA', { stopId: B.stopIds[1] }, [201])).body;
    check(again.stop.status === 'ARRIVED' && (await remote(B.paymentBookingId)).stops[1].status === 'ARRIVED', 'the retry: ARRIVED at both');
    const otps = await customerOtps('customerA', B.rideId);
    await engine('POST', `/trips/${B.tripId}/stop/verify-otp`, 'driverA', { stopId: B.stopIds[1], otp: otps.stops[1].otp }, [201]);
    await engine('POST', `/trips/${B.tripId}/stop/confirm-delivery`, 'driverA', {
      stopId: B.stopIds[1],
      photo: { uri: 'file://contract-b-2.jpg' },
    }, [201]);
    const done = (await engine('POST', `/trips/${B.tripId}/complete`, 'driverA', {}, [201])).body;
    check(done.tripStatus === 'COMPLETED', 'engine COMPLETED');
    const atBackend = await remote(B.paymentBookingId);
    check(atBackend.status === 'COMPLETED' && atBackend.paidWith === 'ONLINE_QR', 'backend COMPLETED, paid by QR');
    return { paidWith: atBackend.paidWith };
  });

  // ── Flow C: PAY_AT_DELIVERY, 3 drops ──────────────────────────────────────────────────────
  const C = {};
  await step('C1', 'Fake customer refused by the backend (nothing dispatched); concurrent confirmations: one booking', async () => {
    const priced = await quote('customerB', [[26.2967, 73.0351], [26.3067, 73.0451], [26.3167, 73.0551]]);
    C.quote = priced;
    await online('driverB');
    const fake = await book('fakeCustomer', 'driverB', priced.quoteId, 'PAY_AT_DELIVERY', [422]);
    check(['CUSTOMER_NOT_FOUND', 'QUOTE_NOT_FOUND'].includes(fake.body.code), `fake customer refused (${fake.body.code})`);
    const [failed] = await engineRow('SELECT status, payment_booking_id FROM engine_bookings WHERE customer_subject = $1', [subjects.fakeCustomer]);
    check(failed.status === 'REGISTRATION_FAILED' && failed.payment_booking_id === null, 'recorded as refused, never offered');

    const results = await Promise.all([0, 1, 2].map(() => book('customerB', 'driverB', priced.quoteId, 'PAY_AT_DELIVERY')));
    const ids = new Set(results.map((result) => result.body.ride.id));
    check(ids.size === 1, 'every duplicate confirmation is the same ride');
    const ride = results[0].body.ride;
    C.rideId = ride.id;
    C.paymentBookingId = ride.paymentBookingId;
    check((await remoteByRef(ride.externalRef)).body.bookingId === ride.paymentBookingId, 'one booking at the backend');
    const owned = await engineRow('SELECT id FROM engine_bookings WHERE quote_id = $1 AND customer_subject = $2', [priced.quoteId, subjects.customerB]);
    check(owned.length === 1, 'one engine booking for the customer and quote');
    return { rideId: C.rideId, fakeCustomerCode: fake.body.code };
  });

  await step('C2', 'Fake and unapproved drivers refused by the backend: trip closed, driver freed, booking offered again', async () => {
    await engine('POST', `/rides/${C.rideId}/reject`, 'driverB', {}, [201]);
    for (const [driver, status, code] of [
      ['fakeDriver', 422, 'DRIVER_NOT_FOUND'],
      ['driverPending', 422, 'DRIVER_NOT_APPROVED'],
    ]) {
      await online(driver);
      await book('customerB', driver, C.quote.quoteId, 'PAY_AT_DELIVERY');
      const refused = await engine('POST', `/rides/${C.rideId}/accept`, driver, {}, [status]);
      check(refused.body.code === code, `${driver}: ${code}`);
      const ride = (await engine('GET', `/rides/${C.rideId}`, 'customerB', undefined, [200])).body.ride;
      check(ride.bookingStatus === 'OPEN' && ride.tripId === null, 'booking open again, no live trip');
    }
    check((await remote(C.paymentBookingId)).trip === null, 'no trip at the backend');
    const cancelled = await engineRow(`SELECT cancelled_by FROM engine_trips WHERE booking_id = $1`, [C.rideId]);
    check(cancelled.length === 2 && cancelled.every((row) => row.cancelled_by === 'SYSTEM'), 'both refused trips closed by the system');
  });

  await step('C3', 'Concurrent acceptances by the approved driver: one trip at the backend', async () => {
    await online('driverB');
    await book('customerB', 'driverB', C.quote.quoteId, 'PAY_AT_DELIVERY');
    const results = await Promise.all([0, 1, 2].map(() =>
      http(ENGINE, 'POST', `/rides/${C.rideId}/accept`, { token: token.driverB, body: {}, expect: [201] })));
    check(new Set(results.map((result) => result.body.trip.id)).size === 1, 'every acceptance is the same trip');
    C.tripId = results[0].body.trip.id;
    const [trip] = await waitFor('trip assigned', async () => {
      const rows = await engineRow('SELECT payment_trip_id FROM engine_trips WHERE id = $1', [C.tripId]);
      return rows[0]?.payment_trip_id ? rows : null;
    });
    C.paymentTripId = trip.payment_trip_id;
    const assigned = callsTo(new RegExp(`^POST /v1/internal/bookings/${C.paymentBookingId}/assign$`), (entry) => entry.status === 200);
    check(assigned.length === 1 && (await remote(C.paymentBookingId)).trip.tripId === C.paymentTripId, 'assigned once');
  });

  await step('C4', 'Pay at delivery: the pickup needs no payment; a refused internal key is retried, never trusted', async () => {
    const otps = await customerOtps('customerB', C.rideId);
    check(/^\d{4}$/.test(otps.pickup.otp ?? '') && otps.stops.every((stop) => stop.withheld === 'PAYMENT_REQUIRED'),
      'pickup code shown; every drop code withheld');
    await engine('POST', `/trips/${C.tripId}/arrive`, 'driverB', {}, [201]);
    proxy.fail({ match: (entry) => entry.method === 'GET' && entry.path === `/v1/internal/bookings/${C.paymentBookingId}`, mode: 'BAD_KEY' });
    const refusedKey = await engine('POST', `/trips/${C.tripId}/pickup/verify-otp`, 'driverB', { otp: otps.pickup.otp }, [503]);
    check(refusedKey.body.code === 'PAYMENT_BACKEND_UNAVAILABLE', 'the backend refused the key: 503, nothing committed');
    check(proxy.calls.some((entry) => entry.fault === 'BAD_KEY' && entry.status === 401), 'the real backend answered 401');
    const verified = (await engine('POST', `/trips/${C.tripId}/pickup/verify-otp`, 'driverB', { otp: otps.pickup.otp }, [201])).body;
    check(verified.tripStatus === 'PICKUP_VERIFIED', 'PICKUP_VERIFIED without any payment');
    const atBackend = await remote(C.paymentBookingId);
    check(atBackend.paymentStatus === 'UNPAID' && atBackend.trip.status === 'PICKUP_VERIFIED', 'backend: picked up, unpaid');
    await engine('POST', `/trips/${C.tripId}/start`, 'driverB', {}, [201]);
    C.stopIds = (await engine('GET', `/trips/${C.tripId}`, 'driverB', undefined, [200])).body.trip.stops.map((stop) => stop.id);
  });

  await step('C5', 'Drop 1 in cash: unpaid drop blocked (409, no OTP check, no delivery), paid in cash, delivered', async () => {
    const arrived = (await engine('POST', `/trips/${C.tripId}/stop/arrive`, 'driverB', { stopId: C.stopIds[0] }, [201])).body;
    const owed = C.quote.drops[0].payablePaise;
    check(
      arrived.paymentGate.stage === 'DROP' && arrived.paymentGate.stopSequence === 1 &&
        arrived.paymentGate.amountPaise === owed && arrived.paymentGate.handoverAllowed === false,
      "the backend asks for drop 1's amount",
    );
    const stored = await storedOtps(C.rideId);
    const blocked = (await engine('POST', `/trips/${C.tripId}/stop/verify-otp`, 'driverB', { stopId: C.stopIds[0], otp: stored.stops[0] }, [409])).body;
    check(blocked.code === 'PAYMENT_REQUIRED' && blocked.details.stopSequence === 1, 'unpaid drop: 409 PAYMENT_REQUIRED');
    await engine('POST', `/trips/${C.tripId}/stop/confirm-delivery`, 'driverB', {
      stopId: C.stopIds[0],
      photo: { uri: 'file://contract-c-1.jpg' },
    }, [400]);
    check(stopCalls(C.paymentTripId, 1, 'DELIVERED').length === 0, 'an unpaid drop is never reported delivered');
    await fundWallet('driverB');
    const cash = (await collect('driverB', C.paymentTripId, { method: 'CASH', amountPaise: owed, stopSequence: 1 })).body;
    check(cash.status === 'COMPLETED' && cash.paymentGate.handoverAllowed === true, 'drop 1 paid in cash');
    const otps = await customerOtps('customerB', C.rideId);
    check(otps.stops[0].otp === stored.stops[0] && otps.stops[1].withheld === 'PAYMENT_REQUIRED', "drop 1's code released, drop 2's not");
    await engine('POST', `/trips/${C.tripId}/stop/verify-otp`, 'driverB', { stopId: C.stopIds[0], otp: otps.stops[0].otp }, [201]);
    await engine('POST', `/trips/${C.tripId}/stop/confirm-delivery`, 'driverB', {
      stopId: C.stopIds[0],
      photo: { uri: 'file://contract-c-1.jpg' },
    }, [201]);
    check((await remote(C.paymentBookingId)).stops[0].status === 'DELIVERED', 'backend drop 1 DELIVERED');
  });

  await step('C6', 'Drop 2 by QR (driver refresh re-reads the provider), delivered', async () => {
    await engine('POST', `/trips/${C.tripId}/stop/arrive`, 'driverB', { stopId: C.stopIds[1] }, [201]);
    const owed = C.quote.drops[1].payablePaise;
    const qr = (await collect('driverB', C.paymentTripId, { method: 'ONLINE_QR', amountPaise: owed, stopSequence: 2 })).body;
    const view = (await backend('GET', `/v1/admin/collections/${qr.collectionId}`, 'admin', undefined, [200])).body;
    await backend('POST', `/v1/dev/simulate/qr-codes/${view.providerReferenceId}/payments`, 'admin', {}, [200]);
    const polled = (await backend('GET', `/v1/trips/${C.paymentTripId}/collections/${qr.collectionId}`, 'driverB', undefined, [200])).body;
    check(polled.status === 'COMPLETED' && polled.paymentGate.handoverAllowed === true, 'drop 2 paid by QR');
    const otps = await customerOtps('customerB', C.rideId);
    await engine('POST', `/trips/${C.tripId}/stop/verify-otp`, 'driverB', { stopId: C.stopIds[1], otp: otps.stops[1].otp }, [201]);
    await engine('POST', `/trips/${C.tripId}/stop/confirm-delivery`, 'driverB', {
      stopId: C.stopIds[1],
      photo: { uri: 'file://contract-c-2.jpg' },
    }, [201]);
    check((await remote(C.paymentBookingId)).stops[1].status === 'DELIVERED', 'backend drop 2 DELIVERED');
  });

  await step('C7', "Drop 3 failed; the admin closes it UNDELIVERED at the backend; the engine follows; completion", async () => {
    await engine('POST', `/trips/${C.tripId}/stop/arrive`, 'driverB', { stopId: C.stopIds[2] }, [201]);
    await engine('POST', `/trips/${C.tripId}/stop/fail`, 'driverB', { stopId: C.stopIds[2], reason: 'Shop closed for the day' }, [201]);
    const waiting = (await engine('POST', `/trips/${C.tripId}/refresh`, 'driverB', {}, [201])).body;
    check(waiting.trip.stops[2].status === 'DELIVERY_FAILED', 'the engine never closes a drop on its own');
    const resolved = (await backend('POST', `/v1/admin/bookings/${C.paymentBookingId}/stops/3/resolve`, 'admin', {
      resolution: 'UNDELIVERED',
      reason: 'Contract E2E: receiver shop closed, goods returned',
    }, [200])).body;
    check(resolved.stop.status === 'UNDELIVERED', 'admin resolution at the backend');
    const followed = (await engine('POST', `/trips/${C.tripId}/refresh`, 'driverB', {}, [201])).body;
    check(followed.trip.stops[2].status === 'UNDELIVERED' && followed.trip.status === 'DELIVERED', 'the engine follows: UNDELIVERED, trip DELIVERED');
    const done = (await engine('POST', `/trips/${C.tripId}/complete`, 'driverB', {}, [201])).body;
    check(done.tripStatus === 'COMPLETED', 'engine COMPLETED with every drop final');
    const atBackend = await remote(C.paymentBookingId);
    check(
      atBackend.status === 'COMPLETED' && atBackend.paymentStatus === 'PARTIALLY_PAID' && atBackend.paidWith === 'MIXED',
      'backend COMPLETED: two drops paid (cash + QR), one undelivered',
    );
    return { paymentStatus: atBackend.paymentStatus, paidWith: atBackend.paidWith };
  });

  // ── Security sweep ────────────────────────────────────────────────────────────────────────
  await step('S1', 'Security: removed bypass routes, other drivers, and every call the engine made', async () => {
    await engine('POST', `/trips/${C.tripId}/pickup/confirm`, 'driverB', {}, [404]);
    await engine('POST', `/rides/${C.rideId}/verify-otp`, 'driverB', { otp: '1234' }, [404]);
    const other = await engine('POST', `/trips/${A.tripId}/arrive`, 'driverB', {}, [403]);
    check(other.status === 403, "another driver's trip: 403");
    await engine('GET', `/rides/${A.rideId}/otps`, 'customerB', undefined, [404]);
    await engine('GET', `/rides/${A.rideId}/otps`, 'driverA', undefined, [404]);

    const allowed = [
      /^GET \/v1\/internal\/fare-quotes\/[0-9a-f-]{36}$/,
      /^POST \/v1\/internal\/bookings$/,
      /^GET \/v1\/internal\/bookings\/[0-9a-f-]{36}$/,
      /^POST \/v1\/internal\/bookings\/[0-9a-f-]{36}\/(searching|assign|cancel)$/,
      /^POST \/v1\/internal\/trips\/[0-9a-f-]{36}\/status$/,
      /^POST \/v1\/internal\/trips\/[0-9a-f-]{36}\/stops\/\d+\/status$/,
    ];
    const amountKey = /paise|fare|amount|fee|tax|price|paid|collection|refund|payout|earning/i;
    const keys = (value, found = []) => {
      if (Array.isArray(value)) value.forEach((item) => keys(item, found));
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { found.push(key); keys(item, found); }
      return found;
    };
    for (const entry of proxy.calls) {
      check(allowed.some((pattern) => pattern.test(`${entry.method} ${entry.path}`)), `internal API only: ${entry.method} ${entry.path}`);
      check(entry.keyPresent, 'every engine call carries the internal key');
      check(/^[A-Za-z0-9._-]{8,64}$/.test(entry.requestId ?? ''), 'every engine call carries a valid X-Request-Id');
      check(keys(entry.body ?? {}).filter((key) => amountKey.test(key)).length === 0, `no amount sent: ${entry.method} ${entry.path}`);
      check(!JSON.stringify(entry.body ?? {}).includes('PAYMENT_CONFIRMED'), 'PAYMENT_CONFIRMED is never sent by the engine');
    }
    const outbox = await engineRow(`SELECT status, count(*)::int AS n FROM engine_outbox GROUP BY status ORDER BY status`);
    check(!outbox.some((row) => row.status === 'PENDING'), 'nothing left pending in the outbox');
    return { engineCalls: proxy.calls.length, outbox };
  });

  report.ids = {
    flowA: { rideId: A.rideId, paymentBookingId: A.paymentBookingId },
    flowB: { rideId: B.rideId, paymentBookingId: B.paymentBookingId },
    flowC: { rideId: C.rideId, paymentBookingId: C.paymentBookingId },
  };
  return setup;
}

async function shutdown() {
  await stopProcess('engine');
  await stopProcess('backend');
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  if (engineDb) {
    await engineDb.end().catch(() => undefined);
  }
}

const reportFile = path.join(tmpdir(), 'multipleride-contract-e2e-report.json');
main()
  .then(async (setup) => {
    await shutdown();
    report.result = 'PASS';
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    if (!KEEP) {
      await dropDatabases(setup);
      for (const file of Object.values(logs ?? {})) {
        rmSync(file, { force: true });
      }
    }
    console.log(`\nContract E2E PASSED: ${report.steps.length} steps, ${report.checks} checks. Report: ${reportFile}`);
    console.log(KEEP ? 'Databases and logs kept (--keep).' : `Databases ${BACKEND_DATABASE} and ${ENGINE_DATABASE} dropped.`);
  })
  .catch(async (error) => {
    await shutdown();
    report.result = 'FAIL';
    report.error = error.message;
    report.logs = logs;
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.error(`\nContract E2E FAILED: ${error.message}\nReport: ${reportFile}; logs and databases kept for diagnosis.`);
    process.exitCode = 1;
  });
