import { Module } from '@nestjs/common';
import { DocumentStorageService } from '../onboarding/document-storage.service';
import { DeliveryProofsController } from './delivery-proofs.controller';
import { DeliveryProofsService } from './delivery-proofs.service';
@Module({
  controllers: [DeliveryProofsController],
  providers: [DeliveryProofsService, DocumentStorageService],
})
export class DeliveryProofsModule {}
