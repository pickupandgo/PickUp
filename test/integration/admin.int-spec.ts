import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WalletLedgerService } from '../../src/wallet/wallet-ledger.service';
import { WalletService } from '../../src/wallet/wallet.service';
import {
  bearer,
  createAdmin,
  createDriver,
  idempotencyKey,
  type TestAdmin,
} from '../helpers/fixtures';
import { startTopUp, walletBalance } from '../helpers/http';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_ADJUSTMENT_MAX_PAISE } from '../helpers/test-config';

describe('Admin wallet operations', () => {
  let ctx: TestContext;
  let admin: TestAdmin;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function driverWallet() {
    const driver = await createDriver(ctx);
    const wallet = await ctx.app.get(WalletService).ensureWalletForDriver(driver.driverId);
    return { driver, walletId: wallet.id };
  }

  function adjust(walletId: string, body: unknown, key = idempotencyKey(), token = admin.token) {
    return request(ctx.server)
      .post(`/v1/admin/wallets/${walletId}/adjustments`)
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send(body as object);
  }

  describe('manual adjustments', () => {
    it('are admin-only', async () => {
      const { driver, walletId } = await driverWallet();
      await adjust(
        walletId,
        { direction: 'CREDIT', amountPaise: 1_000, reason: 'Goodwill credit #1234' },
        undefined,
        driver.token,
      ).expect(403);
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it('record the acting admin and the reason, and replays are no-ops', async () => {
      const { driver, walletId } = await driverWallet();
      const key = idempotencyKey();
      const body = {
        direction: 'CREDIT',
        amountPaise: 25_000,
        reason: '  Support ticket SUP-1042 refund  ',
      };

      const first = await adjust(walletId, body, key).expect(201);
      expect(first.body).toMatchObject({
        replayed: false,
        transaction: {
          type: 'ADJUSTMENT',
          direction: 'CREDIT',
          amountPaise: 25_000,
          balanceAfterPaise: 25_000,
          performedByUserId: admin.userId,
          reason: 'Support ticket SUP-1042 refund',
        },
        wallet: { balancePaise: 25_000 },
      });

      const replay = await adjust(walletId, body, key).expect(201);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.transaction.id).toBe(first.body.transaction.id);
      expect(await walletBalance(ctx, driver.driverId)).toBe(25_000n);
    });

    it('debits can never overdraw a wallet', async () => {
      const { driver, walletId } = await driverWallet();
      const res = await adjust(walletId, {
        direction: 'DEBIT',
        amountPaise: 1,
        reason: 'Correction for INC-77',
      }).expect(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
      expect(await walletBalance(ctx, driver.driverId)).toBe(0n);
    });

    it.each([
      [{ direction: 'CREDIT', amountPaise: 1_000 }],
      [{ direction: 'CREDIT', amountPaise: 1_000, reason: 'too short' }],
      [{ direction: 'SET', amountPaise: 1_000, reason: 'Set balance to 1000' }],
      [{ direction: 'CREDIT', amountPaise: -5, reason: 'Negative amount test' }],
      [{ direction: 'CREDIT', amountPaise: 1_000, reason: 'Valid reason text', balancePaise: 0 }],
    ])('reject invalid input %j', async (body) => {
      const { walletId } = await driverWallet();
      const res = await adjust(walletId, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('are capped by ADMIN_ADJUSTMENT_MAX_PAISE', async () => {
      const { walletId } = await driverWallet();
      const res = await adjust(walletId, {
        direction: 'CREDIT',
        amountPaise: TEST_ADJUSTMENT_MAX_PAISE + 1,
        reason: 'Exceeds the configured cap',
      }).expect(400);
      expect(res.body.error.code).toBe('AMOUNT_OUT_OF_RANGE');
    });

    it('there is no endpoint that sets a balance directly', async () => {
      const { walletId } = await driverWallet();
      for (const method of ['put', 'patch'] as const) {
        await request(ctx.server)
          [method](`/v1/admin/wallets/${walletId}`)
          .set(bearer(admin.token))
          .send({ balancePaise: 1_000_000 })
          .expect(404);
      }
    });
  });

  describe('payment recovery and reports', () => {
    it('sync applies a captured payment that neither the app nor the webhook reported', async () => {
      const driver = await createDriver(ctx);
      const { paymentId, orderId } = await startTopUp(ctx, driver, 35_000);
      const payment = ctx.razorpay.pay(orderId);

      const first = await request(ctx.server)
        .post(`/v1/admin/payments/${paymentId}/sync`)
        .set(bearer(admin.token))
        .expect(200);
      expect(first.body).toMatchObject({
        payment: { status: 'PAID', providerPaymentId: payment.id, userId: driver.userId },
        attempts: [
          { providerPaymentId: payment.id, providerStatus: 'captured', outcome: 'APPLIED' },
        ],
      });

      const second = await request(ctx.server)
        .post(`/v1/admin/payments/${paymentId}/sync`)
        .set(bearer(admin.token))
        .expect(200);
      expect(second.body.attempts[0].outcome).toBe('ALREADY_APPLIED');
      expect(await walletBalance(ctx, driver.driverId)).toBe(35_000n);
    });

    it('lists pending payments for follow-up', async () => {
      const driver = await createDriver(ctx);
      const { paymentId } = await startTopUp(ctx, driver, 5_000);
      const res = await request(ctx.server)
        .get('/v1/admin/reconciliation/pending-payments?olderThanMinutes=0')
        .set(bearer(admin.token))
        .expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).toContain(paymentId);
    });

    it('serves every reconciliation report to admins only', async () => {
      const driver = await createDriver(ctx);
      for (const report of [
        'wallet-mismatches',
        'unprocessed-webhooks',
        'webhook-anomalies',
        'pending-payments',
        'duplicate-provider-payments',
      ]) {
        const ok = await request(ctx.server)
          .get(`/v1/admin/reconciliation/${report}`)
          .set(bearer(admin.token))
          .expect(200);
        expect(Array.isArray(ok.body)).toBe(true);
        await request(ctx.server)
          .get(`/v1/admin/reconciliation/${report}`)
          .set(bearer(driver.token))
          .expect(403);
      }
      const dupes = await request(ctx.server)
        .get('/v1/admin/reconciliation/duplicate-provider-payments')
        .set(bearer(admin.token))
        .expect(200);
      expect(dupes.body).toEqual([]);
    });
  });

  describe('wallet history', () => {
    it('pages newest first by a gap-free sequence', async () => {
      const { driver, walletId } = await driverWallet();
      const ledger = ctx.app.get(WalletLedgerService);
      for (let i = 1; i <= 5; i += 1) {
        await ctx.prisma.runInTransaction((tx) =>
          ledger.postEntry(tx, {
            walletId,
            type: 'ADJUSTMENT',
            direction: 'CREDIT',
            amountPaise: BigInt(i * 100),
            referenceType: 'ADMIN',
            referenceId: admin.userId,
            performedByUserId: admin.userId,
            reason: `History entry ${i}`,
            idempotencyKey: `test:${randomUUID()}`,
          }),
        );
      }

      const sequences: number[] = [];
      let cursor: string | null = null;
      do {
        const page = await request(ctx.server)
          .get('/v1/wallet/transactions')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(bearer(driver.token))
          .expect(200);
        sequences.push(...page.body.items.map((item: { sequence: number }) => item.sequence));
        cursor = page.body.nextCursor as string | null;
      } while (cursor);

      expect(sequences).toEqual([5, 4, 3, 2, 1]);

      const driverView = await request(ctx.server)
        .get('/v1/wallet/transactions')
        .set(bearer(driver.token))
        .expect(200);
      expect(driverView.body.items[0]).not.toHaveProperty('performedByUserId');
      const adminView = await request(ctx.server)
        .get(`/v1/admin/wallets/${walletId}/transactions`)
        .set(bearer(admin.token))
        .expect(200);
      expect(adminView.body.items[0].performedByUserId).toBe(admin.userId);
    });

    it.each(['abc', '0', '-1', '1'.repeat(30)])('rejects the cursor %p', async (cursor) => {
      const { driver } = await driverWallet();
      await request(ctx.server)
        .get('/v1/wallet/transactions')
        .query({ cursor })
        .set(bearer(driver.token))
        .expect(400);
    });
  });
});
