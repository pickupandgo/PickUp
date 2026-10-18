import {
  acceptTrip,
  get,
  makeDue,
  outboxOf,
  people,
  pickUp,
  post,
  storedOtps,
} from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

const TRIP_STATUS = /^\/v1\/internal\/trips\/[^/]+\/status$/;

const statusCalls = (ctx: TestContext, status: string) =>
  ctx.backend.calls(TRIP_STATUS).filter((r) => r.body?.['status'] === status);

/**
 * The pickup (review F): arrival is reported, the payment gate is read fresh, the pickup OTP is
 * checked only once the payment backend allows the handover, and PICKUP_VERIFIED is committed
 * only once the payment backend accepted it.
 */
describe('Pickup and the payment gate (e2e)', () => {
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

  describe('PAY_AT_PICKUP', () => {
    it('blocks the handover while unpaid: PAYMENT_REQUIRED, the OTP is not even checked', async () => {
      const who = people('pickup-unpaid');
      const trip = await acceptTrip(ctx, who);
      const arrived = await post(
        ctx,
        `/trips/${trip.tripId}/arrive`,
        who.driver,
      ).expect(201);
      expect(arrived.body).toMatchObject({
        tripStatus: 'DRIVER_ARRIVED',
        changed: true,
        paymentSync: 'DELIVERED',
      });
      expect(
        ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status,
      ).toBe('DRIVER_ARRIVED');

      const { pickup } = await storedOtps(ctx, trip.rideId);
      for (const otp of [pickup, '0000']) {
        const response = await post(
          ctx,
          `/trips/${trip.tripId}/pickup/verify-otp`,
          who.driver,
          { otp },
        );
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({
          code: 'PAYMENT_REQUIRED',
          details: {
            stage: 'PICKUP',
            amountPaise: trip.quote.payablePaise,
            paymentState: 'PAYMENT_REQUIRED',
          },
        });
      }

      const row = await ctx.prisma.engineTrip.findUniqueOrThrow({
        where: { id: trip.tripId },
      });
      expect(row.status).toBe('DRIVER_ARRIVED');
      expect(row.pickupVerifiedAt).toBeNull();
      const outbox = await outboxOf(ctx, trip.rideId);
      expect(
        outbox.some(
          (r) =>
            (r.payload as { status?: string }).status === 'PICKUP_VERIFIED',
        ),
      ).toBe(false);
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toEqual([]);

      // The customer's app shows no code either until the payment is confirmed.
      const otps = await get(
        ctx,
        `/rides/${trip.rideId}/otps`,
        who.customer,
      ).expect(200);
      expect(otps.body).toMatchObject({
        paymentStatus: 'UNPAID',
        pickup: { otp: null, withheld: 'PAYMENT_REQUIRED' },
        stops: [{ sequence: 1, otp: null, withheld: 'PAYMENT_REQUIRED' }],
      });
    });

    it('allows the handover once paid: wrong OTP 400, right OTP PICKUP_VERIFIED backend first', async () => {
      const who = people('pickup-paid');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);

      const otps = await get(
        ctx,
        `/rides/${trip.rideId}/otps`,
        who.customer,
      ).expect(200);
      expect(otps.body.pickup).toEqual({
        otp: expect.stringMatching(/^\d{4}$/),
        withheld: null,
      });
      expect(otps.body.stops[0]).toMatchObject({
        otp: expect.stringMatching(/^\d{4}$/),
        withheld: null,
      });

      const wrong = otps.body.pickup.otp === '0000' ? '1111' : '0000';
      const bad = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: wrong },
      );
      expect(bad.status).toBe(400);
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toEqual([]);

      const verified = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        {
          otp: otps.body.pickup.otp,
        },
      ).expect(201);
      expect(verified.body).toMatchObject({
        tripStatus: 'PICKUP_VERIFIED',
        changed: true,
        paymentSync: 'DELIVERED',
      });
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toHaveLength(1);
      expect(
        ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status,
      ).toBe('PICKUP_VERIFIED');

      const repeat = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        {
          otp: otps.body.pickup.otp,
        },
      ).expect(201);
      expect(repeat.body).toMatchObject({
        tripStatus: 'PICKUP_VERIFIED',
        changed: false,
      });
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toHaveLength(1);
      // The pickup code is finished once used.
      const after = await get(
        ctx,
        `/rides/${trip.rideId}/otps`,
        who.customer,
      ).expect(200);
      expect(after.body.pickup).toEqual({ otp: null, withheld: 'FINISHED' });
    });

    it('commits nothing when the payment backend refuses PICKUP_VERIFIED (payment reversed meanwhile)', async () => {
      const who = people('pickup-refused');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      ctx.backend.fail({
        match: (r) =>
          TRIP_STATUS.test(r.path) && r.body?.['status'] === 'PICKUP_VERIFIED',
        mode: 'REFUSE',
        refusal: {
          status: 409,
          code: 'PAYMENT_REQUIRED',
          details: { stage: 'PICKUP' },
        },
      });

      const response = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PAYMENT_REQUIRED');
      const row = await ctx.prisma.engineTrip.findUniqueOrThrow({
        where: { id: trip.tripId },
      });
      expect(row.status).toBe('DRIVER_ARRIVED');
      const command = (await outboxOf(ctx, trip.rideId)).at(-1);
      expect(command).toMatchObject({
        mode: 'COMMAND',
        status: 'REFUSED',
        lastErrorCode: 'PAYMENT_REQUIRED',
      });

      // Paid again: a new attempt goes through.
      const retry = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(retry.status).toBe(201);
      expect(retry.body.tripStatus).toBe('PICKUP_VERIFIED');
    });

    it('fails closed when the gate cannot be read (503), and commits nothing', async () => {
      const who = people('pickup-gate-down');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      ctx.backend.fail({
        match: (r) => r.method === 'GET',
        mode: 'STATUS_503',
      });

      const response = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PAYMENT_BACKEND_UNAVAILABLE');
      expect(
        (
          await ctx.prisma.engineTrip.findUniqueOrThrow({
            where: { id: trip.tripId },
          })
        ).status,
      ).toBe('DRIVER_ARRIVED');
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toEqual([]);
      const otps = await get(ctx, `/rides/${trip.rideId}/otps`, who.customer);
      expect(otps.status).toBe(200);
    });

    it('applies PICKUP_VERIFIED only once the payment backend accepted it, even if that is later', async () => {
      const who = people('pickup-later');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      ctx.backend.fail({
        match: (r) =>
          TRIP_STATUS.test(r.path) && r.body?.['status'] === 'PICKUP_VERIFIED',
        mode: 'STATUS_503',
      });

      const response = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(response.status).toBe(503);
      expect(response.body.details).toMatchObject({ retry: true });
      expect(
        (
          await ctx.prisma.engineTrip.findUniqueOrThrow({
            where: { id: trip.tripId },
          })
        ).status,
      ).toBe('DRIVER_ARRIVED');

      await makeDue(ctx, trip.rideId);
      await ctx.outbox.tick();
      const view = await get(ctx, `/trips/${trip.tripId}`, who.driver).expect(
        200,
      );
      expect(view.body.trip.status).toBe('PICKUP_VERIFIED');
      expect(
        ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status,
      ).toBe('PICKUP_VERIFIED');
    });

    it('waits for the arrival to reach the payment backend before checking any OTP', async () => {
      const who = people('pickup-sync');
      const trip = await acceptTrip(ctx, who);
      ctx.backend.fail({
        match: (r) => TRIP_STATUS.test(r.path),
        mode: 'STATUS_503',
        times: 2,
      });
      const arrived = await post(
        ctx,
        `/trips/${trip.tripId}/arrive`,
        who.driver,
      ).expect(201);
      expect(arrived.body).toMatchObject({
        tripStatus: 'DRIVER_ARRIVED',
        paymentSync: 'PENDING',
      });
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);

      const blocked = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(blocked.status).toBe(503);
      expect(blocked.body.details).toEqual({ pendingReports: 1 });

      const verified = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(verified.status).toBe(201);
      expect(verified.body.tripStatus).toBe('PICKUP_VERIFIED');
      expect(
        ctx.backend
          .calls(TRIP_STATUS)
          .filter((r) => r.status === 200)
          .map((r) => r.body?.['status']),
      ).toEqual(['DRIVER_ARRIVED', 'PICKUP_VERIFIED']);
    });

    it('refuses the pickup before the driver arrived', async () => {
      const who = people('pickup-early');
      const trip = await acceptTrip(ctx, who);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      const response = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        { otp: pickup },
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        'DRIVER_ASSIGNED to PICKUP_VERIFIED',
      );
      const start = await post(ctx, `/trips/${trip.tripId}/start`, who.driver);
      expect(start.status).toBe(400);
    });
  });

  describe('PAY_AT_DELIVERY', () => {
    it('hands over at the pickup without any payment', async () => {
      const who = people('pickup-delivery');
      const options = {
        ...who,
        paymentMethod: 'PAY_AT_DELIVERY' as const,
        drops: 2,
      };
      const trip = await acceptTrip(ctx, options);

      const before = await get(
        ctx,
        `/rides/${trip.rideId}/otps`,
        who.customer,
      ).expect(200);
      expect(before.body.pickup).toEqual({
        otp: expect.stringMatching(/^\d{4}$/),
        withheld: null,
      });
      expect(
        before.body.stops.map((s: { withheld: string }) => s.withheld),
      ).toEqual(['PAYMENT_REQUIRED', 'PAYMENT_REQUIRED']);

      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      const verified = await post(
        ctx,
        `/trips/${trip.tripId}/pickup/verify-otp`,
        who.driver,
        {
          otp: before.body.pickup.otp,
        },
      ).expect(201);
      expect(verified.body.tripStatus).toBe('PICKUP_VERIFIED');
      const remote = ctx.backend.bookings.get(trip.paymentBookingId);
      expect(remote?.paymentStatus).toBe('UNPAID');
      expect(remote?.trip?.status).toBe('PICKUP_VERIFIED');

      await post(ctx, `/trips/${trip.tripId}/start`, who.driver).expect(201);
      expect(
        ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status,
      ).toBe('IN_TRANSIT');
    });
  });

  describe('duplicates and concurrency', () => {
    it('reports one arrival for duplicate arrive requests', async () => {
      const who = people('pickup-dup-arrive');
      const trip = await acceptTrip(ctx, who);
      const results = await Promise.all(
        [0, 1, 2, 3].map(() =>
          post(ctx, `/trips/${trip.tripId}/arrive`, who.driver),
        ),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(results.filter((r) => r.body.changed === true)).toHaveLength(1);
      expect(results.every((r) => r.body.tripStatus === 'DRIVER_ARRIVED')).toBe(
        true,
      );
      const arrivals = (await outboxOf(ctx, trip.rideId)).filter(
        (r) => (r.payload as { status?: string }).status === 'DRIVER_ARRIVED',
      );
      expect(arrivals).toHaveLength(1);
      expect(statusCalls(ctx, 'DRIVER_ARRIVED')).toHaveLength(1);
    });

    it('confirms one pickup for duplicate pickup verifications', async () => {
      const who = people('pickup-dup-verify');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);

      const results = await Promise.all(
        [0, 1, 2, 3].map(() =>
          post(ctx, `/trips/${trip.tripId}/pickup/verify-otp`, who.driver, {
            otp: pickup,
          }),
        ),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(
        results.every((r) => r.body.tripStatus === 'PICKUP_VERIFIED'),
      ).toBe(true);
      const commands = (await outboxOf(ctx, trip.rideId)).filter(
        (r) => (r.payload as { status?: string }).status === 'PICKUP_VERIFIED',
      );
      expect(commands).toHaveLength(1);
      expect(statusCalls(ctx, 'PICKUP_VERIFIED')).toHaveLength(1);
    });
  });

  describe('cancellation', () => {
    it('cancels before the pickup with a reason (idempotent, no refund behaviour)', async () => {
      const who = people('pickup-cancel');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);

      const noReason = await post(
        ctx,
        `/trips/${trip.tripId}/cancel`,
        who.customer,
        {},
      );
      expect(noReason.status).toBe(400);
      const cancelled = await post(
        ctx,
        `/trips/${trip.tripId}/cancel`,
        who.customer,
        {
          reason: 'Customer not reachable',
        },
      ).expect(201);
      expect(cancelled.body).toMatchObject({
        tripStatus: 'CANCELLED',
        changed: true,
        paymentSync: 'DELIVERED',
      });
      const again = await post(
        ctx,
        `/trips/${trip.tripId}/cancel`,
        who.driver,
        {
          reason: 'Customer not reachable',
        },
      ).expect(201);
      expect(again.body).toMatchObject({
        tripStatus: 'CANCELLED',
        changed: false,
      });

      const remote = ctx.backend.bookings.get(trip.paymentBookingId);
      expect(remote).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Customer not reachable',
      });
      expect(remote?.trip?.status).toBe('CANCELLED');
      expect(ctx.backend.calls(/\/cancel$/)).toHaveLength(1);
      expect(ctx.backend.requests.some((r) => /refund/i.test(r.path))).toBe(
        false,
      );
      const row = await ctx.prisma.engineTrip.findUniqueOrThrow({
        where: { id: trip.tripId },
      });
      expect(row).toMatchObject({
        cancelledBy: 'CUSTOMER',
        cancellationReason: 'Customer not reachable',
      });
      expect(ctx.drivers.findById(who.driver).isAvailable).toBe(true);
    });

    it('never sends a pickup confirmation that was still waiting when the booking was cancelled', async () => {
      const who = people('pickup-superseded');
      const trip = await acceptTrip(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      ctx.backend.payBooking(trip.paymentBookingId);
      const { pickup } = await storedOtps(ctx, trip.rideId);
      ctx.backend.fail({
        match: (r) =>
          TRIP_STATUS.test(r.path) && r.body?.['status'] === 'PICKUP_VERIFIED',
        mode: 'STATUS_503',
      });
      await post(ctx, `/trips/${trip.tripId}/pickup/verify-otp`, who.driver, {
        otp: pickup,
      }).expect(503);

      await post(ctx, `/trips/${trip.tripId}/cancel`, who.driver, {
        reason: 'Vehicle broke down',
      }).expect(201);
      await makeDue(ctx, trip.rideId);
      await ctx.outbox.tick();

      const outbox = await outboxOf(ctx, trip.rideId);
      const command = outbox.find(
        (r) => (r.payload as { status?: string }).status === 'PICKUP_VERIFIED',
      );
      expect(command).toMatchObject({
        status: 'REFUSED',
        lastErrorCode: 'SUPERSEDED',
      });
      expect(outbox.at(-1)).toMatchObject({
        kind: 'CANCEL',
        status: 'DELIVERED',
      });
      expect(
        statusCalls(ctx, 'PICKUP_VERIFIED').filter((r) => r.status === 200),
      ).toEqual([]);
      expect(ctx.backend.bookings.get(trip.paymentBookingId)?.status).toBe(
        'CANCELLED',
      );
    });

    it('does not cancel a trip under way (prototype rule kept)', async () => {
      const who = people('pickup-no-cancel');
      const trip = await pickUp(ctx, who);
      await post(ctx, `/trips/${trip.tripId}/start`, who.driver).expect(201);
      const response = await post(
        ctx,
        `/trips/${trip.tripId}/cancel`,
        who.customer,
        { reason: 'Too late now' },
      );
      expect(response.status).toBe(400);
      expect(ctx.backend.calls(/\/cancel$/)).toEqual([]);
    });
  });
});
