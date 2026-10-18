import { Global, Module } from '@nestjs/common';
import { PaymentBackendClient } from './payment-backend.client';

@Global()
@Module({
  providers: [PaymentBackendClient],
  exports: [PaymentBackendClient],
})
export class PaymentBackendModule {}
