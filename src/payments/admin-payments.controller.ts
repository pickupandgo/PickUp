import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly } from '../auth/decorators';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { toAdminPaymentResponse } from './payment.mapper';
import { AdminPaymentResponse, SyncPaymentResponse } from './payments.dto';
import { PaymentSyncService } from './payment-sync.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/payments', version: '1' })
export class AdminPaymentsController {
  constructor(
    private readonly sync: PaymentSyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':paymentId')
  async get(@Param('paymentId', uuid) paymentId: string): Promise<AdminPaymentResponse> {
    return toAdminPaymentResponse(
      await this.sync.getPayment(paymentId),
      this.config.razorpay.keyId,
    );
  }

  /** Re-reads the order's payments from Razorpay and applies a captured one if it was missed. */
  @Post(':paymentId/sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async syncPayment(@Param('paymentId', uuid) paymentId: string): Promise<SyncPaymentResponse> {
    const result = await this.sync.sync(paymentId);
    return {
      payment: toAdminPaymentResponse(result.payment, this.config.razorpay.keyId),
      attempts: [...result.attempts],
    };
  }
}
