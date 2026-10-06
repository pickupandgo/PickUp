import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { FEE_RULE_TYPES, FEE_VALUE_PATTERN, ROUNDING_MODES } from './fee-calculator';
import type { FeeRuleType, RoundingMode } from './fee-calculator';
import { FEE_CATEGORY_PATTERN } from './fee-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFeeRuleRequest {
  /** Vehicle category code (e.g. MINI_TRUCK). Omit for the default rule for every category. */
  @IsOptional()
  @Matches(FEE_CATEGORY_PATTERN, { message: 'category must be an upper-case code' })
  category?: string;

  @IsIn(FEE_RULE_TYPES)
  ruleType!: FeeRuleType;

  /** Decimal string. PERCENTAGE: percent of the fare ("10" = 10%). FIXED: paise. */
  @IsString()
  @Matches(FEE_VALUE_PATTERN, { message: 'value must be a decimal with at most 4 decimals' })
  value!: string;

  /**
   * Optional. Fees are always rounded HALF_UP to the nearest paisa (OPEN_DECISIONS D-44); any other
   * value is refused.
   */
  @IsOptional()
  @IsIn(ROUNDING_MODES, { message: 'roundingMode must be HALF_UP' })
  roundingMode?: RoundingMode;

  /** ISO 8601 start; defaults to now. Rules can't be back-dated. */
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  /** Approval reference and why the rule exists. Stored with the rule and the audit trail. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class DeactivateFeeRuleRequest {
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ListFeeRulesQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  activeOnly?: boolean;
}

export class FeePreviewQuery {
  @IsOptional()
  @Matches(FEE_CATEGORY_PATTERN, { message: 'category must be an upper-case code' })
  category?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  farePaise!: number;
}

export class FeeRuleResponse {
  id!: string;
  category!: string | null;
  ruleType!: string;
  /** Decimal string with 4 decimals, e.g. "10.0000". */
  value!: string;
  roundingMode!: string;
  effectiveFrom!: string;
  effectiveTo!: string | null;
  active!: boolean;
  reason!: string;
  createdByUserId!: string | null;
  deactivatedAt!: string | null;
  deactivationReason!: string | null;
  createdAt!: string;
}

export class CreateFeeRuleResponse {
  rule!: FeeRuleResponse;
  /** The previous rule for the category, now closed at this rule's start. */
  superseded!: FeeRuleResponse | null;
}

export class FeePreviewResponse {
  rule!: FeeRuleResponse;
  farePaise!: number;
  feePaise!: number;
  driverSharePaise!: number;
}
