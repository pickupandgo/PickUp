import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AdminCollectionsController } from './admin-collections.controller';
import { CollectionFinalizerService } from './collection-finalizer.service';
import { CollectionLinkGateway } from './collection-link.gateway';
import { CollectionsService } from './collections.service';
import { DriverCollectionsController } from './driver-collections.controller';
import { RazorpayCollectionHttpGateway } from './razorpay-collection-http.gateway';

@Module({
  imports: [WalletModule],
  controllers: [DriverCollectionsController, AdminCollectionsController],
  providers: [
    { provide: CollectionLinkGateway, useClass: RazorpayCollectionHttpGateway },
    CollectionFinalizerService,
    CollectionsService,
  ],
  exports: [CollectionsService, CollectionLinkGateway],
})
export class CollectionsModule {}
