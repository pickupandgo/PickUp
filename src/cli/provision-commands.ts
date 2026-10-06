import { recordAdminAction } from '../audit/admin-actions';
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

export type ProvisionResult = AccountResult | FeeRuleResult;

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
  command: Exclude<ProvisionCommand, { kind: 'create-fee-rule' }>,
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
  switch (command.kind) {
    case 'create-driver':
    case 'create-admin':
    case 'create-customer':
      return createAccount(prisma, provider, command);
    case 'approve-driver':
      return approveDriver(prisma, command.phone);
    case 'set-legal-name':
      return setLegalName(prisma, command.phone, command.legalName);
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
  }
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
