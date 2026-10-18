import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type {
  Prisma,
  ReconciliationFinding,
  ReconciliationRun,
} from '../../src/generated/prisma/client';
import { hmacSha256Hex } from '../../src/razorpay/razorpay-signatures';
import { critical, detected, FINDING_CATEGORIES } from '../../src/reconciliation/finding-types';
import { ReconciliationFindingsService } from '../../src/reconciliation/reconciliation-findings.service';
import {
  type ReconciliationJob,
  ReconciliationRunsService,
} from '../../src/reconciliation/reconciliation-runs.service';
import { MerchantSettlementsService } from '../../src/settlements/merchant-settlements.service';
import { newId } from '../helpers/fake-razorpay.gateway';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  createVerifiedBankAccount,
  idempotencyKey,
  type TestAdmin,
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
  sendPayoutWebhook,
  setTripStatus,
  settleAndSync,
  startBookingPayment,
  TO_DELIVERED,
} from '../helpers/flows';
import { sendWebhook, startTopUp, walletBalance } from '../helpers/http';
import {
  buildDisputeWebhook,
  buildPaymentLinkWebhook,
  buildPayoutWebhook,
  buildWebhook,
  type SignedWebhook,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_WEBHOOK_SECRET } from '../helpers/test-config';

interface QrTrip {
  readonly driver: TestDriver;
  readonly bookingId: string;
  readonly tripId: string;
  readonly collectionId: string;
  readonly referenceId: string;
  readonly orderId: string | null;
}

/**
 * Reconciliation and collection recovery (payment flow Phase 7). Runs compare our records with
 * each other and (read-only) with Razorpay and RazorpayX, and record every mismatch as a finding
 * for an admin; nothing is fixed silently. The only job that writes is the collection recovery,
 * through the same finalizer as the webhook, so a payment is applied once whoever gets there
 * first. The database checks run over the whole (shared) test database; provider reads and
 * recovery are scoped to this suite's records with `since`.
 */
