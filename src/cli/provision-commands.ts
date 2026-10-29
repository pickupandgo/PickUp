import { readFileSync } from 'node:fs';
import { recordAdminAction } from '../audit/admin-actions';
import {
  createPricingVersionRecord,
  DEVELOPMENT_PRICING_CODE_PREFIX,
} from '../fare/pricing-versions';
import { createFeeRuleRecord } from '../fees/fee-rules';
import type { PrismaClient } from '../generated/prisma/client';
import type { DriverApprovalStatus, UserRole, UserStatus } from '../generated/prisma/enums';
import { type ProvisionCommand, ProvisionUsageError } from './provision-args';

export interface AccountResult {
  readonly userId: string;
  readonly role: UserRole;
  readonly driverId: string | null;
  readonly approvalStatus: DriverApprovalStatus | null;
  readonly customerId: string | null;
  readonly accountStatus?: UserStatus;
}

export interface FeeRuleResult {
  readonly feeRuleId: string;
  readonly category: string | null;
  readonly ruleType: string;
  readonly value: string;
  readonly roundingMode: string;
  readonly effectiveFrom: string;
  readonly supersededRuleId: string | null;
}

export interface PricingVersionResult {
  readonly pricingVersionId: string;
  readonly code: string;
  readonly model: string;
  readonly effectiveFrom: string;
  readonly supersededVersionId: string | null;
  /** True for a PROTOTYPE* code: development rates that nobody has approved for production. */
  readonly developmentOnly: boolean;
}

export type ProvisionResult = AccountResult | FeeRuleResult | PricingVersionResult;

/**
 * Bootstrap tooling for test and ops accounts and the initial platform fee rule. In production,
 * drivers and customers are created by their onboarding flows (M2/M3); this tool exists so
 * payments can be tested before those flows exist. Every write happens in one transaction, and
 * existing accounts are never silently re-linked.
 */
export function runProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: Extract<ProvisionCommand, { kind: 'create-fee-rule' }>,
): Promise<FeeRuleResult>;
export function runProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: Extract<ProvisionCommand, { kind: 'create-pricing-version' }>,
): Promise<PricingVersionResult>;
export function runProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: Exclude<ProvisionCommand, { kind: 'create-fee-rule' | 'create-pricing-version' }>,
): Promise<AccountResult>;
export function runProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: ProvisionCommand,
): Promise<ProvisionResult>;
export async function runProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: ProvisionCommand,
): Promise<ProvisionResult> {
  const bypassesOnboarding =
    command.kind === 'approve-driver' ||
    command.kind === 'set-legal-name' ||
    (command.kind === 'create-driver' && (command.approve || command.legalName !== null));
  if (process.env.NODE_ENV === 'production' && bypassesOnboarding) {
    throw new ProvisionUsageError(
      'Production driver verification must use the audited onboarding admin API',
    );
  }
  switch (command.kind) {
    case 'create-driver':
    case 'create-admin':
    case 'create-customer':
      return createAccount(prisma, provider, command);
    case 'suspend-admin':
      return suspendAdmin(prisma, command.phone, command.reason);
    case 'create-contract-eligible-driver':
      assertContractFixtureEnvironment();
      return createContractEligibleDriver(prisma, provider, command);
    case 'approve-driver':
      return approveDriver(prisma, command.phone);
    case 'set-legal-name':
      return setLegalName(prisma, command.phone, command.legalName);
    case 'link-identity':
      return linkIdentity(prisma, provider, command);
    case 'create-fee-rule': {
      const { rule, superseded } = await createFeeRuleRecord(prisma, {
        category: command.category,
        ruleType: command.ruleType,
        value: command.value,
        roundingMode: command.roundingMode,
        effectiveFrom: null,
        reason: command.reason,
        createdByUserId: null,
      });
      return {
        feeRuleId: rule.id,
        category: rule.category,
        ruleType: rule.ruleType,
        value: rule.value.toFixed(4),
        roundingMode: rule.roundingMode,
        effectiveFrom: rule.effectiveFrom.toISOString(),
        supersededRuleId: superseded?.id ?? null,
      };
    }
    case 'create-pricing-version':
      return createPricingVersion(prisma, command);
  }
}

