import { randomUUID } from 'node:crypto';
import { TopUpFinalizerService } from '../../src/payments/top-up-finalizer.service';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import { WalletLedgerService } from '../../src/wallet/wallet-ledger.service';
import { WalletService } from '../../src/wallet/wallet.service';
import { createAdmin, createDriver, type TestAdmin } from '../helpers/fixtures';
import { sendWebhook, startTopUp, topUpCredits, verifyTopUp, walletBalance } from '../helpers/http';
import { buildWebhook, checkoutSignature } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_PREVIOUS_WEBHOOK_SECRET } from '../helpers/test-config';

describe('Razorpay webhooks', () => {
  let ctx: TestContext;
  let admin: TestAdmin;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function paidTopUp(amountPaise = 50_000, status: 'captured' | 'authorized' = 'captured') {
    const driver = await createDriver(ctx);
    const topUp = await startTopUp(ctx, driver, amountPaise);
    const payment = ctx.razorpay.pay(topUp.orderId, { status });
    return { driver, ...topUp, payment };
  }

  function storedEvent(eventId: string) {
    return ctx.prisma.paymentEvent.findUnique({ where: { eventId } });
  }

  it('#5 rejects an invalid signature, stores nothing and credits nothing', async () => {
    const { driver, payment } = await paidTopUp();
    const webhook = buildWebhook('payment.captured', payment);

    const res = await sendWebhook(ctx, webhook, { signature: 'f'.repeat(64) }).expect(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const tampered = {
      ...webhook,
      body: webhook.body.replace('"amount":50000', '"amount":5000000'),
    };
    await sendWebhook(ctx, tampered).expect(400);
    await sendWebhook(ctx, webhook, { signature: '' }).expect(400);

    expect(await storedEvent(webhook.eventId)).toBeNull();
    expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
  });

  it('a forged request cannot reserve the event id of the genuine event', async () => {
    const { driver, payment } = await paidTopUp(30_000);
    const genuine = buildWebhook('payment.captured', payment);
    const forged = buildWebhook('payment.captured', payment, {
      eventId: genuine.eventId,
      secret: 'attacker_secret_value_0123456789abcdef',
    });

    await sendWebhook(ctx, forged).expect(400);
    await sendWebhook(ctx, genuine).expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(30_000n);
  });

  it('#1 the same webhook delivered 20 times in a row credits once', async () => {
    const { driver, payment, paymentId } = await paidTopUp();
    const webhook = buildWebhook('payment.captured', payment);

    for (let i = 0; i < 20; i += 1) {
      await sendWebhook(ctx, webhook).expect(200, { received: true });
    }

    expect(await walletBalance(ctx, driver.driverId)).toBe(50_000n);
    const credits = await topUpCredits(ctx, driver.driverId);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      providerPaymentId: payment.id,
      providerEventId: webhook.eventId,
    });
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'APPLIED', paymentId });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PAID',
    );
  });

  it('#1 the same webhook delivered 20 times concurrently credits once', async () => {
    const { driver, payment } = await paidTopUp(70_000);
    const webhook = buildWebhook('payment.captured', payment);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => sendWebhook(ctx, webhook)),
    );

    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 200));
    expect(await walletBalance(ctx, driver.driverId)).toBe(70_000n);
    expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'APPLIED' });
  });

  it('#7 payment.captured and order.paid for the same payment credit once', async () => {
    const { driver, payment } = await paidTopUp();
    const captured = buildWebhook('payment.captured', payment);
    const orderPaid = buildWebhook('order.paid', payment);

    await Promise.all([
      sendWebhook(ctx, captured).expect(200),
      sendWebhook(ctx, orderPaid).expect(200),
    ]);

    expect(await walletBalance(ctx, driver.driverId)).toBe(50_000n);
    expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
    const outcomes = [
      (await storedEvent(captured.eventId))?.outcome,
      (await storedEvent(orderPaid.eventId))?.outcome,
    ];
    expect(outcomes.sort()).toEqual(['ALREADY_APPLIED', 'APPLIED']);
  });

  it('#7 the app verify call and the webhook for the same payment credit once', async () => {
    const { driver, payment, paymentId, orderId } = await paidTopUp(40_000);
    await verifyTopUp(ctx, driver, paymentId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id),
    }).expect(200);

    const webhook = buildWebhook('payment.captured', payment);
    await sendWebhook(ctx, webhook).expect(200);

    expect(await walletBalance(ctx, driver.driverId)).toBe(40_000n);
    expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'ALREADY_APPLIED' });
  });

  it('#6 a signed webhook with the wrong amount never credits and is flagged', async () => {
    const { driver, paymentId, orderId } = await paidTopUp(50_000);
    const mismatched = ctx.razorpay.pay(orderId, { amount: 500 });
    const webhook = buildWebhook('payment.captured', mismatched);

    await sendWebhook(ctx, webhook).expect(200);

    expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PENDING',
    );
    const event = await storedEvent(webhook.eventId);
    expect(event).toMatchObject({ outcome: 'AMOUNT_MISMATCH', processingError: 'AMOUNT_MISMATCH' });
    expect(event?.processedAt).not.toBeNull();

    const anomalies = await ctx.app.get(ReconciliationService).findWebhookAnomalies();
    expect(anomalies.map((a) => a.eventId)).toContain(webhook.eventId);
  });

  it('payment.authorized is captured by the server and then credited', async () => {
    const { driver, payment } = await paidTopUp(20_000, 'authorized');
    await sendWebhook(ctx, buildWebhook('payment.authorized', payment)).expect(200);

    expect(ctx.razorpay.payments.get(payment.id)?.status).toBe('captured');
    expect(await walletBalance(ctx, driver.driverId)).toBe(20_000n);
  });

  it('a failed attempt is recorded without failing the top-up', async () => {
    const driver = await createDriver(ctx);
    const { orderId, paymentId } = await startTopUp(ctx, driver, 10_000);
    const failed = ctx.razorpay.pay(orderId, { status: 'failed' });
    const webhook = buildWebhook('payment.failed', failed);

    await sendWebhook(ctx, webhook).expect(200);

    expect(await storedEvent(webhook.eventId)).toMatchObject({
      outcome: 'PAYMENT_ATTEMPT_FAILED',
      paymentId,
    });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PENDING',
    );
  });

  it('money for an order this service did not create is flagged for review', async () => {
    const webhook = buildWebhook('payment.captured', {
      id: 'pay_UnknownOrder0001',
      amount: 1_000,
      currency: 'INR',
      status: 'captured',
      orderId: 'order_NotOurs000001',
      method: 'upi',
    });
    await sendWebhook(ctx, webhook).expect(200);
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'UNKNOWN_ORDER' });
    expect((await storedEvent(webhook.eventId))?.processingError).toBeTruthy();
  });

  it('acknowledges and ignores event types it does not handle', async () => {
    const { payment } = await paidTopUp(10_000);
    const webhook = buildWebhook('invoice.paid', payment);
    await sendWebhook(ctx, webhook).expect(200);
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'IGNORED_EVENT_TYPE' });

    // refund.* is handled since payment flow Phase 6 (refunds.int-spec.ts): one without a refund
    // entity is malformed, recorded for review and never applied.
    const refundWithoutEntity = buildWebhook('refund.created', payment);
    await sendWebhook(ctx, refundWithoutEntity).expect(200);
    expect(await storedEvent(refundWithoutEntity.eventId)).toMatchObject({
      outcome: 'UNSUPPORTED_PAYLOAD',
    });
  });

  it('accepts the previous webhook secret during a rotation', async () => {
    const { driver, payment } = await paidTopUp(10_000);
    await sendWebhook(
      ctx,
      buildWebhook('payment.captured', payment, { secret: TEST_PREVIOUS_WEBHOOK_SECRET }),
    ).expect(200);
    expect(await walletBalance(ctx, driver.driverId)).toBe(10_000n);
  });

  it('falls back to a hash of the signed body when the event id header is missing', async () => {
    const { driver, payment } = await paidTopUp(10_000);
    const webhook = buildWebhook('payment.captured', payment);

    await sendWebhook(ctx, webhook, { eventId: null }).expect(200);
    await sendWebhook(ctx, webhook, { eventId: null }).expect(200);

    expect(await walletBalance(ctx, driver.driverId)).toBe(10_000n);
    const events = await ctx.prisma.paymentEvent.findMany({
      where: { eventId: { startsWith: 'sha256:' }, paymentId: { not: null } },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('a temporary failure returns 503 so Razorpay retries, and the retry credits once', async () => {
    const { driver, payment } = await paidTopUp(60_000);
    const webhook = buildWebhook('payment.captured', payment);
    const finalizer = ctx.app.get(TopUpFinalizerService);
    const spy = jest
      .spyOn(finalizer, 'finalizeCapturedTopUp')
      .mockRejectedValueOnce(new Error('simulated database outage'));

    try {
      const failed = await sendWebhook(ctx, webhook).expect(503);
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
      const pending = await storedEvent(webhook.eventId);
      expect(pending?.processedAt).toBeNull();
      expect(pending?.processingError).toBeTruthy();

      await sendWebhook(ctx, webhook).expect(200);
    } finally {
      spy.mockRestore();
    }

    expect(await walletBalance(ctx, driver.driverId)).toBe(60_000n);
    expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
    expect(await storedEvent(webhook.eventId)).toMatchObject({ outcome: 'APPLIED', attempts: 2 });
  });

  it('#10 concurrent top-up credits and cash fee debits serialize safely', async () => {
    const ledger = ctx.app.get(WalletLedgerService);
    const wallets = ctx.app.get(WalletService);
    const reconciliation = ctx.app.get(ReconciliationService);

    for (let round = 0; round < 5; round += 1) {
      const driver = await createDriver(ctx);
      const wallet = await wallets.ensureWalletForDriver(driver.driverId);
      await ctx.prisma.runInTransaction((tx) =>
        ledger.postEntry(tx, {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          direction: 'CREDIT',
          amountPaise: 10_000n,
          referenceType: 'ADMIN',
          referenceId: admin.userId,
          performedByUserId: admin.userId,
          reason: 'Integration test funding',
          idempotencyKey: `test:${randomUUID()}`,
        }),
      );
      const { orderId } = await startTopUp(ctx, driver, 50_000);
      const payment = ctx.razorpay.pay(orderId);

      const [webhookResponse] = await Promise.all([
        sendWebhook(ctx, buildWebhook('payment.captured', payment)),
        ctx.prisma.runInTransaction((tx) =>
          ledger.postEntry(tx, {
            walletId: wallet.id,
            type: 'CASH_RIDE_FEE',
            direction: 'DEBIT',
            amountPaise: 2_000n,
            referenceType: 'BOOKING',
            referenceId: randomUUID(),
            idempotencyKey: `test:${randomUUID()}`,
          }),
        ),
      ]);

      expect(webhookResponse.status).toBe(200);
      expect(await walletBalance(ctx, driver.driverId)).toBe(58_000n);
      const entries = await ctx.prisma.driverWalletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { walletVersion: 'asc' },
      });
      expect(entries.map((e) => Number(e.walletVersion))).toEqual([1, 2, 3]);
      expect(entries.at(-1)?.balanceAfterPaise).toBe(58_000n);
      expect((await reconciliation.findWalletMismatches()).map((m) => m.walletId)).not.toContain(
        wallet.id,
      );
    }
  });
});
