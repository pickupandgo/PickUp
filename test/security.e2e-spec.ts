import {
  acceptTrip,
  call,
  deliverStop,
  get,
  keysDeep,
  OTP_KEYS,
  people,
  post,
  type RideOptions,
  startTrip,
  storedOtps,
} from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

/** The payment backend's internal routes the engine may call (raj_backend /v1/internal/*). */
const ALLOWED_CALLS = [
  /^GET \/v1\/internal\/fare-quotes\/[^/]+$/,
  /^POST \/v1\/internal\/bookings$/,
  /^GET \/v1\/internal\/bookings\/[^/]+$/,
  /^POST \/v1\/internal\/bookings\/[^/]+\/(searching|assign|cancel)$/,
  /^POST \/v1\/internal\/trips\/[^/]+\/status$/,
  /^POST \/v1\/internal\/trips\/[^/]+\/stops\/\d+\/status$/,
];

/**
 * A client or the engine can't set a fare, confirm a payment, bypass the payment gate, deliver
 * an unpaid drop, impersonate a user, or create a duplicate booking or trip (Phase 8 brief).
 */
describe('Security of the engine integration (e2e)', () => {
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

  describe('impersonation', () => {
    it('lets only the assigned driver move a trip (a fake driver gets 403)', async () => {
      const who = people('sec-driver');
      const trip = await acceptTrip(ctx, who);
      const fake = 'drv-impostor';
      for (const path of [
        'arrive',
        'pickup/verify-otp',
        'start',
        'stop/arrive',
        'stop/verify-otp',
        'complete',
      ]) {
        const response = await post(
          ctx,
          `/trips/${trip.tripId}/${path}`,
          fake,
          { otp: '1234' },
        );
        expect([path, response.status]).toEqual([path, 403]);
      }
      const confirm = await post(
        ctx,
        `/trips/${trip.tripId}/stop/confirm-delivery`,
        fake,
        {
          photo: { uri: 'file://x.jpg' },
        },
      );
      expect(confirm.status).toBe(403);
      const fail = await post(ctx, `/trips/${trip.tripId}/stop/fail`, fake, {
        reason: 'Not my trip',
      });
      expect(fail.status).toBe(403);
      // The customer is not the driver either.
      const customer = await post(
        ctx,
        `/trips/${trip.tripId}/arrive`,
        who.customer,
      );
      expect(customer.status).toBe(403);
      expect(ctx.backend.calls(/\/trips\//)).toEqual([]);
    });

    it('never uses a driverId or customerId from the body or path: a different one is 403', async () => {
      const who = people('sec-identity');
      const trip = await acceptTrip(ctx, who);
      const spoofed = await post(
        ctx,
        `/trips/${trip.tripId}/arrive`,
        who.driver,
        { driverId: 'drv-someone' },
      );
      expect(spoofed.status).toBe(403);
      expect(spoofed.body.code).toBe('IDENTITY_MISMATCH');
      const cancel = await post(
        ctx,
        `/trips/${trip.tripId}/cancel`,
        who.customer,
        {
          customerId: 'cust-someone',
          reason: 'Spoofed request',
        },
      );
      expect(cancel.status).toBe(403);
      for (const path of [
        `/trips/active/driver/${who.driver}`,
        `/trips/history/driver/${who.driver}`,
        `/trips/active/customer/${who.customer}`,
      ]) {
        expect((await get(ctx, path, 'cust-stranger')).status).toBe(403);
      }
      // A driver changes only their own presence.
      expect(ctx.drivers.findById(who.driver).isAvailable).toBe(false); // on a trip
      const presence = await call(
        ctx,
        'patch',
        `/drivers/${who.driver}/availability`,
        'drv-stranger',
        {
          isAvailable: true,
        },
      );
      expect(presence.status).toBe(403);
      expect(ctx.drivers.findById(who.driver).isAvailable).toBe(false);
    });

    it("hides other users' rides, trips and OTPs (404)", async () => {
      const who = people('sec-read');
      const trip = await acceptTrip(ctx, who);
      const stranger = 'cust-stranger';
      expect((await get(ctx, `/rides/${trip.rideId}`, stranger)).status).toBe(
        404,
      );
      expect(
        (await get(ctx, `/rides/${trip.rideId}/trip`, stranger)).status,
      ).toBe(404);
      expect((await get(ctx, `/trips/${trip.tripId}`, stranger)).status).toBe(
        404,
      );
      expect(
        (await get(ctx, `/rides/${trip.rideId}/otps`, stranger)).status,
      ).toBe(404);
      // The driver sees the trip but never the customer's codes.
      expect(
        (await get(ctx, `/rides/${trip.rideId}/trip`, who.driver)).status,
      ).toBe(200);
      expect(
        (await get(ctx, `/rides/${trip.rideId}/otps`, who.driver)).status,
      ).toBe(404);
    });
  });

  describe('payment gate bypass', () => {
    it('has no route that confirms a pickup or checks an OTP without the gate', async () => {
      const who = people('sec-routes');
      const trip = await acceptTrip(ctx, who);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      // Removed: pickup without OTP, and the unauthenticated OTP oracle of the prototype.
      expect(
        (await post(ctx, `/trips/${trip.tripId}/pickup/confirm`, who.driver))
          .status,
      ).toBe(404);
      expect(
        (
          await post(ctx, `/rides/${trip.rideId}/verify-otp`, who.driver, {
            otp: pickup,
          })
        ).status,
      ).toBe(404);
      expect(
        (await post(ctx, `/trips/${trip.tripId}/drop/confirm`, who.driver))
          .status,
      ).toBe(400);
      expect(
        (
          await ctx.prisma.engineTrip.findUniqueOrThrow({
            where: { id: trip.tripId },
          })
        ).status,
      ).toBe('DRIVER_ASSIGNED');
    });

    it('cannot skip the drop OTP, the photo, or the payment backend to deliver', async () => {
      const options: RideOptions = {
        ...people('sec-drop'),
        paymentMethod: 'PAY_AT_DELIVERY',
      };
      const trip = await startTrip(ctx, options);
      const stopId = trip.stopIds[0];
      await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
        stopId,
      }).expect(201);
      const direct = await post(
        ctx,
        `/trips/${trip.tripId}/stop/confirm-delivery`,
        options.driver,
        {
          stopId,
          photo: { uri: 'file://proof.jpg' },
          status: 'DELIVERED',
          paymentStatus: 'PAID',
        },
      );
      expect(direct.status).toBe(400);
      const legacy = await post(
        ctx,
        `/trips/${trip.tripId}/drop/start`,
        options.driver,
      );
      expect(legacy.status).toBe(201);
      expect(
        (
          await ctx.prisma.engineStop.findUniqueOrThrow({
            where: { id: stopId },
          })
        ).status,
      ).toBe('ARRIVED');
      expect(
        ctx.backend
          .calls(/\/stops\/\d+\/status$/)
          .filter((r) => r.body?.['status'] === 'DELIVERED'),
      ).toEqual([]);
    });

    it('never tells the payment backend an amount, a payment status or PAYMENT_CONFIRMED', async () => {
      const options: RideOptions = {
        ...people('sec-calls'),
        paymentMethod: 'PAY_AT_DELIVERY',
        drops: 2,
      };
      const trip = await startTrip(ctx, options);
      await deliverStop(ctx, trip, options, 0);
      await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
        stopId: trip.stopIds[1],
      }).expect(201);
      await post(ctx, `/trips/${trip.tripId}/stop/fail`, options.driver, {
        stopId: trip.stopIds[1],
        reason: 'Address not found',
      }).expect(201);

      for (const call of ctx.backend.requests) {
        expect(
          ALLOWED_CALLS.some((pattern) =>
            pattern.test(`${call.method} ${call.path}`),
          ),
        ).toBe(true);
        const keys = keysDeep(call.body ?? {});
        expect(
          keys.filter((key) =>
            /paise|fare|amount|fee|tax|price|paid|collection|refund/i.test(key),
          ),
        ).toEqual([]);
        expect(JSON.stringify(call.body ?? {})).not.toContain(
          'PAYMENT_CONFIRMED',
        );
        expect(call.requestId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
      }
      const registration = ctx.backend.calls(/^\/v1\/internal\/bookings$/)[0];
      expect(Object.keys(registration?.body ?? {}).sort()).toEqual([
        'customerSubject',
        'externalRef',
        'paymentMethod',
        'quoteId',
      ]);
    });
  });

  it("never returns an OTP outside the customer's gated endpoint", async () => {
    const options: RideOptions = { ...people('sec-otp'), drops: 2 };
    const responses: unknown[] = [];
    const record = <T extends { body: unknown }>(response: T): T => {
      responses.push(response.body);
      return response;
    };
    const trip = await acceptTrip(ctx, options);
    record(await get(ctx, `/rides/${trip.rideId}`, options.customer));
    record(await get(ctx, `/rides/${trip.rideId}/trip`, options.driver));
    record(await get(ctx, `/trips/${trip.tripId}`, options.customer));
    record(
      await get(ctx, `/trips/active/driver/${options.driver}`, options.driver),
    );
    record(
      await get(
        ctx,
        `/trips/active/customer/${options.customer}`,
        options.customer,
      ),
    );
    record(await get(ctx, `/trips/${trip.tripId}/stops`, options.driver));
    record(
      await get(ctx, `/trips/${trip.tripId}/current-stop`, options.driver),
    );
    record(await post(ctx, `/trips/${trip.tripId}/arrive`, options.driver));
    ctx.backend.payBooking(trip.paymentBookingId);
    const { pickup, stops } = await storedOtps(ctx, trip.rideId);
    record(
      await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        options.driver,
        { otp: pickup },
      ),
    );
    record(await post(ctx, `/trips/${trip.tripId}/start`, options.driver));
    record(
      await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
        stopId: trip.stopIds[0],
      }),
    );
    record(
      await post(ctx, `/trips/${trip.tripId}/stop/verify-otp`, options.driver, {
        stopId: trip.stopIds[0],
        otp: stops[0],
      }),
    );
    record(await get(ctx, `/ride-requests/${options.driver}`, options.driver));

    for (const body of responses) {
      expect(keysDeep(body).filter((key) => OTP_KEYS.includes(key))).toEqual(
        [],
      );
    }
  });
});
