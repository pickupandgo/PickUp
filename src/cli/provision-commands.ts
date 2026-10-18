import { readFileSync } from 'node:fs';
import { recordAdminAction } from '../audit/admin-actions';
import { FinancialContext, financialContextStatement } from '../audit/financial-context';
import {
  createPricingVersionRecord,
  DEVELOPMENT_PRICING_CODE_PREFIX,
} from '../fare/pricing-versions';
import { createFeeRuleRecord } from '../fees/fee-rules';
import type { PrismaClient } from '../generated/prisma/client';
import type { DriverApprovalStatus, UserRole } from '../generated/prisma/enums';
import { type ProvisionCommand, ProvisionUsageError } from './provision-args';

export interface AccountResult {
  readonly userId: string;
  readonly role: UserRole;
  readonly driverId: string | null;
  readonly approvalStatus: DriverApprovalStatus | null;
  readonly customerId: string | null;
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
  // What the ops CLI writes is recorded in the financial event log as SYSTEM, origin
  // "cli <command>", with the CLI's database role (payment flow Phase 7).
  return FinancialContext.runIfAbsent({ actorType: 'SYSTEM', origin: `cli ${command.kind}` }, () =>
    dispatchProvisionCommand(prisma, provider, command),
  );
}

async function dispatchProvisionCommand(
  prisma: PrismaClient,
  provider: string,
  command: ProvisionCommand,
): Promise<ProvisionResult> {
  switch (command.kind) {
    case 'create-driver':
    case 'create-admin':
    case 'create-customer':
      return createAccount(prisma, provider, command);
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
    await financialContextStatement(tx);
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
 * Records the name on the driver's approved KYC documents. Bank-account approval compares it with
 * the name the bank reports, so a change is audited (it affects who can receive payouts).
 */
async function setLegalName(
  prisma: PrismaClient,
  phone: string,
  legalName: string,
): Promise<AccountResult> {
  return prisma.$transaction(async (tx) => {
    await financialContextStatement(tx);
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
    await financialContextStatement(tx);
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
    await financialContextStatement(tx);
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
