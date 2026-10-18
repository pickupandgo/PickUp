import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { FareQuoteRedeemer } from '../../src/fare/fare-contract';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { ReconciliationRunsService } from '../../src/reconciliation/reconciliation-runs.service';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  type FixtureDeps,
  idempotencyKey,
  TEST_PRICING_CONFIG,
  uniqueCategory,
  uniquePhone,
  uniqueSubject,
  uniqueVersionCode,
} from '../helpers/fixtures';
import {
  advanceTrip,
  bookedTrip,
  changeBankAccount,
  collect,
  deliverStops,
  engine,
  fundWallet,
  requestBankAccountChange,
  resolveStop,
  sendPayoutWebhook,
  setStopStatus,
  setTripStatus,
  startBookingPayment,
  TO_DELIVERED,
  TO_IN_TRANSIT,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook, startTopUp, verifyTopUp, walletBalance } from '../helpers/http';
import {
  buildPayoutWebhook,
  buildRefundWebhook,
  buildValidationWebhook,
  buildWebhook,
  checkoutSignature,
} from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { restrictedDatabaseUrl, TEST_DATABASE_URL } from '../setup/test-database';

/**
 * Runs the API as a role with exactly the grants in prisma/sql/02-app-grants.sql, proving the
 * production permissions are sufficient and that the API account cannot rewrite money.
 */
