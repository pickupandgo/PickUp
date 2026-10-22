import { HttpStatus } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { MONEY_ROUNDING_MODE } from '../common/money';
import type { FeeRule, Prisma, PrismaClient } from '../generated/prisma/client';
import {
  assertValidFormula,
  computePlatformFee,
  FEE_RULE_TYPES,
  type FeeFormula,
  FeeFormulaError,
  type FeeRuleType,
  parseScaledValue,
  ROUNDING_MODES,
  type RoundingMode,
} from './fee-calculator';

export const FEE_CATEGORY_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;
/** Tolerated clock difference for "effective from now" requests. Rules are never back-dated. */
const MAX_BACKDATE_MS = 5 * 60_000;

export interface CreateFeeRuleInput {
  /** Vehicle category code, or null for the default rule that applies to every category. */
  readonly category: string | null;
  readonly ruleType: FeeRuleType;
  /** Decimal string: percent for PERCENTAGE, paise for FIXED. */
  readonly value: string;
  /** Optional; HALF_UP is the only accepted value (and the default). */
  readonly roundingMode?: string | null;
  /** Defaults to now. Never in the past, so a rule never changes an already-confirmed booking. */
  readonly effectiveFrom: Date | null;
  readonly reason: string;
  /** Acting admin, or null for the ops CLI. */
  readonly createdByUserId: string | null;
}

export interface CreateFeeRuleResult {
  readonly rule: FeeRule;
  /** The previous open-ended rule for the same category, closed at the new rule's start. */
  readonly superseded: FeeRule | null;
}

type FeeRuleReader = Pick<Prisma.TransactionClient, 'feeRule'>;

/**
 * Creates a new fee rule version (PW 1.6: rules are versioned, never overwritten). If the same
 * category has an open-ended rule that started earlier, it is closed at the new rule's start, in
 * the same transaction. Any other overlap is refused, so at most one rule per category is ever in
 * effect. Shared by the admin API and the ops CLI.
 */
