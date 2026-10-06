import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { EarningsModule } from '../earnings/earnings.module';
import { RazorpayModule } from '../razorpay/razorpay.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { BookingPaymentFinalizerService } from './booking-payment-finalizer.service';
import { BookingPaymentService } from './booking-payment.service';
import { BookingPaymentsController } from './booking-payments.controller';
import { DisputesService } from './disputes.service';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { PaymentOrderService } from './payment-orders.service';
import { PaymentSyncService } from './payment-sync.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { TopUpFinalizerService } from './top-up-finalizer.service';
import { TopUpService } from './top-up.service';
import { WalletTopUpsController } from './wallet-topups.controller';

@Module({
  imports: [RazorpayModule, WalletModule, CollectionsModule, EarningsModule, SettlementsModule],
  controllers: [
    WalletTopUpsController,
    BookingPaymentsController,
    RazorpayWebhookController,
    AdminPaymentsController,
  ],
  providers: [
    PaymentOrderService,
    TopUpService,
    TopUpFinalizerService,
    BookingPaymentService,
    BookingPaymentFinalizerService,
    PaymentConfirmationService,
    DisputesService,
    RazorpayWebhookService,
    PaymentSyncService,
  ],
})
export class PaymentsModule {}
