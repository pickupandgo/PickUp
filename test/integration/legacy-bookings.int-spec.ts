import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { BookingPaymentMethod } from '../../src/generated/prisma/enums';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  createLegacyBooking,
  type TestAdmin,
  type TestCustomer,
  type TestDriver,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  assignDriver,
  collect,
  fundWallet,
  registerBooking,
  setTripStatus,
  startBookingPayment,
  TO_DELIVERED,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook, walletBalance } from '../helpers/http';
import { buildWebhook, checkoutSignature } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Historical bookings after Phase 1 (decisions N3 and N4). Rows registered before fare quotes are
 * LEGACY_BOOKING_LEVEL: they keep the amounts, fee rule and collection behaviour they were created
 * with, and get no stops. Historical PREPAID_UPI bookings can still be paid in the app; nothing
 * else can, and ownership and payment verification are unchanged.
 */
describe('Historical (legacy) bookings', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  /** 10% PERCENTAGE fee rule. */
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

  /** A historical booking (see createLegacyBooking), assigned to the driver. */
  async function legacyTrip(
    customer: TestCustomer,
    driver: TestDriver,
    paymentMethod: BookingPaymentMethod,
    options: { farePaise?: number; category?: string } = {},
  ) {
    const booking = await createLegacyBooking(ctx.prisma, {
      customerId: customer.customerId,
      paymentMethod,
      farePaise: options.farePaise ?? 50_000,
      category: options.category ?? category,
    });
    const tripId = await assignDriver(ctx, booking.id, driver);
    return { bookingId: booking.id, tripId };
  }

  const booking = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const trip = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });

  describe('in-app payment (Razorpay Checkout)', () => {
    it('still pays and completes a historical PREPAID_UPI booking, verified with Razorpay', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId, tripId } = await legacyTrip(customer, driver, 'PREPAID_UPI');

      const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
      const orderId = started.body.checkout.orderId as string;
      // The order is for the stored fare; the app never sends an amount.
      expect(ctx.razorpay.orders.get(orderId)?.amount).toBe(50_000);
      const paid = ctx.razorpay.pay(orderId);
      const verified = await verifyBookingPayment(ctx, customer, bookingId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: paid.id,
        razorpaySignature: checkoutSignature(orderId, paid.id),
      }).expect(200);
      expect(verified.body).toMatchObject({ booking: { paymentStatus: 'PAID' } });

      await advanceTrip(ctx, tripId, TO_DELIVERED);
      expect((await trip(tripId)).status).toBe('PAYMENT_CONFIRMED');
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      // The fee of the rule pinned at confirmation: the row has no frozen fee of its own.
      expect((await booking(bookingId)).platformFeePaise).toBeNull();
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({
        settlement: 'ONLINE',
        grossAmountPaise: 50_000n,
        platformFeePaise: 5_000n,
        netAmountPaise: 45_000n,
      });
    });

    it('still applies the Razorpay webhook to a historical PREPAID_UPI booking', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId } = await legacyTrip(customer, driver, 'PREPAID_UPI');
      const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
      const paid = ctx.razorpay.pay(started.body.checkout.orderId as string);
      await sendWebhook(ctx, buildWebhook('payment.captured', paid)).expect(200);
      expect((await booking(bookingId)).paymentStatus).toBe('PAID');
    });

    it('refuses every booking that is not a historical PREPAID_UPI booking', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const refusedBookings = [
        await registerBooking(ctx, customer, {
          paymentMethod: 'PAY_AT_PICKUP',
          farePaise: 20_000,
          category,
        }),
        await registerBooking(ctx, customer, {
          paymentMethod: 'PAY_AT_DELIVERY',
          farePaise: 20_000,
          category,
          model: 'QUOTE_PER_STOP',
        }),
        (await legacyTrip(customer, driver, 'PAY_AT_DELIVERY')).bookingId,
        (await legacyTrip(customer, driver, 'PAY_AT_PICKUP')).bookingId,
      ];
      const ordersBefore = ctx.razorpay.orders.size;

      for (const bookingId of refusedBookings) {
        const start = await startBookingPayment(ctx, customer, bookingId).expect(409);
        expect(start.body.error.code).toBe('BOOKING_NOT_PAYABLE');
        // Refused before any order or signature is even looked at.
        const verify = await verifyBookingPayment(ctx, customer, bookingId, {
          razorpayOrderId: 'order_NotOurs00000001',
          razorpayPaymentId: 'pay_NotOurs000000001',
          razorpaySignature: checkoutSignature('order_NotOurs00000001', 'pay_NotOurs000000001'),
        }).expect(409);
        expect(verify.body.error.code).toBe('BOOKING_NOT_PAYABLE');
      }
      expect(ctx.razorpay.orders.size).toBe(ordersBefore);
      expect(
        await ctx.prisma.payment.count({ where: { bookingId: { in: refusedBookings } } }),
      ).toBe(0);
    });

    it('never marks a booking paid from a webhook for an order this backend did not create', async () => {
      const customer = await createCustomer(ctx);
      const bookingId = await registerBooking(ctx, customer, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        category,
        model: 'QUOTE_PER_STOP',
      });
      // A genuine Razorpay payment, even one whose receipt names the booking, is not ours.
      const orderId = `order_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      ctx.razorpay.registerExternalOrder(orderId, 20_000, bookingId);
      const webhook = buildWebhook('payment.captured', ctx.razorpay.pay(orderId));
      await sendWebhook(ctx, webhook).expect(200);
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'UNKNOWN_ORDER' });
      expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
    });

    it('keeps the ownership and signature checks for historical bookings', async () => {
      const customer = await createCustomer(ctx);
      const stranger = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId } = await legacyTrip(customer, driver, 'PREPAID_UPI');

      // Another customer's booking behaves like a missing one.
      const notTheirs = await startBookingPayment(ctx, stranger, bookingId).expect(404);
      expect(notTheirs.body.error.code).toBe('BOOKING_NOT_FOUND');
      await request(ctx.server)
        .get(`/v1/bookings/${bookingId}/payment`)
        .set(bearer(stranger.token))
        .expect(404);

      const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
      const orderId = started.body.checkout.orderId as string;
      const paid = ctx.razorpay.pay(orderId);
      const strangerVerify = await verifyBookingPayment(ctx, stranger, bookingId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: paid.id,
        razorpaySignature: checkoutSignature(orderId, paid.id),
      }).expect(404);
      expect(strangerVerify.body.error.code).toBe('BOOKING_NOT_FOUND');

      const forged = await verifyBookingPayment(ctx, customer, bookingId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: paid.id,
        razorpaySignature: checkoutSignature(orderId, paid.id, 'not_the_key_secret_value_xxxx'),
      }).expect(400);
      expect(forged.body.error.code).toBe('INVALID_PAYMENT_SIGNATURE');
      expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
    });
  });

  describe('collection by the driver', () => {
    it('still collects a historical pay-at-delivery booking by QR at delivery, as one amount', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId, tripId } = await legacyTrip(customer, driver, 'PAY_AT_DELIVERY');
      await advanceTrip(ctx, tripId, TO_DELIVERED);

      const view = await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(view.body.payment).toMatchObject({
        collectionStage: 'DELIVERY',
        collectionOpen: true,
        platformFeePaise: 5_000,
      });

      // Shown and still pending (like an in-flight QR at migration time), then refreshed.
      const shown = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      const refresh = () =>
        request(ctx.server)
          .get(`/v1/trips/${tripId}/collections/${collectionId}`)
          .set(bearer(driver.token))
          .expect(200);
      expect((await refresh()).body.status).toBe('PENDING');
      const payment = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId);
      expect((await refresh()).body).toMatchObject({
        status: 'COMPLETED',
        providerPaymentId: payment.id,
      });

      expect((await booking(bookingId)).paymentStatus).toBe('PAID');
      expect((await trip(tripId)).status).toBe('PAYMENT_CONFIRMED');
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
      ).toMatchObject({ settlement: 'ONLINE', platformFeePaise: 5_000n, netAmountPaise: 45_000n });
      expect(await ctx.prisma.bookingStop.count({ where: { bookingId } })).toBe(0);
    });

    it('keeps the fee of the pinned rule after the rule changes, for cash at pickup and delivery', async () => {
      const own = uniqueCategory();
      const rule = (value: string, reason: string) =>
        request(ctx.server)
          .post('/v1/admin/fee-rules')
          .set(bearer(admin.token))
          .send({ category: own, ruleType: 'PERCENTAGE', value, roundingMode: 'HALF_UP', reason })
          .expect(201);
      await rule('10', 'Legacy integration test: the rule in force');

      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      await fundWallet(ctx, admin, driver.driverId, 20_000);
      const pickup = await legacyTrip(customer, driver, 'PAY_AT_PICKUP', { category: own });
      const delivery = await legacyTrip(customer, driver, 'PAY_AT_DELIVERY', { category: own });

      // A new version doubles the fee for new bookings of this category.
      await rule('20', 'Legacy integration test: a later rule version');

      await advanceTrip(ctx, pickup.tripId, ['DRIVER_ARRIVED']);
      const atPickup = await collect(ctx, driver, pickup.tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);
      expect(atPickup.body.platformFeePaise).toBe(5_000);

      await advanceTrip(ctx, delivery.tripId, TO_DELIVERED);
      const atDelivery = await collect(ctx, driver, delivery.tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);
      expect(atDelivery.body.platformFeePaise).toBe(5_000);

      expect(await walletBalance(ctx, driver.driverId)).toBe(20_000n - 5_000n - 5_000n);
      await advanceTrip(ctx, pickup.tripId, [
        'PICKUP_VERIFIED',
        'IN_TRANSIT',
        'DROP_PROGRESS',
        'DELIVERED',
      ]);
      for (const { tripId, bookingId } of [pickup, delivery]) {
        await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
        expect(
          await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
        ).toMatchObject({ settlement: 'CASH', platformFeePaise: 5_000n });
      }
    });

    it('still refuses to collect a historical prepaid booking from the driver', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId, tripId } = await legacyTrip(customer, driver, 'PREPAID_UPI');
      await advanceTrip(ctx, tripId, TO_DELIVERED);
      const res = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(409);
      expect(res.body.error.code).toBe('COLLECTION_NOT_ALLOWED');
      await expect(
        ctx.prisma.paymentCollection.create({
          data: {
            bookingId,
            tripId,
            stage: 'DELIVERY',
            method: 'CASH',
            amountPaise: 50_000n,
            collectedByDriverId: driver.driverId,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow(/Prepaid bookings are paid in the app, never collected by the driver/);
    });
  });
});
