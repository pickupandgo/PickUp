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
 * Customer self-registration: a verified phone is required (email, Google or Apple sign-in alone
 * is not enough), a phone is never re-linked to a second sign-in, and the API can only ever
 * create CUSTOMER accounts.
 */
describe('Customer self-registration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const register = (token: string) =>
    request(ctx.server).post('/v1/customers/me').set(bearer(token)).send();

  /** A Firebase sign-in, by default by phone OTP (so the token carries phone_number). */
  function signIn(options: { phoneNumber?: string; signInProvider?: string } = {}) {
    const subject = uniqueSubject('signup');
    const phone = options.phoneNumber ?? uniquePhone();
    return {
      subject,
      phone,
      token: ctx.tokens.sign(subject, {
        phoneNumber: phone,
        signInProvider: options.signInProvider ?? 'phone',
      }),
    };
  }

  it('creates the account from the verified phone, then returns it on every repeat', async () => {
    const user = signIn();
    const created = await register(user.token).expect(201);
    expect(created.body).toMatchObject({ phone: user.phone, status: 'ACTIVE' });
    const customerId = created.body.customerId as string;

    const again = await register(user.token).expect(200);
    expect(again.body.customerId).toBe(customerId);
    const me = await request(ctx.server)
      .get('/v1/customers/me')
      .set(bearer(user.token))
      .expect(200);
    expect(me.body).toEqual(created.body);

    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { phone: user.phone },
      include: { authIdentities: true, customer: true },
    });
    expect(row).toMatchObject({ role: 'CUSTOMER', status: 'ACTIVE' });
    expect(row.authIdentities.map((identity) => identity.subject)).toEqual([user.subject]);
    expect(row.customer?.id).toBe(customerId);
  });

  it('accepts email, Google or Apple sign-ins only once a phone is verified and linked', async () => {
    const google = uniqueSubject('google');
    const withoutPhone = ctx.tokens.sign(google, { signInProvider: 'google.com' });
    const refused = await register(withoutPhone).expect(403);
    expect(refused.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
    expect(
      await ctx.prisma.authIdentity.findUnique({
        where: { provider_subject: { provider: 'firebase', subject: google } },
      }),
    ).toBeNull();

    // After linking a phone credential, Firebase adds phone_number to the same user's tokens.
    const phone = uniquePhone();
    const linked = ctx.tokens.sign(google, { signInProvider: 'google.com', phoneNumber: phone });
    const created = await register(linked).expect(201);
    expect(created.body.phone).toBe(phone);
  });

  it('refuses a phone claim that is not E.164', async () => {
    const odd = ctx.tokens.sign(uniqueSubject('odd'), { phoneNumber: '9876543210' });
    expect((await register(odd).expect(403)).body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
  });

  it('never links a phone that already belongs to another account', async () => {
    const first = signIn();
    await register(first.token).expect(201);

    // Same number, different sign-in (e.g. a recycled SIM or a new Firebase user).
    const second = signIn({ phoneNumber: first.phone });
    const refused = await register(second.token).expect(409);
    expect(refused.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    expect(await ctx.prisma.authIdentity.count({ where: { user: { phone: first.phone } } })).toBe(
      1,
    );
  });

  it("refuses a driver's sign-in and leaves the driver account untouched", async () => {
    const driver = await createDriver(ctx);
    const token = ctx.tokens.sign(driver.subject, { phoneNumber: driver.phone });
    const refused = await register(token).expect(409);
    expect(refused.body.error.code).toBe('ACCOUNT_ROLE_CONFLICT');
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: driver.userId },
      include: { customer: true },
    });
    expect(user).toMatchObject({ role: 'DRIVER', customer: null });
  });

  it('refuses a suspended customer', async () => {
    const user = signIn();
    const created = await register(user.token).expect(201);
    await ctx.prisma.user.update({
      where: { phone: user.phone },
      data: { status: 'SUSPENDED' },
    });
    const refused = await register(user.token).expect(403);
    expect(refused.body.error.code).toBe('ACCOUNT_DISABLED');
    await request(ctx.server).get('/v1/customers/me').set(bearer(user.token)).expect(403);
    expect(created.body.customerId).toBeDefined();
  });

  it('settles concurrent registrations of one sign-in to a single account', async () => {
    const user = signIn();
    const results = await Promise.all(Array.from({ length: 8 }, () => register(user.token)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 200 || status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.customerId as string)).size).toBe(1);
    expect(await ctx.prisma.user.count({ where: { phone: user.phone } })).toBe(1);
  });

  it('gives a contested phone to exactly one of several concurrent sign-ins', async () => {
    const phone = uniquePhone();
    const contenders = Array.from({ length: 5 }, () => signIn({ phoneNumber: phone }));
    const results = await Promise.all(contenders.map((c) => register(c.token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers.every((r) => r.status === 409)).toBe(true);
    expect(losers.every((r) => r.body.error.code === 'PHONE_ALREADY_REGISTERED')).toBe(true);
    expect(await ctx.prisma.authIdentity.count({ where: { user: { phone } } })).toBe(1);
  });

  it('keeps customer routes closed to sign-ins that have not registered', async () => {
    const user = signIn();
    const res = await request(ctx.server)
      .get('/v1/customers/me')
      .set(bearer(user.token))
      .expect(403);
    expect(res.body.error.code).toBe('USER_NOT_PROVISIONED');
    await request(ctx.server).post('/v1/customers/me').expect(401);
  });

  it('returns customers created by the ops CLI as they are', async () => {
    const existing = await createCustomer(ctx);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    const token = ctx.tokens.sign(existing.subject, { phoneNumber: user.phone });
    const res = await register(token).expect(200);
    expect(res.body.customerId).toBe(existing.customerId);
  });
});
