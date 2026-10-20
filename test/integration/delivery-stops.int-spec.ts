import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { BookingStop, Prisma } from '../../src/generated/prisma/client';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  type TestAdmin,
  type TestCustomer,
  type TestDriver,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  bookedTrip,
  collect,
  deliverStops,
  engine,
  fundWallet,
  resolveStop,
  setStopStatus,
  setTripStatus,
  TO_DELIVERED,
  TO_IN_TRANSIT,
} from '../helpers/flows';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * The drops of a booking priced per drop (payment flow Phase 3): the stop state machine, the
 * current drop, the trip's DROP_PROGRESS / DELIVERED rules and admin resolution. A pay-at-delivery
 * drop is handed over only once that drop is paid (ARRIVED -> paymentGate -> PAYMENT_REQUIRED, or
 * PAYMENT_CONFIRMED -> handover allowed -> DELIVERED). A drop is paid here through its own QR, the
 * way per-drop collection (Phase 4, stop-collections) records it.
 */
describe('Drops of a booking priced per drop', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let category: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  interface UnderWay {
    readonly customer: TestCustomer;
    readonly driver: TestDriver;
    readonly bookingId: string;
    readonly tripId: string;
    readonly stops: BookingStop[];
  }

  /**
   * A booking priced per drop whose trip has started (IN_TRANSIT). Drops of Rs 200 and Rs 300 by
   * default, with a 10% fee split as Rs 20 and Rs 30. A pay-at-pickup booking is paid in cash at
   * the pickup first.
   */
  async function underWay(
    options: { method?: 'PAY_AT_DELIVERY' | 'PAY_AT_PICKUP'; drops?: number[] } = {},
  ): Promise<UnderWay> {
    const method = options.method ?? 'PAY_AT_DELIVERY';
    const drops = options.drops ?? [20_000, 30_000];
    const fare = drops.reduce((sum, paise) => sum + paise, 0);
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: method,
      farePaise: fare,
      dropPaise: drops,
      category,
      model: 'QUOTE_PER_STOP',
    });
    if (method === 'PAY_AT_PICKUP') {
      await fundWallet(ctx, admin, driver.driverId, 20_000);
      await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
      await collect(ctx, driver, trip.tripId, { method: 'CASH', amountPaise: fare }).expect(201);
      await advanceTrip(ctx, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
    } else {
      await advanceTrip(ctx, trip.tripId, TO_IN_TRANSIT);
    }
    return { customer, driver, ...trip, stops: await stopRows(trip.bookingId) };
  }

  const stopRows = (bookingId: string) =>
    ctx.prisma.bookingStop.findMany({ where: { bookingId }, orderBy: { sequence: 'asc' } });
  const tripRow = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });
  const internalView = (bookingId: string) =>
    engine(ctx).get(`/v1/internal/bookings/${bookingId}`).expect(200);

  function nth<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`expected an item at ${index}`);
    }
    return item;
  }

  /** Pays a drop through its own QR: shown, paid at Razorpay, confirmed on the driver's refresh. */
  async function payDrop(trip: UnderWay, index: number): Promise<string> {
    const stop = nth(trip.stops, index);
    const shown = await collect(ctx, trip.driver, trip.tripId, {
      method: 'ONLINE_QR',
      amountPaise: Number(stop.payablePaise),
      stopSequence: stop.sequence,
    }).expect(201);
    const collectionId = shown.body.collectionId as string;
    ctx.links.pay(ctx.links.byCollection(collectionId).referenceId);
    const paid = await request(ctx.server)
      .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
      .set(bearer(trip.driver.token))
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'COMPLETED', stopSequence: stop.sequence });
    return collectionId;
  }

  /**
   * A completed collection for one drop, written by the owner with the insert guard off. Only for
   * a transaction that the database then refuses: the guard is switched back on by its rollback
   * (a pending deferred check on the new row keeps ALTER TABLE from running before that).
   */
  async function insertPaidDropCollection(
    tx: Prisma.TransactionClient,
    trip: UnderWay,
    stop: BookingStop,
  ): Promise<void> {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 14);
    await tx.$executeRaw`ALTER TABLE payment_collections DISABLE TRIGGER trg_collections_insert_guard`;
    await tx.$executeRaw`
      INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method,
                                       amount_paise, collected_by_driver_id, status, provider,
                                       provider_product, provider_reference_id,
                                       provider_payment_id, idempotency_key, completed_at)
      VALUES (${trip.bookingId}::uuid, ${stop.id}::uuid, ${trip.tripId}::uuid, 'DELIVERY',
              'ONLINE_QR', ${stop.payablePaise}, ${trip.driver.driverId}::uuid, 'COMPLETED',
              'RAZORPAY', 'QR_CODE', ${`qr_${suffix}`}, ${`pay_${suffix}`}, ${randomUUID()}, now())`;
  }

  describe('order and the current drop', () => {
    it('reaches drops in order, one at a time, while the trip is under way', async () => {
      const trip = await underWay({ drops: [20_000, 30_000, 40_000] });
      const { bookingId, tripId } = trip;

      // The trip engine doesn't move this trip through delivery itself.
      expect(
        (await setTripStatus(ctx, tripId, 'DROP_PROGRESS').expect(409)).body.error,
      ).toMatchObject({ code: 'STOP_REQUIRED', details: { tripStatus: 'IN_TRANSIT' } });
      expect((await setTripStatus(ctx, tripId, 'DELIVERED').expect(409)).body.error).toMatchObject({
        code: 'STOPS_PENDING',
        details: { pendingStops: [1, 2, 3] },
      });
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE trips SET status = 'DROP_PROGRESS' WHERE id = ${tripId}::uuid`,
      ).rejects.toThrow(/reaches DROP_PROGRESS when its first drop is reached/);

      const early = await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(409);
      expect(early.body.error).toMatchObject({
        code: 'INVALID_STOP_TRANSITION',
        details: { from: 'PENDING', to: 'ARRIVED', currentStop: 1, reason: 'OUT_OF_ORDER' },
      });

      const reached = await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      expect(reached.body).toMatchObject({
        trip: { status: 'DROP_PROGRESS' },
        stops: [
          { sequence: 1, status: 'ARRIVED' },
          { sequence: 2, status: 'PENDING' },
          { sequence: 3, status: 'PENDING' },
        ],
        paymentGate: {
          stage: 'DROP',
          stopSequence: 1,
          paymentState: 'PAYMENT_REQUIRED',
          amountPaise: 20_000,
          cashFeePaise: 2_000,
          handoverAllowed: false,
        },
      });
      const arrivedAt = nth(await stopRows(bookingId), 0).arrivedAt;
      expect(arrivedAt).not.toBeNull();
      // Repeats change nothing; the next drop still waits for this one.
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      expect(nth(await stopRows(bookingId), 0).arrivedAt).toEqual(arrivedAt);
      await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(409);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'ARRIVED', arrived_at = now()
           WHERE id = ${nth(trip.stops, 1).id}::uuid`,
      ).rejects.toThrow(/Drops are reached in order|uq_booking_stops_current/);
    });

    it('validates the request: an existing drop, an engine status, a reason only for a failure', async () => {
      const { tripId } = await underWay();
      expect((await setStopStatus(ctx, tripId, 3, 'ARRIVED').expect(404)).body.error.code).toBe(
        'STOP_NOT_FOUND',
      );
      await setStopStatus(ctx, tripId, 0, 'ARRIVED').expect(404);
      const url = (sequence: string) => `/v1/internal/trips/${tripId}/stops/${sequence}/status`;
      await engine(ctx).post(url('first')).send({ status: 'ARRIVED' }).expect(400);
      // PAYMENT_CONFIRMED belongs to this backend.
      await engine(ctx).post(url('1')).send({ status: 'PAYMENT_CONFIRMED' }).expect(400);
      await engine(ctx).post(url('1')).send({ status: 'ARRIVED', amountPaise: 1 }).expect(400);
      const unwanted = await setStopStatus(ctx, tripId, 1, 'ARRIVED', 'Not needed').expect(400);
      expect(unwanted.body.error.details.fields).toEqual([
        { field: 'reason', issues: ['reason is only accepted with DELIVERY_FAILED'] },
      ]);
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED').expect(400);
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', ' x ').expect(400);
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'y'.repeat(201)).expect(400);
      await request(ctx.server).post(url('1')).send({ status: 'ARRIVED' }).expect(401);
    });

    it('reaches no drop before the trip has started', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { tripId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        dropPaise: [20_000],
        category,
        model: 'QUOTE_PER_STOP',
      });
      await advanceTrip(ctx, tripId, ['DRIVER_ARRIVED', 'PICKUP_VERIFIED']);
      expect((await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(409)).body.error).toMatchObject(
        {
          code: 'INVALID_STOP_TRANSITION',
          details: { reason: 'TRIP_NOT_UNDER_WAY', tripStatus: 'PICKUP_VERIFIED' },
        },
      );
    });
  });

  describe('pay at delivery: paid before the handover', () => {
    it('refuses to hand over an unpaid drop, in the API and in the database (table owner)', async () => {
      const trip = await underWay();
      const { bookingId, tripId } = trip;
      const [first, second] = [nth(trip.stops, 0), nth(trip.stops, 1)];
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);

      const refused = await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(409);
      expect(refused.body.error).toMatchObject({
        code: 'PAYMENT_REQUIRED',
        details: { stage: 'DROP', stopSequence: 1, amountPaise: 20_000 },
      });

      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'DELIVERED', delivered_at = now()
           WHERE id = ${first.id}::uuid`,
      ).rejects.toThrow(/Payment is required before this drop is handed over/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
           WHERE id = ${first.id}::uuid`,
      ).rejects.toThrow(/confirmed only by a completed collection for that drop/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE trips SET status = 'DELIVERED', delivered_at = now() WHERE id = ${tripId}::uuid`,
      ).rejects.toThrow(/delivered only once every drop is finished/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'CANCELLED', cancelled_at = now()
           WHERE id = ${second.id}::uuid`,
      ).rejects.toThrow(/A drop is cancelled only with its booking/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET delivered_at = now() WHERE id = ${first.id}::uuid`,
      ).rejects.toThrow(/delivery is recorded only when it is delivered/);

      // Drop 2's payment doesn't pay drop 1.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await insertPaidDropCollection(tx, trip, second);
          await tx.$executeRaw`
            UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
             WHERE id = ${first.id}::uuid`;
        }),
      ).rejects.toThrow(/confirmed only by a completed collection for that drop/);

      expect(await stopRows(bookingId)).toMatchObject([
        { status: 'ARRIVED', deliveredAt: null, paymentConfirmedAt: null },
        { status: 'PENDING', cancelledAt: null },
      ]);
      expect((await tripRow(tripId)).status).toBe('DROP_PROGRESS');
    });

    it('hands over a paid drop, and the last finished drop delivers the trip', async () => {
      const trip = await underWay();
      const { bookingId, tripId } = trip;
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      const collectionId = await payDrop(trip, 0);

      expect((await internalView(bookingId)).body.paymentGate).toEqual({
        stage: 'DROP',
        stopSequence: 1,
        paymentState: 'PAYMENT_CONFIRMED',
        amountPaise: 20_000,
        cashFeePaise: 2_000,
        handoverAllowed: true,
        collectionId,
        lastFailure: null,
      });
      const delivered = await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      expect(delivered.body.stops).toMatchObject([
        { sequence: 1, status: 'DELIVERED' },
        { sequence: 2, status: 'PENDING' },
      ]);
      expect(delivered.body.paymentGate).toMatchObject({
        stage: 'DROP',
        stopSequence: 2,
        paymentState: 'NOT_YET',
        amountPaise: 30_000,
        handoverAllowed: false,
      });
      // Repeats are harmless; a delivered drop can't fail any more.
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      expect(
        (await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Too late to fail').expect(409))
          .body.error.code,
      ).toBe('INVALID_STOP_TRANSITION');

      await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(200);
      await setStopStatus(ctx, tripId, 2, 'DELIVERED').expect(409);
      await payDrop(trip, 1);
      const last = await setStopStatus(ctx, tripId, 2, 'DELIVERED').expect(200);
      // Every drop is delivered and paid: the trip is delivered, and its payment confirmed with it.
      expect(last.body.trip.status).toBe('PAYMENT_CONFIRMED');
      expect(await stopRows(bookingId)).toMatchObject([
        {
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
          paymentConfirmedAt: expect.any(Date),
        },
        {
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
          paymentConfirmedAt: expect.any(Date),
        },
      ]);
      expect(
        (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus,
      ).toBe('PAID');
      // An engine report after the backend delivered the trip changes nothing.
      await setTripStatus(ctx, tripId, 'DELIVERED').expect(200);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    });
  });

  describe('failed attempts', () => {
    it('are retried, or resolved as undelivered by an admin with a reason and an audit record', async () => {
      const trip = await underWay();
      const { bookingId, tripId, driver } = trip;
      const first = nth(trip.stops, 0);
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);

      const failed = await setStopStatus(
        ctx,
        tripId,
        1,
        'DELIVERY_FAILED',
        'Receiver not at home',
      ).expect(200);
      expect(failed.body.stops[0]).toMatchObject({ sequence: 1, status: 'DELIVERY_FAILED' });
      expect(failed.body.paymentGate).toMatchObject({
        stopSequence: 1,
        paymentState: 'NOT_YET',
        handoverAllowed: false,
      });
      const firstFailure = nth(await stopRows(bookingId), 0);
      expect(firstFailure).toMatchObject({ failureReason: 'Receiver not at home' });

      // The next drop waits until this one is retried or resolved; a repeat changes nothing.
      expect(
        (await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(409)).body.error.details,
      ).toMatchObject({ reason: 'OUT_OF_ORDER', currentStop: 1 });
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Another reason').expect(200);
      expect(nth(await stopRows(bookingId), 0).failureReason).toBe('Receiver not at home');

      // The trip engine retries: the drop is current again, with the last failure kept on record.
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      const retried = nth(await stopRows(bookingId), 0);
      expect(retried).toMatchObject({ status: 'ARRIVED', failureReason: 'Receiver not at home' });
      expect(retried.arrivedAt?.getTime()).toBeGreaterThanOrEqual(
        firstFailure.failedAt?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Receiver refused the goods').expect(
        200,
      );

      // Admins only, with a reason, a known decision and an existing drop.
      await resolveStop(ctx, driver, bookingId, 1, {
        resolution: 'RETRY',
        reason: 'Drivers cannot resolve',
      }).expect(403);
      await resolveStop(ctx, admin, bookingId, 1, { resolution: 'RETRY', reason: 'x' }).expect(400);
      await request(ctx.server)
        .post(`/v1/admin/bookings/${bookingId}/stops/1/resolve`)
        .set(bearer(admin.token))
        .send({ resolution: 'SKIP', reason: 'Not a known decision' })
        .expect(400);
      await resolveStop(ctx, admin, bookingId, 9, {
        resolution: 'RETRY',
        reason: 'There is no such drop',
      }).expect(404);

      const retry = await resolveStop(ctx, admin, bookingId, 1, {
        resolution: 'RETRY',
        reason: 'Receiver called back',
      }).expect(200);
      expect(retry.body).toMatchObject({
        bookingId,
        changed: true,
        tripStatus: 'DROP_PROGRESS',
        stop: { sequence: 1, status: 'ARRIVED', failureReason: 'Receiver refused the goods' },
      });
      expect(
        (
          await resolveStop(ctx, admin, bookingId, 1, {
            resolution: 'RETRY',
            reason: 'Receiver called back',
          }).expect(200)
        ).body.changed,
      ).toBe(false);

      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Receiver refused again').expect(200);
      const undelivered = await resolveStop(ctx, admin, bookingId, 1, {
        resolution: 'UNDELIVERED',
        reason: 'Customer confirmed this drop is cancelled',
      }).expect(200);
      expect(undelivered.body).toMatchObject({
        changed: true,
        stop: {
          status: 'UNDELIVERED',
          failureReason: 'Receiver refused again',
          resolvedByUserId: admin.userId,
          resolutionReason: 'Customer confirmed this drop is cancelled',
        },
      });
      expect(undelivered.body.stop.resolvedAt).not.toBeNull();
      expect(
        (
          await resolveStop(ctx, admin, bookingId, 1, {
            resolution: 'UNDELIVERED',
            reason: 'Customer confirmed this drop is cancelled',
          }).expect(200)
        ).body.changed,
      ).toBe(false);
      expect(
        (
          await resolveStop(ctx, admin, bookingId, 1, {
            resolution: 'RETRY',
            reason: 'Too late to retry',
          }).expect(409)
        ).body.error.code,
      ).toBe('INVALID_STOP_TRANSITION');

      const audit = await ctx.prisma.adminAction.findMany({
        where: { targetType: 'BOOKING_STOP', targetId: first.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((row) => [row.action, row.actorUserId, row.reason])).toEqual([
        ['BOOKING_STOP_RETRY', admin.userId, 'Receiver called back'],
        ['BOOKING_STOP_UNDELIVERED', admin.userId, 'Customer confirmed this drop is cancelled'],
      ]);

      // The next drop can be reached now. A drop that never failed can't be resolved.
      await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(200);
      expect(
        (
          await resolveStop(ctx, admin, bookingId, 2, {
            resolution: 'UNDELIVERED',
            reason: 'It never failed',
          }).expect(409)
        ).body.error.code,
      ).toBe('INVALID_STOP_TRANSITION');
      await setStopStatus(ctx, tripId, 2, 'DELIVERY_FAILED', 'Shop closed').expect(200);
      const last = await resolveStop(ctx, admin, bookingId, 2, {
        resolution: 'UNDELIVERED',
        reason: 'Customer asked to return the goods',
      }).expect(200);
      // Every drop is finished, so the trip is delivered. Nothing was collected, so it can't
      // complete (an admin cancels it, N5).
      expect(last.body.tripStatus).toBe('DELIVERED');
      expect((await setTripStatus(ctx, tripId, 'COMPLETED').expect(409)).body.error.code).toBe(
        'PAYMENT_REQUIRED',
      );
    });

    it('the database requires an admin and the audit record in the same transaction', async () => {
      const trip = await underWay();
      const { bookingId, tripId, driver } = trip;
      const first = nth(trip.stops, 0);
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Receiver not at home').expect(200);
      const reason = 'Resolved directly in the database';
      const resolve = (tx: Prisma.TransactionClient, userId: string) =>
        tx.$executeRaw`
          UPDATE booking_stops
             SET status = 'UNDELIVERED', resolved_at = now(),
                 resolved_by_user_id = ${userId}::uuid, resolution_reason = ${reason}
           WHERE id = ${first.id}::uuid`;
      const audit = (tx: Prisma.TransactionClient, auditReason: string) =>
        tx.adminAction.create({
          data: {
            actorUserId: admin.userId,
            action: 'BOOKING_STOP_UNDELIVERED',
            targetType: 'BOOKING_STOP',
            targetId: first.id,
            reason: auditReason,
          },
        });

      await expect(ctx.prisma.$transaction((tx) => resolve(tx, admin.userId))).rejects.toThrow(
        /needs its admin audit record in the same transaction/,
      );
      await expect(ctx.prisma.$transaction((tx) => resolve(tx, driver.userId))).rejects.toThrow(
        /Only an admin resolves a failed drop as undelivered/,
      );
      // A record with another reason does not describe this resolution.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await audit(tx, 'Some other reason');
          await resolve(tx, admin.userId);
        }),
      ).rejects.toThrow(/needs its admin audit record/);
      // Neither does a record committed earlier, by another transaction.
      await audit(ctx.prisma, reason);
      await expect(ctx.prisma.$transaction((tx) => resolve(tx, admin.userId))).rejects.toThrow(
        /needs its admin audit record/,
      );
      expect(nth(await stopRows(bookingId), 0).status).toBe('DELIVERY_FAILED');

      // With its own record in the same transaction, it is accepted (positive control).
      await ctx.prisma.$transaction(async (tx) => {
        await audit(tx, reason);
        await resolve(tx, admin.userId);
      });
      expect(nth(await stopRows(bookingId), 0)).toMatchObject({
        status: 'UNDELIVERED',
        resolvedByUserId: admin.userId,
      });
    });

    it('a pay-at-pickup drop that failed is retried and handed over without another payment', async () => {
      const { tripId } = await underWay({ method: 'PAY_AT_PICKUP' });
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      await setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Gate was locked').expect(200);
      const retried = await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      expect(retried.body.stops[0].status).toBe('ARRIVED');
      expect(retried.body.paymentGate).toMatchObject({
        stopSequence: 1,
        paymentState: 'NOT_REQUIRED',
        handoverAllowed: true,
      });
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      await deliverStops(ctx, tripId, [2]);
      expect((await tripRow(tripId)).status).toBe('PAYMENT_CONFIRMED');
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    });
  });

  describe('cancellation', () => {
    it('cancels the drops not finished with the booking; nothing moves afterwards', async () => {
      const trip = await underWay({ drops: [20_000, 30_000, 40_000] });
      const { bookingId, tripId } = trip;
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      await payDrop(trip, 0);
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(200);

      const cancelled = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'Customer cancelled the rest' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        trip: { status: 'CANCELLED' },
        stops: [
          { sequence: 1, status: 'DELIVERED' },
          { sequence: 2, status: 'CANCELLED' },
          { sequence: 3, status: 'CANCELLED' },
        ],
        paymentGate: { paymentState: 'NOT_REQUIRED', handoverAllowed: false },
      });
      expect((await stopRows(bookingId)).map((stop) => stop.cancelledAt !== null)).toEqual([
        false,
        true,
        true,
      ]);

      expect((await setStopStatus(ctx, tripId, 2, 'DELIVERED').expect(409)).body.error.code).toBe(
        'BOOKING_CLOSED',
      );
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      expect(
        (
          await resolveStop(ctx, admin, bookingId, 3, {
            resolution: 'RETRY',
            reason: 'After the cancellation',
          }).expect(409)
        ).body.error.code,
      ).toBe('BOOKING_CLOSED');
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'PENDING' WHERE id = ${nth(trip.stops, 2).id}::uuid`,
      ).rejects.toThrow(/closed or unassigned booking cannot move/);
    });
  });

  describe('concurrency', () => {
    it('duplicate and racing reports have exactly one outcome', async () => {
      const trip = await underWay();
      const { bookingId, tripId } = trip;
      const arrivals = await Promise.all(
        Array.from({ length: 8 }, () => setStopStatus(ctx, tripId, 1, 'ARRIVED')),
      );
      expect(arrivals.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
      expect((await tripRow(tripId)).status).toBe('DROP_PROGRESS');

      // Drop 2 is refused whichever runs first: drop 1 is current, then failed, never finished.
      const [early, failure] = await Promise.all([
        setStopStatus(ctx, tripId, 2, 'ARRIVED'),
        setStopStatus(ctx, tripId, 1, 'DELIVERY_FAILED', 'Receiver not at home'),
      ]);
      expect([early.status, failure.status]).toEqual([409, 200]);
      expect((await stopRows(bookingId)).map((stop) => stop.status)).toEqual([
        'DELIVERY_FAILED',
        'PENDING',
      ]);

      // Five admins resolving at once: one decision, one audit record.
      const decisions = await Promise.all(
        Array.from({ length: 5 }, () =>
          resolveStop(ctx, admin, bookingId, 1, {
            resolution: 'UNDELIVERED',
            reason: 'Customer cancelled this drop',
          }),
        ),
      );
      expect(decisions.map((res) => res.status)).toEqual(Array.from({ length: 5 }, () => 200));
      expect(decisions.filter((res) => res.body.changed === true)).toHaveLength(1);
      expect(
        await ctx.prisma.adminAction.count({
          where: {
            targetType: 'BOOKING_STOP',
            targetId: nth(trip.stops, 0).id,
            action: 'BOOKING_STOP_UNDELIVERED',
          },
        }),
      ).toBe(1);
    });

    it('a cancellation racing an arrival leaves every unfinished drop cancelled', async () => {
      const trip = await underWay();
      const [cancel, arrival] = await Promise.all([
        engine(ctx)
          .post(`/v1/internal/bookings/${trip.bookingId}/cancel`)
          .send({ reason: 'Customer cancelled' }),
        setStopStatus(ctx, trip.tripId, 1, 'ARRIVED'),
      ]);
      expect(cancel.status).toBe(200);
      if (arrival.status !== 200) {
        expect([arrival.status, arrival.body.error.code]).toEqual([409, 'BOOKING_CLOSED']);
      }
      expect((await stopRows(trip.bookingId)).map((stop) => stop.status)).toEqual([
        'CANCELLED',
        'CANCELLED',
      ]);
    });
  });

  describe('historical bookings', () => {
    it('keep the engine-reported delivery and the whole-booking collection after it', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const legacy = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        category,
        model: 'LEGACY_BOOKING_LEVEL',
      });
      await advanceTrip(ctx, legacy.tripId, TO_DELIVERED);
      expect(
        (await setStopStatus(ctx, legacy.tripId, 1, 'ARRIVED').expect(404)).body.error.code,
      ).toBe('STOP_NOT_FOUND');
      expect((await internalView(legacy.bookingId)).body).toMatchObject({
        paymentModel: 'LEGACY_BOOKING_LEVEL',
        stops: [],
        paymentGate: {
          stage: 'DROP',
          stopSequence: null,
          paymentState: 'PAYMENT_REQUIRED',
          amountPaise: 50_000,
          cashFeePaise: 5_000,
          handoverAllowed: false,
        },
      });
      await fundWallet(ctx, admin, driver.driverId, 10_000);
      await collect(ctx, driver, legacy.tripId, { method: 'CASH', amountPaise: 50_000 }).expect(
        201,
      );
      await setTripStatus(ctx, legacy.tripId, 'COMPLETED').expect(200);
    });
  });

  describe('views', () => {
    it('customers see each drop and the gate without ids or fees; drivers see which drops are paid; admins see every fact', async () => {
      const trip = await underWay();
      const { customer, driver, bookingId, tripId } = trip;
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      await payDrop(trip, 0);
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, tripId, 2, 'ARRIVED').expect(200);

      const customerView = await request(ctx.server)
        .get(`/v1/bookings/${bookingId}`)
        .set(bearer(customer.token))
        .expect(200);
      expect(customerView.body.stops).toEqual([
        { sequence: 1, payablePaise: 20_000, state: 'DELIVERED' },
        { sequence: 2, payablePaise: 30_000, state: 'ARRIVED' },
      ]);
      expect(customerView.body.paymentGate).toEqual({
        stage: 'DROP',
        stopSequence: 2,
        paymentState: 'PAYMENT_REQUIRED',
        amountPaise: 30_000,
        handoverAllowed: false,
      });

      const driverView = await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(driverView.body.payment.stops).toEqual([
        { sequence: 1, payablePaise: 20_000, status: 'DELIVERED', paid: true },
        { sequence: 2, payablePaise: 30_000, status: 'ARRIVED', paid: false },
      ]);
      expect(driverView.body.payment.paymentGate).toMatchObject({
        stopSequence: 2,
        paymentState: 'PAYMENT_REQUIRED',
        cashFeePaise: 3_000,
        collectionId: null,
      });
      const list = await request(ctx.server)
        .get('/v1/trips?active=true')
        .set(bearer(driver.token))
        .expect(200);
      expect(
        (list.body as { tripId: string; payment: unknown }[]).find((row) => row.tripId === tripId)
          ?.payment,
      ).toEqual(driverView.body.payment);

      const chain = await request(ctx.server)
        .get(`/v1/admin/bookings/${bookingId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(chain.body.booking.paymentModel).toBe('QUOTE_PER_STOP');
      expect(chain.body.stops).toMatchObject([
        { sequence: 1, status: 'DELIVERED', platformFeeSharePaise: 2_000 },
        { sequence: 2, status: 'ARRIVED', deliveredAt: null },
      ]);
      expect(chain.body.stops[0].paymentConfirmedAt).not.toBeNull();
      expect(chain.body.stops[0].deliveredAt).not.toBeNull();
    });
  });
});
