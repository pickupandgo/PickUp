import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EarningsModule } from '../earnings/earnings.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminRefundsController } from './admin-refunds.controller';
import { RazorpayRefundHttpGateway } from './razorpay-refund-http.gateway';
import { RefundGateway } from './refund.gateway';
import { RefundFinalizerService } from './refund-finalizer.service';
import { RefundsService } from './refunds.service';
import { DisabledRefundGateway, SimulatedRefundGateway } from './simulated-refund.gateway';

/** Refunds (payment flow Phase 6): admin-requested provider refunds and recorded cash returns. */
@Module({
  imports: [EarningsModule, WalletModule],
  controllers: [AdminRefundsController],
  providers: [
    {
      provide: RefundGateway,
      inject: [APP_CONFIG],
      // Simulated refunds only for local end-to-end runs (refused in production and with live
      // keys by config validation); Razorpay live only once verified (REFUNDS_PROVIDER_VERIFIED).
      useFactory: (config: AppConfig): RefundGateway => {
        switch (config.refunds.provider) {
          case 'razorpay':
            return new RazorpayRefundHttpGateway(config);
          case 'simulated':
            return new SimulatedRefundGateway();
          default:
            return new DisabledRefundGateway();
        }
      },
    },
    RefundFinalizerService,
    RefundsService,
  ],
  exports: [RefundGateway, RefundFinalizerService, RefundsService],
})
export class RefundsModule {}