describe('Least-privilege database role', () => {
  let ctx: TestContext;
  let owner: PrismaClient;
  let deps: FixtureDeps;

  beforeAll(async () => {
    ctx = await createTestApp({ databaseUrl: restrictedDatabaseUrl() });
    owner = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 2 }),
    });
    deps = { prisma: owner, tokens: ctx.tokens };
  });

  afterAll(async () => {
    await ctx.close();
    await owner.$disconnect();
  });

  it('serves the whole top-up and wallet flow with production grants', async () => {
    const driver = await createDriver(deps);
    const admin = await createAdmin(deps);

    await request(ctx.server).get('/v1/wallet').set(bearer(driver.token)).expect(200);
    const { paymentId, orderId } = await startTopUp(ctx, driver, 40_000);
    const payment = ctx.razorpay.pay(orderId);
    await verifyTopUp(ctx, driver, paymentId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(orderId, payment.id),
    }).expect(200);
    await sendWebhook(ctx, buildWebhook('payment.captured', payment)).expect(200);

    const wallet = await owner.driverWallet.findUniqueOrThrow({
      where: { driverId: driver.driverId },
    });
    await request(ctx.server)
      .post(`/v1/admin/wallets/${wallet.id}/adjustments`)
      .set(bearer(admin.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ direction: 'DEBIT', amountPaise: 5_000, reason: 'Least privilege check' })
      .expect(201);
    await request(ctx.server)
      .post(`/v1/admin/payments/${paymentId}/sync`)
      .set(bearer(admin.token))
      .expect(200);
    await request(ctx.server).get('/v1/wallet/transactions').set(bearer(driver.token)).expect(200);
    for (const report of [
      'wallet-mismatches',
      'unprocessed-webhooks',
      'webhook-anomalies',
      'pending-payments',
      'duplicate-provider-payments',
    ]) {
      await request(ctx.server)
        .get(`/v1/admin/reconciliation/${report}`)
        .set(bearer(admin.token))
        .expect(200);
    }
    await request(ctx.server).get('/health/ready').expect(200);

    expect(await walletBalance(ctx, driver.driverId)).toBe(35_000n);
  });

  it('registers customers only through register_customer(), and only as customers', async () => {
    const subject = uniqueSubject('lp');
    const phone = uniquePhone();
    const token = ctx.tokens.sign(subject, { phoneNumber: phone });
    await request(ctx.server).post('/v1/customers/me').set(bearer(token)).expect(201);
    await request(ctx.server).post('/v1/customers/me').set(bearer(token)).expect(200);
    await request(ctx.server).get('/v1/customers/me').set(bearer(token)).expect(200);
    const user = await owner.user.findUniqueOrThrow({
      where: { phone },
      include: { authIdentities: true, customer: true, driver: true },
    });
    expect(user).toMatchObject({ role: 'CUSTOMER', driver: null });
    expect(user.authIdentities.map((identity) => identity.subject)).toEqual([subject]);
    expect(user.customer).not.toBeNull();

    // The function validates its own input; it is not a general-purpose insert.
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      await expect(
        client.$queryRaw`SELECT * FROM register_customer('firebase', 'x y', '+919876543210')`,
      ).rejects.toThrow(/invalid subject/);
    } finally {
      await client.$disconnect();
    }
  });

  it('prices, stores and redeems a fare quote with production grants', async () => {
    const admin = await createAdmin(deps);
    const customer = await createCustomer(deps);

    const version = await request(ctx.server)
      .post('/v1/admin/pricing-versions')
      .set(bearer(admin.token))
      .send({
        code: uniqueVersionCode(),
        model: 'LEG_DISTANCE_V1',
        config: TEST_PRICING_CONFIG,
        reason: 'Least privilege pricing version',
      })
      .expect(201);

    const route = {
      pickup: { latitude: 26.2389, longitude: 73.0243 },
      drops: [{ latitude: 26.3448, longitude: 73.0458 }],
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 2,
    };
    const quoted = await request(ctx.server)
      .post('/v1/fare/quotes')
      .set(bearer(customer.token))
      .send(route)
      .expect(201);
    const quoteId = quoted.body.quoteId as string;
    expect(quoted.body.pricingVersion.pricingVersionId).toBe(version.body.version.pricingVersionId);
    expect(quoted.body.payablePaise).toBeGreaterThan(0);

    await request(ctx.server)
      .get(`/v1/fare/quotes/${quoteId}`)
      .set(bearer(customer.token))
      .expect(200);
    await engine(ctx).get(`/v1/internal/fare-quotes/${quoteId}`).expect(200);

    // Redeeming is the only change the API role may make to a quote (UPDATE on redeemed_at).
    const frozen = await ctx.prisma.runInTransaction((tx) =>
      ctx.app
        .get(FareQuoteRedeemer)
        .redeem(tx, { quoteId, customerId: customer.customerId, at: new Date() }),
    );
    expect(frozen.payablePaise).toBe(BigInt(quoted.body.payablePaise as number));
    expect(
      (await owner.fareQuote.findUniqueOrThrow({ where: { id: quoteId } })).redeemedAt,
    ).not.toBeNull();
  });

  it('serves bookings, collections, earnings and payouts with production grants', async () => {
    const admin = await createAdmin(deps);
    const customer = await createCustomer(deps);
    const driver = await createDriver(deps);
    const category = uniqueCategory();

    // Fee rule through the admin API (the API role inserts fee rules and audit rows).
    await request(ctx.server)
      .post('/v1/admin/fee-rules')
      .set(bearer(admin.token))
      .send({
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode: 'HALF_UP',
        reason: 'Least privilege fee rule',
      })
      .expect(201);

    // Pay at pickup, registered from a quote with production grants (booking, stops, quote
    // redemption), paid in cash at pickup: wallet fee debit (the frozen fee), cash earning.
    await fundWallet(ctx, admin, driver.driverId, 20_000);
    const pickup = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 40_000,
      category,
      owner,
    });
    expect(await owner.bookingStop.count({ where: { bookingId: pickup.bookingId } })).toBe(1);
    await advanceTrip(ctx, pickup.tripId, ['DRIVER_ARRIVED']);
    // The pickup gate holds the unpaid trip at the pickup.
    await setTripStatus(ctx, pickup.tripId, 'PICKUP_VERIFIED').expect(409);
    await collect(ctx, driver, pickup.tripId, { method: 'CASH', amountPaise: 40_000 }).expect(201);
    await advanceTrip(ctx, pickup.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
    // The drop moves the trip: DROP_PROGRESS, then DELIVERED and PAYMENT_CONFIRMED (paid).
    await deliverStops(ctx, pickup.tripId, [1]);
    await setTripStatus(ctx, pickup.tripId, 'COMPLETED').expect(200);

    // Pay at delivery, priced per drop: a failed attempt, an admin retry, a second failure
    // resolved as undelivered (audited), then the booking cancelled, which cancels the other drop.
    const perDrop = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      model: 'QUOTE_PER_STOP',
      farePaise: 50_000,
      dropPaise: [20_000, 30_000],
      category,
      owner,
    });
    await advanceTrip(ctx, perDrop.tripId, TO_IN_TRANSIT);
    await setStopStatus(ctx, perDrop.tripId, 1, 'ARRIVED').expect(200);
    await setStopStatus(ctx, perDrop.tripId, 1, 'DELIVERED').expect(409);
    await setStopStatus(ctx, perDrop.tripId, 1, 'DELIVERY_FAILED', 'Receiver not at home').expect(
      200,
    );
    await resolveStop(ctx, admin, perDrop.bookingId, 1, {
      resolution: 'RETRY',
      reason: 'Receiver is back',
    }).expect(200);
    await setStopStatus(ctx, perDrop.tripId, 1, 'DELIVERY_FAILED', 'Receiver refused').expect(200);
    await resolveStop(ctx, admin, perDrop.bookingId, 1, {
      resolution: 'UNDELIVERED',
      reason: 'Customer agreed to skip this drop',
    }).expect(200);
    await engine(ctx)
      .post(`/v1/internal/bookings/${perDrop.bookingId}/cancel`)
      .send({ reason: 'Least privilege cancellation' })
      .expect(200);
    expect(
      (
        await owner.bookingStop.findMany({
          where: { bookingId: perDrop.bookingId },
          orderBy: { sequence: 'asc' },
        })
      ).map((stop) => stop.status),
    ).toEqual(['UNDELIVERED', 'CANCELLED']);
    await request(ctx.server)
      .get(`/v1/admin/bookings/${perDrop.bookingId}`)
      .set(bearer(admin.token))
      .expect(200);

    // Pay at delivery, priced per drop, paid drop by drop (payment flow Phase 4): drop 1 in cash
    // (its fee share debited), drop 2 by QR. The booking goes PARTIALLY_PAID, then PAID, and the
    // completed trip's earning is MIXED, funded by both collections (earning_collections).
    await fundWallet(ctx, admin, driver.driverId, 10_000);
    const mixed = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      model: 'QUOTE_PER_STOP',
      farePaise: 50_000,
      dropPaise: [20_000, 30_000],
      category,
      owner,
    });
    await advanceTrip(ctx, mixed.tripId, TO_IN_TRANSIT);
    await setStopStatus(ctx, mixed.tripId, 1, 'ARRIVED').expect(200);
    await collect(ctx, driver, mixed.tripId, {
      method: 'CASH',
      amountPaise: 20_000,
      stopSequence: 1,
    }).expect(201);
    expect(
      (await owner.booking.findUniqueOrThrow({ where: { id: mixed.bookingId } })).paymentStatus,
    ).toBe('PARTIALLY_PAID');
    await setStopStatus(ctx, mixed.tripId, 1, 'DELIVERED').expect(200);
    await setStopStatus(ctx, mixed.tripId, 2, 'ARRIVED').expect(200);
    const dropQr = await collect(ctx, driver, mixed.tripId, {
      method: 'ONLINE_QR',
      amountPaise: 30_000,
      stopSequence: 2,
    }).expect(201);
    const dropPayment = ctx.links.pay(
      ctx.links.byCollection(dropQr.body.collectionId as string).referenceId,
    );
    await request(ctx.server)
      .get(`/v1/trips/${mixed.tripId}/collections/${dropQr.body.collectionId as string}`)
      .set(bearer(driver.token))
      .expect(200);
    await setStopStatus(ctx, mixed.tripId, 2, 'DELIVERED').expect(200);
    await setTripStatus(ctx, mixed.tripId, 'COMPLETED').expect(200);
    const mixedEarning = await owner.driverEarning.findUniqueOrThrow({
      where: { bookingId: mixed.bookingId },
      include: { collectionLinks: true },
    });
    // Payment flow Phase 5: the cash part is with the driver, only the QR net is paid out.
    expect(mixedEarning).toMatchObject({
      settlement: 'MIXED',
      status: 'AWAITING_SETTLEMENT',
      grossAmountPaise: 50_000n,
      platformFeePaise: 5_000n,
      cashCollectedPaise: 20_000n,
      onlineCollectedPaise: 30_000n,
      cashFeePaise: 2_000n,
      onlineFeePaise: 3_000n,
      payoutAmountPaise: 27_000n,
      collectionId: null,
    });
    expect(
      mixedEarning.collectionLinks
        .map((link) => [link.method, Number(link.amountPaise), Number(link.platformFeePaise)])
        .sort(),
    ).toEqual([
      ['CASH', 20_000, 2_000],
      ['ONLINE_QR', 30_000, 3_000],
    ]);

    // Historical (legacy) cash trip at delivery: wallet fee debit, completion, cash earning.
    const cash = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 50_000,
      category,
      owner,
    });
    await advanceTrip(ctx, cash.tripId, TO_DELIVERED);
    await collect(ctx, driver, cash.tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
    await setTripStatus(ctx, cash.tripId, 'COMPLETED').expect(200);

    // QR trip: payment link paid, refreshed by the driver app, online earning.
    const qr = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 30_000,
      category,
      owner,
    });
    await advanceTrip(ctx, qr.tripId, TO_DELIVERED);
    const shown = await collect(ctx, driver, qr.tripId, {
      method: 'ONLINE_QR',
      amountPaise: 30_000,
    }).expect(201);
    const qrPayment = ctx.links.pay(
      ctx.links.byCollection(shown.body.collectionId as string).referenceId,
    );
    await request(ctx.server)
      .get(`/v1/trips/${qr.tripId}/collections/${shown.body.collectionId as string}`)
      .set(bearer(driver.token))
      .expect(200);
    await setTripStatus(ctx, qr.tripId, 'COMPLETED').expect(200);

    // Historical prepaid trip: customer pays in the app, verified with Razorpay.
    const prepaid = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 20_000,
      category,
      owner,
    });
    const started = await startBookingPayment(ctx, customer, prepaid.bookingId).expect(201);
    const orderId = started.body.checkout.orderId as string;
    const paid = ctx.razorpay.pay(orderId);
    await verifyBookingPayment(ctx, customer, prepaid.bookingId, {
      razorpayOrderId: orderId,
      razorpayPaymentId: paid.id,
      razorpaySignature: checkoutSignature(orderId, paid.id),
    }).expect(200);
    await advanceTrip(ctx, prepaid.tripId, TO_DELIVERED);
    await setTripStatus(ctx, prepaid.tripId, 'COMPLETED').expect(200);

    // Hold and release, bank account, weekly payout, processed webhook.
    const earning = await owner.driverEarning.findUniqueOrThrow({
      where: { bookingId: prepaid.bookingId },
    });
    await request(ctx.server)
      .post(`/v1/admin/earnings/${earning.id}/hold`)
      .set(bearer(admin.token))
      .send({ reason: 'Least privilege hold check' })
      .expect(200);
    await request(ctx.server)
      .post(`/v1/admin/earnings/${earning.id}/release`)
      .set(bearer(admin.token))
      .send({ reason: 'Least privilege release check' })
      .expect(200);
    // Razorpay settles the prepaid and QR payments and the mixed trip's drop QR, plus a payment
    // that is not ours; the admin sync records them (API role): three settlements applied, one
    // settlement finding recorded, then only counted when seen again (payment flow Phase 5).
    const unknownPaymentId = `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    ctx.settlements.settle({ providerPaymentId: paid.id, amountPaise: 20_000 });
    ctx.settlements.settle({ providerPaymentId: qrPayment.id, amountPaise: 30_000 });
    ctx.settlements.settle({ providerPaymentId: dropPayment.id, amountPaise: 30_000 });
    ctx.settlements.settle({ providerPaymentId: unknownPaymentId, amountPaise: 12_345 });
    const synced = await request(ctx.server)
      .post('/v1/admin/settlements/sync')
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(synced.body).toMatchObject({ recorded: 3, earningsPromoted: 3, unknownPayments: 1 });
    const again = await request(ctx.server)
      .post('/v1/admin/settlements/sync')
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(again.body).toMatchObject({ recorded: 0, earningsPromoted: 0, unknownPayments: 1 });
    expect(
      await owner.settlementFinding.findFirstOrThrow({
        where: { providerPaymentId: unknownPaymentId },
      }),
    ).toMatchObject({ kind: 'UNKNOWN_PAYMENT', occurrences: 2, settledAmountPaise: 12_345n });
    expect(
      (await owner.driverEarning.findUniqueOrThrow({ where: { id: mixedEarning.id } })).status,
    ).toBe('PAYABLE');
    await request(ctx.server)
      .get('/v1/admin/reconciliation/settlement-anomalies')
      .set(bearer(admin.token))
      .expect(200);
    await request(ctx.server).get('/v1/admin/settlements').set(bearer(admin.token)).expect(200);
    await request(ctx.server)
      .get('/v1/admin/settlements/overdue-earnings')
      .set(bearer(admin.token))
      .expect(200);

    // Bank account: change request, phone OTP step-up, confirmed, validated by the bank
    // (webhook), approved by an admin. A cancelled request on the way.
    const abandoned = await requestBankAccountChange(ctx, driver).expect(201);
    await request(ctx.server)
      .post(`/v1/bank-account/change-requests/${abandoned.body.changeRequestId as string}/cancel`)
      .set(bearer(driver.token))
      .expect(200);
    const account = await changeBankAccount(ctx, driver, {
      accountHolderName: 'Least Privilege',
      ifsc: 'HDFC0001234',
      accountNumber: '123456781234',
    });
    expect(account.status).toBe(201);
    const bankAccountId = account.body.bankAccountId as string;
    const validation = await owner.bankAccountVerification.findFirstOrThrow({
      where: { bankAccountId },
    });
    await sendPayoutWebhook(
      ctx,
      buildValidationWebhook(
        'fund_account.validation.completed',
        ctx.payouts.completeValidation(validation.providerValidationId, {
          accountStatus: 'active',
          registeredName: 'TEST DRIVER',
        }),
      ),
    ).expect(200);
    await request(ctx.server)
      .post(`/v1/admin/bank-accounts/${bankAccountId}/approve`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    await request(ctx.server)
      .get(`/v1/admin/bank-accounts/${bankAccountId}`)
      .set(bearer(admin.token))
      .expect(200);
    await request(ctx.server).get('/v1/admin/payout-schedule').set(bearer(admin.token)).expect(200);
    const batch = await request(ctx.server)
      .post('/v1/admin/payout-batches')
      .set(bearer(admin.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({})
      .expect(201);
    await request(ctx.server)
      .post(`/v1/admin/payout-batches/${batch.body.batch.batchId as string}/execute`)
      .set(bearer(admin.token))
      .expect(200);
    const payout = await owner.driverPayout.findUniqueOrThrow({
      where: {
        batchId_driverId: {
          batchId: batch.body.batch.batchId as string,
          driverId: driver.driverId,
        },
      },
    });
    const provider = ctx.payouts.byReference(payout.id);
    if (!provider) {
      throw new Error('expected a provider payout');
    }
    await sendPayoutWebhook(
      ctx,
      buildPayoutWebhook('payout.processed', ctx.payouts.setStatus(provider.id, 'processed')),
    ).expect(200);
    await request(ctx.server).get('/v1/earnings/summary').set(bearer(driver.token)).expect(200);
    await request(ctx.server).get('/v1/payouts').set(bearer(driver.token)).expect(200);
    await request(ctx.server)
      .get(`/v1/admin/bookings/${prepaid.bookingId}`)
      .set(bearer(admin.token))
      .expect(200);
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

    expect(
      (await owner.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
    ).toBe('PAID');
    // One payout carried each online earning for its payout amount: the prepaid net (18,000),
    // the QR net (27,000) and the mixed trip's QR net (27,000); the cash parts stayed with the
    // driver.
    expect(payout.amountPaise).toBe(18_000n + 27_000n + 27_000n);
    expect(
      (await owner.driverEarning.findUniqueOrThrow({ where: { id: mixedEarning.id } })).status,
    ).toBe('PAID');
    // Funded 20,000 and 10,000; each cash payment debited its 10% fee: 4,000 frozen on the pickup
    // booking, 2,000 for the cash drop (that drop's share), 5,000 from the legacy booking's pinned
    // rule.
    expect(
      (await owner.booking.findUniqueOrThrow({ where: { id: pickup.bookingId } })).platformFeePaise,
    ).toBe(4_000n);
    expect(await walletBalance(ctx, driver.driverId)).toBe(
      20_000n + 10_000n - 4_000n - 2_000n - 5_000n,
    );
  });

  it.each([
    ['rewrite a payment amount', 'UPDATE payments SET amount_paise = 1'],
    ['reassign a payment', 'UPDATE payments SET user_id = gen_random_uuid()'],
    ['delete payments', 'DELETE FROM payments'],
    ['edit the ledger', 'UPDATE driver_wallet_transactions SET amount_paise = 1'],
    ['truncate the ledger', 'TRUNCATE driver_wallet_transactions'],
    ['move a wallet to another driver', 'UPDATE driver_wallets SET driver_id = gen_random_uuid()'],
    ['create users', "INSERT INTO users (phone, role) VALUES ('+910000000001', 'ADMIN')"],
    ['promote a user', "UPDATE users SET role = 'ADMIN'"],
    ['approve drivers', "UPDATE drivers SET approval_status = 'APPROVED'"],
    ['rewrite webhook payloads', "UPDATE payment_events SET payload = '{}'::jsonb"],
    ['create tables', 'CREATE TABLE sneaky (id int)'],
    [
      'change a confirmed fare',
      'UPDATE bookings SET final_fare_minor = 1, fare_estimate_minor = 1',
    ],
    ['move a booking to another customer', 'UPDATE bookings SET customer_id = gen_random_uuid()'],
    ['reassign a trip', 'UPDATE trips SET driver_id = gen_random_uuid()'],
    ['edit a fee rule value', 'UPDATE fee_rules SET value = 1'],
    ['delete fee rules', 'DELETE FROM fee_rules'],
    ['rewrite a collection amount', 'UPDATE payment_collections SET amount_paise = 1'],
    ['rewrite a collection fee', 'UPDATE payment_collections SET platform_fee_paise = 0'],
    ['rewrite an earning amount', 'UPDATE driver_earnings SET net_amount_paise = 1'],
    ['delete earnings', 'DELETE FROM driver_earnings'],
    [
      'redirect a bank account',
      "UPDATE driver_bank_accounts SET provider_fund_account_id = 'fa_x'",
    ],
    ['rewrite a payout amount', 'UPDATE driver_payouts SET amount_paise = 1'],
    [
      'move a payout to another account',
      'UPDATE driver_payouts SET bank_account_id = gen_random_uuid()',
    ],
    ['rewrite a payout item', 'UPDATE payout_items SET amount_paise = 1'],
    ['delete payout items', 'DELETE FROM payout_items'],
    ['rewrite a batch total', 'UPDATE payout_batches SET total_amount_paise = 1'],
    ['edit the admin audit trail', "UPDATE admin_actions SET reason = 'x'"],
    ['delete the admin audit trail', 'DELETE FROM admin_actions'],
    ['create customers', 'INSERT INTO customers (user_id) VALUES (gen_random_uuid())'],
    [
      'link a sign-in to an account',
      "INSERT INTO auth_identities (user_id, provider, subject) VALUES (gen_random_uuid(), 'firebase', 'x')",
    ],
    ['re-point a sign-in', 'UPDATE auth_identities SET user_id = gen_random_uuid()'],
    ['rewrite an earning deduction', 'UPDATE driver_earnings SET tds_amount_paise = 1'],
    ['change an earning TDS policy', "UPDATE driver_earnings SET tds_policy = 'TAX_RULE'"],
    ['rewrite a payout deduction', 'UPDATE driver_payouts SET tds_amount_paise = 1'],
    ['rewrite a payout gross', 'UPDATE driver_payouts SET gross_amount_paise = 1'],
    [
      'create a tax rule',
      "INSERT INTO tax_rules (code, version, applies_to, rate_percent, effective_from, approval_reference) VALUES ('TDS_X', 1, 'PAYOUT', 1, now(), 'x')",
    ],
    ['edit a tax rule', 'UPDATE tax_rules SET rate_percent = 1'],
    ['rewrite a merchant settlement', 'UPDATE payment_settlements SET amount_paise = 1'],
    ['delete merchant settlements', 'DELETE FROM payment_settlements'],
    [
      'move a bank validation to another account',
      'UPDATE bank_account_verifications SET bank_account_id = gen_random_uuid()',
    ],
    ['delete bank validations', 'DELETE FROM bank_account_verifications'],
    ['set a driver KYC name', "UPDATE drivers SET legal_name = 'Someone Else'"],
    [
      'rebind a bank account to another change request',
      'UPDATE driver_bank_accounts SET change_request_id = gen_random_uuid()',
    ],
    [
      'backdate a bank change request',
      "UPDATE bank_account_change_requests SET created_at = now() - interval '1 day'",
    ],
    [
      'extend a bank change request',
      "UPDATE bank_account_change_requests SET expires_at = now() + interval '1 day'",
    ],
    [
      'move a bank change request to another driver',
      'UPDATE bank_account_change_requests SET driver_id = gen_random_uuid()',
    ],
    [
      'forge the step-up verification time',
      'UPDATE bank_account_change_requests SET step_up_verified_at = now()',
    ],
    ['delete bank change requests', 'DELETE FROM bank_account_change_requests'],
    ['change a quoted fare', 'UPDATE fare_quotes SET payable_paise = 1'],
    ['extend a quote', "UPDATE fare_quotes SET expires_at = now() + interval '1 day'"],
    ['move a quote to another customer', 'UPDATE fare_quotes SET customer_id = gen_random_uuid()'],
    ['change a quoted drop amount', 'UPDATE fare_quote_stops SET payable_paise = 1'],
    ['delete quotes', 'DELETE FROM fare_quotes'],
    ['delete quoted drops', 'DELETE FROM fare_quote_stops'],
    ['edit the rates of a pricing version', "UPDATE pricing_versions SET config = '{}'::jsonb"],
    ['move a pricing version', 'UPDATE pricing_versions SET effective_from = now()'],
    ['delete pricing versions', 'DELETE FROM pricing_versions'],
    ['change a booking stop amount', 'UPDATE booking_stops SET payable_paise = 1'],
    ['change a booking stop fee share', 'UPDATE booking_stops SET platform_fee_share_paise = 0'],
    [
      'move a booking stop to another booking',
      'UPDATE booking_stops SET booking_id = gen_random_uuid()',
    ],
    [
      'link a collection to a drop',
      'UPDATE payment_collections SET booking_stop_id = gen_random_uuid()',
    ],
    // The collections that fund an earning are written once with it (payment flow Phase 4).
    ['change the collections of an earning', 'UPDATE earning_collections SET amount_paise = 1'],
    ['delete the collections of an earning', 'DELETE FROM earning_collections'],
    // The split of an earning and what it pays out are written once (payment flow Phase 5).
    ['change what a collection contributes', 'UPDATE earning_collections SET net_amount_paise = 1'],
    ['rewrite an earning payout amount', 'UPDATE driver_earnings SET payout_amount_paise = 1'],
    [
      'move an earning between cash and online',
      'UPDATE driver_earnings SET cash_collected_paise = 0, online_collected_paise = 1',
    ],
    ['rewrite an earning fee split', 'UPDATE driver_earnings SET online_fee_paise = 0'],
    ['rewrite a settlement finding', 'UPDATE settlement_findings SET settled_amount_paise = 1'],
    [
      'move a settlement finding to another collection',
      'UPDATE settlement_findings SET collection_id = gen_random_uuid()',
    ],
    ['delete settlement findings', 'DELETE FROM settlement_findings'],
    ['truncate settlement findings', 'TRUNCATE settlement_findings'],
    ['delete booking stops', 'DELETE FROM booking_stops'],
    ['change a booking fare snapshot', 'UPDATE bookings SET fare_paise = 1'],
    ['change a booking platform fee', 'UPDATE bookings SET platform_fee_paise = 0'],
    [
      're-point a booking at another quote',
      'UPDATE bookings SET fare_quote_id = gen_random_uuid()',
    ],
    [
      'change a booking payment model',
      "UPDATE bookings SET payment_model = 'LEGACY_BOOKING_LEVEL'",
    ],
    // Refunds (payment flow Phase 6): the source, amount and decisions are written once.
    ['rewrite a refund amount', 'UPDATE payment_refunds SET amount_paise = 1'],
    [
      'move a refund to another collection',
      'UPDATE payment_refunds SET source_collection_id = gen_random_uuid()',
    ],
    [
      'move a refund to another booking',
      'UPDATE payment_refunds SET booking_id = gen_random_uuid()',
    ],
    ['change a refund kind', "UPDATE payment_refunds SET kind = 'CASH_RETURNED'"],
    ['rewrite a refund reason', "UPDATE payment_refunds SET reason = 'Rewritten reason'"],
    ['change a cash fee decision', "UPDATE payment_refunds SET fee_treatment = 'KEPT'"],
    [
      'change who requested a refund',
      'UPDATE payment_refunds SET requested_by_user_id = gen_random_uuid()',
    ],
    [
      're-point a refund at another wallet credit',
      'UPDATE payment_refunds SET wallet_transaction_id = gen_random_uuid()',
    ],
    ['write a collection refunded amount', 'UPDATE payment_collections SET refunded_paise = 1'],
    ['delete refunds', 'DELETE FROM payment_refunds'],
    ['truncate refunds', 'TRUNCATE payment_refunds'],
    // Payment flow Phase 7: the event log is read-only to the API (its triggers write it), and a
    // finding's identity or a run's job can't be rewritten.
    [
      'write a financial event',
      `INSERT INTO financial_events (occurred_at, transaction_id, entity_type, entity_id, action,
                                     changes, actor_type, db_role)
       VALUES (now(), 1, 'BOOKING', gen_random_uuid(), 'CREATED', '{}', 'ADMIN', 'forger')`,
    ],
    ['rewrite a financial event', "UPDATE financial_events SET actor_type = 'SYSTEM'"],
    ['delete financial events', 'DELETE FROM financial_events'],
    ['truncate financial events', 'TRUNCATE financial_events'],
    ['change what a finding is', "UPDATE reconciliation_findings SET kind = 'SOMETHING_ELSE'"],
    [
      're-point a finding at another record',
      "UPDATE reconciliation_findings SET entity_id = 'another-record'",
    ],
    [
      "rewrite a finding's first sighting",
      'UPDATE reconciliation_findings SET first_seen_at = now()',
    ],
    ['delete findings', 'DELETE FROM reconciliation_findings'],
    ['truncate findings', 'TRUNCATE reconciliation_findings'],
    ["change a run's job", "UPDATE reconciliation_runs SET job = 'RECONCILIATION'"],
    ['change who requested a run', 'UPDATE reconciliation_runs SET requested_by_user_id = NULL'],
    ['delete runs', 'DELETE FROM reconciliation_runs'],
    ['truncate runs', 'TRUNCATE reconciliation_runs'],
  ])('the API role cannot %s', async (_label, sql) => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      // Constant SQL from the table above; no user input involved.
      await expect(client.$executeRaw(Prisma.raw(sql))).rejects.toThrow(/permission denied/i);
    } finally {
      await client.$disconnect();
    }
  });

  // Refunds (payment flow Phase 6) run on the production grants. The API role has no privilege on
  // payment_collections.refunded_paise: the database keeps it (a SECURITY DEFINER trigger), and
  // its rules still hold on the refund columns the API role may write.
  it('serves provider refunds and cash returns with production grants', async () => {
    const admin = await createAdmin(deps);
    const customer = await createCustomer(deps);
    const driver = await createDriver(deps);
    const category = uniqueCategory();
    await request(ctx.server)
      .post('/v1/admin/fee-rules')
      .set(bearer(admin.token))
      .send({
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode: 'HALF_UP',
        reason: 'Least privilege refund fee rule',
      })
      .expect(201);
    const pickupBooking = () =>
      bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 40_000,
        category,
        owner,
      });
    const cancel = (bookingId: string) =>
      engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'Least privilege refund check' })
        .expect(200);
    const requestRefund = (body: Record<string, unknown>) =>
      request(ctx.server)
        .post('/v1/admin/refunds')
        .set(bearer(admin.token))
        .set('Idempotency-Key', idempotencyKey())
        .send({ reason: 'Least privilege refund request', ...body });
    async function paidByQr() {
      const trip = await pickupBooking();
      await advanceTrip(ctx, trip.tripId, ['DRIVER_ARRIVED']);
      const shown = await collect(ctx, driver, trip.tripId, {
        method: 'ONLINE_QR',
        amountPaise: 40_000,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      ctx.links.pay(ctx.links.byCollection(collectionId).referenceId);
      await request(ctx.server)
        .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
      await cancel(trip.bookingId);
      return { ...trip, collectionId };
    }

    // A QR paid at the pickup, then cancelled: refunded through the provider.
    const qr = await paidByQr();
    const requested = await requestRefund({
      bookingId: qr.bookingId,
      sourceCollectionId: qr.collectionId,
      kind: 'PROVIDER',
    }).expect(201);
    expect(requested.body.refund).toMatchObject({ status: 'PROCESSING', amountPaise: 40_000 });
    const refundId = requested.body.refund.refundId as string;
    const processed = ctx.refunds.setStatus(
      requested.body.refund.providerRefundId as string,
      'processed',
    );
    await sendWebhook(ctx, buildRefundWebhook('refund.processed', processed)).expect(200);
    expect(await owner.paymentRefund.findUniqueOrThrow({ where: { id: refundId } })).toMatchObject({
      status: 'COMPLETED',
    });
    expect(
      (await owner.paymentCollection.findUniqueOrThrow({ where: { id: qr.collectionId } }))
        .refundedPaise,
    ).toBe(40_000n);
    expect(
      (await owner.booking.findUniqueOrThrow({ where: { id: qr.bookingId } })).paymentStatus,
    ).toBe('REFUNDED');
    await request(ctx.server)
      .post(`/v1/admin/refunds/${refundId}/sync`)
      .set(bearer(admin.token))
      .send()
      .expect(200);

    // Cash taken at the pickup, then cancelled: handed back, the fee credited to the wallet.
    await fundWallet(ctx, admin, driver.driverId, 10_000);
    const cashTrip = await pickupBooking();
    await advanceTrip(ctx, cashTrip.tripId, ['DRIVER_ARRIVED']);
    const collected = await collect(ctx, driver, cashTrip.tripId, {
      method: 'CASH',
      amountPaise: 40_000,
    }).expect(201);
    const cashCollectionId = collected.body.collectionId as string;
    await cancel(cashTrip.bookingId);
    const balance = await walletBalance(ctx, driver.driverId);
    const returned = await requestRefund({
      bookingId: cashTrip.bookingId,
      sourceCollectionId: cashCollectionId,
      kind: 'CASH_RETURNED',
      feeTreatment: 'CREDITED_TO_WALLET',
    }).expect(201);
    expect(returned.body.refund).toMatchObject({ status: 'COMPLETED', feeCreditPaise: 4_000 });
    expect(await walletBalance(ctx, driver.driverId)).toBe(balance + 4_000n);

    // Withdrawn before it reached the provider.
    const withdrawn = await paidByQr();
    ctx.refunds.unavailable = true;
    let pendingId: string;
    try {
      const pending = await requestRefund({
        bookingId: withdrawn.bookingId,
        sourceCollectionId: withdrawn.collectionId,
        kind: 'PROVIDER',
      }).expect(201);
      pendingId = pending.body.refund.refundId as string;
    } finally {
      ctx.refunds.unavailable = false;
    }
    await owner.$executeRaw`
      UPDATE payment_refunds SET last_submitted_at = now() - interval '10 minutes'
      WHERE id = ${pendingId}::uuid`;
    const cancelled = await request(ctx.server)
      .post(`/v1/admin/refunds/${pendingId}/cancel`)
      .set(bearer(admin.token))
      .send({ reason: 'Least privilege cancellation of a refund' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    for (const report of ['refund-anomalies', 'paid-cancelled-bookings']) {
      await request(ctx.server)
        .get(`/v1/admin/reconciliation/${report}`)
        .set(bearer(admin.token))
        .expect(200);
    }
    await request(ctx.server)
      .get(`/v1/admin/refunds?bookingId=${qr.bookingId}`)
      .set(bearer(admin.token))
      .expect(200);
    await request(ctx.server)
      .get(`/v1/admin/bookings/${cashTrip.bookingId}`)
      .set(bearer(admin.token))
      .expect(200);

    // On the columns the API role may write, the database's rules still hold.
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      await expect(
        client.$executeRaw`UPDATE payment_refunds SET status = 'PENDING' WHERE id = ${refundId}::uuid`,
      ).rejects.toThrow(/Invalid refund transition COMPLETED -> PENDING/);
      await expect(
        client.$executeRaw`
          UPDATE payment_refunds SET provider_refund_id = 'rfnd_Rewritten00001'
          WHERE id = ${refundId}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        client.$executeRaw`UPDATE bookings SET payment_status = 'PAID' WHERE id = ${qr.bookingId}::uuid`,
      ).rejects.toThrow(/Invalid booking payment transition REFUNDED -> PAID/);
      await expect(
        client.$executeRaw`
          INSERT INTO payment_refunds (booking_id, source_collection_id, kind, status, refund_case,
                                       amount_paise, reason, requested_by_user_id,
                                       idempotency_key, fee_treatment, completed_at)
          VALUES (${cashTrip.bookingId}::uuid, ${cashCollectionId}::uuid, 'CASH_RETURNED',
                  'COMPLETED', 'CANCELLED_BEFORE_HANDOVER', 40000, 'A second cash return',
                  ${admin.userId}::uuid, ${randomUUID()}, 'KEPT', now())`,
      ).rejects.toThrow(/never exceed what was collected/);
    } finally {
      await client.$disconnect();
    }
  });

  // The stop lifecycle columns are granted (the API moves drops), so the database's own rules are
  // what stops the API role from moving a drop or a trip out of order: the same guards as for the
  // table owner (pickup-payment, delivery-stops).
  it('moves drops and trips only through their lifecycle', async () => {
    const customer = await createCustomer(deps);
    const driver = await createDriver(deps);
    const category = uniqueCategory();
    await owner.feeRule.create({
      data: {
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode: 'HALF_UP',
        effectiveFrom: new Date(Date.now() - 60_000),
        reason: 'Least privilege lifecycle fee rule',
      },
    });
    const pickup = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 20_000,
      category,
      owner,
    });
    await advanceTrip(ctx, pickup.tripId, ['DRIVER_ARRIVED']);
    const [stop] = await owner.bookingStop.findMany({ where: { bookingId: pickup.bookingId } });
    if (!stop) {
      throw new Error('expected a stop');
    }
    const admin = await createAdmin(deps);

    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      for (const [statement, refusal] of [
        [
          Prisma.sql`UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now()
                      WHERE id = ${pickup.tripId}::uuid`,
          /Payment is required before the pickup handover/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET status = 'DELIVERED', delivered_at = now()
                      WHERE id = ${stop.id}::uuid`,
          /Invalid booking stop transition PENDING -> DELIVERED/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET status = 'ARRIVED', arrived_at = now()
                      WHERE id = ${stop.id}::uuid`,
          /A drop is reached only while its trip is under way/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET arrived_at = now() WHERE id = ${stop.id}::uuid`,
          /arrival is recorded only when the drop is reached or retried/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET resolved_at = now(),
                        resolved_by_user_id = ${admin.userId}::uuid, resolution_reason = 'Skip'
                      WHERE id = ${stop.id}::uuid`,
          /resolution is recorded only when it is resolved as undelivered/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET status = 'CANCELLED', cancelled_at = now()
                      WHERE id = ${stop.id}::uuid`,
          /A drop is cancelled only with its booking/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET updated_at = now() WHERE id = ${stop.id}::uuid`,
          /A booking stop changes only through a lifecycle transition/,
        ],
        // Granted since Phase 4 (per-drop collection), and still only with its transition.
        [
          Prisma.sql`UPDATE booking_stops SET payment_confirmed_at = now() WHERE id = ${stop.id}::uuid`,
          /A drop's payment is recorded once, only when its payment is confirmed/,
        ],
      ] as const) {
        await expect(client.$executeRaw(statement)).rejects.toThrow(refusal);
      }
    } finally {
      await client.$disconnect();
    }
    expect(await owner.bookingStop.findUniqueOrThrow({ where: { id: stop.id } })).toMatchObject({
      status: 'PENDING',
      arrivedAt: null,
      deliveredAt: null,
      resolvedAt: null,
    });
    expect((await owner.trip.findUniqueOrThrow({ where: { id: pickup.tripId } })).status).toBe(
      'DRIVER_ARRIVED',
    );
  });

  // Collections and payment status can be written by the API role, so the database's own rules
  // are what keep it to one obligation per collection (payment flow Phase 4, stop-collections).
  it('collects and pays only the obligation owed now', async () => {
    const customer = await createCustomer(deps);
    const driver = await createDriver(deps);
    const category = uniqueCategory();
    await owner.feeRule.create({
      data: {
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode: 'HALF_UP',
        effectiveFrom: new Date(Date.now() - 60_000),
        reason: 'Least privilege collection fee rule',
      },
    });
    const delivery = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 50_000,
      dropPaise: [20_000, 30_000],
      category,
      model: 'QUOTE_PER_STOP',
      owner,
    });
    await advanceTrip(ctx, delivery.tripId, ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT']);
    await setStopStatus(ctx, delivery.tripId, 1, 'ARRIVED').expect(200);
    const [first, second] = await owner.bookingStop.findMany({
      where: { bookingId: delivery.bookingId },
      orderBy: { sequence: 'asc' },
    });
    if (!first || !second) {
      throw new Error('expected two stops');
    }
    const qrFor = (stopId: string, amount: number) => Prisma.sql`
      INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method,
                                       amount_paise, collected_by_driver_id, status, provider,
                                       provider_product, provider_reference_id, idempotency_key)
      VALUES (${delivery.bookingId}::uuid, ${stopId}::uuid, ${delivery.tripId}::uuid, 'DELIVERY',
              'ONLINE_QR', ${amount}, ${driver.driverId}::uuid, 'PENDING', 'RAZORPAY', 'QR_CODE',
              ${`qr_${randomUUID().replace(/-/g, '').slice(0, 14)}`}, ${randomUUID()})`;

    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      for (const [statement, refusal] of [
        [
          qrFor(second.id, 30_000),
          /Only the drop the driver is at, before it is paid, is collected/,
        ],
        [qrFor(first.id, 50_000), /A drop is collected for its own payable amount/],
        [
          Prisma.sql`UPDATE bookings SET payment_status = 'PARTIALLY_PAID'
                      WHERE id = ${delivery.bookingId}::uuid`,
          /payment status follows its completed collections/,
        ],
        [
          Prisma.sql`UPDATE bookings SET payment_status = 'PAID' WHERE id = ${delivery.bookingId}::uuid`,
          /payment status follows its completed collections/,
        ],
        [
          Prisma.sql`UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
                      WHERE id = ${first.id}::uuid`,
          /confirmed only by a completed collection for that drop/,
        ],
      ] as const) {
        await expect(client.$executeRaw(statement)).rejects.toThrow(refusal);
      }
    } finally {
      await client.$disconnect();
    }
    expect(await owner.paymentCollection.count({ where: { bookingId: delivery.bookingId } })).toBe(
      0,
    );
    expect(
      (await owner.booking.findUniqueOrThrow({ where: { id: delivery.bookingId } })).paymentStatus,
    ).toBe('UNPAID');
  });

  // Turning a guard off is an ownership check, not a privilege check, so Postgres reports it
  // differently ("must be owner of table ..."). The API role owns no table.
  it.each([
    ['the booking insert guard', 'ALTER TABLE bookings DISABLE TRIGGER trg_bookings_insert_guard'],
    ['the booking terms guard', 'ALTER TABLE bookings DISABLE TRIGGER trg_bookings_guard'],
    ['the trip guard and pickup gate', 'ALTER TABLE trips DISABLE TRIGGER trg_trips_guard'],
    ['the booking stop guard', 'ALTER TABLE booking_stops DISABLE TRIGGER trg_booking_stops_guard'],
    [
      'the undelivered-drop audit check',
      'ALTER TABLE booking_stops DISABLE TRIGGER trg_booking_stops_resolution_audit',
    ],
    [
      'the booking payment guard',
      'ALTER TABLE payments DISABLE TRIGGER trg_payments_booking_insert_guard',
    ],
    [
      'the collection guard',
      'ALTER TABLE payment_collections DISABLE TRIGGER trg_collections_insert_guard',
    ],
    [
      'the collection effects check',
      'ALTER TABLE payment_collections DISABLE TRIGGER trg_collections_effects',
    ],
    [
      'the earning sources check',
      'ALTER TABLE driver_earnings DISABLE TRIGGER trg_earnings_sources',
    ],
    [
      'the earning collections guard',
      'ALTER TABLE earning_collections DISABLE TRIGGER trg_earning_collections_insert_guard',
    ],
    // Payment flow Phase 5.
    [
      'the every-online-collection-settled check',
      'ALTER TABLE driver_earnings DISABLE TRIGGER trg_earnings_settled',
    ],
    [
      'the settlement findings guard',
      'ALTER TABLE settlement_findings DISABLE TRIGGER trg_settlement_findings_guard',
    ],
    [
      'the settlement findings delete guard',
      'ALTER TABLE settlement_findings DISABLE TRIGGER trg_settlement_findings_no_delete',
    ],
    // Payment flow Phase 6.
    [
      'the refund insert guard',
      'ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_insert_guard',
    ],
    ['the refund guard', 'ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_guard'],
    ['the refund effects check', 'ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_effects'],
    [
      'the refunded-amount sync',
      'ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_sync_collection',
    ],
    [
      'the refund delete guard',
      'ALTER TABLE payment_refunds DISABLE TRIGGER trg_refunds_no_delete',
    ],
    [
      'the fee-credit ledger check',
      'ALTER TABLE driver_wallet_transactions DISABLE TRIGGER trg_wallet_refund_reversal',
    ],
    // Payment flow Phase 7: the event log can't be switched off, and its guards stay on.
    [
      'the financial event log on payments',
      'ALTER TABLE payments DISABLE TRIGGER trg_payments_financial_event',
    ],
    [
      'the financial event log on the wallet ledger',
      'ALTER TABLE driver_wallet_transactions DISABLE TRIGGER trg_wallet_tx_financial_event',
    ],
    [
      'the financial event log on bookings',
      'ALTER TABLE bookings DISABLE TRIGGER trg_bookings_financial_event',
    ],
    [
      'the financial event immutability guard',
      'ALTER TABLE financial_events DISABLE TRIGGER trg_financial_events_immutable',
    ],
    [
      'the financial event insert guard',
      'ALTER TABLE financial_events DISABLE TRIGGER trg_financial_events_insert_guard',
    ],
    [
      'the reconciliation finding guard',
      'ALTER TABLE reconciliation_findings DISABLE TRIGGER trg_reconciliation_findings_guard',
    ],
    [
      'the reconciliation run guard',
      'ALTER TABLE reconciliation_runs DISABLE TRIGGER trg_reconciliation_runs_guard',
    ],
  ])('the API role cannot disable %s', async (_label, sql) => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: restrictedDatabaseUrl(), max: 1 }),
    });
    try {
      // Constant SQL from the table above; no user input involved.
      await expect(client.$executeRaw(Prisma.raw(sql))).rejects.toThrow(/must be owner of table/i);
    } finally {
      await client.$disconnect();
    }
  });

  it('writes the event log, and runs recovery and reconciliation, with production grants', async () => {
    const [clock] = await owner.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const since = clock?.now ?? new Date();
    const admin = await createAdmin(deps);
    const customer = await createCustomer(deps);
    const driver = await createDriver(deps);
    const category = uniqueCategory();
    await owner.feeRule.create({
      data: {
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode: 'HALF_UP',
        effectiveFrom: new Date(Date.now() - 60_000),
        reason: 'Least privilege reconciliation fee rule',
      },
    });
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model: 'QUOTE_PER_STOP',
      owner,
    });
    await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    const shown = await collect(ctx, driver, trip.tripId, {
      method: 'ONLINE_QR',
      amountPaise: 50_000,
    }).expect(201);
    const collectionId = shown.body.collectionId as string;
    // Paid at Razorpay; the webhook never arrives.
    ctx.links.pay(ctx.links.byCollection(collectionId).referenceId);

    const runs = ctx.app.get(ReconciliationRunsService);
    const recovery = await runs.runNow('COLLECTION_RECOVERY', { trigger: 'SCHEDULE', since });
    expect(recovery).toMatchObject({ status: 'COMPLETED', error: null });
    expect(
      (await owner.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } })).status,
    ).toBe('COMPLETED');
    const reconciliation = await runs.runNow('RECONCILIATION', { trigger: 'SCHEDULE', since });
    expect(reconciliation).toMatchObject({ status: 'COMPLETED', error: null });
    // Every database and provider check could read what it needs.
    const checks = (reconciliation?.summary as { checks: { check: string; note?: string }[] })
      .checks;
    expect(checks.length).toBeGreaterThan(20);
    expect(checks.filter((check) => check.note?.startsWith('failed'))).toEqual([]);

    // The API role's changes are in the log under its own database role.
    const [apiRole] = await ctx.prisma.$queryRaw<{ role: string }[]>`
      SELECT session_user::text AS role`;
    const [ownerRole] = await owner.$queryRaw<{ role: string }[]>`
      SELECT session_user::text AS role`;
    expect(apiRole?.role).not.toBe(ownerRole?.role);
    expect(
      await owner.financialEvent.findMany({
        where: { entityType: 'PAYMENT_COLLECTION', entityId: collectionId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual([
      expect.objectContaining({ action: 'CREATED', actorType: 'DRIVER', dbRole: apiRole?.role }),
      expect.objectContaining({
        action: 'STATUS_CHANGED',
        statusTo: 'COMPLETED',
        actorType: 'SYSTEM',
        requestId: recovery?.id,
        dbRole: apiRole?.role,
      }),
    ]);

    // An admin reads the log and the findings, resolves one, and starts a run.
    for (const path of [
      'audit/financial-events',
      'audit/admin-actions',
      'audit/webhook-events',
      'reconciliation/summary',
      'reconciliation/findings',
      'reconciliation/runs',
      'reconciliation/integrity-checks',
    ]) {
      await request(ctx.server).get(`/v1/admin/${path}`).set(bearer(admin.token)).expect(200);
    }
    const finding = await owner.reconciliationFinding.findFirstOrThrow({
      where: { kind: 'COLLECTION_RECOVERED', entityId: collectionId },
    });
    await request(ctx.server)
      .post(`/v1/admin/reconciliation/findings/${finding.id}/resolve`)
      .set(bearer(admin.token))
      .send({ note: 'Recovered payment checked against Razorpay' })
      .expect(200);
    const started = await request(ctx.server)
      .post('/v1/admin/reconciliation/runs')
      .set(bearer(admin.token))
      .send({ job: 'COLLECTION_RECOVERY', since: since.toISOString() })
      .expect(202);
    let finished = started.body as { id: string; status: string };
    for (let attempt = 0; attempt < 100 && finished.status === 'RUNNING'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      finished = (
        await request(ctx.server)
          .get(`/v1/admin/reconciliation/runs/${finished.id}`)
          .set(bearer(admin.token))
          .expect(200)
      ).body as { id: string; status: string };
    }
    expect(finished.status).toBe('COMPLETED');
  });
});
