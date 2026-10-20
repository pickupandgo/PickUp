import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import {
  bearer,
  createFeeRule,
  type TestAdmin,
  type TestCustomer,
  type TestDriver,
} from '../helpers/fixtures';
import {
  advanceTrip,
  collect,
  engine,
  fundWallet,
  registerBooking,
  setTripStatus,
  startBookingPayment,
  verifyBookingPayment,
} from '../helpers/flows';
import { walletBalance } from '../helpers/http';
import {
  applyMigrations,
  dropDatabase,
  migrationsAfter,
  migrationsThrough,
  recreateDatabase,
  rowFingerprints,
  tableColumns,
  type TableFingerprint,
  throwawayDatabaseUrl,
} from '../helpers/migration-db';
import { checkoutSignature } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/** The last migration before the payment-flow work: the schema every environment runs today. */
const BEFORE_PAYMENT_FLOW = '20261014120100_fare_quotes';
const DATABASE = 'multipleride_legacy_upgrade_test';
const CATEGORY = 'LEGACY_MINI';
const FARE = 50_000;
/** 10% of the fare, under the rule pinned when these bookings were confirmed. */
const FEE = 5_000;

const SUBJECTS = {
  admin: 'adm_legacy_upgrade',
  customer: 'cus_legacy_upgrade',
  driver: 'drv_legacy_upgrade',
} as const;
const DRIVER_PHONE = '+919800000003';

type TripStep = 'DRIVER_ARRIVED' | 'PICKUP_VERIFIED' | 'IN_TRANSIT' | 'DROP_PROGRESS' | 'DELIVERED';
const TRIP_STEPS: readonly TripStep[] = [
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
];
/** How the release before the payment flow moved a trip (one transition per statement). */
const TRIP_STEP_SQL: Record<TripStep, string> = {
  DRIVER_ARRIVED: `UPDATE trips SET status = 'DRIVER_ARRIVED', arrived_at = now() WHERE id = $1`,
  PICKUP_VERIFIED: `UPDATE trips SET status = 'PICKUP_VERIFIED', pickup_verified_at = now() WHERE id = $1`,
  IN_TRANSIT: `UPDATE trips SET status = 'IN_TRANSIT', started_at = now() WHERE id = $1`,
  DROP_PROGRESS: `UPDATE trips SET status = 'DROP_PROGRESS' WHERE id = $1`,
  DELIVERED: `UPDATE trips SET status = 'DELIVERED', delivered_at = now() WHERE id = $1`,
};

interface LegacyTrip {
  readonly externalRef: string;
  readonly method: 'PREPAID_UPI' | 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';
  /** Where the trip was when the database was upgraded. */
  readonly reached: TripStep;
  readonly bookingId: string;
  readonly tripId: string;
}

function legacyTrip(
  externalRef: string,
  method: LegacyTrip['method'],
  reached: TripStep,
): LegacyTrip {
  return { externalRef, method, reached, bookingId: randomUUID(), tripId: randomUUID() };
}

/**
 * Bookings in flight while the database is upgraded to the payment-flow schema. The database is
 * built from the real migration files up to the release before the payment flow, filled the way
 * that release's code wrote rows, then migrated with the payment-flow migrations and driven
 * through the real API: every historical booking must finish exactly as it would have before.
 */
