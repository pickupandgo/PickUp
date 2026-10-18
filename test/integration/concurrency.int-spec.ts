import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { type LedgerEntryInput, WalletLedgerService } from '../../src/wallet/wallet-ledger.service';
import { WalletService } from '../../src/wallet/wallet.service';
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
  collect,
  engine,
  fundWallet,
  registerBooking,
  setStopStatus,
  setTripStatus,
  settleAndSync,
  startBookingPayment,
  TO_DELIVERED,
  TO_IN_TRANSIT,
} from '../helpers/flows';
import { sendWebhook, startTopUp, topUpCredits, walletBalance } from '../helpers/http';
import { buildPaymentLinkWebhook, buildWebhook } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Concurrency sweep (payment flow Phase 11, review §J). Every race below has exactly one
 * winner: the losers replay, or get a fixed 409 / 422, and the money effect happens once. The
 * lock order (booking -> trip -> stop -> collection/payment -> wallet) and the database's unique
 * constraints, partial indexes and guards do the work; these tests prove it end to end against
 * real Postgres. The individual behaviours are also covered in their own specs (pickup-payment,
 * stop-collections, webhooks, payouts, refunds, wallet-ledger, trips-earnings); this file is the
 * consolidated sweep the review names, and it does not weaken any of them.
 */
