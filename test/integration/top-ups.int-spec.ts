import request from 'supertest';
import { bearer, createDriver, idempotencyKey } from '../helpers/fixtures';
import { startTopUp, topUpCredits, verifyTopUp, walletBalance } from '../helpers/http';
import { checkoutSignature } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_RAZORPAY_KEY_ID, TEST_TOPUP_MAX_PAISE } from '../helpers/test-config';

describe('Wallet top-ups', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(() => {
    ctx.razorpay.unavailable = false;
  });

  function create(token: string, body: unknown, key: string | null = idempotencyKey()) {
    const req = request(ctx.server).post('/v1/wallet/topups').set(bearer(token));
    return (key === null ? req : req.set('Idempotency-Key', key)).send(body as object);
  }

  describe('starting a top-up', () => {
    it('only approved drivers can add money', async () => {
      const driver = await createDriver(ctx, { approved: false });
      const res = await create(driver.token, { amountPaise: 50_000 }).expect(403);
      expect(res.body.error.code).toBe('DRIVER_NOT_APPROVED');
    });

    it('requires a well-formed Idempotency-Key', async () => {
      const driver = await createDriver(ctx);
      expect(
        (await create(driver.token, { amountPaise: 50_000 }, null).expect(400)).body.error.code,
      ).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(
        (await create(driver.token, { amountPaise: 50_000 }, 'short').expect(400)).body.error.code,
      ).toBe('IDEMPOTENCY_KEY_INVALID');
    });

    it.each([
      [{ amountPaise: '50000' }, 'VALIDATION_FAILED'],
      [{ amountPaise: 500.5 }, 'VALIDATION_FAILED'],
      [{ amountPaise: 50_000, walletId: 'x' }, 'VALIDATION_FAILED'],
      [{}, 'VALIDATION_FAILED'],
      [{ amountPaise: 99 }, 'AMOUNT_OUT_OF_RANGE'],
      [{ amountPaise: TEST_TOPUP_MAX_PAISE + 1 }, 'AMOUNT_OUT_OF_RANGE'],
    ])('rejects %j with %s', async (body, code) => {
      const driver = await createDriver(ctx);
      const res = await create(driver.token, body).expect(400);
      expect(res.body.error.code).toBe(code);
    });

    it('creates a pending top-up with the Razorpay Checkout parameters', async () => {
      const driver = await createDriver(ctx);
      const res = await create(driver.token, { amountPaise: 50_000 }).expect(201);

      expect(res.body).toMatchObject({
        status: 'PENDING',
        amountPaise: 50_000,
        currency: 'INR',
        checkout: { keyId: TEST_RAZORPAY_KEY_ID, amountPaise: 50_000, currency: 'INR' },
        providerPaymentId: null,
      });
      const order = ctx.razorpay.orders.get(res.body.checkout.orderId);
      expect(order).toMatchObject({ amount: 50_000, currency: 'INR', receipt: res.body.paymentId });
      expect(JSON.stringify(res.body)).not.toContain('secret');
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it('returns the same top-up when the request is retried with the same key', async () => {
      const driver = await createDriver(ctx);
      const key = idempotencyKey();
      const before = ctx.razorpay.calls.createOrder;
      const first = await create(driver.token, { amountPaise: 20_000 }, key).expect(201);
      const second = await create(driver.token, { amountPaise: 20_000 }, key).expect(201);

      expect(second.body.paymentId).toBe(first.body.paymentId);
      expect(second.body.checkout.orderId).toBe(first.body.checkout.orderId);
      expect(ctx.razorpay.calls.createOrder - before).toBe(1);
    });

    it('concurrent retries with one key create one payment record', async () => {
      const driver = await createDriver(ctx);
      const key = idempotencyKey();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => create(driver.token, { amountPaise: 30_000 }, key)),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);
      expect(new Set(responses.map((r) => r.body.paymentId)).size).toBe(1);
      expect(new Set(responses.map((r) => r.body.checkout.orderId)).size).toBe(1);
      expect(await ctx.prisma.payment.count({ where: { userId: driver.userId } })).toBe(1);
    });

    it('rejects reusing a key for a different amount', async () => {
      const driver = await createDriver(ctx);
      const key = idempotencyKey();
      await create(driver.token, { amountPaise: 10_000 }, key).expect(201);
      const res = await create(driver.token, { amountPaise: 99_000 }, key).expect(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it("recovers the order when Razorpay's response was lost", async () => {
      const driver = await createDriver(ctx);
      const key = idempotencyKey();
      ctx.razorpay.queueCreateOrderBehaviour('lose-response');

      const failed = await create(driver.token, { amountPaise: 40_000 }, key).expect(503);
      expect(failed.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

      const retried = await create(driver.token, { amountPaise: 40_000 }, key).expect(201);
      const ordersForPayment = [...ctx.razorpay.orders.values()].filter(
        (order) => order.receipt === retried.body.paymentId,
      );
      expect(ordersForPayment).toHaveLength(1);
      expect(retried.body.checkout.orderId).toBe(ordersForPayment[0]?.id);
    });

    it('marks the top-up failed when Razorpay rejects the order', async () => {
      const driver = await createDriver(ctx);
      const key = idempotencyKey();
      ctx.razorpay.queueCreateOrderBehaviour('reject');

      const res = await create(driver.token, { amountPaise: 40_000 }, key).expect(502);
      expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
      const payment = await ctx.prisma.payment.findFirstOrThrow({
        where: { userId: driver.userId },
      });
      expect(payment.status).toBe('FAILED');

      await create(driver.token, { amountPaise: 40_000 }, key).expect(502);
      await create(driver.token, { amountPaise: 40_000 }).expect(201);
    });

    it('refuses top-ups into a blocked wallet', async () => {
      const driver = await createDriver(ctx);
      await request(ctx.server).get('/v1/wallet').set(bearer(driver.token)).expect(200);
      await ctx.prisma.driverWallet.update({
        where: { driverId: driver.driverId },
        data: { status: 'BLOCKED' },
      });
      const res = await create(driver.token, { amountPaise: 10_000 }).expect(409);
      expect(res.body.error.code).toBe('WALLET_BLOCKED');
    });
  });

  describe('verifying a payment', () => {
    it('credits the wallet once after Razorpay confirms the payment', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 50_000);
      const payment = ctx.razorpay.pay(orderId);
      const body = {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(orderId, payment.id),
      };

      const first = await verifyTopUp(ctx, driver, paymentId, body).expect(200);
      expect(first.body).toMatchObject({
        providerStatus: 'captured',
        payment: {
          status: 'PAID',
          providerPaymentId: payment.id,
          paymentMethod: 'UPI',
          checkout: null,
        },
        wallet: { balancePaise: 50_000 },
      });

      const again = await verifyTopUp(ctx, driver, paymentId, body).expect(200);
      expect(again.body.payment.status).toBe('PAID');
      expect(await walletBalance(ctx, driver.driverId)).toBe(50_000n);
      expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
    });

    it('rejects a forged signature and credits nothing', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 50_000);
      const payment = ctx.razorpay.pay(orderId);

      const res = await verifyTopUp(ctx, driver, paymentId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(orderId, payment.id, 'attacker-guessed-secret'),
      }).expect(400);
      expect(res.body.error.code).toBe('INVALID_PAYMENT_SIGNATURE');
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it("never trusts the app's success callback without Razorpay's confirmation", async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 50_000);
      const failed = ctx.razorpay.pay(orderId, { status: 'failed' });

      const res = await verifyTopUp(ctx, driver, paymentId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: failed.id,
        razorpaySignature: checkoutSignature(orderId, failed.id),
      }).expect(200);
      expect(res.body).toMatchObject({
        providerStatus: 'failed',
        payment: { status: 'PENDING' },
        wallet: null,
      });
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it('rejects a payment that belongs to a different order', async () => {
      const driver = await createDriver(ctx);
      const first = await startTopUp(ctx, driver, 10_000);
      const second = await startTopUp(ctx, driver, 20_000);
      const payment = ctx.razorpay.pay(second.orderId);

      const res = await verifyTopUp(ctx, driver, first.paymentId, {
        razorpayOrderId: second.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(second.orderId, payment.id),
      }).expect(400);
      expect(res.body.error.code).toBe('PAYMENT_ORDER_MISMATCH');
    });

    it('captures authorized payments on the server before crediting', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 25_000);
      const payment = ctx.razorpay.pay(orderId, { status: 'authorized' });

      await verifyTopUp(ctx, driver, paymentId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(orderId, payment.id),
      }).expect(200);
      expect(ctx.razorpay.payments.get(payment.id)?.status).toBe('captured');
      expect(await walletBalance(ctx, driver.driverId)).toBe(25_000n);
    });

    it('#6 a provider amount mismatch never credits the wallet', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 50_000);
      const underpaid = ctx.razorpay.pay(orderId, { amount: 100 });

      const res = await verifyTopUp(ctx, driver, paymentId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: underpaid.id,
        razorpaySignature: checkoutSignature(orderId, underpaid.id),
      }).expect(409);
      expect(res.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
      const stored = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(stored.status).toBe('PENDING');
    });

    it("drivers cannot read or verify another driver's top-up", async () => {
      const owner = await createDriver(ctx);
      const intruder = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, owner, 10_000);
      const payment = ctx.razorpay.pay(orderId);

      const read = await request(ctx.server)
        .get(`/v1/wallet/topups/${paymentId}`)
        .set(bearer(intruder.token))
        .expect(404);
      expect(read.body.error.code).toBe('PAYMENT_NOT_FOUND');
      await verifyTopUp(ctx, intruder, paymentId, {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(orderId, payment.id),
      }).expect(404);
      expect(await walletBalance(ctx, intruder.driverId)).toBe(0n);
      expect(await walletBalance(ctx, owner.driverId)).toBe(0n);
    });

    it('reports Razorpay outages as retryable and succeeds on retry', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 15_000);
      const payment = ctx.razorpay.pay(orderId);
      const body = {
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(orderId, payment.id),
      };

      ctx.razorpay.unavailable = true;
      const down = await verifyTopUp(ctx, driver, paymentId, body).expect(503);
      expect(down.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

      ctx.razorpay.unavailable = false;
      await verifyTopUp(ctx, driver, paymentId, body).expect(200);
      expect(await walletBalance(ctx, driver.driverId)).toBe(15_000n);
    });

    it('shows a top-up to its owner', async () => {
      const driver = await createDriver(ctx);
      const { paymentId } = await startTopUp(ctx, driver, 12_300);
      const res = await request(ctx.server)
        .get(`/v1/wallet/topups/${paymentId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(res.body).toMatchObject({ paymentId, status: 'PENDING', amountPaise: 12_300 });
    });
  });
});
