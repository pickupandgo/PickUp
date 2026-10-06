import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { ListTransactionsQuery, WalletResponse, WalletTransactionPageResponse } from './wallet.dto';
import { toWalletResponse, toWalletTransactionResponse } from './wallet.mapper';
import { WalletService } from './wallet.service';

/** The signed-in driver's own wallet. Drivers can only ever see their own wallet. */
@ApiTags('wallet')
@DriverOnly()
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  /** Current balance. The wallet is created with a zero balance on first access. */
  @Get()
  async getWallet(@CurrentPrincipal() principal: Principal): Promise<WalletResponse> {
    const wallet = await this.wallets.ensureWalletForDriver(requireDriver(principal).id);
    return toWalletResponse(wallet);
  }

  /** Ledger history, newest first. */
  @Get('transactions')
  async listTransactions(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListTransactionsQuery,
  ): Promise<WalletTransactionPageResponse> {
    const wallet = await this.wallets.ensureWalletForDriver(requireDriver(principal).id);
    const page = await this.wallets.listTransactions(wallet.id, query);
    return { items: page.items.map(toWalletTransactionResponse), nextCursor: page.nextCursor };
  }
}
