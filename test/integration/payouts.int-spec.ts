import request from 'supertest';
import * as audit from '../../src/audit/admin-actions';
import { isoWeekKey, nextScheduledRun, zonedParts } from '../../src/payouts/payout-schedule';
import { PayoutSchedulerService } from '../../src/payouts/payout-scheduler.service';
import { EarningsReconciliationService } from '../../src/reconciliation/earnings-reconciliation.service';
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
  sendPayoutWebhook,
  setTripStatus,
  settleAndSync,
  startBookingPayment,
  TO_DELIVERED,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook } from '../helpers/http';
import {
  buildPayoutWebhook,
  buildValidationWebhook,
  buildWebhook,
  checkoutSignature,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

const IST = 'Asia/Kolkata';

/**
 * Weekly driver payouts (V1 rules 2 and 8, OPEN_DECISIONS D-45/D-48/D-49): settled driver
 * earnings -> Monday payout batch -> RazorpayX -> validated, admin-approved bank account.
 * Required tests #12-#18.
 */
describe('Driver payouts', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let category: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    admins = await Promise.all(Array.from({ length: 10 }, () => createAdmin(ctx)));
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** A completed prepaid trip whose customer payment is captured but not settled yet. */
  async function completedPrepaidTrip(driver: TestDriver, farePaise = 50_000) {
    const customer = await createCustomer(ctx);
    const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise,
      category,
    });
    const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
    const payment = ctx.razorpay.pay(started.body.checkout.orderId as string);
    await sendWebhook(ctx, buildWebhook('payment.captured', payment)).expect(200);
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
    return { bookingId, tripId, earning, providerPaymentId: payment.id };
  }

  /** ... and then settled by Razorpay: the driver has one PAYABLE earning (net 90%). */
  async function payableEarning(driver: TestDriver, farePaise = 50_000) {
    const trip = await completedPrepaidTrip(driver, farePaise);
    expect(trip.earning.status).toBe('AWAITING_SETTLEMENT');
    await settleAndSync(ctx, trip.providerPaymentId, farePaise);
    const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
      where: { id: trip.earning.id },
    });
    expect(earning.status).toBe('PAYABLE');
    return { ...trip, earning };
  }

  async function driverWithBank(): Promise<TestDriver> {
    const driver = await createDriver(ctx);
    await createVerifiedBankAccount(ctx.prisma, driver.driverId, admin.userId);
    return driver;
  }

  // Batch preparation and execution are rate limited per admin (5/min), so the suite spreads its
  // calls over several admin accounts.
  let admins: TestAdmin[] = [];
  let calls = 0;
  function nextAdmin(): TestAdmin {
    const actor = admins[Math.floor(calls / 4) % admins.length];
    calls += 1;
    if (!actor) {
      throw new Error('admin pool is empty');
    }
    return actor;
  }

  /** Repeats of one key must come from the same admin: the key is scoped per admin. */
  function prepare(key: string = idempotencyKey(), as: TestAdmin = nextAdmin()) {
    return request(ctx.server)
      .post('/v1/admin/payout-batches')
      .set(bearer(as.token))
      .set('Idempotency-Key', key)
      .send({});
  }

  function execute(batchId: string) {
    return request(ctx.server)
      .post(`/v1/admin/payout-batches/${batchId}/execute`)
      .set(bearer(nextAdmin().token))
      .send();
  }

  const payoutOf = (driverId: string, batchId: string) =>
    ctx.prisma.driverPayout.findUniqueOrThrow({
      where: { batchId_driverId: { batchId, driverId } },
    });
  const earningOf = (id: string) => ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id } });
  const liveItems = (earningId: string) =>
    ctx.prisma.payoutItem.findMany({ where: { earningId, status: { in: ['INCLUDED', 'PAID'] } } });
  const accountOf = (driverId: string) =>
    ctx.prisma.driverBankAccount.findFirstOrThrow({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });

  /** Prepares and executes a batch; returns this driver's payout and its provider payout. */
  async function paidOutToProvider(driver: TestDriver) {
    const batch = await prepare().expect(201);
    const batchId = batch.body.batch.batchId as string;
    await execute(batchId).expect(200);
    const payout = await payoutOf(driver.driverId, batchId);
    const provider = ctx.payouts.byReference(payout.id);
    if (!provider) {
      throw new Error('expected a provider payout');
    }
    return { batchId, payout, provider };
  }

  /** The bank answers the account's latest validation, delivered by the signed webhook. */
  async function bankAnswers(
    bankAccountId: string,
    result: { accountStatus: 'active' | 'invalid'; registeredName: string | null },
  ) {
    const validation = await ctx.prisma.bankAccountVerification.findFirstOrThrow({
      where: { bankAccountId },
      orderBy: { createdAt: 'desc' },
    });
    const completed = ctx.payouts.completeValidation(validation.providerValidationId, result);
    await sendPayoutWebhook(
      ctx,
      buildValidationWebhook('fund_account.validation.completed', completed),
    ).expect(200);
    return ctx.prisma.bankAccountVerification.findUniqueOrThrow({ where: { id: validation.id } });
  }

  function submitBankAccount(driver: TestDriver, accountNumber: string, holder = 'Test Driver') {
    return request(ctx.server).post('/v1/bank-account').set(bearer(driver.token)).send({
      accountHolderName: holder,
      ifsc: 'hdfc0001234',
      accountNumber,
      confirmAccountNumber: accountNumber,
    });
  }

  function approve(bankAccountId: string, body: Record<string, string> = {}) {
    return request(ctx.server)
      .post(`/v1/admin/bank-accounts/${bankAccountId}/approve`)
      .set(bearer(admin.token))
      .send(body);
  }

  it('#12 the same earning never lands in two batches, even when batches are prepared concurrently', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);

    const [first, second] = await Promise.all([prepare(), prepare()]);
    expect([first.status, second.status]).toEqual([201, 201]);

    const items = await ctx.prisma.payoutItem.findMany({ where: { earningId: earning.id } });
    expect(items).toHaveLength(1);
    expect((await earningOf(earning.id)).status).toBe('IN_PAYOUT');
    // The database refuses a second live item for the earning outright.
    const [item] = items;
    if (!item) {
      throw new Error('expected an item');
    }
    await expect(
      ctx.prisma.payoutItem.create({
        data: {
          payoutId: item.payoutId,
          earningId: earning.id,
          amountPaise: earning.netAmountPaise,
        },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it('never pays out an earning whose customer payment is not settled yet', async () => {
    const driver = await driverWithBank();
    const { earning, providerPaymentId } = await completedPrepaidTrip(driver);
    expect(earning).toMatchObject({
      status: 'AWAITING_SETTLEMENT',
      payableAt: null,
      paymentSettlementId: null,
    });

    const batch = await prepare().expect(201);
    expect(
      await ctx.prisma.driverPayout.count({
        where: { batchId: batch.body.batch.batchId as string, driverId: driver.driverId },
      }),
    ).toBe(0);
    expect(await liveItems(earning.id)).toHaveLength(0);
    // Even forced through SQL, the database refuses a payable earning without a settlement.
    await expect(
      ctx.prisma.$executeRaw`
        UPDATE driver_earnings SET status = 'PAYABLE', payable_at = now() WHERE id = ${earning.id}::uuid`,
    ).rejects.toThrow(/earnings_online_settled_before_payable/);

    await settleAndSync(ctx, providerPaymentId, 50_000);
    const settled = await earningOf(earning.id);
    expect(settled.status).toBe('PAYABLE');
    expect(settled.paymentSettlementId).not.toBeNull();
    const next = await prepare().expect(201);
    const payout = await payoutOf(driver.driverId, next.body.batch.batchId as string);
    expect(payout).toMatchObject({
      grossAmountPaise: 45_000n,
      tdsAmountPaise: 0n,
      otherDeductionsPaise: 0n,
      tdsPolicy: 'DISABLED',
      amountPaise: 45_000n,
    });
  });

  it('#13 a payout is created once: same Idempotency-Key, repeated and concurrent execution', async () => {
    const driver = await driverWithBank();
    await payableEarning(driver);
    const key = idempotencyKey();

    const actor = nextAdmin();
    const first = await prepare(key, actor).expect(201);
    const repeat = await prepare(key, actor).expect(200);
    expect(repeat.body).toMatchObject({
      created: false,
      batch: { batchId: first.body.batch.batchId },
    });

    const batchId = first.body.batch.batchId as string;
    const before = ctx.payouts.calls.createPayout;
    await Promise.all([execute(batchId), execute(batchId), execute(batchId)]);
    await execute(batchId).expect(200);

    const payout = await payoutOf(driver.driverId, batchId);
    const atProvider = [...ctx.payouts.payouts.values()].filter((p) => p.referenceId === payout.id);
    expect(atProvider).toHaveLength(1);
    expect(payout).toMatchObject({ status: 'SUBMITTED', providerPayoutId: atProvider[0]?.id });
    expect(ctx.payouts.calls.createPayout - before).toBeGreaterThanOrEqual(1);
  });

  it('#13 a lost provider response is recovered without a second transfer', async () => {
    const driver = await driverWithBank();
    await payableEarning(driver);
    const batch = await prepare().expect(201);
    const batchId = batch.body.batch.batchId as string;

    ctx.payouts.queueCreatePayoutBehaviour('lose-response');
    await execute(batchId).expect(200);
    const payout = await payoutOf(driver.driverId, batchId);
    expect(payout.status).toBe('SUBMITTING');

    const synced = await request(ctx.server)
      .post(`/v1/admin/payouts/${payout.id}/sync`)
      .set(bearer(admin.token))
      .expect(200);
    expect(synced.body.payout).toMatchObject({ status: 'SUBMITTED' });
    expect(
      [...ctx.payouts.payouts.values()].filter((p) => p.referenceId === payout.id),
    ).toHaveLength(1);
  });

  it('#14 a failed payout never marks the earning paid, and the earning is retried with a new payout', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);
    const { payout, provider } = await paidOutToProvider(driver);

    const failed = ctx.payouts.setStatus(provider.id, 'failed', {
      failureReason: 'Beneficiary bank was offline',
    });
    await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.failed', failed)).expect(200);

    expect(
      await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } }),
    ).toMatchObject({
      status: 'FAILED',
      failureReason: 'Beneficiary bank was offline',
    });
    const released = await earningOf(earning.id);
    expect(released).toMatchObject({ status: 'PAYABLE', paidAt: null });
    expect(
      (await ctx.prisma.payoutItem.findFirstOrThrow({ where: { payoutId: payout.id } })).status,
    ).toBe('RELEASED');

    const retry = await paidOutToProvider(driver);
    expect(retry.payout.id).not.toBe(payout.id);
    expect(retry.provider.id).not.toBe(provider.id);
    expect((await liveItems(earning.id)).map((i) => i.payoutId)).toEqual([retry.payout.id]);
  });

  it('#14 a definitive provider rejection fails the payout and releases its earnings', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);
    const batch = await prepare().expect(201);
    ctx.payouts.queueCreatePayoutBehaviour('reject');
    await execute(batch.body.batch.batchId as string).expect(200);

    const payout = await payoutOf(driver.driverId, batch.body.batch.batchId as string);
    expect(payout).toMatchObject({
      status: 'FAILED',
      failureReason: 'PROVIDER_REJECTED:BAD_REQUEST_ERROR',
    });
    expect((await earningOf(earning.id)).status).toBe('PAYABLE');
  });

  it('#14 a bank account suspended after preparation is never paid', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);
    const batch = await prepare().expect(201);
    const account = await accountOf(driver.driverId);
    await request(ctx.server)
      .post(`/v1/admin/bank-accounts/${account.id}/suspend`)
      .set(bearer(admin.token))
      .send({ reason: 'Driver reported the account closed' })
      .expect(200);

    const calls = ctx.payouts.calls.createPayout;
    await execute(batch.body.batch.batchId as string).expect(200);
    const payout = await payoutOf(driver.driverId, batch.body.batch.batchId as string);
    expect(payout).toMatchObject({ status: 'FAILED', failureReason: 'BANK_ACCOUNT_NOT_VERIFIED' });
    expect(ctx.payouts.byReference(payout.id)).toBeUndefined();
    expect(ctx.payouts.calls.createPayout).toBeGreaterThanOrEqual(calls);
    expect((await earningOf(earning.id)).status).toBe('PAYABLE');
    // The database refuses a payout to an account that is not VERIFIED.
    await expect(
      ctx.prisma.driverPayout.create({
        data: {
          batchId: batch.body.batch.batchId as string,
          driverId: driver.driverId,
          bankAccountId: account.id,
          grossAmountPaise: 45_000n,
          amountPaise: 45_000n,
          mode: 'IMPS',
          provider: 'RAZORPAYX',
        },
      }),
    ).rejects.toThrow();
  });

  it('#15 a processed payout marks its earnings paid exactly once', async () => {
    const driver = await driverWithBank();
    const first = await payableEarning(driver, 50_000);
    const second = await payableEarning(driver, 30_000);
    const { payout, provider, batchId } = await paidOutToProvider(driver);
    expect(payout.amountPaise).toBe(45_000n + 27_000n);
    expect(payout.grossAmountPaise).toBe(45_000n + 27_000n);

    const processed = ctx.payouts.setStatus(provider.id, 'processed', { utr: 'UTR123456789' });
    await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);

    const done = await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(done).toMatchObject({ status: 'PROCESSED', utr: 'UTR123456789' });
    const paid = await Promise.all([earningOf(first.earning.id), earningOf(second.earning.id)]);
    expect(paid.map((e) => e.status)).toEqual(['PAID', 'PAID']);
    const paidAt = paid.map((e) => e.paidAt?.getTime());

    // A second processed event and an admin sync change nothing.
    await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);
    await request(ctx.server)
      .post(`/v1/admin/payouts/${payout.id}/sync`)
      .set(bearer(admin.token))
      .expect(200);
    const after = await Promise.all([earningOf(first.earning.id), earningOf(second.earning.id)]);
    expect(after.map((e) => e.paidAt?.getTime())).toEqual(paidAt);
    expect(
      (await ctx.prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).not.toBe('PREPARED');
  });

  it('#16 a repeated payout webhook is processed once, and older states never roll it back', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);
    const { payout, provider } = await paidOutToProvider(driver);
    const processed = ctx.payouts.setStatus(provider.id, 'processed', { utr: 'UTR555' });
    const webhook = buildPayoutWebhook('payout.processed', processed);

    for (let i = 0; i < 3; i += 1) {
      await sendPayoutWebhook(ctx, webhook).expect(200);
    }
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => sendPayoutWebhook(ctx, webhook)),
    );
    expect(concurrent.map((r) => r.status)).toEqual(Array.from({ length: 8 }, () => 200));

    expect(await ctx.prisma.payoutEvent.count({ where: { eventId: webhook.eventId } })).toBe(1);
    expect(
      await ctx.prisma.payoutEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
    ).toMatchObject({ outcome: 'APPLIED', payoutId: payout.id });

    const stale = buildPayoutWebhook('payout.initiated', { ...processed, status: 'processing' });
    await sendPayoutWebhook(ctx, stale).expect(200);
    expect(
      await ctx.prisma.payoutEvent.findUniqueOrThrow({ where: { eventId: stale.eventId } }),
    ).toMatchObject({ outcome: 'STALE_UPDATE' });
    expect(
      (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
    ).toBe('PROCESSED');
    expect((await earningOf(earning.id)).status).toBe('PAID');
  });

  it('rejects payout webhooks with an invalid signature and stores nothing', async () => {
    const driver = await driverWithBank();
    await payableEarning(driver);
    const { provider } = await paidOutToProvider(driver);
    const webhook = buildPayoutWebhook(
      'payout.processed',
      ctx.payouts.setStatus(provider.id, 'processed'),
      {
        secret: 'attacker_secret_value_0123456789abcdef',
      },
    );
    await sendPayoutWebhook(ctx, webhook).expect(400);
    expect(await ctx.prisma.payoutEvent.count({ where: { eventId: webhook.eventId } })).toBe(0);
  });

  it('#17 a crash inside the payout transaction rolls everything back', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);

    // (a) Preparing a batch fails at its last step: no batch, payout or item survives.
    const key = idempotencyKey();
    const spy = jest
      .spyOn(audit, 'recordAdminAction')
      .mockRejectedValueOnce(new Error('simulated crash before commit'));
    try {
      await prepare(key).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await ctx.prisma.payoutBatch.count({ where: { idempotencyKey: { endsWith: `:${key}` } } }),
    ).toBe(0);
    expect(await ctx.prisma.payoutItem.count({ where: { earningId: earning.id } })).toBe(0);
    expect((await earningOf(earning.id)).status).toBe('PAYABLE');

    // (b) Applying "processed" fails after every update but before COMMIT: nothing is paid.
    const { payout, provider } = await paidOutToProvider(driver);
    const processed = ctx.payouts.setStatus(provider.id, 'processed', { utr: 'UTR777' });
    const webhook = buildPayoutWebhook('payout.processed', processed);
    const original = ctx.prisma.runInTransaction.bind(ctx.prisma);
    const crash = jest
      .spyOn(ctx.prisma, 'runInTransaction')
      .mockImplementationOnce((work, options) =>
        original(async (tx) => {
          await work(tx);
          throw new Error('simulated crash before commit');
        }, options),
      );
    try {
      await sendPayoutWebhook(ctx, webhook).expect(503);
    } finally {
      crash.mockRestore();
    }
    expect(
      (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
    ).toBe('SUBMITTED');
    expect((await earningOf(earning.id)).status).toBe('IN_PAYOUT');
    expect(
      (await ctx.prisma.payoutItem.findFirstOrThrow({ where: { payoutId: payout.id } })).status,
    ).toBe('INCLUDED');

    // Razorpay retries the webhook: applied once.
    await sendPayoutWebhook(ctx, webhook).expect(200);
    expect((await earningOf(earning.id)).status).toBe('PAID');
  });

  it('a reversed payout holds its earnings and suspends the account until an admin re-verifies it', async () => {
    const driver = await driverWithBank();
    const { earning } = await payableEarning(driver);
    const { payout, provider } = await paidOutToProvider(driver);
    await sendPayoutWebhook(
      ctx,
      buildPayoutWebhook('payout.processed', ctx.payouts.setStatus(provider.id, 'processed')),
    ).expect(200);
    await sendPayoutWebhook(
      ctx,
      buildPayoutWebhook('payout.reversed', ctx.payouts.setStatus(provider.id, 'reversed')),
    ).expect(200);

    expect(
      (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
    ).toBe('REVERSED');
    const held = await earningOf(earning.id);
    expect(held.status).toBe('ON_HOLD');
    expect(held.holdReason).toMatch(/PAYOUT_REVERSED/);
    const account = await accountOf(driver.driverId);
    expect(account).toMatchObject({ status: 'SUSPENDED' });
    expect(account.statusReason).toMatch(/^PAYOUT_REVERSED/);
    const findings = await ctx.app.get(EarningsReconciliationService).findPayoutMismatches();
    expect(findings.filter((f) => f.payoutId === payout.id).map((f) => f.problem)).toEqual([
      'REVERSED',
    ]);

    // Released after review, the earning is payable again but nothing goes to the suspended
    // account: no silent retry.
    await request(ctx.server)
      .post(`/v1/admin/earnings/${earning.id}/release`)
      .set(bearer(admin.token))
      .send({ reason: 'Bank confirmed the return; driver account to be re-checked' })
      .expect(200);
    expect((await earningOf(earning.id)).status).toBe('PAYABLE');
    const blocked = await prepare().expect(201);
    expect(
      await ctx.prisma.driverPayout.count({
        where: { batchId: blocked.body.batch.batchId as string, driverId: driver.driverId },
      }),
    ).toBe(0);

    // Reinstating needs a new bank validation, started after the suspension.
    const stale = await approve(account.id).expect(409);
    expect(stale.body.error.code).toBe('BANK_VALIDATION_NOT_ACCEPTABLE');
    await request(ctx.server)
      .post(`/v1/admin/bank-accounts/${account.id}/validations`)
      .set(bearer(admin.token))
      .send()
      .expect(201);
    await bankAnswers(account.id, { accountStatus: 'active', registeredName: 'TEST DRIVER' });
    const reinstated = await approve(account.id).expect(200);
    expect(reinstated.body).toMatchObject({ status: 'VERIFIED', payoutsEnabled: true });
    const retried = await prepare().expect(201);
    const retry = await payoutOf(driver.driverId, retried.body.batch.batchId as string);
    expect(retry.id).not.toBe(payout.id);
    expect((await liveItems(earning.id)).map((i) => i.payoutId)).toEqual([retry.id]);
  });

  describe('bank accounts', () => {
    it('validates with the bank, needs admin approval, and stores only the last 4 digits', async () => {
      const driver = await createDriver(ctx, { legalName: 'Ramesh Kumar' });
      const { earning } = await payableEarning(driver);

      const mismatch = await request(ctx.server)
        .post('/v1/bank-account')
        .set(bearer(driver.token))
        .send({
          accountHolderName: 'Ramesh Kumar',
          ifsc: 'hdfc0001234',
          accountNumber: '123456789012',
          confirmAccountNumber: '123456789013',
        })
        .expect(400);
      expect(mismatch.body.error.code).toBe('VALIDATION_FAILED');

      const created = await submitBankAccount(driver, '123456789012', 'Ramesh Kumar').expect(201);
      expect(created.body).toMatchObject({
        status: 'PENDING_VERIFICATION',
        payoutsEnabled: false,
        validationStatus: 'IN_PROGRESS',
        ifsc: 'HDFC0001234',
        accountNumberLast4: '9012',
      });
      const bankAccountId = created.body.bankAccountId as string;
      expect(JSON.stringify(created.body)).not.toContain('123456789012');
      const row = await ctx.prisma.driverBankAccount.findUniqueOrThrow({
        where: { id: bankAccountId },
      });
      expect(JSON.stringify(row)).not.toContain('123456789012');

      // A second submission while one is pending is refused.
      const duplicate = await submitBankAccount(driver, '999956789012', 'Ramesh Kumar').expect(409);
      expect(duplicate.body.error.code).toBe('BANK_ACCOUNT_CHANGE_PENDING');

      // Not approved yet (validation still running): the earning is not paid out.
      const early = await approve(bankAccountId).expect(409);
      expect(early.body.error.code).toBe('BANK_VALIDATION_NOT_ACCEPTABLE');
      const unverifiedBatch = await prepare().expect(201);
      expect(
        await ctx.prisma.driverPayout.count({
          where: {
            batchId: unverifiedBatch.body.batch.batchId as string,
            driverId: driver.driverId,
          },
        }),
      ).toBe(0);
      expect((await earningOf(earning.id)).status).toBe('PAYABLE');

      // The bank reports an active account with an initial instead of the first name.
      const validation = await bankAnswers(bankAccountId, {
        accountStatus: 'active',
        registeredName: 'R KUMAR',
      });
      expect(validation).toMatchObject({
        status: 'COMPLETED',
        accountStatus: 'ACTIVE',
        registeredName: 'R KUMAR',
        nameMatchResult: 'PARTIAL',
        comparedName: 'Ramesh Kumar',
      });
      // The driver never sees the bank's registered name.
      const pending = await request(ctx.server)
        .get('/v1/bank-account')
        .set(bearer(driver.token))
        .expect(200);
      expect(pending.body).toMatchObject({ validationStatus: 'COMPLETED' });
      expect(JSON.stringify(pending.body)).not.toContain('R KUMAR');

      // Not an exact KYC match: the admin must record a resolution.
      const unresolved = await approve(bankAccountId).expect(409);
      expect(unresolved.body.error).toMatchObject({
        code: 'BANK_NAME_MISMATCH_UNRESOLVED',
        details: { nameMatchResult: 'PARTIAL', registeredName: 'R KUMAR' },
      });
      const approved = await approve(bankAccountId, {
        mismatchResolution: 'Bank records initials only; PAN card checked, ticket 42',
      }).expect(200);
      expect(approved.body).toMatchObject({
        status: 'VERIFIED',
        approvedVerificationId: validation.id,
        verificationReference: validation.providerValidationId,
        driverLegalName: 'Ramesh Kumar',
      });
      expect(approved.body.validations[0]).toMatchObject({ nameMatchResult: 'PARTIAL' });
      const action = await ctx.prisma.adminAction.findFirstOrThrow({
        where: { action: 'BANK_ACCOUNT_APPROVED', targetId: bankAccountId },
      });
      expect(action.reason).toMatch(/PAN card checked/);

      const verifiedBatch = await prepare().expect(201);
      const payout = await payoutOf(driver.driverId, verifiedBatch.body.batch.batchId as string);
      expect(payout).toMatchObject({ amountPaise: 45_000n, bankAccountId });

      const mine = await request(ctx.server)
        .get('/v1/bank-account')
        .set(bearer(driver.token))
        .expect(200);
      expect(mine.body).toMatchObject({
        status: 'VERIFIED',
        payoutsEnabled: true,
        accountNumberLast4: '9012',
      });
    });

    it('never approves an invalid account or one whose validation failed', async () => {
      const driver = await createDriver(ctx);
      const created = await submitBankAccount(driver, '555566667777').expect(201);
      const bankAccountId = created.body.bankAccountId as string;
      await bankAnswers(bankAccountId, { accountStatus: 'invalid', registeredName: null });
      const refused = await approve(bankAccountId, {
        mismatchResolution: 'Trying to approve anyway for the test',
      }).expect(409);
      expect(refused.body.error.code).toBe('BANK_VALIDATION_NOT_ACCEPTABLE');
      // Even forced through SQL, the database refuses the approval.
      const validation = await ctx.prisma.bankAccountVerification.findFirstOrThrow({
        where: { bankAccountId },
      });
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE driver_bank_accounts
          SET status = 'VERIFIED', verified_at = now(), verified_by_user_id = ${admin.userId}::uuid,
              verification_reference = 'forced', approved_verification_id = ${validation.id}::uuid,
              name_match_resolution = 'forced'
          WHERE id = ${bankAccountId}::uuid`,
      ).rejects.toThrow(/completed, active bank validation/);
      await request(ctx.server)
        .post(`/v1/admin/bank-accounts/${bankAccountId}/reject`)
        .set(bearer(admin.token))
        .send({ reason: 'Bank reports the account as invalid' })
        .expect(200);
      expect((await accountOf(driver.driverId)).status).toBe('REJECTED');
    });

    it('a new bank account suspends the old one at once and pays nothing until approved', async () => {
      const driver = await driverWithBank();
      const old = await accountOf(driver.driverId);
      const { earning } = await payableEarning(driver);

      const created = await submitBankAccount(driver, '222233334444').expect(201);
      const replaced = await ctx.prisma.driverBankAccount.findUniqueOrThrow({
        where: { id: old.id },
      });
      expect(replaced.status).toBe('SUSPENDED');
      expect(replaced.statusReason).toMatch(/^REPLACED_BY_NEW_ACCOUNT/);

      // During the change nothing is paid: the old account is suspended, the new one pending.
      const during = await prepare().expect(201);
      expect(
        await ctx.prisma.driverPayout.count({
          where: { batchId: during.body.batch.batchId as string, driverId: driver.driverId },
        }),
      ).toBe(0);
      // The replaced account can never come back.
      const reinstate = await approve(old.id).expect(409);
      expect(reinstate.body.error.code).toBe('BANK_ACCOUNT_INVALID_STATE');

      const newId = created.body.bankAccountId as string;
      await bankAnswers(newId, { accountStatus: 'active', registeredName: 'MR TEST DRIVER' });
      await approve(newId).expect(200);
      const after = await prepare().expect(201);
      const payout = await payoutOf(driver.driverId, after.body.batch.batchId as string);
      expect(payout.bankAccountId).toBe(newId);
      expect((await liveItems(earning.id)).map((i) => i.payoutId)).toEqual([payout.id]);
    });

    it('needs the driver KYC name before any approval', async () => {
      const driver = await createDriver(ctx, { legalName: null });
      const created = await submitBankAccount(driver, '888899990000').expect(201);
      const bankAccountId = created.body.bankAccountId as string;
      const validation = await bankAnswers(bankAccountId, {
        accountStatus: 'active',
        registeredName: 'TEST DRIVER',
      });
      expect(validation.nameMatchResult).toBe('UNAVAILABLE');
      const refused = await approve(bankAccountId).expect(409);
      expect(refused.body.error.code).toBe('DRIVER_KYC_NAME_MISSING');
    });

    it('rejects bad bank details reported by the provider', async () => {
      const driver = await createDriver(ctx);
      const res = await request(ctx.server)
        .post('/v1/bank-account')
        .set(bearer(driver.token))
        .send({
          accountHolderName: 'Ramesh Kumar',
          ifsc: 'FAKE0000000',
          accountNumber: '123456789012',
          confirmAccountNumber: '123456789012',
        })
        .expect(422);
      expect(res.body.error.code).toBe('BANK_ACCOUNT_REJECTED_BY_PROVIDER');
    });
  });

  it('#18 full reconciliation: booking -> payment -> settlement -> earning -> payout -> bank', async () => {
    const driver = await createDriver(ctx, { legalName: 'Suresh Singh' });
    const customer = await createCustomer(ctx);

    // Booking confirmed at Rs 500 and assigned.
    const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 50_000,
      category,
    });
    // Customer pays Nikhil Enterprises through Razorpay Checkout; the backend verifies it.
    const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
    const orderId = started.body.checkout.orderId as string;
    const payment = ctx.razorpay.pay(orderId);
    await verifyBookingPayment(ctx, customer, bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id),
    }).expect(200);
    // Razorpay settles the payment before the trip completes.
    const sync = await settleAndSync(ctx, payment.id, 50_000);
    expect(sync).toMatchObject({ recorded: 1, earningsPromoted: 0 });
    // Trip delivered and completed: the earning starts PAYABLE, created once.
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    expect(await ctx.prisma.driverEarning.count({ where: { bookingId } })).toBe(1);
    expect(
      (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } })).status,
    ).toBe('PAYABLE');
    // Driver links a bank account; the bank validates it; an admin approves it.
    const account = await submitBankAccount(driver, '000011112222', 'Suresh Singh').expect(201);
    await bankAnswers(account.body.bankAccountId as string, {
      accountStatus: 'active',
      registeredName: 'SURESH SINGH',
    });
    await approve(account.body.bankAccountId as string).expect(200);
    // Weekly payout: prepared, executed, processed by RazorpayX.
    const { batchId, payout, provider } = await paidOutToProvider(driver);
    await sendPayoutWebhook(
      ctx,
      buildPayoutWebhook(
        'payout.processed',
        ctx.payouts.setStatus(provider.id, 'processed', { utr: 'UTR9876543210' }),
      ),
    ).expect(200);

    const chain = await request(ctx.server)
      .get(`/v1/admin/bookings/${bookingId}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(chain.body.booking).toMatchObject({
      paymentMethod: 'PREPAID_UPI',
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      confirmedFarePaise: 50_000,
      finalFarePaise: 50_000,
    });
    expect(chain.body.feeRule).toMatchObject({ ruleType: 'PERCENTAGE', value: '10.0000' });
    expect(chain.body.customerPayments).toEqual([
      expect.objectContaining({
        status: 'PAID',
        amountPaise: 50_000,
        razorpayPaymentId: payment.id,
      }),
    ]);
    expect(chain.body.merchantSettlement).toMatchObject({
      providerPaymentId: payment.id,
      amountPaise: 50_000,
    });
    expect(chain.body.earning).toMatchObject({
      settlement: 'ONLINE',
      status: 'PAID',
      paidOut: true,
      merchantSettled: true,
      grossAmountPaise: 50_000,
      platformFeePaise: 5_000,
      otherDeductionsPaise: 0,
      tdsAmountPaise: 0,
      tdsPolicy: 'DISABLED',
      netAmountPaise: 45_000,
      currentPayoutId: payout.id,
    });
    expect(chain.body.earning.payableAt).not.toBeNull();
    expect(chain.body.earning.payoutHistory).toEqual([
      expect.objectContaining({
        payoutId: payout.id,
        batchId,
        payoutStatus: 'PROCESSED',
        payoutItemStatus: 'PAID',
        providerPayoutId: provider.id,
        utr: 'UTR9876543210',
      }),
    ]);

    // The driver sees the payout and the trip it paid for.
    const mine = await request(ctx.server).get('/v1/payouts').set(bearer(driver.token)).expect(200);
    expect(mine.body).toEqual([
      expect.objectContaining({
        payoutId: payout.id,
        status: 'PROCESSED',
        grossAmountPaise: 45_000,
        tdsAmountPaise: 0,
        amountPaise: 45_000,
        utr: 'UTR9876543210',
        bankAccountLast4: '2222',
        items: [
          expect.objectContaining({ earningId: chain.body.earning.earningId, status: 'PAID' }),
        ],
      }),
    ]);

    // Every reconciliation report is clean for this chain.
    const recon = ctx.app.get(EarningsReconciliationService);
    const findings = [
      ...(await recon.findEarningMismatches()),
      ...(await recon.findPayoutMismatches()),
      ...(await recon.findCashFeeMismatches()),
      ...(await recon.findPaidCancelledBookings()),
    ];
    expect(findings.filter((f) => f.bookingId === bookingId || f.payoutId === payout.id)).toEqual(
      [],
    );
    for (const report of [
      'earning-mismatches',
      'payout-mismatches',
      'failed-payouts',
      'paid-cancelled-bookings',
      'cash-fee-mismatches',
      'stale-collections',
      'payable-without-bank-account',
      'unprocessed-payout-webhooks',
      'payout-webhook-anomalies',
    ]) {
      await request(ctx.server)
        .get(`/v1/admin/reconciliation/${report}`)
        .set(bearer(admin.token))
        .expect(200);
    }
  });

  describe('weekly scheduler: every Monday 11:00 IST', () => {
    let scheduled: TestContext;

    beforeAll(async () => {
      // Weekday and time are the approved defaults (Monday, 11:00, Asia/Kolkata).
      scheduled = await createTestApp({ configOverrides: { PAYOUT_SCHEDULE_ENABLED: 'true' } });
    });

    afterAll(async () => {
      await scheduled.close();
    });

    it('pulls settlements first, includes only settled earnings, runs once per week and never executes by default', async () => {
      const nextRun = nextScheduledRun(new Date(), 1, '11:00', IST);
      expect(zonedParts(nextRun, IST)).toMatchObject({ weekday: 1, hour: 11, minute: 0 });

      const driver = await driverWithBank();
      const settled = await payableEarning(driver, 50_000);
      const unsettled = await completedPrepaidTrip(driver, 40_000);
      // Settled at Razorpay before the run, but not synced yet: the pre-batch pull finds it.
      const late = await completedPrepaidTrip(driver, 30_000);
      scheduled.settlements.settle({
        providerPaymentId: late.providerPaymentId,
        amountPaise: 30_000,
        settledAt: new Date(nextRun.getTime() - 3_600_000),
      });

      // Each test app trusts its own signing key.
      const adminToken = scheduled.tokens.sign(admin.subject);
      const schedule = await request(scheduled.server)
        .get('/v1/admin/payout-schedule')
        .set(bearer(adminToken))
        .expect(200);
      expect(schedule.body).toMatchObject({
        enabled: true,
        weekday: 1,
        weekdayName: 'Monday',
        time: '11:00',
        timeZone: IST,
        autoExecute: false,
      });

      const scheduler = scheduled.app.get(PayoutSchedulerService);
      const key = `schedule:${isoWeekKey(nextRun, IST)}`;
      // One minute before Monday 11:00 IST: this week's batch does not exist yet.
      scheduled.clock.set(new Date(nextRun.getTime() - 60_000));
      await scheduler.tick();
      expect(await scheduled.prisma.payoutBatch.count({ where: { idempotencyKey: key } })).toBe(0);

      // Monday 11:00:30 IST: one batch, however often the scheduler (or an admin) runs it.
      scheduled.clock.set(new Date(nextRun.getTime() + 30_000));
      await scheduler.tick();
      await scheduler.tick();
      await request(scheduled.server)
        .post('/v1/admin/payout-schedule/run')
        .set(bearer(adminToken))
        .expect(200);
      const batches = await scheduled.prisma.payoutBatch.findMany({
        where: { idempotencyKey: key },
      });
      expect(batches).toHaveLength(1);
      const [batch] = batches;
      expect(batch).toMatchObject({
        origin: 'SCHEDULE',
        cutoffAt: nextRun,
        createdByUserId: null,
        status: 'PREPARED',
      });

      const payout = await scheduled.prisma.driverPayout.findUniqueOrThrow({
        where: { batchId_driverId: { batchId: batch?.id ?? '', driverId: driver.driverId } },
        include: { items: true },
      });
      expect(payout.items.map((item) => item.earningId).sort()).toEqual(
        [settled.earning.id, late.earning.id].sort(),
      );
      expect(payout.amountPaise).toBe(45_000n + 27_000n);
      expect(payout.status).toBe('PREPARED');
      expect((await earningOf(unsettled.earning.id)).status).toBe('AWAITING_SETTLEMENT');
      expect(await liveItems(unsettled.earning.id)).toHaveLength(0);
      scheduled.clock.reset();
    });
  });
});
