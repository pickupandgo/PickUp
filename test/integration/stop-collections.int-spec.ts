import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CollectionFinalizerService } from '../../src/collections/collection-finalizer.service';
import type { BookingStop } from '../../src/generated/prisma/client';
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
  engine,
  fundWallet,
  resolveStop,
  setStopStatus,
  setTripStatus,
  settleAndSync,
  TO_IN_TRANSIT,
} from '../helpers/flows';
import { sendWebhook, walletBalance } from '../helpers/http';
import {
  buildCollectionPaymentWebhook,
  buildPaymentLinkWebhook,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_INTERNAL_API_KEY } from '../helpers/test-config';

/**
 * Per-drop collection (payment flow Phase 4): a PAY_AT_DELIVERY booking priced per drop is paid
 * drop by drop, only for the drop the driver is at (ARRIVED), for that drop's frozen payable
 * amount, in cash (that drop's fee share debited from the wallet) or through a QR made for that
 * drop alone. The drop's payment is confirmed (PAYMENT_CONFIRMED, handover allowed), the booking
 * goes UNPAID -> PARTIALLY_PAID -> PAID, and the completed trip's earning lists every collection.
 * The database refuses the same mistakes on its own, even from the table owner.
 */
describe('Collections for a booking paid drop by drop (PAY_AT_DELIVERY)', () => {
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

  interface AtDrop {
    readonly customer: TestCustomer;
    readonly driver: TestDriver;
    readonly bookingId: string;
    readonly tripId: string;
    readonly stops: BookingStop[];
  }

  /**
   * A booking priced per drop, under way, the driver at drop 1. Drops of Rs 200, Rs 100 and
   * Rs 200 by default (10% fee: Rs 20, Rs 10, Rs 20); the wallet holds Rs 100 for cash fees.
   */
  async function atDrop(options: { drops?: number[]; walletPaise?: number } = {}): Promise<AtDrop> {
    const drops = options.drops ?? [20_000, 10_000, 20_000];
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: drops.reduce((sum, paise) => sum + paise, 0),
      dropPaise: drops,
      category,
      model: 'QUOTE_PER_STOP',
    });
    if (options.walletPaise !== 0) {
      await fundWallet(ctx, admin, driver.driverId, options.walletPaise ?? 10_000);
    }
    await advanceTrip(ctx, trip.tripId, TO_IN_TRANSIT);
    await setStopStatus(ctx, trip.tripId, 1, 'ARRIVED').expect(200);
    return { customer, driver, ...trip, stops: await stopRows(trip.bookingId) };
  }

  function nth<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`expected an item at ${index}`);
    }
    return item;
  }

  const stopRows = (bookingId: string) =>
    ctx.prisma.bookingStop.findMany({ where: { bookingId }, orderBy: { sequence: 'asc' } });
  const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const tripRow = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });
  const collectionsOf = (bookingId: string) =>
    ctx.prisma.paymentCollection.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  const feeDebits = (driverId: string) =>
    ctx.prisma.driverWalletTransaction.findMany({
      where: { wallet: { driverId }, type: 'CASH_RIDE_FEE' },
      orderBy: { createdAt: 'asc' },
    });
  const payable = (trip: AtDrop, sequence: number) =>
    Number(nth(trip.stops, sequence - 1).payablePaise);

  const cash = (trip: AtDrop, sequence: number, key?: string) =>
    collect(
      ctx,
      trip.driver,
      trip.tripId,
      { method: 'CASH', amountPaise: payable(trip, sequence), stopSequence: sequence },
      key,
    );
  const qr = (trip: AtDrop, sequence: number, key?: string) =>
    collect(
      ctx,
      trip.driver,
      trip.tripId,
      { method: 'ONLINE_QR', amountPaise: payable(trip, sequence), stopSequence: sequence },
      key,
    );
  const refresh = (trip: AtDrop, collectionId: string) =>
    request(ctx.server)
      .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
      .set(bearer(trip.driver.token));

  /** Shows a drop's QR and has the customer pay it; returns the collection and the payment. */
  async function paidQr(trip: AtDrop, sequence: number) {
    const shown = await qr(trip, sequence).expect(201);
    const collectionId = shown.body.collectionId as string;
    const link = ctx.links.byCollection(collectionId);
    return { collectionId, link, payment: ctx.links.pay(link.referenceId) };
  }

  const paidLinkWebhook = (
    link: { referenceId: string; amount: number; collectionId: string; orderId: string | null },
    payment: ReturnType<typeof ctx.links.pay>,
  ) => buildPaymentLinkWebhook('payment_link.paid', link, payment);

  describe('paying drop by drop', () => {
    it('one drop in cash: the booking is PAID, the drop handed over, the earning settled in cash', async () => {
      const trip = await atDrop({ drops: [30_000] });
      const res = await cash(trip, 1).expect(201);
      expect(res.body).toMatchObject({
        stage: 'DELIVERY',
        stopSequence: 1,
        method: 'CASH',
        status: 'COMPLETED',
        amountPaise: 30_000,
        platformFeePaise: 3_000,
        replayed: false,
        bookingPaymentStatus: 'PAID',
        paymentGate: {
          stage: 'DROP',
          stopSequence: 1,
          paymentState: 'PAYMENT_CONFIRMED',
          handoverAllowed: true,
        },
      });
      const collectionId = res.body.collectionId as string;
      // One debit of that drop's fee share, keyed to this collection, linked to it.
      const [debit, ...others] = await feeDebits(trip.driver.driverId);
      expect(others).toEqual([]);
      expect(debit).toMatchObject({
        amountPaise: 3_000n,
        direction: 'DEBIT',
        idempotencyKey: `cash-ride-fee:collection:${collectionId}`,
      });
      expect(
        (await ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } }))
          .walletTransactionId,
      ).toBe(debit?.id);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(7_000n);

      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      expect((await tripRow(trip.tripId)).status).toBe('PAYMENT_CONFIRMED');
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      expect(earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        collectionId,
        grossAmountPaise: 30_000n,
        platformFeePaise: 3_000n,
        netAmountPaise: 27_000n,
      });
      expect(earning.collectionLinks).toMatchObject([
        { collectionId, method: 'CASH', amountPaise: 30_000n, platformFeePaise: 3_000n },
      ]);
    });

    it('one drop by QR: made for that drop, confirmed by Razorpay, payable once settled', async () => {
      const trip = await atDrop({ drops: [30_000], walletPaise: 0 });
      const shown = await qr(trip, 1).expect(201);
      expect(shown.body).toMatchObject({
        stopSequence: 1,
        status: 'PENDING',
        amountPaise: 30_000,
        bookingPaymentStatus: 'UNPAID',
        paymentGate: { paymentState: 'PAYMENT_PROCESSING', handoverAllowed: false },
      });
      const collectionId = shown.body.collectionId as string;
      // The QR's notes name its obligation: the collection, the booking, the stage and the drop.
      const link = ctx.links.byCollection(collectionId);
      expect(link).toMatchObject({
        collectionId,
        bookingId: trip.bookingId,
        stage: 'DELIVERY',
        stopId: nth(trip.stops, 0).id,
        stopSequence: 1,
        amount: 30_000,
      });
      const payment = ctx.links.pay(link.referenceId);
      await sendWebhook(ctx, paidLinkWebhook({ ...link, amount: 30_000 }, payment)).expect(200);
      expect(await bookingRow(trip.bookingId)).toMatchObject({ paymentStatus: 'PAID' });
      expect(nth(await stopRows(trip.bookingId), 0)).toMatchObject({
        status: 'PAYMENT_CONFIRMED',
        paymentConfirmedAt: expect.any(Date),
      });

      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
      });
      expect(earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        collectionId,
        grossAmountPaise: 30_000n,
        platformFeePaise: 3_000n,
      });
      await settleAndSync(ctx, payment.id, 30_000);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('PAYABLE');
    });

    it('three drops in cash, by QR, in cash: PARTIALLY_PAID until the last, one MIXED earning keeping every source', async () => {
      const trip = await atDrop();
      const first = await cash(trip, 1).expect(201);
      expect(first.body.bookingPaymentStatus).toBe('PARTIALLY_PAID');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);

      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      const second = await paidQr(trip, 2);
      const confirmed = await refresh(trip, second.collectionId).expect(200);
      expect(confirmed.body).toMatchObject({
        status: 'COMPLETED',
        stopSequence: 2,
        bookingPaymentStatus: 'PARTIALLY_PAID',
        paymentGate: { stopSequence: 2, paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true },
      });
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERED').expect(200);

      await setStopStatus(ctx, trip.tripId, 3, 'ARRIVED').expect(200);
      const third = await cash(trip, 3).expect(201);
      expect(third.body.bookingPaymentStatus).toBe('PAID');
      const last = await setStopStatus(ctx, trip.tripId, 3, 'DELIVERED').expect(200);
      expect(last.body).toMatchObject({ paidWith: 'MIXED', trip: { status: 'PAYMENT_CONFIRMED' } });
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);

      // Two cash fee shares debited, each once, each keyed to its own collection.
      const debits = await feeDebits(trip.driver.driverId);
      expect(debits.map((debit) => [debit.idempotencyKey, debit.amountPaise])).toEqual([
        [`cash-ride-fee:collection:${first.body.collectionId as string}`, 2_000n],
        [`cash-ride-fee:collection:${third.body.collectionId as string}`, 2_000n],
      ]);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(6_000n);

      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      expect(earning).toMatchObject({
        settlement: 'MIXED',
        status: 'AWAITING_SETTLEMENT',
        collectionId: null,
        paymentId: null,
        grossAmountPaise: 50_000n,
        platformFeePaise: 5_000n,
        netAmountPaise: 45_000n,
      });
      const bySource = new Map(
        earning.collectionLinks.map((link) => [
          link.collectionId,
          [link.method, link.amountPaise, link.platformFeePaise],
        ]),
      );
      expect(bySource).toEqual(
        new Map([
          [first.body.collectionId, ['CASH', 20_000n, 2_000n]],
          [second.collectionId, ['ONLINE_QR', 10_000n, 1_000n]],
          [third.body.collectionId, ['CASH', 20_000n, 2_000n]],
        ]),
      );
      // Settling the online drop doesn't make a mixed earning payable yet (payment flow Phase 5).
      await settleAndSync(ctx, second.payment.id, 10_000);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('AWAITING_SETTLEMENT');

      // The admin money trail lists each drop's collection and the earning's sources.
      const chain = await request(ctx.server)
        .get(`/v1/admin/bookings/${trip.bookingId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(
        chain.body.collections.map((collection: { stopSequence: number; method: string }) => [
          collection.stopSequence,
          collection.method,
        ]),
      ).toEqual([
        [1, 'CASH'],
        [2, 'ONLINE_QR'],
        [3, 'CASH'],
      ]);
      expect(chain.body.earning).toMatchObject({ settlement: 'MIXED', grossAmountPaise: 50_000 });
      expect(chain.body.earning.collections).toHaveLength(3);
    });

    it('a drop left undelivered: the trip completes PARTIALLY_PAID and earns only what was collected (N5)', async () => {
      const trip = await atDrop({ drops: [20_000, 10_000] });
      await cash(trip, 1).expect(201);
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
        200,
      );
      // Drop 2 is still owed: the trip can't complete while it may be retried.
      expect((await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(409)).body.error.code).toBe(
        'INVALID_TRIP_TRANSITION',
      );
      await resolveStop(ctx, admin, trip.bookingId, 2, {
        resolution: 'UNDELIVERED',
        reason: 'Customer cancelled this drop',
      }).expect(200);
      expect(await tripRow(trip.tripId)).toMatchObject({ status: 'PAYMENT_CONFIRMED' });
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      expect(await bookingRow(trip.bookingId)).toMatchObject({
        status: 'COMPLETED',
        paymentStatus: 'PARTIALLY_PAID',
      });

      // Only drop 1's money and fee share: an undelivered unpaid drop adds nothing.
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      expect(earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        grossAmountPaise: 20_000n,
        platformFeePaise: 2_000n,
        netAmountPaise: 18_000n,
      });
      expect(earning.collectionLinks).toMatchObject([
        { amountPaise: 20_000n, platformFeePaise: 2_000n },
      ]);
      expect((await feeDebits(trip.driver.driverId)).map((debit) => debit.amountPaise)).toEqual([
        2_000n,
      ]);
      const findings = await request(ctx.server)
        .get('/v1/admin/reconciliation/earning-mismatches')
        .set(bearer(admin.token))
        .expect(200);
      expect(JSON.stringify(findings.body)).not.toContain(trip.bookingId);
    });
  });

  describe('only the drop the driver is at, for exactly its amount', () => {
    it('refuses another drop, a missing one, the whole booking and any other amount', async () => {
      const trip = await atDrop();
      const later = await collect(ctx, trip.driver, trip.tripId, {
        method: 'CASH',
        amountPaise: payable(trip, 2),
        stopSequence: 2,
      }).expect(409);
      expect(later.body.error).toMatchObject({
        code: 'COLLECTION_NOT_ALLOWED',
        details: { reason: 'NOT_CURRENT', stopSequence: 2, stopStatus: 'PENDING', currentStop: 1 },
      });
      expect(
        (
          await collect(ctx, trip.driver, trip.tripId, {
            method: 'ONLINE_QR',
            amountPaise: 20_000,
            stopSequence: 9,
          }).expect(404)
        ).body.error.code,
      ).toBe('STOP_NOT_FOUND');
      expect(
        (
          await collect(ctx, trip.driver, trip.tripId, {
            method: 'CASH',
            amountPaise: 50_000,
          }).expect(422)
        ).body.error.code,
      ).toBe('STOP_REQUIRED');
      for (const amountPaise of [50_000, payable(trip, 2), 19_999]) {
        const wrong = await collect(ctx, trip.driver, trip.tripId, {
          method: 'CASH',
          amountPaise,
          stopSequence: 1,
        }).expect(422);
        expect(wrong.body.error).toMatchObject({
          code: 'COLLECTION_AMOUNT_MISMATCH',
          details: { expectedPaise: 20_000 },
        });
      }
      expect(await collectionsOf(trip.bookingId)).toEqual([]);
      expect(await feeDebits(trip.driver.driverId)).toEqual([]);
      expect(
        [...ctx.links.links.values()].filter((link) => link.bookingId === trip.bookingId),
      ).toEqual([]);

      // Once drop 1 is paid it is never collected again, and drop 2 waits its turn.
      await cash(trip, 1).expect(201);
      expect((await cash(trip, 1).expect(409)).body.error.details).toMatchObject({
        reason: 'STOP_ALREADY_PAID',
        stopSequence: 1,
        currentStop: 1,
      });
      expect((await qr(trip, 2).expect(409)).body.error.details).toMatchObject({
        reason: 'NOT_CURRENT',
        stopSequence: 2,
      });
    });

    it('a stale screen, a failed drop and a closed booking are never collected', async () => {
      const trip = await atDrop();
      await cash(trip, 1).expect(201);
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      // The driver's screen still shows drop 1.
      expect((await cash(trip, 1).expect(409)).body.error.details).toMatchObject({
        reason: 'STOP_ALREADY_PAID',
        stopStatus: 'DELIVERED',
      });
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
        200,
      );
      expect((await qr(trip, 2).expect(409)).body.error.details).toMatchObject({
        reason: 'NOT_CURRENT',
        stopStatus: 'DELIVERY_FAILED',
      });
      await engine(ctx)
        .post(`/v1/internal/bookings/${trip.bookingId}/cancel`)
        .send({ reason: 'Customer cancelled the rest' })
        .expect(200);
      expect((await cash(trip, 2).expect(409)).body.error.code).toBe('BOOKING_CLOSED');
      expect(await bookingRow(trip.bookingId)).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'PARTIALLY_PAID',
      });
      // Paid, then cancelled: listed for refund review, one row per collection.
      const review = await request(ctx.server)
        .get('/v1/admin/reconciliation/paid-cancelled-bookings')
        .set(bearer(admin.token))
        .expect(200);
      expect(
        review.body.filter((row: { bookingId: string }) => row.bookingId === trip.bookingId),
      ).toMatchObject([{ amountPaise: 20_000 }]);
    });

    it('a paid booking refuses any further collection', async () => {
      const trip = await atDrop({ drops: [30_000] });
      await cash(trip, 1).expect(201);
      for (const method of ['CASH', 'ONLINE_QR'] as const) {
        const again = await collect(ctx, trip.driver, trip.tripId, {
          method,
          amountPaise: 30_000,
          stopSequence: 1,
        }).expect(409);
        expect(again.body.error.code).toBe('BOOKING_ALREADY_PAID');
      }
      expect(await collectionsOf(trip.bookingId)).toHaveLength(1);
    });

    it('an insufficient wallet is refused, and nothing is recorded', async () => {
      const trip = await atDrop({ walletPaise: 1_000 });
      const res = await cash(trip, 1).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        details: { requiredFeePaise: 2_000 },
      });
      expect(await collectionsOf(trip.bookingId)).toEqual([]);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(1_000n);
      expect(nth(await stopRows(trip.bookingId), 0).status).toBe('ARRIVED');
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('UNPAID');
      // The QR still works: the customer can pay online instead.
      const shown = await qr(trip, 1).expect(201);
      expect(shown.body.status).toBe('PENDING');
    });

    it('only the assigned driver collects; customers, admins and the engine cannot', async () => {
      const trip = await atDrop();
      const other = await createDriver(ctx);
      await fundWallet(ctx, admin, other.driverId, 10_000);
      expect(
        (
          await collect(ctx, other, trip.tripId, {
            method: 'CASH',
            amountPaise: 20_000,
            stopSequence: 1,
          }).expect(404)
        ).body.error.code,
      ).toBe('TRIP_NOT_FOUND');
      for (const token of [trip.customer.token, admin.token]) {
        await request(ctx.server)
          .post(`/v1/trips/${trip.tripId}/collections`)
          .set(bearer(token))
          .set('Idempotency-Key', randomUUID())
          .send({ method: 'CASH', amountPaise: 20_000, stopSequence: 1 })
          .expect(403);
      }
      await request(ctx.server)
        .post(`/v1/trips/${trip.tripId}/collections`)
        .set('X-Internal-Api-Key', TEST_INTERNAL_API_KEY)
        .set('Idempotency-Key', randomUUID())
        .send({ method: 'CASH', amountPaise: 20_000, stopSequence: 1 })
        .expect(401);
      const shown = await qr(trip, 1).expect(201);
      await request(ctx.server)
        .get(`/v1/trips/${trip.tripId}/collections/${shown.body.collectionId as string}`)
        .set(bearer(other.token))
        .expect(404);
      expect(await collectionsOf(trip.bookingId)).toHaveLength(1);
    });
  });

  describe('provider confirmation', () => {
    it('webhook, driver refresh and admin sync end in one finalizer: the drop is paid once', async () => {
      const trip = await atDrop();
      const { collectionId, link, payment } = await paidQr(trip, 1);
      const webhook = paidLinkWebhook(link, payment);
      await sendWebhook(ctx, webhook).expect(200);
      const completed = await ctx.prisma.paymentCollection.findUniqueOrThrow({
        where: { id: collectionId },
      });
      expect(completed).toMatchObject({ status: 'COMPLETED', providerPaymentId: payment.id });

      // The same event again, the same payment through another event, the driver's refresh and
      // an admin sync: nothing changes.
      await sendWebhook(ctx, webhook).expect(200);
      await sendWebhook(ctx, buildCollectionPaymentWebhook(payment, collectionId)).expect(200);
      expect((await refresh(trip, collectionId).expect(200)).body.status).toBe('COMPLETED');
      const sync = await request(ctx.server)
        .post(`/v1/admin/collections/${collectionId}/sync`)
        .set(bearer(admin.token))
        .expect(200);
      expect(sync.body).toMatchObject({
        outcome: 'ALREADY_APPLIED',
        collection: { stopSequence: 1 },
      });
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } }),
      ).toMatchObject({ status: 'COMPLETED', completedAt: completed.completedAt });
      expect(await bookingRow(trip.bookingId)).toMatchObject({ paymentStatus: 'PARTIALLY_PAID' });
      expect(nth(await stopRows(trip.bookingId), 0).status).toBe('PAYMENT_CONFIRMED');
    });

    it('the driver refresh before the webhook, and the webhook before the refresh, agree', async () => {
      const trip = await atDrop();
      // Drop 1: the driver's screen polls first, the webhook comes after.
      const first = await paidQr(trip, 1);
      expect((await refresh(trip, first.collectionId).expect(200)).body.status).toBe('COMPLETED');
      await sendWebhook(ctx, paidLinkWebhook(first.link, first.payment)).expect(200);
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      // Drop 2: the webhook first, then the screen.
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      const second = await paidQr(trip, 2);
      await sendWebhook(ctx, paidLinkWebhook(second.link, second.payment)).expect(200);
      expect((await refresh(trip, second.collectionId).expect(200)).body).toMatchObject({
        status: 'COMPLETED',
        stopSequence: 2,
        paymentGate: { stopSequence: 2, paymentState: 'PAYMENT_CONFIRMED' },
      });
      const completed = (await collectionsOf(trip.bookingId)).filter(
        (collection) => collection.status === 'COMPLETED',
      );
      expect(completed.map((collection) => collection.providerPaymentId)).toEqual([
        first.payment.id,
        second.payment.id,
      ]);
    });

    it('an invalid signature is refused and applies nothing', async () => {
      const trip = await atDrop();
      const { collectionId, link, payment } = await paidQr(trip, 1);
      const webhook = paidLinkWebhook(link, payment);
      await sendWebhook(ctx, webhook, { signature: 'f'.repeat(64) }).expect(400);
      expect(
        (await ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } }))
          .status,
      ).toBe('PENDING');
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('UNPAID');
      await sendWebhook(ctx, webhook).expect(200);
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('provider success then a crash: Razorpay retries, or the driver or an admin re-reads it, and it completes once', async () => {
      const finalizer = ctx.app.get(CollectionFinalizerService);
      for (const recovery of ['WEBHOOK_RETRY', 'ADMIN_SYNC'] as const) {
        const trip = await atDrop();
        const { collectionId, link, payment } = await paidQr(trip, 1);
        const webhook = paidLinkWebhook(link, payment);
        const spy = jest
          .spyOn(finalizer, 'apply')
          .mockRejectedValueOnce(new Error('simulated crash before commit'));
        try {
          await sendWebhook(ctx, webhook).expect(503);
        } finally {
          spy.mockRestore();
        }
        expect(
          (await ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } }))
            .status,
        ).toBe('PENDING');
        expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('UNPAID');
        if (recovery === 'WEBHOOK_RETRY') {
          await sendWebhook(ctx, webhook).expect(200);
          expect(
            await ctx.prisma.paymentEvent.findUnique({ where: { eventId: webhook.eventId } }),
          ).toMatchObject({ attempts: 2 });
        } else {
          const sync = await request(ctx.server)
            .post(`/v1/admin/collections/${collectionId}/sync`)
            .set(bearer(admin.token))
            .expect(200);
          expect(sync.body.outcome).toBe('APPLIED');
          await sendWebhook(ctx, webhook).expect(200);
        }
        expect((await refresh(trip, collectionId).expect(200)).body.status).toBe('COMPLETED');
        expect(
          (await collectionsOf(trip.bookingId)).filter((row) => row.status === 'COMPLETED'),
        ).toHaveLength(1);
        expect(await bookingRow(trip.bookingId)).toMatchObject({ paymentStatus: 'PARTIALLY_PAID' });
      }
    });

    it('a stale QR never pays another drop: closed for cash or a failed attempt, a late payment is held for review', async () => {
      const trip = await atDrop();
      // Drop 1: a QR is shown, then the receiver pays cash. The QR is closed first.
      const stale = await qr(trip, 1).expect(201);
      const staleLink = ctx.links.byCollection(stale.body.collectionId as string);
      await cash(trip, 1).expect(201);
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: stale.body.collectionId as string },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'CANCELLED_FOR_CASH' });
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);

      // Drop 2: its QR is closed when the attempt fails; a retry shows a new one.
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      const failedQr = await qr(trip, 2).expect(201);
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
        200,
      );
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: failedQr.body.collectionId as string },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'DROP_DELIVERY_FAILED' });
      expect(ctx.links.byCollection(failedQr.body.collectionId as string).status).toBe('CANCELLED');

      // Money arrives late on drop 1's old QR: recorded nowhere, flagged, drop 2 untouched.
      const late = ctx.links.pay(staleLink.referenceId);
      await sendWebhook(ctx, paidLinkWebhook(staleLink, late)).expect(200);
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: stale.body.collectionId as string },
        }),
      ).toMatchObject({ status: 'FAILED', providerPaymentId: null });
      expect(nth(await stopRows(trip.bookingId), 1).status).toBe('DELIVERY_FAILED');
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('PARTIALLY_PAID');

      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      const retried = await paidQr(trip, 2);
      expect(retried.collectionId).not.toBe(failedQr.body.collectionId);
      expect((await refresh(trip, retried.collectionId).expect(200)).body.status).toBe('COMPLETED');
      expect(nth(await stopRows(trip.bookingId), 1).status).toBe('PAYMENT_CONFIRMED');
    });

    it('a pending QR is shown again; an expired one is replaced', async () => {
      const trip = await atDrop({ walletPaise: 0 });
      const shown = await qr(trip, 1).expect(201);
      const createdBefore = ctx.links.calls.create;
      const again = await qr(trip, 1).expect(201);
      expect(again.body).toMatchObject({
        collectionId: shown.body.collectionId,
        replayed: true,
        status: 'PENDING',
      });
      expect(ctx.links.calls.create).toBe(createdBefore);

      ctx.links.expire(ctx.links.byCollection(shown.body.collectionId as string).referenceId);
      const replaced = await qr(trip, 1).expect(201);
      expect(replaced.body.collectionId).not.toBe(shown.body.collectionId);
      expect(
        await ctx.prisma.paymentCollection.findUniqueOrThrow({
          where: { id: shown.body.collectionId as string },
        }),
      ).toMatchObject({ status: 'FAILED', failureReason: 'EXPIRED' });
      const payment = ctx.links.pay(
        ctx.links.byCollection(replaced.body.collectionId as string).referenceId,
      );
      expect(
        (await refresh(trip, replaced.body.collectionId as string).expect(200)).body,
      ).toMatchObject({ status: 'COMPLETED', providerPaymentId: payment.id });
    });
  });

  describe('concurrency', () => {
    it('duplicate and concurrent cash for one drop: one collection, one fee debit', async () => {
      const trip = await atDrop();
      const key = randomUUID();
      const same = await Promise.all(Array.from({ length: 4 }, () => cash(trip, 1, key)));
      expect(same.map((res) => res.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(same.map((res) => res.body.collectionId)).size).toBe(1);
      const different = await Promise.all(Array.from({ length: 4 }, () => cash(trip, 1)));
      for (const res of different) {
        expect([res.status, res.body.error?.details?.reason]).toEqual([409, 'STOP_ALREADY_PAID']);
      }
      expect(await collectionsOf(trip.bookingId)).toHaveLength(1);
      expect(await feeDebits(trip.driver.driverId)).toHaveLength(1);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(8_000n);
      // The key is bound to its request: reusing it for another drop or method is refused.
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      expect((await qr(trip, 2, key).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('cash racing a paid QR for the same drop: one payment wins, nothing is debited twice', async () => {
      const trip = await atDrop();
      const { link, payment } = await paidQr(trip, 1);
      const [webhook, cashResult] = await Promise.all([
        sendWebhook(ctx, paidLinkWebhook(link, payment)),
        cash(trip, 1),
      ]);
      expect(webhook.status).toBe(200);
      expect(cashResult.status).toBe(409);
      const completed = (await collectionsOf(trip.bookingId)).filter(
        (row) => row.status === 'COMPLETED',
      );
      expect(completed.map((row) => row.method)).toEqual(['ONLINE_QR']);
      expect(await feeDebits(trip.driver.driverId)).toEqual([]);
      expect(await bookingRow(trip.bookingId)).toMatchObject({ paymentStatus: 'PARTIALLY_PAID' });
    });

    it('drop 1 and drop 2 at once: only the drop the driver is at is collected', async () => {
      const trip = await atDrop();
      const [first, second] = await Promise.all([cash(trip, 1), cash(trip, 2)]);
      expect([first.status, second.status]).toEqual([201, 409]);
      expect((await collectionsOf(trip.bookingId)).map((row) => row.bookingStopId)).toEqual([
        nth(trip.stops, 0).id,
      ]);
    });

    it('two QR requests for one drop at once show one QR', async () => {
      const trip = await atDrop();
      const results = await Promise.all([qr(trip, 1), qr(trip, 1), qr(trip, 1)]);
      expect(results.map((res) => res.status)).toEqual([201, 201, 201]);
      expect(new Set(results.map((res) => res.body.collectionId)).size).toBe(1);
      const pending = (await collectionsOf(trip.bookingId)).filter(
        (row) => row.status === 'PENDING',
      );
      expect(pending).toHaveLength(1);
      // Every other QR made in the race was cancelled at Razorpay.
      const live = [...ctx.links.links.values()].filter(
        (stored) => stored.bookingId === trip.bookingId && stored.status === 'ACTIVE',
      );
      expect(live.map((stored) => stored.collectionId)).toEqual([pending[0]?.id]);
    });

    it('the webhook and the driver refresh at once complete the drop once', async () => {
      const trip = await atDrop();
      const { collectionId, link, payment } = await paidQr(trip, 1);
      const results = await Promise.all([
        sendWebhook(ctx, paidLinkWebhook(link, payment)),
        refresh(trip, collectionId),
        refresh(trip, collectionId),
      ]);
      expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(
        (await collectionsOf(trip.bookingId)).filter((row) => row.status === 'COMPLETED'),
      ).toHaveLength(1);
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('a cancellation racing a cash drop leaves one consistent outcome', async () => {
      for (let round = 0; round < 3; round += 1) {
        const trip = await atDrop();
        const [cancel, paid] = await Promise.all([
          engine(ctx)
            .post(`/v1/internal/bookings/${trip.bookingId}/cancel`)
            .send({ reason: 'Customer cancelled' }),
          cash(trip, 1),
        ]);
        expect(cancel.status).toBe(200);
        const booking = await bookingRow(trip.bookingId);
        expect(booking.status).toBe('CANCELLED');
        if (paid.status === 201) {
          // Paid first, then cancelled: the money is recorded for refund review.
          expect(booking.paymentStatus).toBe('PARTIALLY_PAID');
          expect(await feeDebits(trip.driver.driverId)).toHaveLength(1);
        } else {
          expect([paid.status, paid.body.error.code]).toEqual([409, 'BOOKING_CLOSED']);
          expect(booking.paymentStatus).toBe('UNPAID');
          expect(await feeDebits(trip.driver.driverId)).toEqual([]);
        }
      }
    });
  });

  describe('the database on its own (table owner)', () => {
    const insertCollection = (row: {
      bookingId: string;
      stopId: string | null;
      tripId: string;
      driverId: string;
      amount: number;
      method?: 'CASH' | 'ONLINE_QR';
      fee?: number | null;
      walletTransactionId?: string | null;
      feeRuleId?: string | null;
    }) => {
      const method = row.method ?? 'ONLINE_QR';
      return method === 'CASH'
        ? ctx.prisma.$executeRaw`
            INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method,
                                             amount_paise, collected_by_driver_id, status,
                                             platform_fee_paise, fee_rule_id, wallet_transaction_id,
                                             idempotency_key, completed_at)
            VALUES (${row.bookingId}::uuid, ${row.stopId}::uuid, ${row.tripId}::uuid, 'DELIVERY',
                    'CASH', ${row.amount}, ${row.driverId}::uuid, 'COMPLETED', ${row.fee ?? 0},
                    ${row.feeRuleId ?? null}::uuid, ${row.walletTransactionId ?? null}::uuid,
                    ${randomUUID()}, now())`
        : ctx.prisma.$executeRaw`
            INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method,
                                             amount_paise, collected_by_driver_id, status,
                                             provider, provider_product, provider_reference_id,
                                             idempotency_key)
            VALUES (${row.bookingId}::uuid, ${row.stopId}::uuid, ${row.tripId}::uuid, 'DELIVERY',
                    'ONLINE_QR', ${row.amount}, ${row.driverId}::uuid, 'PENDING', 'RAZORPAY',
                    'QR_CODE', ${`qr_${randomUUID().replace(/-/g, '').slice(0, 14)}`},
                    ${randomUUID()})`;
    };

    it('collects only the current drop, of its own booking, on its own trip, for its own amount', async () => {
      const trip = await atDrop();
      const elsewhere = await atDrop();
      const base = {
        bookingId: trip.bookingId,
        tripId: trip.tripId,
        driverId: trip.driver.driverId,
      };
      await expect(
        insertCollection({ ...base, stopId: nth(trip.stops, 1).id, amount: 10_000 }),
      ).rejects.toThrow(/Only the drop the driver is at, before it is paid, is collected/);
      await expect(
        insertCollection({ ...base, stopId: nth(trip.stops, 0).id, amount: 50_000 }),
      ).rejects.toThrow(/A drop is collected for its own payable amount/);
      await expect(
        insertCollection({ ...base, stopId: nth(elsewhere.stops, 0).id, amount: 20_000 }),
      ).rejects.toThrow(/is not a drop of booking/);
      await expect(
        insertCollection({
          ...base,
          tripId: elsewhere.tripId,
          stopId: nth(trip.stops, 0).id,
          amount: 20_000,
        }),
      ).rejects.toThrow(/collected on its own trip, by its own driver/);
      await expect(
        insertCollection({
          ...base,
          driverId: elsewhere.driver.driverId,
          stopId: nth(trip.stops, 0).id,
          amount: 20_000,
        }),
      ).rejects.toThrow(/collected on its own trip, by its own driver/);
      const rule = (await bookingRow(trip.bookingId)).feeRuleId;
      await expect(
        insertCollection({
          ...base,
          stopId: nth(trip.stops, 0).id,
          amount: 20_000,
          method: 'CASH',
          fee: 0,
          feeRuleId: rule,
        }),
      ).rejects.toThrow(/debits that drop's share of the platform fee/);
      // A cash fee must be the collecting driver's own debit of exactly that fee.
      await cash(elsewhere, 1).expect(201);
      const [otherDebit] = await feeDebits(elsewhere.driver.driverId);
      await expect(
        insertCollection({
          ...base,
          stopId: nth(trip.stops, 0).id,
          amount: 20_000,
          method: 'CASH',
          fee: 2_000,
          feeRuleId: rule,
          walletTransactionId: otherDebit?.id ?? null,
        }),
      ).rejects.toThrow(/collecting driver's own platform-fee debit/);
      expect(await collectionsOf(trip.bookingId)).toEqual([]);
    });

    it('keeps the payment status and the drop in step with the money', async () => {
      const trip = await atDrop();
      const pickup = await bookedTrip(ctx, await createCustomer(ctx), await createDriver(ctx), {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 30_000,
        category,
        model: 'QUOTE_PER_STOP',
      });
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE bookings SET payment_status = 'PAID' WHERE id = ${trip.bookingId}::uuid`,
      ).rejects.toThrow(/payment status follows its completed collections: they say UNPAID/);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE bookings SET payment_status = 'PARTIALLY_PAID' WHERE id = ${pickup.bookingId}::uuid`,
      ).rejects.toThrow(/Only a booking paid drop by drop can be partially paid/);

      const shown = await qr(trip, 1).expect(201);
      const id = shown.body.collectionId as string;
      // Completing the QR without its effects is refused at commit...
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE payment_collections
               SET status = 'COMPLETED', provider_payment_id = 'pay_ownerbypass01', completed_at = now()
             WHERE id = ${id}::uuid`;
        }),
      ).rejects.toThrow(/payment status changes with the collection/);
      // ... and so is moving the booking without confirming the drop's payment.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE payment_collections
               SET status = 'COMPLETED', provider_payment_id = 'pay_ownerbypass02', completed_at = now()
             WHERE id = ${id}::uuid`;
          await tx.$executeRaw`
            UPDATE bookings SET payment_status = 'PARTIALLY_PAID' WHERE id = ${trip.bookingId}::uuid`;
        }),
      ).rejects.toThrow(/its payment is confirmed in the same transaction/);
      expect(await ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id } })).toMatchObject(
        { status: 'PENDING' },
      );
      expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('UNPAID');
    });

    it('links an earning only to its own completed collections, once, in its transaction', async () => {
      const trip = await atDrop({ drops: [30_000] });
      const collected = await cash(trip, 1).expect(201);
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
      });
      const other = await atDrop({ drops: [30_000] });
      const otherCash = await cash(other, 1).expect(201);
      await expect(
        ctx.prisma.earningCollection.create({
          data: {
            collectionId: collected.body.collectionId as string,
            earningId: earning.id,
            bookingId: trip.bookingId,
            method: 'CASH',
            amountPaise: 30_000n,
            platformFeePaise: 3_000n,
          },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.earningCollection.create({
          data: {
            collectionId: otherCash.body.collectionId as string,
            earningId: earning.id,
            bookingId: trip.bookingId,
            method: 'CASH',
            amountPaise: 30_000n,
            platformFeePaise: 3_000n,
          },
        }),
      ).rejects.toThrow(/recorded with the earning, in its transaction/);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE earning_collections SET amount_paise = 1 WHERE earning_id = ${earning.id}::uuid`,
      ).rejects.toThrow(/recorded once and never change/);
      await expect(
        ctx.prisma
          .$executeRaw`DELETE FROM earning_collections WHERE earning_id = ${earning.id}::uuid`,
      ).rejects.toThrow();
      expect(await ctx.prisma.earningCollection.count({ where: { earningId: earning.id } })).toBe(
        1,
      );
    });
  });
});
