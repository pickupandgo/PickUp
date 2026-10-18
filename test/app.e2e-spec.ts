import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { get, people, post } from './helpers/flows';
import { createTestApp, type TestContext } from './helpers/test-app';

/**
 * The engine's HTTP surface. Phase 8 change: every route except the health check and the
 * non-authoritative fare estimates needs a verified Firebase ID token (the prototype had no
 * authentication at all, so the old "GET / returns Hello World" test is kept and extended).
 */
describe('Engine HTTP surface and authentication (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET / and GET /health are public', async () => {
    await request(ctx.server).get('/').expect(200).expect('Hello World!');
    const health = await request(ctx.server).get('/health').expect(200);
    expect(health.body).toEqual({ status: 'ok' });
  });

  it('keeps the fare estimates public and marked non-authoritative (never used for a booking)', async () => {
    const estimate = await request(ctx.server)
      .get('/fare/estimate')
      .query({
        pickupLat: 26.2967,
        pickupLng: 73.0351,
        dropLat: 26.3067,
        dropLng: 73.0451,
      })
      .expect(200);
    expect(estimate.body.success).toBe(true);
  });

  it.each([
    ['GET', '/rides/00000000-0000-4000-8000-000000000000'],
    ['POST', '/rides'],
    ['GET', '/trips/00000000-0000-4000-8000-000000000000'],
    ['POST', '/trips/00000000-0000-4000-8000-000000000000/arrive'],
    ['GET', '/drivers'],
    ['GET', '/ride-requests/someone'],
  ])(
    'refuses %s %s without a token (401 AUTH_REQUIRED)',
    async (method, path) => {
      const response =
        method === 'GET'
          ? await request(ctx.server).get(path)
          : await request(ctx.server).post(path).send({});
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
      });
    },
  );

  describe('refuses tokens that are not valid Firebase ID tokens (401 AUTH_INVALID_TOKEN)', () => {
    const subject = 'cust-auth-check';
    const otherKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey;

    it.each<[string, () => string]>([
      ['not a bearer token', () => 'Basic abc'],
      ['a malformed token', () => 'Bearer not-a-jwt'],
      [
        'a token signed by another key',
        () => ctx.tokens.bearer(subject, { privateKey: otherKey }),
      ],
      [
        'a token with an unknown key id',
        () => ctx.tokens.bearer(subject, { kid: 'unknown-kid' }),
      ],
      [
        'a token for another Firebase project',
        () => ctx.tokens.bearer(subject, { audience: 'another-project' }),
      ],
      [
        'a token from another issuer',
        () =>
          ctx.tokens.bearer(subject, {
            issuer: 'https://securetoken.google.com/another-project',
          }),
      ],
      [
        'an expired token',
        () => ctx.tokens.bearer(subject, { expiresInSeconds: -60 }),
      ],
    ])('%s', async (_label, header) => {
      const response = await request(ctx.server)
        .get('/trips/history/customer/cust-auth-check')
        .set('Authorization', header());
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('a token with an invalid subject', async () => {
      const response = await request(ctx.server)
        .get('/trips/history/customer/x')
        .set('Authorization', ctx.tokens.bearer('not a valid subject!'));
      expect(response.status).toBe(401);
    });
  });

  it('accepts a valid token and takes the identity from it', async () => {
    const { customer } = people('auth');
    const history = await get(
      ctx,
      `/trips/history/customer/${customer}`,
      customer,
    ).expect(200);
    expect(history.body).toEqual({ success: true, trips: [] });
    // Someone else's history: the path id must be the signed-in user.
    const other = await get(
      ctx,
      `/trips/history/customer/${customer}`,
      'cust-other',
    );
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('IDENTITY_MISMATCH');
  });

  it('answers with the engine error shape { statusCode, error, code, message }', async () => {
    const { customer } = people('shape');
    const response = await post(ctx, '/rides', customer, { quoteId: 'nope' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
    });
  });
});
