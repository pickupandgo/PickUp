import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { WalletModule } from '../wallet/wallet.module';
import { AdminCollectionsController } from './admin-collections.controller';
import { CollectionFinalizerService } from './collection-finalizer.service';
import { CollectionLinkGateway } from './collection-link.gateway';
import { CollectionsService } from './collections.service';
import { DriverCollectionsController } from './driver-collections.controller';
import { RazorpayCollectionHttpGateway } from './razorpay-collection-http.gateway';
import { SimulatedCollectionLinkGateway } from './simulated-collection-link.gateway';

@Module({
  // BookingsModule: the payment gate in the driver's collection responses.
  imports: [WalletModule, BookingsModule],
  controllers: [DriverCollectionsController, AdminCollectionsController],
  providers: [
    {
      provide: CollectionLinkGateway,
      inject: [APP_CONFIG],
      // Simulated QR codes only for local end-to-end runs (refused in production and with live
      // keys by config validation); Razorpay otherwise.
      useFactory: (config: AppConfig): CollectionLinkGateway =>
        config.collections.simulated
          ? new SimulatedCollectionLinkGateway()
          : new RazorpayCollectionHttpGateway(config),
    },
    CollectionFinalizerService,
    CollectionsService,
  ],
  exports: [CollectionsService, CollectionLinkGateway],
})
export class CollectionsModule {}
