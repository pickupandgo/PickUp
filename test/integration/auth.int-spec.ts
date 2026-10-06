import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { bearer, createAdmin, createDriver, uniqueSubject } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';

describe('Authentication and authorization', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('serves health checks without authentication', async () => {
    await request(ctx.server).get('/health/live').expect(200, { status: 'ok' });
    await request(ctx.server).get('/health/ready').expect(200, { status: 'ok' });
  });

  it('requires a token on wallet routes', async () => {
    const res = await request(ctx.server).get('/v1/wallet').expect(401);
    expect(res.body.error).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it.each(['Basic dXNlcjpwYXNz', 'Bearer not-a-jwt', 'Bearer a.b.c', 'Bearer'])(
    'rejects the authorization header %p',
    async (header) => {
      const res = await request(ctx.server)
        .get('/v1/wallet')
        .set('Authorization', header)
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
    },
  );

  it('rejects tokens issued for another Firebase project', async () => {
    const driver = await createDriver(ctx);
    const token = ctx.tokens.sign(driver.subject, { audience: 'someone-elses-project' });
    const res = await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects expired tokens', async () => {
    const driver = await createDriver(ctx);
    const token = ctx.tokens.sign(driver.subject, { expiresInSeconds: -60 });
    await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(401);
  });

  it('rejects tokens signed by an unknown key under a trusted kid', async () => {
    const driver = await createDriver(ctx);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = ctx.tokens.sign(driver.subject, { privateKey });
    await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(401);
  });

  it('rejects verified identities that were never provisioned', async () => {
    const token = ctx.tokens.sign(uniqueSubject('stranger'));
    const res = await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(403);
    expect(res.body.error.code).toBe('USER_NOT_PROVISIONED');
  });

  it('rejects suspended accounts immediately, even with a valid token', async () => {
    const driver = await createDriver(ctx, { status: 'SUSPENDED' });
    const res = await request(ctx.server).get('/v1/wallet').set(bearer(driver.token)).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('lets a driver read their own wallet, created on first access', async () => {
    const driver = await createDriver(ctx);
    const res = await request(ctx.server).get('/v1/wallet').set(bearer(driver.token)).expect(200);
    expect(res.body).toMatchObject({ balancePaise: 0, currency: 'INR', status: 'ACTIVE' });
  });

  it('forbids drivers from admin routes', async () => {
    const driver = await createDriver(ctx);
    const res = await request(ctx.server)
      .get('/v1/admin/reconciliation/wallet-mismatches')
      .set(bearer(driver.token))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('forbids admins without a driver profile from driver routes', async () => {
    const admin = await createAdmin(ctx);
    await request(ctx.server).get('/v1/wallet').set(bearer(admin.token)).expect(403);
  });

  it('lets admins use admin routes', async () => {
    const admin = await createAdmin(ctx);
    await request(ctx.server)
      .get('/v1/admin/reconciliation/wallet-mismatches')
      .set(bearer(admin.token))
      .expect(200);
  });

  it('returns unknown routes as 404 in the standard error shape', async () => {
    const res = await request(ctx.server).get('/v1/nothing-here').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON without echoing it back, still with a request id', async () => {
    const driver = await createDriver(ctx);
    const res = await request(ctx.server)
      .post('/v1/wallet/topups')
      .set(bearer(driver.token))
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'malformed-json-key-0001')
      .send('{"amountPaise": 100, "secret": "do-not-echo"')
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('do-not-echo');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(ctx.server)
      .post('/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(150_000) }))
      .expect(413);
    expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it('reuses a safe X-Request-Id from the caller and replaces an unsafe one', async () => {
    const safe = await request(ctx.server)
      .get('/health/live')
      .set('X-Request-Id', 'trace-abc-12345');
    expect(safe.headers['x-request-id']).toBe('trace-abc-12345');

    const unsafe = await request(ctx.server)
      .get('/health/live')
      .set('X-Request-Id', 'bad id\twith spaces');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(ctx.server).get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('tells every client not to store responses and never answers 304', async () => {
    const driver = await createDriver(ctx);
    const first = await request(ctx.server).get('/v1/wallet').set(bearer(driver.token)).expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers.etag).toBeUndefined();

    // A client sending an old validator still gets the full, current body.
    const again = await request(ctx.server)
      .get('/v1/wallet')
      .set(bearer(driver.token))
      .set('If-None-Match', 'W/"stale-copy"')
      .expect(200);
    expect(again.body.walletId).toBe(first.body.walletId);
    expect(again.headers['cache-control']).toBe('no-store');

    const rejected = await request(ctx.server).get('/v1/wallet').expect(401);
    expect(rejected.headers['cache-control']).toBe('no-store');
  });
});
