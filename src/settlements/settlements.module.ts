import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EarningsModule } from '../earnings/earnings.module';
import { AdminSettlementsController } from './admin-settlements.controller';
import { MerchantSettlementsService } from './merchant-settlements.service';
import { RazorpaySettlementHttpGateway } from './razorpay-settlement-http.gateway';
import { SettlementGateway } from './settlement.gateway';
import { SettlementSyncSchedulerService } from './settlement-sync-scheduler.service';
import {
  DisabledSettlementGateway,
  SimulatedSettlementGateway,
} from './simulated-settlement.gateway';

@Module({
  imports: [EarningsModule],
  controllers: [AdminSettlementsController],
  providers: [
    {
      provide: SettlementGateway,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SettlementGateway => {
        switch (config.settlements.provider) {
          case 'razorpay':
            return new RazorpaySettlementHttpGateway(config);
          case 'simulated':
            return new SimulatedSettlementGateway();
          default:
            return new DisabledSettlementGateway();
        }
      },
    },
    MerchantSettlementsService,
    SettlementSyncSchedulerService,
  ],
  exports: [SettlementGateway, MerchantSettlementsService],
})
export class SettlementsModule {}
