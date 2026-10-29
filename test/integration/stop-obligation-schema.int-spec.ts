import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import {
  createAdmin,
  createCustomer,
  createFeeRule,
  createLegacyBooking,
  type TestAdmin,
  type TestCustomer,
  type TestDriver,
  uniqueCategory,
} from '../helpers/fixtures';
import { assignDriver, registerBooking } from '../helpers/flows';
import { createTestApp, type TestContext } from '../helpers/test-app';

const ROLLED_BACK = 'rolled back on purpose';

/**
 * The per-stop obligation schema (payment flow Phase 2, migration
 * 20261016120000_per_stop_obligation_schema). It prepares the database: stops gain the facts
 * their lifecycle records and collections can name the drop they are for, while per-drop
 * collection stays refused (Phase 4). The stop lifecycle itself is Phase 3 (delivery-stops).
 * Everything here is checked from the table owner, so it holds even for a code path that forgot a
 * rule; lifecycle states are written with only the stop guard turned off, inside transactions that
 * never commit, so the CHECKs are the only thing tested.
 */
describe('Per-stop obligation schema', () => {
  let ctx: TestContext;
  let category: string;
  let admin: TestAdmin;
  let customer: TestCustomer;
  let driver: TestDriver;

  beforeAll(async () => {
    ctx = await createTestApp();
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
    admin = await createAdmin(ctx);
    customer = await createCustomer(ctx);
    driver = await createHistoricalEligibleDriver(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** A booking registered from a quote, assigned to the driver, with its stops in order. */
  async function perStopBooking(
    paymentMethod: 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY',
    dropPaise: readonly number[],
  ) {
    const bookingId = await registerBooking(ctx, customer, {
      paymentMethod,
      farePaise: dropPaise.reduce((sum, paise) => sum + paise, 0),
      dropPaise,
      category,
      model: 'QUOTE_PER_STOP',
    });
    const tripId = await assignDriver(ctx, bookingId, driver);
    const stops = await ctx.prisma.bookingStop.findMany({
      where: { bookingId },
      orderBy: { sequence: 'asc' },
    });
    return { bookingId, tripId, stopIds: stops.map((stop) => stop.id), stops };
  }

  async function legacyDeliveryBooking() {
    const booking = await createLegacyBooking(ctx.prisma, {
      customerId: customer.customerId,
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 50_000,
      category,
    });
    const tripId = await assignDriver(ctx, booking.id, driver);
    return { bookingId: booking.id, tripId };
  }

  function nth(ids: readonly string[], index: number): string {
    const id = ids[index];
    if (!id) {
      throw new Error(`expected an id at ${index}`);
    }
    return id;
  }

  /**
   * Runs `work` in a transaction that never commits. Resolves when `work` succeeded; rejects with
   * the database error otherwise.
   */
  async function rolledBack(work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Error(ROLLED_BACK);
      }),
    ).rejects.toThrow(ROLLED_BACK);
  }

  async function refused(
    pattern: RegExp,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Error(ROLLED_BACK);
      }),
    ).rejects.toThrow(pattern);
  }

  /** Only the stop guard (the lifecycle rules) is turned off, for this transaction. */
  const stopGuardOff = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`ALTER TABLE booking_stops DISABLE TRIGGER trg_booking_stops_guard`;
  const collectionGuardOff = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`ALTER TABLE payment_collections DISABLE TRIGGER trg_collections_insert_guard`;

  /** A QR collection row, written directly (no API), so the database is the only check. */
  function insertQr(
    db: Pick<Prisma.TransactionClient, '$executeRaw'>,
    row: {
      bookingId: string;
      tripId: string;
      stopId?: string | null;
      stage?: 'PICKUP' | 'DELIVERY';
      amountPaise: bigint;
      status?: 'PENDING' | 'FAILED';
    },
  ) {
    const status = row.status ?? 'PENDING';
    return db.$executeRaw`
      INSERT INTO payment_collections (booking_id, booking_stop_id, trip_id, stage, method,
                                       amount_paise, collected_by_driver_id, status, provider,
                                       provider_product, provider_reference_id, idempotency_key,
                                       failure_reason)
      VALUES (${row.bookingId}::uuid, ${row.stopId ?? null}::uuid, ${row.tripId}::uuid,
              ${row.stage ?? 'DELIVERY'}, 'ONLINE_QR', ${row.amountPaise}, ${driver.driverId}::uuid,
              ${status}, 'RAZORPAY', 'QR_CODE', ${`qr_${randomUUID()}`}, ${randomUUID()},
              ${status === 'FAILED' ? 'EXPIRED' : null})`;
  }

  describe('booking stops', () => {
    it('start PENDING with no lifecycle facts, and move only through the stop lifecycle', async () => {
      const { stops } = await perStopBooking('PAY_AT_DELIVERY', [20_000, 30_000]);
      for (const stop of stops) {
        expect(stop).toMatchObject({
          status: 'PENDING',
          arrivedAt: null,
          paymentConfirmedAt: null,
          deliveredAt: null,
          failedAt: null,
          failureReason: null,
          cancelledAt: null,
          resolvedAt: null,
          resolvedByUserId: null,
          resolutionReason: null,
        });
      }
      const first = nth(
        stops.map((stop) => stop.id),
        0,
      );
      // Phase 3's stop guard: the trip has not left the pickup, so no drop can be reached yet.
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE booking_stops SET status = 'ARRIVED', arrived_at = now() WHERE id = ${first}::uuid`,
      ).rejects.toThrow(/A drop is reached only while its trip is under way/);
    });

    // Constant SQL from the table below; no user input involved.
    it.each([
      ['PENDING with an arrival time', 'arrived_at = now()', /booking_stops_pending_is_untouched/],
      ['ARRIVED without an arrival time', "status = 'ARRIVED'", /booking_stops_status_facts/],
      [
        'PAYMENT_CONFIRMED without its time',
        "status = 'PAYMENT_CONFIRMED', arrived_at = now()",
        /booking_stops_status_facts/,
      ],
      [
        'DELIVERED without a delivery time',
        "status = 'DELIVERED', arrived_at = now()",
        /booking_stops_status_facts/,
      ],
      [
        'DELIVERY_FAILED without a reason',
        "status = 'DELIVERY_FAILED', arrived_at = now(), failed_at = now()",
        /booking_stops_failure_complete/,
      ],
      [
        'a failure reason without a failure',
        "status = 'ARRIVED', arrived_at = now(), failure_reason = 'Receiver not at home'",
        /booking_stops_failure_complete/,
      ],
      [
        'a failed attempt before reaching the drop',
        "status = 'CANCELLED', cancelled_at = now(), failed_at = now(), failure_reason = 'Receiver not at home'",
        /booking_stops_facts_follow_arrival/,
      ],
      [
        'a blank failure reason',
        "status = 'DELIVERY_FAILED', arrived_at = now(), failed_at = now(), failure_reason = '  '",
        /booking_stops_reasons_not_blank/,
      ],
      [
        'UNDELIVERED without an admin resolution',
        "status = 'UNDELIVERED', arrived_at = now(), failed_at = now(), failure_reason = 'Receiver not at home'",
        /booking_stops_status_facts/,
      ],
      [
        'a resolution that does not say who resolved it',
        "status = 'UNDELIVERED', arrived_at = now(), failed_at = now(), failure_reason = 'Receiver not at home', resolved_at = now(), resolution_reason = 'Customer cancelled this drop'",
        /booking_stops_resolution_complete/,
      ],
      ['CANCELLED without its time', "status = 'CANCELLED'", /booking_stops_status_facts/],
    ])('refuses a stop with %s', async (_label, assignments, constraint) => {
      const { stopIds } = await perStopBooking('PAY_AT_DELIVERY', [20_000]);
      await refused(constraint, async (tx) => {
        await stopGuardOff(tx);
        await tx.$executeRaw(
          Prisma.sql`UPDATE booking_stops SET ${Prisma.raw(assignments)} WHERE id = ${nth(stopIds, 0)}::uuid`,
        );
      });
    });

    it('records every status with its facts (positive control)', async () => {
      const { stopIds } = await perStopBooking('PAY_AT_DELIVERY', [10_000, 20_000, 30_000, 40_000]);
      await rolledBack(async (tx) => {
        await stopGuardOff(tx);
        const [first, second, third, fourth] = stopIds;
        await tx.$executeRaw`
          UPDATE booking_stops
             SET status = 'DELIVERED', arrived_at = now(), payment_confirmed_at = now(),
                 delivered_at = now()
           WHERE id = ${first}::uuid`;
        await tx.$executeRaw`
          UPDATE booking_stops
             SET status = 'UNDELIVERED', arrived_at = now(), failed_at = now(),
                 failure_reason = 'Receiver not at home', resolved_at = now(),
                 resolved_by_user_id = ${admin.userId}::uuid,
                 resolution_reason = 'Customer confirmed this drop is cancelled'
           WHERE id = ${second}::uuid`;
        await tx.$executeRaw`
          UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', arrived_at = now(),
                 payment_confirmed_at = now()
           WHERE id = ${third}::uuid`;
        await tx.$executeRaw`
          UPDATE booking_stops SET status = 'CANCELLED', cancelled_at = now() WHERE id = ${fourth}::uuid`;
      });
    });

    it('allows at most one current stop per booking', async () => {
      const { stopIds } = await perStopBooking('PAY_AT_DELIVERY', [20_000, 30_000]);
      const other = await perStopBooking('PAY_AT_DELIVERY', [20_000]);
      const arrive = (tx: Prisma.TransactionClient, id: string, status = 'ARRIVED') =>
        tx.$executeRaw(
          Prisma.sql`UPDATE booking_stops SET status = ${status}::booking_stop_status,
                       arrived_at = now(),
                       payment_confirmed_at = CASE WHEN ${status} = 'PAYMENT_CONFIRMED' THEN now() END
                     WHERE id = ${id}::uuid`,
        );

      for (const firstStatus of ['ARRIVED', 'PAYMENT_CONFIRMED']) {
        await refused(/uq_booking_stops_current/, async (tx) => {
          await stopGuardOff(tx);
          await arrive(tx, nth(stopIds, 0), firstStatus);
          await arrive(tx, nth(stopIds, 1));
        });
      }
      // Once the first drop is done, the next one can be current; other bookings are separate.
      await rolledBack(async (tx) => {
        await stopGuardOff(tx);
        await tx.$executeRaw`
          UPDATE booking_stops SET status = 'DELIVERED', arrived_at = now(), delivered_at = now()
           WHERE id = ${nth(stopIds, 0)}::uuid`;
        await arrive(tx, nth(stopIds, 1));
        await arrive(tx, nth(other.stopIds, 0));
      });
    });
  });

  describe('collections for a single drop', () => {
    it('only a drop of a pay-at-delivery booking priced per drop can be named, and per-drop collection stays off', async () => {
      const pickup = await perStopBooking('PAY_AT_PICKUP', [40_000]);
      const delivery = await perStopBooking('PAY_AT_DELIVERY', [20_000, 30_000]);
      const legacy = await legacyDeliveryBooking();

      await expect(
        insertQr(ctx.prisma, {
          bookingId: pickup.bookingId,
          tripId: pickup.tripId,
          stopId: nth(pickup.stopIds, 0),
          stage: 'PICKUP',
          amountPaise: 40_000n,
        }),
      ).rejects.toThrow(
        /Only a drop of a pay-at-delivery booking priced per drop is collected on its own/,
      );
      await expect(
        insertQr(ctx.prisma, {
          bookingId: legacy.bookingId,
          tripId: legacy.tripId,
          stopId: nth(delivery.stopIds, 0),
          amountPaise: 50_000n,
        }),
      ).rejects.toThrow(
        /Only a drop of a pay-at-delivery booking priced per drop is collected on its own/,
      );
      // Payment flow Phase 4: a drop is collected on its own, and only while the driver is at it
      // (the trip has not even started here).
      await expect(
        insertQr(ctx.prisma, {
          bookingId: delivery.bookingId,
          tripId: delivery.tripId,
          stopId: nth(delivery.stopIds, 0),
          amountPaise: 20_000n,
        }),
      ).rejects.toThrow(/Only the drop the driver is at, before it is paid, is collected/);
      await expect(
        insertQr(ctx.prisma, {
          bookingId: delivery.bookingId,
          tripId: delivery.tripId,
          stopId: null,
          amountPaise: 20_000n,
        }),
      ).rejects.toThrow(/A pay-at-delivery booking priced per drop is collected drop by drop/);
      expect(
        await ctx.prisma.paymentCollection.count({
          where: { bookingId: { in: [pickup.bookingId, delivery.bookingId, legacy.bookingId] } },
        }),
      ).toBe(0);
    });

    it('keeps the shape even with the insert guard off: no stop at pickup, only a stop of the same booking', async () => {
      const pickup = await perStopBooking('PAY_AT_PICKUP', [40_000]);
      const delivery = await perStopBooking('PAY_AT_DELIVERY', [20_000, 30_000]);
      const elsewhere = await perStopBooking('PAY_AT_DELIVERY', [20_000]);
      await refused(/collections_pickup_has_no_stop/, async (tx) => {
        await collectionGuardOff(tx);
        await insertQr(tx, {
          bookingId: pickup.bookingId,
          tripId: pickup.tripId,
          stopId: nth(pickup.stopIds, 0),
          stage: 'PICKUP',
          amountPaise: 40_000n,
        });
      });
      await refused(/payment_collections_booking_id_booking_stop_id_fkey/, async (tx) => {
        await collectionGuardOff(tx);
        await insertQr(tx, {
          bookingId: delivery.bookingId,
          tripId: delivery.tripId,
          stopId: nth(elsewhere.stopIds, 0),
          amountPaise: 20_000n,
        });
      });
    });

    it('allows one live collection per booking-level obligation, exactly as before', async () => {
      const legacy = await legacyDeliveryBooking();
      await refused(/uq_collection_booking_level_active/, async (tx) => {
        await insertQr(tx, {
          bookingId: legacy.bookingId,
          tripId: legacy.tripId,
          amountPaise: 50_000n,
        });
        await insertQr(tx, {
          bookingId: legacy.bookingId,
          tripId: legacy.tripId,
          amountPaise: 50_000n,
        });
      });
      // A failed QR doesn't block a new one.
      await rolledBack(async (tx) => {
        await insertQr(tx, {
          bookingId: legacy.bookingId,
          tripId: legacy.tripId,
          amountPaise: 50_000n,
          status: 'FAILED',
        });
        await insertQr(tx, {
          bookingId: legacy.bookingId,
          tripId: legacy.tripId,
          amountPaise: 50_000n,
        });
      });
    });

    it('allows one live collection per drop once per-drop collection exists (guard off)', async () => {
      const delivery = await perStopBooking('PAY_AT_DELIVERY', [20_000, 30_000]);
      const [first, second] = delivery.stopIds;
      const forDrop = (
        tx: Prisma.TransactionClient,
        stopId: string | undefined,
        status?: 'FAILED',
      ) =>
        insertQr(tx, {
          bookingId: delivery.bookingId,
          tripId: delivery.tripId,
          stopId,
          amountPaise: 20_000n,
          status,
        });
      await rolledBack(async (tx) => {
        await collectionGuardOff(tx);
        await forDrop(tx, first);
        await forDrop(tx, second);
        await forDrop(tx, first, 'FAILED');
      });
      await refused(/uq_collection_stop_active/, async (tx) => {
        await collectionGuardOff(tx);
        await forDrop(tx, first);
        await forDrop(tx, first);
      });
    });

    it('never changes the drop a collection is for', async () => {
      const legacy = await legacyDeliveryBooking();
      const delivery = await perStopBooking('PAY_AT_DELIVERY', [20_000]);
      await insertQr(ctx.prisma, {
        bookingId: legacy.bookingId,
        tripId: legacy.tripId,
        amountPaise: 50_000n,
      });
      const stopId = nth(delivery.stopIds, 0);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE payment_collections SET booking_stop_id = ${stopId}::uuid
           WHERE booking_id = ${legacy.bookingId}::uuid`,
      ).rejects.toThrow(/Collection amounts and references are immutable/);
      expect(
        await ctx.prisma.paymentCollection.findFirstOrThrow({
          where: { bookingId: legacy.bookingId },
        }),
      ).toMatchObject({ bookingStopId: null, status: 'PENDING' });
    });
  });
});
