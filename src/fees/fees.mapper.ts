import type { FeeRule } from '../generated/prisma/client';
import type { FeeRuleResponse } from './fees.dto';

export function toFeeRuleResponse(rule: FeeRule): FeeRuleResponse {
  return {
    id: rule.id,
    category: rule.category,
    ruleType: rule.ruleType,
    value: rule.value.toFixed(4),
    roundingMode: rule.roundingMode,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    active: rule.active,
    reason: rule.reason,
    createdByUserId: rule.createdByUserId,
    deactivatedAt: rule.deactivatedAt ? rule.deactivatedAt.toISOString() : null,
    deactivationReason: rule.deactivationReason,
    createdAt: rule.createdAt.toISOString(),
  };
}
