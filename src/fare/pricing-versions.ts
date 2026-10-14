import { HttpStatus } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Prisma, PricingVersion, PrismaClient } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { parsePricingConfig, type PricingConfig } from './pricing/pricing-config';

export const PRICING_VERSION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{1,39}$/;
/** Clock skew tolerance for "now"; versions can't otherwise be back-dated. */
const MAX_BACKDATE_MS = 5 * 60_000;

export interface CreatePricingVersionInput {
  readonly code: string;
  readonly model: string;
  readonly config: unknown;
  readonly effectiveFrom: Date | null;
  readonly reason: string;
  readonly createdByUserId: string | null;
}

export interface CreatePricingVersionResult {
  readonly version: PricingVersion;
  readonly superseded: PricingVersion | null;
}

type VersionReader = Pick<Prisma.TransactionClient, 'pricingVersion'>;

/**
 * Creates a pricing version (admin API and ops CLI). The open-ended version in effect is closed
 * at the new version's start; quotes already given keep the version that priced them. Validated
 * against its model before anything is written, serialized with an advisory lock, audited.
 */
export async function createPricingVersionRecord(
  prisma: PrismaClient,
  input: CreatePricingVersionInput,
  now: Date = new Date(),
): Promise<CreatePricingVersionResult> {
  const code = input.code.trim();
  if (!PRICING_VERSION_CODE_PATTERN.test(code)) {
    throw invalid('code must be 2-40 upper-case letters, digits, ".", "_" or "-"');
  }
  const pricing = parsePricingConfig(input.model, input.config);
  const effectiveFrom = input.effectiveFrom ?? now;
  if (effectiveFrom.getTime() < now.getTime() - MAX_BACKDATE_MS) {
    throw invalid('effectiveFrom cannot be in the past');
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw invalid('reason must be 10-500 characters');
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pricing_versions'))`;
        const overlapping = await tx.pricingVersion.findMany({
          where: {
            active: true,
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          orderBy: { effectiveFrom: 'asc' },
        });
        let superseded: PricingVersion | null = null;
        const [only] = overlapping;
        if (
          overlapping.length === 1 &&
          only &&
          only.effectiveTo === null &&
          only.effectiveFrom < effectiveFrom
        ) {
          superseded = await tx.pricingVersion.update({
            where: { id: only.id },
            data: { effectiveTo: effectiveFrom },
          });
        } else if (overlapping.length > 0) {
          throw new AppError(
            ErrorCode.PRICING_VERSION_OVERLAP,
            HttpStatus.CONFLICT,
            'Another pricing version is in effect during this period',
            { conflictingVersionIds: overlapping.map((version) => version.id) },
          );
        }
        const version = await tx.pricingVersion.create({
          data: {
            code,
            model: pricing.model,
            // Plain JSON by construction: parsePricingConfig accepts only numbers, strings,
            // nulls, arrays and objects.
            config: pricing.config as Prisma.InputJsonValue,
            effectiveFrom,
            reason,
            createdByUserId: input.createdByUserId,
          },
        });
        await recordAdminAction(tx, {
          actorUserId: input.createdByUserId,
          action: 'PRICING_VERSION_CREATED',
          targetType: 'PRICING_VERSION',
          targetId: version.id,
          reason,
          details: {
            code,
            model: pricing.model,
            effectiveFrom: effectiveFrom.toISOString(),
            supersededVersionId: superseded?.id ?? null,
          },
        });
        if (superseded) {
          await recordAdminAction(tx, {
            actorUserId: input.createdByUserId,
            action: 'PRICING_VERSION_SUPERSEDED',
            targetType: 'PRICING_VERSION',
            targetId: superseded.id,
            reason,
            details: { supersededBy: version.id, effectiveTo: effectiveFrom.toISOString() },
          });
        }
        return { version, superseded };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 15_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        ErrorCode.PRICING_VERSION_INVALID,
        HttpStatus.CONFLICT,
        'A pricing version with this code already exists',
      );
    }
    throw error;
  }
}

/** The version in effect at `at`, with its validated config, or null when none is. */
export async function findPricingVersionInEffect(
  db: VersionReader,
  at: Date,
): Promise<{ version: PricingVersion; pricing: PricingConfig } | null> {
  const versions = await db.pricingVersion.findMany({
    where: {
      active: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    take: 2,
  });
  const [version] = versions;
  if (!version) {
    return null;
  }
  if (versions.length > 1) {
    // Creation refuses overlaps; two versions in effect means the data was edited by hand.
    throw new Error('More than one pricing version is in effect');
  }
  return { version, pricing: parsePricingConfig(version.model, version.config) };
}

function invalid(message: string): AppError {
  return new AppError(ErrorCode.PRICING_VERSION_INVALID, HttpStatus.BAD_REQUEST, message);
}
