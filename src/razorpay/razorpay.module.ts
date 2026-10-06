import { Module } from '@nestjs/common';
import { RazorpayHttpGateway } from './razorpay-http.gateway';
import { RazorpayGateway } from './razorpay.gateway';

@Module({
  providers: [{ provide: RazorpayGateway, useClass: RazorpayHttpGateway }],
  exports: [RazorpayGateway],
})
export class RazorpayModule {}
