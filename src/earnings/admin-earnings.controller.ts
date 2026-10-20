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
import {
  AdminEarningPageResponse,
  AdminEarningResponse,
  AdminListEarningsQuery,
  EarningDecisionRequest,
  EarningSummaryResponse,
} from './earnings.dto';
import { toAdminEarningResponse, toEarningSummaryResponse } from './earnings.mapper';
import { EarningsService } from './earnings.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin', version: '1' })
export class AdminEarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('earnings')
  async list(@Query() query: AdminListEarningsQuery): Promise<AdminEarningPageResponse> {
    const page = await this.earnings.listAll(query);
    return { items: page.items.map(toAdminEarningResponse), nextCursor: page.nextCursor };
  }

  @Get('earnings/:earningId')
  async get(@Param('earningId', uuid) earningId: string): Promise<AdminEarningResponse> {
    return toAdminEarningResponse(await this.earnings.get(earningId));
  }

  @Get('drivers/:driverId/earnings/summary')
  async summary(@Param('driverId', uuid) driverId: string): Promise<EarningSummaryResponse> {
    return toEarningSummaryResponse(await this.earnings.summaryForDriver(driverId));
  }

  /** Keeps a payable earning out of payouts (dispute, investigation). Reason required. */
  @Post('earnings/:earningId/hold')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async hold(
    @CurrentPrincipal() principal: Principal,
    @Param('earningId', uuid) earningId: string,
    @Body() body: EarningDecisionRequest,
  ): Promise<AdminEarningResponse> {
    return toAdminEarningResponse(await this.earnings.hold(principal, earningId, body.reason));
  }

  /** Returns a held earning to PAYABLE for the next weekly payout. Reason required. */
  @Post('earnings/:earningId/release')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async release(
    @CurrentPrincipal() principal: Principal,
    @Param('earningId', uuid) earningId: string,
    @Body() body: EarningDecisionRequest,
  ): Promise<AdminEarningResponse> {
    return toAdminEarningResponse(await this.earnings.release(principal, earningId, body.reason));
  }
}
