import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';
import { acceptTrip, call, get, people } from './helpers/flows';
import { DriverLocationStore } from '../src/drivers/driver-location.store';

describe('authenticated shared live positions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });
  const fix = (capturedAt = Date.now(), latitude = 26.2389) => ({
    latitude,
    longitude: 73.0243,
    accuracy: 5,
    capturedAt,
  });

  it('rejects missing auth, cross-driver writes, bad GPS and unprovisioned writers', async () => {
    const d = 'location-driver';
    ctx.backend.addDriver(d, true);
    await call(ctx, 'patch', `/drivers/${d}/location`, null, fix()).expect(401);
    await call(ctx, 'patch', `/drivers/${d}/location`, 'other', fix()).expect(
      403,
    );
    await call(ctx, 'patch', `/drivers/${d}/location`, d, {
      ...fix(),
      latitude: 100,
    }).expect(400);
    await call(
      ctx,
      'patch',
      '/drivers/unknown/location',
      'unknown',
      fix(),
    ).expect(403);
    await call(
      ctx,
      'patch',
      `/drivers/${d}/location`,
      d,
      fix(Date.now() - 60000),
    ).expect(400);
    await call(ctx, 'patch', `/drivers/${d}/location`, d, {
      ...fix(),
      tripId: '00000000-0000-4000-8000-000000000000',
    }).expect(403);
  });

  it('continues active-trip updates, isolates availability and restricts customer retrieval', async () => {
    const p = people('location');
    const trip = await acceptTrip(ctx, p);
    const time = Date.now();
    await call(ctx, 'patch', `/drivers/${p.driver}/location`, p.driver, {
      ...fix(time, 26.25),
      tripId: trip.tripId,
    }).expect(200);
    const result = await get(ctx, `/drivers/${p.driver}`, p.customer).expect(
      200,
    );
    expect(result.body.driver).toMatchObject({
      latitude: 26.25,
      capturedAt: time,
      locationStatus: 'LIVE',
      isAvailable: false,
    });
    await get(ctx, `/drivers/${p.driver}`, 'unrelated-customer').expect(403);
    await call(ctx, 'patch', `/drivers/${p.driver}/availability`, p.driver, {
      isAvailable: true,
    }).expect(200);
    expect(ctx.drivers.findById(p.driver).isAvailable).toBe(false);
  });

  it('orders concurrent/duplicate fixes in PostgreSQL and recovers without process memory', async () => {
    const d = 'recover-driver';
    ctx.backend.addDriver(d, true);
    const time = Date.now();
    await Promise.all(
      [time - 2, time, time - 1].map((t) =>
        call(
          ctx,
          'patch',
          `/drivers/${d}/location`,
          d,
          fix(t, t === time ? 26.3 : 26.2),
        ).expect(200),
      ),
    );
    const recovered = new DriverLocationStore(ctx.prisma);
    const [row] = await recovered.fresh(d);
    expect(Number(row.capturedAt)).toBe(time);
    expect(row.latitude).toBe(26.3);
    await call(
      ctx,
      'patch',
      `/drivers/${d}/location`,
      d,
      fix(time, 26.4),
    ).expect(200);
    expect((await recovered.fresh(d))[0].latitude).toBe(26.3);
    // Independent app instances see the same durable latest fix; no local presence is needed.
    const restarted = await createTestApp({
      backend: ctx.backend,
      tokens: ctx.tokens,
    });
    try {
      const result = await get(restarted, `/drivers/${d}`, d).expect(200);
      expect(result.body.driver.latitude).toBe(26.3);
    } finally {
      await restarted.close();
    }
    await ctx.prisma
      .$executeRaw`UPDATE engine_driver_positions SET captured_at=${BigInt(time - 61000)} WHERE subject=${d}`;
    await get(ctx, `/drivers/${d}`, d).expect(404);
    await get(ctx, '/drivers/never-seen', 'never-seen').expect(404);
  });
});