describe('Reconciliation and collection recovery (payment flow Phase 7)', () => {
  let ctx: TestContext;
  /** The same backend with provider checks off: full (unscoped) runs, which may clear findings. */
  let quiet: TestContext;
  let admin: TestAdmin;
  let admins: TestAdmin[] = [];
  let calls = 0;
  let category: string;
  /** This suite's start, on the database clock. */
  let since: Date;
  const runIds = new Set<string>();
  // Shared with the API and guard tests below.
  let walletDriver: TestDriver | undefined;
  let resolvedFinding: ReconciliationFinding | undefined;
  let reopenedFinding: ReconciliationFinding | undefined;

  beforeAll(async () => {
    ctx = await createTestApp();
    quiet = await createTestApp({ configOverrides: { RECONCILIATION_PROVIDER_CHECKS: 'false' } });
    admin = await createAdmin(ctx);
    admins = await Promise.all(Array.from({ length: 8 }, () => createAdmin(ctx)));
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
    const [row] = await ctx.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    since = row?.now ?? new Date();
  });

  afterAll(async () => {
    await quiet.close();
    await ctx.close();
  });

  // Runs (5/min), refunds (10/min) and payout batches (5/min) are rate limited per admin.
  function nextAdmin(): TestAdmin {
    const actor = admins[Math.floor(calls / 3) % admins.length];
    calls += 1;
    if (!actor) {
      throw new Error('admin pool is empty');
    }
    return actor;
  }

  async function run(
    job: ReconciliationJob,
    options: { app?: TestContext; scoped?: boolean } = {},
  ): Promise<ReconciliationRun> {
    const app = options.app ?? ctx;
    const result = await app.app
      .get(ReconciliationRunsService)
      .runNow(job, { trigger: 'SCHEDULE', since: options.scoped === false ? null : since });
    if (!result) {
      throw new Error(`a ${job} run is already in progress`);
    }
    runIds.add(result.id);
    expect({ status: result.status, error: result.error }).toEqual({
      status: 'COMPLETED',
      error: null,
    });
    return result;
  }
  const reconcile = () => run('RECONCILIATION');
  const recover = () => run('COLLECTION_RECOVERY');
  /** No `since`: complete state checks clear what they no longer see. */
  const fullReconcile = () => run('RECONCILIATION', { app: quiet, scoped: false });

  const findingsOf = (where: Prisma.ReconciliationFindingWhereInput) =>
    ctx.prisma.reconciliationFinding.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  async function one(where: Prisma.ReconciliationFindingWhereInput) {
    const rows = await findingsOf(where);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) {
      throw new Error(`no finding for ${JSON.stringify(where)}`);
    }
    return row;
  }
  const findingRow = (id: string) =>
    ctx.prisma.reconciliationFinding.findUniqueOrThrow({ where: { id } });
  const collectionRow = (id: string) =>
    ctx.prisma.paymentCollection.findUniqueOrThrow({ where: { id } });
  const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const transitionsOf = (collectionId: string) =>
    ctx.prisma.financialEvent.findMany({
      where: { entityType: 'PAYMENT_COLLECTION', entityId: collectionId, action: 'STATUS_CHANGED' },
      orderBy: { id: 'asc' },
    });
  const summaryOf = (run: ReconciliationRun) => run.summary as Record<string, unknown>;
  const startRun = (as: TestAdmin, body: Record<string, unknown>) =>
    request(ctx.server).post('/v1/admin/reconciliation/runs').set(bearer(as.token)).send(body);
  async function waitForRun(runId: string): Promise<ReconciliationRun> {
    runIds.add(runId);
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const row = await ctx.prisma.reconciliationRun.findUniqueOrThrow({ where: { id: runId } });
      if (row.status !== 'RUNNING') {
        return row;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`run ${runId} did not finish`);
  }

  /** A PAY_AT_PICKUP booking at the pickup with a payment link shown for the whole fare. */
  async function qrAtPickup(): Promise<QrTrip> {
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model: 'QUOTE_PER_STOP',
      dropPaise: [20_000, 30_000],
    });
    await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    const shown = await collect(ctx, driver, trip.tripId, {
      method: 'ONLINE_QR',
      amountPaise: 50_000,
    }).expect(201);
    const collectionId = shown.body.collectionId as string;
    const link = ctx.links.byCollection(collectionId);
    return { driver, ...trip, collectionId, referenceId: link.referenceId, orderId: link.orderId };
  }
  const linkPaid = (trip: QrTrip, payment: ReturnType<TestContext['links']['pay']>) =>
    buildPaymentLinkWebhook(
      'payment_link.paid',
      {
        referenceId: trip.referenceId,
        amount: 50_000,
        collectionId: trip.collectionId,
        orderId: trip.orderId,
      },
      payment,
    );
  /** The driver's app polling the collection (a refresh from Razorpay). */
  const poll = (trip: QrTrip) =>
    request(ctx.server)
      .get(`/v1/trips/${trip.tripId}/collections/${trip.collectionId}`)
      .set(bearer(trip.driver.token));
  /** A signed Razorpay webhook with an arbitrary payload. */
  function signed(event: string, payload: Record<string, unknown>): SignedWebhook {
    const body = JSON.stringify({
      entity: 'event',
      account_id: 'acc_TestAccount01',
      event,
      contains: Object.keys(payload),
      payload,
      created_at: Math.floor(Date.now() / 1000),
    });
    return {
      body,
      signature: hmacSha256Hex(TEST_WEBHOOK_SECRET, body),
      eventId: `evt_${randomUUID().replace(/-/g, '')}`,
    };
  }

  it('reports money Razorpay captured that we still hold as pending, and applies nothing', async () => {
    const driver = await createDriver(ctx);
    const { paymentId, orderId } = await startTopUp(ctx, driver, 25_000);
    // The driver paid at Razorpay; neither the webhook nor the app's verification arrived.
    const captured = ctx.razorpay.pay(orderId);
    const first = await reconcile();

    const finding = await one({ kind: 'PROVIDER_PAID_PAYMENT_PENDING', entityId: paymentId });
    expect(finding).toMatchObject({
      category: 'PROVIDER_PAID_INTERNAL_PENDING',
      severity: 'CRITICAL',
      source: 'PROVIDER',
      status: 'OPEN',
      entityType: 'PAYMENT',
      driverId: driver.driverId,
      providerRef: captured.id,
      internalState: 'PENDING',
      providerState: 'captured',
      internalAmountPaise: 25_000n,
      providerAmountPaise: 25_000n,
      occurrences: 1,
      firstRunId: first.id,
      lastRunId: first.id,
      clearedAt: null,
    });
    expect(finding.detail).toContain(`/v1/admin/payments/${paymentId}/sync`);
    await one({ kind: 'STALE_PENDING_PAYMENT', entityId: paymentId, severity: 'INFO' });
    // Reported, not applied.
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PENDING',
    );
    expect(await walletBalance(ctx, driver.driverId)).toBe(0n);

    // The admin applies it with the payment sync (the webhook's finalizer) ...
    await request(ctx.server)
      .post(`/v1/admin/payments/${paymentId}/sync`)
      .set(bearer(nextAdmin().token))
      .expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(25_000n);
    // ... and the next run no longer sees it; the finding waits for the admin's note.
    await reconcile();
    expect(await findingRow(finding.id)).toMatchObject({
      status: 'OPEN',
      occurrences: 1,
      lastRunId: first.id,
    });
  });

  it('recovers a payment link paid while its webhook was missed, once, and records it', async () => {
    const trip = await qrAtPickup();
    const payment = ctx.links.pay(trip.referenceId);
    const recovery = await recover();

    expect(await collectionRow(trip.collectionId)).toMatchObject({
      status: 'COMPLETED',
      providerPaymentId: payment.id,
    });
    expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('PAID');
    const finding = await one({ kind: 'COLLECTION_RECOVERED', entityId: trip.collectionId });
    expect(finding).toMatchObject({
      category: 'PROVIDER_PAID_INTERNAL_PENDING',
      severity: 'INFO',
      source: 'RECOVERY',
      bookingId: trip.bookingId,
      driverId: trip.driver.driverId,
      providerRef: payment.id,
      internalState: 'COMPLETED',
      firstRunId: recovery.id,
    });
    expect(summaryOf(recovery).recovered).toBeGreaterThanOrEqual(1);
    // In the event log as the job, under its run id.
    expect(await transitionsOf(trip.collectionId)).toEqual([
      expect.objectContaining({
        statusFrom: 'PENDING',
        statusTo: 'COMPLETED',
        actorType: 'SYSTEM',
        requestId: recovery.id,
        origin: 'job COLLECTION_RECOVERY',
      }),
    ]);

    // A second run has nothing left to do for it.
    await recover();
    expect(await transitionsOf(trip.collectionId)).toHaveLength(1);
    expect((await findingRow(finding.id)).occurrences).toBe(1);
    // The webhook arriving late changes nothing.
    const late = linkPaid(trip, payment);
    await sendWebhook(ctx, late).expect(200);
    expect(
      (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: late.eventId } }))
        .outcome,
    ).toBe('ALREADY_APPLIED');
    expect(await transitionsOf(trip.collectionId)).toHaveLength(1);
  });

  it('reports a webhook that failed in an outage, recovers the payment afterwards, and ignores the retry', async () => {
    const trip = await qrAtPickup();
    const payment = ctx.links.pay(trip.referenceId);
    const webhook = linkPaid(trip, payment);
    ctx.links.unavailable = true;
    try {
      const failed = await sendWebhook(ctx, webhook);
      expect(failed.status).toBeGreaterThanOrEqual(500);
      const during = await recover();
      expect(summaryOf(during).providerUnavailable).toBeGreaterThanOrEqual(1);
      expect(summaryOf(during).complete).toBe(false);
    } finally {
      ctx.links.unavailable = false;
    }
    expect((await collectionRow(trip.collectionId)).status).toBe('PENDING');

    await reconcile();
    const stored = await ctx.prisma.paymentEvent.findUniqueOrThrow({
      where: { eventId: webhook.eventId },
    });
    expect(stored.processedAt).toBeNull();
    await one({
      kind: 'WEBHOOK_NOT_PROCESSED',
      entityId: stored.id,
      category: 'STALE_PENDING',
      severity: 'WARNING',
    });

    const recovery = await recover();
    expect((await collectionRow(trip.collectionId)).status).toBe('COMPLETED');
    await one({
      kind: 'COLLECTION_RECOVERED',
      entityId: trip.collectionId,
      firstRunId: recovery.id,
    });

    // Razorpay retries the webhook.
    await sendWebhook(ctx, webhook).expect(200);
    expect(
      (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }))
        .outcome,
    ).toBe('ALREADY_APPLIED');
    expect(await transitionsOf(trip.collectionId)).toEqual([
      expect.objectContaining({ statusTo: 'COMPLETED', requestId: recovery.id }),
    ]);
  });

  it('applies a payment exactly once when recovery races the webhook and the driver poll', async () => {
    for (let round = 0; round < 3; round += 1) {
      const trip = await qrAtPickup();
      const payment = ctx.links.pay(trip.referenceId);
      const [recovery, webhook, polled] = await Promise.all([
        ctx.app
          .get(ReconciliationRunsService)
          .runNow('COLLECTION_RECOVERY', { trigger: 'SCHEDULE', since }),
        sendWebhook(ctx, linkPaid(trip, payment)),
        poll(trip),
      ]);
      if (recovery) {
        runIds.add(recovery.id);
      }
      expect(recovery?.status).toBe('COMPLETED');
      expect(webhook.status).toBe(200);
      expect(polled.status).toBe(200);

      const transitions = await transitionsOf(trip.collectionId);
      expect(transitions).toEqual([
        expect.objectContaining({ statusFrom: 'PENDING', statusTo: 'COMPLETED' }),
      ]);
      expect(
        await ctx.prisma.financialEvent.count({
          where: {
            entityType: 'BOOKING',
            entityId: trip.bookingId,
            action: 'PAYMENT_STATUS_CHANGED',
          },
        }),
      ).toBe(1);
      // Only the job's own application is recorded as a recovery.
      expect(
        await findingsOf({ kind: 'COLLECTION_RECOVERED', entityId: trip.collectionId }),
      ).toHaveLength(transitions[0]?.actorType === 'SYSTEM' ? 1 : 0);
    }
  });

  it('closes an expired link as the webhook would, and reports money that reached it afterwards', async () => {
    const trip = await qrAtPickup();
    ctx.links.expire(trip.referenceId);
    const recovery = await recover();
    expect(await collectionRow(trip.collectionId)).toMatchObject({
      status: 'FAILED',
      failureReason: 'EXPIRED',
    });
    // Closing an unpaid link is no anomaly; the change is in the event log as the job.
    expect(await findingsOf({ entityId: trip.collectionId })).toEqual([]);
    expect(await transitionsOf(trip.collectionId)).toEqual([
      expect.objectContaining({
        statusFrom: 'PENDING',
        statusTo: 'FAILED',
        actorType: 'SYSTEM',
        requestId: recovery.id,
      }),
    ]);

    // The customer paid at the last moment: Razorpay holds money for a collection we closed.
    const late = ctx.links.pay(trip.referenceId);
    await reconcile();
    expect(
      await one({ kind: 'PROVIDER_PAID_COLLECTION_CLOSED', entityId: trip.collectionId }),
    ).toMatchObject({
      category: 'PROVIDER_PAID_INTERNAL_PENDING',
      severity: 'CRITICAL',
      source: 'PROVIDER',
      bookingId: trip.bookingId,
      providerRef: late.id,
      internalState: 'FAILED',
      providerAmountPaise: 50_000n,
    });
    // Never applied on its own (refund review).
    expect((await collectionRow(trip.collectionId)).status).toBe('FAILED');
    expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('UNPAID');
  });

  it('reports money we hold as paid that Razorpay refunded on its own, or no longer reports captured', async () => {
    const trip = await qrAtPickup();
    const payment = ctx.links.pay(trip.referenceId);
    expect((await poll(trip).expect(200)).body.status).toBe('COMPLETED');
    // Refunded on the Razorpay dashboard, outside this service.
    const dashboard = ctx.refunds.createExternal(payment.id, 50_000);

    const driver = await createDriver(ctx);
    const { paymentId, orderId } = await startTopUp(ctx, driver, 15_000);
    const topUp = ctx.razorpay.pay(orderId);
    await sendWebhook(ctx, buildWebhook('payment.captured', topUp)).expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(15_000n);
    ctx.razorpay.payments.set(topUp.id, { ...topUp, status: 'failed' });

    await reconcile();
    const refunded = await one({
      kind: 'PROVIDER_REFUND_NOT_RECORDED',
      entityId: trip.collectionId,
    });
    expect(refunded).toMatchObject({
      category: 'INTERNAL_PAID_PROVIDER_NOT_PAID',
      severity: 'CRITICAL',
      source: 'PROVIDER',
      bookingId: trip.bookingId,
      providerRef: payment.id,
      internalAmountPaise: 0n,
      providerAmountPaise: 50_000n,
    });
    expect(refunded.detail).toContain(dashboard.id);
    expect(await one({ kind: 'PROVIDER_PAYMENT_NOT_CAPTURED', entityId: paymentId })).toMatchObject(
      {
        category: 'INTERNAL_PAID_PROVIDER_NOT_PAID',
        severity: 'CRITICAL',
        providerState: 'failed',
        driverId: driver.driverId,
      },
    );
    // Nothing is corrected on its own: no refund recorded, the booking stays paid, the wallet
    // keeps its credit.
    expect(await ctx.prisma.paymentRefund.count({ where: { bookingId: trip.bookingId } })).toBe(0);
    expect((await bookingRow(trip.bookingId)).paymentStatus).toBe('PAID');
    expect(await walletBalance(ctx, driver.driverId)).toBe(15_000n);
  });

  it("reports an earning that is not its trip driver's, and a full run marks it cleared once the records agree", async () => {
    const driver = await createDriver(ctx);
    const other = await createDriver(ctx);
    await fundWallet(ctx, nextAdmin(), driver.driverId, 100_000);
    const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 40_000,
      category,
      model: 'QUOTE_PER_STOP',
    });
    await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    await collect(ctx, driver, trip.tripId, { method: 'CASH', amountPaise: 40_000 }).expect(201);
    await advanceTrip(ctx, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
    await deliverStops(ctx, trip.tripId, [1]);
    await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
    const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
      where: { bookingId: trip.bookingId },
    });

    // An operator moves the trip to another driver by hand.
    const reassign = (driverId: string) =>
      ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE trips DISABLE TRIGGER trg_trips_guard`;
        await tx.$executeRaw`UPDATE trips SET driver_id = ${driverId}::uuid WHERE id = ${trip.tripId}::uuid`;
        await tx.$executeRaw`ALTER TABLE trips ENABLE TRIGGER trg_trips_guard`;
      });
    await reassign(other.driverId);
    const seen = await reconcile();
    const finding = await one({ kind: 'SOURCE_DRIVER_MISMATCH', entityId: earning.id });
    expect(finding).toMatchObject({
      category: 'EARNING_SOURCE_MISMATCH',
      severity: 'CRITICAL',
      source: 'DATABASE',
      bookingId: trip.bookingId,
      driverId: driver.driverId,
      firstRunId: seen.id,
      clearedAt: null,
    });
    expect(finding.detail).toContain(other.driverId);
    expect(await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).toEqual(
      earning,
    );

    await reassign(driver.driverId);
    // A scoped run never clears anything ...
    await reconcile();
    expect((await findingRow(finding.id)).clearedAt).toBeNull();
    // ... a full run does, and keeps the finding for the admin.
    await fullReconcile();
    const cleared = await findingRow(finding.id);
    expect(cleared.status).toBe('OPEN');
    expect(cleared.clearedAt).toBeInstanceOf(Date);
  });

  it('reports settled payments that match none of ours', async () => {
    const unknown = newId('pay_');
    ctx.settlements.settle({ providerPaymentId: unknown, amountPaise: 12_345 });
    await ctx.app.get(MerchantSettlementsService).sync({ trigger: 'ADMIN' });
    await reconcile();
    expect(await one({ kind: 'SETTLEMENT_UNKNOWN_PAYMENT', providerRef: unknown })).toMatchObject({
      category: 'SETTLEMENT_MISMATCH',
      severity: 'CRITICAL',
      source: 'DATABASE',
      entityType: 'SETTLEMENT_FINDING',
      bookingId: null,
      internalAmountPaise: null,
      providerAmountPaise: 12_345n,
    });
  });

  it('reports a payout RazorpayX processed that we hold as submitted, and an event for a payout we never made', async () => {
    const driver = await createDriver(ctx);
    await createVerifiedBankAccount(ctx.prisma, driver.driverId, admin.userId);
    const customer = await createCustomer(ctx);
    const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 30_000,
      category,
    });
    const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
    const paid = ctx.razorpay.pay(started.body.checkout.orderId as string);
    await sendWebhook(ctx, buildWebhook('payment.captured', paid)).expect(200);
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    await settleAndSync(ctx, paid.id, 30_000);
    expect(
      (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } })).status,
    ).toBe('PAYABLE');
    const batch = await request(ctx.server)
      .post('/v1/admin/payout-batches')
      .set(bearer(nextAdmin().token))
      .set('Idempotency-Key', idempotencyKey())
      .send({})
      .expect(201);
    const batchId = batch.body.batch.batchId as string;
    await request(ctx.server)
      .post(`/v1/admin/payout-batches/${batchId}/execute`)
      .set(bearer(nextAdmin().token))
      .send()
      .expect(200);
    const payout = await ctx.prisma.driverPayout.findUniqueOrThrow({
      where: { batchId_driverId: { batchId, driverId: driver.driverId } },
    });
    expect(payout.status).toBe('SUBMITTED');
    const provider = ctx.payouts.byReference(payout.id);
    if (!provider) {
      throw new Error('expected a provider payout');
    }
    // RazorpayX processed it; its webhook never arrived.
    ctx.payouts.setStatus(provider.id, 'processed', { utr: 'UTR00000000001' });
    // RazorpayX also reports a payout this service never made.
    const strayId = newId('pout_');
    await sendPayoutWebhook(
      ctx,
      buildPayoutWebhook('payout.processed', {
        id: strayId,
        amount: 10_000,
        currency: 'INR',
        status: 'processed',
        referenceId: randomUUID(),
        fundAccountId: 'fa_Stray00000001',
        utr: 'UTR00000000002',
        failureReason: null,
      }),
    ).expect(200);

    await reconcile();
    const behind = await one({ kind: 'PAYOUT_STATUS_BEHIND', entityId: payout.id });
    expect(behind).toMatchObject({
      category: 'PAYOUT_MISMATCH',
      severity: 'WARNING',
      source: 'PROVIDER',
      driverId: driver.driverId,
      providerRef: provider.id,
      internalState: 'SUBMITTED',
      providerState: 'processed',
    });
    expect(behind.detail).toContain(`/v1/admin/payouts/${payout.id}/sync`);
    expect(
      await one({ kind: 'PAYOUT_WEBHOOK_UNKNOWN_PAYOUT', providerRef: strayId }),
    ).toMatchObject({
      category: 'PAYOUT_MISMATCH',
      severity: 'CRITICAL',
      source: 'DATABASE',
      entityType: 'PAYOUT_EVENT',
    });
    // Nothing applied: the admin's sync records it.
    expect(
      (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
    ).toBe('SUBMITTED');
    await request(ctx.server)
      .post(`/v1/admin/payouts/${payout.id}/sync`)
      .set(bearer(nextAdmin().token))
      .expect(200);
    expect(
      (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
    ).toBe('PROCESSED');
  });

  it('reports a refund Razorpay processed that we still hold as processing', async () => {
    const trip = await qrAtPickup();
    ctx.links.pay(trip.referenceId);
    expect((await poll(trip).expect(200)).body.status).toBe('COMPLETED');
    await engine(ctx)
      .post(`/v1/internal/bookings/${trip.bookingId}/cancel`)
      .send({ reason: 'Customer cancelled' })
      .expect(200);
    const created = await request(ctx.server)
      .post('/v1/admin/refunds')
      .set(bearer(nextAdmin().token))
      .set('Idempotency-Key', idempotencyKey())
      .send({
        bookingId: trip.bookingId,
        sourceCollectionId: trip.collectionId,
        kind: 'PROVIDER',
        reason: 'Customer cancelled before pickup; ticket 9001',
      })
      .expect(201);
    const refundId = created.body.refund.refundId as string;
    const refundRow = () => ctx.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
    expect((await refundRow()).status).toBe('PROCESSING');
    const providerRefund = ctx.refunds.forRefund(refundId);
    if (!providerRefund) {
      throw new Error('expected a provider refund');
    }
    // Processed at Razorpay; refund.processed never arrived.
    ctx.refunds.setStatus(providerRefund.id, 'processed');

    await reconcile();
    expect(await one({ kind: 'REFUND_STATUS_BEHIND', entityId: refundId })).toMatchObject({
      category: 'REFUND_MISMATCH',
      severity: 'WARNING',
      source: 'PROVIDER',
      bookingId: trip.bookingId,
      providerRef: providerRefund.id,
      internalState: 'PROCESSING',
      providerState: 'processed',
      internalAmountPaise: 50_000n,
      providerAmountPaise: 50_000n,
    });
    expect((await refundRow()).status).toBe('PROCESSING');
    // Razorpay's refund is ours: the payment's money is accounted for.
    expect(
      await findingsOf({ kind: 'PROVIDER_REFUND_NOT_RECORDED', entityId: trip.collectionId }),
    ).toEqual([]);
  });

  it('counts a condition once per run, keeps a resolved finding resolved, and opens a new one when it comes back', async () => {
    const driver = await createDriver(ctx);
    walletDriver = driver;
    await fundWallet(ctx, nextAdmin(), driver.driverId, 10_000);
    const wallet = await ctx.prisma.driverWallet.findUniqueOrThrow({
      where: { driverId: driver.driverId },
    });
    // The cached balance drifts from the ledger (an operator's UPDATE, say).
    const skew = (paise: number) =>
      ctx.prisma.$executeRaw`
        UPDATE driver_wallets SET balance_paise = balance_paise + ${paise}::bigint
         WHERE id = ${wallet.id}::uuid`;
    await skew(500);
    const first = await reconcile();
    const second = await reconcile();
    const finding = await one({ kind: 'WALLET_BALANCE_NOT_LEDGER', entityId: wallet.id });
    expect(finding).toMatchObject({
      category: 'WALLET_MISMATCH',
      severity: 'CRITICAL',
      source: 'DATABASE',
      status: 'OPEN',
      driverId: driver.driverId,
      internalAmountPaise: 10_500n,
      occurrences: 2,
      firstRunId: first.id,
      lastRunId: second.id,
    });
    // Reconciliation never "fixes" the balance.
    expect(
      (await ctx.prisma.driverWallet.findUniqueOrThrow({ where: { id: wallet.id } })).balancePaise,
    ).toBe(10_500n);

    const resolver = nextAdmin();
    const resolve = (note: string) =>
      request(ctx.server)
        .post(`/v1/admin/reconciliation/findings/${finding.id}/resolve`)
        .set(bearer(resolver.token))
        .send({ note });
    expect((await resolve('too short').expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const note = 'Balance drift reproduced; the ledger is right. Ops ticket 812';
    expect((await resolve(note).expect(200)).body).toMatchObject({
      id: finding.id,
      status: 'RESOLVED',
      resolvedByUserId: resolver.userId,
      resolutionNote: note,
      occurrences: 2,
    });
    expect((await resolve('Resolving it a second time').expect(409)).body.error.code).toBe(
      'RECONCILIATION_FINDING_RESOLVED',
    );
    // The decision is audited, and it is on the driver's trail.
    expect(
      await ctx.prisma.adminAction.findMany({
        where: { action: 'RECONCILIATION_FINDING_RESOLVED', targetId: finding.id },
      }),
    ).toEqual([
      expect.objectContaining({
        actorUserId: resolver.userId,
        targetType: 'RECONCILIATION_FINDING',
        reason: note,
      }),
    ]);
    expect(
      await ctx.prisma.financialEvent.count({
        where: {
          entityType: 'ADMIN_ACTION',
          driverId: driver.driverId,
          actorUserId: resolver.userId,
        },
      }),
    ).toBe(1);

    // Still drifting: the next run counts it on the resolved finding and reopens nothing.
    const third = await reconcile();
    expect(await findingRow(finding.id)).toMatchObject({
      status: 'RESOLVED',
      occurrences: 3,
      lastRunId: third.id,
      clearedAt: null,
    });
    expect(await findingsOf({ fingerprint: finding.fingerprint, status: 'OPEN' })).toEqual([]);

    // Corrected: a full run marks it cleared ...
    await skew(-500);
    await fullReconcile();
    const cleared = await findingRow(finding.id);
    expect(cleared).toMatchObject({ status: 'RESOLVED', occurrences: 3 });
    expect(cleared.clearedAt).toBeInstanceOf(Date);
    // ... and when the condition comes back, it is a new finding.
    await skew(700);
    const fourth = await reconcile();
    const reopened = await one({ fingerprint: finding.fingerprint, status: 'OPEN' });
    expect(reopened).toMatchObject({
      occurrences: 1,
      firstRunId: fourth.id,
      internalAmountPaise: 10_700n,
    });
    expect(reopened.id).not.toBe(finding.id);
    expect(await findingRow(finding.id)).toEqual(cleared);
    await skew(-700);
    resolvedFinding = cleared;
    reopenedFinding = reopened;
  });

  it('records duplicate deliveries and payments, and the money stays applied once', async () => {
    const driver = await createDriver(ctx);
    const { orderId } = await startTopUp(ctx, driver, 12_000);
    const payment = ctx.razorpay.pay(orderId);
    const first = buildWebhook('payment.captured', payment);
    const resent = buildWebhook('payment.captured', payment);
    await sendWebhook(ctx, first).expect(200);
    await sendWebhook(ctx, first).expect(200);
    await sendWebhook(ctx, resent).expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(12_000n);
    // Another top-up order paid twice at Razorpay.
    const twice = await startTopUp(ctx, driver, 8_000);
    const payA = ctx.razorpay.pay(twice.orderId);
    const payB = ctx.razorpay.pay(twice.orderId);

    await reconcile();
    const delivery = await one({ kind: 'DUPLICATE_WEBHOOK_DELIVERY', providerRef: payment.id });
    expect(delivery).toMatchObject({
      category: 'DUPLICATE_PROVIDER_EVENT',
      severity: 'INFO',
      source: 'DATABASE',
      entityId: `RAZORPAY payment.captured ${payment.id}`,
    });
    expect(delivery.detail).toContain(first.eventId);
    expect(delivery.detail).toContain(resent.eventId);
    expect(
      await one({ kind: 'PROVIDER_ORDER_PAID_TWICE', entityId: twice.paymentId }),
    ).toMatchObject({
      category: 'DUPLICATE_PROVIDER_EVENT',
      severity: 'CRITICAL',
      source: 'PROVIDER',
      providerRef: twice.orderId,
    });
    expect(
      await findingsOf({ kind: 'PROVIDER_PAID_PAYMENT_PENDING', entityId: twice.paymentId }),
    ).toHaveLength(2);
    // The first payment was applied once: no money recorded twice for it.
    expect(
      await findingsOf({
        providerRef: payment.id,
        kind: {
          in: [
            'PROVIDER_EVENT_APPLIED_TWICE',
            'PROVIDER_PAYMENT_ON_TWO_RECORDS',
            'DUPLICATE_LEDGER_PROVIDER_PAYMENT',
          ],
        },
      }),
    ).toEqual([]);

    // Both captured payments arrive by webhook: the first is applied, the second is refused.
    await sendWebhook(ctx, buildWebhook('payment.captured', payA)).expect(200);
    const duplicate = buildWebhook('payment.captured', payB);
    await sendWebhook(ctx, duplicate).expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(20_000n);
    expect(
      (await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: duplicate.eventId } }))
        .outcome,
    ).toBe('DUPLICATE_ORDER_PAYMENT');
    await reconcile();
    expect(
      await one({ kind: 'WEBHOOK_DUPLICATE_ORDER_PAYMENT', providerRef: payB.id }),
    ).toMatchObject({
      category: 'DUPLICATE_PROVIDER_EVENT',
      severity: 'CRITICAL',
      entityType: 'PAYMENT_EVENT',
    });
  });

  it('reports provider events it could not use, and a collection Razorpay cannot find', async () => {
    // A pending collection whose payment link Razorpay no longer knows.
    const lost = await qrAtPickup();
    const stored = ctx.links.links.get(lost.referenceId);
    ctx.links.links.delete(lost.referenceId);
    try {
      await recover();
    } finally {
      if (stored) {
        ctx.links.links.set(lost.referenceId, stored);
      }
    }
    expect(
      await one({ kind: 'RECOVERY_PROVIDER_LOOKUP_FAILED', entityId: lost.collectionId }),
    ).toMatchObject({
      category: 'PROVIDER_EVENT_ANOMALY',
      severity: 'WARNING',
      source: 'RECOVERY',
      bookingId: lost.bookingId,
    });
    expect((await collectionRow(lost.collectionId)).status).toBe('PENDING');
    ctx.links.expire(lost.referenceId);

    // A signed webhook whose payment can't be read, and money for an order we never created.
    const malformedId = newId('pay_');
    await sendWebhook(
      ctx,
      signed('payment.captured', { payment: { entity: { id: malformedId, entity: 'payment' } } }),
    ).expect(200);
    const foreign = {
      id: newId('pay_'),
      amount: 9_900,
      currency: 'INR',
      status: 'captured',
      orderId: newId('order_'),
      method: 'upi',
    };
    await sendWebhook(ctx, buildWebhook('payment.captured', foreign)).expect(200);
    // The customer's bank won a dispute on a payment we hold as paid.
    const disputed = await qrAtPickup();
    const paidByLink = ctx.links.pay(disputed.referenceId);
    expect((await poll(disputed).expect(200)).body.status).toBe('COMPLETED');
    const disputeId = newId('disp_');
    await sendWebhook(
      ctx,
      buildDisputeWebhook('payment.dispute.lost', {
        id: disputeId,
        paymentId: paidByLink.id,
        amount: 50_000,
        status: 'lost',
      }),
    ).expect(200);

    await reconcile();
    expect(
      await one({ kind: 'WEBHOOK_UNSUPPORTED_PAYLOAD', providerRef: malformedId }),
    ).toMatchObject({
      category: 'PROVIDER_EVENT_ANOMALY',
      severity: 'WARNING',
    });
    expect(await one({ kind: 'WEBHOOK_UNKNOWN_ORDER', providerRef: foreign.id })).toMatchObject({
      category: 'PROVIDER_PAID_INTERNAL_PENDING',
      severity: 'CRITICAL',
    });
    expect(await one({ kind: 'WEBHOOK_DISPUTE_RECORDED', providerRef: disputeId })).toMatchObject({
      category: 'INTERNAL_PAID_PROVIDER_NOT_PAID',
      severity: 'CRITICAL',
      bookingId: disputed.bookingId,
    });
    expect(await one({ kind: 'DISPUTE_LOST', bookingId: disputed.bookingId })).toMatchObject({
      category: 'INTERNAL_PAID_PROVIDER_NOT_PAID',
      severity: 'CRITICAL',
      source: 'DATABASE',
      internalState: 'PAID',
      providerState: 'lost',
      providerAmountPaise: 50_000n,
    });
  });

  it('runs one job at a time: concurrent starts share one lease', async () => {
    const service = ctx.app.get(ReconciliationRunsService);
    const started = await Promise.all(
      [1, 2, 3].map(() => service.runNow('RECONCILIATION', { trigger: 'SCHEDULE', since })),
    );
    const ran = started.filter((candidate) => candidate !== null);
    expect(ran).toHaveLength(1);
    expect(ran[0]?.status).toBe('COMPLETED');
    for (const candidate of ran) {
      runIds.add(candidate.id);
    }

    // Through the API: a second request is refused with the running run's id.
    const first = await startRun(nextAdmin(), {
      job: 'RECONCILIATION',
      since: since.toISOString(),
    }).expect(202);
    expect(first.body).toMatchObject({
      job: 'RECONCILIATION',
      triggeredBy: 'ADMIN',
      status: 'RUNNING',
      scope: { since: since.toISOString() },
    });
    const second = await startRun(nextAdmin(), { job: 'RECONCILIATION' }).expect(409);
    expect(second.body.error).toMatchObject({
      code: 'RECONCILIATION_RUN_IN_PROGRESS',
      details: { runId: first.body.id },
    });
    // The other job is not blocked by it.
    const recovery = await startRun(nextAdmin(), {
      job: 'COLLECTION_RECOVERY',
      since: since.toISOString(),
    }).expect(202);
    expect((await waitForRun(first.body.id as string)).status).toBe('COMPLETED');
    expect((await waitForRun(recovery.body.id as string)).status).toBe('COMPLETED');
  });

  it('closes a run that died mid-way and starts over; a live lease is respected', async () => {
    const [crashed] = await ctx.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO reconciliation_runs (job, triggered_by, lease_expires_at)
      VALUES ('COLLECTION_RECOVERY', 'SCHEDULE', clock_timestamp() - interval '1 minute')
      RETURNING id`;
    if (!crashed) {
      throw new Error('expected the crashed run');
    }
    const trip = await qrAtPickup();
    ctx.links.pay(trip.referenceId);
    const recovery = await recover();
    expect(
      await ctx.prisma.reconciliationRun.findUniqueOrThrow({ where: { id: crashed.id } }),
    ).toMatchObject({
      status: 'ABANDONED',
      finishedAt: expect.any(Date),
      error: expect.stringMatching(/lease expired/),
    });
    expect((await collectionRow(trip.collectionId)).status).toBe('COMPLETED');
    expect(await transitionsOf(trip.collectionId)).toEqual([
      expect.objectContaining({ requestId: recovery.id }),
    ]);

    // Another instance holds a live lease: nothing runs here, and an admin is told which run.
    const [live] = await ctx.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO reconciliation_runs (job, triggered_by, lease_expires_at)
      VALUES ('COLLECTION_RECOVERY', 'SCHEDULE', clock_timestamp() + interval '5 minutes')
      RETURNING id`;
    if (!live) {
      throw new Error('expected the live run');
    }
    expect(
      await ctx.app
        .get(ReconciliationRunsService)
        .runNow('COLLECTION_RECOVERY', { trigger: 'SCHEDULE', since }),
    ).toBeNull();
    const refused = await startRun(nextAdmin(), { job: 'COLLECTION_RECOVERY' }).expect(409);
    expect(refused.body.error).toMatchObject({
      code: 'RECONCILIATION_RUN_IN_PROGRESS',
      details: { runId: live.id },
    });
    // That instance finishes.
    await ctx.prisma.$executeRaw`
      UPDATE reconciliation_runs SET status = 'COMPLETED', finished_at = clock_timestamp()
       WHERE id = ${live.id}::uuid`;
  });

  it('counts a sighting once per run, even when it is recorded again or concurrently', async () => {
    const findings = ctx.app.get(ReconciliationFindingsService);
    const first = await reconcile();
    const seeded = detected({
      ...critical('WALLET_MISMATCH'),
      kind: 'TEST_REPEATED_SIGHTING',
      source: 'DATABASE',
      entityType: 'TEST',
      entityId: randomUUID(),
      detail: 'Seeded by the reconciliation test',
    });
    expect(await findings.recordOne(first.id, seeded)).toBe('CREATED');
    expect(await findings.recordOne(first.id, seeded)).toBe('UNCHANGED');
    const second = await reconcile();
    const results = await Promise.all([
      findings.recordOne(second.id, seeded),
      findings.recordOne(second.id, seeded),
    ]);
    expect(results.sort()).toEqual(['SIGHTED', 'UNCHANGED']);
    expect(await one({ fingerprint: seeded.fingerprint })).toMatchObject({
      status: 'OPEN',
      occurrences: 2,
      firstRunId: first.id,
      lastRunId: second.id,
    });
  });

  it('finds nothing wrong with clean historical (legacy) bookings', async () => {
    const driver = await createDriver(ctx);
    await fundWallet(ctx, nextAdmin(), driver.driverId, 20_000);
    const customer = await createCustomer(ctx);
    // A historical prepaid booking, paid through Checkout and completed.
    const prepaid = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 30_000,
      category,
    });
    const started = await startBookingPayment(ctx, customer, prepaid.bookingId).expect(201);
    const paid = ctx.razorpay.pay(started.body.checkout.orderId as string);
    await sendWebhook(ctx, buildWebhook('payment.captured', paid)).expect(200);
    await advanceTrip(ctx, prepaid.tripId, TO_DELIVERED);
    await setTripStatus(ctx, prepaid.tripId, 'COMPLETED').expect(200);
    // A historical pay-at-delivery booking, paid in cash at the door and completed.
    const cash = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 20_000,
      category,
    });
    await advanceTrip(ctx, cash.tripId, TO_DELIVERED);
    await collect(ctx, driver, cash.tripId, { method: 'CASH', amountPaise: 20_000 }).expect(201);
    await setTripStatus(ctx, cash.tripId, 'COMPLETED').expect(200);

    await reconcile();
    expect(await findingsOf({ bookingId: { in: [prepaid.bookingId, cash.bookingId] } })).toEqual(
      [],
    );
    expect(await findingsOf({ driverId: driver.driverId })).toEqual([]);
  });

  it('is for admins only', async () => {
    const driver = await createDriver(ctx);
    const customer = await createCustomer(ctx);
    const routes: readonly [method: 'get' | 'post', path: string, body?: object][] = [
      ['get', 'summary'],
      ['get', 'findings'],
      ['get', `findings/${randomUUID()}`],
      ['post', `findings/${randomUUID()}/resolve`, { note: 'An attempt to resolve it' }],
      ['post', 'runs', { job: 'RECONCILIATION' }],
      ['get', 'runs'],
      ['get', `runs/${randomUUID()}`],
      ['get', 'integrity-checks'],
    ];
    const runsBefore = await ctx.prisma.reconciliationRun.count();
    for (const [method, path, body] of routes) {
      const url = `/v1/admin/reconciliation/${path}`;
      const call = (token?: string) => {
        const req =
          method === 'get'
            ? request(ctx.server).get(url)
            : request(ctx.server)
                .post(url)
                .send(body ?? {});
        return token ? req.set(bearer(token)) : req;
      };
      expect((await call()).status).toBe(401);
      expect((await call(driver.token)).status).toBe(403);
      expect((await call(customer.token)).status).toBe(403);
    }
    expect(await ctx.prisma.reconciliationRun.count()).toBe(runsBefore);
  });

  it('serves the summary, findings and runs to admins, and validates requests', async () => {
    if (!walletDriver || !resolvedFinding || !reopenedFinding) {
      throw new Error('the lifecycle test above must run first');
    }
    const reader = nextAdmin();
    const get = (path: string, query: Record<string, string | number> = {}) =>
      request(ctx.server)
        .get(`/v1/admin/reconciliation/${path}`)
        .query(query)
        .set(bearer(reader.token));

    const summary = await get('summary').expect(200);
    expect(summary.body.openFindings.total).toBeGreaterThan(0);
    expect(summary.body.openFindings.bySeverity.CRITICAL).toBeGreaterThan(0);
    expect(summary.body.latestRuns.RECONCILIATION).toMatchObject({ job: 'RECONCILIATION' });
    expect(summary.body.latestRuns.COLLECTION_RECOVERY).toMatchObject({
      job: 'COLLECTION_RECOVERY',
    });
    expect(summary.body.schedule).toEqual({
      recoveryIntervalMinutes: 0,
      reconciliationIntervalMinutes: 0,
      providerChecks: true,
      lookbackDays: 3,
    });

    // The two wallet findings of the lifecycle test, a page at a time (newest first).
    const filter = { driverId: walletDriver.driverId, category: 'WALLET_MISMATCH' };
    const page1 = await get('findings', { ...filter, limit: 1 }).expect(200);
    expect(page1.body.items).toEqual([expect.objectContaining({ id: reopenedFinding.id })]);
    const page2 = await get('findings', {
      ...filter,
      limit: 1,
      cursor: page1.body.nextCursor as string,
    }).expect(200);
    expect(page2.body).toEqual({
      items: [expect.objectContaining({ id: resolvedFinding.id, status: 'RESOLVED' })],
      nextCursor: null,
    });
    expect((await get('findings', { ...filter, cleared: 'true' }).expect(200)).body.items).toEqual([
      expect.objectContaining({ id: resolvedFinding.id }),
    ]);
    expect((await get('findings', { ...filter, status: 'OPEN' }).expect(200)).body.items).toEqual([
      expect.objectContaining({ id: reopenedFinding.id }),
    ]);
    expect((await get(`findings/${resolvedFinding.id}`).expect(200)).body).toMatchObject({
      id: resolvedFinding.id,
      kind: 'WALLET_BALANCE_NOT_LEDGER',
      status: 'RESOLVED',
      internalAmountPaise: 10_500,
      occurrences: 3,
      resolutionNote: resolvedFinding.resolutionNote,
    });
    expect((await get(`findings/${randomUUID()}`).expect(404)).body.error.code).toBe(
      'RECONCILIATION_FINDING_NOT_FOUND',
    );
    await get('findings/not-a-uuid').expect(400);
    const invalid: Record<string, string | number>[] = [
      { status: 'CLOSED' },
      { category: 'MISC' },
      { severity: 'LOW' },
      { source: 'GUESS' },
      { kind: 'lower_case' },
      { limit: 0 },
      { cursor: 'x' },
      { cleared: 'maybe' },
    ];
    for (const query of invalid) {
      expect((await get('findings', query).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    }

    const runsPage = await get('runs', { job: 'RECONCILIATION', limit: 2 }).expect(200);
    expect(runsPage.body.items).toHaveLength(2);
    expect(runsPage.body.nextCursor).toEqual(expect.any(String));
    const latest = runsPage.body.items[0] as { id: string };
    expect((await get(`runs/${latest.id}`).expect(200)).body).toEqual(latest);
    expect((await get(`runs/${randomUUID()}`).expect(404)).body.error.code).toBe(
      'RECONCILIATION_RUN_NOT_FOUND',
    );

    // Starting a run: validated, audited, run in the background.
    const starter = nextAdmin();
    await startRun(starter, { job: 'EVERYTHING' }).expect(400);
    await startRun(starter, { job: 'RECONCILIATION', since: 'yesterday' }).expect(400);
    const started = await startRun(starter, {
      job: 'COLLECTION_RECOVERY',
      since: since.toISOString(),
    }).expect(202);
    expect(started.body).toMatchObject({
      job: 'COLLECTION_RECOVERY',
      triggeredBy: 'ADMIN',
      status: 'RUNNING',
      requestedByUserId: starter.userId,
      finishedAt: null,
    });
    expect(await waitForRun(started.body.id as string)).toMatchObject({ status: 'COMPLETED' });
    expect(
      await ctx.prisma.adminAction.findMany({
        where: { action: 'RECONCILIATION_RUN_REQUESTED', targetId: started.body.id as string },
      }),
    ).toEqual([
      expect.objectContaining({ actorUserId: starter.userId, targetType: 'RECONCILIATION_RUN' }),
    ]);

    // The integrity view: what the database checks see now; nothing is recorded.
    const recorded = await ctx.prisma.reconciliationFinding.count();
    const checks = await get('integrity-checks').expect(200);
    const names = (checks.body.checks as { check: string; complete: boolean }[]).map(
      (check) => check.check,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'EARNING_MISMATCHES',
        'EARNING_SOURCES',
        'WALLET_BALANCES',
        'WALLET_LEDGER',
        'DUPLICATE_MONEY',
        'WEBHOOK_PROBLEMS',
        'DISPUTES',
      ]),
    );
    expect(await ctx.prisma.reconciliationFinding.count()).toBe(recorded);
  });

  it('keeps runs and findings honest for every role, the table owner included', async () => {
    if (!resolvedFinding || !reopenedFinding) {
      throw new Error('the lifecycle test above must run first');
    }
    const open = reopenedFinding.id;
    const closed = resolvedFinding.id;
    const driver = await createDriver(ctx);
    const refuses = (pattern: RegExp, statement: Promise<unknown>) =>
      expect(statement).rejects.toThrow(pattern);

    await refuses(
      /identity and first sighting are immutable/,
      ctx.prisma
        .$executeRaw`UPDATE reconciliation_findings SET fingerprint = 'forged' WHERE id = ${open}::uuid`,
    );
    await refuses(
      /identity and first sighting are immutable/,
      ctx.prisma
        .$executeRaw`UPDATE reconciliation_findings SET severity = 'INFO' WHERE id = ${open}::uuid`,
    );
    await refuses(
      /sightings only move forward/,
      ctx.prisma.$executeRaw`
        UPDATE reconciliation_findings SET last_seen_at = last_seen_at - interval '1 day'
         WHERE id = ${open}::uuid`,
    );
    await refuses(
      /Only an active admin resolves a finding/,
      ctx.prisma.$executeRaw`
        UPDATE reconciliation_findings
           SET status = 'RESOLVED', resolved_at = now(), resolved_by_user_id = ${driver.userId}::uuid,
               resolution_note = 'Resolved by a driver account'
         WHERE id = ${open}::uuid`,
    );
    await refuses(
      /reconciliation_findings_resolution/,
      ctx.prisma.$executeRaw`
        UPDATE reconciliation_findings
           SET status = 'RESOLVED', resolved_at = now(), resolved_by_user_id = ${admin.userId}::uuid,
               resolution_note = 'too short'
         WHERE id = ${open}::uuid`,
    );
    await refuses(
      /never reopened or changed/,
      ctx.prisma.$executeRaw`
        UPDATE reconciliation_findings
           SET status = 'OPEN', resolved_at = NULL, resolved_by_user_id = NULL, resolution_note = NULL
         WHERE id = ${closed}::uuid`,
    );
    await refuses(
      /never reopened or changed/,
      ctx.prisma
        .$executeRaw`UPDATE reconciliation_findings SET detail = 'rewritten' WHERE id = ${closed}::uuid`,
    );
    await refuses(
      /permanent financial records and cannot be deleted/,
      ctx.prisma.$executeRaw`DELETE FROM reconciliation_findings WHERE id = ${open}::uuid`,
    );
    await refuses(
      /permanent financial records and cannot be deleted/,
      ctx.prisma.$executeRaw`TRUNCATE reconciliation_findings`,
    );
    await refuses(
      /recorded OPEN, at its first sighting/,
      ctx.prisma.$executeRaw`
        INSERT INTO reconciliation_findings (category, kind, severity, source, fingerprint, status,
                                             resolved_at, resolved_by_user_id, resolution_note)
        VALUES ('WALLET_MISMATCH', 'FORGED_FINDING', 'INFO', 'DATABASE', 'FORGED_FINDING|1',
                'RESOLVED', now(), ${admin.userId}::uuid, 'Resolved before it was ever seen')`,
    );
    // Untouched by all of the above.
    expect(await findingRow(open)).toEqual(reopenedFinding);
    expect(await findingRow(closed)).toEqual(resolvedFinding);

    const finished = await ctx.prisma.reconciliationRun.findFirstOrThrow({
      where: { id: { in: [...runIds] }, status: 'COMPLETED' },
    });
    await refuses(
      /finished reconciliation run \(COMPLETED\) is immutable/,
      ctx.prisma
        .$executeRaw`UPDATE reconciliation_runs SET summary = '{}' WHERE id = ${finished.id}::uuid`,
    );
    const otherJob = finished.job === 'RECONCILIATION' ? 'COLLECTION_RECOVERY' : 'RECONCILIATION';
    await refuses(
      /job, trigger, scope, requester and start are immutable/,
      ctx.prisma.$executeRaw`
        UPDATE reconciliation_runs SET job = ${otherJob} WHERE id = ${finished.id}::uuid`,
    );
    await refuses(
      /permanent financial records and cannot be deleted/,
      ctx.prisma.$executeRaw`DELETE FROM reconciliation_runs WHERE id = ${finished.id}::uuid`,
    );
    await refuses(
      /cannot truncate|cannot be deleted/,
      ctx.prisma.$executeRaw`TRUNCATE reconciliation_runs`,
    );
    await refuses(
      /recorded RUNNING when it starts/,
      ctx.prisma.$executeRaw`
        INSERT INTO reconciliation_runs (job, triggered_by, status, lease_expires_at, finished_at)
        VALUES ('RECONCILIATION', 'SCHEDULE', 'COMPLETED', now(), now())`,
    );
    await refuses(
      /Only an active admin requests a reconciliation run/,
      ctx.prisma.$executeRaw`
        INSERT INTO reconciliation_runs (job, triggered_by, requested_by_user_id, lease_expires_at)
        VALUES ('RECONCILIATION', 'ADMIN', ${driver.userId}::uuid, now() + interval '1 minute')`,
    );
  });

  it('covered every finding category with the anomalies above', async () => {
    const groups = await ctx.prisma.reconciliationFinding.groupBy({
      by: ['category'],
      where: { firstRunId: { in: [...runIds] } },
    });
    expect(groups.map((group) => group.category).sort()).toEqual([...FINDING_CATEGORIES].sort());
  });
});
