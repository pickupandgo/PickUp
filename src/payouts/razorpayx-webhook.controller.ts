import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import type { WebhookAckResponse } from '../payments/payments.dto';
import { RazorpayXWebhookService } from './razorpayx-webhook.service';

/**
 * RazorpayX payout webhook endpoint. Public, but every request must carry a valid
 * X-Razorpay-Signature computed over the raw body with the RazorpayX webhook secret.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'webhooks', version: '1' })
export class RazorpayXWebhookController {
  constructor(private readonly webhooks: RazorpayXWebhookService) {}

  @Post('razorpayx')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<WebhookAckResponse> {
    await this.webhooks.handle({ rawBody: request.rawBody, signature, eventIdHeader: eventId });
    return { received: true };
  }
}
