import { acceptTrip, bookRide, call, people, post } from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

const ELIGIBILITY = /\/v1\/internal\/drivers\/by-subject\/[^/]+\/eligibility$/;

describe('Backend-authoritative driver eligibility (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.backend.reset();
  });

  it('allows ONLINE only after an explicit eligible backend response', async () => {
    const { driver } = people('eligible-online');
    ctx.backend.addDriver(driver, true);

    const response = await call(
      ctx,
      'patch',
      `/drivers/${driver}/availability`,
      driver,
      { isAvailable: true },
    );

    expect(response.status).toBe(200);
    expect(response.body.driver).toMatchObject({ id: driver, isAvailable: true });
    expect(ctx.backend.calls(ELIGIBILITY, 'GET')).toHaveLength(1);
  });

  it.each(['pending', 'suspended'] as const)(
    'rejects a %s driver from ONLINE and keeps them unavailable',
    async (state) => {
      const { driver } = people(`ineligible-${state}`);
      ctx.backend.addDriver(driver, false);

      const response = await call(
        ctx,
        'patch',
        `/drivers/${driver}/availability`,
        driver,
        { isAvailable: true },
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('DRIVER_NOT_ELIGIBLE');
      expect(ctx.drivers.findById(driver).isAvailable).toBe(false);
    },
  );

  it('does not let an anonymous or different Firebase subject change ONLINE state', async () => {
    const { driver } = people('online-identity');
    ctx.backend.addDriver(driver, true);
    expect(
      (
        await call(ctx, 'patch', `/drivers/${driver}/availability`, null, {
          isAvailable: true,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(ctx, 'patch', `/drivers/${driver}/availability`, 'drv-other', {
          isAvailable: true,
        })
      ).status,
    ).toBe(403);
    expect(ctx.backend.calls(ELIGIBILITY, 'GET')).toEqual([]);
  });

  it.each([
    ['timeout', 'TIMEOUT'] as const,
    ['service outage', 'STATUS_503'] as const,
  ])('fails closed on backend %s', async (_name, mode) => {
    const { driver } = people(`online-${mode}`);
    ctx.backend.addDriver(driver, true);
    ctx.backend.fail({ match: (request) => ELIGIBILITY.test(request.path), mode, times: 1 });

    const response = await call(
      ctx,
      'patch',
      `/drivers/${driver}/availability`,
      driver,
      { isAvailable: true },
    );

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DRIVER_ELIGIBILITY_UNAVAILABLE');
    expect(ctx.drivers.findById(driver).isAvailable).toBe(false);
  });

  it('fails closed when the backend rejects the internal API key', async () => {
    const { driver } = people('online-bad-key');
    ctx.backend.addDriver(driver, true);
    ctx.backend.internalKey = 'different-test-key';

    const response = await call(
      ctx,
      'patch',
      `/drivers/${driver}/availability`,
      driver,
      { isAvailable: true },
    );

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DRIVER_ELIGIBILITY_UNAVAILABLE');
  });

  it('does not offer a session-revoked driver, even though they were previously ONLINE', async () => {
    const { customer, driver } = people('revoked-dispatch');
    ctx.backend.addCustomer(customer);
    ctx.backend.addDriver(driver, true);
    await call(ctx, 'patch', `/drivers/${driver}/availability`, driver, {
      isAvailable: true,
    }).expect(200);
    ctx.backend.setDriverEligibility(driver, false);
    const quote = ctx.backend.createQuote({ customerSubject: customer });

    const response = await post(ctx, '/rides', customer, {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
    });

    expect(response.status).toBe(201);
    expect(await ctx.prisma.engineOffer.count()).toBe(0);
    expect(ctx.drivers.findById(driver).isAvailable).toBe(false);
  });

  it('rechecks eligibility immediately before assignment and leaves the offer unaccepted', async () => {
    const who = people('revoked-accept');
    const ride = await bookRide(ctx, who);
    ctx.backend.setDriverEligibility(who.driver, false);

    const response = await post(ctx, `/rides/${ride.rideId}/accept`, who.driver);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DRIVER_NOT_ELIGIBLE');
    expect(await ctx.prisma.engineTrip.count()).toBe(0);
    expect(
      await ctx.prisma.engineOffer.findFirstOrThrow({
        where: { bookingId: ride.rideId },
      }),
    ).toMatchObject({ status: 'REQUESTED', driverSubject: who.driver });
  });

  it('does not cancel or mutate an already assigned trip after later revocation', async () => {
    const who = people('active-trip-revoked');
    const trip = await acceptTrip(ctx, who);
    ctx.backend.setDriverEligibility(who.driver, false);

    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
    expect(
      await ctx.prisma.engineTrip.findUniqueOrThrow({ where: { id: trip.tripId } }),
    ).toMatchObject({ status: 'DRIVER_ARRIVED', driverSubject: who.driver });
  });

  it('handles concurrent ONLINE requests without allowing an ineligible result', async () => {
    const { driver } = people('concurrent-online');
    ctx.backend.addDriver(driver, false);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        call(ctx, 'patch', `/drivers/${driver}/availability`, driver, {
          isAvailable: true,
        }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(ctx.drivers.findById(driver).isAvailable).toBe(false);
  });
});
