import { Module } from '@nestjs/common';
import { BookingChainService } from './booking-chain.service';
import { EarningsReconciliationService } from './earnings-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, EarningsReconciliationService, BookingChainService],
  exports: [ReconciliationService, EarningsReconciliationService, BookingChainService],
})
export class ReconciliationModule {}
