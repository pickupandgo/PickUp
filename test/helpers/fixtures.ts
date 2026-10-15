import { randomInt, randomUUID } from 'node:crypto';
import { resolveFeeRule } from '../../src/fees/fee-rules';
import type { Booking, PricingVersion, PrismaClient } from '../../src/generated/prisma/client';
import type { BookingPaymentMethod } from '../../src/generated/prisma/enums';
import type { UserStatus } from '../../src/generated/prisma/enums';
import type { TestTokenIssuer } from './test-tokens';

export interface FixtureDeps {
  /** A client allowed to write identity tables (the owner role, not the API role). */
  readonly prisma: PrismaClient;
  readonly tokens: TestTokenIssuer;
}

export interface TestDriver {
  readonly userId: string;
  readonly driverId: string;
  readonly subject: string;
  readonly phone: string;
  readonly token: string;
}

export interface TestAdmin {
  readonly userId: string;
  readonly subject: string;
  readonly token: string;
}

export function uniquePhone(): string {
  return `+91${randomInt(6_000_000_000, 9_999_999_999)}`;
}

export function uniqueSubject(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function idempotencyKey(): string {
  return randomUUID();
}

/** KYC legal name every fixture driver gets unless a test says otherwise. */
export const FIXTURE_DRIVER_NAME = 'Test Driver';

export async function createDriver(
  deps: FixtureDeps,
  options: { approved?: boolean; status?: UserStatus; legalName?: string | null } = {},
): Promise<TestDriver> {
  const approved = options.approved ?? true;
  const subject = uniqueSubject('drv');
  const phone = uniquePhone();
  const user = await deps.prisma.user.create({
    data: {
      phone,
      role: 'DRIVER',
      status: options.status ?? 'ACTIVE',
      authIdentities: { create: { provider: 'firebase', subject } },
      driver: {
        create: {
          approvalStatus: approved ? 'APPROVED' : 'PENDING',
          approvedAt: approved ? new Date() : null,
          legalName: options.legalName === undefined ? FIXTURE_DRIVER_NAME : options.legalName,
        },
      },
    },
    include: { driver: true },
  });
  if (!user.driver) {
    throw new Error('Driver fixture was not created');
  }
  return {
    userId: user.id,
    driverId: user.driver.id,
    subject,
    phone,
    // Like a Firebase phone sign-in: auth_time = now, phone_number = the registered phone.
    token: deps.tokens.sign(subject, { phoneNumber: phone }),
  };
}

export async function createAdmin(deps: FixtureDeps): Promise<TestAdmin> {
  const subject = uniqueSubject('adm');
  const user = await deps.prisma.user.create({
    data: {
      phone: uniquePhone(),
      role: 'ADMIN',
      authIdentities: { create: { provider: 'firebase', subject } },
    },
  });
  return { userId: user.id, subject, token: deps.tokens.sign(subject) };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export interface TestCustomer {
  readonly userId: string;
  readonly customerId: string;
  readonly subject: string;
  readonly token: string;
}

export async function createCustomer(deps: FixtureDeps): Promise<TestCustomer> {
  const subject = uniqueSubject('cus');
  const user = await deps.prisma.user.create({
    data: {
      phone: uniquePhone(),
      role: 'CUSTOMER',
      authIdentities: { create: { provider: 'firebase', subject } },
      customer: { create: {} },
    },
    include: { customer: true },
  });
  if (!user.customer) {
    throw new Error('Customer fixture was not created');
  }
  return {
    userId: user.id,
    customerId: user.customer.id,
    subject,
    token: deps.tokens.sign(subject),
  };
}

/** A vehicle category code unique to the calling test file, so its fee rule is its own. */
export function uniqueCategory(): string {
  return `T${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
}

/**
 * Creates an active fee rule directly (as an admin would through the API), effective from a
 * minute ago so bookings registered right after it pick it up.
 */
export function createFeeRule(
  prisma: PrismaClient,
  options: {
    category: string | null;
    value?: string;
    ruleType?: 'PERCENTAGE' | 'FIXED';
  },
) {
  return prisma.feeRule.create({
    data: {
      category: options.category,
      ruleType: options.ruleType ?? 'PERCENTAGE',
      value: options.value ?? '10',
      roundingMode: 'HALF_UP',
      effectiveFrom: new Date(Date.now() - 60_000),
      reason: 'Integration test fee rule',
    },
  });
}

/**
 * A bank account an admin has approved, linked to fake provider ids. It goes through the real
 * states (the database refuses anything else): a step-up verified change request that adds the
 * account as PENDING_VERIFICATION, a completed ACTIVE bank validation with a MATCH, then
 * VERIFIED.
 */
export async function createVerifiedBankAccount(
  prisma: PrismaClient,
  driverId: string,
  adminUserId: string,
) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 14);
  const { user } = await prisma.driver.findUniqueOrThrow({
    where: { id: driverId },
    include: { user: true },
  });
  const request = await prisma.bankAccountChangeRequest.create({ data: { driverId } });
  // auth_time has whole seconds and must be after the request (the database checks it).
  const authTime = new Date((Math.floor(request.createdAt.getTime() / 1000) + 1) * 1000);
  const account = await prisma.$transaction(async (tx) => {
    await tx.bankAccountChangeRequest.update({
      where: { id: request.id },
      data: { status: 'STEP_UP_VERIFIED', stepUpAuthTime: authTime, stepUpPhone: user.phone },
    });
    const created = await tx.driverBankAccount.create({
      data: {
        driverId,
        accountHolderName: FIXTURE_DRIVER_NAME,
        ifsc: 'HDFC0001234',
        accountNumberLast4: '4321',
        provider: 'RAZORPAYX',
        providerContactId: `cont_${suffix}`,
        providerFundAccountId: `fa_${suffix}`,
        changeRequestId: request.id,
      },
    });
    await tx.bankAccountChangeRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED' },
    });
    return created;
  });
  const validation = await prisma.bankAccountVerification.create({
    data: {
      bankAccountId: account.id,
      provider: 'RAZORPAYX',
      providerValidationId: `fav_${suffix}`,
      method: 'PENNY_DROP',
      status: 'COMPLETED',
      accountStatus: 'ACTIVE',
      registeredName: FIXTURE_DRIVER_NAME.toUpperCase(),
      nameMatchResult: 'MATCH',
      comparedName: FIXTURE_DRIVER_NAME,
      completedAt: new Date(),
    },
  });
  return prisma.driverBankAccount.update({
    where: { id: account.id },
    data: {
      status: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedByUserId: adminUserId,
      verificationReference: validation.providerValidationId,
      approvedVerificationId: validation.id,
    },
  });
}

/**
 * Rates for test pricing versions: Rs 30 first leg, Rs 10 per extra drop, Rs 12/km, rounded up
 * to whole rupees, with the prototype's weight steps. Not a business decision (D-14).
 */
export const TEST_PRICING_CONFIG = {
  currency: 'INR',
  distanceModel: 'HAVERSINE',
  vehicles: {
    MINI_TRUCK: {
      firstLegBasePaise: 3000,
      additionalLegBasePaise: 1000,
      perKmPaise: 1200,
      minimumLegFarePaise: 100,
    },
  },
  weightBands: [
    { upToGrams: 5_000, multiplierBps: 10_000 },
    { upToGrams: null, multiplierBps: 12_000 },
  ],
  legRounding: { incrementPaise: 100, mode: 'UP' },
  taxes: [],
} as const;

/** A pricing version code unique to the calling test. */
export function uniqueVersionCode(): string {
  return `T${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
}

/**
 * Creates a pricing version directly (as the admin API would), effective from a minute ago so
 * quotes asked for right afterwards are priced by it. Any open version must be closed first:
 * two versions in effect at once is a data error the Fare module refuses to price with.
 */
export function createPricingVersion(
  prisma: PrismaClient,
  options: {
    code?: string;
    config?: unknown;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    active?: boolean;
  } = {},
) {
  const active = options.active ?? true;
  return prisma.pricingVersion.create({
    data: {
      code: options.code ?? uniqueVersionCode(),
      model: 'LEG_DISTANCE_V1',
      config: options.config ?? TEST_PRICING_CONFIG,
      effectiveFrom: options.effectiveFrom ?? new Date(Date.now() - 60_000),
      effectiveTo: options.effectiveTo ?? null,
      active,
      reason: 'Integration test pricing version',
      // The database requires a deactivated version to say when and why (CHECK).
      ...(active
        ? {}
        : {
            deactivatedAt: new Date(),
            deactivationReason: 'Created inactive by an integration test',
          }),
    },
  });
}

/** Closes or deactivates every pricing version in effect, so a test starts from a known state. */
export async function clearPricingVersions(prisma: PrismaClient): Promise<void> {
  const open = await prisma.pricingVersion.findMany({ where: { active: true } });
  for (const version of open) {
    await prisma.pricingVersion.update({
      where: { id: version.id },
      data: {
        active: false,
        deactivatedAt: new Date(),
        deactivationReason: 'Reset by an integration test',
      },
    });
  }
}

export interface TestQuote {
  readonly quoteId: string;
  /** Fare + tax of the whole quote. */
  readonly payablePaise: bigint;
  /** Fare + tax of each drop, in delivery order. */
  readonly dropPayablePaise: readonly bigint[];
  /** The quoted drops' ids, in delivery order. */
  readonly stopIds: readonly string[];
  readonly expiresAt: Date;
}

/**
 * Inserts a fare quote with its drops, bypassing pricing, so payment tests can register a
 * booking at an exact amount. Written in one transaction: the database checks at commit that
 * the drops are numbered 1..n and add up to the quote's totals.
 */
export async function createFareQuote(
  prisma: PrismaClient,
  options: {
    customerId: string;
    pricingVersionId: string;
    /** One fare per drop, in paise. The quote's fare is their sum. */
    dropPaise: readonly number[];
    /** Tax per drop, in paise. Defaults to none (pricing has no tax rule yet, L-2). */
    dropTaxPaise?: readonly number[];
    vehicleCategory?: string;
    weightGrams?: number;
    createdAt?: Date;
    expiresAt?: Date;
  },
): Promise<TestQuote> {
  const drops = options.dropPaise.map((paise, index) => {
    const fare = BigInt(paise);
    const tax = BigInt(options.dropTaxPaise?.[index] ?? 0);
    return { fare, tax, payable: fare + tax };
  });
  const sum = (pick: (drop: (typeof drops)[number]) => bigint) =>
    drops.reduce((total, drop) => total + pick(drop), 0n);
  const createdAt = options.createdAt ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(createdAt.getTime() + 600_000);
  const metersPerLeg = 1_000;

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.fareQuote.create({
      data: {
        customerId: options.customerId,
        pricingVersionId: options.pricingVersionId,
        vehicleCategory: options.vehicleCategory ?? 'MINI_TRUCK',
        weightGrams: options.weightGrams ?? 1_000,
        pickupLatitude: '26.238900',
        pickupLongitude: '73.024300',
        distanceMeters: metersPerLeg * drops.length,
        farePaise: sum((drop) => drop.fare),
        taxPaise: sum((drop) => drop.tax),
        payablePaise: sum((drop) => drop.payable),
        createdAt,
        expiresAt,
      },
    });
    await tx.fareQuoteStop.createMany({
      data: drops.map((drop, index) => ({
        quoteId: created.id,
        sequence: index + 1,
        latitude: (26.3 + index / 100).toFixed(6),
        longitude: '73.045800',
        distanceMeters: metersPerLeg,
        farePaise: drop.fare,
        taxPaise: drop.tax,
        payablePaise: drop.payable,
      })),
    });
    const stops = await tx.fareQuoteStop.findMany({
      where: { quoteId: created.id },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    return { id: created.id, stopIds: stops.map((stop) => stop.id) };
  });

  return {
    quoteId: quote.id,
    payablePaise: sum((drop) => drop.payable),
    dropPayablePaise: drops.map((drop) => drop.payable),
    stopIds: quote.stopIds,
    expiresAt,
  };
}

const fixtureVersions = new WeakMap<PrismaClient, Promise<PricingVersion>>();

/**
 * The pricing version fixture quotes point at: inactive, so it never prices a real quote and
 * never overlaps a version a test creates. One per client, created on first use.
 */
export function fixturePricingVersion(prisma: PrismaClient): Promise<PricingVersion> {
  let version = fixtureVersions.get(prisma);
  if (!version) {
    version = createPricingVersion(prisma, {
      code: `FIXTURE-${uniqueVersionCode()}`.slice(0, 40),
      active: false,
    });
    fixtureVersions.set(prisma, version);
  }
  return version;
}

/**
 * Inserts a booking exactly as it was registered before fare quotes existed (engine-sent fare,
 * the fee rule in effect pinned, no stops), marked LEGACY_BOOKING_LEVEL. Such rows can no longer
 * be created through the API or by the application role: the insert guard refuses them. This
 * fixture needs the table owner, which disables only that guard, inside its own transaction.
 * Used to prove historical bookings (including PREPAID_UPI) keep their behaviour.
 */
export async function createLegacyBooking(
  owner: PrismaClient,
  options: {
    customerId: string;
    paymentMethod: BookingPaymentMethod;
    farePaise: number;
    category: string | null;
    externalRef?: string;
  },
): Promise<Booking> {
  const fare = BigInt(options.farePaise);
  return owner.$transaction(async (tx) => {
    const confirmedAt = new Date();
    const rule = await resolveFeeRule(tx, options.category, confirmedAt);
    await tx.$executeRaw`ALTER TABLE bookings DISABLE TRIGGER trg_bookings_insert_guard`;
    const booking = await tx.booking.create({
      data: {
        externalRef: options.externalRef ?? `LEGACY-${randomUUID()}`,
        customerId: options.customerId,
        vehicleCategory: options.category,
        fareEstimateMinor: fare,
        finalFareMinor: fare,
        paymentMethod: options.paymentMethod,
        feeRuleId: rule.id,
        paymentModel: 'LEGACY_BOOKING_LEVEL',
        confirmedAt,
      },
    });
    // The insert queued the deferred snapshot check, and Postgres refuses ALTER TABLE while a
    // table has pending trigger events. Run the check now (it passes for LEGACY rows), then turn
    // the guard back on before anything else can use this transaction.
    await tx.$executeRaw`SET CONSTRAINTS trg_bookings_snapshot IMMEDIATE`;
    await tx.$executeRaw`ALTER TABLE bookings ENABLE TRIGGER trg_bookings_insert_guard`;
    return booking;
  });
}

/**
 * A drop paid the way per-drop collection (payment flow Phase 4) will record it: a completed QR
 * collection for that drop, then the drop's payment confirmed. Per-drop collection isn't built
 * yet, so the table owner writes the collection with only the collection insert guard off, in
 * one transaction; the stop guard (on) checks that the collection exists before it lets the drop
 * become PAYMENT_CONFIRMED. The API role can do neither. Test only. Returns the collection id.
 */
export async function confirmDropPaymentAsOwner(
  owner: PrismaClient,
  drop: {
    bookingId: string;
    tripId: string;
    stopId: string;
    driverId: string;
    amountPaise: bigint;
  },
): Promise<string> {
  const collectionId = randomUUID();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 14);
  await owner.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE payment_collections DISABLE TRIGGER trg_collections_insert_guard`;
    await tx.$executeRaw`
      INSERT INTO payment_collections (id, booking_id, booking_stop_id, trip_id, stage, method,
                                       amount_paise, collected_by_driver_id, status, provider,
                                       provider_product, provider_reference_id,
                                       provider_payment_id, idempotency_key, completed_at)
      VALUES (${collectionId}::uuid, ${drop.bookingId}::uuid, ${drop.stopId}::uuid,
              ${drop.tripId}::uuid, 'DELIVERY', 'ONLINE_QR', ${drop.amountPaise},
              ${drop.driverId}::uuid, 'COMPLETED', 'RAZORPAY', 'QR_CODE', ${`qr_${suffix}`},
              ${`pay_${suffix}`}, ${`fixture-drop-${collectionId}`}, now())`;
    await tx.$executeRaw`ALTER TABLE payment_collections ENABLE TRIGGER trg_collections_insert_guard`;
    await tx.$executeRaw`
      UPDATE booking_stops SET status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now()
       WHERE id = ${drop.stopId}::uuid`;
  });
  return collectionId;
}
