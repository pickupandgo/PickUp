import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { BookingStop } from '../../src/generated/prisma/client';
import { MerchantSettlementsService } from '../../src/settlements/merchant-settlements.service';
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
  deliverStops,
  fundWallet,
  resolveStop,
  sendPayoutWebhook,
  setStopStatus,
  setTripStatus,
  settleAndSync,
  TO_DELIVERED,
  TO_IN_TRANSIT,
} from '../helpers/flows';
import { sendWebhook, walletBalance } from '../helpers/http';
import { buildPaymentLinkWebhook, buildPayoutWebhook } from '../helpers/razorpay-payloads';
import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * Earnings funded by several collections (payment flow Phase 5): each earning records its cash
 * and online parts and its payout amount (0 for cash, the online net otherwise). The cash part is
 * already with the driver; the online part is payable only once every online collection funding
 * it is settled, and a payout carries exactly the payout amount. A failed payout puts its
 * earnings ON_HOLD for an admin (N10). Single-collection and historical earnings keep working.
 */
describe('Earnings funded by several collections (payment flow Phase 5)', () => {
  let ctx: TestContext;
  let admin: TestAdmin;
  let admins: TestAdmin[] = [];
  let category: string;
  let calls = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    admins = await Promise.all(Array.from({ length: 12 }, () => createAdmin(ctx)));
    category = uniqueCategory();
    await createFeeRule(ctx.prisma, { category, value: '10' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Batch preparation and execution are rate limited per admin (5/min): spread them out.
  function nextAdmin(): TestAdmin {
    const actor = admins[Math.floor(calls / 4) % admins.length];
    calls += 1;
    if (!actor) {
      throw new Error('admin pool is empty');
    }
    return actor;
  }
  const prepare = () =>
    request(ctx.server)
      .post('/v1/admin/payout-batches')
      .set(bearer(nextAdmin().token))
      .set('Idempotency-Key', idempotencyKey())
      .send({});
  const execute = (batchId: string) =>
    request(ctx.server)
      .post(`/v1/admin/payout-batches/${batchId}/execute`)
      .set(bearer(nextAdmin().token))
      .send();
  const release = (earningId: string) =>
    request(ctx.server)
      .post(`/v1/admin/earnings/${earningId}/release`)
      .set(bearer(admin.token))
      .send({ reason: 'Reviewed by ops, ticket 5150: release for the next payout' });
  const adminEarning = (earningId: string) =>
    request(ctx.server).get(`/v1/admin/earnings/${earningId}`).set(bearer(admin.token)).expect(200);
  const summaryOf = async (driver: TestDriver) =>
    (await request(ctx.server).get('/v1/earnings/summary').set(bearer(driver.token)).expect(200))
      .body as Record<string, number>;
  const earningRow = (id: string) => ctx.prisma.driverEarning.findUniqueOrThrow({ where: { id } });
  const liveItems = (earningId: string) =>
    ctx.prisma.payoutItem.findMany({ where: { earningId, status: { in: ['INCLUDED', 'PAID'] } } });
  const payoutOf = (driverId: string, batchId: string) =>
    ctx.prisma.driverPayout.findUnique({ where: { batchId_driverId: { batchId, driverId } } });
  const sync = () => ctx.app.get(MerchantSettlementsService).sync({ trigger: 'ADMIN' });

  async function driverWithBank(): Promise<TestDriver> {
    const driver = await createDriver(ctx);
    await createVerifiedBankAccount(ctx.prisma, driver.driverId, admin.userId);
    await fundWallet(ctx, admin, driver.driverId, 100_000);
    return driver;
  }

  interface PaidDrop {
    readonly sequence: number;
    readonly method: 'CASH' | 'QR';
    readonly collectionId: string;
    readonly amountPaise: bigint;
    readonly feeSharePaise: bigint;
    /** QR only: the Razorpay payment, to settle. */
    readonly paymentId: string | null;
  }

  interface DeliveryTrip {
    readonly driver: TestDriver;
    readonly bookingId: string;
    readonly tripId: string;
    readonly stops: BookingStop[];
  }

  /** A PAY_AT_DELIVERY booking priced per drop, under way (nothing reached yet). */
  async function underWay(drops: number[], driver?: TestDriver): Promise<DeliveryTrip> {
    const owner = driver ?? (await driverWithBank());
    const trip = await bookedTrip(ctx, await createCustomer(ctx), owner, {
      paymentMethod: 'PAY_AT_DELIVERY',
      model: 'QUOTE_PER_STOP',
      farePaise: drops.reduce((sum, paise) => sum + paise, 0),
      dropPaise: drops,
      category,
    });
    await advanceTrip(ctx, trip.tripId, TO_IN_TRANSIT);
    const stops = await ctx.prisma.bookingStop.findMany({
      where: { bookingId: trip.bookingId },
      orderBy: { sequence: 'asc' },
    });
    return { driver: owner, ...trip, stops };
  }

  const stopOf = (trip: DeliveryTrip, sequence: number) => {
    const stop = trip.stops[sequence - 1];
    if (!stop) {
      throw new Error(`no drop ${sequence}`);
    }
    return stop;
  };

  /** Reaches a drop and has it paid (cash, or a QR the customer pays and the app confirms). */
  async function payDrop(
    trip: DeliveryTrip,
    sequence: number,
    method: 'CASH' | 'QR',
  ): Promise<PaidDrop> {
    const stop = stopOf(trip, sequence);
    await setStopStatus(ctx, trip.tripId, sequence, 'ARRIVED').expect(200);
    const res = await collect(ctx, trip.driver, trip.tripId, {
      method: method === 'CASH' ? 'CASH' : 'ONLINE_QR',
      amountPaise: Number(stop.payablePaise),
      stopSequence: sequence,
    }).expect(201);
    const collectionId = res.body.collectionId as string;
    let paymentId: string | null = null;
    if (method === 'QR') {
      paymentId = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId).id;
      const confirmed = await request(ctx.server)
        .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
        .set(bearer(trip.driver.token))
        .expect(200);
      expect(confirmed.body.status).toBe('COMPLETED');
    }
    return {
      sequence,
      method,
      collectionId,
      amountPaise: stop.payablePaise,
      feeSharePaise: stop.platformFeeSharePaise,
      paymentId,
    };
  }

  /** Every drop paid in the given methods and delivered, then the trip completed. */
  async function completedTrip(drops: number[], methods: ('CASH' | 'QR')[], driver?: TestDriver) {
    const trip = await underWay(drops, driver);
    const paid: PaidDrop[] = [];
    for (const [index, method] of methods.entries()) {
      paid.push(await payDrop(trip, index + 1, method));
      await setStopStatus(ctx, trip.tripId, index + 1, 'DELIVERED').expect(200);
    }
    await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
    const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
      where: { bookingId: trip.bookingId },
      include: { collectionLinks: true },
    });
    return { trip, paid, earning };
  }

  /** What the approved model gives for the drops paid. */
  function expectedSplit(paid: readonly PaidDrop[]) {
    const sum = (method: PaidDrop['method'], field: 'amountPaise' | 'feeSharePaise') =>
      paid
        .filter((drop) => drop.method === method)
        .reduce((total, drop) => total + drop[field], 0n);
    const cash = sum('CASH', 'amountPaise');
    const online = sum('QR', 'amountPaise');
    const cashFee = sum('CASH', 'feeSharePaise');
    const onlineFee = sum('QR', 'feeSharePaise');
    return {
      grossAmountPaise: cash + online,
      platformFeePaise: cashFee + onlineFee,
      netAmountPaise: cash + online - cashFee - onlineFee,
      cashCollectedPaise: cash,
      onlineCollectedPaise: online,
      cashFeePaise: cashFee,
      onlineFeePaise: onlineFee,
      payoutAmountPaise: online === 0n ? 0n : online - onlineFee,
    };
  }

  /** Prepares a batch and returns this driver's payout in it (null when none). */
  async function batchFor(driver: TestDriver) {
    const batch = await prepare().expect(201);
    const batchId = batch.body.batch.batchId as string;
    return { batchId, payout: await payoutOf(driver.driverId, batchId) };
  }

  /** Prepares, executes and has RazorpayX process this driver's payout. */
  async function paidOut(driver: TestDriver) {
    const { batchId, payout } = await batchFor(driver);
    if (!payout) {
      throw new Error('expected a payout for the driver');
    }
    await execute(batchId).expect(200);
    const provider = ctx.payouts.byReference(payout.id);
    if (!provider) {
      throw new Error('expected a provider payout');
    }
    const processed = ctx.payouts.setStatus(provider.id, 'processed');
    await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);
    return { batchId, payout, provider };
  }

  describe('single collection (unchanged flows)', () => {
    it('PAY_AT_PICKUP cash is settled in cash with nothing to pay out; PAY_AT_PICKUP QR pays out its net once settled', async () => {
      const driver = await driverWithBank();
      const pickup = async (method: 'CASH' | 'ONLINE_QR') => {
        const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
          paymentMethod: 'PAY_AT_PICKUP',
          farePaise: 30_000,
          dropPaise: [30_000],
          category,
        });
        await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
        const res = await collect(ctx, driver, trip.tripId, { method, amountPaise: 30_000 }).expect(
          201,
        );
        let paymentId: string | null = null;
        if (method === 'ONLINE_QR') {
          const collectionId = res.body.collectionId as string;
          paymentId = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId).id;
          await request(ctx.server)
            .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
            .set(bearer(driver.token))
            .expect(200);
        }
        await advanceTrip(ctx, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
        await deliverStops(ctx, trip.tripId, [1]);
        await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
        const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
          where: { bookingId: trip.bookingId },
        });
        return { earning, paymentId };
      };

      const cash = await pickup('CASH');
      expect(cash.earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        cashCollectedPaise: 30_000n,
        onlineCollectedPaise: 0n,
        cashFeePaise: 3_000n,
        onlineFeePaise: 0n,
        payoutAmountPaise: 0n,
        netAmountPaise: 27_000n,
      });

      const qr = await pickup('ONLINE_QR');
      expect(qr.earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        onlineCollectedPaise: 30_000n,
        onlineFeePaise: 3_000n,
        payoutAmountPaise: 27_000n,
      });
      // Not payable before Razorpay settles it.
      expect((await batchFor(driver)).payout).toBeNull();
      await settleAndSync(ctx, qr.paymentId as string, 30_000);
      expect((await earningRow(qr.earning.id)).status).toBe('PAYABLE');

      const { payout } = await paidOut(driver);
      const items = await ctx.prisma.payoutItem.findMany({ where: { payoutId: payout.id } });
      // Only the QR earning, for its net: the cash earning has nothing to pay out.
      expect(items.map((item) => [item.earningId, item.amountPaise])).toEqual([
        [qr.earning.id, 27_000n],
      ]);
      expect(payout.amountPaise).toBe(27_000n);
      expect((await earningRow(qr.earning.id)).status).toBe('PAID');
      expect((await earningRow(cash.earning.id)).status).toBe('SETTLED_IN_CASH');
    });

    it('historical whole-booking earnings keep their single source and pay out as before', async () => {
      const driver = await driverWithBank();
      const legacy = async (method: 'CASH' | 'ONLINE_QR') => {
        const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
          paymentMethod: 'PAY_AT_DELIVERY',
          model: 'LEGACY_BOOKING_LEVEL',
          farePaise: 50_000,
          category,
        });
        await advanceTrip(ctx, trip.tripId, TO_DELIVERED);
        const res = await collect(ctx, driver, trip.tripId, { method, amountPaise: 50_000 }).expect(
          201,
        );
        let paymentId: string | null = null;
        if (method === 'ONLINE_QR') {
          const collectionId = res.body.collectionId as string;
          paymentId = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId).id;
          await request(ctx.server)
            .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
            .set(bearer(driver.token))
            .expect(200);
        }
        await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
        return {
          earning: await ctx.prisma.driverEarning.findUniqueOrThrow({
            where: { bookingId: trip.bookingId },
            include: { collectionLinks: true },
          }),
          paymentId,
        };
      };
      const cash = await legacy('CASH');
      expect(cash.earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        cashCollectedPaise: 50_000n,
        payoutAmountPaise: 0n,
      });
      const qr = await legacy('ONLINE_QR');
      expect(qr.earning).toMatchObject({
        settlement: 'ONLINE',
        onlineCollectedPaise: 50_000n,
        payoutAmountPaise: 45_000n,
        collectionId: qr.earning.collectionLinks[0]?.collectionId,
      });
      await settleAndSync(ctx, qr.paymentId as string, 50_000);
      const { payout } = await paidOut(driver);
      expect(payout.amountPaise).toBe(45_000n);
      expect((await earningRow(qr.earning.id)).status).toBe('PAID');
    });
  });

  describe('several collections', () => {
    it('cash + cash: CASH, settled in cash, nothing to pay out', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'CASH']);
      expect(earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        collectionId: null,
        ...expectedSplit(paid),
      });
      expect(earning.payoutAmountPaise).toBe(0n);
      expect(earning.collectionLinks).toHaveLength(2);
      // Both fee shares came out of the wallet, once each.
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(100_000n - 5_000n);
      expect((await batchFor(trip.driver)).payout).toBeNull();
      const summary = await summaryOf(trip.driver);
      expect(summary).toMatchObject({ settledInCashPaise: 45_000, awaitingSettlementPaise: 0 });
    });

    it('QR + QR: ONLINE, payable only once both drops are settled, for the full net', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['QR', 'QR']);
      const [first, second] = paid as [PaidDrop, PaidDrop];
      expect(earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        collectionId: null,
        paymentSettlementId: null,
        ...expectedSplit(paid),
      });
      expect(earning.payoutAmountPaise).toBe(45_000n);

      // The first drop settles: still waiting for the second.
      const partial = await settleAndSync(ctx, first.paymentId as string, 20_000);
      expect(partial.earningsPromoted).toBe(0);
      expect((await earningRow(earning.id)).status).toBe('AWAITING_SETTLEMENT');
      const view = (await adminEarning(earning.id)).body;
      expect(view).toMatchObject({
        merchantSettled: false,
        onlineSettledPaise: 20_000,
        payoutAmountPaise: 45_000,
      });
      expect(
        (view.sources as { collectionId: string; settled: boolean }[]).map((source) => [
          source.collectionId,
          source.settled,
        ]),
      ).toEqual([
        [first.collectionId, true],
        [second.collectionId, false],
      ]);
      expect((await batchFor(trip.driver)).payout).toBeNull();

      // The second settles: payable, for the whole online net.
      const done = await settleAndSync(ctx, second.paymentId as string, 30_000);
      expect(done.earningsPromoted).toBe(1);
      expect(await earningRow(earning.id)).toMatchObject({
        status: 'PAYABLE',
        payableAt: expect.any(Date),
      });
      const { payout } = await paidOut(trip.driver);
      expect(payout.amountPaise).toBe(45_000n);
      expect((await earningRow(earning.id)).status).toBe('PAID');
    });

    it('cash + QR: MIXED; the cash part is settled in cash at once, only the QR net waits for its settlement and is paid out', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      const qr = paid[1] as PaidDrop;
      expect(earning).toMatchObject({
        settlement: 'MIXED',
        status: 'AWAITING_SETTLEMENT',
        cashCollectedPaise: 20_000n,
        onlineCollectedPaise: 30_000n,
        cashFeePaise: 2_000n,
        onlineFeePaise: 3_000n,
        payoutAmountPaise: 27_000n,
        netAmountPaise: 45_000n,
      });
      // The cash part is not shown as waiting for a settlement.
      expect(await summaryOf(trip.driver)).toMatchObject({
        settledInCashPaise: 18_000,
        awaitingSettlementPaise: 27_000,
        payablePaise: 0,
      });
      await settleAndSync(ctx, qr.paymentId as string, 30_000);
      expect(await summaryOf(trip.driver)).toMatchObject({
        settledInCashPaise: 18_000,
        awaitingSettlementPaise: 0,
        payablePaise: 27_000,
      });
      const { payout } = await paidOut(trip.driver);
      expect(payout.amountPaise).toBe(27_000n);
      expect(await summaryOf(trip.driver)).toMatchObject({
        settledInCashPaise: 18_000,
        paidPaise: 27_000,
      });
    });

    it('QR + cash + QR: exact gross, fee and split; payable only after the second QR settles', async () => {
      const { trip, paid, earning } = await completedTrip(
        [12_345, 10_000, 7_655],
        ['QR', 'CASH', 'QR'],
      );
      const expected = expectedSplit(paid);
      expect(earning).toMatchObject({ settlement: 'MIXED', ...expected });
      expect(expected.payoutAmountPaise).toBe(
        expected.onlineCollectedPaise - expected.onlineFeePaise,
      );
      // Each link keeps its method, amount, fee share and net contribution.
      expect(
        earning.collectionLinks
          .map((link) => [
            link.method,
            link.amountPaise,
            link.platformFeePaise,
            link.netAmountPaise,
          ])
          .sort(),
      ).toEqual(
        paid
          .map((drop) => [
            drop.method === 'CASH' ? 'CASH' : 'ONLINE_QR',
            drop.amountPaise,
            drop.feeSharePaise,
            drop.amountPaise - drop.feeSharePaise,
          ])
          .sort(),
      );

      const [first, , third] = paid as [PaidDrop, PaidDrop, PaidDrop];
      await settleAndSync(ctx, first.paymentId as string, Number(first.amountPaise));
      expect((await earningRow(earning.id)).status).toBe('AWAITING_SETTLEMENT');
      expect((await adminEarning(earning.id)).body).toMatchObject({
        onlineSettledPaise: Number(first.amountPaise),
        merchantSettled: false,
      });
      // The database refuses to make it payable with drop 3's QR unsettled.
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE driver_earnings SET status = 'PAYABLE', payable_at = now() WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/online collections have no merchant settlement yet/);

      await settleAndSync(ctx, third.paymentId as string, Number(third.amountPaise));
      expect((await earningRow(earning.id)).status).toBe('PAYABLE');
      const { payout } = await paidOut(trip.driver);
      expect(payout.amountPaise).toBe(expected.payoutAmountPaise);
    });

    it('two QR drops settled before the trip completes: the earning starts PAYABLE', async () => {
      const trip = await underWay([20_000, 30_000]);
      const first = await payDrop(trip, 1, 'QR');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      const second = await payDrop(trip, 2, 'QR');
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERED').expect(200);
      // Razorpay settles both before the engine reports the completion.
      expect((await settleAndSync(ctx, first.paymentId as string, 20_000)).earningsPromoted).toBe(
        0,
      );
      expect((await settleAndSync(ctx, second.paymentId as string, 30_000)).earningsPromoted).toBe(
        0,
      );
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      expect(
        await ctx.prisma.driverEarning.findUniqueOrThrow({ where: { bookingId: trip.bookingId } }),
      ).toMatchObject({ settlement: 'ONLINE', status: 'PAYABLE', payoutAmountPaise: 45_000n });
    });

    it('a settlement recorded but not applied (a crash in between) is applied by the next sync', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      const qr = paid[1] as PaidDrop;
      // Recorded straight in the database, as if the process died before applying it.
      await ctx.prisma.paymentSettlement.create({
        data: {
          providerPaymentId: qr.paymentId as string,
          providerSettlementId: `setl_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
          settledAt: new Date(),
          amountPaise: 30_000n,
          bookingId: trip.bookingId,
          collectionId: qr.collectionId,
          source: 'SIMULATED',
        },
      });
      expect((await earningRow(earning.id)).status).toBe('AWAITING_SETTLEMENT');
      expect((await sync()).earningsPromoted).toBeGreaterThanOrEqual(1);
      expect((await earningRow(earning.id)).status).toBe('PAYABLE');
    });

    it('the split, the payout amount and each link are immutable; one source per earning', async () => {
      const { earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE driver_earnings SET payout_amount_paise = 45000 WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE driver_earnings SET cash_collected_paise = 0, online_collected_paise = 50000
           WHERE id = ${earning.id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE earning_collections SET net_amount_paise = 1 WHERE earning_id = ${earning.id}::uuid`,
      ).rejects.toThrow(/recorded once and never change/);
      // A collection funds one earning: its link is the primary key.
      const [link] = earning.collectionLinks;
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO earning_collections (collection_id, earning_id, booking_id, method, amount_paise,
                                           platform_fee_paise, net_amount_paise)
          VALUES (${link?.collectionId}::uuid, ${earning.id}::uuid, ${earning.bookingId}::uuid,
                  'CASH', 20000, 2000, 18000)`,
      ).rejects.toThrow();
    });
  });

  describe('payouts of earnings funded by several collections', () => {
    it('cash, QR, cash: the payout carries only the QR net; it fails, goes ON_HOLD, is released and paid once by a new payout', async () => {
      const { trip, paid, earning } = await completedTrip(
        [20_000, 10_000, 20_000],
        ['CASH', 'QR', 'CASH'],
      );
      const qr = paid[1] as PaidDrop;
      await settleAndSync(ctx, qr.paymentId as string, 10_000);
      expect((await earningRow(earning.id)).payoutAmountPaise).toBe(9_000n);

      const { batchId, payout } = await batchFor(trip.driver);
      expect(payout?.amountPaise).toBe(9_000n);
      expect(
        (await ctx.prisma.payoutItem.findMany({ where: { payoutId: payout?.id } })).map(
          (item) => item.amountPaise,
        ),
      ).toEqual([9_000n]);
      await execute(batchId).expect(200);
      const provider = ctx.payouts.byReference(payout?.id as string);
      const failed = ctx.payouts.setStatus(provider?.id as string, 'failed', {
        failureReason: 'Beneficiary account frozen',
      });
      const webhook = buildPayoutWebhook('payout.failed', failed);
      await sendPayoutWebhook(ctx, webhook).expect(200);
      await sendPayoutWebhook(ctx, webhook).expect(200);
      const held = await earningRow(earning.id);
      expect(held).toMatchObject({ status: 'ON_HOLD', paidAt: null });
      expect(held.holdReason).toMatch(/^PAYOUT_FAILED: .*Beneficiary account frozen/);
      expect(await liveItems(earning.id)).toEqual([]);
      // Nothing re-queued on its own.
      expect((await batchFor(trip.driver)).payout).toBeNull();

      expect((await release(earning.id).expect(200)).body.status).toBe('PAYABLE');
      const retry = await paidOut(trip.driver);
      expect(retry.payout.id).not.toBe(payout?.id);
      expect(retry.payout.amountPaise).toBe(9_000n);
      expect((await earningRow(earning.id)).status).toBe('PAID');
      expect((await liveItems(earning.id)).map((item) => item.payoutId)).toEqual([retry.payout.id]);

      // The money trail: each drop's collection and settlement, the split, both payouts.
      const chain = (
        await request(ctx.server)
          .get(`/v1/admin/bookings/${trip.bookingId}`)
          .set(bearer(admin.token))
          .expect(200)
      ).body;
      expect(chain.merchantSettlements).toHaveLength(1);
      expect(chain.merchantSettlements[0]).toMatchObject({ collectionId: qr.collectionId });
      expect(
        (
          chain.collections as { stopSequence: number; settlement: unknown; earningId: string }[]
        ).map((collection) => [
          collection.stopSequence,
          collection.settlement !== null,
          collection.earningId,
        ]),
      ).toEqual([
        [1, false, earning.id],
        [2, true, earning.id],
        [3, false, earning.id],
      ]);
      expect(chain.earning).toMatchObject({
        settlement: 'MIXED',
        cashCollectedPaise: 40_000,
        onlineCollectedPaise: 10_000,
        netCashPaise: 36_000,
        payoutAmountPaise: 9_000,
        merchantSettled: true,
        paidOut: true,
      });
      expect(
        (
          chain.earning.payoutHistory as { payoutStatus: string; payoutItemAmountPaise: number }[]
        ).map((entry) => [entry.payoutStatus, entry.payoutItemAmountPaise]),
      ).toEqual([
        ['FAILED', 9_000],
        ['PROCESSED', 9_000],
      ]);
    });

    it('one payout per driver carries every earning for its payout amount: ONLINE and MIXED together', async () => {
      const driver = await driverWithBank();
      const online = await completedTrip([20_000, 30_000], ['QR', 'QR'], driver);
      const mixed = await completedTrip([20_000, 30_000], ['CASH', 'QR'], driver);
      for (const drop of [...online.paid, ...mixed.paid]) {
        if (drop.paymentId) {
          await settleAndSync(ctx, drop.paymentId, Number(drop.amountPaise));
        }
      }
      const { payout } = await paidOut(driver);
      expect(payout.amountPaise).toBe(45_000n + 27_000n);
      expect(payout.grossAmountPaise).toBe(45_000n + 27_000n);
      const items = await ctx.prisma.payoutItem.findMany({ where: { payoutId: payout.id } });
      expect(new Map(items.map((item) => [item.earningId, item.amountPaise]))).toEqual(
        new Map([
          [online.earning.id, 45_000n],
          [mixed.earning.id, 27_000n],
        ]),
      );
    });

    it('a payout item must carry exactly the payout amount of a payable earning', async () => {
      const { paid, earning, trip } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      // Another payable earning of the same driver gives a payout to try the item against.
      const other = await completedTrip([20_000], ['QR'], trip.driver);
      await settleAndSync(ctx, (other.paid[0] as PaidDrop).paymentId as string, 20_000);
      const { payout } = await batchFor(trip.driver);
      if (!payout) {
        throw new Error('expected a payout');
      }
      await settleAndSync(ctx, (paid[1] as PaidDrop).paymentId as string, 30_000);
      expect((await earningRow(earning.id)).status).toBe('PAYABLE');
      // The net (Rs 450) is not what a payout owes for a mixed earning (Rs 270).
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO payout_items (payout_id, earning_id, amount_paise)
          VALUES (${payout.id}::uuid, ${earning.id}::uuid, ${earning.netAmountPaise})`,
      ).rejects.toThrow(/payable online or mixed earnings/);
    });
  });

  // L-11 / D-70 and the payout of a partly paid trip (N5) are open business decisions. These tests
  // pin the technical safe defaults: only collected and settled money is paid out, an unpaid drop
  // adds nothing, and nothing is refunded, compensated or debited on its own.
  describe('undelivered drop (L-11 / D-70 technical safe default)', () => {
    it('holds the online part for review; once released it is paid out, the booking PARTIALLY_PAID', async () => {
      const trip = await underWay([20_000, 30_000]);
      const walletBefore = await walletBalance(ctx, trip.driver.driverId);
      const qr = await payDrop(trip, 1, 'QR');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
        200,
      );
      await resolveStop(ctx, admin, trip.bookingId, 2, {
        resolution: 'UNDELIVERED',
        reason: 'Customer cancelled this drop',
      }).expect(200);
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      // Only the paid drop counts: gross, fee and payout amount of drop 1 alone.
      expect(earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'ON_HOLD',
        grossAmountPaise: 20_000n,
        platformFeePaise: 2_000n,
        onlineCollectedPaise: 20_000n,
        payoutAmountPaise: 18_000n,
      });
      expect(earning.collectionLinks.map((link) => link.collectionId)).toEqual([qr.collectionId]);
      expect(
        await ctx.prisma.paymentCollection.count({
          where: { bookingStopId: stopOf(trip, 2).id, status: 'COMPLETED' },
        }),
      ).toBe(0);
      expect(earning.holdReason).toMatch(/^UNDELIVERED_STOP_REVIEW: drop 2 was not delivered/);
      // Settled while held: recorded, still held, not paid out.
      await settleAndSync(ctx, qr.paymentId as string, 20_000);
      expect(await earningRow(earning.id)).toMatchObject({
        status: 'ON_HOLD',
        paymentSettlementId: expect.any(String),
      });
      expect((await batchFor(trip.driver)).payout).toBeNull();

      expect((await release(earning.id).expect(200)).body.status).toBe('PAYABLE');
      const { payout } = await paidOut(trip.driver);
      // The payout carries drop 1's settled net only; drop 2 was never collected.
      expect(payout.amountPaise).toBe(18_000n);
      expect(
        await ctx.prisma.booking.findUniqueOrThrow({ where: { id: trip.bookingId } }),
      ).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PARTIALLY_PAID' });
      // Nothing moved on its own: no wallet entry for the booking (no debit for the unpaid drop,
      // no compensation), the wallet as it was, and no new collection for drop 2.
      expect(
        await ctx.prisma.driverWalletTransaction.count({ where: { referenceId: trip.bookingId } }),
      ).toBe(0);
      expect(await walletBalance(ctx, trip.driver.driverId)).toBe(walletBefore);
      expect(
        await ctx.prisma.paymentCollection.count({ where: { bookingStopId: stopOf(trip, 2).id } }),
      ).toBe(0);
    });

    it('PAY_AT_PICKUP with a drop left undelivered: paid by QR, held for review; paid in cash, settled in cash', async () => {
      const driver = await driverWithBank();
      const pickupTrip = async (method: 'CASH' | 'ONLINE_QR') => {
        const trip = await bookedTrip(ctx, await createCustomer(ctx), driver, {
          paymentMethod: 'PAY_AT_PICKUP',
          farePaise: 50_000,
          dropPaise: [20_000, 30_000],
          category,
        });
        await setTripStatus(ctx, trip.tripId, 'DRIVER_ARRIVED').expect(200);
        const res = await collect(ctx, driver, trip.tripId, { method, amountPaise: 50_000 }).expect(
          201,
        );
        let paymentId: string | null = null;
        if (method === 'ONLINE_QR') {
          const collectionId = res.body.collectionId as string;
          paymentId = ctx.links.pay(ctx.links.byCollection(collectionId).referenceId).id;
          await request(ctx.server)
            .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
            .set(bearer(driver.token))
            .expect(200);
        }
        await advanceTrip(ctx, trip.tripId, ['PICKUP_VERIFIED', 'IN_TRANSIT']);
        await deliverStops(ctx, trip.tripId, [1]);
        await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
        await setStopStatus(ctx, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
          200,
        );
        await resolveStop(ctx, admin, trip.bookingId, 2, {
          resolution: 'UNDELIVERED',
          reason: 'Receiver has moved away',
        }).expect(200);
        await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
        const earning = await ctx.prisma.driverEarning.findUniqueOrThrow({
          where: { bookingId: trip.bookingId },
        });
        return { earning, paymentId };
      };

      // Cash: nothing to pay out, so nothing to hold.
      const cash = await pickupTrip('CASH');
      expect(cash.earning).toMatchObject({
        settlement: 'CASH',
        status: 'SETTLED_IN_CASH',
        payoutAmountPaise: 0n,
        holdReason: null,
      });
      // QR: the whole pickup payment is the online part, held until an admin reviews the trip.
      const qr = await pickupTrip('ONLINE_QR');
      expect(qr.earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'ON_HOLD',
        payoutAmountPaise: 45_000n,
      });
      expect(qr.earning.holdReason).toMatch(/^UNDELIVERED_STOP_REVIEW: drop 2 was not delivered/);
      await settleAndSync(ctx, qr.paymentId as string, 50_000);
      expect((await earningRow(qr.earning.id)).status).toBe('ON_HOLD');
      expect((await batchFor(driver)).payout).toBeNull();
      expect((await release(qr.earning.id).expect(200)).body.status).toBe('PAYABLE');
      const { payout } = await paidOut(driver);
      expect(payout.amountPaise).toBe(45_000n);
      // Nothing moved on its own for the undelivered drop: the cash trip's only wallet entry is
      // its pickup fee, the QR trip has none, and nothing was refunded or compensated.
      const entries = async (bookingId: string) =>
        (
          await ctx.prisma.driverWalletTransaction.findMany({ where: { referenceId: bookingId } })
        ).map((entry) => [entry.type, entry.direction, entry.amountPaise]);
      expect(await entries(cash.earning.bookingId)).toEqual([['CASH_RIDE_FEE', 'DEBIT', 5_000n]]);
      expect(await entries(qr.earning.bookingId)).toEqual([]);
      expect(await walletBalance(ctx, driver.driverId)).toBe(100_000n - 5_000n);
    });
  });

  // The same trips with the review hold switched off: the mechanism is configurable, and the
  // money rules don't depend on it.
  describe('undelivered drop with the review hold off (EARNINGS_UNDELIVERED_DROP_HOLD=false)', () => {
    let off: TestContext;
    let offAdmin: TestAdmin;

    beforeAll(async () => {
      off = await createTestApp({ configOverrides: { EARNINGS_UNDELIVERED_DROP_HOLD: 'false' } });
      offAdmin = await createAdmin(off);
    });

    afterAll(async () => {
      await off.close();
    });

    it('pays out only what was collected, once settled, without review; the unpaid drop adds nothing and nothing is refunded or debited', async () => {
      const driver = await createDriver(off);
      await createVerifiedBankAccount(off.prisma, driver.driverId, offAdmin.userId);
      await fundWallet(off, offAdmin, driver.driverId, 100_000);
      const trip = await bookedTrip(off, await createCustomer(off), driver, {
        paymentMethod: 'PAY_AT_DELIVERY',
        model: 'QUOTE_PER_STOP',
        farePaise: 50_000,
        dropPaise: [20_000, 30_000],
        category,
      });
      await advanceTrip(off, trip.tripId, TO_IN_TRANSIT);
      await setStopStatus(off, trip.tripId, 1, 'ARRIVED').expect(200);
      const shown = await collect(off, driver, trip.tripId, {
        method: 'ONLINE_QR',
        amountPaise: 20_000,
        stopSequence: 1,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      const paymentId = off.links.pay(off.links.byCollection(collectionId).referenceId).id;
      await request(off.server)
        .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
        .set(bearer(driver.token))
        .expect(200);
      await setStopStatus(off, trip.tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(off, trip.tripId, 2, 'ARRIVED').expect(200);
      await setStopStatus(off, trip.tripId, 2, 'DELIVERY_FAILED', 'Receiver not at home').expect(
        200,
      );
      await resolveStop(off, offAdmin, trip.bookingId, 2, {
        resolution: 'UNDELIVERED',
        reason: 'Customer cancelled this drop',
      }).expect(200);
      await setTripStatus(off, trip.tripId, 'COMPLETED').expect(200);

      const earning = await off.prisma.driverEarning.findUniqueOrThrow({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      // No hold, but still only drop 1's money.
      expect(earning).toMatchObject({
        settlement: 'ONLINE',
        status: 'AWAITING_SETTLEMENT',
        holdReason: null,
        grossAmountPaise: 20_000n,
        platformFeePaise: 2_000n,
        payoutAmountPaise: 18_000n,
      });
      expect(earning.collectionLinks.map((link) => link.collectionId)).toEqual([collectionId]);
      // Not payable before Razorpay settles drop 1's payment.
      expect(
        await off.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } }),
      ).toMatchObject({ status: 'AWAITING_SETTLEMENT' });
      await settleAndSync(off, paymentId, 20_000);
      expect(
        (await off.prisma.driverEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
      ).toBe('PAYABLE');
      const batch = await request(off.server)
        .post('/v1/admin/payout-batches')
        .set(bearer(offAdmin.token))
        .set('Idempotency-Key', idempotencyKey())
        .send({})
        .expect(201);
      const payout = await off.prisma.driverPayout.findUniqueOrThrow({
        where: {
          batchId_driverId: {
            batchId: batch.body.batch.batchId as string,
            driverId: driver.driverId,
          },
        },
        include: { items: true },
      });
      expect(payout.amountPaise).toBe(18_000n);
      expect(payout.items.map((item) => [item.earningId, item.amountPaise])).toEqual([
        [earning.id, 18_000n],
      ]);
      // Nothing moved on its own.
      expect(
        await off.prisma.driverWalletTransaction.count({ where: { referenceId: trip.bookingId } }),
      ).toBe(0);
      expect(await walletBalance(off, driver.driverId)).toBe(100_000n);
      expect(
        await off.prisma.booking.findUniqueOrThrow({ where: { id: trip.bookingId } }),
      ).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PARTIALLY_PAID' });
    });
  });

  describe('settlement findings', () => {
    it('an unknown settled payment and an amount mismatch are recorded for review, counted, never applied', async () => {
      const { paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      const qr = paid[1] as PaidDrop;
      const unknown = `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      await settleAndSync(ctx, unknown, 12_345);
      await settleAndSync(ctx, qr.paymentId as string, 1);
      await sync();
      const findings = await ctx.prisma.settlementFinding.findMany({
        where: { providerPaymentId: { in: [unknown, qr.paymentId as string] } },
        orderBy: { kind: 'asc' },
      });
      expect(
        findings.map((finding) => [
          finding.kind,
          finding.settledAmountPaise,
          finding.expectedAmountPaise,
          finding.collectionId,
        ]),
      ).toEqual([
        ['AMOUNT_MISMATCH', 1n, 30_000n, qr.collectionId],
        ['UNKNOWN_PAYMENT', 12_345n, null, null],
      ]);
      expect(findings.every((finding) => finding.occurrences >= 2)).toBe(true);
      expect((await earningRow(earning.id)).status).toBe('AWAITING_SETTLEMENT');
      const report = await request(ctx.server)
        .get('/v1/admin/reconciliation/settlement-anomalies')
        .set(bearer(admin.token))
        .expect(200);
      const problems = (report.body as { problem: string; detail: string }[])
        .filter(
          (row) => row.detail.startsWith(unknown) || row.detail.startsWith(qr.paymentId as string),
        )
        .map((row) => row.problem)
        .sort();
      expect(problems).toEqual(['SETTLEMENT_AMOUNT_MISMATCH', 'SETTLEMENT_UNKNOWN_PAYMENT']);
      // Findings are recorded once and only counted afterwards.
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE settlement_findings SET settled_amount_paise = 30000 WHERE provider_payment_id = ${qr.paymentId}`,
      ).rejects.toThrow(/recorded once/);
      await expect(
        ctx.prisma
          .$executeRaw`DELETE FROM settlement_findings WHERE provider_payment_id = ${unknown}`,
      ).rejects.toThrow();
    });
  });

  describe('concurrency', () => {
    it('the same settlement synced three times at once: one settlement, the earning promoted once', async () => {
      const { paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      const qr = paid[1] as PaidDrop;
      ctx.settlements.settle({ providerPaymentId: qr.paymentId as string, amountPaise: 30_000 });
      const results = await Promise.all([sync(), sync(), sync()]);
      expect(results.reduce((sum, result) => sum + result.recorded, 0)).toBe(1);
      expect(
        await ctx.prisma.paymentSettlement.count({ where: { collectionId: qr.collectionId } }),
      ).toBe(1);
      expect((await earningRow(earning.id)).status).toBe('PAYABLE');
    });

    it('the last QR settlement racing a payout batch: never paid unsettled, carried exactly once', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['QR', 'QR']);
      const [first, second] = paid as [PaidDrop, PaidDrop];
      await settleAndSync(ctx, first.paymentId as string, 20_000);
      ctx.settlements.settle({
        providerPaymentId: second.paymentId as string,
        amountPaise: 30_000,
      });
      const [raced] = await Promise.all([batchFor(trip.driver), sync()]);
      if (raced.payout) {
        expect(raced.payout.amountPaise).toBe(45_000n);
      }
      if (!raced.payout) {
        // The batch locked its earnings before the settlement was applied: the next one has it.
        expect((await batchFor(trip.driver)).payout?.amountPaise).toBe(45_000n);
      }
      expect(await liveItems(earning.id)).toHaveLength(1);
      expect((await earningRow(earning.id)).status).toBe('IN_PAYOUT');
    });

    it('two batches at once and two executions at once: one live item, one transfer', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      await settleAndSync(ctx, (paid[1] as PaidDrop).paymentId as string, 30_000);
      const [a, b] = await Promise.all([batchFor(trip.driver), batchFor(trip.driver)]);
      const [payout] = [a.payout, b.payout].filter((candidate) => candidate !== null);
      expect([a.payout, b.payout].filter((candidate) => candidate !== null)).toHaveLength(1);
      expect(await liveItems(earning.id)).toHaveLength(1);
      const batchId = a.payout ? a.batchId : b.batchId;
      const before = ctx.payouts.calls.createPayout;
      await Promise.all([execute(batchId).expect(200), execute(batchId).expect(200)]);
      expect(ctx.payouts.calls.createPayout - before).toBeLessThanOrEqual(2);
      // Whatever the interleaving, RazorpayX holds one transfer for this payout.
      expect(
        [...ctx.payouts.payouts.values()].filter((stored) => stored.referenceId === payout?.id),
      ).toHaveLength(1);
      const provider = ctx.payouts.byReference(payout?.id as string);
      expect(provider).toBeDefined();
      const processed = ctx.payouts.setStatus(provider?.id as string, 'processed');
      const webhook = buildPayoutWebhook('payout.processed', processed);
      await Promise.all([
        sendPayoutWebhook(ctx, webhook).expect(200),
        sendPayoutWebhook(ctx, webhook).expect(200),
      ]);
      expect(await earningRow(earning.id)).toMatchObject({ status: 'PAID' });
      expect(
        await ctx.prisma.payoutItem.count({ where: { earningId: earning.id, status: 'PAID' } }),
      ).toBe(1);
    });

    it('a payout whose response was lost is found again by reference and paid once', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      await settleAndSync(ctx, (paid[1] as PaidDrop).paymentId as string, 30_000);
      const { batchId, payout } = await batchFor(trip.driver);
      if (!payout) {
        throw new Error('expected a payout');
      }
      ctx.payouts.queueCreatePayoutBehaviour('lose-response');
      await execute(batchId).expect(200);
      expect(
        (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).status,
      ).toBe('SUBMITTING');
      const synced = await request(ctx.server)
        .post(`/v1/admin/payouts/${payout.id}/sync`)
        .set(bearer(admin.token))
        .expect(200);
      expect(synced.body.payout.status).toBe('SUBMITTED');
      const provider = ctx.payouts.byReference(payout.id);
      const processed = ctx.payouts.setStatus(provider?.id as string, 'processed');
      await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);
      expect((await earningRow(earning.id)).status).toBe('PAID');
      expect(
        (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: payout.id } })).amountPaise,
      ).toBe(27_000n);
    });

    it('an admin release racing a new batch after a failed payout: the earning is carried once', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      await settleAndSync(ctx, (paid[1] as PaidDrop).paymentId as string, 30_000);
      const { batchId, payout } = await batchFor(trip.driver);
      await execute(batchId).expect(200);
      const provider = ctx.payouts.byReference(payout?.id as string);
      const failed = ctx.payouts.setStatus(provider?.id as string, 'failed', {
        failureReason: 'IMPS limit reached',
      });
      await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.failed', failed)).expect(200);
      expect((await earningRow(earning.id)).status).toBe('ON_HOLD');

      await Promise.all([release(earning.id).expect(200), batchFor(trip.driver)]);
      if ((await liveItems(earning.id)).length === 0) {
        await batchFor(trip.driver);
      }
      expect(await liveItems(earning.id)).toHaveLength(1);
      expect((await earningRow(earning.id)).status).toBe('IN_PAYOUT');
    });

    it('payout execution racing an admin release or hold: never paid twice, never released mid-payout', async () => {
      const { trip, paid, earning } = await completedTrip([20_000, 30_000], ['CASH', 'QR']);
      await settleAndSync(ctx, (paid[1] as PaidDrop).paymentId as string, 30_000);
      const hold = () =>
        request(ctx.server)
          .post(`/v1/admin/earnings/${earning.id}/hold`)
          .set(bearer(admin.token))
          .send({ reason: 'Ops review, ticket 5151: hold while the drop is checked' });
      const transfersFor = (payoutId: string) =>
        [...ctx.payouts.payouts.values()].filter((stored) => stored.referenceId === payoutId);

      // RazorpayX rejects the transfer while an admin releases the earning.
      const first = await batchFor(trip.driver);
      if (!first.payout) {
        throw new Error('expected a payout');
      }
      ctx.payouts.queueCreatePayoutBehaviour('reject');
      const [executed, released] = await Promise.all([execute(first.batchId), release(earning.id)]);
      expect(executed.status).toBe(200);
      // Before the rejection the earning is IN_PAYOUT (release refused); after it, ON_HOLD
      // (release accepted). Either way the failed payout carries nothing any more.
      expect([200, 409]).toContain(released.status);
      expect(
        (await ctx.prisma.driverPayout.findUniqueOrThrow({ where: { id: first.payout.id } }))
          .status,
      ).toBe('FAILED');
      expect(transfersFor(first.payout.id)).toEqual([]);
      expect(await liveItems(earning.id)).toEqual([]);
      const afterRace = await earningRow(earning.id);
      expect(['ON_HOLD', 'PAYABLE']).toContain(afterRace.status);
      if (afterRace.status === 'ON_HOLD') {
        expect(afterRace.holdReason).toMatch(/^PAYOUT_FAILED: /);
        expect((await release(earning.id).expect(200)).body.status).toBe('PAYABLE');
      }

      // A new payout executes while an admin tries to release and to hold its earning: both
      // are refused (409) for as long as the earning is IN_PAYOUT, and one transfer is made.
      const second = await batchFor(trip.driver);
      if (!second.payout) {
        throw new Error('expected a new payout');
      }
      expect(second.payout.amountPaise).toBe(27_000n);
      const [run, releasing, holding] = await Promise.all([
        execute(second.batchId),
        release(earning.id),
        hold(),
      ]);
      expect([run.status, releasing.status, holding.status]).toEqual([200, 409, 409]);
      expect((await earningRow(earning.id)).status).toBe('IN_PAYOUT');
      const [transfer] = transfersFor(second.payout.id);
      expect(transfersFor(second.payout.id)).toHaveLength(1);
      expect(transfer?.amount).toBe(27_000);
      const processed = ctx.payouts.setStatus(transfer?.id as string, 'processed');
      await sendPayoutWebhook(ctx, buildPayoutWebhook('payout.processed', processed)).expect(200);
      expect((await earningRow(earning.id)).status).toBe('PAID');
      expect(
        await ctx.prisma.payoutItem.findMany({ where: { earningId: earning.id, status: 'PAID' } }),
      ).toMatchObject([{ payoutId: second.payout.id, amountPaise: 27_000n }]);
    });

    it('the last drop paid by QR racing the trip completion: one earning with every collection', async () => {
      const trip = await underWay([20_000, 30_000]);
      await payDrop(trip, 1, 'CASH');
      await setStopStatus(ctx, trip.tripId, 1, 'DELIVERED').expect(200);
      await setStopStatus(ctx, trip.tripId, 2, 'ARRIVED').expect(200);
      const shown = await collect(ctx, trip.driver, trip.tripId, {
        method: 'ONLINE_QR',
        amountPaise: 30_000,
        stopSequence: 2,
      }).expect(201);
      const collectionId = shown.body.collectionId as string;
      const link = ctx.links.byCollection(collectionId);
      const payment = ctx.links.pay(link.referenceId);
      // Razorpay's webhook and the app's refresh confirm the payment while the engine reports the
      // handover and the completion: whichever order, the drop is delivered only once paid and
      // the trip completes with both collections.
      await Promise.all([
        sendWebhook(ctx, buildPaymentLinkWebhook('payment_link.paid', link, payment)),
        request(ctx.server)
          .get(`/v1/trips/${trip.tripId}/collections/${collectionId}`)
          .set(bearer(trip.driver.token)),
        (async () => {
          await setStopStatus(ctx, trip.tripId, 2, 'DELIVERED');
          await setTripStatus(ctx, trip.tripId, 'COMPLETED');
        })(),
      ]);
      await setStopStatus(ctx, trip.tripId, 2, 'DELIVERED').expect(200);
      await setTripStatus(ctx, trip.tripId, 'COMPLETED').expect(200);
      const earnings = await ctx.prisma.driverEarning.findMany({
        where: { bookingId: trip.bookingId },
        include: { collectionLinks: true },
      });
      expect(earnings).toHaveLength(1);
      expect(earnings[0]).toMatchObject({
        settlement: 'MIXED',
        grossAmountPaise: 50_000n,
        payoutAmountPaise: 27_000n,
      });
      expect(earnings[0]?.collectionLinks).toHaveLength(2);
    });
  });

  it('leaves the reconciliation reports clean for every flow above', async () => {
    for (const report of ['earning-mismatches', 'payout-mismatches']) {
      const findings = await request(ctx.server)
        .get(`/v1/admin/reconciliation/${report}`)
        .set(bearer(admin.token))
        .expect(200);
      const ours = await ctx.prisma.driverEarning.findMany({
        where: { feeRule: { category } },
        select: { id: true },
      });
      const ids = new Set(ours.map((earning) => earning.id));
      // Runs after the flows above (it is declared last), so it checks their earnings.
      expect(ids.size).toBeGreaterThan(20);
      expect(
        (findings.body as { earningId: string | null; problem: string }[]).filter(
          (finding) => finding.earningId !== null && ids.has(finding.earningId),
        ),
      ).toEqual([]);
    }
  });
});