/**
 * Contract fixtures model historical, already-audited evidence without calling object storage.
 * They are deliberately unavailable outside a test process connected to a disposable *_e2e DB;
 * production and ordinary development provisioning must use the onboarding/admin workflow.
 */
function assertContractFixtureEnvironment(): void {
  const databaseUrl = process.env.DATABASE_URL;
  let databaseName = '';
  try {
    databaseName = new URL(databaseUrl ?? '').pathname.replace(/^\//, '');
  } catch {
    // Kept empty so the generic refusal below does not disclose connection details.
  }
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.CONTRACT_E2E_FIXTURE !== 'true' ||
    !/^[a-z0-9_]+_e2e$/.test(databaseName)
  ) {
    throw new ProvisionUsageError(
      'create-contract-eligible-driver is restricted to an explicitly enabled isolated test database',
    );
  }
}

function requiredFixtureValues(name: string): string[] {
  const values = (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new ProvisionUsageError(
      `${name} must define a non-empty unique document/checklist policy`,
    );
  }
  return values;
}

/** Creates a complete, immutable-looking historical compliance fixture for the real-service E2E. */
async function createContractEligibleDriver(
  prisma: PrismaClient,
  provider: string,
  command: Extract<ProvisionCommand, { kind: 'create-contract-eligible-driver' }>,
): Promise<AccountResult> {
  const policyVersion = process.env.MANUAL_KYC_POLICY_VERSION?.trim();
  const kycDocumentTypes = requiredFixtureValues('MANUAL_KYC_REQUIRED_DOCUMENTS');
  const checklist = requiredFixtureValues('MANUAL_KYC_CHECKLIST');
  const vehicleDocumentTypes = requiredFixtureValues('VEHICLE_REQUIRED_DOCUMENTS');
  if (!policyVersion) {
    throw new ProvisionUsageError('MANUAL_KYC_POLICY_VERSION is required for contract fixtures');
  }

  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { phone: command.phone }, select: { id: true } })) {
      throw new ProvisionUsageError('A user with this phone number already exists');
    }
    const identityTaken = await tx.authIdentity.findUnique({
      where: { provider_subject: { provider, subject: command.subject } },
      select: { id: true },
    });
    if (identityTaken) {
      throw new ProvisionUsageError('This subject is already linked to another user');
    }

    // Deliberately ordered so the final approval is after the verified KYC and vehicle evidence.
    const base = Date.now() - 10_000;
    const uploadedAt = new Date(base);
    const verifiedAt = new Date(base + 1_000);
    const vehicleVerifiedAt = new Date(base + 2_000);
    const approvedAt = new Date(base + 3_000);
    const user = await tx.user.create({ data: { phone: command.phone, role: 'DRIVER' } });
    await tx.authIdentity.create({ data: { userId: user.id, provider, subject: command.subject } });
    const driver = await tx.driver.create({
      data: {
        userId: user.id,
        profileName: command.legalName,
        profileVersion: 1, // Historical compliance fixture, gated to disposable *_e2e DBs above.
        legalName: command.legalName,
        approvalStatus: 'APPROVED',
        approvedAt,
      },
    });
    await tx.driverWallet.create({ data: { driverId: driver.id } });
    const application = await tx.kycApplication.create({
      data: {
        driverId: driver.id,
        provider: 'MANUAL_ADMIN_VERIFICATION',
        status: 'VERIFIED',
        policyVersion,
        verificationChecklist: Object.fromEntries(checklist.map((item) => [item, true])),
        verifiedAt,
        reviewedAt: verifiedAt,
        createdAt: uploadedAt,
      },
    });
    for (const documentType of kycDocumentTypes) {
      await tx.kycDocument.create({
        data: {
          applicationId: application.id,
          documentType,
          storageKey: `contract-fixtures/${command.subject}/kyc/${documentType}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 1_024,
          checksumSha256: '0'.repeat(64),
          status: 'VERIFIED',
          uploadedAt,
          scannedAt: verifiedAt,
          reviewedAt: verifiedAt,
          createdAt: uploadedAt,
        },
      });
    }
    await tx.kycEvent.create({
      data: {
        applicationId: application.id,
        providerEventId: `contract-fixture-kyc-${command.subject}`,
        eventType: 'MANUAL_KYC_VERIFIED',
        occurredAt: verifiedAt,
        payload: { fixture: true, policyVersion },
        createdAt: verifiedAt,
      },
    });
    const vehicle = await tx.vehicle.create({
      data: {
        driverId: driver.id,
        category: 'MINI_TRUCK',
        registrationNumber: `CT${command.subject.slice(-16).toUpperCase()}`,
        makeModel: 'Contract Fixture Vehicle',
        status: 'VERIFIED',
        active: true,
        verifiedAt: vehicleVerifiedAt,
        reviewedAt: vehicleVerifiedAt,
        createdAt: uploadedAt,
      },
    });
    for (const documentType of vehicleDocumentTypes) {
      await tx.vehicleDocument.create({
        data: {
          vehicleId: vehicle.id,
          documentType,
          storageKey: `contract-fixtures/${command.subject}/vehicle/${documentType}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 1_024,
          checksumSha256: '1'.repeat(64),
          status: 'VERIFIED',
          uploadedAt,
          scannedAt: vehicleVerifiedAt,
          reviewedAt: vehicleVerifiedAt,
          createdAt: uploadedAt,
        },
      });
    }
    await recordAdminAction(tx, {
      actorUserId: null,
      action: 'CONTRACT_FIXTURE_KYC_VERIFIED',
      targetType: 'KYC_APPLICATION',
      targetId: application.id,
      reason: 'Isolated contract test fixture: audited manual KYC history',
      details: { policyVersion },
    });
    await recordAdminAction(tx, {
      actorUserId: null,
      action: 'CONTRACT_FIXTURE_VEHICLE_VERIFIED',
      targetType: 'VEHICLE',
      targetId: vehicle.id,
      reason: 'Isolated contract test fixture: verified vehicle evidence history',
    });
    await recordAdminAction(tx, {
      actorUserId: null,
      action: 'CONTRACT_FIXTURE_DRIVER_APPROVED',
      targetType: 'DRIVER',
      targetId: driver.id,
      reason: 'Isolated contract test fixture: final approval after compliance checks',
    });
    return {
      userId: user.id,
      role: user.role,
      driverId: driver.id,
      approvalStatus: driver.approvalStatus,
      customerId: null,
    };
  });
}

