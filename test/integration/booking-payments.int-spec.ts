import request from 'supertest';
import { Prisma } from '../../src/generated/prisma/client';
import { EarningsReconciliationService } from '../../src/reconciliation/earnings-reconciliation.service';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  bookedTrip,
  engine,
  setTripStatus,
  startBookingPayment,
  settleAndSync,
  TO_DELIVERED,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook } from '../helpers/http';
import { buildWebhook, checkoutSignature } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Customer App online payment (V1 rule 5A): backend order -> Razorpay Checkout -> backend
 * verification (verify call or webhook). The money goes to Nikhil Enterprises; the driver's share
 * becomes an earning when the trip completes. Required tests #1-#5.
 */
describe('Customer prepaid booking payments', () => {
  let ctx: TestContext;
  let category: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function prepaidTrip(farePaise = 50_000) {
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise,
      category,
    });
    return { customer, driver, ...trip };
  }

  async function startPayment(
    customer: Parameters<typeof startBookingPayment>[1],
    bookingId: string,
  ) {
    const res = await startBookingPayment(ctx, customer, bookingId).expect(201);
    return {
      paymentId: res.body.paymentId as string,
      orderId: res.body.checkout.orderId as string,
    };
  }

  const booking = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const trip = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });

  it('#1 online payment success: verified with Razorpay, trip completes, earning is payable', async () => {
    const { customer, driver, bookingId, tripId } = await prepaidTrip(50_000);
    const { paymentId, orderId } = await startPayment(customer, bookingId);
    // The order amount is the confirmed fare; the app never sends an amount.
    expect(ctx.razorpay.orders.get(orderId)?.amount).toBe(50_000);

    const payment = ctx.razorpay.pay(orderId);
    const verified = await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id),
    }).expect(200);
    expect(verified.body).toMatchObject({
      providerStatus: 'captured',
      booking: { paymentStatus: 'PAID' },
      payment: { status: 'PAID', providerPaymentId: payment.id, paymentMethod: 'UPI' },
    });

    await advanceTrip(ctx, tripId, TO_DELIVERED);
    expect((await trip(tripId)).status).toBe('PAYMENT_CONFIRMED');
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);

    expect((await booking(bookingId)).status).toBe('COMPLETED');
    // Verified and captured, but not settled to Nikhil Enterprises yet: not payable.
    expect(
      await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
    ).toMatchObject({
      driverId: driver.driverId,
      settlement: 'ONLINE',
      status: 'AWAITING_SETTLEMENT',
      grossAmountPaise: 50_000n,
      platformFeePaise: 5_000n,
      netAmountPaise: 45_000n,
      paymentId,
    });
    await settleAndSync(ctx, payment.id, 50_000);
    expect(
      await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } }),
    ).toMatchObject({ status: 'PAYABLE', paymentId });
    // Online payments never touch the driver wallet.
    expect(
      await ctx.prisma.driverWalletTransaction.count({
        where: { wallet: { driverId: driver.driverId } },
      }),
    ).toBe(0);
  });

  it('a payment that lands after delivery confirms the waiting trip', async () => {
    const { customer, bookingId, tripId } = await prepaidTrip();
    const { orderId } = await startPayment(customer, bookingId);
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    expect((await trip(tripId)).status).toBe('DELIVERED');

    await sendWebhook(ctx, buildWebhook('payment.captured', ctx.razorpay.pay(orderId))).expect(200);

    const confirmed = await trip(tripId);
    expect(confirmed.status).toBe('PAYMENT_CONFIRMED');
    expect(confirmed.paymentConfirmedAt).not.toBeNull();
  });

  it('#2 a failed payment leaves the booking unpaid and blocks completion; a retry can succeed', async () => {
    const { customer, bookingId, tripId } = await prepaidTrip();
    const { orderId, paymentId } = await startPayment(customer, bookingId);

    const failed = ctx.razorpay.pay(orderId, { status: 'failed' });
    const res = await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: failed.id,
      razorpaySignature: checkoutSignature(orderId, failed.id),
    }).expect(200);
    expect(res.body).toMatchObject({
      providerStatus: 'failed',
      booking: { paymentStatus: 'UNPAID' },
    });
    const failedWebhook = buildWebhook('payment.failed', failed);
    await sendWebhook(ctx, failedWebhook).expect(200);
    expect(
      await ctx.prisma.paymentEvent.findUnique({ where: { eventId: failedWebhook.eventId } }),
    ).toMatchObject({ outcome: 'PAYMENT_ATTEMPT_FAILED', paymentId });

    await advanceTrip(ctx, tripId, TO_DELIVERED);
    const blocked = await setTripStatus(ctx, tripId, 'COMPLETED').expect(409);
    expect(blocked.body.error.code).toBe('PAYMENT_REQUIRED');
    expect((await trip(tripId)).status).toBe('DELIVERED');
    expect(await ctx.prisma.driverEarning.count({ where: { bookingId } })).toBe(0);

    // The customer retries on the same order.
    await sendWebhook(ctx, buildWebhook('payment.captured', ctx.razorpay.pay(orderId))).expect(200);
    expect((await booking(bookingId)).paymentStatus).toBe('PAID');
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
  });

  it('#3 the same webhook delivered repeatedly and concurrently is applied once', async () => {
    const { customer, bookingId } = await prepaidTrip(42_000);
    const { orderId, paymentId } = await startPayment(customer, bookingId);
    const webhook = buildWebhook('payment.captured', ctx.razorpay.pay(orderId));

    for (let i = 0; i < 5; i += 1) {
      await sendWebhook(ctx, webhook).expect(200);
    }
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => sendWebhook(ctx, webhook)),
    );
    expect(concurrent.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200));

    expect((await booking(bookingId)).paymentStatus).toBe('PAID');
    expect(await ctx.prisma.payment.count({ where: { bookingId, status: 'PAID' } })).toBe(1);
    const event = await ctx.prisma.paymentEvent.findUniqueOrThrow({
      where: { eventId: webhook.eventId },
    });
    expect(event).toMatchObject({ outcome: 'APPLIED', paymentId });
  });

  it('#4 the same Razorpay payment id arriving twice is applied once', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const { orderId } = await startPayment(customer, bookingId);
    const payment = ctx.razorpay.pay(orderId);

    await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id),
    }).expect(200);
    const captured = buildWebhook('payment.captured', payment);
    const orderPaid = buildWebhook('order.paid', payment);
    await Promise.all([
      sendWebhook(ctx, captured).expect(200),
      sendWebhook(ctx, orderPaid).expect(200),
    ]);

    expect(await ctx.prisma.payment.count({ where: { razorpayPaymentId: payment.id } })).toBe(1);
    for (const eventId of [captured.eventId, orderPaid.eventId]) {
      expect(
        (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId } })).outcome,
      ).toBe('ALREADY_APPLIED');
    }
    // The database itself refuses a second row for the same provider payment.
    const other = await prepaidTrip();
    const second = await startPayment(other.customer, other.bookingId);
    await expect(
      ctx.prisma.payment.update({
        where: { id: second.paymentId },
        data: { razorpayPaymentId: payment.id },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('#5 a payment with the wrong amount is never applied and is flagged for review', async () => {
    const { customer, bookingId } = await prepaidTrip(50_000);
    const { orderId, paymentId } = await startPayment(customer, bookingId);
    const wrong = ctx.razorpay.pay(orderId, { amount: 100 });

    const verify = await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: wrong.id,
      razorpaySignature: checkoutSignature(orderId, wrong.id),
    }).expect(409);
    expect(verify.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');

    const webhook = buildWebhook('payment.captured', wrong);
    await sendWebhook(ctx, webhook).expect(200);
    expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PENDING',
    );
    expect(
      await ctx.prisma.paymentEvent.findUnique({ where: { eventId: webhook.eventId } }),
    ).toMatchObject({ outcome: 'AMOUNT_MISMATCH', processingError: 'AMOUNT_MISMATCH' });
    const anomalies = await ctx.app.get(ReconciliationService).findWebhookAnomalies();
    expect(anomalies.map((a) => a.eventId)).toContain(webhook.eventId);
  });

  it('every retry, with any key, returns the same order for the booking', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const before = ctx.razorpay.calls.createOrder;
    const [first, second] = await Promise.all([
      startBookingPayment(ctx, customer, bookingId).expect(201),
      startBookingPayment(ctx, customer, bookingId).expect(201),
    ]);
    const third = await startBookingPayment(ctx, customer, bookingId).expect(201);

    expect(second.body.paymentId).toBe(first.body.paymentId);
    expect(third.body.checkout.orderId).toBe(first.body.checkout.orderId);
    expect(await ctx.prisma.payment.count({ where: { bookingId } })).toBe(1);
    expect(ctx.razorpay.calls.createOrder - before).toBeLessThanOrEqual(2);
  });

  it('refuses online payment for pay-at-pickup bookings and for paid bookings', async () => {
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const cash = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 30_000,
      category,
    });
    const refused = await startBookingPayment(ctx, customer, cash.bookingId).expect(409);
    expect(refused.body.error.code).toBe('BOOKING_NOT_PAYABLE');

    const paid = await prepaidTrip();
    const { orderId } = await startPayment(paid.customer, paid.bookingId);
    await sendWebhook(ctx, buildWebhook('payment.captured', ctx.razorpay.pay(orderId))).expect(200);
    const again = await startBookingPayment(ctx, paid.customer, paid.bookingId).expect(409);
    expect(again.body.error.code).toBe('BOOKING_ALREADY_PAID');
  });

  it('customers can only see and pay their own bookings', async () => {
    const { bookingId, driver } = await prepaidTrip();
    const stranger = await createCustomer(ctx);

    expect(
      (
        await request(ctx.server)
          .get(`/v1/bookings/${bookingId}`)
          .set(bearer(stranger.token))
          .expect(404)
      ).body.error.code,
    ).toBe('BOOKING_NOT_FOUND');
    await startBookingPayment(ctx, stranger, bookingId).expect(404);
    // Drivers and unauthenticated callers can't use customer routes.
    await request(ctx.server)
      .get(`/v1/bookings/${bookingId}`)
      .set(bearer(driver.token))
      .expect(403);
    await request(ctx.server).get(`/v1/bookings/${bookingId}`).expect(401);
  });

  it('money captured after the booking was cancelled is recorded and flagged for refund review', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const { orderId } = await startPayment(customer, bookingId);
    await engine(ctx)
      .post(`/v1/internal/bookings/${bookingId}/cancel`)
      .send({ reason: 'customer changed plans' })
      .expect(200);

    const webhook = buildWebhook('payment.captured', ctx.razorpay.pay(orderId));
    await sendWebhook(ctx, webhook).expect(200);

    expect(await booking(bookingId)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
    expect(
      await ctx.prisma.paymentEvent.findUnique({ where: { eventId: webhook.eventId } }),
    ).toMatchObject({ outcome: 'PAID_AFTER_CANCELLATION' });
    const review = await ctx.app.get(EarningsReconciliationService).findPaidCancelledBookings();
    expect(review.map((f) => f.bookingId)).toContain(bookingId);
  });

  it('an authorized payment for a cancelled booking is never captured', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const { orderId } = await startPayment(customer, bookingId);
    await engine(ctx)
      .post(`/v1/internal/bookings/${bookingId}/cancel`)
      .send({ reason: 'no driver found' })
      .expect(200);
    const captures = ctx.razorpay.calls.capturePayment;

    const authorized = ctx.razorpay.pay(orderId, { status: 'authorized' });
    const webhook = buildWebhook('payment.authorized', authorized);
    await sendWebhook(ctx, webhook).expect(200);

    expect(ctx.razorpay.calls.capturePayment).toBe(captures);
    expect(ctx.razorpay.payments.get(authorized.id)?.status).toBe('authorized');
    expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
    expect(
      await ctx.prisma.paymentEvent.findUnique({ where: { eventId: webhook.eventId } }),
    ).toMatchObject({ outcome: 'BOOKING_NOT_PAYABLE' });
  });

  it('a booking payment can be recovered by the admin sync when every callback was missed', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const { orderId, paymentId } = await startPayment(customer, bookingId);
    ctx.razorpay.pay(orderId);
    const admin = await createAdmin(ctx);

    const res = await request(ctx.server)
      .post(`/v1/admin/payments/${paymentId}/sync`)
      .set(bearer(admin.token))
      .expect(200);

    expect(res.body.payment).toMatchObject({ status: 'PAID', bookingId });
    expect((await booking(bookingId)).paymentStatus).toBe('PAID');
  });

  it('a wrong checkout signature never marks a booking paid', async () => {
    const { customer, bookingId } = await prepaidTrip();
    const { orderId } = await startPayment(customer, bookingId);
    const payment = ctx.razorpay.pay(orderId);
    const res = await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id, 'not_the_key_secret_value'),
    }).expect(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_SIGNATURE');
    expect((await booking(bookingId)).paymentStatus).toBe('UNPAID');
  });
});