describe('Upgrading a database with bookings in flight (payment-flow migrations)', () => {
  const ids = {
    adminUser: randomUUID(),
    customerUser: randomUUID(),
    driverUser: randomUUID(),
    customer: randomUUID(),
    driver: randomUUID(),
    feeRule: randomUUID(),
  };
  /** TAB-QR-001: delivered, unpaid, the payment-link QR shown and still open. */
  const qr = {
    ...legacyTrip('TAB-QR-UPGRADE', 'PAY_AT_DELIVERY', 'DELIVERED'),
    collectionId: randomUUID(),
    referenceId: 'plink_UpgradeQr0001',
  };
  /** A QR that expired without a webhook: reconciliation must still report it. */
  const staleQr = {
    ...legacyTrip('TAB-QR-STALE', 'PAY_AT_DELIVERY', 'DELIVERED'),
    collectionId: randomUUID(),
    referenceId: 'plink_UpgradeQr0002',
  };
  /** Delivered, unpaid, nothing collected yet: the driver takes cash. */
  const cash = legacyTrip('TAB-CASH-UPGRADE', 'PAY_AT_DELIVERY', 'DELIVERED');
  /** Prepaid, in transit, with a Checkout order the customer hasn't paid yet. */
  const prepaid = {
    ...legacyTrip('TAB-PREPAID-UPGRADE', 'PREPAID_UPI', 'IN_TRANSIT'),
    paymentId: randomUUID(),
    orderId: 'order_UpgradePrepaid1',
  };
  /** Pay at pickup, the driver at the pickup, not paid yet. */
  const pickup = legacyTrip('TAB-PICKUP-UPGRADE', 'PAY_AT_PICKUP', 'DRIVER_ARRIVED');
  const trips = [qr, staleQr, cash, prepaid, pickup];

  let ctx: TestContext;
  let before: Record<string, TableFingerprint>;
  let after: Record<string, TableFingerprint>;
  let upgraded: { models: unknown[]; stops: number; collectionsForOneDrop: number };
  let admin: TestAdmin;
  let customer: TestCustomer;
  let driver: TestDriver;

  /** Rows exactly as the release before the payment flow wrote them. */
  async function seedLegacyRows(db: Client): Promise<void> {
    await db.query('BEGIN');
    await db.query(
      `INSERT INTO users (id, phone, role)
       VALUES ($1, '+919800000001', 'ADMIN'), ($2, '+919800000002', 'CUSTOMER'), ($3, $4, 'DRIVER')`,
      [ids.adminUser, ids.customerUser, ids.driverUser, DRIVER_PHONE],
    );
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, subject)
       VALUES ($1, 'firebase', $4), ($2, 'firebase', $5), ($3, 'firebase', $6)`,
      [
        ids.adminUser,
        ids.customerUser,
        ids.driverUser,
        SUBJECTS.admin,
        SUBJECTS.customer,
        SUBJECTS.driver,
      ],
    );
    await db.query('INSERT INTO customers (id, user_id) VALUES ($1, $2)', [
      ids.customer,
      ids.customerUser,
    ]);
    await db.query(
      `INSERT INTO drivers (id, user_id, approval_status, approved_at, legal_name)
       VALUES ($1, $2, 'APPROVED', now() - interval '30 days', 'Legacy Driver')`,
      [ids.driver, ids.driverUser],
    );
    await db.query(
      `INSERT INTO fee_rules (id, category, rule_type, value, rounding_mode, effective_from, reason)
       VALUES ($1, $2, 'PERCENTAGE', 10, 'HALF_UP', now() - interval '30 days',
               'Fee rule in force before the upgrade')`,
      [ids.feeRule, CATEGORY],
    );
    for (const trip of trips) {
      await db.query(
        `INSERT INTO bookings (id, external_ref, customer_id, vehicle_category, status,
                               fare_estimate_minor, final_fare_minor, payment_method, fee_rule_id,
                               confirmed_at)
         VALUES ($1, $2, $3, $4, 'DRIVER_ASSIGNED', $5, $5, $6, $7, now() - interval '2 hours')`,
        [trip.bookingId, trip.externalRef, ids.customer, CATEGORY, FARE, trip.method, ids.feeRule],
      );
      await db.query(
        `INSERT INTO trips (id, booking_id, driver_id, assigned_at)
         VALUES ($1, $2, $3, now() - interval '2 hours')`,
        [trip.tripId, trip.bookingId, ids.driver],
      );
      for (const step of TRIP_STEPS.slice(0, TRIP_STEPS.indexOf(trip.reached) + 1)) {
        await db.query(TRIP_STEP_SQL[step], [trip.tripId]);
      }
    }
    for (const [open, expiresIn] of [
      [qr, "interval '25 minutes'"],
      [staleQr, "interval '-1 hour'"],
    ] as const) {
      await db.query(
        `INSERT INTO payment_collections (id, booking_id, trip_id, stage, method, amount_paise,
                                          collected_by_driver_id, status, provider,
                                          provider_product, provider_reference_id,
                                          provider_link_url, idempotency_key, expires_at)
         VALUES ($1, $2, $3, 'DELIVERY', 'ONLINE_QR', $4, $5, 'PENDING', 'RAZORPAY',
                 'PAYMENT_LINK', $6, $7, $8, now() + ${expiresIn})`,
        [
          open.collectionId,
          open.bookingId,
          open.tripId,
          FARE,
          ids.driver,
          open.referenceId,
          `https://rzp.io/i/${open.referenceId.slice(6, 14)}`,
          `legacy-qr-${open.collectionId}`,
        ],
      );
    }
    await db.query(
      `INSERT INTO payments (id, booking_id, user_id, purpose, razorpay_order_id, amount_paise,
                             idempotency_key)
       VALUES ($1, $2, $3, 'BOOKING', $4, $5, $6)`,
      [prepaid.paymentId, prepaid.bookingId, ids.customerUser, prepaid.orderId, FARE, randomUUID()],
    );
    await db.query('COMMIT');
  }

  beforeAll(async () => {
    await recreateDatabase(DATABASE);
    const db = new Client({ connectionString: throwawayDatabaseUrl(DATABASE) });
    await db.connect();
    try {
      await db.query("SET TIME ZONE 'UTC'");
      await applyMigrations(db, migrationsThrough(BEFORE_PAYMENT_FLOW));
      await seedLegacyRows(db);
      const columns = await tableColumns(db);
      before = await rowFingerprints(db, columns);

      await applyMigrations(db, migrationsAfter(BEFORE_PAYMENT_FLOW));
      after = await rowFingerprints(db, columns);
      const models = await db.query(
        'SELECT payment_model, count(*)::int AS bookings FROM bookings GROUP BY 1 ORDER BY 1',
      );
      const stops = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM booking_stops');
      const forOneDrop = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM payment_collections WHERE booking_stop_id IS NOT NULL',
      );
      upgraded = {
        models: models.rows,
        stops: stops.rows[0]?.n ?? -1,
        collectionsForOneDrop: forOneDrop.rows[0]?.n ?? -1,
      };
    } finally {
      await db.end();
    }

    ctx = await createTestApp({ databaseUrl: throwawayDatabaseUrl(DATABASE) });
    admin = {
      userId: ids.adminUser,
      subject: SUBJECTS.admin,
      token: ctx.tokens.sign(SUBJECTS.admin),
    };
    customer = {
      userId: ids.customerUser,
      customerId: ids.customer,
      subject: SUBJECTS.customer,
      token: ctx.tokens.sign(SUBJECTS.customer),
    };
    driver = {
      userId: ids.driverUser,
      driverId: ids.driver,
      subject: SUBJECTS.driver,
      phone: DRIVER_PHONE,
      token: ctx.tokens.sign(SUBJECTS.driver, { phoneNumber: DRIVER_PHONE }),
    };
  });

  afterAll(async () => {
    await ctx?.close();
    await dropDatabase(DATABASE);
  });

  const booking = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const tripOf = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });
  const earningOf = (bookingId: string) =>
    ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });

  it('changes no stored value, marks every booking as historical and invents no stops', () => {
    expect(Object.keys(before).length).toBeGreaterThan(20);
    expect(after).toEqual(before);
    expect(upgraded).toEqual({
      models: [{ payment_model: 'LEGACY_BOOKING_LEVEL', bookings: trips.length }],
      stops: 0,
      collectionsForOneDrop: 0,
    });
  });

  it('TAB-QR-001: the QR shown before the upgrade is refreshed, paid and completes the trip', async () => {
    ctx.links.adopt({
      product: 'PAYMENT_LINK',
      referenceId: qr.referenceId,
      collectionId: qr.collectionId,
      bookingId: qr.bookingId,
      amount: FARE,
      url: `https://rzp.io/i/${qr.referenceId.slice(6, 14)}`,
      expiresAt: new Date(Date.now() + 20 * 60_000),
    });
    const view = await request(ctx.server)
      .get(`/v1/trips/${qr.tripId}`)
      .set(bearer(driver.token))
      .expect(200);
    expect(view.body.payment).toMatchObject({
      method: 'PAY_AT_DELIVERY',
      collectionStage: 'DELIVERY',
      collectionOpen: true,
      platformFeePaise: FEE,
    });

    const refresh = () =>
      request(ctx.server)
        .get(`/v1/trips/${qr.tripId}/collections/${qr.collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
    expect((await refresh()).body.status).toBe('PENDING');
    const payment = ctx.links.pay(qr.referenceId);
    expect((await refresh()).body).toMatchObject({
      status: 'COMPLETED',
      providerPaymentId: payment.id,
    });

    expect((await booking(qr.bookingId)).paymentStatus).toBe('PAID');
    expect((await tripOf(qr.tripId)).status).toBe('PAYMENT_CONFIRMED');
    await setTripStatus(ctx, qr.tripId, 'COMPLETED').expect(200);
    expect(await earningOf(qr.bookingId)).toMatchObject({
      settlement: 'ONLINE',
      grossAmountPaise: BigInt(FARE),
      platformFeePaise: BigInt(FEE),
      netAmountPaise: BigInt(FARE - FEE),
    });
  });

  it('an unpaid delivery is collected in cash with the fee of the rule pinned before the upgrade', async () => {
    // A later rule version doubles the fee for new bookings of this category.
    await request(ctx.server)
      .post('/v1/admin/fee-rules')
      .set(bearer(admin.token))
      .send({
        category: CATEGORY,
        ruleType: 'PERCENTAGE',
        value: '20',
        roundingMode: 'HALF_UP',
        reason: 'A later fee rule version after the upgrade',
      })
      .expect(201);
    await fundWallet(ctx, admin, driver.driverId, 20_000);
    const balance = await walletBalance(ctx, driver.driverId);

    const res = await collect(ctx, driver, cash.tripId, {
      method: 'CASH',
      amountPaise: FARE,
    }).expect(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', platformFeePaise: FEE });
    expect(await walletBalance(ctx, driver.driverId)).toBe(balance - BigInt(FEE));
    expect((await tripOf(cash.tripId)).status).toBe('PAYMENT_CONFIRMED');
    await setTripStatus(ctx, cash.tripId, 'COMPLETED').expect(200);
    expect(await earningOf(cash.bookingId)).toMatchObject({
      settlement: 'CASH',
      platformFeePaise: BigInt(FEE),
    });
  });

  it('a prepaid booking with a Checkout order from before the upgrade is paid and verified', async () => {
    ctx.razorpay.registerExternalOrder(prepaid.orderId, FARE, prepaid.paymentId);
    const started = await startBookingPayment(ctx, customer, prepaid.bookingId).expect(201);
    // The same order: a booking has one live payment.
    expect(started.body).toMatchObject({ paymentId: prepaid.paymentId });
    expect(started.body.checkout.orderId).toBe(prepaid.orderId);

    const paid = ctx.razorpay.pay(prepaid.orderId);
    await verifyBookingPayment(ctx, customer, prepaid.bookingId, {
      razorpayOrderId: prepaid.orderId,
      razorpayPaymentId: paid.id,
      razorpaySignature: checkoutSignature(prepaid.orderId, paid.id),
    }).expect(200);
    expect((await booking(prepaid.bookingId)).paymentStatus).toBe('PAID');

    await advanceTrip(ctx, prepaid.tripId, ['DROP_PROGRESS', 'DELIVERED']);
    expect((await tripOf(prepaid.tripId)).status).toBe('PAYMENT_CONFIRMED');
    await setTripStatus(ctx, prepaid.tripId, 'COMPLETED').expect(200);
    expect(await earningOf(prepaid.bookingId)).toMatchObject({
      settlement: 'ONLINE',
      platformFeePaise: BigInt(FEE),
    });
  });

  it('a pickup booking that reached the pickup before the upgrade is collected there', async () => {
    await fundWallet(ctx, admin, driver.driverId, 20_000);
    const res = await collect(ctx, driver, pickup.tripId, {
      method: 'CASH',
      amountPaise: FARE,
    }).expect(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', platformFeePaise: FEE });
    await advanceTrip(ctx, pickup.tripId, [
      'PICKUP_VERIFIED',
      'IN_TRANSIT',
      'DROP_PROGRESS',
      'DELIVERED',
    ]);
    await setTripStatus(ctx, pickup.tripId, 'COMPLETED').expect(200);
    expect(await earningOf(pickup.bookingId)).toMatchObject({
      settlement: 'CASH',
      platformFeePaise: BigInt(FEE),
    });
  });

  it('reconciliation still reports the QR that expired before the upgrade', async () => {
    const res = await request(ctx.server)
      .get('/v1/admin/reconciliation/stale-collections')
      .set(bearer(admin.token))
      .expect(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          problem: 'PENDING_PAST_EXPIRY',
          bookingId: staleQr.bookingId,
          collectionId: staleQr.collectionId,
        }),
      ]),
    );
  });

  it('historical bookings stay historical; new bookings on the upgraded database are priced per drop', async () => {
    const historical = await ctx.prisma.booking.findMany({
      where: { id: { in: trips.map((trip) => trip.bookingId) } },
      include: { stops: true },
    });
    expect(historical).toHaveLength(trips.length);
    for (const row of historical) {
      expect(row).toMatchObject({
        paymentModel: 'LEGACY_BOOKING_LEVEL',
        fareQuoteId: null,
        platformFeePaise: null,
        stops: [],
      });
    }

    await createFeeRule(ctx.prisma, { category: 'UPGRADE_NEW', value: '10' });
    const bookingId = await registerBooking(ctx, customer, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 30_000,
      dropPaise: [10_000, 20_000],
      category: 'UPGRADE_NEW',
    });
    const created = await engine(ctx).get(`/v1/internal/bookings/${bookingId}`).expect(200);
    expect(created.body).toMatchObject({
      paymentModel: 'QUOTE_PER_STOP',
      payablePaise: 30_000,
      platformFeePaise: 3_000,
      stops: [
        { sequence: 1, payablePaise: 10_000, status: 'PENDING' },
        { sequence: 2, payablePaise: 20_000, status: 'PENDING' },
      ],
    });
  });
});