/**
 * Creates a pricing version from a JSON config file. The rates never come from the command line,
 * so what was applied is exactly what the reviewed file contains. The config is validated against
 * its model before anything is written, and the version in effect is closed at the new start.
 */
async function createPricingVersion(
  prisma: PrismaClient,
  command: Extract<ProvisionCommand, { kind: 'create-pricing-version' }>,
): Promise<PricingVersionResult> {
  const production = process.env.NODE_ENV === 'production';
  const developmentOnly = command.code.startsWith(DEVELOPMENT_PRICING_CODE_PREFIX);
  if (developmentOnly && production) {
    throw new ProvisionUsageError(
      `A ${DEVELOPMENT_PRICING_CODE_PREFIX}* pricing version is development only and cannot be created in production`,
    );
  }

  let config: unknown;
  try {
    config = JSON.parse(readFileSync(command.configPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new ProvisionUsageError(`--file could not be read as JSON: ${detail}`);
  }

  const { version, superseded } = await createPricingVersionRecord(prisma, {
    code: command.code,
    model: command.model,
    config,
    effectiveFrom: null,
    reason: command.reason,
    createdByUserId: null,
    production,
  });
  return {
    pricingVersionId: version.id,
    code: version.code,
    model: version.model,
    effectiveFrom: version.effectiveFrom.toISOString(),
    supersededVersionId: superseded?.id ?? null,
    developmentOnly,
  };
}

const ROLES: Record<'create-driver' | 'create-admin' | 'create-customer', UserRole> = {
  'create-driver': 'DRIVER',
  'create-admin': 'ADMIN',
  'create-customer': 'CUSTOMER',
};

async function createAccount(
  prisma: PrismaClient,
  provider: string,
  command: Extract<
    ProvisionCommand,
    { kind: 'create-driver' | 'create-admin' | 'create-customer' }
  >,
): Promise<AccountResult> {
  const role = ROLES[command.kind];
  const approve = command.kind === 'create-driver' && command.approve;

  return prisma.$transaction(async (tx) => {
    const userWithPhone = await tx.user.findUnique({
      where: { phone: command.phone },
      include: { driver: true, customer: true },
    });
    const identity = await tx.authIdentity.findUnique({
      where: { provider_subject: { provider, subject: command.subject } },
      select: { userId: true },
    });
    if (command.kind === 'create-admin' && userWithPhone && identity?.userId === userWithPhone.id) {
      if (userWithPhone.role !== 'ADMIN') {
        throw new ProvisionUsageError(
          'The selected identity is already linked to a non-admin account',
        );
      }
      if (userWithPhone.status !== 'ACTIVE') {
        throw new ProvisionUsageError('The selected admin account is suspended or deleted');
      }
      return {
        userId: userWithPhone.id,
        role: userWithPhone.role,
        driverId: null,
        approvalStatus: null,
        customerId: null,
        accountStatus: userWithPhone.status,
      };
    }
    if (userWithPhone) {
      throw new ProvisionUsageError('A user with this phone number already exists');
    }
    if (identity) {
      throw new ProvisionUsageError('This subject is already linked to another user');
    }

    const user = await tx.user.create({ data: { phone: command.phone, role } });
    await tx.authIdentity.create({
      data: { userId: user.id, provider, subject: command.subject },
    });

    if (role === 'CUSTOMER') {
      const customer = await tx.customer.create({ data: { userId: user.id } });
      return {
        userId: user.id,
        role,
        driverId: null,
        approvalStatus: null,
        customerId: customer.id,
      };
    }
    if (command.kind === 'create-admin') {
      await recordAdminAction(tx, {
        actorUserId: null,
        action: 'ADMIN_PROVISIONED',
        targetType: 'USER',
        targetId: user.id,
        reason: command.reason,
        details: { provider },
      });
      return {
        userId: user.id,
        role: user.role,
        driverId: null,
        approvalStatus: null,
        customerId: null,
        accountStatus: user.status,
      };
    }
    if (role !== 'DRIVER') {
      return { userId: user.id, role, driverId: null, approvalStatus: null, customerId: null };
    }
    const driver = await tx.driver.create({
      data: {
        userId: user.id,
        approvalStatus: approve ? 'APPROVED' : 'PENDING',
        approvedAt: approve ? new Date() : null,
        legalName: command.kind === 'create-driver' ? command.legalName : null,
      },
    });
    return {
      userId: user.id,
      role,
      driverId: driver.id,
      approvalStatus: driver.approvalStatus,
      customerId: null,
    };
  });
}

/**
 * Revokes an administrator's backend access without deleting financial or audit evidence. The
 * global PrincipalService checks User.status on every authenticated request, so suspension takes
 * effect on the next request even if Firebase still has a valid ID token.
 */
async function suspendAdmin(
  prisma: PrismaClient,
  phone: string,
  reason: string,
): Promise<AccountResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { phone },
      include: { driver: true, customer: true },
    });
    if (!user || user.role !== 'ADMIN') {
      throw new ProvisionUsageError('No administrator exists with this phone number');
    }
    if (user.status === 'DELETED') {
      throw new ProvisionUsageError('A deleted administrator cannot be suspended');
    }
    if (user.status === 'SUSPENDED') {
      return {
        userId: user.id,
        role: user.role,
        driverId: null,
        approvalStatus: null,
        customerId: null,
        accountStatus: user.status,
      };
    }
    const suspended = await tx.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED' },
    });
    await recordAdminAction(tx, {
      actorUserId: null,
      action: 'ADMIN_SUSPENDED',
      targetType: 'USER',
      targetId: user.id,
      reason,
      details: { via: 'ops_cli' },
    });
    return {
      userId: suspended.id,
      role: suspended.role,
      driverId: null,
      approvalStatus: null,
      customerId: null,
      accountStatus: suspended.status,
    };
  });
}

