import {
  acceptTrip,
  bookRide,
  get,
  goOnline,
  outboxOf,
  people,
  post,
  UUID_PATTERN,
} from './helpers/flows';
import { FakePaymentBackend } from './helpers/fake-payment-backend';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';
import { TEST_INTERNAL_API_KEY } from './helpers/test-config';
import { TestTokenIssuer } from './helpers/test-tokens';

const TRIP_STATUS = /^\/v1\/internal\/trips\/[^/]+\/status$/;

/**
 * Restarts. The prototype kept everything in memory with sequential ids (R1, T1...), so a
 * restart lost every ride and reused ids already registered with the payment backend. The
 * engine now persists bookings, trips, stops and the outbox, with UUIDs.
 */
describe('Persistence across engine restarts (e2e)', () => {
  let backend: FakePaymentBackend;
  let tokens: TestTokenIssuer;
  let ctx: TestContext;

  const boot = () => createTestApp({ backend, tokens });

  beforeAll(async () => {
    backend = await FakePaymentBackend.start(TEST_INTERNAL_API_KEY);
    tokens = new TestTokenIssuer();
    ctx = await boot();
  });

  afterAll(async () => {
    await ctx.closeEngine();
    await backend.stop();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    backend.reset();
  });

  const restart = async () => {
    await ctx.closeEngine();
    ctx = await boot();
  };

  it('keeps rides, trips and payment ids across a restart, and new ids never collide', async () => {
    const first = people('persist');
    const trip = await acceptTrip(ctx, { ...first, drops: 2 });
    const before = await get(
      ctx,
      `/rides/${trip.rideId}`,
      first.customer,
    ).expect(200);

    await restart();

    const after = await get(
      ctx,
      `/rides/${trip.rideId}`,
      first.customer,
    ).expect(200);
    expect(after.body.ride).toEqual(before.body.ride);
    expect(after.body.ride).toMatchObject({
      externalRef: `ENG-${trip.rideId}`,
      paymentBookingId: trip.paymentBookingId,
      tripId: trip.tripId,
      paymentTripId: trip.paymentTripId,
    });
    const tripView = await get(
      ctx,
      `/trips/${trip.tripId}`,
      first.driver,
    ).expect(200);
    expect(tripView.body.trip.stops.map((s: { id: string }) => s.id)).toEqual(
      trip.stopIds,
    );

    // A new booking after the restart: a fresh UUID, registered under its own reference.
    const second = people('persist-next');
    const next = await bookRide(ctx, second);
    expect(next.rideId).toMatch(UUID_PATTERN);
    expect(next.rideId).not.toBe(trip.rideId);
    expect(next.externalRef).toBe(`ENG-${next.rideId}`);
    expect(backend.bookings.size).toBe(2);
    expect(
      new Set([...backend.bookings.values()].map((b) => b.externalRef)).size,
    ).toBe(2);
  });

  it('delivers reports committed before a crash once the engine is back', async () => {
    const who = people('persist-outbox');
    const trip = await acceptTrip(ctx, who);
    backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
    });
    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
    expect((await outboxOf(ctx, trip.rideId)).at(-1)?.status).toBe('PENDING');

    await restart();
    await ctx.prisma.engineOutbox.updateMany({
      where: { status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await ctx.outbox.tick();

    expect((await outboxOf(ctx, trip.rideId)).at(-1)?.status).toBe('DELIVERED');
    expect(backend.bookings.get(trip.paymentBookingId)?.trip?.status).toBe(
      'DRIVER_ARRIVED',
    );
  });

  it('keeps a driver on a trip busy after a restart forgot their presence', async () => {
    const who = people('persist-busy');
    const trip = await acceptTrip(ctx, who);

    await restart();
    // The driver's app comes back online; the trip is still theirs.
    await goOnline(ctx, who.driver);
    const active = await get(
      ctx,
      `/trips/active/driver/${who.driver}`,
      who.driver,
    ).expect(200);
    expect(active.body.trip.id).toBe(trip.tripId);

    const other = people('persist-busy-2');
    backend.addCustomer(other.customer);
    const quote = backend.createQuote({ customerSubject: other.customer });
    const offer = await post(ctx, '/rides', other.customer, {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId: who.driver,
    });
    expect(offer.status).toBe(201);
    expect(offer.body.ride.status).toBe('REJECTED');
    expect(
      await ctx.prisma.engineOffer.count({
        where: { bookingId: offer.body.ride.id },
      }),
    ).toBe(0);
  });

  it('continues a pending registration after a restart with the same external reference', async () => {
    const who = people('persist-reg');
    backend.addCustomer(who.customer);
    backend.addDriver(who.driver);
    await goOnline(ctx, who.driver);
    const quote = backend.createQuote({ customerSubject: who.customer });
    backend.fail({
      match: (r) => r.path === '/v1/internal/bookings',
      mode: 'DROP_AFTER_APPLY',
    });
    const body = {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId: who.driver,
    };
    await post(ctx, '/rides', who.customer, body).expect(503);
    const pending = await ctx.prisma.engineBooking.findFirstOrThrow();

    await restart();
    await goOnline(ctx, who.driver);
    const retried = await post(ctx, '/rides', who.customer, body).expect(201);
    expect(retried.body.ride).toMatchObject({
      id: pending.id,
      externalRef: pending.externalRef,
      status: 'REQUESTED',
    });
    expect(backend.bookings.size).toBe(1);
  });
});
