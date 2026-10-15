import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma } from '../../src/generated/prisma/client';
import {
  bearer,
  createCustomer,
  createDriver,
  createFareQuote,
  createFeeRule,
  createLegacyBooking,
  createPricingVersion,
  fixturePricingVersion,
  type TestCustomer,
  type TestQuote,
  uniqueCategory,
} from '../helpers/fixtures';
import {
  advanceTrip,
  assignDriver,
  collect,
  engine,
  setStopStatus,
  setTripStatus,
  TO_IN_TRANSIT,
} from '../helpers/flows';
import { createTestApp, type TestContext } from '../helpers/test-app';

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected an item at index ${index}`);
  }
  return item;
}

/**
 * Booking registration v2 (payment flow Phase 1, docs/PAYMENT_FLOW_FINAL_REVIEW.md C and K).
 * Every new booking is priced from a fare quote: the quote is redeemed once, its amounts are
 * frozen on the booking and on one stop per drop, and the platform fee is frozen and split
 * across the drops. The engine sends no amount. PREPAID_UPI is refused for new bookings.
 *
 * The database enforces the same rules on its own, so they are also checked from the table
 * owner (which a code path that forgot a rule would have): every refusal there comes with a
 * positive control showing an exact copy is accepted.
 */
describe('Booking registration from fare quotes', () => {
  let ctx: TestContext;
  let pricingVersionId: string;
  /** 10% PERCENTAGE fee rule. */
  let category: string;
  let feeRuleId: string;
  /** FIXED fee of 1,001 paise. */
  let fixedCategory: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    pricingVersionId = (await fixturePricingVersion(ctx.prisma)).id;
    category = uniqueCategory();
    feeRuleId = (await createFeeRule(ctx.prisma, { category, value: '10' })).id;
    fixedCategory = uniqueCategory();
    await createFeeRule(ctx.prisma, { category: fixedCategory, ruleType: 'FIXED', value: '1001' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const quoteFor = (
    customer: TestCustomer,
    dropPaise: readonly number[],
    extra: Partial<Parameters<typeof createFareQuote>[1]> = {},
  ) =>
    createFareQuote(ctx.prisma, {
      customerId: customer.customerId,
      pricingVersionId,
      dropPaise,
      vehicleCategory: category,
      ...extra,
    });

  const registration = (
    customer: TestCustomer,
    quoteId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    externalRef: `ENG-${randomUUID()}`,
    customerSubject: customer.subject,
    quoteId,
    paymentMethod: 'PAY_AT_PICKUP',
    ...overrides,
  });

  const register = (body: Record<string, unknown>) =>
    engine(ctx).post('/v1/internal/bookings').send(body);

  const redeemedAt = async (quoteId: string) =>
    (await ctx.prisma.fareQuote.findUniqueOrThrow({ where: { id: quoteId } })).redeemedAt;

  const feeShares = async (bookingId: string) =>
    (
      await ctx.prisma.bookingStop.findMany({
        where: { bookingId },
        orderBy: { sequence: 'asc' },
      })
    ).map((stop) => stop.platformFeeSharePaise);

  describe('registration', () => {
    it('freezes the quote on the booking and on one stop per drop, with the fee split exactly', async () => {
      const customer = await createCustomer(ctx);
      const quote = await quoteFor(customer, [10_001, 20_003, 30_007]);
      const res = await register(
        registration(customer, quote.quoteId, { paymentMethod: 'PAY_AT_DELIVERY' }),
      ).expect(201);
      expect(res.body).toMatchObject({
        status: 'CREATED',
        paymentMethod: 'PAY_AT_DELIVERY',
        paymentStatus: 'UNPAID',
        paymentModel: 'QUOTE_PER_STOP',
        quoteId: quote.quoteId,
        pricingVersionId,
        vehicleCategory: category,
        feeRuleId,
        farePaise: 60_011,
        taxPaise: 0,
        payablePaise: 60_011,
        // 10% of Rs 600.11 is Rs 60.011: half up to 6,001 paise.
        platformFeePaise: 6_001,
        stops: [
          { sequence: 1, payablePaise: 10_001, status: 'PENDING' },
          { sequence: 2, payablePaise: 20_003, status: 'PENDING' },
          { sequence: 3, payablePaise: 30_007, status: 'PENDING' },
        ],
        trip: null,
      });

      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: res.body.bookingId as string },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });
      expect(booking).toMatchObject({
        farePaise: 60_011n,
        taxPaise: 0n,
        fareEstimateMinor: 60_011n,
        finalFareMinor: 60_011n,
        platformFeePaise: 6_001n,
      });
      // Proportional shares are 1000.08, 2000.27 and 3000.65: the floors add up to 6,000 and
      // the paisa left goes to the largest remainder, the third drop.
      expect(booking.stops.map((stop) => stop.platformFeeSharePaise)).toEqual([
        1_000n,
        2_000n,
        3_001n,
      ]);
      expect(booking.stops.map((stop) => stop.fareQuoteStopId)).toEqual(quote.stopIds);
      // Redeemed by this booking, at its confirmation.
      expect(await redeemedAt(quote.quoteId)).toEqual(booking.confirmedAt);
    });

    it('rounds a percentage fee half up and takes a fixed fee as is, as the database checks', async () => {
      const customer = await createCustomer(ctx);
      // 10% of Rs 100.05 is exactly Rs 10.005: half up to 1,001 paise.
      const half = await quoteFor(customer, [3_335, 6_670]);
      const halfBooked = await register(registration(customer, half.quoteId)).expect(201);
      expect(halfBooked.body.platformFeePaise).toBe(1_001);
      // Shares 333.67 and 667.33: the paisa left goes to the first drop.
      expect(await feeShares(halfBooked.body.bookingId as string)).toEqual([334n, 667n]);

      const fixed = await quoteFor(customer, [25_000, 25_000], { vehicleCategory: fixedCategory });
      const fixedBooked = await register(registration(customer, fixed.quoteId)).expect(201);
      expect(fixedBooked.body.platformFeePaise).toBe(1_001);
      // Equal drops tie on the remainder: the lower sequence gets the paisa.
      expect(await feeShares(fixedBooked.body.bookingId as string)).toEqual([501n, 500n]);
    });

    it('shows a historical booking without a snapshot: no quote, no stops, the pinned fee', async () => {
      const customer = await createCustomer(ctx);
      const legacy = await createLegacyBooking(ctx.prisma, {
        customerId: customer.customerId,
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 50_000,
        category,
      });
      const res = await engine(ctx).get(`/v1/internal/bookings/${legacy.id}`).expect(200);
      expect(res.body).toMatchObject({
        paymentModel: 'LEGACY_BOOKING_LEVEL',
        quoteId: null,
        pricingVersionId: null,
        farePaise: 50_000,
        taxPaise: 0,
        payablePaise: 50_000,
        platformFeePaise: 5_000,
        stops: [],
      });
    });

    it('refuses PREPAID_UPI for a new booking and leaves the quote bookable', async () => {
      const customer = await createCustomer(ctx);
      const quote = await quoteFor(customer, [20_000]);
      const body = registration(customer, quote.quoteId, { paymentMethod: 'PREPAID_UPI' });
      const res = await register(body).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'PAYMENT_METHOD_NOT_OFFERED',
        details: { offered: ['PAY_AT_PICKUP', 'PAY_AT_DELIVERY'] },
      });
      // A retry is refused the same way: there is no way to book it as prepaid.
      await register(body).expect(422);
      expect(
        await ctx.prisma.booking.count({ where: { externalRef: body.externalRef as string } }),
      ).toBe(0);
      expect(await redeemedAt(quote.quoteId)).toBeNull();

      await register({ ...body, paymentMethod: 'PAY_AT_DELIVERY' }).expect(201);
    });

    it('never accepts an amount from the engine, and validates the request', async () => {
      const customer = await createCustomer(ctx);
      const quote = await quoteFor(customer, [20_000]);
      for (const tampered of [
        { farePaise: 1 },
        { fareEstimateMinor: 1 },
        { finalFareMinor: 1 },
        { payablePaise: 1 },
        { amountPaise: 1 },
        { taxPaise: 0 },
        { platformFeePaise: 0 },
        { feeRuleId: randomUUID() },
        { pricingVersionId: randomUUID() },
        { paymentModel: 'LEGACY_BOOKING_LEVEL' },
        { vehicleCategory: category },
        { stops: [{ sequence: 1, payablePaise: 1 }] },
      ]) {
        const res = await register(registration(customer, quote.quoteId, tampered)).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      for (const invalid of [
        { quoteId: undefined },
        { quoteId: 'not-a-quote' },
        { paymentMethod: undefined },
        { paymentMethod: 'CASH' },
        { externalRef: 'has spaces' },
        { customerSubject: 'not a subject' },
      ]) {
        const res = await register(registration(customer, quote.quoteId, invalid)).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await redeemedAt(quote.quoteId)).toBeNull();
    });

    it('requires an unexpired, unused quote of the same customer', async () => {
      const customer = await createCustomer(ctx);
      const other = await createCustomer(ctx);

      const missing = await register(registration(customer, randomUUID())).expect(422);
      expect(missing.body.error.code).toBe('QUOTE_NOT_FOUND');

      // Another customer's quote looks exactly like a missing one, and stays theirs.
      const theirs = await quoteFor(other, [20_000]);
      const stolen = await register(registration(customer, theirs.quoteId)).expect(422);
      expect(stolen.body.error.code).toBe('QUOTE_NOT_FOUND');
      expect(await redeemedAt(theirs.quoteId)).toBeNull();
      await register(registration(other, theirs.quoteId)).expect(201);

      const expired = await quoteFor(customer, [20_000], {
        createdAt: new Date(Date.now() - 20 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000),
      });
      const late = await register(registration(customer, expired.quoteId)).expect(409);
      expect(late.body.error.code).toBe('QUOTE_EXPIRED');
      expect(await redeemedAt(expired.quoteId)).toBeNull();

      const quote = await quoteFor(customer, [20_000]);
      await register(registration(customer, quote.quoteId)).expect(201);
      const reused = await register(registration(customer, quote.quoteId)).expect(409);
      expect(reused.body.error.code).toBe('QUOTE_ALREADY_USED');
      expect(await ctx.prisma.booking.count({ where: { fareQuoteId: quote.quoteId } })).toBe(1);

      const fresh = await quoteFor(customer, [20_000]);
      const unknown = await register(
        registration(customer, fresh.quoteId, { customerSubject: 'nobody_registered' }),
      ).expect(422);
      expect(unknown.body.error.code).toBe('CUSTOMER_NOT_FOUND');
      expect(await redeemedAt(fresh.quoteId)).toBeNull();
    });

    it('refuses a quote with tax until a tax rule is approved, without using it', async () => {
      const customer = await createCustomer(ctx);
      const taxed = await quoteFor(customer, [20_000], { dropTaxPaise: [3_600] });
      const res = await register(registration(customer, taxed.quoteId)).expect(422);
      expect(res.body.error.code).toBe('TAX_NOT_SUPPORTED');
      expect(await redeemedAt(taxed.quoteId)).toBeNull();
    });

    it('books up to the database ceiling of 25 drops, and the database refuses a 26th', async () => {
      const customer = await createCustomer(ctx);
      // The business limit (FARE_MAX_DROPS) is applied when quoting; the database only holds
      // the technical ceiling, so raising the limit later needs no migration.
      const widest = await quoteFor(
        customer,
        Array.from({ length: 25 }, () => 1_000),
      );
      const booked = await register(registration(customer, widest.quoteId)).expect(201);
      expect(booked.body.stops).toHaveLength(25);
      expect(booked.body.platformFeePaise).toBe(2_500);
      expect(await feeShares(booked.body.bookingId as string)).toEqual(
        Array.from({ length: 25 }, () => 100n),
      );

      await expect(
        quoteFor(
          customer,
          Array.from({ length: 26 }, () => 1_000),
        ),
      ).rejects.toThrow(/fare_quote_stops_sequence_range/);
    });
  });

  describe('idempotency on externalRef', () => {
    it('replays the same registration and refuses the ref with any other terms', async () => {
      const customer = await createCustomer(ctx);
      const other = await createCustomer(ctx);
      const quote = await quoteFor(customer, [10_000, 15_000]);
      const body = registration(customer, quote.quoteId);
      const first = await register(body).expect(201);
      const replay = await register(body).expect(200);
      expect(replay.body).toEqual(first.body);
      expect(
        await ctx.prisma.booking.count({ where: { externalRef: body.externalRef as string } }),
      ).toBe(1);
      expect(
        await ctx.prisma.bookingStop.count({
          where: { bookingId: first.body.bookingId as string },
        }),
      ).toBe(2);

      const anotherQuote = await quoteFor(customer, [10_000, 15_000]);
      for (const changed of [
        { quoteId: anotherQuote.quoteId },
        { paymentMethod: 'PAY_AT_DELIVERY' },
        { customerSubject: other.subject },
      ]) {
        const res = await register({ ...body, ...changed }).expect(409);
        expect(res.body.error.code).toBe('BOOKING_REF_CONFLICT');
      }
      expect(await redeemedAt(anotherQuote.quoteId)).toBeNull();
    });

    it('never registers a historical booking ref again through a quote', async () => {
      const customer = await createCustomer(ctx);
      const legacy = await createLegacyBooking(ctx.prisma, {
        customerId: customer.customerId,
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        category,
      });
      const quote = await quoteFor(customer, [20_000]);
      const res = await register(
        registration(customer, quote.quoteId, {
          externalRef: legacy.externalRef,
          paymentMethod: 'PAY_AT_DELIVERY',
        }),
      ).expect(409);
      expect(res.body.error.code).toBe('BOOKING_REF_CONFLICT');
      expect(await redeemedAt(quote.quoteId)).toBeNull();
      expect(await ctx.prisma.booking.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(
        legacy,
      );
    });

    it('creates one booking when identical registrations race', async () => {
      const customer = await createCustomer(ctx);
      const quote = await quoteFor(customer, [10_000, 15_000]);
      const body = registration(customer, quote.quoteId);
      const results = await Promise.all(Array.from({ length: 6 }, () => register(body)));
      expect(results.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect(new Set(results.map((res) => res.body.bookingId as string)).size).toBe(1);
      expect(
        await ctx.prisma.booking.count({ where: { externalRef: body.externalRef as string } }),
      ).toBe(1);
      expect(
        await ctx.prisma.bookingStop.count({
          where: { booking: { externalRef: body.externalRef as string } },
        }),
      ).toBe(2);
    });

    it('lets one quote win a ref that races with several; the others stay unused', async () => {
      const customer = await createCustomer(ctx);
      const quotes = await Promise.all([0, 1, 2].map(() => quoteFor(customer, [20_000])));
      const externalRef = `ENG-${randomUUID()}`;
      const results = await Promise.all(
        quotes.map((quote) => register(registration(customer, quote.quoteId, { externalRef }))),
      );
      const created = results.filter((res) => res.status === 201);
      const refused = results.filter((res) => res.status !== 201);
      expect(created).toHaveLength(1);
      expect(refused.map((res) => [res.status, res.body.error.code])).toEqual([
        [409, 'BOOKING_REF_CONFLICT'],
        [409, 'BOOKING_REF_CONFLICT'],
      ]);

      const winner = nth(created, 0).body.quoteId as string;
      const states = await ctx.prisma.fareQuote.findMany({
        where: { id: { in: quotes.map((quote) => quote.quoteId) } },
      });
      expect(states.filter((state) => state.redeemedAt !== null).map((state) => state.id)).toEqual([
        winner,
      ]);
      expect(await ctx.prisma.booking.count({ where: { externalRef } })).toBe(1);
    });

    it('books a quote once when it races under different refs', async () => {
      const customer = await createCustomer(ctx);
      const quote = await quoteFor(customer, [20_000]);
      const results = await Promise.all(
        [0, 1, 2, 3].map(() => register(registration(customer, quote.quoteId))),
      );
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(
        results.filter((res) => res.status !== 201).map((res) => [res.status, res.body.error.code]),
      ).toEqual([
        [409, 'QUOTE_ALREADY_USED'],
        [409, 'QUOTE_ALREADY_USED'],
        [409, 'QUOTE_ALREADY_USED'],
      ]);
      expect(await ctx.prisma.booking.count({ where: { fareQuoteId: quote.quoteId } })).toBe(1);
    });
  });

  describe('collection of a booking paid drop by drop', () => {
    it('refuses a whole-booking delivery collection for a per-stop booking, in the API and the database', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const quote = await quoteFor(customer, [20_000, 30_000]);
      const booked = await register(
        registration(customer, quote.quoteId, { paymentMethod: 'PAY_AT_DELIVERY' }),
      ).expect(201);
      const bookingId = booked.body.bookingId as string;
      const tripId = await assignDriver(ctx, bookingId, driver);
      // Delivered drop by drop: the driver is at the first drop, which is owed now.
      await advanceTrip(ctx, tripId, TO_IN_TRANSIT);
      await setStopStatus(ctx, tripId, 1, 'ARRIVED').expect(200);

      // The driver app is offered the drop the driver is at (payment flow Phase 4), never the
      // whole booking.
      const view = await request(ctx.server)
        .get(`/v1/trips/${tripId}`)
        .set(bearer(driver.token))
        .expect(200);
      expect(view.body.payment).toMatchObject({
        collectionStage: 'DELIVERY',
        collectionOpen: true,
        paymentGate: {
          stage: 'DROP',
          stopSequence: 1,
          paymentState: 'PAYMENT_REQUIRED',
          amountPaise: 20_000,
          handoverAllowed: false,
        },
      });

      for (const method of ['CASH', 'ONLINE_QR'] as const) {
        const res = await collect(ctx, driver, tripId, { method, amountPaise: 50_000 }).expect(422);
        expect(res.body.error.code).toBe('STOP_REQUIRED');
      }
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(0);
      expect([...ctx.links.links.values()].filter((link) => link.bookingId === bookingId)).toEqual(
        [],
      );
      // Still unpaid: the drop can't be handed over, and the trip can't complete.
      const handover = await setStopStatus(ctx, tripId, 1, 'DELIVERED').expect(409);
      expect(handover.body.error).toMatchObject({
        code: 'PAYMENT_REQUIRED',
        details: { stage: 'DROP', stopSequence: 1, amountPaise: 20_000 },
      });
      const gate = await setTripStatus(ctx, tripId, 'COMPLETED').expect(409);
      expect(gate.body.error.code).toBe('PAYMENT_REQUIRED');

      await expect(
        ctx.prisma.paymentCollection.create({
          data: {
            bookingId,
            tripId,
            stage: 'DELIVERY',
            method: 'CASH',
            amountPaise: 50_000n,
            collectedByDriverId: driver.driverId,
            platformFeePaise: 5_000n,
            feeRuleId,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow(/A pay-at-delivery booking priced per drop is collected drop by drop/);
    });

    it('the database holds a pickup collection to the booking amount and its frozen fee', async () => {
      const customer = await createCustomer(ctx);
      const driver = await createDriver(ctx);
      const quote = await quoteFor(customer, [40_000]);
      const booked = await register(registration(customer, quote.quoteId)).expect(201);
      const bookingId = booked.body.bookingId as string;
      const tripId = await assignDriver(ctx, bookingId, driver);
      const cash = {
        bookingId,
        tripId,
        stage: 'PICKUP',
        method: 'CASH',
        amountPaise: 40_000n,
        collectedByDriverId: driver.driverId,
        platformFeePaise: 4_000n,
        feeRuleId,
      };
      const insert = (data: Partial<typeof cash>) =>
        ctx.prisma.paymentCollection.create({
          data: { ...cash, ...data, idempotencyKey: randomUUID() },
        });

      await expect(insert({ platformFeePaise: 3_999n })).rejects.toThrow(
        /must debit the booking's frozen platform fee/,
      );
      await expect(insert({ amountPaise: 39_999n })).rejects.toThrow(
        /must be for the booking's payable amount/,
      );
      await expect(insert({ stage: 'DELIVERY' })).rejects.toThrow(
        /cannot be collected at stage DELIVERY/,
      );
      expect(await ctx.prisma.paymentCollection.count({ where: { bookingId } })).toBe(0);
    });
  });

  describe('database guards (table owner)', () => {
    let customer: TestCustomer;
    let otherCustomer: TestCustomer;
    let otherVersionId: string;
    let otherCategoryRuleId: string;
    let closedCategory: string;
    let closedRuleId: string;

    beforeAll(async () => {
      customer = await createCustomer(ctx);
      otherCustomer = await createCustomer(ctx);
      otherVersionId = (await createPricingVersion(ctx.prisma, { active: false })).id;
      otherCategoryRuleId = (await createFeeRule(ctx.prisma, { category: uniqueCategory() })).id;
      // A rule for its own category that was closed an hour ago.
      closedCategory = uniqueCategory();
      closedRuleId = (
        await ctx.prisma.feeRule.create({
          data: {
            category: closedCategory,
            ruleType: 'PERCENTAGE',
            value: '10',
            roundingMode: 'HALF_UP',
            effectiveFrom: new Date(Date.now() - 2 * 3_600_000),
            effectiveTo: new Date(Date.now() - 3_600_000),
            reason: 'Integration test: a closed fee rule',
          },
        })
      ).id;
    });

    interface Snapshot {
      readonly quote: TestQuote;
      readonly booking: Prisma.BookingUncheckedCreateInput;
      readonly stops: Omit<Prisma.BookingStopUncheckedCreateInput, 'bookingId'>[];
      /** When the quote is marked redeemed; null leaves it unredeemed. */
      readonly redeemedAt: Date | null;
    }

    /**
     * The rows a correct registration writes for a fresh two-drop quote (Rs 200 + Rs 300 under
     * the 10% rule: fee 5,000 split 2,000 / 3,000), for a test to change one thing.
     */
    async function exactSnapshot(
      quoteOptions: Partial<Parameters<typeof createFareQuote>[1]> = {},
    ): Promise<Snapshot> {
      const quote = await quoteFor(customer, [20_000, 30_000], quoteOptions);
      const confirmedAt = new Date();
      return {
        quote,
        redeemedAt: confirmedAt,
        booking: {
          externalRef: `OWNER-${randomUUID()}`,
          customerId: customer.customerId,
          vehicleCategory: quoteOptions.vehicleCategory ?? category,
          fareEstimateMinor: 50_000n,
          finalFareMinor: 50_000n,
          paymentMethod: 'PAY_AT_PICKUP',
          feeRuleId,
          paymentModel: 'QUOTE_PER_STOP',
          fareQuoteId: quote.quoteId,
          pricingVersionId,
          farePaise: 50_000n,
          taxPaise: 0n,
          platformFeePaise: 5_000n,
          confirmedAt,
        },
        stops: [20_000n, 30_000n].map((paise, index) => ({
          fareQuoteStopId: nth(quote.stopIds, index),
          sequence: index + 1,
          farePaise: paise,
          taxPaise: 0n,
          payablePaise: paise,
          platformFeeSharePaise: index === 0 ? 2_000n : 3_000n,
        })),
      };
    }

    /** Writes a snapshot in one transaction, as registration does (the deferred checks run at commit). */
    function write(snapshot: Snapshot) {
      return ctx.prisma.$transaction(async (tx) => {
        if (snapshot.redeemedAt) {
          await tx.fareQuote.update({
            where: { id: snapshot.quote.quoteId },
            data: { redeemedAt: snapshot.redeemedAt },
          });
        }
        const booking = await tx.booking.create({ data: snapshot.booking });
        if (snapshot.stops.length > 0) {
          await tx.bookingStop.createMany({
            data: snapshot.stops.map((stop) => ({ ...stop, bookingId: booking.id })),
          });
        }
        return booking;
      });
    }

    const changed = (
      snapshot: Snapshot,
      booking: Partial<Prisma.BookingUncheckedCreateInput>,
    ): Snapshot => ({ ...snapshot, booking: { ...snapshot.booking, ...booking } });

    it('accepts an exact copy of a redeemed quote (positive control)', async () => {
      const snapshot = await exactSnapshot();
      const booking = await write(snapshot);
      expect(booking.paymentModel).toBe('QUOTE_PER_STOP');
      expect(await feeShares(booking.id)).toEqual([2_000n, 3_000n]);
    });

    it('refuses PREPAID_UPI and bookings not priced from a quote, even from the table owner', async () => {
      const snapshot = await exactSnapshot();
      await expect(write(changed(snapshot, { paymentMethod: 'PREPAID_UPI' }))).rejects.toThrow(
        /PREPAID_UPI is no longer offered/,
      );
      await expect(
        write({
          ...changed(snapshot, {
            paymentModel: 'LEGACY_BOOKING_LEVEL',
            paymentMethod: 'PAY_AT_DELIVERY',
            fareQuoteId: null,
            pricingVersionId: null,
            farePaise: null,
            taxPaise: null,
            platformFeePaise: null,
          }),
          redeemedAt: null,
          stops: [],
        }),
      ).rejects.toThrow(/must be priced from a fare quote/);
      expect(await redeemedAt(snapshot.quote.quoteId)).toBeNull();
    });

    it.each<[string, () => Partial<Prisma.BookingUncheckedCreateInput>]>([
      ['another customer', () => ({ customerId: otherCustomer.customerId })],
      ['another pricing version', () => ({ pricingVersionId: otherVersionId })],
      ['another vehicle category', () => ({ vehicleCategory: 'SOME_OTHER_CATEGORY' })],
      [
        'another fare',
        () => ({ farePaise: 50_001n, fareEstimateMinor: 50_001n, finalFareMinor: 50_001n }),
      ],
      ['another payable amount', () => ({ fareEstimateMinor: 50_001n, finalFareMinor: 50_001n })],
    ])('refuses a booking that does not copy its quote: %s', async (_label, booking) => {
      const snapshot = await exactSnapshot();
      await expect(write(changed(snapshot, booking()))).rejects.toThrow(
        /must copy the customer, pricing version, category and amounts of its fare quote/,
      );
    });

    it('refuses a booking whose quote was not redeemed for it, at its confirmation, in time', async () => {
      const unredeemed = await exactSnapshot();
      await expect(write({ ...unredeemed, redeemedAt: null })).rejects.toThrow(
        /must be redeemed, unexpired, for this booking at its confirmation/,
      );

      // Quoted a minute ago, so an earlier redemption is still inside the quote's validity.
      const earlier = await exactSnapshot({ createdAt: new Date(Date.now() - 60_000) });
      const confirmedAt = earlier.booking.confirmedAt as Date;
      await expect(
        write({ ...earlier, redeemedAt: new Date(confirmedAt.getTime() - 1_000) }),
      ).rejects.toThrow(/must be redeemed, unexpired, for this booking at its confirmation/);

      // Redeemed and confirmed at the very instant it expired.
      const expiresAt = new Date(Date.now() - 60_000);
      const expired = await exactSnapshot({
        createdAt: new Date(expiresAt.getTime() - 10 * 60_000),
        expiresAt,
      });
      await expect(
        write({ ...changed(expired, { confirmedAt: expiresAt }), redeemedAt: expiresAt }),
      ).rejects.toThrow(/must be redeemed, unexpired, for this booking at its confirmation/);
    });

    it('refuses a fee rule not in effect for the booking, and a fee that is not the rule fee', async () => {
      const otherCategory = await exactSnapshot();
      await expect(
        write(changed(otherCategory, { feeRuleId: otherCategoryRuleId })),
      ).rejects.toThrow(/The pinned fee rule is not in effect for this booking/);

      const closed = await exactSnapshot({ vehicleCategory: closedCategory });
      await expect(write(changed(closed, { feeRuleId: closedRuleId }))).rejects.toThrow(
        /The pinned fee rule is not in effect for this booking/,
      );

      const wrongFee = await exactSnapshot();
      await expect(
        write({
          ...changed(wrongFee, { platformFeePaise: 5_001n }),
          stops: wrongFee.stops.map((stop, index) =>
            index === 0 ? { ...stop, platformFeeSharePaise: 2_001n } : stop,
          ),
        }),
      ).rejects.toThrow(/The platform fee must be the pinned rule's fee for this fare/);
    });

    it('checks at commit that the stops cover every drop and add up to the booking', async () => {
      const none = await exactSnapshot();
      await expect(write({ ...none, stops: [] })).rejects.toThrow(
        /must have one stop per quoted drop, numbered 1\.\.n/,
      );
      const one = await exactSnapshot();
      await expect(write({ ...one, stops: [nth(one.stops, 0)] })).rejects.toThrow(
        /must have one stop per quoted drop, numbered 1\.\.n/,
      );

      const short = await exactSnapshot();
      await expect(
        write({
          ...short,
          stops: short.stops.map((stop, index) =>
            index === 1 ? { ...stop, platformFeeSharePaise: 2_999n } : stop,
          ),
        }),
      ).rejects.toThrow(/stops do not add up to its snapshot/);

      // The right total, but not the largest-remainder split.
      const skewed = await exactSnapshot();
      await expect(
        write({
          ...skewed,
          stops: skewed.stops.map((stop, index) => ({
            ...stop,
            platformFeeSharePaise: index === 0 ? 0n : 5_000n,
          })),
        }),
      ).rejects.toThrow(/fee shares are not a largest-remainder split/);

      for (const snapshot of [none, one, short, skewed]) {
        expect(await redeemedAt(snapshot.quote.quoteId)).toBeNull();
      }
    });

    it('refuses a stop that does not copy its quoted drop, or does not start PENDING', async () => {
      const amount = await exactSnapshot();
      await expect(
        write({
          ...amount,
          stops: amount.stops.map((stop, index) =>
            index === 0 ? { ...stop, farePaise: 20_001n, payablePaise: 20_001n } : stop,
          ),
        }),
      ).rejects.toThrow(/must copy its quoted drop exactly/);

      const swapped = await exactSnapshot();
      await expect(
        write({
          ...swapped,
          stops: swapped.stops.map((stop, index) => ({ ...stop, sequence: index === 0 ? 2 : 1 })),
        }),
      ).rejects.toThrow(/must copy its quoted drop exactly/);

      const foreign = await exactSnapshot();
      const elsewhere = await quoteFor(customer, [20_000, 30_000]);
      await expect(
        write({
          ...foreign,
          stops: foreign.stops.map((stop, index) => ({
            ...stop,
            fareQuoteStopId: nth(elsewhere.stopIds, index),
          })),
        }),
      ).rejects.toThrow(/must copy its quoted drop exactly/);

      const started = await exactSnapshot();
      await expect(
        write({
          ...started,
          stops: started.stops.map((stop) => ({ ...stop, status: 'DELIVERED' as const })),
        }),
      ).rejects.toThrow(/A booking stop starts PENDING/);

      const legacy = await createLegacyBooking(ctx.prisma, {
        customerId: customer.customerId,
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        category,
      });
      await expect(
        ctx.prisma.bookingStop.create({
          data: {
            bookingId: legacy.id,
            fareQuoteStopId: nth(elsewhere.stopIds, 0),
            sequence: 1,
            farePaise: 20_000n,
            taxPaise: 0n,
            payablePaise: 20_000n,
            platformFeeSharePaise: 0n,
          },
        }),
      ).rejects.toThrow(/Stops exist only for bookings priced from a fare quote/);
    });

    it('holds the snapshot CHECKs even with the insert guard turned off', async () => {
      /** Inserts with only the insert guard off, and never commits. */
      const unguarded = (data: Prisma.BookingUncheckedCreateInput) =>
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`ALTER TABLE bookings DISABLE TRIGGER trg_bookings_insert_guard`;
          await tx.booking.create({ data });
          throw new Error('the CHECK did not refuse the row');
        });

      const snapshot = await exactSnapshot();
      await expect(
        unguarded(changed(snapshot, { paymentMethod: 'PREPAID_UPI' }).booking),
      ).rejects.toThrow(/bookings_quote_bookings_not_prepaid/);
      await expect(unguarded(changed(snapshot, { taxPaise: 1n }).booking)).rejects.toThrow(
        /bookings_snapshot_shape/,
      );
      await expect(
        unguarded(changed(snapshot, { platformFeePaise: 50_001n }).booking),
      ).rejects.toThrow(/bookings_snapshot_shape/);
      await expect(
        unguarded(
          changed(snapshot, {
            paymentModel: 'LEGACY_BOOKING_LEVEL',
            fareQuoteId: null,
            pricingVersionId: null,
          }).booking,
        ),
      ).rejects.toThrow(/bookings_snapshot_shape/);

      // The guard is back on: the transaction that turned it off never committed.
      const enabled = await ctx.prisma.$queryRaw<{ enabled: string }[]>`
        SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgname = 'trg_bookings_insert_guard'`;
      expect(enabled).toEqual([{ enabled: 'O' }]);
    });

    it('keeps the snapshot and the stops immutable, even for the table owner', async () => {
      const booking = await write(await exactSnapshot());
      const id = booking.id;
      for (const update of [
        ctx.prisma
          .$executeRaw`UPDATE bookings SET fare_paise = fare_paise + 1 WHERE id = ${id}::uuid`,
        ctx.prisma.$executeRaw`UPDATE bookings SET tax_paise = 1 WHERE id = ${id}::uuid`,
        ctx.prisma.$executeRaw`UPDATE bookings SET platform_fee_paise = 0 WHERE id = ${id}::uuid`,
        ctx.prisma.$executeRaw`UPDATE bookings SET fare_quote_id = NULL WHERE id = ${id}::uuid`,
        ctx.prisma
          .$executeRaw`UPDATE bookings SET pricing_version_id = ${otherVersionId}::uuid WHERE id = ${id}::uuid`,
        ctx.prisma
          .$executeRaw`UPDATE bookings SET payment_model = 'LEGACY_BOOKING_LEVEL' WHERE id = ${id}::uuid`,
      ]) {
        await expect(update).rejects.toThrow(
          /Confirmed booking terms \(customer, fare snapshot, payment method, fee rule\) are immutable/,
        );
      }

      // A historical booking can't be turned into a quote booking either.
      const legacy = await createLegacyBooking(ctx.prisma, {
        customerId: customer.customerId,
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        category,
      });
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE bookings SET payment_model = 'QUOTE_PER_STOP' WHERE id = ${legacy.id}::uuid`,
      ).rejects.toThrow(/are immutable/);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE bookings SET platform_fee_paise = 0 WHERE id = ${legacy.id}::uuid`,
      ).rejects.toThrow(/are immutable/);

      for (const update of [
        ctx.prisma
          .$executeRaw`UPDATE booking_stops SET payable_paise = payable_paise + 1 WHERE booking_id = ${id}::uuid`,
        ctx.prisma
          .$executeRaw`UPDATE booking_stops SET platform_fee_share_paise = 0 WHERE booking_id = ${id}::uuid`,
        ctx.prisma
          .$executeRaw`UPDATE booking_stops SET sequence = sequence + 10 WHERE booking_id = ${id}::uuid`,
      ]) {
        await expect(update).rejects.toThrow(/Booking stop amounts and references are immutable/);
      }
      // A stop moves only through its lifecycle (payment flow Phase 3): never on an unassigned
      // booking, and never without a transition.
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE booking_stops SET status = 'DELIVERED' WHERE booking_id = ${id}::uuid`,
      ).rejects.toThrow(/The drops of a closed or unassigned booking cannot move/);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE booking_stops SET updated_at = now() WHERE booking_id = ${id}::uuid`,
      ).rejects.toThrow(/A booking stop changes only through a lifecycle transition/);
      await expect(
        ctx.prisma.$executeRaw`DELETE FROM booking_stops WHERE booking_id = ${id}::uuid`,
      ).rejects.toThrow(/booking_stops rows are permanent financial records and cannot be deleted/);
      // Collections reference stops (per-drop collections), so a plain TRUNCATE is refused by that
      // foreign key; with CASCADE the no-truncate triggers refuse it.
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`TRUNCATE booking_stops`;
          throw new Error('TRUNCATE was not refused');
        }),
      ).rejects.toThrow(/cannot truncate a table referenced in a foreign key constraint/);
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`TRUNCATE booking_stops CASCADE`;
          throw new Error('TRUNCATE was not refused');
        }),
      ).rejects.toThrow(/permanent financial records and cannot be deleted/);
      expect(await feeShares(id)).toEqual([2_000n, 3_000n]);
    });

    it('allows in-app booking payments only for historical PREPAID_UPI bookings', async () => {
      const quoteBooking = await write(await exactSnapshot());
      const legacyDelivery = await createLegacyBooking(ctx.prisma, {
        customerId: customer.customerId,
        paymentMethod: 'PAY_AT_DELIVERY',
        farePaise: 20_000,
        category,
      });
      for (const booking of [quoteBooking, legacyDelivery]) {
        await expect(
          ctx.prisma.payment.create({
            data: {
              bookingId: booking.id,
              userId: customer.userId,
              purpose: 'BOOKING',
              amountPaise: booking.finalFareMinor,
              idempotencyKey: randomUUID(),
            },
          }),
        ).rejects.toThrow(/In-app booking payments exist only for historical PREPAID_UPI bookings/);
      }
      expect(
        await ctx.prisma.payment.count({
          where: { bookingId: { in: [quoteBooking.id, legacyDelivery.id] } },
        }),
      ).toBe(0);
    });
  });
});