/**
 * Records the name on the driver's approved KYC documents. Bank-account approval compares it with
 * the name the bank reports, so a change is audited (it affects who can receive payouts).
 */
async function setLegalName(
  prisma: PrismaClient,
  phone: string,
  legalName: string,
): Promise<AccountResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { phone }, include: { driver: true } });
    if (!user?.driver) {
      throw new ProvisionUsageError('No driver exists with this phone number');
    }
    const driver = await tx.driver.update({
      where: { id: user.driver.id },
      data: { legalName },
    });
    await recordAdminAction(tx, {
      actorUserId: null,
      action: 'DRIVER_LEGAL_NAME_SET',
      targetType: 'DRIVER',
      targetId: driver.id,
      reason: 'Set by the ops CLI from the approved KYC documents',
      details: { previousLegalName: user.driver.legalName, legalName },
    });
    return {
      userId: user.id,
      role: user.role,
      driverId: driver.id,
      approvalStatus: driver.approvalStatus,
      customerId: null,
    };
  });
}

/**
 * Adds a sign-in to the account with this phone, e.g. when the apps move to another Firebase
 * project and the same person gets a new UID. It only ever adds: a subject already linked to a
 * different account is refused, and repeating the command changes nothing. Audited.
 */
async function linkIdentity(
  prisma: PrismaClient,
  provider: string,
  command: Extract<ProvisionCommand, { kind: 'link-identity' }>,
): Promise<AccountResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { phone: command.phone },
      include: { driver: true, customer: true, authIdentities: { select: { id: true } } },
    });
    if (!user) {
      throw new ProvisionUsageError('No user exists with this phone number');
    }
    const linked = await tx.authIdentity.findUnique({
      where: { provider_subject: { provider, subject: command.subject } },
      select: { userId: true },
    });
    if (linked && linked.userId !== user.id) {
      throw new ProvisionUsageError('This subject is already linked to another user');
    }
    if (!linked) {
      await tx.authIdentity.create({
        data: { userId: user.id, provider, subject: command.subject },
      });
      await recordAdminAction(tx, {
        actorUserId: null,
        action: 'AUTH_IDENTITY_LINKED',
        targetType: 'USER',
        targetId: user.id,
        reason: command.reason,
        details: {
          provider,
          subject: command.subject,
          identitiesBefore: user.authIdentities.length,
        },
      });
    }
    return {
      userId: user.id,
      role: user.role,
      driverId: user.driver?.id ?? null,
      approvalStatus: user.driver?.approvalStatus ?? null,
      customerId: user.customer?.id ?? null,
    };
  });
}

async function approveDriver(prisma: PrismaClient, phone: string): Promise<AccountResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { phone }, include: { driver: true } });
    if (!user?.driver) {
      throw new ProvisionUsageError('No driver exists with this phone number');
    }
    const driver = await tx.driver.update({
      where: { id: user.driver.id },
      data: {
        approvalStatus: 'APPROVED',
        approvedAt: user.driver.approvedAt ?? new Date(),
      },
    });
    return {
      userId: user.id,
      role: user.role,
      driverId: driver.id,
      approvalStatus: driver.approvalStatus,
      customerId: null,
    };
  });
}
