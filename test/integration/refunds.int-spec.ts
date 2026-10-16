import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma } from '../../src/generated/prisma/client';
import type { ProviderRefund } from '../../src/refunds/refund.gateway';
import { WalletLedgerService } from '../../src/wallet/wallet-ledger.service';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  createVerifiedBankAccount,
  idempotencyKey,
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
  sendPayoutWebhook,
  setStopStatus,
  setTripStatus,
  settleAndSync,
  startBookingPayment,
  TO_DELIVERED,
  TO_IN_TRANSIT,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook, walletBalance } from '../helpers/http';
import {
  buildPayoutWebhook,
  buildRefundWebhook,
  checkoutSignature,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

const ROLLED_BACK = 'rolled back on purpose';
const REASON = 'Customer cancelled before pickup; support ticket 4471';

interface Finding {
  readonly problem: string;
  readonly bookingId: string | null;
  readonly earningId: string | null;
  readonly payoutId: string | null;
  readonly collectionId: string | null;
  readonly amountPaise: number | null;
  readonly detail: string | null;
}

interface PaidTrip {
  readonly customer: TestCustomer;
  readonly driver: TestDriver;
  readonly bookingId: string;
  readonly tripId: string;
  readonly collectionId: string;
  /** QR only: the Razorpay payment the collection completed with. */
  readonly providerPaymentId: string | null;
}

/**
 * Refund infrastructure (payment flow Phase 6). Technical system only: every refund is
 * requested by an admin with a reason, for an amount the server computes; a provider refund goes
 * through Razorpay with the refund id as X-Refund-Idempotency and is completed only by what
 * Razorpay reports; a cash return is recorded with the admin's explicit fee decision. The refund
 * policy stays open (OPEN_DECISIONS L-7 to L-10, L-21): nothing is refunded, debited or
 * recovered automatically, and the database enforces ownership, amounts and the lifecycle for
 * every role, the table owner included.
 */
describe('Refunds (payment flow Phase 6)', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let category: string;
  // Each app signs its own tokens, so each has its own admins.
  const pools = new Map<TestContext, { admins: TestAdmin[]; calls: number }>();

  async function createPool(app: TestContext, size: number): Promise<void> {
    pools.set(app, {
      admins: await Promise.all(Array.from({ length: size }, () => createAdmin(app))),
      calls: 0,
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    await createPool(ctx, 30);
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Refund requests (10/min), payout batches (5/min) and wallet adjustments are rate limited per
  // admin: spread them over a pool.
  function nextAdmin(app: TestContext = ctx): TestAdmin {
    const pool = pools.get(app);
    const actor = pool?.admins[Math.floor(pool.calls / 3) % pool.admins.length];
    if (!pool || !actor) {
      throw new Error('admin pool is empty');
    }
    pool.calls += 1;
    return actor;
  }
  /** The admin that reads reports and syncs refunds in an app. */
  const readerOf = (app: TestContext): TestAdmin =>
    app === ctx ? admin : (pools.get(app)?.admins[0] ?? admin);

  function refund(
    app: TestContext,
    body: Record<string, unknown>,
    options: { key?: string; as?: TestAdmin } = {},
  ): request.Test {
    return request(app.server)
      .post('/v1/admin/refunds')
      .set(bearer((options.as ?? nextAdmin(app)).token))
      .set('Idempotency-Key', options.key ?? idempotencyKey())
      .send(body);
  }
  const provider = (bookingId: string, sourceCollectionId: string, extra = {}) => ({
    bookingId,
    sourceCollectionId,
    kind: 'PROVIDER',
    reason: REASON,
    ...extra,
  });
  const cashReturn = (
    bookingId: string,
    sourceCollectionId: string,
    feeTreatment: string | undefined,
    extra = {},
  ) => ({
    bookingId,
    sourceCollectionId,
    kind: 'CASH_RETURNED',
    reason: 'Cash handed back to the customer at the door; ticket 5512',
    ...(feeTreatment === undefined ? {} : { feeTreatment }),
    ...extra,
  });
  const syncRefund = (app: TestContext, refundId: string) =>
    request(app.server)
      .post(`/v1/admin/refunds/${refundId}/sync`)
      .set(bearer(readerOf(app).token))
      .send();
  const cancelRefund = (refundId: string, reason = 'Duplicate request, raised again; ticket 77') =>
    request(ctx.server)
      .post(`/v1/admin/refunds/${refundId}/cancel`)
      .set(bearer(admin.token))
      .send({ reason });
  const refundRow = (app: TestContext, id: string) =>
    app.prisma.paymentRefund.findUniqueOrThrow({ where: { id } });
  const bookingRow = (app: TestContext, id: string) =>
    app.prisma.booking.findUniqueOrThrow({ where: { id } });
  const collectionRow = (app: TestContext, id: string) =>
    app.prisma.paymentCollection.findUniqueOrThrow({ where: { id } });
  const earningOf = (app: TestContext, bookingId: string) =>
    app.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
  const refundsOf = (app: TestContext, bookingId: string) =>
    app.prisma.paymentRefund.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
  const outcomeOf = async (eventId: string) =>
    (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId } })).outcome;
  const providerRefundsFor = async (app: TestContext, paymentId: string | null) =>
    paymentId ? (await app.refunds.listPaymentRefunds(paymentId)).length : 0;
  async function moneyStatus(app: TestContext, bookingId: string): Promise<string> {
    const rows = await app.prisma.$queryRaw<{ status: string }[]>`
      SELECT booking_money_status(${bookingId}::uuid) AS status`;
    return rows[0]?.status ?? 'none';
  }
  async function report(app: TestContext, name: string): Promise<Finding[]> {
    return (
      await request(app.server)
        .get(`/v1/admin/reconciliation/${name}`)
        .set(bearer(readerOf(app).token))
        .expect(200)
    ).body as Finding[];
  }
  /** Lets a retry claim the refund, as if its last submission was 10 minutes ago. */
  const expireLease = (app: TestContext, refundId: string) =>
    app.prisma.$executeRaw`
      UPDATE payment_refunds SET last_submitted_at = now() - interval '10 minutes'
      WHERE id = ${refundId}::uuid`;
  function deliverRefund(app: TestContext, event: string, state: ProviderRefund) {
    const webhook = buildRefundWebhook(event, state);
    return { webhook, sent: sendWebhook(app, webhook).expect(200) };
  }
  const cancelBooking = (app: TestContext, bookingId: string) =>
    engine(app)
      .post(`/v1/internal/bookings/${bookingId}/cancel`)
      .send({ reason: 'Customer cancelled' })
      .expect(200);
  async function rolledBack(work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Error(ROLLED_BACK);
      }),
    ).rejects.toThrow(ROLLED_BACK);
  }
  async function refused(
    pattern: RegExp,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Error(ROLLED_BACK);
      }),
    ).rejects.toThrow(pattern);
  }

  /**
   * A PAY_AT_PICKUP booking (Rs 200 + Rs 300 drops, Rs 50 fee) paid at the pickup by QR or cash;
   * the trip is at DRIVER_ARRIVED.
   */
  async function paidAtPickup(
    app: TestContext,
    method: 'QR' | 'CASH',
    driver?: TestDriver,
  ): Promise<PaidTrip> {
    const customer = await createCustomer(app);
    const owner = driver ?? (await createDriver(app));
    if (method === 'CASH') {
      await fundWallet(app, nextAdmin(app), owner.driverId, 100_000);
    }
    const trip = await bookedTrip(app, customer, owner, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model: 'QUOTE_PER_STOP',
      dropPaise: [20_000, 30_000],
    });
    await setTripStatus(app, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    const shown = await collect(app, owner, trip.tripId, {
      method: method === 'QR' ? 'ONLINE_QR' : 'CASH',
      amountPaise: 50_000,
    }).expect(201);
    const collectionId = shown.body.collectionId as string;
    let providerPaymentId: string | null = null;
    if (method === 'QR') {
      providerPaymentId = app.links.pay(app.links.byCollection(collectionId).referenceId).id;
      const confirmed = await request(app.server)
        .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
        .set(bearer(owner.token))
        .expect(200);
      expect(confirmed.body.status).toBe('COMPLETED');
    }
    return { customer, driver: owner, ...trip, collectionId, providerPaymentId };
  }

  /** Paid at the pickup, then cancelled before the goods were handed over. */
  async function cancelledBeforeHandover(
    method: 'QR' | 'CASH' = 'QR',
    app: TestContext = ctx,
  ): Promise<PaidTrip> {
    const trip = await paidAtPickup(app, method);
    await cancelBooking(app, trip.bookingId);
    return trip;
  }

  /** Paid at the pickup, picked up, both drops delivered, completed. */
  async function completedPickup(
    method: 'QR' | 'CASH',
    driver?: TestDriver,
    app: TestContext = ctx,
  ): Promise<PaidTrip> {
    const trip = await paidAtPickup(app, method, driver);
    await advanceTrip(app, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
    await deliverStops(app, trip.tripId, [1, 2]);
    await setTripStatus(app, trip.tripId, 'COMPLETED').expect(200);
    return trip;
  }

  async function driverWithBank(): Promise<TestDriver> {
    const driver = await createDriver(ctx);
    await createVerifiedBankAccount(ctx.prisma, driver.driverId, admin.userId);
    return driver;
  }
  const prepareBatch = () =>
    request(ctx.server)
      .post('/v1/admin/payout-batches')
      .set(bearer(nextAdmin().token))
      .set('Idempotency-Key', idempotencyKey())
      .send({});
  const payoutOf = (driverId: string, batchId: string) =>
    ctx.prisma.driverPayout.findUnique({ where: { batchId_driverId: { batchId, driverId } } });

  /** A PAY_AT_DELIVERY booking priced per drop, under way; drops are paid with payDrop. */
  async function deliveryUnderWay(drops: number[]) {
    const driver = await createDriver(ctx);
    await fundWallet(ctx, nextAdmin(), driver.driverId, 100_000);
    const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      model: 'QUOTE_PER_STOP',
      farePaise: drops.reduce((sum, paise) => sum + paise, 0),
      dropPaise: drops,
      category,
    });
    await advanceTrip(ctx, trip.tripId, TO_IN_TRANSIT);
    return { driver, ...trip };
  }
  /** Reaches a drop and shows its QR (paid by the customer when `pay`), or takes cash. */
  async function drop(
    trip: { driver: TestDriver; tripId: string },
    sequence: number,
    amountPaise: number,
    method: 'QR' | 'CASH',
    pay = true,
  ): Promise<{ collectionId: string; providerPaymentId: string | null }> {
    await setStopStatus(ctx, trip.tripId, sequence, 'ARRIVED').expect(200);
    const shown = await collect(ctx, trip.driver, trip.tripId, {
      method: method === 'QR' ? 'ONLINE_QR' : 'CASH',
      amountPaise,
      stopSequence: sequence,
    }).expect(201);
    const collectionId = shown.body.collectionId as string;
    if (method === 'CASH' || !pay) {
      return { collectionId, providerPaymentId: null };
    }
    const payment = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId);
    await request(ctx.server)
      .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
      .set(bearer(trip.driver.token))
      .expect(200);
    return { collectionId, providerPaymentId: payment.id };
  }

  describe('provider refunds', () => {
    it('refunds a cancelled booking QR payment through Razorpay, completed only by what Razorpay reports, once', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const requester = nextAdmin();
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
        as: requester,
      }).expect(201);
      expect(res.body).toMatchObject({
        created: true,
        submission: 'PROCESSING',
        refund: {
          bookingId: trip.bookingId,
          stopSequence: null,
          sourceCollectionId: trip.collectionId,
          sourcePaymentId: null,
          kind: 'PROVIDER',
          status: 'PROCESSING',
          refundCase: 'CANCELLED_BEFORE_HANDOVER',
          // Computed by the server from the collection: the admin sent no amount.
          amountPaise: 50_000,
          currency: 'INR',
          reason: REASON,
          requestedByUserId: requester.userId,
          provider: 'RAZORPAY',
          providerPaymentId: trip.providerPaymentId,
          providerStatus: 'pending',
          feeTreatment: null,
          feeCreditPaise: null,
          walletTransactionId: null,
          submitAttempts: 1,
          completedAt: null,
        },
      });
      const refundId = res.body.refund.refundId as string;
      // Sent once, with the refund id as the idempotency key and receipt, our ids in the notes.
      const sent = ctx.refunds.forRefund(refundId);
      expect(sent).toMatchObject({
        paymentId: trip.providerPaymentId,
        amount: 50_000,
        receipt: refundId,
        notes: {
          refund_id: refundId,
          booking_id: trip.bookingId,
          collection_id: trip.collectionId,
        },
      });
      expect(res.body.refund.providerRefundId).toBe(sent?.id);
      expect(await bookingRow(ctx, trip.bookingId)).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'REFUND_PENDING',
      });
      expect((await collectionRow(ctx, trip.collectionId)).refundedPaise).toBe(0n);
      expect(
        await ctx.prisma.adminAction.findFirst({
          where: { targetId: refundId, action: 'REFUND_REQUESTED' },
        }),
      ).toMatchObject({
        actorUserId: requester.userId,
        reason: REASON,
        targetType: 'PAYMENT_REFUND',
      });

      // Razorpay processes it and says so through the signed webhook.
      const processed = ctx.refunds.setStatus(sent?.id ?? '', 'processed', '74836185829');
      const { webhook, sent: delivered } = deliverRefund(ctx, 'refund.processed', processed);
      await delivered;
      expect(await outcomeOf(webhook.eventId)).toBe('REFUND_APPLIED');
      const completed = await refundRow(ctx, refundId);
      expect(completed).toMatchObject({
        status: 'COMPLETED',
        providerStatus: 'processed',
        providerReference: '74836185829',
      });
      expect(completed.completedAt).not.toBeNull();
      // The collection keeps its facts; only what was refunded of it is added.
      expect(await collectionRow(ctx, trip.collectionId)).toMatchObject({
        status: 'COMPLETED',
        amountPaise: 50_000n,
        refundedPaise: 50_000n,
      });
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUNDED');
      expect(await moneyStatus(ctx, trip.bookingId)).toBe('REFUNDED');

      // Razorpay's retry of the same event, another delivery of the same state, and an older
      // state arriving late change nothing.
      await sendWebhook(ctx, webhook).expect(200);
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'REFUND_APPLIED', attempts: 1 });
      const again = deliverRefund(ctx, 'refund.processed', processed);
      await again.sent;
      expect(await outcomeOf(again.webhook.eventId)).toBe('REFUND_ALREADY_APPLIED');
      const late = deliverRefund(ctx, 'refund.created', { ...processed, status: 'pending' });
      await late.sent;
      expect(await outcomeOf(late.webhook.eventId)).toBe('REFUND_STALE_UPDATE');
      expect(await refundRow(ctx, refundId)).toMatchObject({ status: 'COMPLETED' });
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: refundId, action: 'REFUND_COMPLETED' },
        }),
      ).toBe(1);

      // Nothing is left to refund: a second refund is refused, and Razorpay was asked once.
      const more = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(409);
      expect(more.body.error).toMatchObject({
        code: 'REFUND_SOURCE_NOT_REFUNDABLE',
        details: { reason: 'ALREADY_REFUNDED', refundablePaise: 0 },
      });
      expect(await providerRefundsFor(ctx, trip.providerPaymentId)).toBe(1);

      // The money trail shows it; the paid-cancelled review no longer lists it.
      const chain = await request(ctx.server)
        .get(`/v1/admin/bookings/${trip.bookingId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(chain.body.booking.paymentStatus).toBe('REFUNDED');
      expect(chain.body.collections).toMatchObject([
        { collectionId: trip.collectionId, amountPaise: 50_000, refundedPaise: 50_000 },
      ]);
      expect(chain.body.refunds).toMatchObject([
        {
          refundId,
          kind: 'PROVIDER',
          status: 'COMPLETED',
          amountPaise: 50_000,
          providerRefundId: sent?.id,
          providerReference: '74836185829',
          walletCredit: null,
        },
      ]);
      const review = await report(ctx, 'paid-cancelled-bookings');
      expect(review.map((finding) => finding.bookingId)).not.toContain(trip.bookingId);
      const fetched = await request(ctx.server)
        .get(`/v1/admin/refunds/${refundId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(fetched.body).toMatchObject({ refundId, status: 'COMPLETED' });
      const listed = await request(ctx.server)
        .get(`/v1/admin/refunds?bookingId=${trip.bookingId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(listed.body.map((entry: { refundId: string }) => entry.refundId)).toEqual([refundId]);
    });

    it('a refund Razorpay fails gives the money status back and lets an admin request a new one', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      const failed = ctx.refunds.setStatus(res.body.refund.providerRefundId as string, 'failed');
      const { webhook, sent } = deliverRefund(ctx, 'refund.failed', failed);
      await sent;
      expect(await outcomeOf(webhook.eventId)).toBe('REFUND_APPLIED');
      const row = await refundRow(ctx, refundId);
      expect(row).toMatchObject({ status: 'FAILED', failureReason: 'PROVIDER_FAILED:failed' });
      expect(row.failedAt).not.toBeNull();
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PAID');
      expect((await collectionRow(ctx, trip.collectionId)).refundedPaise).toBe(0n);
      // Back on the review list for its full amount.
      expect(
        (await report(ctx, 'paid-cancelled-bookings')).filter(
          (finding) => finding.bookingId === trip.bookingId,
        ),
      ).toMatchObject([{ collectionId: trip.collectionId, amountPaise: 50_000 }]);
      // A failed refund is final; an admin may request a new one.
      const retry = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      expect(retry.body.refund).toMatchObject({ status: 'PROCESSING', amountPaise: 50_000 });
      expect(retry.body.refund.refundId).not.toBe(refundId);
    });

    it('Razorpay rejecting the request refuses the refund; nothing was refunded', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.queueCreateBehaviour('reject');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      expect(res.body).toMatchObject({
        created: true,
        submission: 'REFUSED',
        refund: {
          status: 'REFUSED',
          providerRefundId: null,
          failureReason: 'PROVIDER_REJECTED:BAD_REQUEST_ERROR',
        },
      });
      const refundId = res.body.refund.refundId as string;
      expect(ctx.refunds.forRefund(refundId)).toBeUndefined();
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PAID');
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: refundId, action: 'REFUND_REFUSED' },
        }),
      ).toBe(1);
      // A refused refund is final and holds nothing: a new request can be made.
      await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
    });

    it('an unreadable reply never closes a refund Razorpay made', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.queueCreateBehaviour('unparseable');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      // Razorpay was checked for our refund id before anything was concluded: it exists.
      expect(res.body).toMatchObject({
        submission: 'PROCESSING',
        refund: { status: 'PROCESSING' },
      });
      expect(res.body.refund.providerRefundId).toBe(ctx.refunds.forRefund(refundId)?.id);
    });

    it('an outage leaves it PENDING; it is retried with the same key, and never sent twice at once', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const requester = await createAdmin(ctx);
      const key = idempotencyKey();
      ctx.refunds.unavailable = true;
      let refundId: string;
      try {
        const res = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
          key,
          as: requester,
        }).expect(201);
        expect(res.body).toMatchObject({
          created: true,
          submission: 'PENDING_RETRY',
          refund: { status: 'PENDING', submitAttempts: 1, providerRefundId: null },
        });
        refundId = res.body.refund.refundId as string;
      } finally {
        ctx.refunds.unavailable = false;
      }
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUND_PENDING');

      // A retry within the submission lease is not sent again.
      const replay = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
        key,
        as: requester,
      }).expect(200);
      expect(replay.body).toMatchObject({
        created: false,
        submission: 'SKIPPED',
        refund: { refundId, status: 'PENDING' },
      });
      expect(ctx.refunds.forRefund(refundId)).toBeUndefined();

      // Once the lease has passed, a sync finds nothing at Razorpay and sends it, same key.
      await expireLease(ctx, refundId);
      const synced = await syncRefund(ctx, refundId).expect(200);
      expect(synced.body).toMatchObject({
        outcome: 'RESUBMITTED_PROCESSING',
        refund: { status: 'PROCESSING', submitAttempts: 2 },
      });
      expect(await providerRefundsFor(ctx, trip.providerPaymentId)).toBe(1);
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: refundId, action: 'REFUND_SYNCED', actorUserId: admin.userId },
        }),
      ).toBe(1);
    });

    it('Razorpay refunded but the reply was lost: a retry finds it instead of refunding again', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const requester = await createAdmin(ctx);
      const key = idempotencyKey();
      ctx.refunds.queueCreateBehaviour('lose-response');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
        key,
        as: requester,
      }).expect(201);
      expect(res.body).toMatchObject({
        submission: 'PENDING_RETRY',
        refund: { status: 'PENDING' },
      });
      const refundId = res.body.refund.refundId as string;
      const atRazorpay = ctx.refunds.forRefund(refundId);
      expect(atRazorpay).toBeDefined();

      // The client retries the request after the lease: Razorpay is checked first.
      await expireLease(ctx, refundId);
      const creates = ctx.refunds.calls.createRefund;
      const replay = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
        key,
        as: requester,
      }).expect(200);
      expect(replay.body).toMatchObject({
        created: false,
        submission: 'PROCESSING',
        refund: { refundId, status: 'PROCESSING', providerRefundId: atRazorpay?.id },
      });
      expect(ctx.refunds.calls.createRefund).toBe(creates);
      expect(await providerRefundsFor(ctx, trip.providerPaymentId)).toBe(1);
    });

    it('a webhook for a refund whose reply was lost is matched by our receipt', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.queueCreateBehaviour('lose-response');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      const atRazorpay = ctx.refunds.forRefund(refundId);
      const processed = ctx.refunds.setStatus(atRazorpay?.id ?? '', 'processed');
      const { webhook, sent } = deliverRefund(ctx, 'refund.processed', processed);
      await sent;
      expect(await outcomeOf(webhook.eventId)).toBe('REFUND_APPLIED');
      expect(await refundRow(ctx, refundId)).toMatchObject({
        status: 'COMPLETED',
        providerRefundId: atRazorpay?.id,
      });
      const synced = await syncRefund(ctx, refundId).expect(200);
      expect(synced.body).toMatchObject({ outcome: 'REFUND_ALREADY_APPLIED' });
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUNDED');
    });

    it('a sync and webhook deliveries racing on the same state converge on one completion', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      const processed = ctx.refunds.setStatus(
        res.body.refund.providerRefundId as string,
        'processed',
      );
      const first = buildRefundWebhook('refund.processed', processed);
      await Promise.all([
        syncRefund(ctx, refundId).expect(200),
        sendWebhook(ctx, first).expect(200),
        sendWebhook(ctx, first).expect(200),
        sendWebhook(ctx, buildRefundWebhook('refund.processed', processed)).expect(200),
      ]);
      expect(await refundRow(ctx, refundId)).toMatchObject({ status: 'COMPLETED' });
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: refundId, action: 'REFUND_COMPLETED' },
        }),
      ).toBe(1);
      expect((await collectionRow(ctx, trip.collectionId)).refundedPaise).toBe(50_000n);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUNDED');
    });

    it('unknown, mismatched, contradictory and forged refund webhooks are never applied', async () => {
      // A refund made on the Razorpay dashboard: reported, nothing recorded.
      const paid = await cancelledBeforeHandover('QR');
      const dashboard = ctx.refunds.createExternal(paid.providerPaymentId ?? '', 50_000);
      const unknown = deliverRefund(ctx, 'refund.processed', dashboard);
      await unknown.sent;
      const event = await ctx.prisma.paymentEvent.findUniqueOrThrow({
        where: { eventId: unknown.webhook.eventId },
      });
      expect(event).toMatchObject({ outcome: 'REFUND_UNKNOWN' });
      expect(event.processingError).toMatch(/^REFUND_UNKNOWN/);
      expect(await refundsOf(ctx, paid.bookingId)).toEqual([]);
      expect((await bookingRow(ctx, paid.bookingId)).paymentStatus).toBe('PAID');
      expect(
        (await report(ctx, 'webhook-anomalies')).map(
          (anomaly) => (anomaly as unknown as { eventId: string }).eventId,
        ),
      ).toContain(unknown.webhook.eventId);

      // Our refund, but another amount: not applied.
      const res = await refund(ctx, provider(paid.bookingId, paid.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      const ours = ctx.refunds.forRefund(refundId);
      if (!ours) {
        throw new Error('expected the provider refund');
      }
      const mismatch = deliverRefund(ctx, 'refund.processed', {
        ...ours,
        status: 'processed',
        amount: 100,
      });
      await mismatch.sent;
      expect(await outcomeOf(mismatch.webhook.eventId)).toBe('REFUND_MISMATCH');
      expect((await refundRow(ctx, refundId)).status).toBe('PROCESSING');

      // A refund we closed without Razorpay that Razorpay reports anyway: a conflict for review.
      const other = await cancelledBeforeHandover('QR');
      ctx.refunds.queueCreateBehaviour('reject');
      const refusedRes = await refund(ctx, provider(other.bookingId, other.collectionId)).expect(
        201,
      );
      const refusedId = refusedRes.body.refund.refundId as string;
      const conflict = deliverRefund(ctx, 'refund.processed', {
        id: `rfnd_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
        paymentId: other.providerPaymentId ?? '',
        amount: 50_000,
        currency: 'INR',
        status: 'processed',
        receipt: refusedId,
        notes: { refund_id: refusedId },
        reference: null,
      });
      await conflict.sent;
      expect(await outcomeOf(conflict.webhook.eventId)).toBe('REFUND_CONFLICTING_STATE');
      expect((await refundRow(ctx, refusedId)).status).toBe('REFUSED');

      // A forged webhook is rejected before anything is read.
      const forged = buildRefundWebhook('refund.processed', { ...ours, status: 'processed' });
      const rejected = await sendWebhook(ctx, forged, { signature: 'f'.repeat(64) }).expect(400);
      expect(rejected.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      expect((await refundRow(ctx, refundId)).status).toBe('PROCESSING');
    });

    it('an admin cancels a refund that never reached Razorpay, and only that', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.unavailable = true;
      let refundId: string;
      try {
        const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
        refundId = res.body.refund.refundId as string;
      } finally {
        ctx.refunds.unavailable = false;
      }
      // While a submission may be in flight it can't be cancelled.
      const early = await cancelRefund(refundId).expect(409);
      expect(early.body.error).toMatchObject({
        code: 'REFUND_INVALID_STATE',
        details: { reason: 'SUBMISSION_IN_PROGRESS' },
      });
      await cancelRefund(refundId, 'short').expect(400);
      await expireLease(ctx, refundId);
      const lookups = ctx.refunds.calls.listPaymentRefunds;
      const cancelled = await cancelRefund(refundId).expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelledByUserId: admin.userId,
        cancellationReason: 'Duplicate request, raised again; ticket 77',
      });
      // Razorpay was checked first (it had been sent once).
      expect(ctx.refunds.calls.listPaymentRefunds).toBe(lookups + 1);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PAID');
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: refundId, action: 'REFUND_CANCELLED', actorUserId: admin.userId },
        }),
      ).toBe(1);
      // A cancelled refund is never sent.
      const synced = await syncRefund(ctx, refundId).expect(200);
      expect(synced.body).toMatchObject({
        outcome: 'NOT_FOUND_AT_PROVIDER',
        refund: { status: 'CANCELLED' },
      });
      expect(ctx.refunds.forRefund(refundId)).toBeUndefined();
      const again = await cancelRefund(refundId).expect(409);
      expect(again.body.error).toMatchObject({ code: 'REFUND_INVALID_STATE' });

      // One that reached Razorpay is updated instead of cancelled.
      const reached = await cancelledBeforeHandover('QR');
      ctx.refunds.queueCreateBehaviour('lose-response');
      const lost = await refund(ctx, provider(reached.bookingId, reached.collectionId)).expect(201);
      const lostId = lost.body.refund.refundId as string;
      await expireLease(ctx, lostId);
      const refusedCancel = await cancelRefund(lostId).expect(409);
      expect(refusedCancel.body.error).toMatchObject({
        code: 'REFUND_INVALID_STATE',
        details: { reason: 'REACHED_PROVIDER', status: 'PROCESSING' },
      });
      expect((await refundRow(ctx, lostId)).status).toBe('PROCESSING');
      const notPending = await cancelRefund(lostId).expect(409);
      expect(notPending.body.error.details).toMatchObject({ reason: 'NOT_PENDING' });
    });

    it('provider refunds off: refused before anything is recorded; cash returns still work', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.enabled = false;
      try {
        const off = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(503);
        expect(off.body.error.code).toBe('REFUND_PROVIDER_NOT_CONFIGURED');
        expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
        const cash = await cancelledBeforeHandover('CASH');
        await refund(ctx, cashReturn(cash.bookingId, cash.collectionId, 'KEPT')).expect(201);
      } finally {
        ctx.refunds.enabled = true;
      }
    });
  });

  describe('cash returns', () => {
    it('records cash handed back on a completed cash trip; fee kept: no wallet movement, the earning untouched and reported (L-21)', async () => {
      const trip = await completedPickup('CASH');
      const earning = await earningOf(ctx, trip.bookingId);
      expect(earning).toMatchObject({ settlement: 'CASH', status: 'SETTLED_IN_CASH' });
      const balance = await walletBalance(ctx, trip.driver.driverId);
      const entries = await ctx.prisma.driverWalletTransaction.count({
        where: { wallet: { driverId: trip.driver.driverId } },
      });
      const creates = ctx.refunds.calls.createRefund;

      const res = await refund(ctx, cashReturn(trip.bookingId, trip.collectionId, 'KEPT')).expect(
        201,
      );
      expect(res.body).toMatchObject({
        created: true,
        submission: null,
        refund: {
          kind: 'CASH_RETURNED',
          status: 'COMPLETED',
          refundCase: 'COMPLETED_BOOKING',
          amountPaise: 50_000,
          feeTreatment: 'KEPT',
          feeCreditPaise: null,
          walletTransactionId: null,
          provider: null,
          providerPaymentId: null,
          providerRefundId: null,
          submitAttempts: 0,
        },
      });
      expect(res.body.refund.completedAt).not.toBeNull();
      const refundId = res.body.refund.refundId as string;
      // Nothing was sent to Razorpay and nothing moved in the wallet.
      expect(ctx.refunds.calls.createRefund).toBe(creates);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(balance);
      expect(
        await ctx.prisma.driverWalletTransaction.count({
          where: { wallet: { driverId: trip.driver.driverId } },
        }),
      ).toBe(entries);
      // The earning keeps its financial truth; reconciliation reports the case for a decision.
      expect(await earningOf(ctx, trip.bookingId)).toEqual(earning);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUNDED');
      expect((await collectionRow(ctx, trip.collectionId)).refundedPaise).toBe(50_000n);
      expect(
        (await report(ctx, 'refund-anomalies')).filter(
          (finding) => finding.bookingId === trip.bookingId,
        ),
      ).toMatchObject([
        { problem: 'REFUND_ON_CASH_EARNING', earningId: earning.id, amountPaise: 50_000 },
      ]);
      const audit = await ctx.prisma.adminAction.findFirstOrThrow({
        where: { targetId: refundId, action: 'CASH_RETURN_RECORDED' },
      });
      expect(audit.details).toMatchObject({
        feeTreatment: 'KEPT',
        feeCreditPaise: null,
        earningHold: 'CASH_EARNING',
        refundCase: 'COMPLETED_BOOKING',
      });
    });

    it('credits the cash platform fee back to the collecting driver, once, only on the admin decision', async () => {
      const trip = await cancelledBeforeHandover('CASH');
      const balance = await walletBalance(ctx, trip.driver.driverId);
      const requester = await createAdmin(ctx);
      const key = idempotencyKey();
      const body = cashReturn(trip.bookingId, trip.collectionId, 'CREDITED_TO_WALLET');
      const res = await refund(ctx, body, { key, as: requester }).expect(201);
      expect(res.body.refund).toMatchObject({
        status: 'COMPLETED',
        refundCase: 'CANCELLED_BEFORE_HANDOVER',
        feeTreatment: 'CREDITED_TO_WALLET',
        feeCreditPaise: 5_000,
      });
      const refundId = res.body.refund.refundId as string;
      const entry = await ctx.prisma.driverWalletTransaction.findUniqueOrThrow({
        where: { id: res.body.refund.walletTransactionId as string },
      });
      expect(entry).toMatchObject({
        type: 'REFUND_REVERSAL',
        direction: 'CREDIT',
        amountPaise: 5_000n,
        referenceType: 'REFUND',
        referenceId: refundId,
        idempotencyKey: `refund-fee-credit:${refundId}`,
        performedByUserId: requester.userId,
      });
      expect(entry.reason).toMatch(/platform fee credited back/);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(balance + 5_000n);

      // A retried request returns the same cash return and credits nothing more.
      const replay = await refund(ctx, body, { key, as: requester }).expect(200);
      expect(replay.body).toMatchObject({ created: false, refund: { refundId } });
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(balance + 5_000n);
      expect(
        await ctx.prisma.driverWalletTransaction.count({
          where: { type: 'REFUND_REVERSAL', referenceId: refundId },
        }),
      ).toBe(1);
      expect((await report(ctx, 'wallet-mismatches')).length).toBe(0);
      const chain = await request(ctx.server)
        .get(`/v1/admin/bookings/${trip.bookingId}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(chain.body.refunds).toMatchObject([
        { refundId, feeTreatment: 'CREDITED_TO_WALLET', walletCredit: { amountPaise: 5_000 } },
      ]);
    });

    it('needs an explicit fee decision, and the means the money came by', async () => {
      const cash = await cancelledBeforeHandover('CASH');
      const qr = await cancelledBeforeHandover('QR');
      const balance = await walletBalance(ctx, cash.driver.driverId);
      const missing = await refund(
        ctx,
        cashReturn(cash.bookingId, cash.collectionId, undefined),
      ).expect(422);
      expect(missing.body.error).toMatchObject({
        code: 'REFUND_FEE_TREATMENT_REQUIRED',
        details: { reason: 'MISSING' },
      });
      await refund(ctx, cashReturn(cash.bookingId, cash.collectionId, 'MAYBE')).expect(400);
      const online = await refund(ctx, provider(cash.bookingId, cash.collectionId)).expect(422);
      expect(online.body.error).toMatchObject({
        code: 'REFUND_SOURCE_INVALID',
        details: { reason: 'NOT_ONLINE' },
      });
      const notCash = await refund(ctx, cashReturn(qr.bookingId, qr.collectionId, 'KEPT')).expect(
        422,
      );
      expect(notCash.body.error).toMatchObject({
        code: 'REFUND_SOURCE_INVALID',
        details: { reason: 'NOT_CASH' },
      });
      const decision = await refund(
        ctx,
        provider(qr.bookingId, qr.collectionId, { feeTreatment: 'KEPT' }),
      ).expect(422);
      expect(decision.body.error.details).toMatchObject({ reason: 'NOT_A_CASH_RETURN' });
      expect(await refundsOf(ctx, cash.bookingId)).toEqual([]);
      expect(await refundsOf(ctx, qr.bookingId)).toEqual([]);
      expect(await walletBalance(ctx, cash.driver.driverId)).toBe(balance);
    });
  });

  describe('policy stays open, with safe defaults', () => {
    it('cancelling a paid booking refunds nothing on its own: it is listed for review', async () => {
      const trip = await paidAtPickup(ctx, 'QR');
      const creates = ctx.refunds.calls.createRefund;
      await cancelBooking(ctx, trip.bookingId);
      expect(await bookingRow(ctx, trip.bookingId)).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'PAID',
      });
      expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
      expect(ctx.refunds.calls.createRefund).toBe(creates);
      expect(
        (await report(ctx, 'paid-cancelled-bookings')).filter(
          (finding) => finding.bookingId === trip.bookingId,
        ),
      ).toMatchObject([
        { problem: 'PAID_BOOKING_CANCELLED', collectionId: trip.collectionId, amountPaise: 50_000 },
      ]);
    });

    it('refunds only a cancelled or completed booking (a live trip is never refunded)', async () => {
      const trip = await paidAtPickup(ctx, 'QR');
      const live = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(409);
      expect(live.body.error).toMatchObject({
        code: 'REFUND_SOURCE_NOT_REFUNDABLE',
        details: { reason: 'BOOKING_NOT_CLOSED' },
      });
      await advanceTrip(ctx, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
      await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(409);
      expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
    });

    it('the server computes the amount; another one is refused while partial refunds are off (L-9)', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const partial = await refund(
        ctx,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 10_000 }),
      ).expect(422);
      expect(partial.body.error).toMatchObject({
        code: 'REFUND_AMOUNT_NOT_ALLOWED',
        details: { refundablePaise: 50_000, reason: 'PARTIAL_NOT_ALLOWED' },
      });
      const tooMuch = await refund(
        ctx,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 50_001 }),
      ).expect(422);
      expect(tooMuch.body.error.details).toMatchObject({ reason: 'TOO_MUCH' });
      // A client can't set anything the server decides.
      for (const extra of [
        { status: 'COMPLETED' },
        { providerRefundId: 'rfnd_ClientChosen01' },
        { refundCase: 'COMPLETED_BOOKING' },
        { feeCreditPaise: 1 },
      ]) {
        const injected = await refund(
          ctx,
          provider(trip.bookingId, trip.collectionId, extra),
        ).expect(400);
        expect(injected.body.error.code).toBe('VALIDATION_FAILED');
      }
      for (const amountPaise of [0, -5, 12.5, '50000']) {
        await refund(ctx, provider(trip.bookingId, trip.collectionId, { amountPaise })).expect(400);
      }
      expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
      const exact = await refund(
        ctx,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 50_000 }),
      ).expect(201);
      expect(exact.body.refund.amountPaise).toBe(50_000);
    });

    it('records what the facts show: cancelled after the handover, an undelivered drop', async () => {
      const after = await paidAtPickup(ctx, 'QR');
      await setTripStatus(ctx, after.tripId, 'PICKUP_VERIFIED').expect(200);
      await cancelBooking(ctx, after.bookingId);
      const afterRes = await refund(ctx, provider(after.bookingId, after.collectionId)).expect(201);
      expect(afterRes.body.refund.refundCase).toBe('CANCELLED_AFTER_HANDOVER');

      // A drop paid on arrival, then not delivered (an admin resolved it), the trip completed.
      const trip = await deliveryUnderWay([20_000, 30_000]);
      const first = await drop(trip, 1, 20_000, 'QR');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERY_FAILED', 'Receiver refused').expect(200);
      await resolveStop(ctx, admin, trip.bookingId, 1, {
        resolution: 'UNDELIVERED',
        reason: 'Receiver refused the goods; returned to sender',
      }).expect(200);
      await drop(trip, 2, 30_000, 'CASH');
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERED').expect(200);
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const res = await refund(
        ctx,
        provider(trip.bookingId, first.collectionId, { stopSequence: 1 }),
      ).expect(201);
      expect(res.body.refund).toMatchObject({
        refundCase: 'UNDELIVERED_DROP',
        stopSequence: 1,
        amountPaise: 20_000,
      });
      // The earning was already held for the undelivered drop (L-11): it stays held.
      const audit = await ctx.prisma.adminAction.findFirstOrThrow({
        where: { targetId: res.body.refund.refundId as string, action: 'REFUND_REQUESTED' },
      });
      expect(audit.details).toMatchObject({ earningHold: 'ALREADY_ON_HOLD' });
      expect((await earningOf(ctx, trip.bookingId)).status).toBe('ON_HOLD');
    });
  });

  describe('with partial refunds on and cancellations before the handover excluded', () => {
    let narrow: TestContext;

    beforeAll(async () => {
      narrow = await createTestApp({
        configOverrides: {
          REFUND_PARTIAL_ALLOWED: 'true',
          REFUND_ALLOWED_CASES: 'CANCELLED_AFTER_HANDOVER,UNDELIVERED_DROP,COMPLETED_BOOKING',
        },
      });
      await createPool(narrow, 8);
    });

    afterAll(async () => {
      await narrow.close();
    });

    it('refuses a case the configuration excludes (L-7)', async () => {
      const trip = await cancelledBeforeHandover('QR', narrow);
      const res = await refund(narrow, provider(trip.bookingId, trip.collectionId)).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'REFUND_CASE_NOT_ALLOWED',
        details: { refundCase: 'CANCELLED_BEFORE_HANDOVER' },
      });
      expect(await refundsOf(narrow, trip.bookingId)).toEqual([]);
      expect((await bookingRow(narrow, trip.bookingId)).paymentStatus).toBe('PAID');
    });

    it('returns part of the cash, then the rest, never more; the fee only with the last part', async () => {
      const trip = await completedPickup('CASH', undefined, narrow);
      const balance = await walletBalance(narrow, trip.driver.driverId);
      const early = await refund(
        narrow,
        cashReturn(trip.bookingId, trip.collectionId, 'CREDITED_TO_WALLET', {
          amountPaise: 20_000,
        }),
      ).expect(422);
      expect(early.body.error).toMatchObject({
        code: 'REFUND_FEE_TREATMENT_REQUIRED',
        details: { reason: 'NEEDS_FULL_RETURN' },
      });
      await refund(
        narrow,
        cashReturn(trip.bookingId, trip.collectionId, 'KEPT', { amountPaise: 20_000 }),
      ).expect(201);
      expect((await bookingRow(narrow, trip.bookingId)).paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect((await collectionRow(narrow, trip.collectionId)).refundedPaise).toBe(20_000n);
      const tooMuch = await refund(
        narrow,
        cashReturn(trip.bookingId, trip.collectionId, 'KEPT', { amountPaise: 30_001 }),
      ).expect(422);
      expect(tooMuch.body.error.details).toMatchObject({
        refundablePaise: 30_000,
        reason: 'TOO_MUCH',
      });
      const rest = await refund(
        narrow,
        cashReturn(trip.bookingId, trip.collectionId, 'CREDITED_TO_WALLET'),
      ).expect(201);
      expect(rest.body.refund).toMatchObject({ amountPaise: 30_000, feeCreditPaise: 5_000 });
      expect((await bookingRow(narrow, trip.bookingId)).paymentStatus).toBe('REFUNDED');
      expect(await walletBalance(narrow, trip.driver.driverId)).toBe(balance + 5_000n);
      const none = await refund(
        narrow,
        cashReturn(trip.bookingId, trip.collectionId, 'KEPT', { amountPaise: 1 }),
      ).expect(409);
      expect(none.body.error.details).toMatchObject({ reason: 'ALREADY_REFUNDED' });
    });

    it('refunds part of an online payment; one refund of a source at a time', async () => {
      const trip = await completedPickup('QR', undefined, narrow);
      narrow.refunds.captured.set(trip.providerPaymentId ?? '', 50_000);
      const first = await refund(
        narrow,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 20_000 }),
      ).expect(201);
      const busy = await refund(
        narrow,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 10_000 }),
      ).expect(409);
      expect(busy.body.error).toMatchObject({
        code: 'REFUND_IN_PROGRESS',
        details: { refundId: first.body.refund.refundId },
      });
      const processed = narrow.refunds.setStatus(
        first.body.refund.providerRefundId as string,
        'processed',
      );
      await sendWebhook(narrow, buildRefundWebhook('refund.processed', processed)).expect(200);
      expect((await bookingRow(narrow, trip.bookingId)).paymentStatus).toBe('PARTIALLY_REFUNDED');
      const rest = await refund(narrow, provider(trip.bookingId, trip.collectionId)).expect(201);
      expect(rest.body.refund.amountPaise).toBe(30_000);
      const done = narrow.refunds.setStatus(
        rest.body.refund.providerRefundId as string,
        'processed',
      );
      await sendWebhook(narrow, buildRefundWebhook('refund.processed', done)).expect(200);
      expect((await bookingRow(narrow, trip.bookingId)).paymentStatus).toBe('REFUNDED');
      expect((await collectionRow(narrow, trip.collectionId)).refundedPaise).toBe(50_000n);
    });
  });

  describe('ownership', () => {
    it('refunds only a source of the booking (and drop) named', async () => {
      const a = await cancelledBeforeHandover('QR');
      const b = await cancelledBeforeHandover('QR');
      const foreign = await refund(ctx, provider(a.bookingId, b.collectionId)).expect(422);
      expect(foreign.body.error).toMatchObject({
        code: 'REFUND_SOURCE_INVALID',
        details: { reason: 'NOT_THIS_BOOKING' },
      });
      const notFound = await refund(ctx, provider(randomUUID(), a.collectionId)).expect(404);
      expect(notFound.body.error.code).toBe('BOOKING_NOT_FOUND');
      const both = await refund(
        ctx,
        provider(a.bookingId, a.collectionId, { sourcePaymentId: randomUUID() }),
      ).expect(422);
      expect(both.body.error.details).toMatchObject({ reason: 'ONE_SOURCE' });
      const none = await refund(ctx, {
        bookingId: a.bookingId,
        kind: 'PROVIDER',
        reason: REASON,
      }).expect(422);
      expect(none.body.error.details).toMatchObject({ reason: 'ONE_SOURCE' });
      const payment = await refund(ctx, {
        bookingId: a.bookingId,
        sourcePaymentId: randomUUID(),
        kind: 'PROVIDER',
        reason: REASON,
      }).expect(422);
      expect(payment.body.error.details).toMatchObject({ reason: 'NOT_THIS_BOOKING' });
      // The whole booking's collection has no drop.
      const stop = await refund(
        ctx,
        provider(a.bookingId, a.collectionId, { stopSequence: 1 }),
      ).expect(422);
      expect(stop.body.error.details).toMatchObject({ reason: 'STOP_MISMATCH' });
      expect(await refundsOf(ctx, a.bookingId)).toEqual([]);
      expect(await refundsOf(ctx, b.bookingId)).toEqual([]);
    });

    it('a drop refund names its own drop; a closed QR that never completed is not refundable', async () => {
      const trip = await deliveryUnderWay([20_000, 30_000]);
      const first = await drop(trip, 1, 20_000, 'QR');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      const second = await drop(trip, 2, 30_000, 'QR', false);
      await cancelBooking(ctx, trip.bookingId);
      // The open QR was closed with the booking: nothing was collected on it.
      expect((await collectionRow(ctx, second.collectionId)).status).toBe('FAILED');
      const open = await refund(ctx, provider(trip.bookingId, second.collectionId)).expect(409);
      expect(open.body.error.details).toMatchObject({ reason: 'SOURCE_NOT_COMPLETED' });
      const wrongDrop = await refund(
        ctx,
        provider(trip.bookingId, first.collectionId, { stopSequence: 2 }),
      ).expect(422);
      expect(wrongDrop.body.error.details).toMatchObject({ reason: 'STOP_MISMATCH' });
      const res = await refund(
        ctx,
        provider(trip.bookingId, first.collectionId, { stopSequence: 1 }),
      ).expect(201);
      expect(res.body.refund).toMatchObject({
        stopSequence: 1,
        amountPaise: 20_000,
        refundCase: 'CANCELLED_AFTER_HANDOVER',
      });
      const row = await refundRow(ctx, res.body.refund.refundId as string);
      const stop = await ctx.prisma.bookingStop.findFirstOrThrow({
        where: { bookingId: trip.bookingId, sequence: 1 },
      });
      expect(row.bookingStopId).toBe(stop.id);
    });
  });

  describe('earnings', () => {
    it('holds an earning not paid out yet; a failed refund releases nothing on its own', async () => {
      const driver = await driverWithBank();
      const trip = await completedPickup('QR', driver);
      expect((await earningOf(ctx, trip.bookingId)).status).toBe('AWAITING_SETTLEMENT');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      expect(res.body.refund.refundCase).toBe('COMPLETED_BOOKING');
      const held = await earningOf(ctx, trip.bookingId);
      expect(held.status).toBe('ON_HOLD');
      expect(held.holdReason).toMatch(
        new RegExp(`^REFUND: refund ${refundId} requested \\(COMPLETED_BOOKING\\)`),
      );
      // Settled meanwhile: still held, and no payout carries it.
      await settleAndSync(ctx, trip.providerPaymentId ?? '', 50_000);
      expect((await earningOf(ctx, trip.bookingId)).status).toBe('ON_HOLD');
      const batch = await prepareBatch().expect(201);
      expect(await payoutOf(driver.driverId, batch.body.batch.batchId as string)).toBeNull();

      const failed = ctx.refunds.setStatus(res.body.refund.providerRefundId as string, 'failed');
      await sendWebhook(ctx, buildRefundWebhook('refund.failed', failed)).expect(200);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PAID');
      expect(await earningOf(ctx, trip.bookingId)).toMatchObject({
        status: 'ON_HOLD',
        holdReason: held.holdReason,
      });
    });

    it('refuses a refund while the earning is in a payout being executed; once paid out, refunds without clawback (L-21)', async () => {
      const driver = await driverWithBank();
      const trip = await completedPickup('QR', driver);
      await settleAndSync(ctx, trip.providerPaymentId ?? '', 50_000);
      expect((await earningOf(ctx, trip.bookingId)).status).toBe('PAYABLE');
      const batch = await prepareBatch().expect(201);
      const batchId = batch.body.batch.batchId as string;
      const payout = await payoutOf(driver.driverId, batchId);
      expect(payout).not.toBeNull();
      expect((await earningOf(ctx, trip.bookingId)).status).toBe('IN_PAYOUT');

      const creates = ctx.refunds.calls.createRefund;
      const inPayout = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(409);
      expect(inPayout.body.error.code).toBe('REFUND_EARNING_IN_PAYOUT');
      expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PAID');
      expect(ctx.refunds.calls.createRefund).toBe(creates);

      await request(ctx.server)
        .post(`/v1/admin/payout-batches/${batchId}/execute`)
        .set(bearer(nextAdmin().token))
        .send()
        .expect(200);
      const atProvider = ctx.payouts.byReference(payout?.id ?? '');
      const processed = ctx.payouts.setStatus(atProvider?.id ?? '', 'processed');
      await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);
      const paid = await earningOf(ctx, trip.bookingId);
      expect(paid.status).toBe('PAID');
      const ledger = await ctx.prisma.driverWalletTransaction.count({
        where: { wallet: { driverId: driver.driverId } },
      });

      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      expect(res.body.refund.status).toBe('PROCESSING');
      // Nothing is clawed back: the earning and the payout keep their state, no wallet entry.
      expect(await earningOf(ctx, trip.bookingId)).toEqual(paid);
      expect(
        (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout?.id ?? '' } }))
          .status,
      ).toBe('PROCESSED');
      expect(
        await ctx.prisma.driverWalletTransaction.count({
          where: { wallet: { driverId: driver.driverId } },
        }),
      ).toBe(ledger);
      expect(
        (await report(ctx, 'refund-anomalies')).filter(
          (finding) => finding.bookingId === trip.bookingId,
        ),
      ).toMatchObject([
        { problem: 'REFUND_AFTER_PAYOUT', earningId: paid.id, payoutId: payout?.id },
      ]);
    });

    it('a refund and a payout batch racing for one earning never both win', async () => {
      const driver = await driverWithBank();
      const trip = await completedPickup('QR', driver);
      await settleAndSync(ctx, trip.providerPaymentId ?? '', 50_000);
      const [refunded, batch] = await Promise.all([
        refund(ctx, provider(trip.bookingId, trip.collectionId)),
        prepareBatch(),
      ]);
      expect(batch.status).toBe(201);
      const earning = await earningOf(ctx, trip.bookingId);
      const items = await ctx.prisma.payoutItem.findMany({
        where: { earningId: earning.id, status: { in: ['INCLUDED', 'PAID'] } },
      });
      if (refunded.status === 201) {
        expect(earning.status).toBe('ON_HOLD');
        expect(items).toHaveLength(0);
      } else {
        expect(refunded.status).toBe(409);
        expect(refunded.body.error.code).toBe('REFUND_EARNING_IN_PAYOUT');
        expect(earning.status).toBe('IN_PAYOUT');
        expect(items).toHaveLength(1);
        expect(await refundsOf(ctx, trip.bookingId)).toEqual([]);
      }
    });
  });

  describe('concurrency', () => {
    it('concurrent requests for one source make exactly one refund, sent once', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const racers = await Promise.all(Array.from({ length: 5 }, () => createAdmin(ctx)));
      const responses = await Promise.all(
        racers.map((as) => refund(ctx, provider(trip.bookingId, trip.collectionId), { as })),
      );
      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      for (const res of responses.filter((candidate) => candidate.status === 409)) {
        expect(res.body.error.code).toBe('REFUND_IN_PROGRESS');
      }
      expect(await refundsOf(ctx, trip.bookingId)).toHaveLength(1);
      expect(await providerRefundsFor(ctx, trip.providerPaymentId)).toBe(1);
    });

    it('concurrent retries with one Idempotency-Key make one refund and return it to each', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const as = await createAdmin(ctx);
      const key = idempotencyKey();
      const creates = ctx.refunds.calls.createRefund;
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          refund(ctx, provider(trip.bookingId, trip.collectionId), { key, as }),
        ),
      );
      expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 200, 201]);
      const ids = new Set(responses.map((res) => res.body.refund.refundId as string));
      expect(ids.size).toBe(1);
      expect(await refundsOf(ctx, trip.bookingId)).toHaveLength(1);
      expect(ctx.refunds.calls.createRefund).toBe(creates + 1);
      // The same key for another refund is refused; another admin's key is their own.
      const reused = await refund(
        ctx,
        provider(trip.bookingId, trip.collectionId, { amountPaise: 123 }),
        { key, as },
      ).expect(409);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherAdmin = await refund(ctx, provider(trip.bookingId, trip.collectionId), {
        key,
        as: await createAdmin(ctx),
      }).expect(409);
      expect(otherAdmin.body.error.code).toBe('REFUND_IN_PROGRESS');
    });

    it('a refund and late money for another drop of the booking end in one consistent status', async () => {
      const trip = await deliveryUnderWay([20_000, 30_000]);
      const first = await drop(trip, 1, 20_000, 'QR');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      const second = await drop(trip, 2, 30_000, 'QR', false);
      // Razorpay can't be reached when the booking is cancelled: drop 2's QR stays open.
      ctx.links.unavailable = true;
      try {
        await cancelBooking(ctx, trip.bookingId);
      } finally {
        ctx.links.unavailable = false;
      }
      expect((await collectionRow(ctx, second.collectionId)).status).toBe('PENDING');
      ctx.links.pay(ctx.links.byCollection(second.collectionId).referenceId);

      const [refunded, synced] = await Promise.all([
        refund(ctx, provider(trip.bookingId, first.collectionId)),
        request(ctx.server)
          .post(`/v1/admin/collections/${second.collectionId}/sync`)
          .set(bearer(admin.token))
          .send(),
      ]);
      expect(refunded.status).toBe(201);
      expect(synced.status).toBe(200);
      expect(synced.body.outcome).toBe('PAID_AFTER_CANCELLATION');
      const booking = await bookingRow(ctx, trip.bookingId);
      expect(booking.paymentStatus).toBe('REFUND_PENDING');
      expect(await moneyStatus(ctx, trip.bookingId)).toBe('REFUND_PENDING');

      // Drop 1 refunded, drop 2 still collected: partly refunded; then drop 2 too.
      const one = ctx.refunds.setStatus(
        refunded.body.refund.providerRefundId as string,
        'processed',
      );
      await sendWebhook(ctx, buildRefundWebhook('refund.processed', one)).expect(200);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('PARTIALLY_REFUNDED');
      const two = await refund(ctx, provider(trip.bookingId, second.collectionId)).expect(201);
      expect(two.body.refund).toMatchObject({ stopSequence: 2, amountPaise: 30_000 });
      const twoDone = ctx.refunds.setStatus(
        two.body.refund.providerRefundId as string,
        'processed',
      );
      await sendWebhook(ctx, buildRefundWebhook('refund.processed', twoDone)).expect(200);
      expect((await bookingRow(ctx, trip.bookingId)).paymentStatus).toBe('REFUNDED');
      expect(await moneyStatus(ctx, trip.bookingId)).toBe('REFUNDED');
    });
  });

  describe('historical bookings', () => {
    it('refunds a historical prepaid payment without changing the payment row', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const { bookingId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 40_000,
        category,
      });
      const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
      const orderId = started.body.checkout.orderId as string;
      const paymentId = started.body.paymentId as string;
      const paid = ctx.razorpay.pay(orderId);
      await verifyBookingPayment(ctx, customer, bookingId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: paid.id,
        razorpaySignature: checkoutSignature(orderId, paid.id),
      }).expect(200);
      await cancelBooking(ctx, bookingId);
      const before = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      const cash = await refund(ctx, {
        bookingId,
        sourcePaymentId: paymentId,
        kind: 'CASH_RETURNED',
        feeTreatment: 'KEPT',
        reason: REASON,
      }).expect(422);
      expect(cash.body.error.details).toMatchObject({ reason: 'NOT_CASH' });
      const res = await refund(ctx, {
        bookingId,
        sourcePaymentId: paymentId,
        kind: 'PROVIDER',
        reason: REASON,
      }).expect(201);
      expect(res.body.refund).toMatchObject({
        sourcePaymentId: paymentId,
        sourceCollectionId: null,
        providerPaymentId: paid.id,
        amountPaise: 40_000,
        refundCase: 'CANCELLED_BEFORE_HANDOVER',
        status: 'PROCESSING',
      });
      expect(ctx.refunds.forRefund(res.body.refund.refundId as string)?.notes).toMatchObject({
        payment_id: paymentId,
      });
      const processed = ctx.refunds.setStatus(
        res.body.refund.providerRefundId as string,
        'processed',
      );
      const { webhook, sent } = deliverRefund(ctx, 'refund.processed', processed);
      await sent;
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'REFUND_APPLIED', paymentId });
      expect((await bookingRow(ctx, bookingId)).paymentStatus).toBe('REFUNDED');
      // The historical payment row is not rewritten: still PAID, same amount, same timestamps.
      expect(await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toEqual(
        before,
      );
    });

    it('returns the cash of a historical whole-booking delivery collection', async () => {
      const driver = await createDriver(ctx);
      await fundWallet(ctx, nextAdmin(), driver.driverId, 100_000);
      const { bookingId, tripId } = await bookedTrip(ctx, await createCustomer(ctx), driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        category,
        model: 'LEGACY_BOOKING_LEVEL',
      });
      await advanceTrip(ctx, tripId, TO_DELIVERED);
      const collected = await collect(ctx, driver, tripId, {
        method: 'CASH',
        amountPaise: 50_000,
      }).expect(201);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      const earning = await earningOf(ctx, bookingId);
      const res = await refund(
        ctx,
        cashReturn(bookingId, collected.body.collectionId as string, 'KEPT'),
      ).expect(201);
      expect(res.body.refund).toMatchObject({
        status: 'COMPLETED',
        refundCase: 'COMPLETED_BOOKING',
        amountPaise: 50_000,
      });
      expect((await bookingRow(ctx, bookingId)).paymentStatus).toBe('REFUNDED');
      expect(await earningOf(ctx, bookingId)).toEqual(earning);
    });
  });

  describe('reconciliation', () => {
    it('reports a stale pending refund; a sync recovers it', async () => {
      const trip = await cancelledBeforeHandover('QR');
      ctx.refunds.unavailable = true;
      let refundId: string;
      try {
        const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
        refundId = res.body.refund.refundId as string;
      } finally {
        ctx.refunds.unavailable = false;
      }
      // Make it look 45 minutes old (created_at is immutable, so only with the guard off).
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_guard`;
        await tx.$executeRaw`
          UPDATE payment_refunds
             SET created_at = now() - interval '45 minutes',
                 last_submitted_at = now() - interval '45 minutes'
           WHERE id = ${refundId}::uuid`;
        await tx.$executeRaw`ALTER TABLE payment_refunds ENABLE TRIGGER trg_refunds_guard`;
      });
      expect(
        (await report(ctx, 'refund-anomalies')).filter((finding) =>
          finding.detail?.includes(refundId),
        ),
      ).toMatchObject([{ problem: 'STALE_PENDING_REFUND', bookingId: trip.bookingId }]);
      await syncRefund(ctx, refundId).expect(200);
      expect((await refundRow(ctx, refundId)).status).toBe('PROCESSING');
      expect(
        (await report(ctx, 'refund-anomalies')).filter((finding) =>
          finding.detail?.includes(refundId),
        ),
      ).toEqual([]);
      // Integrity reports stay empty for what this suite recorded.
      const integrity = (await report(ctx, 'refund-anomalies')).filter((finding) =>
        [
          'REFUNDED_TOTAL_MISMATCH',
          'REFUNDS_EXCEED_SOURCE',
          'BOOKING_REFUND_STATUS_MISMATCH',
          'FEE_CREDIT_MISMATCH',
        ].includes(finding.problem),
      );
      expect(integrity).toEqual([]);
    });
  });

  describe('authorization', () => {
    it('only admins reach the refund API, and nobody completes a refund by hand', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const refundId = res.body.refund.refundId as string;
      for (const token of [trip.driver.token, trip.customer.token]) {
        await request(ctx.server)
          .post('/v1/admin/refunds')
          .set(bearer(token))
          .set('Idempotency-Key', idempotencyKey())
          .send(provider(trip.bookingId, trip.collectionId))
          .expect(403);
        await request(ctx.server).get('/v1/admin/refunds').set(bearer(token)).expect(403);
        await request(ctx.server)
          .get(`/v1/admin/refunds/${refundId}`)
          .set(bearer(token))
          .expect(403);
        await request(ctx.server)
          .post(`/v1/admin/refunds/${refundId}/sync`)
          .set(bearer(token))
          .send()
          .expect(403);
        await request(ctx.server)
          .post(`/v1/admin/refunds/${refundId}/cancel`)
          .set(bearer(token))
          .send({ reason: 'Not mine to cancel at all' })
          .expect(403);
      }
      await request(ctx.server)
        .post('/v1/admin/refunds')
        .set('Idempotency-Key', idempotencyKey())
        .send(provider(trip.bookingId, trip.collectionId))
        .expect(401);
      await request(ctx.server).get(`/v1/admin/refunds/${refundId}`).expect(401);
      // No route sets a status; the simulator is not mounted outside simulated runs.
      await request(ctx.server)
        .patch(`/v1/admin/refunds/${refundId}`)
        .set(bearer(admin.token))
        .send({ status: 'COMPLETED' })
        .expect(404);
      await request(ctx.server)
        .post(`/v1/dev/simulate/refunds/${res.body.refund.providerRefundId as string}`)
        .set(bearer(admin.token))
        .send({ status: 'processed' })
        .expect(404);
      // An Idempotency-Key is required.
      const keyless = await request(ctx.server)
        .post('/v1/admin/refunds')
        .set(bearer(admin.token))
        .send(provider(trip.bookingId, trip.collectionId))
        .expect(400);
      expect(keyless.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect((await refundRow(ctx, refundId)).status).toBe('PROCESSING');
      expect(await refundsOf(ctx, trip.bookingId)).toHaveLength(1);
    });
  });

  describe('database guards (even for the table owner)', () => {
    const base = (trip: PaidTrip) => ({
      bookingId: trip.bookingId,
      sourceCollectionId: trip.collectionId,
      kind: 'PROVIDER',
      status: 'PENDING',
      refundCase: 'CANCELLED_BEFORE_HANDOVER',
      amountPaise: 50_000n,
      reason: 'Owner bypass attempt',
      requestedByUserId: admin.userId,
      idempotencyKey: `owner:${randomUUID()}`,
      provider: 'RAZORPAY',
      providerPaymentId: trip.providerPaymentId,
    });

    it('refuses refunds that break ownership, amounts or the lifecycle when they are written', async () => {
      const a = await cancelledBeforeHandover('QR');
      const b = await cancelledBeforeHandover('QR');
      const live = await paidAtPickup(ctx, 'QR');
      const cash = await cancelledBeforeHandover('CASH');
      // Raw SQL, so the database's own message comes back (Prisma's model API reports a
      // restrict_violation as a foreign key error).
      const create = (data: Record<string, unknown>) => (tx: Prisma.TransactionClient) => {
        const value = (key: string): unknown => data[key] ?? null;
        return tx.$executeRaw`
          INSERT INTO payment_refunds (booking_id, source_collection_id, kind, status, refund_case,
                                       amount_paise, reason, requested_by_user_id, idempotency_key,
                                       provider, provider_payment_id, provider_refund_id,
                                       fee_treatment, fee_credit_paise, completed_at)
          VALUES (${value('bookingId')}::uuid, ${value('sourceCollectionId')}::uuid,
                  ${value('kind')}, ${value('status')}, ${value('refundCase')},
                  ${value('amountPaise')}, ${value('reason')}, ${value('requestedByUserId')}::uuid,
                  ${value('idempotencyKey')}, ${value('provider')}, ${value('providerPaymentId')},
                  ${value('providerRefundId')}, ${value('feeTreatment')},
                  ${value('feeCreditPaise')}, ${value('completedAt')})`;
      };

      await refused(
        /Only an active admin requests a refund/,
        create({ ...base(a), requestedByUserId: a.driver.userId }),
      );
      await refused(/only for a cancelled or completed booking/, create(base(live)));
      await refused(
        /names a collection of its own booking and drop/,
        create({ ...base(a), sourceCollectionId: b.collectionId }),
      );
      await refused(
        /refunds the collection's own online payment/,
        create({ ...base(a), providerPaymentId: b.providerPaymentId }),
      );
      await refused(
        /never exceed what was collected/,
        create({ ...base(a), amountPaise: 50_001n }),
      );
      await refused(
        /A provider refund starts PENDING/,
        create({ ...base(a), status: 'COMPLETED', completedAt: new Date() }),
      );
      await refused(
        /recorded before it is sent to the provider/,
        create({ ...base(a), providerRefundId: 'rfnd_OwnerBypass001' }),
      );
      await refused(
        /Only money collected in cash is returned in cash/,
        create({
          ...base(a),
          kind: 'CASH_RETURNED',
          status: 'COMPLETED',
          completedAt: new Date(),
          provider: null,
          providerPaymentId: null,
          feeTreatment: 'KEPT',
        }),
      );
      await refused(
        /refunds_kind_shape|check constraint/i,
        create({ ...base(a), feeTreatment: 'KEPT' }),
      );
      // A fee credit names its REFUND_REVERSAL ledger credit.
      await refused(
        /REFUND_REVERSAL credit of exactly the collection's fee/,
        create({
          ...base(cash),
          kind: 'CASH_RETURNED',
          status: 'COMPLETED',
          completedAt: new Date(),
          provider: null,
          providerPaymentId: null,
          feeTreatment: 'CREDITED_TO_WALLET',
          feeCreditPaise: 5_000n,
        }),
      );
      // Two live refunds of one source, even within the amount: the partial unique index.
      await refused(/Unique constraint|uq_refunds_collection_live/, async (tx) => {
        await create({ ...base(a), amountPaise: 10_000n })(tx);
        await create({ ...base(a), amountPaise: 10_000n })(tx);
      });
      // A valid row passes the insert guard (then is rolled back).
      await rolledBack((tx) => create(base(a))(tx));
      expect(await refundsOf(ctx, a.bookingId)).toEqual([]);
    });

    it('keeps the source, amount and decisions immutable and the status forward-only', async () => {
      const trip = await cancelledBeforeHandover('QR');
      const other = await cancelledBeforeHandover('QR');
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const id = res.body.refund.refundId as string;
      const immutable = /source, amount, reason and decisions are immutable/;
      await refused(
        immutable,
        (tx) => tx.$executeRaw`UPDATE payment_refunds SET amount_paise = 1 WHERE id = ${id}::uuid`,
      );
      await refused(
        immutable,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET source_collection_id = ${other.collectionId}::uuid WHERE id = ${id}::uuid`,
      );
      await refused(
        immutable,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET reason = 'Rewritten afterwards' WHERE id = ${id}::uuid`,
      );
      await refused(
        immutable,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET requested_by_user_id = ${trip.driver.userId}::uuid WHERE id = ${id}::uuid`,
      );
      await refused(
        immutable,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET provider_refund_id = 'rfnd_Rewritten00001' WHERE id = ${id}::uuid`,
      );
      await refused(
        /Invalid refund transition PROCESSING -> PENDING/,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET status = 'PENDING' WHERE id = ${id}::uuid`,
      );
      await refused(
        /Only a pending provider refund is sent to the provider/,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET submit_attempts = submit_attempts + 1 WHERE id = ${id}::uuid`,
      );
      await refused(
        /permanent financial records and cannot be deleted/,
        (tx) => tx.$executeRaw`DELETE FROM payment_refunds WHERE id = ${id}::uuid`,
      );
      await refused(
        /permanent financial records and cannot be deleted/,
        (tx) => tx.$executeRaw`TRUNCATE payment_refunds`,
      );
      // Completed is final.
      const processed = ctx.refunds.setStatus(
        res.body.refund.providerRefundId as string,
        'processed',
      );
      await sendWebhook(ctx, buildRefundWebhook('refund.processed', processed)).expect(200);
      await refused(
        /Invalid refund transition COMPLETED -> FAILED/,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET status = 'FAILED', failed_at = now(), failure_reason = 'x' WHERE id = ${id}::uuid`,
      );
      // A provider refund id belongs to one refund.
      const second = await cancelledBeforeHandover('QR');
      const res2 = await refund(ctx, provider(second.bookingId, second.collectionId)).expect(201);
      const id2 = res2.body.refund.refundId as string;
      await refused(
        /immutable|Unique constraint|uq_refunds_provider_refund/,
        (tx) =>
          tx.$executeRaw`UPDATE payment_refunds SET provider_refund_id = ${processed.id} WHERE id = ${id2}::uuid`,
      );
      // Only an active admin cancels one.
      const pending = await cancelledBeforeHandover('QR');
      ctx.refunds.unavailable = true;
      let pendingId: string;
      try {
        const created = await refund(ctx, provider(pending.bookingId, pending.collectionId)).expect(
          201,
        );
        pendingId = created.body.refund.refundId as string;
      } finally {
        ctx.refunds.unavailable = false;
      }
      await refused(
        /Only an active admin cancels a refund/,
        (tx) =>
          tx.$executeRaw`
          UPDATE payment_refunds
             SET status = 'CANCELLED', cancelled_at = now(),
                 cancelled_by_user_id = ${pending.driver.userId}::uuid,
                 cancellation_reason = 'Owner bypass attempt'
           WHERE id = ${pendingId}::uuid`,
      );
    });

    it('keeps refunded_paise, the booking status and fee credits equal to what the refunds say', async () => {
      const trip = await cancelledBeforeHandover('QR');
      await refused(
        /refunded amount is the sum of its completed refunds/,
        (tx) =>
          tx.$executeRaw`UPDATE payment_collections SET refunded_paise = 50000 WHERE id = ${trip.collectionId}::uuid`,
      );
      await refused(
        /collections and refunds: they say PAID/,
        (tx) =>
          tx.$executeRaw`UPDATE bookings SET payment_status = 'REFUNDED' WHERE id = ${trip.bookingId}::uuid`,
      );
      const res = await refund(ctx, provider(trip.bookingId, trip.collectionId)).expect(201);
      const id = res.body.refund.refundId as string;
      // Completing the refund without its booking effect is refused at commit.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE payment_refunds
               SET status = 'COMPLETED', completed_at = now(), provider_status = 'processed'
             WHERE id = ${id}::uuid`;
        }),
      ).rejects.toThrow(/payment status changes with the refund/);
      expect(await refundRow(ctx, id)).toMatchObject({ status: 'PROCESSING' });
      expect((await collectionRow(ctx, trip.collectionId)).refundedPaise).toBe(0n);

      // A platform-fee credit exists only with the cash return that decided it, for its exact fee.
      const cash = await cancelledBeforeHandover('CASH');
      const ledger = ctx.app.get(WalletLedgerService);
      const wallet = await ctx.prisma.driverWallet.findUniqueOrThrow({
        where: { driverId: cash.driver.driverId },
      });
      const credit = (refundId: string, amountPaise: bigint, referenceType = 'REFUND') => ({
        walletId: wallet.id,
        type: 'REFUND_REVERSAL' as const,
        direction: 'CREDIT' as const,
        amountPaise,
        referenceType,
        referenceId: refundId,
        idempotencyKey: `owner-bypass:${randomUUID()}`,
        performedByUserId: admin.userId,
        reason: 'Owner bypass attempt',
      });
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await ledger.postEntry(tx, credit(randomUUID(), 5_000n));
        }),
      ).rejects.toThrow(/written only with the cash return that decided it/);
      await refused(/wallet_tx_refund_reversal_shape|check constraint/i, (tx) =>
        ledger.postEntry(tx, credit(randomUUID(), 5_000n, 'BOOKING')),
      );
      const refundId = randomUUID();
      await refused(/exactly the collection's fee, for this cash return/, async (tx) => {
        const { entry } = await ledger.postEntry(tx, credit(refundId, 1n));
        await tx.paymentRefund.create({
          data: {
            ...base(cash),
            id: refundId,
            kind: 'CASH_RETURNED',
            status: 'COMPLETED',
            completedAt: new Date(),
            provider: null,
            providerPaymentId: null,
            feeTreatment: 'CREDITED_TO_WALLET',
            feeCreditPaise: 5_000n,
            walletTransactionId: entry.id,
          },
        });
      });
      expect(await walletBalance(ctx, cash.driver.driverId)).toBe(wallet.balancePaise);
    });
  });
});
