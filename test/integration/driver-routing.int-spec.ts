import request from 'supertest';
import { RoutingService } from '../../src/routing/routing.service';
import { bearer, createCustomer, createDriver, createFeeRule } from '../helpers/fixtures';
import { bookedTrip } from '../helpers/flows';
import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';

describe('Driver road routing contract with real identity/ownership guards', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  it('keeps Customer routing Customer-only and authenticates/validates Driver requests', async () => {
    const driver = await createDriver(ctx);
    const customer = await createCustomer(ctx);
    const body = {
      tripId: '00000000-0000-4000-8000-000000000001',
      origin: { latitude: 26.2389, longitude: 73.0243 },
      destination: { latitude: 26.3, longitude: 73.0458 },
    };
    const post = () => request(ctx.server).post('/v1/driver/routes/road');
    await post().send(body).expect(401);
    await post().set(bearer(customer.token)).send(body).expect(403);
    await post()
      .set(bearer(driver.token))
      .send({ ...body, driverId: driver.driverId })
      .expect(400);
    await post()
      .set(bearer(driver.token))
      .send({ ...body, origin: { latitude: 91, longitude: 73 } })
      .expect(400);
    await post().set(bearer(driver.token)).send(body).expect(403);
    await request(ctx.server)
      .post('/v1/routes/road')
      .set(bearer(driver.token))
      .send(body)
      .expect(403);
  });
  it('routes only the assigned Driver through the booking itinerary and keeps credentials server-side', async () => {
    const driver = await createHistoricalEligibleDriver(ctx);
    const other = await createDriver(ctx);
    const customer = await createCustomer(ctx);
    const category = 'MINI_TRUCK'; // Match the existing approved synthetic vehicle fixture.
    await createFeeRule(ctx.prisma, { category });
    const { tripId } = await bookedTrip(ctx, customer, driver, {
      category,
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50000,
      dropPaise: [25000, 25000],
    });
    const body = {
      tripId,
      origin: { latitude: 26.2389, longitude: 73.0243 },
      waypoints: [{ latitude: 26.3, longitude: 73.0458 }],
      destination: { latitude: 26.31, longitude: 73.0458 },
    };
    const provider = jest.spyOn(ctx.app.get(RoutingService), 'route').mockResolvedValue({
      encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceMeters: 5000,
      durationSeconds: 300,
    });
    try {
      await request(ctx.server)
        .post('/v1/driver/routes/road')
        .set(bearer(other.token))
        .send(body)
        .expect(403);
      const result = await request(ctx.server)
        .post('/v1/driver/routes/road')
        .set(bearer(driver.token))
        .send(body)
        .expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(Object.keys(result.body).sort()).toEqual([
        'distanceMeters',
        'durationSeconds',
        'encodedPolyline',
      ]);
      expect(provider).toHaveBeenCalledTimes(1);
      await request(ctx.server)
        .post('/v1/driver/routes/road')
        .set(bearer(driver.token))
        .send({ ...body, waypoints: [body.destination], destination: body.waypoints[0] })
        .expect(403);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      provider.mockRestore();
    }
  });
});
