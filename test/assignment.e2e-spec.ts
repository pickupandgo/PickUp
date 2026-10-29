import {
  acceptTrip,
  bookRide,
  call,
  get,
  goOnline,
  outboxOf,
  people,
  post,
  requestRide,
} from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

const ASSIGN = /^\/v1\/internal\/bookings\/[^/]+\/assign$/;

/**
 * Driver accepts (review F): the engine trip and its ASSIGN are written in one transaction,
 * ASSIGN is delivered backend first, the payment backend's trip id is stored, and accepting
 * again never creates a second trip. Phase 2B denies unprovisioned or unapproved drivers before
 * an offer or assignment is persisted.
 */
describe('Offers and assignment (e2e)', () => {
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

  it('lists the offer to the requested driver only, without OTPs or customer identity', async () => {
    const who = people('offer');
    const ride = await bookRide(ctx, { ...who, drops: 2 });

    const mine = await get(
      ctx,
      `/ride-requests/${who.driver}`,
      who.driver,
    ).expect(200);
    expect(mine.body.requests).toHaveLength(1);
    expect(mine.body.requests[0]).toMatchObject({
      rideId: ride.rideId,
      paymentMethod: 'PAY_AT_PICKUP',
      payablePaise: ride.quote.payablePaise,
      status: 'REQUESTED',
    });
    expect(JSON.stringify(mine.body)).not.toContain(who.customer);
    expect(Object.keys(mine.body.requests[0])).not.toContain('otp');

    const other = people('offer-other');
    const theirs = await get(
      ctx,
      `/ride-requests/${other.driver}`,
      other.driver,
    ).expect(200);
    expect(theirs.body.requests).toEqual([]);
    // Someone else's list: the path id must be the signed-in driver.
    const spying = await get(ctx, `/ride-requests/${who.driver}`, other.driver);
    expect(spying.status).toBe(403);
  });

  it('assigns backend first: one trip, the payment trip id stored, ASSIGN sent after SEARCHING', async () => {
    const who = people('assign');
    const trip = await acceptTrip(ctx, { ...who, drops: 2 });

    const backendBooking = ctx.backend.bookings.get(trip.paymentBookingId);
    expect(backendBooking?.trip).toMatchObject({
      driverSubject: who.driver,
      status: 'DRIVER_ASSIGNED',
    });
    expect(trip.paymentTripId).toBe(backendBooking?.trip?.tripId);
    const row = await ctx.prisma.engineTrip.findUniqueOrThrow({
      where: { id: trip.tripId },
    });
    expect(row).toMatchObject({
      status: 'DRIVER_ASSIGNED',
      driverSubject: who.driver,
      paymentTripId: backendBooking?.trip?.tripId,
    });
    const outbox = await outboxOf(ctx, trip.rideId);
    expect(
      outbox.map((record) => [record.kind, record.mode, record.status]),
    ).toEqual([
      ['SEARCHING', 'EVENT', 'DELIVERED'],
      ['ASSIGN', 'COMMAND', 'DELIVERED'],
    ]);
    expect(ctx.backend.calls(ASSIGN).map((r) => r.body)).toEqual([
      { driverSubject: who.driver },
    ]);

    const ride = await get(ctx, `/rides/${trip.rideId}`, who.customer).expect(
      200,
    );
    expect(ride.body.ride).toMatchObject({
      status: 'ACCEPTED',
      assignedDriverId: who.driver,
      tripId: trip.tripId,
      paymentTripId: trip.paymentTripId,
    });
  });

  it('is idempotent: accepting again returns the same trip and sends nothing new', async () => {
    const who = people('assign-again');
    const trip = await acceptTrip(ctx, who);
    const again = await post(
      ctx,
      `/rides/${trip.rideId}/accept`,
      who.driver,
    ).expect(201);

    expect(again.body.trip.id).toBe(trip.tripId);
    expect(await ctx.prisma.engineTrip.count()).toBe(1);
    expect(
      await ctx.prisma.engineOutbox.count({ where: { kind: 'ASSIGN' } }),
    ).toBe(1);
    expect(ctx.backend.calls(ASSIGN)).toHaveLength(1);
  });

  it('creates one trip when the same acceptance arrives several times at once', async () => {
    const who = people('assign-race');
    const ride = await bookRide(ctx, who);
    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        post(ctx, `/rides/${ride.rideId}/accept`, who.driver),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.trip.id)).size).toBe(1);
    expect(await ctx.prisma.engineTrip.count()).toBe(1);
    expect(
      await ctx.prisma.engineOutbox.count({ where: { kind: 'ASSIGN' } }),
    ).toBe(1);
    expect(ctx.backend.calls(ASSIGN)).toHaveLength(1);
  });

  it('refuses an acceptance by a driver the ride was not offered to', async () => {
    const who = people('assign-other');
    const ride = await bookRide(ctx, who);
    const intruder = people('assign-intruder');
    ctx.backend.addDriver(intruder.driver);
    await goOnline(ctx, intruder.driver);

    const response = await post(
      ctx,
      `/rides/${ride.rideId}/accept`,
      intruder.driver,
    );
    expect(response.status).toBe(400);
    expect(await ctx.prisma.engineTrip.count()).toBe(0);
    // A body driverId other than the signed-in driver is refused, never used.
    const spoofed = await post(
      ctx,
      `/rides/${ride.rideId}/accept`,
      intruder.driver,
      {
        driverId: who.driver,
      },
    );
    expect(spoofed.status).toBe(403);
    expect(spoofed.body.code).toBe('IDENTITY_MISMATCH');
    expect(ctx.backend.calls(ASSIGN)).toEqual([]);
  });

  it('refuses an expired offer, then lets the customer offer the same booking again', async () => {
    const who = people('assign-expired');
    const ride = await bookRide(ctx, who);
    await ctx.prisma.engineOffer.updateMany({
      where: { bookingId: ride.rideId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const late = await post(ctx, `/rides/${ride.rideId}/accept`, who.driver);
    expect(late.status).toBe(409);
    const view = await get(ctx, `/rides/${ride.rideId}`, who.customer).expect(
      200,
    );
    expect(view.body.ride).toMatchObject({
      status: 'REJECTED',
      offerStatus: 'EXPIRED',
    });

    const again = await requestRide(ctx, { ...who, quote: ride.quote });
    expect(again.response.status).toBe(201);
    expect(again.response.body.ride).toMatchObject({
      id: ride.rideId,
      externalRef: ride.externalRef,
      status: 'REQUESTED',
    });
    // Registered once; SEARCHING reported once.
    expect(ctx.backend.calls(/^\/v1\/internal\/bookings$/)).toHaveLength(1);
    expect(
      await ctx.prisma.engineOutbox.count({ where: { kind: 'SEARCHING' } }),
    ).toBe(1);
  });

  it('re-offers a rejected booking to another driver (same booking, same external reference)', async () => {
    const who = people('assign-reject');
    const ride = await bookRide(ctx, who);
    await post(ctx, `/rides/${ride.rideId}/reject`, who.driver).expect(201);
    const rejected = await get(
      ctx,
      `/rides/${ride.rideId}`,
      who.customer,
    ).expect(200);
    expect(rejected.body.ride.status).toBe('REJECTED');

    const next = people('assign-next');
    ctx.backend.addDriver(next.driver);
    await goOnline(ctx, next.driver);
    const offered = await post(ctx, '/rides', who.customer, {
      quoteId: ride.quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId: next.driver,
    }).expect(201);
    expect(offered.body.ride).toMatchObject({
      id: ride.rideId,
      requestedDriverId: next.driver,
    });

    const accepted = await post(
      ctx,
      `/rides/${ride.rideId}/accept`,
      next.driver,
    ).expect(201);
    expect(accepted.body.trip.driverId).toBe(next.driver);
    expect(ctx.backend.bookings.size).toBe(1);
    expect(
      ctx.backend.bookingByRef(ride.externalRef)?.trip?.driverSubject,
    ).toBe(next.driver);
  });

  it.each([
    ['not provisioned at the backend', false],
    ['not approved', true],
  ] as const)(
    'blocks a driver %s before dispatch or assignment',
    async (_label, provisionUnapproved) => {
      const who = people('assign-ineligible');
      ctx.backend.addCustomer(who.customer);
      if (provisionUnapproved) {
        ctx.backend.addDriver(who.driver, false);
      }

      const online = await call(
        ctx,
        'patch',
        `/drivers/${who.driver}/availability`,
        who.driver,
        { isAvailable: true },
      );
      expect(online.status).toBe(403);
      expect(online.body.code).toBe('DRIVER_NOT_ELIGIBLE');

      const quote = ctx.backend.createQuote({ customerSubject: who.customer });
      const created = await post(ctx, '/rides', who.customer, {
        quoteId: quote.quoteId,
        paymentMethod: 'PAY_AT_PICKUP',
      }).expect(201);
      expect(created.body.ride.status).toBe('REJECTED');
      expect(await ctx.prisma.engineOffer.count()).toBe(0);
      expect(await ctx.prisma.engineTrip.count()).toBe(0);
      expect(ctx.backend.calls(ASSIGN)).toEqual([]);
    },
  );

  it('never offers a driver on an active trip, even after a restart forgot their presence', async () => {
    const who = people('assign-busy');
    await acceptTrip(ctx, who);
    const second = people('assign-busy-2');
    ctx.backend.addCustomer(second.customer);
    const quote = ctx.backend.createQuote({ customerSubject: second.customer });
    // The busy driver's app still says "available".
    await goOnline(ctx, who.driver);

    const response = await post(ctx, '/rides', second.customer, {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId: who.driver,
    });
    expect(response.status).toBe(201);
    expect(response.body.ride.status).toBe('REJECTED');
    expect(
      await ctx.prisma.engineOffer.count({
        where: { bookingId: response.body.ride.id },
      }),
    ).toBe(0);
    const nearby = await get(
      ctx,
      '/drivers/nearby?lat=26.2389&lng=73.0243&radius=50',
      second.customer,
    ).expect(200);
    expect(nearby.body.drivers.map((d: { id: string }) => d.id)).not.toContain(
      who.driver,
    );
  });

  it('lets one of two bookings win when both offers to one driver are accepted at once', async () => {
    const driver = people('assign-double').driver;
    const first = await bookRide(ctx, {
      customer: people('double-a').customer,
      driver,
    });
    const second = await bookRide(ctx, {
      customer: people('double-b').customer,
      driver,
    });

    const results = await Promise.all([
      post(ctx, `/rides/${first.rideId}/accept`, driver),
      post(ctx, `/rides/${second.rideId}/accept`, driver),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await ctx.prisma.engineTrip.count({
        where: { status: { not: 'CANCELLED' } },
      }),
    ).toBe(1);
    expect(ctx.backend.calls(ASSIGN)).toHaveLength(1);
  });

  it('cancels a booking before acceptance with a reason, idempotently, with no refund call', async () => {
    const who = people('assign-cancel');
    const ride = await bookRide(ctx, who);
    const noReason = await post(
      ctx,
      `/rides/${ride.rideId}/cancel`,
      who.customer,
      {},
    );
    expect(noReason.status).toBe(400);

    const cancelled = await post(
      ctx,
      `/rides/${ride.rideId}/cancel`,
      who.customer,
      {
        reason: 'Changed my plans',
      },
    ).expect(201);
    expect(cancelled.body.ride).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Changed my plans',
    });
    const again = await post(
      ctx,
      `/rides/${ride.rideId}/cancel`,
      who.customer,
      {
        reason: 'Changed my plans',
      },
    ).expect(201);
    expect(again.body.ride.status).toBe('CANCELLED');

    const remote = ctx.backend.bookings.get(ride.paymentBookingId);
    expect(remote).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Changed my plans',
    });
    const cancels = ctx.backend.calls(/\/cancel$/);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.body).toEqual({ reason: 'Changed my plans' });
    expect(ctx.backend.requests.some((r) => /refund/i.test(r.path))).toBe(
      false,
    );
    const offers = await get(
      ctx,
      `/ride-requests/${who.driver}`,
      who.driver,
    ).expect(200);
    expect(offers.body.requests).toEqual([]);
    // Someone else cannot cancel it (it behaves as missing).
    const stranger = await post(
      ctx,
      `/rides/${ride.rideId}/cancel`,
      'cust-stranger',
      {
        reason: 'Not mine at all',
      },
    );
    expect(stranger.status).toBe(404);
  });
});
