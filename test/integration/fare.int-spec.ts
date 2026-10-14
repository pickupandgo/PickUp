import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { runProvisionCommand } from '../../src/cli/provision-commands';
import { FareQuoteRedeemer } from '../../src/fare/fare-contract';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  bearer,
  clearPricingVersions,
  createAdmin,
  createCustomer,
  createDriver,
  createFareQuote,
  createPricingVersion,
  TEST_PRICING_CONFIG,
  type TestAdmin,
  type TestCustomer,
  uniqueVersionCode,
} from '../helpers/fixtures';
import { engine } from '../helpers/flows';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_DATABASE_URL } from '../setup/test-database';

/**
 * The Fare module: versioned pricing and server-calculated quotes. Every amount a customer sees
 * is computed here from the pricing version in effect and frozen on the quote; the apps only
 * send locations, a vehicle category and a weight. Booking registration redeems the quote.
 *
 * Exact amounts are asserted where the arithmetic can be checked by hand (a zero-length route is
 * exactly the base fare). Real routes are asserted through the invariants that matter: the drops
 * add up to the total, and a heavier or longer route never costs less.
 */
describe('Fare quotes and pricing versions', () => {
  let ctx: TestContext;
  let owner: PrismaClient;
  let admin: TestAdmin;
  let customer: TestCustomer;
  let redeemer: FareQuoteRedeemer;

  // Quotes are rate limited per customer (30/min) and version changes per admin (10/min), so
  // both are spread over a pool. `customer` and `admin` stay for the ownership and audit checks.
  let customers: TestCustomer[] = [];
  let admins: TestAdmin[] = [];
  let quoteCalls = 0;
  let adminCalls = 0;

  function nextCustomer(): TestCustomer {
    const next = customers[quoteCalls % customers.length];
    quoteCalls += 1;
    if (!next) {
      throw new Error('customer pool is empty');
    }
    return next;
  }

  function nextAdmin(): TestAdmin {
    const next = admins[adminCalls % admins.length];
    adminCalls += 1;
    if (!next) {
      throw new Error('admin pool is empty');
    }
    return next;
  }

  /** Pickup in Jodhpur with one drop about 12 km north. */
  const ROUTE = {
    pickup: { latitude: 26.2389, longitude: 73.0243 },
    drops: [{ latitude: 26.3448, longitude: 73.0458 }],
    vehicleCategory: 'MINI_TRUCK',
    weightKg: 1,
  };
  /** One drop at the pickup: no distance, so the fare is exactly the first-leg base, Rs 30. */
  const ZERO_LENGTH_ROUTE = { ...ROUTE, drops: [ROUTE.pickup] };
  const FIRST_LEG_BASE_PAISE = TEST_PRICING_CONFIG.vehicles.MINI_TRUCK.firstLegBasePaise;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 2 }),
    });
    admin = await createAdmin(ctx);
    customer = await createCustomer(ctx);
    admins = await Promise.all(Array.from({ length: 8 }, () => createAdmin(ctx)));
    customers = await Promise.all(Array.from({ length: 5 }, () => createCustomer(ctx)));
    redeemer = ctx.app.get(FareQuoteRedeemer);
    await clearPricingVersions(owner);
  });

  afterAll(async () => {
    await ctx.close();
    await owner.$disconnect();
  });

  /** Asks for a quote as one of the pool customers unless a specific one is given. */
  const quote = (body: Record<string, unknown> = {}, as: TestCustomer = nextCustomer()) =>
    request(ctx.server)
      .post('/v1/fare/quotes')
      .set(bearer(as.token))
      .send({ ...ROUTE, ...body });

  describe('with no pricing version in effect', () => {
    it('quotes nothing instead of falling back to a hard-coded fare', async () => {
      await clearPricingVersions(owner);
      const res = await quote().expect(503);
      expect(res.body.error.code).toBe('PRICING_NOT_CONFIGURED');
      expect(await ctx.prisma.fareQuote.count()).toBe(0);

      const current = await request(ctx.server)
        .get('/v1/admin/pricing-versions/current')
        .set(bearer(admin.token))
        .expect(404);
      expect(current.body.error.code).toBe('PRICING_NOT_CONFIGURED');
    });
  });

  describe('quotes', () => {
    beforeAll(async () => {
      await clearPricingVersions(owner);
      await createPricingVersion(owner);
    });

    it('prices a zero-length route at exactly the base fare, in whole paise', async () => {
      const res = await quote(ZERO_LENGTH_ROUTE).expect(201);
      expect(res.body).toMatchObject({
        distanceMeters: 0,
        farePaise: FIRST_LEG_BASE_PAISE,
        taxPaise: 0,
        payablePaise: FIRST_LEG_BASE_PAISE,
        currency: 'INR',
      });
      expect(res.body.drops).toEqual([
        expect.objectContaining({
          sequence: 1,
          distanceMeters: 0,
          farePaise: FIRST_LEG_BASE_PAISE,
          taxPaise: 0,
          payablePaise: FIRST_LEG_BASE_PAISE,
        }),
      ]);
    });

    it('prices every drop separately, and the total is exactly the sum of the drops', async () => {
      const res = await quote({
        drops: [
          { latitude: 26.3448, longitude: 73.0458 },
          { latitude: 26.3448, longitude: 73.0858 },
        ],
      }).expect(201);

      const [first, second] = res.body.drops;
      expect(res.body.drops).toHaveLength(2);
      expect(first.sequence).toBe(1);
      expect(second.sequence).toBe(2);
      // The second leg runs from the first drop, so it is much shorter than the first.
      expect(first.distanceMeters).toBeGreaterThan(11_000);
      expect(second.distanceMeters).toBeLessThan(5_000);
      // Each leg carries its own base: the first drop costs more than the second.
      expect(first.payablePaise).toBeGreaterThan(second.payablePaise);
      expect(res.body.farePaise).toBe(first.farePaise + second.farePaise);
      expect(res.body.payablePaise).toBe(res.body.farePaise + res.body.taxPaise);
      expect(res.body.distanceMeters).toBe(first.distanceMeters + second.distanceMeters);
      // Rounded up to whole rupees by this version.
      expect(res.body.payablePaise % 100).toBe(0);
      expect(res.body).toMatchObject({ vehicleCategory: 'MINI_TRUCK', weightKg: 1, taxPaise: 0 });
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(res.body.redeemed).toBe(false);

      const stored = await ctx.prisma.fareQuote.findUniqueOrThrow({
        where: { id: res.body.quoteId as string },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });
      expect(stored.payablePaise).toBe(BigInt(res.body.payablePaise));
      expect(stored.stops.map((stop) => Number(stop.payablePaise))).toEqual([
        first.payablePaise,
        second.payablePaise,
      ]);
      expect(stored.redeemedAt).toBeNull();
      expect(stored.pricingVersionId).toBe(res.body.pricingVersion.pricingVersionId);
    });

    it('charges more for a longer route and for a heavier load', async () => {
      const near = await quote(ZERO_LENGTH_ROUTE).expect(201);
      const far = await quote().expect(201);
      expect(far.body.payablePaise).toBeGreaterThan(near.body.payablePaise);

      const light = await quote({ weightKg: 5 }).expect(201);
      const heavy = await quote({ weightKg: 5.001 }).expect(201);
      expect(light.body.payablePaise).toBe(far.body.payablePaise);
      expect(heavy.body.payablePaise).toBeGreaterThan(light.body.payablePaise);
      expect(heavy.body.payablePaise % 100).toBe(0);
    });

    it('never accepts an amount from the app', async () => {
      for (const tampered of [
        { farePaise: 1 },
        { payablePaise: 1 },
        { amountPaise: 1 },
        { pricingVersionId: 'anything' },
      ]) {
        const res = await quote(tampered).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await ctx.prisma.fareQuote.count({ where: { payablePaise: 1n } })).toBe(0);
    });

    it('validates the route itself', async () => {
      expect((await quote({ drops: [] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect(
        (await quote({ drops: Array.from({ length: 6 }, () => ROUTE.drops[0]) }).expect(400)).body
          .error.code,
      ).toBe('VALIDATION_FAILED');
      await quote({ pickup: { latitude: 91, longitude: 73 } }).expect(400);
      await quote({ weightKg: 0 }).expect(400);
      await quote({ weightKg: 1.00049 }).expect(400);
      await quote({ vehicleCategory: 'mini_truck' }).expect(400);
    });

    it('refuses a vehicle category the version does not price', async () => {
      const res = await quote({ vehicleCategory: 'JCB' }).expect(422);
      expect(res.body.error.code).toBe('VEHICLE_CATEGORY_NOT_PRICED');
      expect(res.body.error.details).toMatchObject({
        vehicleCategory: 'JCB',
        pricedCategories: ['MINI_TRUCK'],
      });
    });

    it('shows a customer only their own quote, and drivers none at all', async () => {
      const mine = await quote({}, customer).expect(201);
      const other = await createCustomer(ctx);
      const driver = await createDriver(ctx);

      const read = await request(ctx.server)
        .get(`/v1/fare/quotes/${mine.body.quoteId}`)
        .set(bearer(customer.token))
        .expect(200);
      expect(read.body.payablePaise).toBe(mine.body.payablePaise);

      const stolen = await request(ctx.server)
        .get(`/v1/fare/quotes/${mine.body.quoteId}`)
        .set(bearer(other.token))
        .expect(404);
      expect(stolen.body.error.code).toBe('QUOTE_NOT_FOUND');
      await request(ctx.server)
        .get(`/v1/fare/quotes/${mine.body.quoteId}`)
        .set(bearer(driver.token))
        .expect(403);
      await request(ctx.server).post('/v1/fare/quotes').send(ROUTE).expect(401);
    });

    it('serves the priced route to the trip engine, and nobody else', async () => {
      const mine = await quote({}, customer).expect(201);
      const res = await engine(ctx)
        .get(`/v1/internal/fare-quotes/${mine.body.quoteId}`)
        .expect(200);
      expect(res.body).toMatchObject({
        quoteId: mine.body.quoteId,
        customerId: customer.customerId,
        payablePaise: mine.body.payablePaise,
      });
      expect(res.body.drops).toHaveLength(1);
      await request(ctx.server).get(`/v1/internal/fare-quotes/${mine.body.quoteId}`).expect(401);
      await request(ctx.server)
        .get(`/v1/internal/fare-quotes/${mine.body.quoteId}`)
        .set(bearer(customer.token))
        .expect(401);
    });
  });

  describe('redeeming a quote for a booking', () => {
    let versionId: string;

    beforeAll(async () => {
      await clearPricingVersions(owner);
      versionId = (await createPricingVersion(owner)).id;
    });

    const redeem = (quoteId: string, customerId: string, at = new Date()) =>
      ctx.prisma.runInTransaction((tx) => redeemer.redeem(tx, { quoteId, customerId, at }));

    it('hands over the frozen amounts exactly once', async () => {
      const created = await createFareQuote(owner, {
        customerId: customer.customerId,
        pricingVersionId: versionId,
        dropPaise: [30_000, 20_000],
      });

      const frozen = await redeem(created.quoteId, customer.customerId);
      expect(frozen).toMatchObject({
        quoteId: created.quoteId,
        customerId: customer.customerId,
        pricingVersionId: versionId,
        farePaise: 50_000n,
        taxPaise: 0n,
        payablePaise: 50_000n,
      });
      expect(frozen.stops.map((stop) => stop.payablePaise)).toEqual([30_000n, 20_000n]);
      expect(frozen.stops.reduce((sum, stop) => sum + stop.payablePaise, 0n)).toBe(
        frozen.payablePaise,
      );

      await expect(redeem(created.quoteId, customer.customerId)).rejects.toMatchObject({
        code: 'QUOTE_ALREADY_USED',
        status: 409,
      });
      const stored = await ctx.prisma.fareQuote.findUniqueOrThrow({
        where: { id: created.quoteId },
      });
      expect(stored.redeemedAt).not.toBeNull();
    });

    it('refuses an expired quote, so a stale price is never booked', async () => {
      const createdAt = new Date(Date.now() - 3_600_000);
      const created = await createFareQuote(owner, {
        customerId: customer.customerId,
        pricingVersionId: versionId,
        dropPaise: [25_000],
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 600_000),
      });
      await expect(redeem(created.quoteId, customer.customerId)).rejects.toMatchObject({
        code: 'QUOTE_EXPIRED',
        status: 409,
      });
      expect(
        (await ctx.prisma.fareQuote.findUniqueOrThrow({ where: { id: created.quoteId } }))
          .redeemedAt,
      ).toBeNull();
    });

    it("reports another customer's quote exactly like a missing one", async () => {
      const other = await createCustomer(ctx);
      const created = await createFareQuote(owner, {
        customerId: customer.customerId,
        pricingVersionId: versionId,
        dropPaise: [25_000],
      });
      await expect(redeem(created.quoteId, other.customerId)).rejects.toMatchObject({
        code: 'QUOTE_NOT_FOUND',
        status: 422,
      });
      await expect(
        redeem('11111111-1111-4111-8111-111111111111', customer.customerId),
      ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND', status: 422 });
      expect(
        (await ctx.prisma.fareQuote.findUniqueOrThrow({ where: { id: created.quoteId } }))
          .redeemedAt,
      ).toBeNull();
    });

    it('is redeemed once even when several bookings race for it', async () => {
      const created = await createFareQuote(owner, {
        customerId: customer.customerId,
        pricingVersionId: versionId,
        dropPaise: [40_000],
      });
      const results = await Promise.allSettled([
        redeem(created.quoteId, customer.customerId),
        redeem(created.quoteId, customer.customerId),
        redeem(created.quoteId, customer.customerId),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({ code: 'QUOTE_ALREADY_USED' });
        }
      }
    });
  });

  describe('the database protects quotes even from a bug in this service', () => {
    let versionId: string;

    beforeAll(async () => {
      await clearPricingVersions(owner);
      versionId = (await createPricingVersion(owner)).id;
    });

    it('refuses to change a quote, its drops, or to delete either', async () => {
      const created = await createFareQuote(owner, {
        customerId: customer.customerId,
        pricingVersionId: versionId,
        dropPaise: [30_000, 20_000],
      });
      const id = created.quoteId;

      await expect(
        owner.$executeRaw`UPDATE fare_quotes SET payable_paise = 1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        owner.$executeRaw`UPDATE fare_quotes SET expires_at = now() + interval '1 day' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        owner.$executeRaw`UPDATE fare_quote_stops SET payable_paise = 1 WHERE quote_id = ${id}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        owner.$executeRaw`DELETE FROM fare_quotes WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
      await expect(
        owner.$executeRaw`DELETE FROM fare_quote_stops WHERE quote_id = ${id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);

      // redeemed_at may be set once, and never moved afterwards.
      await owner.$executeRaw`UPDATE fare_quotes SET redeemed_at = created_at WHERE id = ${id}::uuid`;
      await expect(
        owner.$executeRaw`UPDATE fare_quotes SET redeemed_at = NULL WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/redeemed once/);
    });

    it('refuses a quote whose drops do not add up to its total', async () => {
      await expect(
        createFareQuote(owner, {
          customerId: customer.customerId,
          pricingVersionId: versionId,
          dropPaise: [30_000],
        }).then(() =>
          owner.$transaction(async (tx) => {
            const created = await tx.fareQuote.create({
              data: {
                customerId: customer.customerId,
                pricingVersionId: versionId,
                vehicleCategory: 'MINI_TRUCK',
                weightGrams: 1_000,
                pickupLatitude: '26.238900',
                pickupLongitude: '73.024300',
                distanceMeters: 1_000,
                farePaise: 50_000n,
                taxPaise: 0n,
                payablePaise: 50_000n,
                expiresAt: new Date(Date.now() + 600_000),
              },
            });
            await tx.fareQuoteStop.create({
              data: {
                quoteId: created.id,
                sequence: 1,
                latitude: '26.300000',
                longitude: '73.045800',
                distanceMeters: 1_000,
                farePaise: 40_000n,
                taxPaise: 0n,
                payablePaise: 40_000n,
              },
            });
          }),
        ),
      ).rejects.toThrow(/do not add up/);
    });

    it('refuses a quote with no drops at all', async () => {
      await expect(
        owner.fareQuote.create({
          data: {
            customerId: customer.customerId,
            pricingVersionId: versionId,
            vehicleCategory: 'MINI_TRUCK',
            weightGrams: 1_000,
            pickupLatitude: '26.238900',
            pickupLongitude: '73.024300',
            distanceMeters: 0,
            farePaise: 10_000n,
            taxPaise: 0n,
            payablePaise: 10_000n,
            expiresAt: new Date(Date.now() + 600_000),
          },
        }),
      ).rejects.toThrow(/stops numbered 1\.\.n/);
    });

    it('refuses an amount outside what one Razorpay order can take', async () => {
      await expect(
        owner.$executeRaw`
          INSERT INTO fare_quotes (customer_id, pricing_version_id, vehicle_category, weight_grams,
            pickup_latitude, pickup_longitude, distance_meters, fare_paise, tax_paise,
            payable_paise, expires_at)
          VALUES (${customer.customerId}::uuid, ${versionId}::uuid, 'MINI_TRUCK', 1000,
            26.2389, 73.0243, 1000, 99, 0, 99, now() + interval '10 minutes')`,
      ).rejects.toThrow(/fare_quotes_payable_range/);
    });
  });

  describe('admin pricing versions', () => {
    beforeAll(async () => {
      await clearPricingVersions(owner);
    });

    function create(body: Record<string, unknown>) {
      return request(ctx.server)
        .post('/v1/admin/pricing-versions')
        .set(bearer(nextAdmin().token))
        .send(body);
    }

    const adminIds = () => new Set(admins.map((candidate) => candidate.userId));

    it('creates a version, closes the previous one, and keeps old quotes on their own version', async () => {
      const first = await create({
        code: uniqueVersionCode(),
        model: 'LEG_DISTANCE_V1',
        config: TEST_PRICING_CONFIG,
        reason: 'First approved fares for the integration test',
      }).expect(201);
      expect(first.body.version).toMatchObject({ active: true, inEffect: true, effectiveTo: null });
      expect(first.body.superseded).toBeNull();

      const before = await quote(ZERO_LENGTH_ROUTE, customer).expect(201);
      expect(before.body.pricingVersion.pricingVersionId).toBe(first.body.version.pricingVersionId);
      expect(before.body.payablePaise).toBe(FIRST_LEG_BASE_PAISE);

      const dearer = {
        ...TEST_PRICING_CONFIG,
        vehicles: {
          MINI_TRUCK: {
            ...TEST_PRICING_CONFIG.vehicles.MINI_TRUCK,
            firstLegBasePaise: FIRST_LEG_BASE_PAISE * 2,
          },
        },
      };
      const second = await create({
        code: uniqueVersionCode(),
        model: 'LEG_DISTANCE_V1',
        config: dearer,
        reason: 'Second version for the integration test',
      }).expect(201);
      expect(second.body.superseded).toMatchObject({
        pricingVersionId: first.body.version.pricingVersionId,
        effectiveTo: second.body.version.effectiveFrom,
      });

      const after = await quote(ZERO_LENGTH_ROUTE, customer).expect(201);
      expect(after.body.pricingVersion.pricingVersionId).toBe(second.body.version.pricingVersionId);
      expect(after.body.payablePaise).toBe(FIRST_LEG_BASE_PAISE * 2);

      // The earlier quote still shows the price it was given, on the version that priced it.
      const reread = await request(ctx.server)
        .get(`/v1/fare/quotes/${before.body.quoteId}`)
        .set(bearer(customer.token))
        .expect(200);
      expect(reread.body.payablePaise).toBe(FIRST_LEG_BASE_PAISE);
      expect(reread.body.pricingVersion.pricingVersionId).toBe(first.body.version.pricingVersionId);

      const audit = await ctx.prisma.adminAction.findMany({
        where: {
          targetId: {
            in: [first.body.version.pricingVersionId, second.body.version.pricingVersionId],
          },
        },
      });
      expect(audit.map((row) => row.action).sort()).toEqual([
        'PRICING_VERSION_CREATED',
        'PRICING_VERSION_CREATED',
        'PRICING_VERSION_SUPERSEDED',
      ]);
      expect(audit.every((row) => row.actorUserId !== null)).toBe(true);
      expect(audit.every((row) => adminIds().has(row.actorUserId as string))).toBe(true);
      expect(audit.every((row) => (row.reason ?? '').length >= 10)).toBe(true);
    });

    it('validates the config against its model and refuses overlaps and bad input', async () => {
      const base = {
        code: uniqueVersionCode(),
        model: 'LEG_DISTANCE_V1',
        config: TEST_PRICING_CONFIG,
        reason: 'Validation case for the integration test',
      };
      const invalid = await create({
        ...base,
        config: { ...TEST_PRICING_CONFIG, vehicles: {} },
      }).expect(400);
      expect(invalid.body.error.code).toBe('PRICING_VERSION_INVALID');
      expect(invalid.body.error.details.issues).toEqual(expect.any(Array));

      expect((await create({ ...base, config: { surge: 2 } }).expect(400)).body.error.code).toBe(
        'PRICING_VERSION_INVALID',
      );
      expect((await create({ ...base, model: 'SURGE_V2' }).expect(400)).body.error.code).toBe(
        'VALIDATION_FAILED',
      );
      expect((await create({ ...base, code: 'bad code' }).expect(400)).body.error.code).toBe(
        'VALIDATION_FAILED',
      );
      expect((await create({ ...base, reason: 'short' }).expect(400)).body.error.code).toBe(
        'VALIDATION_FAILED',
      );
      expect(
        (await create({ ...base, effectiveFrom: '2020-01-01T00:00:00.000Z' }).expect(400)).body
          .error.code,
      ).toBe('PRICING_VERSION_INVALID');
      expect(await ctx.prisma.pricingVersion.count({ where: { code: base.code } })).toBe(0);

      // A code is used once. The supersede of the open version rolls back with the failed create.
      await create(base).expect(201);
      const openBefore = await ctx.prisma.pricingVersion.findFirstOrThrow({
        where: { code: base.code },
      });
      const duplicate = await create(base).expect(409);
      expect(duplicate.body.error.code).toBe('PRICING_VERSION_INVALID');
      expect(await ctx.prisma.pricingVersion.count({ where: { code: base.code } })).toBe(1);
      expect(
        (await ctx.prisma.pricingVersion.findUniqueOrThrow({ where: { id: openBefore.id } }))
          .effectiveTo,
      ).toBeNull();

      // A future version closes the open one; anything starting between them then overlaps.
      await create({
        ...base,
        code: uniqueVersionCode(),
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
      }).expect(201);
      const overlap = await create({
        ...base,
        code: uniqueVersionCode(),
        effectiveFrom: new Date(Date.now() + 1_800_000).toISOString(),
      }).expect(409);
      expect(overlap.body.error.code).toBe('PRICING_VERSION_OVERLAP');
    });

    it('previews a route under any version without storing anything, and deactivates a version', async () => {
      await clearPricingVersions(owner);
      const created = await create({
        code: uniqueVersionCode(),
        model: 'LEG_DISTANCE_V1',
        config: TEST_PRICING_CONFIG,
        reason: 'Preview and deactivate case for the test',
      }).expect(201);
      const versionId = created.body.version.pricingVersionId as string;
      const quotesBefore = await ctx.prisma.fareQuote.count();

      const preview = await request(ctx.server)
        .post(`/v1/admin/pricing-versions/${versionId}/preview`)
        .set(bearer(nextAdmin().token))
        .send(ZERO_LENGTH_ROUTE)
        .expect(200);
      expect(preview.body).toMatchObject({
        payablePaise: FIRST_LEG_BASE_PAISE,
        farePaise: FIRST_LEG_BASE_PAISE,
        taxPaise: 0,
        distanceMeters: 0,
      });
      expect(preview.body.drops).toHaveLength(1);
      expect(await ctx.prisma.fareQuote.count()).toBe(quotesBefore);

      const asAdmin = (path: string) => request(ctx.server).get(path).set(bearer(admin.token));
      expect((await asAdmin('/v1/admin/pricing-versions/current').expect(200)).body).toMatchObject({
        pricingVersionId: versionId,
        inEffect: true,
      });
      expect((await asAdmin(`/v1/admin/pricing-versions/${versionId}`).expect(200)).body.code).toBe(
        created.body.version.code,
      );
      expect(
        (await asAdmin('/v1/admin/pricing-versions?activeOnly=true').expect(200)).body.length,
      ).toBeGreaterThan(0);

      const deactivate = (reason: string) =>
        request(ctx.server)
          .post(`/v1/admin/pricing-versions/${versionId}/deactivate`)
          .set(bearer(nextAdmin().token))
          .send({ reason });
      const deactivated = await deactivate('Created by mistake in the integration test').expect(
        200,
      );
      expect(deactivated.body).toMatchObject({
        active: false,
        inEffect: false,
        deactivationReason: 'Created by mistake in the integration test',
      });
      // Idempotent, and no new fare can be quoted now.
      await deactivate('Repeating the deactivation in the test').expect(200);
      expect((await quote().expect(503)).body.error.code).toBe('PRICING_NOT_CONFIGURED');
      expect(
        await ctx.prisma.adminAction.count({
          where: { targetId: versionId, action: 'PRICING_VERSION_DEACTIVATED' },
        }),
      ).toBe(1);
    });

    it('is closed to customers and drivers, and versions can never be edited in the database', async () => {
      const driver = await createDriver(ctx);
      await request(ctx.server)
        .post('/v1/admin/pricing-versions')
        .set(bearer(customer.token))
        .send({})
        .expect(403);
      await request(ctx.server)
        .get('/v1/admin/pricing-versions')
        .set(bearer(driver.token))
        .expect(403);
      await request(ctx.server).get('/v1/admin/pricing-versions').expect(401);

      const version = await createPricingVersion(owner, { active: false });
      await expect(
        owner.$executeRaw`UPDATE pricing_versions SET config = '{}'::jsonb WHERE id = ${version.id}::uuid`,
      ).rejects.toThrow(/never edited/);
      await expect(
        owner.$executeRaw`DELETE FROM pricing_versions WHERE id = ${version.id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
      await expect(
        owner.$executeRaw`UPDATE pricing_versions SET active = TRUE WHERE id = ${version.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`
          INSERT INTO pricing_versions (code, model, config, effective_from, reason)
          VALUES (${uniqueVersionCode()}, 'SURGE_V2', '{}'::jsonb, now(), 'forced model')`,
      ).rejects.toThrow(/pricing_versions_model_valid/);
    });

    it('creates a version from a reviewed config file through the ops CLI', async () => {
      await clearPricingVersions(owner);
      const code = `PROTOTYPE-${uniqueVersionCode().slice(0, 8)}`;
      const result = await runProvisionCommand(owner, 'firebase', {
        kind: 'create-pricing-version',
        code,
        model: 'LEG_DISTANCE_V1',
        configPath: 'pricing/prototype-leg-distance-v1.json',
        reason: 'Development only: prototype rates, not approved for production (D-14)',
      });
      expect(result).toMatchObject({
        code,
        model: 'LEG_DISTANCE_V1',
        supersededVersionId: null,
        developmentOnly: true,
      });
      expect(
        await owner.adminAction.count({
          where: { targetId: result.pricingVersionId, actorUserId: null },
        }),
      ).toBe(1);

      // The prototype file prices categories the test config does not, e.g. a 3-wheeler.
      const quoted = await quote({ vehicleCategory: 'THREE_WHEELER' }).expect(201);
      expect(quoted.body.pricingVersion.pricingVersionId).toBe(result.pricingVersionId);
      expect(quoted.body.payablePaise).toBeGreaterThan(0);
      expect(quoted.body.payablePaise % 100).toBe(0);

      await expect(
        runProvisionCommand(owner, 'firebase', {
          kind: 'create-pricing-version',
          code: uniqueVersionCode(),
          model: 'LEG_DISTANCE_V1',
          configPath: 'pricing/does-not-exist.json',
          reason: 'Missing file case for the integration test',
        }),
      ).rejects.toThrow(/could not be read as JSON/);
    });
  });
});
