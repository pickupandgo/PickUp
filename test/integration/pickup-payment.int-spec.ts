import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import request from 'supertest';
import {
  bearer,
  createAdmin,
  createCustomer,
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
  type PaymentModel,
  setStopStatus,
  setTripStatus,
  settleAndSync,
} from '../helpers/flows';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_INTERNAL_API_KEY } from '../helpers/test-config';

/**
 * PAY_AT_PICKUP (payment flow Phase 3): the booking is paid at the pickup before the goods are
 * handed over. DRIVER_ARRIVED -> payment required -> booking PAID -> PICKUP_VERIFIED -> IN_TRANSIT.
 * Until it is paid the pickup OTP / handover is refused with PAYMENT_REQUIRED, the trip can't
 * start, and the database refuses the same moves on its own, even from the table owner.
 */
describe('Pickup payment gate (PAY_AT_PICKUP)', () => {
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

  interface ArrivedTrip {
    readonly customer: TestCustomer;
    readonly driver: TestDriver;
    readonly bookingId: string;
    readonly tripId: string;
  }

  /** Rs 200 + Rs 300 drops (Rs 50 fee), paid at pickup; the driver has reached the pickup. */
  async function arrivedAtPickup(
    options: { walletPaise?: number; model?: PaymentModel } = {},
  ): Promise<ArrivedTrip> {
    const customer = await createCustomer(ctx);
    const driver = await createHistoricalEligibleDriver(ctx);
    const model = options.model ?? 'QUOTE_PER_STOP';
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model,
      ...(model === 'QUOTE_PER_STOP' ? { dropPaise: [20_000, 30_000] } : {}),
    });
    if (options.walletPaise) {
      await fundWallet(ctx, admin, driver.driverId, options.walletPaise);
    }
    await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    return { customer, driver, ...trip };
  }

  const tripRow = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });
  const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const internalView = (bookingId: string) =>
    engine(ctx).get(`/v1/internal/bookings/${bookingId}`).expect(200);

  describe('while unpaid', () => {
    it('refuses the pickup handover and the start with PAYMENT_REQUIRED, and shows why', async () => {
      const { customer, driver, bookingId, tripId } = await arrivedAtPickup();

      const view = await internalView(bookingId);
      expect(view.body.paymentGate).toEqual({
        stage: 'PICKUP',
        stopSequence: null,
        paymentState: 'PAYMENT_REQUIRED',
        amountPaise: 50_000,
        cashFeePaise: 5_000,
        handoverAllowed: false,
        collectionId: null,
        lastFailure: null,
      });

      const handover = await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409);
      expect(handover.body.error).toMatchObject({
        code: 'PAYMENT_REQUIRED',
        details: { stage: 'PICKUP', amountPaise: 50_000, tripStatus: 'DRIVER_ARRIVED' },
      });
      for (const status of ['IN_TRANSIT', 'DELIVERED', 'COMPLETED'] as const) {
        const refused = await setTripStatus(ctx, tripId, status).expect(409);
        expect(refused.body.error.code).toBe('PAYMENT_REQUIRED');
      }
      const drop = await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(409);
      expect(drop.body.error).toMatchObject({
        code: 'INVALID_STOP_TRANSITION',
        details: { reason: 'TRIP_NOT_UNDER_WAY', tripStatus: 'DRIVER_ARRIVED' },
      });
      // Repeating the arrival is still harmless.
      await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);

      expect(await tripRow(tripId)).toMatchObject({
        status: 'DRIVER_ARRIVED',
        pickupVerifiedAt: null,
        startedAt: null,
      });
      expect(
        (await ctx.prisma.bookingStop.findMany({ where: { bookingId } })).map((s) => s.status),
      ).toEqual(['PENDING', 'PENDING']);

      // The driver sees the same gate; the customer sees it without ids or the fee.
      const driverView = await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(driverView.body.payment).toMatchObject({
        collectionStage: 'PICKUP',
        collectionOpen: true,
        paymentGate: { paymentState: 'PAYMENT_REQUIRED', handoverAllowed: false },
        stops: [
          { sequence: 1, payablePaise: 20_000, status: 'PENDING', paid: false },
          { sequence: 2, payablePaise: 30_000, status: 'PENDING', paid: false },
        ],
      });
      const customerView = await request(ctx.server)
        .get(`/v1/bookings/${bookingId}`)
        .set(bearer(customer.token))
        .expect(200);
      expect(customerView.body.paymentGate).toEqual({
        stage: 'PICKUP',
        stopSequence: null,
        paymentState: 'PAYMENT_REQUIRED',
        amountPaise: 50_000,
        handoverAllowed: false,
      });
      expect(customerView.body.stops).toEqual([
        { sequence: 1, payablePaise: 20_000, state: 'UPCOMING' },
        { sequence: 2, payablePaise: 30_000, state: 'UPCOMING' },
      ]);
    });

    it('is not yet owed before the driver reaches the pickup', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createHistoricalEligibleDriver(ctx);
      const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 50_000,
        category,
      });
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        stage: 'PICKUP',
        paymentState: 'NOT_YET',
        handoverAllowed: false,
      });
      // Collection opens only at the pickup, and the handover can't be skipped to.
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(409);
      const skipped = await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409);
      expect(skipped.body.error.code).toBe('INVALID_TRIP_TRANSITION');
    });

    it('the database refuses the handover and the start on its own, even for the table owner', async () => {
      const { tripId } = await arrivedAtPickup();
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now()
           WHERE id = ${tripId}::uuid`,
      ).rejects.toThrow(/Payment is required before the pickup handover/);

      // Even past a bypassed pickup, a booking priced per drop can't start unpaid.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`ALTER TABLE trips DISABLE TRIGGER trg_trips_guard`;
          await tx.$executeRaw`
            UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now()
             WHERE id = ${tripId}::uuid`;
          await tx.$executeRaw`ALTER TABLE trips ENABLE TRIGGER trg_trips_guard`;
          await tx.$executeRaw`
            UPDATE trips SET status = 'IN_TRANSIT', started_at = now() WHERE id = ${tripId}::uuid`;
        }),
      ).rejects.toThrow(/Payment is required before the pickup handover/);
      expect((await tripRow(tripId)).status).toBe('DRIVER_ARRIVED');
    });
  });

  describe('once paid', () => {
    it('cash at the pickup opens the gate; the trip then starts and its drops are handed over', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
      const cash = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);

      expect((await internalView(bookingId)).body.paymentGate).toEqual({
        stage: 'PICKUP',
        stopSequence: null,
        paymentState: 'PAYMENT_CONFIRMED',
        amountPaise: 50_000,
        cashFeePaise: 5_000,
        handoverAllowed: true,
        collectionId: cash.body.collectionId,
        lastFailure: null,
      });
      await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
      const started = await setTripStatus(ctx, tripId, 'IN_TRANSIT').expect(200);
      expect(started.body.paymentGate).toMatchObject({
        stage: 'DROP',
        stopSequence: 1,
        paymentState: 'NOT_REQUIRED',
        handoverAllowed: false,
      });

      // Paid at the pickup: each reached drop is handed over without a payment of its own.
      const reached = await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);
      expect(reached.body.trip.status).toBe('DROP_PROGRESS');
      expect(reached.body.paymentGate).toMatchObject({
        stage: 'DROP',
        stopSequence: 1,
        paymentState: 'NOT_REQUIRED',
        handoverAllowed: true,
      });
      await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(200);
      await deliverStops(ctx, tripId, [2]);
      // The last drop delivered the trip, and the paid booking confirmed it.
      expect(await tripRow(tripId)).toMatchObject({ status: 'PAYMENT_CONFIRMED' });
      await setTripStatus(ctx, tripId, 'DELIVERED').expect(200);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({ settlement: 'CASH', grossAmountPaise: 50_000n, platformFeePaise: 5_000n });
    });

    it('a QR is PROCESSING while open and FAILED once expired; paying a new one opens the gate', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup();
      const first = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const firstId = first.body.collectionId as string;
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        paymentState: 'PAYMENT_PROCESSING',
        collectionId: firstId,
        handoverAllowed: false,
      });
      expect(
        (await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409)).body.error.code,
      ).toBe('PAYMENT_REQUIRED');

      ctx.links.expire(ctx.links.byCollection(firstId).referenceId);
      await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${firstId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        paymentState: 'PAYMENT_FAILED',
        collectionId: firstId,
        lastFailure: 'EXPIRED',
        handoverAllowed: false,
      });
      await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409);

      const second = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const secondId = second.body.collectionId as string;
      ctx.links.pay(ctx.links.byCollection(secondId).referenceId);
      await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${secondId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        paymentState: 'PAYMENT_CONFIRMED',
        collectionId: secondId,
        handoverAllowed: true,
      });
      await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
      expect((await bookingRow(bookingId)).paymentStatus).toBe('PAID');
    });
  });

  describe('historical bookings', () => {
    it('get the same gate when they next leave the pickup (N2)', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({
        walletPaise: 10_000,
        model: 'LEGACY_BOOKING_LEVEL',
      });
      expect(
        (await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409)).body.error,
      ).toMatchObject({
        code: 'PAYMENT_REQUIRED',
        details: { stage: 'PICKUP', amountPaise: 50_000 },
      });
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      // Paid: the historical engine-reported order otherwise stays as it was.
      await advanceTrip(ctx, tripId, [
        'PICKUP_VERIFIED',
        'IN_TRANSIT',
        'DROP_PROGRESS',
        'DELIVERED',
      ]);
      expect((await tripRow(tripId)).status).toBe('PAYMENT_CONFIRMED');
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      expect((await bookingRow(bookingId)).status).toBe('COMPLETED');
    });

    it('a trip that passed the pickup unpaid before the gate existed carries on and is still collectable', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({
        walletPaise: 10_000,
        model: 'LEGACY_BOOKING_LEVEL',
      });
      // As the trip engine could report it before this phase: past the pickup, unpaid.
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE trips DISABLE TRIGGER trg_trips_guard`;
        await tx.$executeRaw`
          UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now()
           WHERE id = ${tripId}::uuid`;
        await tx.$executeRaw`ALTER TABLE trips ENABLE TRIGGER trg_trips_guard`;
      });
      await setTripStatus(ctx, tripId, 'IN_TRANSIT').expect(200);
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        stage: 'PICKUP',
        paymentState: 'PAYMENT_REQUIRED',
        handoverAllowed: true,
      });
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      await advanceTrip(ctx, tripId, ['DROP_PROGRESS', 'DELIVERED']);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    });
  });

  describe('other payment methods', () => {
    it('pay-at-delivery and historical prepaid pickups are not gated', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createHistoricalEligibleDriver(ctx);
      const delivery = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        dropPaise: [50_000],
        category,
        model: 'QUOTE_PER_STOP',
      });
      await setTripStatus(ctx, delivery.tripId, 'DRIVER_ARRIVED').expect(200);
      expect((await internalView(delivery.bookingId)).body.paymentGate).toEqual({
        stage: 'PICKUP',
        stopSequence: null,
        paymentState: 'NOT_REQUIRED',
        amountPaise: null,
        cashFeePaise: null,
        handoverAllowed: true,
        collectionId: null,
        lastFailure: null,
      });
      await setTripStatus(ctx, delivery.tripId, 'PICKUP_VERIFIED').expect(200);

      const prepaid = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 50_000,
        category,
      });
      await advanceTrip(ctx, prepaid.tripId, ['DRIVER_ARRIVED', 'PICKUP_VERIFIED']);
    });
  });

  describe('concurrency', () => {
    it('a handover racing the cash collection never goes through unpaid', async () => {
      for (let round = 0; round < 4; round += 1) {
        const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
        const [handover, cash] = await Promise.all([
          setTripStatus(ctx, tripId, 'PICKUP_VERIFIED'),
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
        ]);
        expect(cash.status).toBe(201);
        if (handover.status !== 200) {
          expect([handover.status, handover.body.error.code]).toEqual([409, 'PAYMENT_REQUIRED']);
          await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
        }
        const trip = await tripRow(tripId);
        const collection = await ctx.prisma.paymentCollection.findFirstOrThrow({
          where: { bookingId, status: 'COMPLETED' },
        });
        expect(trip.status).toBe('PICKUP_VERIFIED');
        expect((await bookingRow(bookingId)).paymentStatus).toBe('PAID');
        // The handover is recorded only after the payment was.
        expect(trip.pickupVerifiedAt?.getTime()).toBeGreaterThanOrEqual(
          collection.completedAt?.getTime() ?? Number.POSITIVE_INFINITY,
        );
      }
    });

    it('repeated and concurrent handover reports after payment apply once', async () => {
      const { driver, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => setTripStatus(ctx, tripId, 'PICKUP_VERIFIED')),
      );
      expect(results.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
      const verifiedAt = (await tripRow(tripId)).pickupVerifiedAt;
      await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
      expect((await tripRow(tripId)).pickupVerifiedAt).toEqual(verifiedAt);
    });
  });

  describe('collecting the pickup obligation (payment flow Phase 4)', () => {
    const feeDebits = (driverId: string) =>
      ctx.prisma.driverWalletTransaction.findMany({
        where: { wallet: { driverId }, type: 'CASH_RIDE_FEE' },
      });

    it('cash: one fee debit and the collection together, the booking PAID, the answer from the server', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
      const res = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);
      expect(res.body).toMatchObject({
        stage: 'PICKUP',
        stopSequence: null,
        status: 'COMPLETED',
        platformFeePaise: 5_000,
        bookingPaymentStatus: 'PAID',
        paymentGate: { stage: 'PICKUP', paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true },
      });
      // The fee frozen on the booking, debited once, keyed to this collection.
      expect(
        (await feeDebits(driver.driverId)).map((debit) => [
          debit.idempotencyKey,
          debit.amountPaise,
        ]),
      ).toEqual([[`cash-ride-fee:collection:${res.body.collectionId as string}`, 5_000n]]);
      expect((await bookingRow(bookingId)).paymentStatus).toBe('PAID');
      await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
    });

    it('a historical booking keeps its one fee debit per booking', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({
        walletPaise: 10_000,
        model: 'LEGACY_BOOKING_LEVEL',
      });
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      expect((await feeDebits(driver.driverId)).map((debit) => debit.idempotencyKey)).toEqual([
        `cash-ride-fee:${bookingId}`,
      ]);
    });

    it('wallet shortfall, a drop named, or another amount: refused, nothing recorded', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 1_000 });
      const short = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(short.body.error).toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        details: { requiredFeePaise: 5_000 },
      });
      const withDrop = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
        stopSequence: 1,
      }).expect(400);
      expect(withDrop.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'stopSequence' }] },
      });
      for (const amountPaise of [20_000, 49_999]) {
        const wrong = await collect(ctx, driver, tripId, {
          method: 'ONLINE_QR',
          amountPaise,
        }).expect(422);
        expect(wrong.body.error).toMatchObject({
          code: 'COLLECTION_AMOUNT_MISMATCH',
          details: { expectedPaise: 50_000 },
        });
      }
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(0);
      expect(await feeDebits(driver.driverId)).toEqual([]);
      expect((await internalView(bookingId)).body.paymentGate).toMatchObject({
        paymentState: 'PAYMENT_REQUIRED',
        handoverAllowed: false,
      });
    });

    it('duplicate cash (same key, concurrent, other keys): one collection, one debit', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
      const key = 'pickup-cash-duplicate';
      const same = await Promise.all(
        Array.from({ length: 4 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }, key),
        ),
      );
      expect(same.map((res) => res.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(same.map((res) => res.body.collectionId)).size).toBe(1);
      const others = await Promise.all(
        Array.from({ length: 3 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
        ),
      );
      for (const res of others) {
        expect([res.status, res.body.error.code]).toEqual([409, 'BOOKING_ALREADY_PAID']);
      }
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(1);
      expect(await feeDebits(driver.driverId)).toHaveLength(1);
    });

    it('cash closes an open QR first, and a paid booking refuses any second collection', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup({ walletPaise: 10_000 });
      const shown = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: shown.body.collectionId as string },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'CANCELLED_FOR_CASH' });
      expect(ctx.links.byCollection(shown.body.collectionId as string).status).toBe('CANCELLED');
      for (const method of ['CASH', 'ONLINE_QR'] as const) {
        const again = await collect(ctx, driver, tripId, { method, amountPaise: 50_000 }).expect(
          409,
        );
        expect(again.body.error.code).toBe('BOOKING_ALREADY_PAID');
      }
      expect(
        await ctx.prisma.paymentCollection.count({ where: { bookingId, status: 'COMPLETED' } }),
      ).toBe(1);
    });

    it('QR: confirmed by Razorpay, the trip completes, and the earning is payable once settled', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup();
      const shown = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const link = ctx.links.byCollection(shown.body.collectionId as string);
      expect(link).toMatchObject({ stage: 'PICKUP', stopId: null, amount: 50_000 });
      const payment = ctx.links.pay(link.referenceId);
      const confirmed = await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${shown.body.collectionId as string}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(confirmed.body).toMatchObject({
        status: 'COMPLETED',
        bookingPaymentStatus: 'PAID',
        paymentGate: { paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true },
      });
      await advanceTrip(ctx, tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
      await deliverStops(ctx, tripId, [1, 2]);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId },
        include: { collectionLinks: true },
      });
      expect(earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        collectionId: shown.body.collectionId,
        grossAmountPaise: 50_000n,
        platformFeePaise: 5_000n,
      });
      expect(earning.collectionLinks).toHaveLength(1);
      await settleAndSync(ctx, payment.id, 50_000);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('PAYABLE');
    });
  });

  describe('authorization', () => {
    it('only the trip engine moves a trip; drivers and customers read only their own gate', async () => {
      const { customer, driver, bookingId, tripId } = await arrivedAtPickup();
      const otherDriver = await createHistoricalEligibleDriver(ctx);
      const otherCustomer = await createCustomer(ctx);
      for (const token of [driver.token, customer.token, admin.token]) {
        const res = await request(ctx.server)
          .post(`/v1/internal/trips/${tripId}/status`)
          .set(bearer(token))
          .send({ status: 'PICKUP_VERIFIED' })
          .expect(401);
        expect(res.body.error.code).toBe('INTERNAL_AUTH_INVALID');
      }
      await request(ctx.server)
        .post(`/v1/internal/trips/${tripId}/status`)
        .set('X-Internal-Api-Key', `${TEST_INTERNAL_API_KEY}x`)
        .send({ status: 'PICKUP_VERIFIED' })
        .expect(401);
      await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(otherDriver.token))
        .expect(404);
      await request(ctx.server)
        .get(`/v1/bookings/${bookingId}`)
        .set(bearer(otherCustomer.token))
        .expect(404);
      // The engine can't claim the payment itself.
      await engine(ctx)
        .post(`/v1/internal/trips/${tripId}/status`)
        .send({ status: 'PAYMENT_CONFIRMED' })
        .expect(400);
      expect((await tripRow(tripId)).status).toBe('DRIVER_ARRIVED');
    });
  });
});
