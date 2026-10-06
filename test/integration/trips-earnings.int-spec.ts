import request from 'supertest';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  type TestAdmin,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  bookedTrip,
  engine,
  registerBooking,
  setTripStatus,
  startBookingPayment,
  settleAndSync,
  TO_DELIVERED,
} from '../helpers/flows';
import { sendWebhook } from '../helpers/http';
import {
  buildDisputeWebhook,
  buildSettlementWebhook,
  buildWebhook,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_INTERNAL_API_KEY } from '../helpers/test-config';

/** Trip engine contract, the M6 payment gate, and per-trip driver earnings (required test #11). */
describe('Trips and driver earnings', () => {
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

  /** A prepaid booking, paid by webhook, delivered: ready to complete. */
  async function paidDeliveredTrip(farePaise = 50_000) {
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise,
      category,
    });
    const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
    const payment = ctx.razorpay.pay(started.body.checkout.orderId as string);
    await sendWebhook(ctx, buildWebhook('payment.captured', payment)).expect(200);
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    return { customer, driver, bookingId, tripId, payment };
  }

  describe('internal API', () => {
    it('requires a valid X-Internal-Api-Key', async () => {
      const missing = await request(ctx.server).get('/v1/internal/bookings/by-ref/X1').expect(401);
      expect(missing.body.error.code).toBe('INTERNAL_AUTH_INVALID');
      await request(ctx.server)
        .get('/v1/internal/bookings/by-ref/X1')
        .set('X-Internal-Api-Key', `${TEST_INTERNAL_API_KEY}x`)
        .expect(401);
      // A user token is not an internal key.
      const customer = await createCustomer(ctx);
      await request(ctx.server)
        .get('/v1/internal/bookings/by-ref/X1')
        .set(bearer(customer.token))
        .expect(401);
    });

    it('is disabled when no key is configured', async () => {
      const disabled = await createTestApp({ configOverrides: { INTERNAL_API_KEYS: '' } });
      try {
        const res = await request(disabled.server)
          .get('/v1/internal/bookings/by-ref/X1')
          .set('X-Internal-Api-Key', TEST_INTERNAL_API_KEY)
          .expect(503);
        expect(res.body.error.code).toBe('INTERNAL_API_DISABLED');
      } finally {
        await disabled.close();
      }
    });

    it('registers a booking idempotently and pins the confirmed fare and fee rule', async () => {
      const customer = await createCustomer(ctx);
      const body = {
        externalRef: `ENG-${Date.now()}`,
        customerSubject: customer.subject,
        vehicleCategory: category,
        paymentMethod: 'PAY_AT_DELIVERY',
        confirmedFarePaise: 50_000,
      };
      const first = await engine(ctx).post('/v1/internal/bookings').send(body).expect(201);
      const again = await engine(ctx).post('/v1/internal/bookings').send(body).expect(200);
      expect(again.body.bookingId).toBe(first.body.bookingId);
      expect(first.body).toMatchObject({
        status: 'CREATED',
        paymentStatus: 'UNPAID',
        farePaise: 50_000,
        paidWith: null,
        trip: null,
      });

      const conflict = await engine(ctx)
        .post('/v1/internal/bookings')
        .send({ ...body, confirmedFarePaise: 60_000 })
        .expect(409);
      expect(conflict.body.error.code).toBe('BOOKING_REF_CONFLICT');

      const unknown = await engine(ctx)
        .post('/v1/internal/bookings')
        .send({
          ...body,
          externalRef: `${body.externalRef}-2`,
          customerSubject: 'nobody_registered',
        })
        .expect(422);
      expect(unknown.body.error.code).toBe('CUSTOMER_NOT_FOUND');

      // The database refuses any later fare change, even from a code path that forgot.
      const bookingId = first.body.bookingId as string;
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE bookings SET fare_estimate_minor = 1, final_fare_minor = 1 WHERE id = ${bookingId}::uuid`,
      ).rejects.toThrow(/immutable/);
    });

    it('enforces the M6 order and treats repeats as no-ops', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { tripId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        category,
      });

      const skip = await setTripStatus(ctx, tripId, 'IN_TRANSIT').expect(409);
      expect(skip.body.error).toMatchObject({
        code: 'INVALID_TRIP_TRANSITION',
        details: { from: 'DRIVER_ASSIGNED', to: 'IN_TRANSIT' },
      });
      await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
      const repeat = await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
      expect(repeat.body.trip.status).toBe('DRIVER_ARRIVED');
      // PAYMENT_CONFIRMED belongs to this backend.
      await engine(ctx)
        .post(`/v1/internal/trips/${tripId}/status`)
        .send({ status: 'PAYMENT_CONFIRMED' })
        .expect(400);
    });

    it('assigns one driver per booking and only approved drivers', async () => {
      const customer = await createCustomer(ctx);
      const bookingId = await registerBooking(ctx, customer, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 20_000,
        category,
      });
      const pending = await createDriver(ctx, { approved: false });
      const refused = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/assign`)
        .send({ driverSubject: pending.subject })
        .expect(422);
      expect(refused.body.error.code).toBe('DRIVER_NOT_APPROVED');

      const driver = await createDriver(ctx);
      const assigned = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/assign`)
        .send({ driverSubject: driver.subject })
        .expect(200);
      const again = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/assign`)
        .send({ driverSubject: driver.subject })
        .expect(200);
      expect(again.body.trip.tripId).toBe(assigned.body.trip.tripId);

      const other = await createDriver(ctx);
      const taken = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/assign`)
        .send({ driverSubject: other.subject })
        .expect(409);
      expect(taken.body.error.code).toBe('TRIP_ALREADY_ASSIGNED');
    });

    it('cancels the booking and its trip; a cancelled trip cannot move', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 20_000,
        category,
      });
      const res = await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'customer cancelled' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', trip: { status: 'CANCELLED' } });
      await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(409);
    });
  });

  describe('completion and earnings', () => {
    it('the payment gate refuses completion until the booking is paid', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { tripId, bookingId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 50_000,
        category,
      });
      await advanceTrip(ctx, tripId, TO_DELIVERED);
      const res = await setTripStatus(ctx, tripId, 'COMPLETED').expect(409);
      expect(res.body.error.code).toBe('PAYMENT_REQUIRED');
      expect(await ctx.prisma.driverEarning.count({ where: { bookingId } })).toBe(0);
      // The database refuses PAYMENT_CONFIRMED for an unpaid booking too.
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE trips SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
          WHERE id = ${tripId}::uuid`,
      ).rejects.toThrow(/unpaid booking/);
    });

    it('#11 completing a trip creates its earning exactly once, even concurrently', async () => {
      const { driver, bookingId, tripId } = await paidDeliveredTrip(50_000);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => setTripStatus(ctx, tripId, 'COMPLETED')),
      );
      expect(results.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200));
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);

      const earnings = await ctx.prisma.driverEarning.findMany({ where: { bookingId } });
      expect(earnings).toHaveLength(1);
      // Captured is not settled: the earning waits for Razorpay's merchant settlement.
      expect(earnings[0]).toMatchObject({
        driverId: driver.driverId,
        status: 'AWAITING_SETTLEMENT',
        payableAt: null,
        paymentSettlementId: null,
        grossAmountPaise: 50_000n,
        platformFeePaise: 5_000n,
        otherDeductionsPaise: 0n,
        tdsAmountPaise: 0n,
        tdsPolicy: 'DISABLED',
        taxRuleId: null,
        netAmountPaise: 45_000n,
      });
      // The database refuses a second earning for the booking.
      const [earning] = earnings;
      if (!earning) {
        throw new Error('expected an earning');
      }
      await expect(
        ctx.prisma.driverEarning.create({
          data: {
            bookingId,
            tripId,
            driverId: driver.driverId,
            settlement: 'ONLINE',
            grossAmountPaise: 50_000n,
            platformFeePaise: 5_000n,
            netAmountPaise: 45_000n,
            feeRuleId: earning.feeRuleId,
            paymentId: earning.paymentId,
            status: 'AWAITING_SETTLEMENT',
          },
        }),
      ).rejects.toThrow(/Unique constraint/i);
      // Deductions are server-computed and immutable: the net must equal gross - fee - TDS.
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE driver_earnings SET tds_amount_paise = 100, net_amount_paise = 44900 WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      // Amounts are immutable and earnings can't be deleted.
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE driver_earnings SET net_amount_paise = 1, gross_amount_paise = 6000 WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        ctx.prisma.$executeRaw`DELETE FROM driver_earnings WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
    });

    it('drivers see the fare, fee and their share, and only their own trips and earnings', async () => {
      const { driver, tripId } = await paidDeliveredTrip(50_000);
      const view = await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(view.body.payment).toMatchObject({
        method: 'PREPAID_UPI',
        status: 'PAID',
        farePaise: 50_000,
        platformFeePaise: 5_000,
        driverSharePaise: 45_000,
        collectionOpen: false,
      });
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);

      const list = await request(ctx.server)
        .get('/v1/earnings')
        .set(bearer(driver.token))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ settlement: 'ONLINE', netAmountPaise: 45_000 });
      const summary = await request(ctx.server)
        .get('/v1/earnings/summary')
        .set(bearer(driver.token))
        .expect(200);
      expect(summary.body).toMatchObject({
        awaitingSettlementPaise: 45_000,
        payablePaise: 0,
        platformFeePaise: 5_000,
        tripCount: 1,
      });
      expect(list.body.items[0]).toMatchObject({
        status: 'AWAITING_SETTLEMENT',
        merchantSettled: false,
        tdsAmountPaise: 0,
        tdsPolicy: 'DISABLED',
      });

      const other = await createDriver(ctx);
      await request(ctx.server).get(`/v1/trips/${tripId}`).set(bearer(other.token)).expect(404);
      await request(ctx.server)
        .get(`/v1/earnings/${list.body.items[0].earningId as string}`)
        .set(bearer(other.token))
        .expect(404);
    });

    it('admins can hold and release payable earnings, with a reason and an audit trail', async () => {
      const { bookingId, tripId, driver } = await paidDeliveredTrip();
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
      const url = `/v1/admin/earnings/${earning.id}`;

      await request(ctx.server)
        .post(`${url}/hold`)
        .set(bearer(driver.token))
        .send({ reason: 'not an admin action' })
        .expect(403);
      await request(ctx.server)
        .post(`${url}/hold`)
        .set(bearer(admin.token))
        .send({ reason: 'x' })
        .expect(400);

      const held = await request(ctx.server)
        .post(`${url}/hold`)
        .set(bearer(admin.token))
        .send({ reason: 'Customer complaint ticket 1234' })
        .expect(200);
      expect(held.body).toMatchObject({
        status: 'ON_HOLD',
        holdReason: 'Customer complaint ticket 1234',
      });
      await request(ctx.server)
        .post(`${url}/hold`)
        .set(bearer(admin.token))
        .send({ reason: 'Customer complaint ticket 1234' })
        .expect(200);

      // Released before the payment is settled: it goes back to waiting, never to PAYABLE.
      const released = await request(ctx.server)
        .post(`${url}/release`)
        .set(bearer(admin.token))
        .send({ reason: 'Complaint resolved, ticket 1234' })
        .expect(200);
      expect(released.body).toMatchObject({ status: 'AWAITING_SETTLEMENT', holdReason: null });

      const actions = await ctx.prisma.adminAction.findMany({
        where: { targetType: 'DRIVER_EARNING', targetId: earning.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual(['EARNING_HELD', 'EARNING_RELEASED']);
      expect(actions.every((a) => a.actorUserId === admin.userId)).toBe(true);
    });

    it('refuses client-sent fees, TDS or net amounts: the backend computes them', async () => {
      const customer = await createCustomer(ctx);
      for (const extra of [
        { tdsRate: '1' },
        { tdsAmountPaise: 500 },
        { netPayablePaise: 45_000 },
        { platformFeePaise: 0 },
      ]) {
        const res = await request(ctx.server)
          .post('/v1/internal/bookings')
          .set('X-Internal-Api-Key', TEST_INTERNAL_API_KEY)
          .send({
            externalRef: `ENG-TDS-${Date.now()}-${Object.keys(extra)[0] ?? ''}`,
            customerSubject: customer.subject,
            vehicleCategory: category,
            paymentMethod: 'PREPAID_UPI',
            confirmedFarePaise: 50_000,
            ...extra,
          })
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      const { tripId, bookingId } = await paidDeliveredTrip();
      await request(ctx.server)
        .post(`/v1/internal/trips/${tripId}/status`)
        .set('X-Internal-Api-Key', TEST_INTERNAL_API_KEY)
        .send({ status: 'COMPLETED', tdsAmountPaise: 500, netPayablePaise: 1 })
        .expect(400);
      expect(await ctx.prisma.driverEarning.count({ where: { bookingId } })).toBe(0);
    });

    it('an earning becomes payable only once Razorpay settles its payment, exactly once', async () => {
      const { bookingId, tripId, payment } = await paidDeliveredTrip();
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
      expect(earning.status).toBe('AWAITING_SETTLEMENT');

      // A settlement whose amount differs from the payment is never recorded.
      const wrong = await settleAndSync(ctx, payment.id, 49_999);
      expect(wrong.amountMismatches).toBe(1);
      expect(await ctx.prisma.paymentSettlement.count({ where: { bookingId } })).toBe(0);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('AWAITING_SETTLEMENT');
    });

    it('settlement.processed webhooks pull the recon data, and repeated syncs change nothing', async () => {
      const { bookingId, tripId, payment } = await paidDeliveredTrip();
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      const settledAt = new Date();
      const settled = ctx.settlements.settle({
        providerPaymentId: payment.id,
        amountPaise: 50_000,
        settledAt,
      });

      const webhook = buildSettlementWebhook(settled.providerSettlementId, settledAt);
      await sendWebhook(ctx, webhook).expect(200);
      await sendWebhook(ctx, webhook).expect(200);
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'SETTLEMENT_SYNCED' });

      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
      const settlement = await ctx.prisma.paymentSettlement.findFirstOrThrow({
        where: { bookingId },
      });
      expect(settlement).toMatchObject({
        providerPaymentId: payment.id,
        providerSettlementId: settled.providerSettlementId,
        amountPaise: 50_000n,
        source: 'SIMULATED',
      });
      expect(earning).toMatchObject({
        status: 'PAYABLE',
        paymentSettlementId: settlement.id,
      });
      expect(earning.payableAt?.getTime()).toBeGreaterThanOrEqual(earning.createdAt.getTime());

      // Admin sync of the same dates: nothing new, nothing changed.
      const again = await request(ctx.server)
        .post('/v1/admin/settlements/sync')
        .set(bearer(admin.token))
        .send({})
        .expect(200);
      expect(again.body).toMatchObject({ enabled: true, trigger: 'ADMIN', recorded: 0 });
      expect(await ctx.prisma.paymentSettlement.count({ where: { bookingId } })).toBe(1);
      const after = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
      expect(after.payableAt).toEqual(earning.payableAt);
      // Settlements are append-only.
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE payment_settlements SET amount_paise = 1 WHERE id = ${settlement.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('a disputed payment puts its earning on hold, even if the dispute arrives first', async () => {
      const late = await paidDeliveredTrip();
      await setTripStatus(ctx, late.tripId, 'COMPLETED').expect(200);
      const disputeId = `disp_${Date.now()}A`;
      const disputeWebhook = buildDisputeWebhook('payment.dispute.created', {
        id: disputeId,
        paymentId: late.payment.id,
        amount: 50_000,
        status: 'open',
      });
      await sendWebhook(ctx, disputeWebhook).expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId: late.bookingId } }),
      ).toMatchObject({ status: 'ON_HOLD' });
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({
          where: { eventId: disputeWebhook.eventId },
        }),
      ).toMatchObject({ outcome: 'DISPUTE_RECORDED', processingError: 'DISPUTE_OPEN:HELD' });

      const early = await paidDeliveredTrip();
      await sendWebhook(
        ctx,
        buildDisputeWebhook('payment.dispute.created', {
          id: `disp_${Date.now()}B`,
          paymentId: early.payment.id,
          amount: 50_000,
          status: 'open',
        }),
      ).expect(200);
      await setTripStatus(ctx, early.tripId, 'COMPLETED').expect(200);
      const held = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: early.bookingId },
      });
      expect(held.status).toBe('ON_HOLD');
      expect(held.holdReason).toMatch(/PAYMENT_DISPUTED/);

      // Winning the dispute does not release the earning automatically.
      await sendWebhook(
        ctx,
        buildDisputeWebhook('payment.dispute.won', {
          id: disputeId,
          paymentId: late.payment.id,
          amount: 50_000,
          status: 'won',
        }),
      ).expect(200);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId: late.bookingId } }))
          .status,
      ).toBe('ON_HOLD');
    });
  });
});
