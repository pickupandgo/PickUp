import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { recordAdminAction } from '../audit/admin-actions';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { FeeRule } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { FeeRuleType } from './fee-calculator';
import {
  createFeeRuleRecord,
  type CreateFeeRuleResult,
  feeForFare,
  resolveFeeRule,
} from './fee-rules';

export interface NewFeeRule {
  readonly category: string | null;
  readonly ruleType: FeeRuleType;
  readonly value: string;
  /** Optional; only HALF_UP is accepted. */
  readonly roundingMode?: string | null;
  readonly effectiveFrom: Date | null;
  readonly reason: string;
}

export interface FeePreview {
  readonly rule: FeeRule;
  readonly farePaise: bigint;
  readonly feePaise: bigint;
  readonly driverSharePaise: bigint;
}

/**
 * Platform fee rules (PW 1.6). The backend is the only place fees are calculated; apps never
 * send or decide a fee. Rules are versioned and selected by the booking's confirmation time.
 */
@Injectable()
export class FeeRulesService {
  private readonly logger = new Logger(FeeRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(admin: Principal, input: NewFeeRule): Promise<CreateFeeRuleResult> {
    const result = await createFeeRuleRecord(this.prisma, {
      ...input,
      createdByUserId: admin.userId,
    });
    this.logger.log(
      {
        feeRuleId: result.rule.id,
        supersededRuleId: result.superseded?.id ?? null,
        adminUserId: admin.userId,
      },
      'Fee rule created',
    );
    return result;
  }

  /** Kill switch for a rule created by mistake. Idempotent; a deactivated rule stays deactivated. */
  async deactivate(admin: Principal, ruleId: string, reason: string): Promise<FeeRule> {
    return this.prisma.runInTransaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; active: boolean }[]>`
        SELECT id, active FROM fee_rules WHERE id = ${ruleId}::uuid FOR UPDATE`;
      if (!locked) {
        throw new AppError(
          ErrorCode.FEE_RULE_NOT_FOUND,
          HttpStatus.NOT_FOUND,
          'Fee rule not found',
        );
      }
      if (!locked.active) {
        return tx.feeRule.findUniqueOrThrow({ where: { id: ruleId } });
      }
      const rule = await tx.feeRule.update({
        where: { id: ruleId },
        data: {
          active: false,
          deactivatedAt: new Date(),
          deactivatedByUserId: admin.userId,
          deactivationReason: reason,
        },
      });
      await recordAdminAction(tx, {
        actorUserId: admin.userId,
        action: 'FEE_RULE_DEACTIVATED',
        targetType: 'FEE_RULE',
        targetId: ruleId,
        reason,
      });
      return rule;
    });
  }

  list(options: { activeOnly: boolean }): Promise<FeeRule[]> {
    return this.prisma.feeRule.findMany({
      where: options.activeOnly ? { active: true } : {},
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async get(ruleId: string): Promise<FeeRule> {
    const rule = await this.prisma.feeRule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new AppError(ErrorCode.FEE_RULE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Fee rule not found');
    }
    return rule;
  }

  /** The rule a booking confirmed at `at` uses. Runs inside the caller's transaction. */
  resolve(tx: Tx, category: string | null, at: Date): Promise<FeeRule> {
    return resolveFeeRule(tx, category, at);
  }

  /** Fee for a fare under a stored rule, in paise. */
  feeFor(rule: FeeRule, farePaise: bigint): bigint {
    return feeForFare(rule, farePaise);
  }

  /** What a fare would be charged today: for admins checking a rule before go-live. */
  async preview(category: string | null, farePaise: bigint): Promise<FeePreview> {
    const rule = await resolveFeeRule(this.prisma, category, new Date());
    const feePaise = feeForFare(rule, farePaise);
    return { rule, farePaise, feePaise, driverSharePaise: farePaise - feePaise };
  }
}
