import { Logger } from '@nestjs/common';
import {
  get,
  goOnline,
  keysDeep,
  OTP_KEYS,
  people,
  post,
  requestRide,
  UUID_PATTERN,
} from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';
import { TEST_INTERNAL_API_KEY } from './helpers/test-config';

const REGISTRATION = /^\/v1\/internal\/bookings$/;

/**
 * Customer confirms (review F): the quote is read from the payment backend, the booking is
 * persisted with a stable external reference, registered with
 * { externalRef, customerSubject, quoteId, paymentMethod } (never an amount), and offered to a
 * driver only once the payment backend confirmed it.
 */
describe('Booking registration with the payment backend (e2e)', () => {
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
    jest.restoreAllMocks();
  });

  it('registers the quote for the verified customer, with no amount, then offers it', async () => {
    const who = people('reg');
    const { quote, response } = await requestRide(ctx, { ...who, drops: 2 });

    expect(response.status).toBe(201);
    const ride = response.body.ride;
    expect(ride.id).toMatch(UUID_PATTERN);
    expect(ride).toMatchObject({
      status: 'REQUESTED',
      bookingStatus: 'OPEN',
      externalRef: `ENG-${ride.id}`,
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      requestedDriverId: who.driver,
      payablePaise: quote.payablePaise,
      fare: quote.payablePaise / 100,
    });
    // The route is the quote's, in its order.
    expect(
      ride.drops.map((drop: { latitude: number; longitude: number }) => [
        drop.latitude,
        drop.longitude,
      ]),
    ).toEqual(quote.drops.map((drop) => [drop.latitude, drop.longitude]));

    const registrations = ctx.backend.calls(REGISTRATION);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.body).toEqual({
      externalRef: ride.externalRef,
      customerSubject: who.customer,
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
    });
    expect(registrations[0]?.requestId).toBe(`eng-reg-${ride.id}`);
    const registered = ctx.backend.bookingByRef(ride.externalRef);
    expect(ride.paymentBookingId).toBe(registered?.bookingId);

    const row = await ctx.prisma.engineBooking.findUniqueOrThrow({
      where: { id: ride.id },
      include: { stops: true, offers: true },
    });
    expect(row).toMatchObject({
      status: 'OPEN',
      externalRef: ride.externalRef,
      paymentBookingId: registered?.bookingId,
      quoteId: quote.quoteId,
      customerSubject: who.customer,
      payablePaise: BigInt(quote.payablePaise),
    });
    expect(row.registeredAt).toBeInstanceOf(Date);
    expect(row.stops).toHaveLength(2);
    expect(row.offers).toHaveLength(1);

    // No handover code in the confirmation (they are gated by payment: GET /rides/:id/otps).
    expect(
      keysDeep(response.body).filter((key) => OTP_KEYS.includes(key)),
    ).toEqual([]);
  });

  it('dispatches nothing the payment backend refused (unknown customer)', async () => {
    const who = people('reg-unknown');
    const { response } = await requestRide(ctx, {
      ...who,
      customerKnown: false,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
    const rows = await ctx.prisma.engineBooking.findMany({
      include: { offers: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'REGISTRATION_FAILED',
      registrationError: 'CUSTOMER_NOT_FOUND',
      paymentBookingId: null,
    });
    expect(rows[0]?.offers).toEqual([]);
    const requests = await get(
      ctx,
      `/ride-requests/${who.driver}`,
      who.driver,
    ).expect(200);
    expect(requests.body.requests).toEqual([]);
    expect(await ctx.prisma.engineOutbox.count()).toBe(0);
  });

  it('answers a replay with the same ride: one booking at the payment backend', async () => {
    const who = people('reg-replay');
    const first = await requestRide(ctx, who);
    expect(first.response.status).toBe(201);
    const again = await requestRide(ctx, { ...who, quote: first.quote });

    expect(again.response.status).toBe(201);
    expect(again.response.body.ride.id).toBe(first.response.body.ride.id);
    expect(again.response.body.ride.externalRef).toBe(
      first.response.body.ride.externalRef,
    );
    expect(ctx.backend.bookings.size).toBe(1);
    expect(await ctx.prisma.engineBooking.count()).toBe(1);
    expect(await ctx.prisma.engineOffer.count()).toBe(1);
  });

  it('retries a lost registration answer with the same external reference (no duplicate booking)', async () => {
    const who = people('reg-lost');
    ctx.backend.fail({
      match: (r) => REGISTRATION.test(r.path),
      mode: 'DROP_AFTER_APPLY',
    });
    const first = await requestRide(ctx, who);

    // Applied at the backend, but the engine never heard back: nothing is dispatched.
    expect(first.response.status).toBe(503);
    expect(first.response.body.code).toBe('PAYMENT_BACKEND_UNAVAILABLE');
    const pending = await ctx.prisma.engineBooking.findFirstOrThrow({
      include: { offers: true },
    });
    expect(pending.status).toBe('PENDING_REGISTRATION');
    expect(pending.offers).toEqual([]);
    expect(ctx.backend.bookings.size).toBe(1);

    const retry = await requestRide(ctx, { ...who, quote: first.quote });
    expect(retry.response.status).toBe(201);
    expect(retry.response.body.ride.id).toBe(pending.id);
    const registrations = ctx.backend.calls(REGISTRATION);
    expect(registrations).toHaveLength(2);
    expect(new Set(registrations.map((r) => r.body?.['externalRef']))).toEqual(
      new Set([pending.externalRef]),
    );
    expect(ctx.backend.bookings.size).toBe(1);
    expect(retry.response.body.ride.paymentBookingId).toBe(
      ctx.backend.bookingByRef(pending.externalRef)?.bookingId,
    );
  });

  it('treats a timeout or a 503 as an unknown outcome and registers on the retry', async () => {
    const who = people('reg-timeout');
    ctx.backend.fail({
      match: (r) => REGISTRATION.test(r.path),
      mode: 'TIMEOUT',
    });
    const first = await requestRide(ctx, who);
    expect(first.response.status).toBe(503);
    expect(first.response.body).toMatchObject({
      code: 'PAYMENT_BACKEND_UNAVAILABLE',
      details: { code: 'TIMEOUT' },
    });

    ctx.backend.fail({
      match: (r) => REGISTRATION.test(r.path),
      mode: 'STATUS_503',
    });
    const second = await requestRide(ctx, { ...who, quote: first.quote });
    expect(second.response.status).toBe(503);

    const third = await requestRide(ctx, { ...who, quote: first.quote });
    expect(third.response.status).toBe(201);
    expect(ctx.backend.bookings.size).toBe(1);
    expect(await ctx.prisma.engineBooking.count()).toBe(1);
  });

  it('creates one booking and one offer when the same confirmation arrives several times at once', async () => {
    const who = people('reg-race');
    ctx.backend.addCustomer(who.customer);
    ctx.backend.addDriver(who.driver);
    await goOnline(ctx, who.driver);
    const quote = ctx.backend.createQuote({
      customerSubject: who.customer,
      drops: 2,
    });
    const body = {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_DELIVERY',
      driverId: who.driver,
    };

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => post(ctx, '/rides', who.customer, body)),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.ride.id)).size).toBe(1);
    expect(await ctx.prisma.engineBooking.count()).toBe(1);
    expect(await ctx.prisma.engineOffer.count()).toBe(1);
    expect(
      await ctx.prisma.engineOutbox.count({ where: { kind: 'SEARCHING' } }),
    ).toBe(1);
    expect(ctx.backend.bookings.size).toBe(1);
  });

  describe('the client never sets the fare', () => {
    it.each([
      'fare',
      'farePaise',
      'amountPaise',
      'payablePaise',
      'taxPaise',
      'platformFeePaise',
      'price',
    ])(
      'refuses a ride request carrying %s (400 CLIENT_AMOUNT_REJECTED)',
      async (field) => {
        const who = people('reg-amount');
        const { response } = await requestRide(ctx, {
          ...who,
          body: { [field]: 1 },
        });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
          code: 'CLIENT_AMOUNT_REJECTED',
          details: { fields: [field] },
        });
        expect(ctx.backend.calls(REGISTRATION)).toEqual([]);
        expect(await ctx.prisma.engineBooking.count()).toBe(0);
      },
    );

    it('refuses fields the engine does not take (weight, vehicle, status...)', async () => {
      const who = people('reg-fields');
      const { response } = await requestRide(ctx, {
        ...who,
        body: { weight: 10, vehicleType: 'Mini Truck', status: 'ACCEPTED' },
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await ctx.prisma.engineBooking.count()).toBe(0);
    });

    it('needs a payment backend quote id and an offered payment method', async () => {
      const who = people('reg-shape');
      const missing = await post(ctx, '/rides', who.customer, {
        paymentMethod: 'PAY_AT_PICKUP',
        driverId: who.driver,
      });
      expect(missing.status).toBe(400);
      const prepaid = await requestRide(ctx, {
        ...who,
        body: { paymentMethod: 'PREPAID_UPI' },
      });
      expect(prepaid.response.status).toBe(400);
    });
  });

  it('takes the customer from the token, never from the body (403 IDENTITY_MISMATCH)', async () => {
    const who = people('reg-identity');
    const { response } = await requestRide(ctx, {
      ...who,
      body: { customerId: 'cust-someone-else' },
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('IDENTITY_MISMATCH');
    expect(await ctx.prisma.engineBooking.count()).toBe(0);

    const same = await requestRide(ctx, {
      ...who,
      body: { customerId: who.customer },
    });
    expect(same.response.status).toBe(201);
    expect(ctx.backend.calls(REGISTRATION)[0]?.body?.['customerSubject']).toBe(
      who.customer,
    );
  });

  describe('the trip is built from the backend-priced route', () => {
    it('refuses drops that are not the quote (the old 6-drop request against a 5-drop quote)', async () => {
      const who = people('route-count');
      const quote = ctx.backend.createQuote({
        customerSubject: who.customer,
        drops: 5,
      });
      const drops = Array.from({ length: 6 }, (_, i) => ({
        address: `Drop ${i + 1}`,
      }));
      const { response } = await requestRide(ctx, {
        ...who,
        quote,
        body: { drops },
      });

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        code: 'QUOTE_ROUTE_MISMATCH',
        details: { kind: 'DROP_COUNT', expected: 5, received: 6 },
      });
      expect(ctx.backend.calls(REGISTRATION)).toEqual([]);
      expect(await ctx.prisma.engineBooking.count()).toBe(0);
    });

    it('refuses a pickup or a drop moved away from the quote', async () => {
      const who = people('route-moved');
      const quote = ctx.backend.createQuote({
        customerSubject: who.customer,
        drops: 2,
      });
      const pickup = await requestRide(ctx, {
        ...who,
        quote,
        body: {
          pickup: {
            latitude: quote.pickup.latitude + 0.001,
            longitude: quote.pickup.longitude,
          },
        },
      });
      expect(pickup.response.status).toBe(422);
      expect(pickup.response.body.details).toEqual({ kind: 'PICKUP_MOVED' });

      const drops = quote.drops.map((drop, index) => ({
        latitude: drop.latitude + (index === 1 ? 0.01 : 0),
        longitude: drop.longitude,
      }));
      const drop = await requestRide(ctx, { ...who, quote, body: { drops } });
      expect(drop.response.status).toBe(422);
      expect(drop.response.body.details).toEqual({
        kind: 'DROP_MOVED',
        sequence: 2,
      });

      const partial = await requestRide(ctx, {
        ...who,
        quote,
        body: { drop: { latitude: quote.drops[0]?.latitude } },
      });
      expect(partial.response.status).toBe(422);
      expect(await ctx.prisma.engineBooking.count()).toBe(0);
    });

    it("keeps the customer's details for the quote's own points", async () => {
      const who = people('route-details');
      const quote = ctx.backend.createQuote({
        customerSubject: who.customer,
        drops: 2,
      });
      const { response } = await requestRide(ctx, {
        ...who,
        quote,
        body: {
          pickup: { ...quote.pickup, address: 'Warehouse 4' },
          drops: quote.drops.map((drop, index) => ({
            latitude: drop.latitude,
            longitude: drop.longitude,
            address: `Shop ${index + 1}`,
            receiver: { name: `Receiver ${index + 1}`, phone: '9000000000' },
          })),
        },
      });
      expect(response.status).toBe(201);
      expect(response.body.ride.pickup.address).toBe('Warehouse 4');
      expect(response.body.ride.drops[1]).toMatchObject({
        sequence: 2,
        address: 'Shop 2',
        receiver: { name: 'Receiver 2' },
        payablePaise: quote.drops[1]?.payablePaise,
      });
    });

    it('refuses an unknown, expired or already used quote', async () => {
      const who = people('route-quote');
      const unknown = await requestRide(ctx, {
        ...who,
        quote: {
          ...ctx.backend.createQuote({ customerSubject: who.customer }),
          quoteId: '0d5f8e2a-1111-4c3b-8d5e-000000000000',
        },
      });
      expect(unknown.response.status).toBe(422);
      expect(unknown.response.body.code).toBe('QUOTE_NOT_FOUND');

      const expired = ctx.backend.createQuote({
        customerSubject: who.customer,
        expiresInSeconds: -5,
      });
      const late = await requestRide(ctx, { ...who, quote: expired });
      expect(late.response.status).toBe(409);
      expect(late.response.body.code).toBe('QUOTE_EXPIRED');

      const used = ctx.backend.createQuote({ customerSubject: who.customer });
      used.redeemed = true;
      const twice = await requestRide(ctx, { ...who, quote: used });
      expect(twice.response.status).toBe(409);
      expect(twice.response.body.code).toBe('QUOTE_ALREADY_USED');
      expect(await ctx.prisma.engineBooking.count()).toBe(0);
    });

    it("refuses another customer's quote at the payment backend, and that blocks nobody", async () => {
      const owner = people('quote-owner');
      const intruder = people('quote-intruder');
      ctx.backend.addCustomer(owner.customer);
      const quote = ctx.backend.createQuote({
        customerSubject: owner.customer,
      });

      const stolen = await requestRide(ctx, { ...intruder, quote });
      expect(stolen.response.status).toBe(422);
      expect(stolen.response.body.code).toBe('QUOTE_NOT_FOUND');

      const own = await requestRide(ctx, { ...owner, quote });
      expect(own.response.status).toBe(201);
      expect(ctx.backend.bookings.size).toBe(1);
      expect(
        (
          await ctx.prisma.engineBooking.findMany({
            orderBy: { createdAt: 'asc' },
          })
        ).map((b) => b.status),
      ).toEqual(['REGISTRATION_FAILED', 'OPEN']);
    });

    it('passes on a payment method the backend does not offer for the quote (422)', async () => {
      const who = people('route-method');
      ctx.backend.fail({
        match: (r) => REGISTRATION.test(r.path),
        mode: 'REFUSE',
        refusal: { status: 422, code: 'PAYMENT_METHOD_NOT_OFFERED' },
      });
      const { response } = await requestRide(ctx, {
        ...who,
        paymentMethod: 'PAY_AT_DELIVERY',
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('PAYMENT_METHOD_NOT_OFFERED');
    });
  });

  describe('internal API authentication', () => {
    afterEach(() => {
      ctx.backend.internalKey = TEST_INTERNAL_API_KEY;
    });

    it('sends the internal key on every call; a refused key reads and registers nothing', async () => {
      const who = people('reg-key');
      const alerts = jest.spyOn(Logger.prototype, 'error');
      ctx.backend.internalKey = 'a_different_internal_key_0123456789abcdef';
      const refused = await requestRide(ctx, who);

      // A 401 is a configuration problem, not an answer about the booking: retryable, alerted.
      expect(refused.response.status).toBe(503);
      expect(refused.response.body.code).toBe('PAYMENT_BACKEND_UNAVAILABLE');
      expect(alerts).toHaveBeenCalledWith(
        expect.objectContaining({
          alert: 'PAYMENT_BACKEND_AUTH_FAILED',
          status: 401,
        }),
      );
      expect(ctx.backend.requests.every((r) => r.status === 401)).toBe(true);
      expect(ctx.backend.bookings.size).toBe(0);
      expect(await ctx.prisma.engineBooking.count()).toBe(0);

      ctx.backend.internalKey = TEST_INTERNAL_API_KEY;
      const fixed = await requestRide(ctx, { ...who, quote: refused.quote });
      expect(fixed.response.status).toBe(201);
      expect(ctx.backend.bookings.size).toBe(1);
    });

    it('keeps a booking whose registration hit a refused key pending, then registers it once', async () => {
      const who = people('reg-key-pending');
      const alerts = jest.spyOn(Logger.prototype, 'error');
      ctx.backend.fail({
        match: (r) => REGISTRATION.test(r.path),
        mode: 'REFUSE',
        refusal: { status: 401, code: 'INTERNAL_AUTH_INVALID' },
      });
      const refused = await requestRide(ctx, who);

      expect(refused.response.status).toBe(503);
      expect(alerts).toHaveBeenCalledWith(
        expect.objectContaining({ alert: 'PAYMENT_BACKEND_AUTH_FAILED' }),
      );
      const booking = await ctx.prisma.engineBooking.findFirstOrThrow({
        include: { offers: true },
      });
      expect(booking.status).toBe('PENDING_REGISTRATION');
      expect(booking.offers).toEqual([]);

      const fixed = await requestRide(ctx, { ...who, quote: refused.quote });
      expect(fixed.response.status).toBe(201);
      expect(fixed.response.body.ride.id).toBe(booking.id);
      expect(ctx.backend.bookings.size).toBe(1);
    });
  });
});
