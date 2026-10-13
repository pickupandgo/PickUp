import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SettlementsModule } from '../settlements/settlements.module';
import { AdminPayoutsController } from './admin-payouts.controller';
import { BankAccountChangesService } from './bank-account-changes.service';
import { BankAccountsService } from './bank-accounts.service';
import { DisabledPayoutGateway } from './disabled-payout.gateway';
import { DriverPayoutsController } from './driver-payouts.controller';
import { PayoutGateway } from './payout.gateway';
import { PayoutBatchesService } from './payout-batches.service';
import { PayoutExecutionService } from './payout-execution.service';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { PayoutStatusService } from './payout-status.service';
import { RazorpayXHttpGateway } from './razorpayx-http.gateway';
import { RazorpayXWebhookController } from './razorpayx-webhook.controller';
import { RazorpayXWebhookService } from './razorpayx-webhook.service';
import { SimulatedPayoutGateway } from './simulated-payout.gateway';

@Module({
  imports: [SettlementsModule],
  controllers: [DriverPayoutsController, AdminPayoutsController, RazorpayXWebhookController],
  providers: [
    {
      provide: PayoutGateway,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PayoutGateway => {
        switch (config.payouts.provider) {
          case 'razorpayx':
            return new RazorpayXHttpGateway(config);
          case 'simulated':
            return new SimulatedPayoutGateway();
          default:
            return new DisabledPayoutGateway();
        }
      },
    },
    BankAccountsService,
    BankAccountChangesService,
    PayoutStatusService,
    PayoutBatchesService,
    PayoutExecutionService,
    PayoutSchedulerService,
    RazorpayXWebhookService,
  ],
  exports: [
    PayoutGateway,
    BankAccountsService,
    PayoutBatchesService,
    PayoutExecutionService,
    PayoutStatusService,
    PayoutSchedulerService,
  ],
})
export class PayoutsModule {}
