import { randomInt, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
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
    token: deps.tokens.sign(subject),
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
 * states (the database refuses anything else): PENDING_VERIFICATION, a completed ACTIVE bank
 * validation with a MATCH, then VERIFIED.
 */
export async function createVerifiedBankAccount(
  prisma: PrismaClient,
  driverId: string,
  adminUserId: string,
) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 14);
  const account = await prisma.driverBankAccount.create({
    data: {
      driverId,
      accountHolderName: FIXTURE_DRIVER_NAME,
      ifsc: 'HDFC0001234',
      accountNumberLast4: '4321',
      provider: 'RAZORPAYX',
      providerContactId: `cont_${suffix}`,
      providerFundAccountId: `fa_${suffix}`,
    },
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