export async function createFeeRuleRecord(
  prisma: PrismaClient,
  input: CreateFeeRuleInput,
  now: Date = new Date(),
): Promise<CreateFeeRuleResult> {
  const formula = validateInput(input);
  const effectiveFrom = input.effectiveFrom ?? now;
  if (effectiveFrom.getTime() < now.getTime() - MAX_BACKDATE_MS) {
    throw invalid('effectiveFrom cannot be in the past');
  }
  const reason = input.reason.trim();

  return prisma.$transaction(
    async (tx) => {
      // Serializes rule creation so two concurrent requests cannot both pass the overlap check.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('fee_rules'))`;

      const overlapping = await tx.feeRule.findMany({
        where: {
          active: true,
          category: input.category,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: 'asc' },
      });

      let superseded: FeeRule | null = null;
      const [only] = overlapping;
      if (
        overlapping.length === 1 &&
        only &&
        only.effectiveTo === null &&
        only.effectiveFrom < effectiveFrom
      ) {
        superseded = await tx.feeRule.update({
          where: { id: only.id },
          data: { effectiveTo: effectiveFrom },
        });
      } else if (overlapping.length > 0) {
        throw new AppError(
          ErrorCode.FEE_RULE_OVERLAP,
          HttpStatus.CONFLICT,
          'Another fee rule for this category is in effect during this period',
          { conflictingRuleIds: overlapping.map((rule) => rule.id) },
        );
      }

      const rule = await tx.feeRule.create({
        data: {
          category: input.category,
          ruleType: formula.ruleType,
          value: input.value.trim(),
          roundingMode: formula.roundingMode,
          effectiveFrom,
          reason,
          createdByUserId: input.createdByUserId,
        },
      });

      await recordAdminAction(tx, {
        actorUserId: input.createdByUserId,
        action: 'FEE_RULE_CREATED',
        targetType: 'FEE_RULE',
        targetId: rule.id,
        reason,
        details: {
          category: rule.category,
          ruleType: rule.ruleType,
          value: rule.value.toFixed(4),
          roundingMode: rule.roundingMode,
          effectiveFrom: rule.effectiveFrom.toISOString(),
          supersededRuleId: superseded?.id ?? null,
        },
      });
      if (superseded) {
        await recordAdminAction(tx, {
          actorUserId: input.createdByUserId,
          action: 'FEE_RULE_SUPERSEDED',
          targetType: 'FEE_RULE',
          targetId: superseded.id,
          reason,
          details: { supersededBy: rule.id, effectiveTo: effectiveFrom.toISOString() },
        });
      }
      return { rule, superseded };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * The fee rule in effect at `at` for a category. A rule for the exact category wins over the
 * default (category NULL) rule. No rule fails with FEE_RULE_NOT_CONFIGURED; nothing is ever
 * hard-coded.
 */
export async function resolveFeeRule(
  db: FeeRuleReader,
  category: string | null,
  at: Date,
): Promise<FeeRule> {
  const candidates = await db.feeRule.findMany({
    where: {
      active: true,
      effectiveFrom: { lte: at },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        { OR: [{ category: null }, ...(category ? [{ category }] : [])] },
      ],
    },
  });

  const specific = category ? candidates.filter((rule) => rule.category === category) : [];
  const chosen =
    specific.length > 0 ? specific : candidates.filter((rule) => rule.category === null);
  const [rule] = chosen;
  if (!rule) {
    throw new AppError(
      ErrorCode.FEE_RULE_NOT_CONFIGURED,
      HttpStatus.CONFLICT,
      'No platform fee rule is configured for this booking',
      { category },
    );
  }
  if (chosen.length > 1) {
    throw new AppError(
      ErrorCode.FEE_RULE_AMBIGUOUS,
      HttpStatus.CONFLICT,
      'More than one platform fee rule matches this booking',
      { ruleIds: chosen.map((candidate) => candidate.id) },
    );
  }
  return rule;
}

export function toFormula(rule: Pick<FeeRule, 'ruleType' | 'value' | 'roundingMode'>): FeeFormula {
  if (!isRuleType(rule.ruleType) || !isRoundingMode(rule.roundingMode)) {
    throw new AppError(ErrorCode.FEE_RULE_INVALID, HttpStatus.CONFLICT, 'Fee rule is invalid');
  }
  return {
    ruleType: rule.ruleType,
    scaledValue: parseScaledValue(rule.value.toFixed(4)),
    roundingMode: rule.roundingMode,
  };
}

/** Platform fee for a fare under a stored rule. */
export function feeForFare(
  rule: Pick<FeeRule, 'id' | 'ruleType' | 'value' | 'roundingMode'>,
  farePaise: bigint,
): bigint {
  try {
    return computePlatformFee(toFormula(rule), farePaise);
  } catch (error) {
    if (error instanceof FeeFormulaError) {
      throw new AppError(
        ErrorCode.FEE_RULE_INVALID,
        HttpStatus.CONFLICT,
        'The platform fee rule cannot be applied to this fare',
        { feeRuleId: rule.id, problem: error.message },
      );
    }
    throw error;
  }
}

function validateInput(input: CreateFeeRuleInput): FeeFormula {
  if (input.category !== null && !FEE_CATEGORY_PATTERN.test(input.category)) {
    throw invalid('category must be an upper-case code such as MINI_TRUCK');
  }
  if (!isRuleType(input.ruleType)) {
    throw invalid('ruleType is not supported');
  }
  const roundingMode = input.roundingMode ?? MONEY_ROUNDING_MODE;
  if (!isRoundingMode(roundingMode)) {
    throw invalid('roundingMode must be HALF_UP: fees are always rounded half up to the paisa');
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw invalid('reason must be 10-500 characters');
  }
  try {
    const formula: FeeFormula = {
      ruleType: input.ruleType,
      scaledValue: parseScaledValue(input.value),
      roundingMode,
    };
    assertValidFormula(formula);
    return formula;
  } catch (error) {
    if (error instanceof FeeFormulaError) {
      throw invalid(error.message);
    }
    throw error;
  }
}

function invalid(message: string): AppError {
  return new AppError(ErrorCode.FEE_RULE_INVALID, HttpStatus.BAD_REQUEST, message);
}

function isRuleType(value: string): value is FeeRuleType {
  return (FEE_RULE_TYPES as readonly string[]).includes(value);
}

function isRoundingMode(value: string): value is RoundingMode {
  return (ROUNDING_MODES as readonly string[]).includes(value);
}
