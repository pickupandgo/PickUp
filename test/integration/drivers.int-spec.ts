import request from 'supertest';
import {
  bearer,
  createCustomer,
  createDriver,
  uniquePhone,
  uniqueSubject,
} from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Driver self-bootstrap is deliberately body-free in the mobile flow: identity facts come from
 * the verified Firebase token and the database function creates the driver wallet atomically.
 */
describe('Driver self-registration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const register = (token: string, body: object = {}) =>
    request(ctx.server).post('/v1/drivers/me').set(bearer(token)).send(body);

  function signIn(options: { phoneNumber?: string; subject?: string } = {}) {
    const subject = options.subject ?? uniqueSubject('driver-bootstrap');
    const phone = options.phoneNumber ?? uniquePhone();
    return { subject, phone, token: ctx.tokens.sign(subject, { phoneNumber: phone }) };
  }

  it('creates a PENDING driver, identity, and zero-balance wallet from a verified token', async () => {
    const driver = signIn();
    const created = await register(driver.token).expect(201);
    expect(created.body).toMatchObject({ phone: driver.phone, approvalStatus: 'PENDING' });

    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { phone: driver.phone },
      include: { authIdentities: true, driver: { include: { wallet: true } } },
    });
    expect(row).toMatchObject({ role: 'DRIVER', status: 'ACTIVE' });
    expect(row.authIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'firebase', subject: driver.subject }),
      ]),
    );
    expect(row.driver).toMatchObject({ approvalStatus: 'PENDING' });
    expect(row.driver?.wallet?.balancePaise).toBe(0n);
  });

  it('returns an existing driver safely without duplicate rows', async () => {
    const driver = signIn();
    const first = await register(driver.token).expect(201);
    const second = await register(driver.token).expect(200);
    expect(second.body.driverId).toBe(first.body.driverId);
    expect(await ctx.prisma.user.count({ where: { phone: driver.phone } })).toBe(1);
  });

  it('refuses a customer identity at the driver bootstrap endpoint', async () => {
    const customer = await createCustomer(ctx);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: customer.userId } });
    const token = ctx.tokens.sign(customer.subject, { phoneNumber: user.phone });
    const refused = await register(token).expect(409);
    expect(refused.body.error.code).toBe('ACCOUNT_ROLE_CONFLICT');
  });

  it('settles concurrent bootstrap attempts to one driver account', async () => {
    const driver = signIn();
    const results = await Promise.all(Array.from({ length: 8 }, () => register(driver.token)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.every((result) => result.status === 200 || result.status === 201)).toBe(true);
    expect(new Set(results.map((result) => result.body.driverId as string)).size).toBe(1);
    expect(await ctx.prisma.user.count({ where: { phone: driver.phone } })).toBe(1);
  });

  it('requires the verified Firebase phone claim', async () => {
    const subject = uniqueSubject('missing-phone');
    const token = ctx.tokens.sign(subject, { signInProvider: 'google.com' });
    const refused = await register(token).expect(403);
    expect(refused.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
    expect(
      await ctx.prisma.authIdentity.findUnique({
        where: { provider_subject: { provider: 'firebase', subject } },
      }),
    ).toBeNull();
  });

  it('refuses a driver identity at the customer bootstrap endpoint', async () => {
    const driver = await createDriver(ctx);
    const token = ctx.tokens.sign(driver.subject, { phoneNumber: driver.phone });
    const refused = await request(ctx.server)
      .post('/v1/customers/me')
      .set(bearer(token))
      .send()
      .expect(409);
    expect(refused.body.error.code).toBe('ACCOUNT_ROLE_CONFLICT');
  });

  it('keeps manual KYC fail-closed when policy, storage, and scanning are not configured', async () => {
    const driver = await createDriver(ctx, { approved: false });
    const summary = await request(ctx.server)
      .get('/v1/drivers/me/onboarding')
      .set(bearer(driver.token))
      .expect(200);
    expect(summary.body).toMatchObject({ driverId: driver.driverId, eligible: false });

    const first = await request(ctx.server)
      .post('/v1/drivers/me/onboarding/kyc')
      .set(bearer(driver.token))
      .send()
      .expect(503);
    expect(first.body.error.code).toBe('KYC_PROVIDER_UNAVAILABLE');
    await request(ctx.server)
      .post('/v1/drivers/me/onboarding/kyc')
      .set(bearer(driver.token))
      .send()
      .expect(503);
    expect(await ctx.prisma.kycApplication.count({ where: { driverId: driver.driverId } })).toBe(1);
  });

  it('enforces one pending KYC application under concurrent database attempts', async () => {
    const driver = await createDriver(ctx, { approved: false });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        ctx.prisma.kycApplication.create({
          data: {
            driverId: driver.driverId,
            provider: 'MANUAL_ADMIN_VERIFICATION',
            status: 'PENDING',
          },
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(
      await ctx.prisma.kycApplication.count({
        where: { driverId: driver.driverId, status: 'PENDING' },
      }),
    ).toBe(1);
  });

  it('enforces approved-vehicle locking and one active vehicle in PostgreSQL', async () => {
    const driver = await createDriver(ctx);
    const approved = await ctx.prisma.vehicle.create({
      data: {
        driverId: driver.driverId,
        category: 'MINI_TRUCK',
        registrationNumber: `TEST${Date.now()}`,
        makeModel: 'Test truck',
        status: 'VERIFIED',
        active: true,
      },
    });
    await expect(
      ctx.prisma.vehicle.update({ where: { id: approved.id }, data: { category: 'PICKUP_TRUCK' } }),
    ).rejects.toThrow(/reverification/i);
    await expect(
      ctx.prisma.vehicle.create({
        data: {
          driverId: driver.driverId,
          category: 'MINI_TRUCK',
          registrationNumber: `NEXT${Date.now()}`,
          makeModel: 'Second truck',
          status: 'VERIFIED',
          active: true,
        },
      }),
    ).rejects.toThrow();
  });
});
