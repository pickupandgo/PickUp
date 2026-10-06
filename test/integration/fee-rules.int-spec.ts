import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { runProvisionCommand } from '../../src/cli/provision-commands';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  type TestAdmin,
  uniqueCategory,
  uniquePhone,
  uniqueSubject,
} from '../helpers/fixtures';
import {
  advanceTrip,
  assignDriver,
  engine,
  setTripStatus,
  startBookingPayment,
  TO_DELIVERED,
} from '../helpers/flows';
import { sendWebhook } from '../helpers/http';
import { buildWebhook } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_DATABASE_URL } from '../setup/test-database';

/**
 * Platform fee rules (V1 rule 3): 10% of the confirmed fare, configurable, never hard-coded,
 * versioned (PW 1.6). Bookings keep the rule in effect when they were confirmed.
 */
describe('Platform fee rules', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let owner: PrismaClient;

  // Fee rule changes are rate limited per admin (10/min); spread them over a few admins.
  let admins: TestAdmin[] = [];
  let calls = 0;
  function nextAdmin(): TestAdmin {
    const actor = admins[Math.floor(calls / 6) % admins.length];
    calls += 1;
    if (!actor) {
      throw new Error('admin pool is empty');
    }
    return actor;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    admins = await Promise.all(Array.from({ length: 6 }, () => createAdmin(ctx)));
    owner = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 2 }),
    });
  });

  afterAll(async () => {
    await ctx.close();
    await owner.$disconnect();
  });

  function createRule(body: Record<string, unknown>) {
    return request(ctx.server)
      .post('/v1/admin/fee-rules')
      .set(bearer(nextAdmin().token))
      .send(body);
  }

  async function deactivateAll(category: string | null) {
    const rules = await ctx.prisma.feeRule.findMany({ where: { active: true, category } });
    for (const rule of rules) {
      await request(ctx.server)
        .post(`/v1/admin/fee-rules/${rule.id}/deactivate`)
        .set(bearer(nextAdmin().token))
        .send({ reason: 'Reset by the fee rules test' })
        .expect(200);
    }
  }

  async function register(category: string | null, farePaise = 50_000) {
    const customer = await createCustomer(ctx);
    return engine(ctx)
      .post('/v1/internal/bookings')
      .send({
        externalRef: `FEE-${randomUUID()}`,
        customerSubject: customer.subject,
        ...(category ? { vehicleCategory: category } : {}),
        paymentMethod: 'PREPAID_UPI',
        confirmedFarePaise: farePaise,
      })
      .then((res) => ({ res, customer }));
  }

  /** Pays, delivers and completes a registered prepaid booking; returns its earning. */
  async function complete(bookingId: string, customer: Awaited<ReturnType<typeof createCustomer>>) {
    const driver = await createDriver(ctx);
    const tripId = await assignDriver(ctx, bookingId, driver);
    const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
    await sendWebhook(
      ctx,
      buildWebhook('payment.captured', ctx.razorpay.pay(started.body.checkout.orderId as string)),
    ).expect(200);
    await advanceTrip(ctx, tripId, TO_DELIVERED);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    return ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
  }

  it('with no rule configured, bookings are refused instead of using a hard-coded fee', async () => {
    await deactivateAll(null);
    const { res } = await register(null);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FEE_RULE_NOT_CONFIGURED');
  });

  it('validates rules like the database does', async () => {
    const base = {
      ruleType: 'PERCENTAGE',
      value: '10',
      roundingMode: 'HALF_UP',
      reason: 'Approved V1 platform fee',
    };
    expect((await createRule({ ...base, value: '100' }).expect(400)).body.error.code).toBe(
      'FEE_RULE_INVALID',
    );
    expect((await createRule({ ...base, value: '10.12345' }).expect(400)).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await createRule({ ...base, ruleType: 'FIXED', value: '10.5' }).expect(400)).body.error.code,
    ).toBe('FEE_RULE_INVALID');
    expect((await createRule({ ...base, reason: 'short' }).expect(400)).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await createRule({ ...base, effectiveFrom: '2020-01-01T00:00:00.000Z' }).expect(400)).body
        .error.code,
    ).toBe('FEE_RULE_INVALID');
    const driver = await createDriver(ctx);
    await request(ctx.server)
      .post('/v1/admin/fee-rules')
      .set(bearer(driver.token))
      .send(base)
      .expect(403);
  });

  it('a new version closes the previous one; confirmed bookings keep the rule they were confirmed under', async () => {
    const first = await createRule({
      ruleType: 'PERCENTAGE',
      value: '10',
      roundingMode: 'HALF_UP',
      reason: 'Approved V1 platform fee: 10% of the fare',
    }).expect(201);
    expect(first.body).toMatchObject({
      rule: { value: '10.0000', active: true, effectiveTo: null },
    });

    const before = await register(null, 50_000);
    expect(before.res.status).toBe(201);
    expect(before.res.body.feeRuleId).toBe(first.body.rule.id);

    // roundingMode is optional: fees always round HALF_UP.
    const second = await createRule({
      ruleType: 'PERCENTAGE',
      value: '12',
      reason: 'Example later version for the test',
    }).expect(201);
    expect(second.body.rule.roundingMode).toBe('HALF_UP');
    expect(second.body.superseded).toMatchObject({ id: first.body.rule.id });
    expect(second.body.superseded.effectiveTo).toBe(second.body.rule.effectiveFrom);

    const after = await register(null, 50_000);
    expect(after.res.body.feeRuleId).toBe(second.body.rule.id);

    expect(
      (await complete(before.res.body.bookingId as string, before.customer)).platformFeePaise,
    ).toBe(5_000n);
    expect(
      (await complete(after.res.body.bookingId as string, after.customer)).platformFeePaise,
    ).toBe(6_000n);

    const audit = await ctx.prisma.adminAction.findMany({
      where: { targetId: { in: [first.body.rule.id, second.body.rule.id] } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'FEE_RULE_CREATED',
      'FEE_RULE_CREATED',
      'FEE_RULE_SUPERSEDED',
    ]);

    const preview = await request(ctx.server)
      .get('/v1/admin/fee-rules/preview?farePaise=50000')
      .set(bearer(admin.token))
      .expect(200);
    expect(preview.body).toMatchObject({ feePaise: 6_000, driverSharePaise: 44_000 });
    await deactivateAll(null);
  });

  it('a category rule overrides the default rule; overlapping versions are refused', async () => {
    const category = uniqueCategory();
    const now = Date.now();
    await createRule({
      category,
      ruleType: 'PERCENTAGE',
      value: '8',
      roundingMode: 'HALF_UP',
      reason: 'Category rule for the test',
    }).expect(201);
    const { res } = await register(category, 50_000);
    expect(res.status).toBe(201);
    const pinned = await ctx.prisma.feeRule.findUniqueOrThrow({
      where: { id: res.body.feeRuleId as string },
    });
    expect(pinned.category).toBe(category);

    // A future version supersedes the open-ended rule at its start.
    await createRule({
      category,
      ruleType: 'FIXED',
      value: '2500',
      roundingMode: 'HALF_UP',
      effectiveFrom: new Date(now + 3_600_000).toISOString(),
      reason: 'Future fixed fee for the test',
    }).expect(201);
    const overlap = await createRule({
      category,
      ruleType: 'PERCENTAGE',
      value: '9',
      roundingMode: 'HALF_UP',
      effectiveFrom: new Date(now + 1_800_000).toISOString(),
      reason: 'Overlapping rule for the test',
    }).expect(409);
    expect(overlap.body.error.code).toBe('FEE_RULE_OVERLAP');
  });

  it('fees always round HALF_UP to the nearest paisa: 10% of Rs 123.45 is Rs 12.35', async () => {
    const category = uniqueCategory();
    for (const roundingMode of ['DOWN', 'UP', 'HALF_EVEN']) {
      const refused = await createRule({
        category,
        ruleType: 'PERCENTAGE',
        value: '10',
        roundingMode,
        reason: 'Any other rounding mode is refused',
      }).expect(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    }
    await createRule({
      category,
      ruleType: 'PERCENTAGE',
      value: '10',
      reason: 'HALF_UP rule for the rounding test',
    }).expect(201);
    const preview = await request(ctx.server)
      .get(`/v1/admin/fee-rules/preview?farePaise=12345&category=${category}`)
      .set(bearer(nextAdmin().token))
      .expect(200);
    expect(preview.body).toMatchObject({
      farePaise: 12_345,
      feePaise: 1_235,
      driverSharePaise: 11_110,
    });
    // The database refuses any other rounding mode too.
    await expect(
      owner.$executeRaw`
        INSERT INTO fee_rules (category, rule_type, value, rounding_mode, effective_from, reason)
        VALUES (${uniqueCategory()}, 'PERCENTAGE', 10, 'DOWN', now(), 'forced rounding')`,
    ).rejects.toThrow(/fee_rules_rounding_mode_half_up/);
  });

  it('rules can never be edited or deleted in the database', async () => {
    const category = uniqueCategory();
    const created = await createRule({
      category,
      ruleType: 'PERCENTAGE',
      value: '10',
      roundingMode: 'HALF_UP',
      reason: 'Immutable rule for the test',
    }).expect(201);
    const id = created.body.rule.id as string;
    await expect(
      owner.$executeRaw`UPDATE fee_rules SET value = 1 WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/versioned, never edited/);
    await expect(owner.$executeRaw`DELETE FROM fee_rules WHERE id = ${id}::uuid`).rejects.toThrow(
      /cannot be deleted/,
    );
    const deactivated = await request(ctx.server)
      .post(`/v1/admin/fee-rules/${id}/deactivate`)
      .set(bearer(nextAdmin().token))
      .send({ reason: 'Created by mistake in the test' })
      .expect(200);
    expect(deactivated.body).toMatchObject({
      active: false,
      deactivationReason: 'Created by mistake in the test',
    });
    await expect(
      owner.$executeRaw`UPDATE fee_rules SET active = TRUE WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/cannot be changed/);
  });

  it('the ops CLI creates the fee rule and customer accounts', async () => {
    const category = uniqueCategory();
    const result = await runProvisionCommand(owner, 'firebase', {
      kind: 'create-fee-rule',
      ruleType: 'PERCENTAGE',
      value: '10',
      roundingMode: 'HALF_UP',
      category,
      reason: 'V1 platform fee approved by Nikhil Enterprises',
    });
    expect(result).toMatchObject({
      category,
      ruleType: 'PERCENTAGE',
      value: '10.0000',
      supersededRuleId: null,
    });
    expect(
      await owner.adminAction.count({ where: { targetId: result.feeRuleId, actorUserId: null } }),
    ).toBe(1);

    const subject = uniqueSubject('cli');
    const customer = await runProvisionCommand(owner, 'firebase', {
      kind: 'create-customer',
      phone: uniquePhone(),
      subject,
    });
    expect(customer).toMatchObject({ role: 'CUSTOMER', driverId: null });
    expect(customer.customerId).toEqual(expect.any(String));
    await request(ctx.server)
      .get(`/v1/bookings/${randomUUID()}`)
      .set(bearer(ctx.tokens.sign(subject)))
      .expect(404);
  });
});
