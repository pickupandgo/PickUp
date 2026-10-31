import request from 'supertest';
import {
  bearer,
  createCustomer,
  createDriver,
  uniquePhone,
  uniqueSubject,
} from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { restrictedDatabaseUrl } from '../setup/test-database';

describe('M02 customer profile persistence and registration', () => {
  let ctx: TestContext;
  let restricted: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    restricted = await createTestApp({ databaseUrl: restrictedDatabaseUrl() });
  });
  afterAll(async () => {
    await restricted?.close();
    await ctx?.close();
  });
  const edit = (token: string, body: Record<string, unknown>, app = ctx) =>
    request(app.server).patch('/v1/customers/me').set(bearer(token)).send(body);
  it('rejects unauthenticated and driver requests', async () => {
    await request(ctx.server).patch('/v1/customers/me').send({ age: 25 }).expect(401);
    const driver = await createDriver(ctx);
    await edit(driver.token, { age: 25 }).expect(403);
  });
  it('persists all fields, then preserves them across repeated and refreshed registration', async () => {
    const subject = uniqueSubject('m02'),
      phone = uniquePhone();
    const token = ctx.tokens.sign(subject, {
      phoneNumber: phone,
      name: 'Provider Name',
      email: 'provider@example.com',
      emailVerified: true,
    });
    const created = await request(ctx.server)
      .post('/v1/customers/me')
      .set(bearer(token))
      .send()
      .expect(201);
    const profile = {
      name: 'Edited Customer',
      email: 'edited@example.com',
      age: 29,
      address: 'Synthetic test address',
    };
    const patched = await edit(token, profile).expect(200);
    expect(patched.body).toMatchObject({ ...profile, customerId: created.body.customerId, phone });
    const row = await ctx.prisma.customer.findUniqueOrThrow({
      where: { id: created.body.customerId },
    });
    expect(row).toMatchObject(profile);
    for (const currentToken of [
      token,
      ctx.tokens.sign(subject, {
        phoneNumber: phone,
        name: 'Changed Provider Name',
        email: 'newprovider@example.com',
        emailVerified: true,
      }),
    ]) {
      await request(ctx.server)
        .post('/v1/customers/me')
        .set(bearer(currentToken))
        .send()
        .expect(200);
      const get = await request(ctx.server)
        .get('/v1/customers/me')
        .set(bearer(currentToken))
        .expect(200);
      expect(get.body).toEqual(patched.body);
    }
    expect(await ctx.prisma.authIdentity.count({ where: { provider: 'firebase', subject } })).toBe(
      1,
    );
  });
  it('preserves omitted fields and clears only nullable fields explicitly', async () => {
    const customer = await createCustomer(ctx);
    await edit(customer.token, {
      name: 'Original Name',
      email: 'original@example.com',
      age: 30,
      address: 'Original address',
    }).expect(200);
    const partial = await edit(customer.token, { name: 'Updated Name' }).expect(200);
    expect(partial.body).toMatchObject({
      name: 'Updated Name',
      email: 'original@example.com',
      age: 30,
      address: 'Original address',
    });
    const cleared = await edit(customer.token, { age: null, address: null }).expect(200);
    expect(cleared.body).toMatchObject({
      name: 'Updated Name',
      email: 'original@example.com',
      age: null,
      address: null,
    });
    expect((await edit(customer.token, {}).expect(200)).body).toEqual(cleared.body);
  });
  it.each([
    { age: 0 },
    { age: 121 },
    { age: '25' },
    { age: 1.5 },
    { address: '  ' },
    { email: 'invalid' },
    { name: null },
    { email: null },
  ])('rejects invalid values without modifying the saved profile: %p', async (body) => {
    const customer = await createCustomer(ctx);
    await edit(customer.token, body).expect(400);
    const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: customer.customerId } });
    expect(row.age).toBeNull();
    expect(row.address).toBeNull();
  });
  it('cannot target another customer or change identity/ownership fields', async () => {
    const first = await createCustomer(ctx),
      second = await createCustomer(ctx);
    const before = await ctx.prisma.customer.findUniqueOrThrow({
      where: { id: second.customerId },
    });
    for (const body of [
      { customerId: second.customerId },
      { userId: second.userId },
      { phone: uniquePhone() },
      { uid: second.subject },
      { role: 'ADMIN' },
      { status: 'ACTIVE' },
    ]) {
      await edit(first.token, { ...body, name: 'Untrusted change' }).expect(400);
    }
    expect(
      await ctx.prisma.customer.findUniqueOrThrow({ where: { id: second.customerId } }),
    ).toEqual(before);
  });
  it('restricts disabled customers for PATCH, GET and repeated bootstrap', async () => {
    const customer = await createCustomer(ctx);
    await ctx.prisma.user.update({ where: { id: customer.userId }, data: { status: 'SUSPENDED' } });
    await edit(customer.token, { age: 25 }).expect(403);
    await request(ctx.server).get('/v1/customers/me').set(bearer(customer.token)).expect(403);
    await request(ctx.server)
      .post('/v1/customers/me')
      .set(bearer(customer.token))
      .send()
      .expect(403);
  });
  it('works with the production column-level grants, without ownership permissions', async () => {
    const customer = await createCustomer(ctx);
    const token = restricted.tokens.sign(customer.subject);
    const result = await edit(
      token,
      { name: 'Restricted Profile', age: 42, address: 'Synthetic test address' },
      restricted,
    ).expect(200);
    expect(result.body).toMatchObject({
      name: 'Restricted Profile',
      age: 42,
      address: 'Synthetic test address',
    });
    await expect(
      restricted.prisma
        .$executeRaw`UPDATE customers SET user_id=user_id WHERE id=${customer.customerId}::uuid`,
    ).rejects.toThrow();
  });
  it('database constraints reject invalid age and blank address', async () => {
    const customer = await createCustomer(ctx);
    await expect(
      ctx.prisma.$executeRaw`UPDATE customers SET age=0 WHERE id=${customer.customerId}::uuid`,
    ).rejects.toThrow();
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE customers SET address='   ' WHERE id=${customer.customerId}::uuid`,
    ).rejects.toThrow();
  });
});
