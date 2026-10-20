import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { numberToPaise, paiseToNumber } from '../common/money';
import { FeeRulesService } from './fee-rules.service';
import {
  CreateFeeRuleRequest,
  CreateFeeRuleResponse,
  DeactivateFeeRuleRequest,
  FeePreviewQuery,
  FeePreviewResponse,
  FeeRuleResponse,
  ListFeeRulesQuery,
} from './fees.dto';
import { toFeeRuleResponse } from './fees.mapper';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Platform fee configuration. Fees are never hard-coded: V1's 10% is a rule created here. */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/fee-rules', version: '1' })
export class AdminFeeRulesController {
  constructor(private readonly feeRules: FeeRulesService) {}

  @Get()
  async list(@Query() query: ListFeeRulesQuery): Promise<FeeRuleResponse[]> {
    const rules = await this.feeRules.list({ activeOnly: query.activeOnly ?? false });
    return rules.map(toFeeRuleResponse);
  }

  /** The fee a fare would be charged today, and the rule that decides it. */
  @Get('preview')
  async preview(@Query() query: FeePreviewQuery): Promise<FeePreviewResponse> {
    const preview = await this.feeRules.preview(
      query.category ?? null,
      numberToPaise(query.farePaise),
    );
    return {
      rule: toFeeRuleResponse(preview.rule),
      farePaise: paiseToNumber(preview.farePaise),
      feePaise: paiseToNumber(preview.feePaise),
      driverSharePaise: paiseToNumber(preview.driverSharePaise),
    };
  }

  @Get(':ruleId')
  async get(@Param('ruleId', uuid) ruleId: string): Promise<FeeRuleResponse> {
    return toFeeRuleResponse(await this.feeRules.get(ruleId));
  }

  /**
   * Creates a new rule version. The current open-ended rule for the same category is closed at
   * the new rule's start; bookings already confirmed keep the rule they were confirmed under.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateFeeRuleRequest,
  ): Promise<CreateFeeRuleResponse> {
    const result = await this.feeRules.create(principal, {
      category: body.category ?? null,
      ruleType: body.ruleType,
      value: body.value,
      roundingMode: body.roundingMode ?? null,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
      reason: body.reason,
    });
    return {
      rule: toFeeRuleResponse(result.rule),
      superseded: result.superseded ? toFeeRuleResponse(result.superseded) : null,
    };
  }

  @Post(':ruleId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('ruleId', uuid) ruleId: string,
    @Body() body: DeactivateFeeRuleRequest,
  ): Promise<FeeRuleResponse> {
    return toFeeRuleResponse(await this.feeRules.deactivate(principal, ruleId, body.reason));
  }
}
