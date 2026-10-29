import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import request from 'supertest';
import { EarningsReconciliationService } from '../../src/reconciliation/earnings-reconciliation.service';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import {
  bearer,
  createAdmin,
  createCustomer,
  createFeeRule,
  idempotencyKey,
  type TestAdmin,
  type TestDriver,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  bookedTrip,
  collect,
  engine,
  fundWallet,
  type PaymentMethod,
  setTripStatus,
  settleAndSync,
  TO_DELIVERED,
} from '../helpers/flows';
import { sendWebhook, startTopUp, walletBalance } from '../helpers/http';
import {
  buildCollectionPaymentWebhook,
  buildPaymentLinkWebhook,
  buildWebhook,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Pickup / delivery payment (V1 rule 5B): cash recorded by the driver with the 10% platform fee
 * debited from the driver wallet, or a booking-linked Razorpay QR paid to Nikhil Enterprises.
 * Required tests #6-#10.
 */
describe('Pickup and delivery collections', () => {
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

  async function tripReadyToCollect(
    options: {
      method?: PaymentMethod;
      farePaise?: number;
      walletPaise?: number;
      driver?: TestDriver;
    } = {},
  ) {
    const customer = await createCustomer(ctx);
    const driver = options.driver ?? (await createHistoricalEligibleDriver(ctx));
    const method = options.method ?? 'PAY_AT_DELIVERY';
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: method,
      farePaise: options.farePaise ?? 50_000,
      category,
    });
    if (options.walletPaise) {
      await fundWallet(ctx, admin, driver.driverId, options.walletPaise);
    }
    await advanceTrip(
      ctx,
      trip.tripId,
      method === 'PAY_AT_PICKUP' ? ['DRIVER_ARRIVED'] : TO_DELIVERED,
    );
    return { customer, driver, ...trip };
  }

  const booking = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const feeDebits = (driverId: string) =>
    ctx.prisma.driverWalletTransaction.findMany({
      where: { wallet: { driverId }, type: 'CASH_RIDE_FEE' },
    });

  describe('cash', () => {
    it('#7 debits the 10% platform fee from the wallet, atomically with the cash record', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 10_000 });

      const res = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);
      expect(res.body).toMatchObject({
        method: 'CASH',
        status: 'COMPLETED',
        stage: 'DELIVERY',
        amountPaise: 50_000,
        platformFeePaise: 5_000,
        replayed: false,
      });

      expect(await walletBalance(ctx, driver.driverId)).toBe(5_000n);
      const [debit] = await feeDebits(driver.driverId);
      expect(debit).toMatchObject({
        direction: 'DEBIT',
        amountPaise: 5_000n,
        balanceAfterPaise: 5_000n,
        referenceType: 'BOOKING',
        referenceId: bookingId,
        idempotencyKey: `cash-ride-fee:${bookingId}`,
      });
      const collection = await ctx.prisma.paymentCollection.findUniqueOrThrow({
        where: { id: res.body.collectionId },
      });
      expect(collection.walletTransactionId).toBe(debit?.id);
      expect(await booking(bookingId)).toMatchObject({ paymentStatus: 'PAID' });
      expect((await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe(
        'PAYMENT_CONFIRMED',
      );

      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        grossAmountPaise: 50_000n,
        platformFeePaise: 5_000n,
        netAmountPaise: 45_000n,
        collectionId: collection.id,
        payableAt: null,
      });
      // The wallet balance is never the driver's earnings.
      const summary = await request(ctx.server)
        .get('/v1/earnings/summary')
        .set(bearer(driver.token))
        .expect(200);
      expect(summary.body).toMatchObject({ settledInCashPaise: 45_000, payablePaise: 0 });
    });

    it('#6 the same cash collection sent twice (and concurrently) is recorded once', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 20_000 });
      const key = idempotencyKey();

      const first = await collect(
        ctx,
        driver,
        tripId,
        { method: 'CASH', amountPaise: 50_000 },
        key,
      ).expect(201);
      const repeats = await Promise.all(
        Array.from({ length: 5 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }, key),
        ),
      );
      for (const repeat of repeats) {
        expect(repeat.status).toBe(201);
        expect(repeat.body).toMatchObject({
          collectionId: first.body.collectionId,
          replayed: true,
        });
      }

      const otherKey = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(otherKey.body.error.code).toBe('BOOKING_ALREADY_PAID');
      const reused = await collect(
        ctx,
        driver,
        tripId,
        { method: 'ONLINE_QR', amountPaise: 50_000 },
        key,
      ).expect(409);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(1);
      expect(await feeDebits(driver.driverId)).toHaveLength(1);
      expect(await walletBalance(ctx, driver.driverId)).toBe(15_000n);
    });

    it('#6 concurrent cash requests with different keys still record the booking once', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 20_000 });

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const rejected of results.filter((r) => r.status !== 201)) {
        expect(rejected.status).toBe(409);
      }
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(1);
      expect(await feeDebits(driver.driverId)).toHaveLength(1);
      expect(await walletBalance(ctx, driver.driverId)).toBe(15_000n);
    });

    it('#8 an insufficient wallet rejects the cash record and changes nothing', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 3_000 });

      const res = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        details: { requiredFeePaise: 5_000 },
      });
      expect(await walletBalance(ctx, driver.driverId)).toBe(3_000n);
      expect(await feeDebits(driver.driverId)).toHaveLength(0);
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(0);
      expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
      expect((await setTripStatus(ctx, tripId, 'COMPLETED').expect(409)).body.error.code).toBe(
        'PAYMENT_REQUIRED',
      );

      // After a recharge the same request goes through, once.
      await fundWallet(ctx, admin, driver.driverId, 2_000);
      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it('#9 concurrent fee debits from one wallet never overdraw it', async () => {
      const driver = await createHistoricalEligibleDriver(ctx);
      await fundWallet(ctx, admin, driver.driverId, 6_000);
      const trips = await Promise.all(
        Array.from({ length: 3 }, () => tripReadyToCollect({ driver, method: 'PAY_AT_PICKUP' })),
      );

      const results = await Promise.all(
        trips.map((trip) =>
          collect(ctx, driver, trip.tripId, { method: 'CASH', amountPaise: 50_000 }),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual([
        'INSUFFICIENT_BALANCE',
        'INSUFFICIENT_BALANCE',
      ]);
      expect(await walletBalance(ctx, driver.driverId)).toBe(1_000n);
      expect(await feeDebits(driver.driverId)).toHaveLength(1);
      const mismatches = await ctx.app.get(ReconciliationService).findWalletMismatches();
      const wallet = await ctx.prisma.driverWallet.findUniqueOrThrow({
        where: { driverId: driver.driverId },
      });
      expect(mismatches.map((m) => m.walletId)).not.toContain(wallet.id);
    });

    it('#10 a concurrent top-up credit and cash fee debit serialize on the wallet', async () => {
      for (let round = 0; round < 3; round += 1) {
        const { driver, tripId } = await tripReadyToCollect({ walletPaise: 10_000 });
        const { orderId } = await startTopUp(ctx, driver, 50_000);
        const payment = ctx.razorpay.pay(orderId);

        const [webhook, cash] = await Promise.all([
          sendWebhook(ctx, buildWebhook('payment.captured', payment)),
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
        ]);

        expect(webhook.status).toBe(200);
        expect(cash.status).toBe(201);
        expect(await walletBalance(ctx, driver.driverId)).toBe(55_000n);
        const entries = await ctx.prisma.driverWalletTransaction.findMany({
          where: { wallet: { driverId: driver.driverId } },
          orderBy: { walletVersion: 'asc' },
        });
        expect(entries.map((e) => Number(e.walletVersion))).toEqual([1, 2, 3]);
        expect(entries.at(-1)?.balanceAfterPaise).toBe(55_000n);
      }
    });

    it('refuses an amount other than the confirmed fare', async () => {
      const { driver, tripId } = await tripReadyToCollect({ walletPaise: 10_000 });
      const res = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 40_000,
      }).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'COLLECTION_AMOUNT_MISMATCH',
        details: { expectedPaise: 50_000 },
      });
      expect(await walletBalance(ctx, driver.driverId)).toBe(10_000n);
    });

    it('only collects inside the payment window and never for prepaid bookings', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createHistoricalEligibleDriver(ctx);
      await fundWallet(ctx, admin, driver.driverId, 10_000);

      const delivery = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        category,
      });
      await advanceTrip(ctx, delivery.tripId, ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT']);
      const early = await collect(ctx, driver, delivery.tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(early.body.error).toMatchObject({
        code: 'COLLECTION_NOT_ALLOWED',
        details: { stage: 'DELIVERY' },
      });

      const pickup = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 50_000,
        category,
      });
      await collect(ctx, driver, pickup.tripId, { method: 'CASH', amountPaise: 50_000 }).expect(
        409,
      );

      const prepaid = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 50_000,
        category,
      });
      await advanceTrip(ctx, prepaid.tripId, TO_DELIVERED);
      const refused = await collect(ctx, driver, prepaid.tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(refused.body.error.code).toBe('COLLECTION_NOT_ALLOWED');
      expect(await walletBalance(ctx, driver.driverId)).toBe(10_000n);
    });

    it('another driver cannot collect for a trip', async () => {
      const { tripId } = await tripReadyToCollect({ walletPaise: 10_000 });
      const other = await createHistoricalEligibleDriver(ctx);
      await fundWallet(ctx, admin, other.driverId, 10_000);
      const res = await collect(ctx, other, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(
        404,
      );
      expect(res.body.error.code).toBe('TRIP_NOT_FOUND');
    });
  });

  describe('online QR (Razorpay payment link)', () => {
    it('shows a booking-linked QR, completes only on a captured payment, and pays nothing to the wallet', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect();

      const created = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      expect(created.body).toMatchObject({
        method: 'ONLINE_QR',
        status: 'PENDING',
        platformFeePaise: null,
        qr: { product: 'PAYMENT_LINK' },
      });
      expect(created.body.qr.url).toMatch(/^https:\/\//);
      const link = ctx.links.byCollection(created.body.collectionId);
      expect(link).toMatchObject({ amount: 50_000, bookingId });

      // Not paid yet: polling changes nothing.
      const pending = await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${created.body.collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(pending.body.status).toBe('PENDING');

      const payment = ctx.links.pay(link.referenceId);
      const done = await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${created.body.collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(done.body).toMatchObject({
        status: 'COMPLETED',
        providerPaymentId: payment.id,
        paymentMethod: 'UPI',
        qr: { url: null },
      });

      expect(await booking(bookingId)).toMatchObject({ paymentStatus: 'PAID' });
      expect(
        await ctx.prisma.driverWalletTransaction.count({
          where: { wallet: { driverId: driver.driverId } },
        }),
      ).toBe(0);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        netAmountPaise: 45_000n,
        platformFeePaise: 5_000n,
      });
      // Payable once Razorpay settles the QR payment to Nikhil Enterprises.
      const sync = await settleAndSync(ctx, payment.id, 50_000);
      expect(sync).toMatchObject({ recorded: 1, earningsPromoted: 1 });
      const settlement = await ctx.prisma.paymentSettlement.findFirstOrThrow({
        where: { bookingId },
      });
      expect(settlement).toMatchObject({
        collectionId: created.body.collectionId,
        paymentId: null,
      });
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({ status: 'PAYABLE', paymentSettlementId: settlement.id });
    });

    it('payment_link.paid and payment.captured for the same payment apply once', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect();
      const created = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const link = ctx.links.byCollection(created.body.collectionId);
      const payment = ctx.links.pay(link.referenceId);

      const linkPaid = buildPaymentLinkWebhook(
        'payment_link.paid',
        { ...link, collectionId: created.body.collectionId },
        payment,
      );
      const captured = buildCollectionPaymentWebhook(payment, created.body.collectionId);
      await Promise.all([
        sendWebhook(ctx, linkPaid).expect(200),
        sendWebhook(ctx, captured).expect(200),
      ]);
      await sendWebhook(ctx, linkPaid).expect(200);

      const outcomes = await Promise.all(
        [linkPaid, captured].map(
          async (w) =>
            (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: w.eventId } }))
              .outcome,
        ),
      );
      expect(outcomes.sort()).toEqual(['ALREADY_APPLIED', 'APPLIED']);
      expect(await booking(bookingId)).toMatchObject({ paymentStatus: 'PAID' });
      expect(
        await ctx.prisma.paymentCollection.count({ where: { bookingId, status: 'COMPLETED' } }),
      ).toBe(1);
    });

    it('shows the same live QR when asked twice', async () => {
      const { driver, tripId } = await tripReadyToCollect();
      const first = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const second = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      expect(second.body).toMatchObject({ collectionId: first.body.collectionId, replayed: true });
    });

    it('an expired QR is closed and a new one can be shown', async () => {
      const { driver, tripId } = await tripReadyToCollect();
      const first = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      ctx.links.expire(ctx.links.byCollection(first.body.collectionId).referenceId);

      const second = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      expect(second.body.collectionId).not.toBe(first.body.collectionId);
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: first.body.collectionId },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'EXPIRED' });
    });

    it('switching to cash closes the open QR first', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 10_000 });
      const qr = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);

      await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);

      expect(ctx.links.byCollection(qr.body.collectionId).status).toBe('CANCELLED');
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: qr.body.collectionId },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'CANCELLED_FOR_CASH' });
      expect(
        await ctx.prisma.paymentCollection.count({ where: { bookingId, status: 'COMPLETED' } }),
      ).toBe(1);
      expect(await walletBalance(ctx, driver.driverId)).toBe(5_000n);
    });

    it('cash is refused when the customer already paid the QR, and nothing is debited', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect({ walletPaise: 10_000 });
      const qr = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      ctx.links.pay(ctx.links.byCollection(qr.body.collectionId).referenceId);

      const cash = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(cash.body.error.code).toBe('BOOKING_ALREADY_PAID');

      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: qr.body.collectionId },
        }),
      ).toMatchObject({ status: 'COMPLETED' });
      expect(await booking(bookingId)).toMatchObject({ paymentStatus: 'PAID' });
      expect(await walletBalance(ctx, driver.driverId)).toBe(10_000n);
    });

    it('a short payment is never accepted and is flagged', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect();
      const qr = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const link = ctx.links.byCollection(qr.body.collectionId);
      const payment = ctx.links.pay(link.referenceId, { amount: 100 });

      const webhook = buildPaymentLinkWebhook(
        'payment_link.partially_paid',
        { ...link, collectionId: qr.body.collectionId },
        payment,
      );
      await sendWebhook(ctx, webhook).expect(200);

      expect(await booking(bookingId)).toMatchObject({ paymentStatus: 'UNPAID' });
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({
        outcome: 'AMOUNT_MISMATCH',
        processingError: 'COLLECTION_AMOUNT_MISMATCH',
      });
    });

    it('closes the QR when the booking is cancelled', async () => {
      const { driver, bookingId, tripId } = await tripReadyToCollect();
      const qr = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'customer left' })
        .expect(200);

      expect(ctx.links.byCollection(qr.body.collectionId).status).toBe('CANCELLED');
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: qr.body.collectionId },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'BOOKING_CANCELLED' });
      const stale = await ctx.app.get(EarningsReconciliationService).findStaleCollections();
      expect(stale.map((f) => f.collectionId)).not.toContain(qr.body.collectionId);
    });
  });

  describe('online QR (Razorpay QR code)', () => {
    let qrCtx: TestContext;

    beforeAll(async () => {
      qrCtx = await createTestApp({
        configOverrides: { COLLECTION_LINK_PROVIDER: 'razorpay_qr_code' },
      });
    });

    afterAll(async () => {
      await qrCtx.close();
    });

    it('a QR code payment (no order id) is mapped back to its collection from payment.captured', async () => {
      const customer = await createCustomer(qrCtx);
      const driver = await createHistoricalEligibleDriver(qrCtx);
      const { bookingId, tripId } = await bookedTrip(qrCtx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 30_000,
        category,
      });
      await advanceTrip(qrCtx, tripId, TO_DELIVERED);

      const qr = await collect(qrCtx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 30_000,
      }).expect(201);
      expect(qr.body.qr).toMatchObject({ product: 'QR_CODE' });
      const link = qrCtx.links.byCollection(qr.body.collectionId);
      const payment = qrCtx.links.pay(link.referenceId);
      expect(payment.orderId).toBeNull();

      const webhook = buildCollectionPaymentWebhook(payment, null);
      await sendWebhook(qrCtx, webhook).expect(200);

      expect(
        await qrCtx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'APPLIED' });
      expect(
        await qrCtx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).toMatchObject({
        paymentStatus: 'PAID',
      });
    });
  });
});