describe('Concurrency and idempotency sweep (payment flow Phase 11, review J)', () => {
  let ctx: TestContext;
  let ledger: WalletLedgerService;
  let wallets: WalletService;
  let admin: TestAdmin;
  let category: string;
  // Batch preparation and execution are rate limited per admin (5/min); spread them over a pool.
  let adminPool: TestAdmin[];
  let poolCalls = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(WalletLedgerService);
    wallets = ctx.app.get(WalletService);
    admin = await createAdmin(ctx);
    adminPool = await Promise.all(Array.from({ length: 10 }, () => createAdmin(ctx)));
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  function nextAdmin(): TestAdmin {
    const actor = adminPool[Math.floor(poolCalls / 3) % adminPool.length];
    poolCalls += 1;
    if (!actor) {
      throw new Error('admin pool is empty');
    }
    return actor;
  }

  const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
  const tripRow = (id: string) => ctx.prisma.trip.findUniqueOrThrow({ where: { id } });
  const stopRows = (bookingId: string) =>
    ctx.prisma.bookingStop.findMany({ where: { bookingId }, orderBy: { sequence: 'asc' } });
  const collectionsOf = (bookingId: string) =>
    ctx.prisma.paymentCollection.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
  const feeDebits = (driverId: string) =>
    ctx.prisma.driverWalletTransaction.findMany({
      where: { wallet: { driverId }, type: 'CASH_RIDE_FEE' },
    });
  const numericSort = (a: number, b: number) => a - b;

  /** A PAY_AT_PICKUP booking (Rs 200 + Rs 300 drops, Rs 50 fee), the driver at the pickup. */
  async function arrivedAtPickup(walletPaise?: number) {
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50_000,
      category,
      model: 'QUOTE_PER_STOP',
      dropPaise: [20_000, 30_000],
    });
    if (walletPaise) {
      await fundWallet(ctx, admin, driver.driverId, walletPaise);
    }
    await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
    return { customer, driver, ...trip };
  }

  /** A PAY_AT_DELIVERY booking priced per drop, under way, no drop arrived yet. */
  async function underWay(drops: number[] = [20_000, 10_000, 20_000]) {
    const customer = await createCustomer(ctx);
    const driver = await createDriver(ctx);
    const trip = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: drops.reduce((sum, paise) => sum + paise, 0),
      dropPaise: drops,
      category,
      model: 'QUOTE_PER_STOP',
    });
    await fundWallet(ctx, admin, driver.driverId, 100_000);
    await advanceTrip(ctx, trip.tripId, TO_IN_TRANSIT);
    return { customer, driver, drops, ...trip };
  }

  // -------------------------------------------------------------------------------------------
  // Two drivers assigning the same booking
  // -------------------------------------------------------------------------------------------
  describe('one driver per booking', () => {
    async function registeredBooking(): Promise<string> {
      return registerBooking(ctx, await createCustomer(ctx), {
        paymentMethod: 'PAY_AT_PICKUP',
        farePaise: 20_000,
        category,
        dropPaise: [20_000],
      });
    }
    const assign = (bookingId: string, driver: TestDriver) =>
      engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/assign`)
        .send({ driverSubject: driver.subject });

    it('two drivers assigning at once: one is assigned, the other gets TRIP_ALREADY_ASSIGNED', async () => {
      const bookingId = await registeredBooking();
      const [driverA, driverB] = await Promise.all([createDriver(ctx), createDriver(ctx)]);
      const [first, second] = await Promise.all([
        assign(bookingId, driverA),
        assign(bookingId, driverB),
      ]);

      expect([first.status, second.status].sort(numericSort)).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.error.code).toBe('TRIP_ALREADY_ASSIGNED');
      expect(await ctx.prisma.trip.findMany({ where: { bookingId } })).toHaveLength(1);
    });

    it('the same driver assigning at once is idempotent: one trip', async () => {
      const bookingId = await registeredBooking();
      const driver = await createDriver(ctx);
      const results = await Promise.all(Array.from({ length: 4 }, () => assign(bookingId, driver)));

      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      expect(new Set(results.map((res) => res.body.trip.tripId as string)).size).toBe(1);
      expect(await ctx.prisma.trip.findMany({ where: { bookingId } })).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Duplicate / racing trip and stop transitions
  // -------------------------------------------------------------------------------------------
  describe('trip and stop transitions', () => {
    it('repeated and concurrent DRIVER_ARRIVED apply once', async () => {
      const { tripId } = await arrivedAtPickup();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => setTripStatus(ctx, tripId, 'DRIVER_ARRIVED')),
      );
      expect(results.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
      const { arrivedAt, status } = await tripRow(tripId);
      expect(status).toBe('DRIVER_ARRIVED');
      expect(arrivedAt).toBeInstanceOf(Date);
      await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
      expect((await tripRow(tripId)).arrivedAt).toEqual(arrivedAt);
    });

    it('repeated and concurrent stop ARRIVED apply once, one current stop', async () => {
      const trip = await underWay();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => setStopStatus(ctx, trip.tripId, 1, 'ARRIVED')),
      );
      expect(results.map((res) => res.status)).toEqual(Array.from({ length: 8 }, () => 200));
      const stops = await stopRows(trip.bookingId);
      expect(stops.filter((stop) => stop.status === 'ARRIVED')).toHaveLength(1);
      expect(stops.filter((stop) => stop.status === 'PENDING')).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Collections: two at once, cash vs QR, duplicate cash
  // -------------------------------------------------------------------------------------------
  describe('collections', () => {
    it('two drops collected at once: only the drop the driver is at is taken', async () => {
      const trip = await underWay([20_000, 10_000, 20_000]);
      await setStopStatus(ctx, trip.tripId, 1, 'ARRIVED').expect(200);
      const [first, second] = await Promise.all([
        collect(ctx, trip.driver, trip.tripId, {
          method: 'CASH',
          amountPaise: 20_000,
          stopSequence: 1,
        }),
        collect(ctx, trip.driver, trip.tripId, {
          method: 'CASH',
          amountPaise: 10_000,
          stopSequence: 2,
        }),
      ]);
      expect([first.status, second.status].sort(numericSort)).toEqual([201, 409]);
      const completed = (await collectionsOf(trip.bookingId)).filter(
        (row) => row.status === 'COMPLETED',
      );
      expect(completed).toHaveLength(1);
      expect(await feeDebits(trip.driver.driverId)).toHaveLength(1);
    });

    it('two QR requests for one obligation show one QR', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup();
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          collect(ctx, driver, tripId, { method: 'ONLINE_QR', amountPaise: 50_000 }),
        ),
      );
      expect(results.map((res) => res.status)).toEqual([201, 201, 201]);
      expect(new Set(results.map((res) => res.body.collectionId as string)).size).toBe(1);
      const pending = (await collectionsOf(bookingId)).filter((row) => row.status === 'PENDING');
      expect(pending).toHaveLength(1);
    });

    it('cash racing a paid QR for one booking: the QR wins, nothing is debited twice', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup(10_000);
      const shown = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      const link = ctx.links.byCollection(collectionId);
      const payment = ctx.links.pay(link.referenceId);
      const [webhook, cash] = await Promise.all([
        sendWebhook(
          ctx,
          buildPaymentLinkWebhook('payment_link.paid', { ...link, amount: 50_000 }, payment),
        ),
        collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
      ]);
      expect(webhook.status).toBe(200);
      expect(cash.status).toBe(409);
      const completed = (await collectionsOf(bookingId)).filter(
        (row) => row.status === 'COMPLETED',
      );
      expect(completed.map((row) => row.method)).toEqual(['ONLINE_QR']);
      expect(await feeDebits(driver.driverId)).toEqual([]);
      expect((await bookingRow(bookingId)).paymentStatus).toBe('PAID');
    });

    it('duplicate cash (same key, concurrent, other keys): one collection, one fee debit', async () => {
      const { driver, bookingId, tripId } = await arrivedAtPickup(10_000);
      const key = idempotencyKey();
      const same = await Promise.all(
        Array.from({ length: 4 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }, key),
        ),
      );
      expect(same.map((res) => res.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(same.map((res) => res.body.collectionId as string)).size).toBe(1);
      const others = await Promise.all(
        Array.from({ length: 3 }, () =>
          collect(ctx, driver, tripId, { method: 'CASH', amountPaise: 50_000 }),
        ),
      );
      for (const res of others) {
        expect([res.status, res.body.error.code]).toEqual([409, 'BOOKING_ALREADY_PAID']);
      }
      expect(await collectionsOf(bookingId)).toHaveLength(1);
      expect(await feeDebits(driver.driverId)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Duplicate webhook
  // -------------------------------------------------------------------------------------------
  describe('duplicate webhook', () => {
    it('the same payment webhook delivered 20 times concurrently credits once', async () => {
      const driver = await createDriver(ctx);
      const topUp = await startTopUp(ctx, driver, 70_000);
      const payment = ctx.razorpay.pay(topUp.orderId, { status: 'captured' });
      const webhook = buildWebhook('payment.captured', payment);

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => sendWebhook(ctx, webhook)),
      );

      expect(responses.map((res) => res.status)).toEqual(Array.from({ length: 20 }, () => 200));
      expect(await walletBalance(ctx, driver.driverId)).toBe(70_000n);
      expect(await topUpCredits(ctx, driver.driverId)).toHaveLength(1);
      expect(
        await ctx.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId: webhook.eventId } }),
      ).toMatchObject({ outcome: 'APPLIED' });
    });
  });

  // -------------------------------------------------------------------------------------------
  // Cancel racing a payment
  // -------------------------------------------------------------------------------------------
  describe('cancel racing payment', () => {
    const cancel = (bookingId: string) =>
      engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'Customer cancelled' });

    it('a cancellation racing a cash drop leaves one consistent outcome', async () => {
      for (let round = 0; round < 3; round += 1) {
        const trip = await underWay([20_000, 10_000]);
        await setStopStatus(ctx, trip.tripId, 1, 'ARRIVED').expect(200);
        const [cancelled, paid] = await Promise.all([
          cancel(trip.bookingId),
          collect(ctx, trip.driver, trip.tripId, {
            method: 'CASH',
            amountPaise: 20_000,
            stopSequence: 1,
          }),
        ]);
        expect(cancelled.status).toBe(200);
        const booking = await bookingRow(trip.bookingId);
        expect(booking.status).toBe('CANCELLED');
        if (paid.status === 201) {
          expect(booking.paymentStatus).toBe('PARTIALLY_PAID');
          expect(await feeDebits(trip.driver.driverId)).toHaveLength(1);
        } else {
          expect([paid.status, paid.body.error.code]).toEqual([409, 'BOOKING_CLOSED']);
          expect(booking.paymentStatus).toBe('UNPAID');
          expect(await feeDebits(trip.driver.driverId)).toEqual([]);
        }
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // Refund racing refund
  // -------------------------------------------------------------------------------------------
  describe('refunds', () => {
    /** A PAY_AT_PICKUP booking paid at the pickup by QR, then cancelled before handover. */
    async function cancelledPaidQr() {
      const { driver, bookingId, tripId } = await arrivedAtPickup();
      const shown = await collect(ctx, driver, tripId, {
        method: 'ONLINE_QR',
        amountPaise: 50_000,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      const providerPaymentId = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId).id;
      await request(ctx.server)
        .get(`/v1/trips/${tripId}/collections/${collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
      await engine(ctx)
        .post(`/v1/internal/bookings/${bookingId}/cancel`)
        .send({ reason: 'Customer cancelled' })
        .expect(200);
      return { bookingId, collectionId, providerPaymentId };
    }

    it('concurrent refund requests for one source make exactly one refund, sent once', async () => {
      const trip = await cancelledPaidQr();
      const racers = await Promise.all(Array.from({ length: 5 }, () => createAdmin(ctx)));
      const responses = await Promise.all(
        racers.map((as) =>
          request(ctx.server)
            .post('/v1/admin/refunds')
            .set(bearer(as.token))
            .set('Idempotency-Key', idempotencyKey())
            .send({
              bookingId: trip.bookingId,
              sourceCollectionId: trip.collectionId,
              kind: 'PROVIDER',
              reason: 'Customer cancelled before pickup; support ticket 4471',
            }),
        ),
      );
      expect(responses.map((res) => res.status).sort(numericSort)).toEqual([
        201, 409, 409, 409, 409,
      ]);
      for (const res of responses.filter((candidate) => candidate.status === 409)) {
        expect(res.body.error.code).toBe('REFUND_IN_PROGRESS');
      }
      expect(
        await ctx.prisma.paymentRefund.findMany({ where: { bookingId: trip.bookingId } }),
      ).toHaveLength(1);
      expect(await ctx.refunds.listPaymentRefunds(trip.providerPaymentId)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Payout racing payout
  // -------------------------------------------------------------------------------------------
  describe('payouts', () => {
    async function driverWithBank(): Promise<TestDriver> {
      const driver = await createDriver(ctx);
      await createVerifiedBankAccount(ctx.prisma, driver.driverId, admin.userId);
      return driver;
    }

    /** A completed, settled prepaid trip: the driver has one PAYABLE earning. */
    async function payableEarning(driver: TestDriver) {
      const customer = await createCustomer(ctx);
      const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
        paymentMethod: 'PREPAID_UPI',
        farePaise: 50_000,
        category,
      });
      const started = await startBookingPayment(ctx, customer, bookingId).expect(201);
      const payment = ctx.razorpay.pay(started.body.checkout.orderId as string);
      await sendWebhook(ctx, buildWebhook('payment.captured', payment)).expect(200);
      await advanceTrip(ctx, tripId, TO_DELIVERED);
      await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
      await settleAndSync(ctx, payment.id, 50_000);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId } });
      expect(earning.status).toBe('PAYABLE');
      return { bookingId, earning };
    }

    const prepareBatch = () =>
      request(ctx.server)
        .post('/v1/admin/payout-batches')
        .set(bearer(nextAdmin().token))
        .set('Idempotency-Key', idempotencyKey())
        .send({});
    const executeBatch = (batchId: string) =>
      request(ctx.server)
        .post(`/v1/admin/payout-batches/${batchId}/execute`)
        .set(bearer(nextAdmin().token))
        .send();

    it('the same earning never lands in two batches prepared at once', async () => {
      const driver = await driverWithBank();
      const { earning } = await payableEarning(driver);
      const [first, second] = await Promise.all([prepareBatch(), prepareBatch()]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(
        await ctx.prisma.payoutItem.findMany({ where: { earningId: earning.id } }),
      ).toHaveLength(1);
      expect(
        (await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('IN_PAYOUT');
    });

    it('a payout executes once under concurrent execution: one transfer at the provider', async () => {
      const driver = await driverWithBank();
      await payableEarning(driver);
      const prepared = await prepareBatch().expect(201);
      const batchId = prepared.body.batch.batchId as string;

      const before = ctx.payouts.calls.createPayout;
      await Promise.all([executeBatch(batchId), executeBatch(batchId), executeBatch(batchId)]);
      await executeBatch(batchId).expect(200);

      const payout = await ctx.prisma.driverPayout.findUniqueOrThrow({
        where: { batchId_driverId: { batchId, driverId: driver.driverId } },
      });
      const atProvider = [...ctx.payouts.payouts.values()].filter(
        (entry) => entry.referenceId === payout.id,
      );
      expect(atProvider).toHaveLength(1);
      expect(payout).toMatchObject({ status: 'SUBMITTED', providerPayoutId: atProvider[0]?.id });
      expect(ctx.payouts.calls.createPayout - before).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Wallet debit racing debit (ledger, no HTTP)
  // -------------------------------------------------------------------------------------------
  describe('wallet ledger', () => {
    function post(input: Partial<LedgerEntryInput> & Pick<LedgerEntryInput, 'walletId'>) {
      return ctx.prisma.runInTransaction((tx) =>
        ledger.postEntry(tx, {
          type: 'CASH_RIDE_FEE',
          direction: 'DEBIT',
          amountPaise: 100n,
          referenceType: 'BOOKING',
          referenceId: randomUUID(),
          idempotencyKey: `concurrency:${randomUUID()}`,
          ...input,
        }),
      );
    }

    async function walletWithBalance(balancePaise: bigint): Promise<string> {
      const driver = await createDriver(ctx);
      const wallet = await wallets.ensureWalletForDriver(driver.driverId);
      await post({
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        direction: 'CREDIT',
        amountPaise: balancePaise,
        referenceType: 'ADMIN',
        referenceId: admin.userId,
        performedByUserId: admin.userId,
        reason: 'Concurrency sweep funding',
        idempotencyKey: `concurrency:${randomUUID()}`,
      });
      return wallet.id;
    }

    const balanceOf = async (walletId: string): Promise<bigint> =>
      (await ctx.prisma.driverWallet.findUniqueOrThrow({ where: { id: walletId } })).balancePaise;

    it('two simultaneous debits that would overdraw: exactly one succeeds', async () => {
      const walletId = await walletWithBalance(10_000n);
      const results = await Promise.allSettled([
        post({ walletId, amountPaise: 7_000n }),
        post({ walletId, amountPaise: 7_000n }),
      ]);
      expect(results.filter((res) => res.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((res) => res.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect(await balanceOf(walletId)).toBe(3_000n);
    });

    it('20 concurrent debits never overdraw and keep a gap-free ledger', async () => {
      const walletId = await walletWithBalance(10_000n);
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => post({ walletId, amountPaise: 1_000n })),
      );
      expect(results.filter((res) => res.status === 'fulfilled')).toHaveLength(10);
      expect(await balanceOf(walletId)).toBe(0n);
      const entries = await ctx.prisma.driverWalletTransaction.findMany({
        where: { walletId },
        orderBy: { walletVersion: 'asc' },
      });
      expect(entries.map((entry) => Number(entry.walletVersion))).toEqual(
        Array.from({ length: 11 }, (_, index) => index + 1),
      );
      expect(entries.at(-1)?.balanceAfterPaise).toBe(0n);
    });
  });
});
