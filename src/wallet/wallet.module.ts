import { Module } from '@nestjs/common';
import { AdminWalletController } from './admin-wallet.controller';
import { WalletAdjustmentService } from './wallet-adjustment.service';
import { WalletController } from './wallet.controller';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController, AdminWalletController],
  providers: [WalletLedgerService, WalletService, WalletAdjustmentService],
  exports: [WalletLedgerService, WalletService],
})
export class WalletModule {}
