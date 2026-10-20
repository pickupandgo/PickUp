import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { paiseToNumber } from '../common/money';
import { AdminEarningResponse } from '../earnings/earnings.dto';
import { toAdminEarningResponse } from '../earnings/earnings.mapper';
import type { PaymentSettlement } from '../generated/prisma/client';
import { MerchantSettlementsService } from './merchant-settlements.service';
import {
  ListSettlementsQuery,
  SettlementResponse,
  SettlementSyncRequest,
  SettlementSyncResponse,
} from './settlements.dto';

@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/settlements', version: '1' })
export class AdminSettlementsController {
  constructor(private readonly settlements: MerchantSettlementsService) {}

  /**
   * Pulls Razorpay's settlement data now (default: the configured look-back window) and makes
   * the earnings of settled payments payable. Safe to repeat.
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async sync(
    @CurrentPrincipal() principal: Principal,
    @Body() body: SettlementSyncRequest,
  ): Promise<SettlementSyncResponse> {
    const result = await this.settlements.syncForAdmin(principal.userId, body);
    return { ...result, days: [...result.days] };
  }

  @Get()
  async list(@Query() query: ListSettlementsQuery): Promise<SettlementResponse[]> {
    return (await this.settlements.list(query)).map(toSettlementResponse);
  }

  /** ONLINE earnings still waiting for their settlement after SETTLEMENT_OVERDUE_DAYS. */
  @Get('overdue-earnings')
  async overdue(): Promise<AdminEarningResponse[]> {
    return (await this.settlements.overdueEarnings()).map(toAdminEarningResponse);
  }
}

export function toSettlementResponse(settlement: PaymentSettlement): SettlementResponse {
  return {
    settlementId: settlement.id,
    provider: settlement.provider,
    providerPaymentId: settlement.providerPaymentId,
    providerSettlementId: settlement.providerSettlementId,
    settlementUtr: settlement.settlementUtr,
    settledAt: settlement.settledAt.toISOString(),
    amountPaise: paiseToNumber(settlement.amountPaise),
    feePaise: paiseToNumber(settlement.feePaise),
    taxPaise: paiseToNumber(settlement.taxPaise),
    bookingId: settlement.bookingId,
    paymentId: settlement.paymentId,
    collectionId: settlement.collectionId,
    source: settlement.source,
    recordedAt: settlement.createdAt.toISOString(),
  };
}
