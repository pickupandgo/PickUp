import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CollectionsModule } from '../collections/collections.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RazorpayModule } from '../razorpay/razorpay.module';
import { RefundsModule } from '../refunds/refunds.module';
import { AdminReconciliationController } from './admin-reconciliation.controller';
import { BookingChainService } from './booking-chain.service';
import { CollectionRecoveryService } from './collection-recovery.service';
import { EarningsReconciliationService } from './earnings-reconciliation.service';
import { ProviderReconciliationService } from './provider-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationChecksService } from './reconciliation-checks.service';
import { ReconciliationFindingsService } from './reconciliation-findings.service';
import { ReconciliationRunsService } from './reconciliation-runs.service';
import { ReconciliationSchedulerService } from './reconciliation-scheduler.service';

/**
 * Integrity reports, the booking money trail, and (payment flow Phase 7) reconciliation runs:
 * database and read-only provider checks recorded as findings, and the collection recovery job.
 * The gateways are imported read-only; only the recovery job writes, through the collection
 * finalizer (CollectionsService.recover).
 */
@Module({
  imports: [AuditModule, CollectionsModule, RazorpayModule, PayoutsModule, RefundsModule],
  controllers: [ReconciliationController, AdminReconciliationController],
  providers: [
    ReconciliationService,
    EarningsReconciliationService,
    BookingChainService,
    ReconciliationFindingsService,
    ReconciliationChecksService,
    ProviderReconciliationService,
    CollectionRecoveryService,
    ReconciliationRunsService,
    ReconciliationSchedulerService,
  ],
  exports: [
    ReconciliationService,
    EarningsReconciliationService,
    BookingChainService,
    ReconciliationRunsService,
  ],
})
export class ReconciliationModule {}
