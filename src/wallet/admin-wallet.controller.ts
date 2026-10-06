import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import {
  AdjustmentResponse,
  AdminWalletResponse,
  AdminWalletTransactionPageResponse,
  CreateAdjustmentRequest,
  ListTransactionsQuery,
} from './wallet.dto';
import { toAdminWalletResponse, toAdminWalletTransactionResponse } from './wallet.mapper';
import { WalletAdjustmentService } from './wallet-adjustment.service';
import { WalletService } from './wallet.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin', version: '1' })
export class AdminWalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly adjustments: WalletAdjustmentService,
  ) {}

  @Get('wallets/:walletId')
  async getWallet(@Param('walletId', uuid) walletId: string): Promise<AdminWalletResponse> {
    return toAdminWalletResponse(await this.wallets.getWallet(walletId));
  }

  @Get('drivers/:driverId/wallet')
  async getWalletByDriver(@Param('driverId', uuid) driverId: string): Promise<AdminWalletResponse> {
    return toAdminWalletResponse(await this.wallets.findWalletByDriver(driverId));
  }

  @Get('wallets/:walletId/transactions')
  async listTransactions(
    @Param('walletId', uuid) walletId: string,
    @Query() query: ListTransactionsQuery,
  ): Promise<AdminWalletTransactionPageResponse> {
    await this.wallets.getWallet(walletId);
    const page = await this.wallets.listTransactions(walletId, query);
    return {
      items: page.items.map(toAdminWalletTransactionResponse),
      nextCursor: page.nextCursor,
    };
  }

  /** Manual credit or debit with a mandatory reason. Retries with the same key are no-ops. */
  @Post('wallets/:walletId/adjustments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })
  async adjust(
    @CurrentPrincipal() principal: Principal,
    @Param('walletId', uuid) walletId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CreateAdjustmentRequest,
  ): Promise<AdjustmentResponse> {
    const result = await this.adjustments.adjust(principal, walletId, idempotencyKey, body);
    return {
      transaction: toAdminWalletTransactionResponse(result.entry),
      wallet: toAdminWalletResponse(result.wallet),
      replayed: result.replayed,
    };
  }
}
