import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import {
  EarningPageResponse,
  EarningResponse,
  EarningSummaryResponse,
  ListEarningsQuery,
} from './earnings.dto';
import { toEarningResponse, toEarningSummaryResponse } from './earnings.mapper';
import { EarningsService } from './earnings.service';

/** The signed-in driver's per-trip earnings. Read-only: there is no withdrawal endpoint. */
@ApiTags('earnings')
@DriverOnly()
@Controller({ path: 'earnings', version: '1' })
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListEarningsQuery,
  ): Promise<EarningPageResponse> {
    const page = await this.earnings.listForDriver(requireDriver(principal).id, query);
    return { items: page.items.map(toEarningResponse), nextCursor: page.nextCursor };
  }

  /** Totals: payable (next weekly payout), in payout, on hold, paid, and kept as cash. */
  @Get('summary')
  async summary(@CurrentPrincipal() principal: Principal): Promise<EarningSummaryResponse> {
    return toEarningSummaryResponse(
      await this.earnings.summaryForDriver(requireDriver(principal).id),
    );
  }

  @Get(':earningId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('earningId', new ParseUUIDPipe({ version: '4' })) earningId: string,
  ): Promise<EarningResponse> {
    return toEarningResponse(
      await this.earnings.getForDriver(requireDriver(principal).id, earningId),
    );
  }
}
