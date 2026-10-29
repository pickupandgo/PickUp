import request from 'supertest';
import { bearer, createAdmin, createCustomer, createDriver } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { restrictedDatabaseUrl } from '../setup/test-database';

const profile = {
  name: 'Synthetic Driver',
  profileVersion: 2,
  dateOfBirth: '1995-05-03',
  email: 'driver@example.test',
  residentialAddress: '123 Synthetic Test Road',
  city: 'Test City',
  state: 'Test State',
  pinCode: '342001',
};
describe('Detailed driver onboarding HTTP / persistence / least privilege', () => {
  let owner: TestContext, app: TestContext;
  let fixtures: Pick<TestContext, 'prisma' | 'tokens'>;
  beforeAll(async () => {
    owner = await createTestApp();
    app = await createTestApp({
      databaseUrl: restrictedDatabaseUrl(),
      configOverrides: {
        ONBOARDING_MINIMUM_AGE: '18',
        SWAGGER_ENABLED: 'true',
        ONBOARDING_IDENTITY_ENCRYPTION_KEY: 'ab'.repeat(32),
      },
    });
    fixtures = { prisma: owner.prisma, tokens: app.tokens };
  });
  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });
  const url = '/v1/drivers/me/onboarding';
  it('publishes the actual guarded onboarding/admin routes in OpenAPI', async () => {
    const docs = await request(app.server).get('/docs/openapi.json').expect(200);
    expect(docs.body.paths[`${url}/vehicle-category`].patch).toBeDefined();
    expect(docs.body.paths[`${url}/documents/{kind}/{documentId}/preview`].get).toBeDefined();
    expect(docs.body.paths['/v1/admin/onboarding/drivers/{id}/licence/reveal'].post).toBeDefined();
    expect(
      docs.body.components.schemas.DriverProfileResponse.properties.phone.description,
    ).toContain('Verified persisted');
    expect(docs.body.components.schemas.DriverProfileResponse.properties.dateOfBirth.type).toBe(
      'string',
    );
  });

  it('requires full v2 details for newly bootstrapped accounts even with a legacy name-only client', async () => {
    const subject = `new-profile-${Date.now()}`;
    const phone = '+919876540123';
    const token = app.tokens.sign(subject, { phoneNumber: phone });
    const created = await request(app.server)
      .post('/v1/drivers/me')
      .set(bearer(token))
      .send()
      .expect(201);
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(token))
      .send({ name: 'Name Only' })
      .expect(200);
    const state = await request(app.server).get(url).set(bearer(token)).expect(200);
    expect(state.body.profileComplete).toBe(false);
    expect(state.body.profile.version).toBe(2);
    expect(state.body.eligible).toBe(false);
    expect(
      (await owner.prisma.driver.findUniqueOrThrow({ where: { id: created.body.driverId } }))
        .profileVersion,
    ).toBe(2);
  });

  it('persists a v2 profile under application-role grants and returns only verified account phone', async () => {
    const driver = await createDriver(fixtures, { approved: false });
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(driver.token))
      .send(profile)
      .expect(200);
    const response = await request(app.server).get(url).set(bearer(driver.token)).expect(200);
    expect(response.body.profile).toMatchObject({
      name: profile.name,
      phone: driver.phone,
      detailsComplete: true,
      ageEligible: true,
      dateOfBirth: profile.dateOfBirth,
    });
    const saved = await owner.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(saved.profileVersion).toBe(2);
    expect(saved.city).toBe(profile.city);
    expect(saved.legalName).not.toBe(profile.name); // declared name is not approved legal-name authority
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(driver.token))
      .send({ name: 'Compatible name update' })
      .expect(200);
    expect(
      (await owner.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } }))
        .profileVersion,
    ).toBe(2);
  });
  it.each([
    { ...profile, email: 'invalid' },
    { ...profile, city: '' },
    { ...profile, dateOfBirth: '2001-02-29' },
    { ...profile, dateOfBirth: '2999-01-01' },
    { ...profile, pinCode: '123' },
    { ...profile, role: 'ADMIN' },
    { ...profile, phone: '+910000000000' },
    { ...profile, approvalStatus: 'APPROVED' },
  ])('rejects malformed or privileged profile input', async (body) => {
    const driver = await createDriver(fixtures, { approved: false });
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(driver.token))
      .send(body)
      .expect(400);
    expect(
      (await owner.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } }))
        .profileVersion,
    ).toBe(1);
  });
  it('preserves legacy name-only client behavior', async () => {
    const driver = await createDriver(fixtures, { approved: false });
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(driver.token))
      .send({ name: 'Legacy Driver' })
      .expect(200);
    const response = await request(app.server).get(url).set(bearer(driver.token)).expect(200);
    expect(response.body.profileComplete).toBe(true);
    expect(response.body.profile.detailsComplete).toBe(false);
  });
  it('saves a category-only draft without creating an incomplete vehicle', async () => {
    const driver = await createDriver(fixtures, { approved: false });
    await request(app.server)
      .patch(`${url}/vehicle-category`)
      .set(bearer(driver.token))
      .send({ category: 'MINI_TRUCK' })
      .expect(200);
    const response = await request(app.server).get(url).set(bearer(driver.token)).expect(200);
    expect(response.body.selectedVehicleCategory).toBe('MINI_TRUCK');
    expect(response.body.vehicles).toEqual([]);
    await request(app.server)
      .patch(`${url}/vehicle-category`)
      .set(bearer(driver.token))
      .send({ category: 'JCB' })
      .expect(400);
  });
  it('rejects customer, unauthenticated, suspended and approved profile mutations', async () => {
    const customer = await createCustomer(fixtures);
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(customer.token))
      .send(profile)
      .expect(403);
    await request(app.server).patch(`${url}/profile`).send(profile).expect(401);
    const suspended = await createDriver(fixtures, { approved: false, status: 'SUSPENDED' });
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(suspended.token))
      .send(profile)
      .expect(403);
    const approved = await createDriver(fixtures);
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(approved.token))
      .send(profile)
      .expect(409);
  });
  it('encrypts licence metadata, conceals it in summaries, and audits administrator reveal', async () => {
    const driver = await createDriver(fixtures, { approved: false });
    const number = 'SYNTHETIC-LICENCE-1234';
    await request(app.server)
      .patch(`${url}/profile`)
      .set(bearer(driver.token))
      .send({ ...profile, drivingLicenseNumber: number })
      .expect(200);
    const saved = await owner.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect(saved.drivingLicenseCiphertext).not.toContain(number);
    const own = await request(app.server).get(url).set(bearer(driver.token)).expect(200);
    expect(JSON.stringify(own.body)).not.toContain(number);
    const admin = await createAdmin(fixtures);
    const endpoint = `/v1/admin/onboarding/drivers/${driver.driverId}/licence/reveal`;
    await request(app.server)
      .post(endpoint)
      .set(bearer(driver.token))
      .send({ reason: 'Unauthorized test' })
      .expect(403);
    const revealed = await request(app.server)
      .post(endpoint)
      .set(bearer(admin.token))
      .send({ reason: 'Synthetic licence comparison' })
      .expect(201);
    expect(revealed.body.drivingLicenseNumber).toBe(number);
    expect(revealed.headers['cache-control']).toBe('no-store');
    expect(
      await owner.prisma.adminAction.count({
        where: { targetId: driver.driverId, action: 'DRIVER_LICENCE_ACCESSED' },
      }),
    ).toBe(1);
    const detail = await request(app.server)
      .get(`/v1/admin/onboarding/drivers/${driver.driverId}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(number);
    expect(detail.body.profile.ageEligible).toBe(true);
  });
  it('never previews missing or another driver document and keeps disabled KYC unavailable', async () => {
    const driver = await createDriver(fixtures, { approved: false });
    await request(app.server)
      .get(`${url}/documents/KYC/00000000-0000-0000-0000-000000000001/preview`)
      .set(bearer(driver.token))
      .expect(404);
    await request(app.server).post(`${url}/kyc`).set(bearer(driver.token)).send().expect(503);
    expect(
      (await request(app.server).get(url).set(bearer(driver.token))).body.capabilities
        .manualKycEnabled,
    ).toBe(false);
  });
});
