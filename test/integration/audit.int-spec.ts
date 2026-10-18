import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma } from '../../src/generated/prisma/client';
import { WalletService } from '../../src/wallet/wallet.service';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createFeeRule,
  idempotencyKey,
  type TestAdmin,
  type TestDriver,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  bookedTrip,
  collect,
  fundWallet,
  setTripStatus,
  startBookingPayment,
} from '../helpers/flows';
import { sendWebhook, startTopUp } from '../helpers/http';
import { buildWebhook } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

const ROLLED_BACK = 'rolled back on purpose';

interface EventBody {
  readonly id: string;
  readonly entityType: string;
  readonly action: string;
  readonly actorType: string;
}

/**
 * The financial event log (payment flow Phase 7): every change to a financial record is written
 * by a database trigger in the same transaction, with who made it (the request's principal, the
 * trip engine, a signed webhook, a job, or nobody known), the request id, the route and what
 * changed. Nobody can change or remove an event, the table owner included; admins read it.
 */
describe('Financial event log and audit trail (payment flow Phase 7)', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let category: string;
  /** The database role the test app connects as (the owner in this suite). */
  let ownerRole: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
    const [row] = await ctx.prisma.$queryRaw<{ role: string }[]>`SELECT session_user::text AS role`;
    ownerRole = row?.role ?? 'unknown';
  });

  afterAll(async () => {
    await ctx.close();
  });

  const requestId = () => `audit-${randomUUID()}`;
  const eventsOf = (where: Prisma.FinancialEventWhereInput) =>
    ctx.prisma.financialEvent.findMany({ where, orderBy: { id: 'asc' } });
  const listEvents = (query: Record<string, string | number>, token = admin.token) =>
    request(ctx.server).get('/v1/admin/audit/financial-events').query(query).set(bearer(token));
  const pickupBooking = async (driver: TestDriver) =>
    bookedTrip(ctx, await createCustomer(ctx), driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model: 'QUOTE_PER_STOP',
      dropPaise: [20_000, 30_000],
    });
  /** Events whose admin_actions row has this target id (the log keeps the row without details). */
  const actionEventsFor = (targetId: string) =>
    ctx.prisma.$queryRaw<
      { actor_type: string; actor_user_id: string | null; db_role: string; action: string }[]
    >`
      SELECT actor_type, actor_user_id::text AS actor_user_id, db_role, action
        FROM financial_events
       WHERE entity_type = 'ADMIN_ACTION' AND changes ->> 'target_id' = ${targetId}`;

  it('records each change with who made it, in which request, and what changed', async () => {
    const driver = await createDriver(ctx);
    const customer = await createCustomer(ctx);
    const wallet = await ctx.app.get(WalletService).ensureWalletForDriver(driver.driverId);
    const funding = requestId();
    await request(ctx.server)
      .post(`/v1/admin/wallets/${wallet.id}/adjustments`)
      .set(bearer(admin.token))
      .set('Idempotency-Key', idempotencyKey())
      .set('X-Request-Id', funding)
      .send({ direction: 'CREDIT', amountPaise: 100_000, reason: 'Audit trail test funding' })
      .expect(201);
    expect(await eventsOf({ requestId: funding })).toEqual([
      expect.objectContaining({
        entityType: 'WALLET_TRANSACTION',
        action: 'CREATED',
        actorType: 'ADMIN',
        actorUserId: admin.userId,
        driverId: driver.driverId,
        amountPaise: 100_000n,
        origin: 'POST /v1/admin/wallets/:walletId/adjustments',
        dbRole: ownerRole,
      }),
    ]);

    // The trip engine registers and assigns the booking.
    const { bookingId, tripId } = await pickupBooking(driver);
    const [registered] = await eventsOf({ entityType: 'BOOKING', entityId: bookingId });
    expect(registered).toMatchObject({
      action: 'CREATED',
      actorType: 'ENGINE',
      actorUserId: null,
      bookingId,
      amountPaise: 50_000n,
      origin: 'POST /v1/internal/bookings',
      requestId: expect.any(String),
    });
    const [assigned] = await eventsOf({ entityType: 'TRIP', entityId: tripId });
    expect(assigned).toMatchObject({
      action: 'CREATED',
      actorType: 'ENGINE',
      bookingId,
      driverId: driver.driverId,
      origin: 'POST /v1/internal/bookings/:bookingId/assign',
    });

    // The driver collects the fare in cash: the collection, its fee debit and the booking's payment
    // status change, committed together under the driver's request.
    await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
    const cash = requestId();
    const collected = await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 })
      .set('X-Request-Id', cash)
      .expect(201);
    expect(collected.headers['x-request-id']).toBe(cash);
    const collectionId = collected.body.collectionId as string;
    const byDriver = await eventsOf({ requestId: cash });
    expect(byDriver.map((event) => `${event.entityType} ${event.action}`)).toEqual(
      expect.arrayContaining([
        'PAYMENT_COLLECTION CREATED',
        'WALLET_TRANSACTION CREATED',
        'BOOKING PAYMENT_STATUS_CHANGED',
      ]),
    );
    for (const event of byDriver) {
      expect(event).toMatchObject({
        actorType: 'DRIVER',
        actorUserId: driver.userId,
        origin: 'POST /v1/trips/:tripId/collections',
        dbRole: ownerRole,
      });
    }
    expect(new Set(byDriver.map((event) => event.transactionId)).size).toBe(1);
    expect(byDriver.find((event) => event.entityType === 'PAYMENT_COLLECTION')).toMatchObject({
      entityId: collectionId,
      statusTo: 'COMPLETED',
      bookingId,
      driverId: driver.driverId,
      amountPaise: 50_000n,
      changes: expect.objectContaining({ id: collectionId, method: 'CASH', amount_paise: 50_000 }),
    });
    expect(byDriver.find((event) => event.entityType === 'BOOKING')).toMatchObject({
      statusFrom: 'UNPAID',
      statusTo: 'PAID',
      changes: expect.objectContaining({ payment_status: { from: 'UNPAID', to: 'PAID' } }),
    });
    expect(byDriver.find((event) => event.entityType === 'WALLET_TRANSACTION')).toMatchObject({
      bookingId,
      driverId: driver.driverId,
      amountPaise: 5_000n,
    });

    // A signed webhook: the provider and its event id.
    const { paymentId, orderId } = await startTopUp(ctx, driver, 20_000);
    expect(await eventsOf({ entityType: 'PAYMENT', entityId: paymentId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'CREATED',
          actorType: 'DRIVER',
          actorUserId: driver.userId,
          driverId: driver.driverId,
          statusTo: 'PENDING',
          origin: 'POST /v1/wallet/topups',
        }),
      ]),
    );
    const webhook = buildWebhook('payment.captured', ctx.razorpay.pay(orderId));
    await sendWebhook(ctx, webhook).expect(200);
    const byProvider = await eventsOf({ providerEventId: webhook.eventId });
    expect(byProvider.map((event) => `${event.entityType} ${event.action}`).sort()).toEqual([
      'PAYMENT STATUS_CHANGED',
      'WALLET_TRANSACTION CREATED',
    ]);
    for (const event of byProvider) {
      expect(event).toMatchObject({
        actorType: 'PROVIDER',
        actorUserId: null,
        driverId: driver.driverId,
        origin: 'webhook razorpay payment.captured',
      });
    }

    // A customer starts the payment of a historical prepaid booking. The booking itself was
    // inserted by a fixture as the table owner, outside any request: unattributed.
    const prepaid = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PREPAID_UPI',
      farePaise: 30_000,
      category,
    });
    await startBookingPayment(ctx, customer, prepaid.bookingId).expect(201);
    expect(
      await eventsOf({ entityType: 'PAYMENT', bookingId: prepaid.bookingId, action: 'CREATED' }),
    ).toEqual([
      expect.objectContaining({
        actorType: 'CUSTOMER',
        actorUserId: customer.userId,
        amountPaise: 30_000n,
        origin: 'POST /v1/bookings/:bookingId/payment',
      }),
    ]);
    expect(
      await eventsOf({ entityType: 'BOOKING', entityId: prepaid.bookingId, action: 'CREATED' }),
    ).toEqual([
      expect.objectContaining({
        actorType: 'UNATTRIBUTED',
        actorUserId: null,
        requestId: null,
        origin: null,
        dbRole: ownerRole,
      }),
    ]);
  });

  it('records an operator SQL change as unattributed, and never believes a forged actor', async () => {
    const targetId = randomUUID();
    await ctx.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.actor_type', 'SUPERUSER', true),
               set_config('app.actor_user_id', 'not-a-user-id', true)`;
      await tx.$executeRaw`
        INSERT INTO admin_actions (action, target_type, target_id, reason)
        VALUES ('AUDIT_TEST_NOTE', 'BOOKING', ${targetId}, 'An operator note written in SQL')`;
    });
    expect(await actionEventsFor(targetId)).toEqual([
      { actor_type: 'UNATTRIBUTED', actor_user_id: null, db_role: ownerRole, action: 'CREATED' },
    ]);
  });

  it('is append-only for every role, the table owner included', async () => {
    const [latest] = await ctx.prisma.financialEvent.findMany({ orderBy: { id: 'desc' }, take: 1 });
    if (!latest) {
      throw new Error('expected events from the tests above');
    }
    const id = latest.id.toString();
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE financial_events SET origin = 'rewritten' WHERE id = ${id}::bigint`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM financial_events WHERE id = ${id}::bigint`,
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`TRUNCATE financial_events`).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO financial_events (occurred_at, transaction_id, entity_type, entity_id, action,
                                      changes, actor_type, db_role)
        VALUES (now(), 1, 'BOOKING', gen_random_uuid(), 'CREATED', '{}', 'ADMIN', 'forger')`,
    ).rejects.toThrow(/written only by the financial record triggers/);
    expect(await ctx.prisma.financialEvent.findUniqueOrThrow({ where: { id: latest.id } })).toEqual(
      latest,
    );
  });

  it('writes nothing for a change that rolls back', async () => {
    const targetId = randomUUID();
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.adminAction.create({
          data: { action: 'AUDIT_TEST_NOTE', targetType: 'BOOKING', targetId, reason: 'gone' },
        });
        throw new Error(ROLLED_BACK);
      }),
    ).rejects.toThrow(ROLLED_BACK);
    expect(await actionEventsFor(targetId)).toEqual([]);

    // A request the service refuses leaves nothing behind either.
    const driver = await createDriver(ctx);
    const { bookingId, tripId } = await pickupBooking(driver);
    await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
    const before = await ctx.prisma.financialEvent.count({ where: { bookingId } });
    const refused = requestId();
    const res = await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 49_999 }).set(
      'X-Request-Id',
      refused,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.financialEvent.count({ where: { requestId: refused } })).toBe(0);
    expect(await ctx.prisma.financialEvent.count({ where: { bookingId } })).toBe(before);
  });

  it('applies and records a payment once, however often its webhook is delivered', async () => {
    const driver = await createDriver(ctx);
    const { paymentId, orderId } = await startTopUp(ctx, driver, 15_000);
    const payment = ctx.razorpay.pay(orderId);
    const webhook = buildWebhook('payment.captured', payment);
    await sendWebhook(ctx, webhook).expect(200);
    await sendWebhook(ctx, webhook).expect(200);
    await sendWebhook(ctx, buildWebhook('payment.captured', payment)).expect(200);
    await sendWebhook(ctx, buildWebhook('order.paid', payment)).expect(200);

    const changes = await eventsOf({
      entityType: 'PAYMENT',
      entityId: paymentId,
      action: 'STATUS_CHANGED',
    });
    expect(changes).toEqual([
      expect.objectContaining({
        statusFrom: 'PENDING',
        statusTo: 'PAID',
        actorType: 'PROVIDER',
        providerEventId: webhook.eventId,
      }),
    ]);
    expect(
      await ctx.prisma.financialEvent.count({
        where: { entityType: 'WALLET_TRANSACTION', driverId: driver.driverId },
      }),
    ).toBe(1);
  });

  it('keeps concurrent requests apart', async () => {
    const drivers = await Promise.all(Array.from({ length: 6 }, () => createDriver(ctx)));
    const ids = drivers.map(() => requestId());
    const started = await Promise.all(
      drivers.map((driver, index) =>
        request(ctx.server)
          .post('/v1/wallet/topups')
          .set(bearer(driver.token))
          .set('Idempotency-Key', idempotencyKey())
          .set('X-Request-Id', ids[index] ?? requestId())
          .send({ amountPaise: 10_000 + index })
          .expect(201),
      ),
    );
    for (const [index, res] of started.entries()) {
      const events = await eventsOf({
        entityType: 'PAYMENT',
        entityId: res.body.paymentId as string,
      });
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event).toMatchObject({
          requestId: ids[index],
          actorType: 'DRIVER',
          actorUserId: drivers[index]?.userId,
          driverId: drivers[index]?.driverId,
          amountPaise: BigInt(10_000 + index),
        });
      }
    }
  });

  it('is for admins only, and validates its filters', async () => {
    const driver = await createDriver(ctx);
    const customer = await createCustomer(ctx);
    for (const path of ['financial-events', 'admin-actions', 'webhook-events']) {
      const url = `/v1/admin/audit/${path}`;
      await request(ctx.server).get(url).expect(401);
      await request(ctx.server).get(url).set(bearer(driver.token)).expect(403);
      await request(ctx.server).get(url).set(bearer(customer.token)).expect(403);
      await request(ctx.server).get(url).set(bearer(admin.token)).expect(200);
    }
    const invalid: Record<string, string | number>[] = [
      { limit: 0 },
      { limit: 201 },
      { cursor: 'abc' },
      { entityType: 'WALLET' },
      { actorType: 'ROOT' },
      { bookingId: 'not-a-uuid' },
      { from: 'yesterday' },
    ];
    for (const query of invalid) {
      const res = await listEvents(query).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('pages through a booking trail in both directions, and shows it on the booking chain', async () => {
    const driver = await createDriver(ctx);
    await fundWallet(ctx, admin, driver.driverId, 50_000);
    const { bookingId, tripId } = await pickupBooking(driver);
    await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
    await collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }).expect(201);
    const all = (await eventsOf({ bookingId })).map((event) => event.id.toString());
    expect(all.length).toBeGreaterThanOrEqual(6);

    for (const order of ['asc', 'desc'] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await listEvents({
          bookingId,
          order,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        const items = res.body.items as EventBody[];
        expect(items.length).toBeLessThanOrEqual(2);
        seen.push(...items.map((item) => item.id));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      expect(seen).toEqual(order === 'asc' ? all : [...all].reverse());
    }

    const byDriver = await listEvents({ bookingId, actorType: 'DRIVER' }).expect(200);
    expect((byDriver.body.items as EventBody[]).length).toBeGreaterThan(0);
    expect((byDriver.body.items as EventBody[]).every((item) => item.actorType === 'DRIVER')).toBe(
      true,
    );

    const chain = await request(ctx.server)
      .get(`/v1/admin/bookings/${bookingId}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(chain.body.auditTrailComplete).toBe(true);
    const trail = chain.body.auditTrail as EventBody[];
    expect(trail.map((event) => event.id)).toEqual(all);
    expect(trail[0]).toMatchObject({
      entityType: 'BOOKING',
      action: 'CREATED',
      actorType: 'ENGINE',
    });
  });

  it('lists admin decisions and provider webhooks, without the webhook payload', async () => {
    const driver = await createDriver(ctx);
    const { orderId } = await startTopUp(ctx, driver, 11_000);
    const payment = ctx.razorpay.pay(orderId);
    const webhook = buildWebhook('payment.captured', payment);
    await sendWebhook(ctx, webhook).expect(200);
    const webhooks = await request(ctx.server)
      .get('/v1/admin/audit/webhook-events')
      .query({ eventId: webhook.eventId })
      .set(bearer(admin.token))
      .expect(200);
    expect(webhooks.body.items).toEqual([
      expect.objectContaining({
        source: 'RAZORPAY',
        eventId: webhook.eventId,
        eventType: 'payment.captured',
        entityId: payment.id,
        entityStatus: 'captured',
        outcome: 'APPLIED',
        processingError: null,
      }),
    ]);
    expect(webhooks.body.items[0]).not.toHaveProperty('payload');
    // The payment entity names the customer's contact; it never leaves the server.
    expect(JSON.stringify(webhooks.body)).not.toContain('void@razorpay.com');

    const auditor = await createAdmin(ctx);
    await request(ctx.server)
      .post('/v1/admin/settlements/sync')
      .set(bearer(auditor.token))
      .send({})
      .expect(200);
    const actions = await request(ctx.server)
      .get('/v1/admin/audit/admin-actions')
      .query({ actorUserId: auditor.userId })
      .set(bearer(admin.token))
      .expect(200);
    expect(actions.body.items).toEqual([
      expect.objectContaining({
        actorUserId: auditor.userId,
        action: 'SETTLEMENT_SYNC_REQUESTED',
        targetType: 'MERCHANT_SETTLEMENTS',
      }),
    ]);
    // ... and the decision is on the event log, attributed to that admin.
    expect(await eventsOf({ entityType: 'ADMIN_ACTION', actorUserId: auditor.userId })).toEqual([
      expect.objectContaining({ actorType: 'ADMIN', origin: 'POST /v1/admin/settlements/sync' }),
    ]);
  });
});
