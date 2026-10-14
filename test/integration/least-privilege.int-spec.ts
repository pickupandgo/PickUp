import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { FareQuoteRedeemer } from '../../src/fare/fare-contract';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
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
  engine,
  fundWallet,
  requestBankAccountChange,
  sendPayoutWebhook,
  setTripStatus,
  startBookingPayment,
  TO_DELIVERED,
  verifyBookingPayment,
} from '../helpers/flows';
import { sendWebhook, startTopUp, verifyTopUp, walletBalance } from '../helpers/http';
import {
  buildPayoutWebhook,
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

    // Cash trip: wallet fee debit, completion, cash earning.
    await fundWallet(ctx, admin, driver.driverId, 10_000);
    const cash = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 50_000,
      category,
    });
    await advanceTrip(ctx, cash.tripId, TO_DELIVERED);
    await collect(ctx, driver, cash.tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
    await setTripStatus(ctx, cash.tripId, 'COMPLETED').expect(200);

    // QR trip: payment link paid, refreshed by the driver app, online earning.
    const qr = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 30_000,
      category,
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

    // Prepaid trip: customer pays in the app, verified with Razorpay.
    const prepaid = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 20_000,
      category,
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
    // Razorpay settles the prepaid and QR payments; the admin sync records them (API role).
    ctx.settlements.settle({ providerPaymentId: paid.id, amountPaise: 20_000 });
    ctx.settlements.settle({ providerPaymentId: qrPayment.id, amountPaise: 30_000 });
    const synced = await request(ctx.server)
      .post('/v1/admin/settlements/sync')
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(synced.body).toMatchObject({ recorded: 2, earningsPromoted: 2 });
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
    expect(await walletBalance(ctx, driver.driverId)).toBe(5_000n);
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
});
