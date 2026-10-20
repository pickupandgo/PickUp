import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import { toWalletResponse } from '../wallet/wallet.mapper';
import { toTopUpResponse } from './payment.mapper';
import {
  CreateTopUpRequest,
  TopUpResponse,
  VerifyTopUpRequest,
  VerifyTopUpResponse,
} from './payments.dto';
import { TopUpService } from './top-up.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Driver wallet recharge through Razorpay. */
@ApiTags('wallet')
@DriverOnly()
@Controller({ path: 'wallet/topups', version: '1' })
export class WalletTopUpsController {
  constructor(
    private readonly topUps: TopUpService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts a top-up and returns the Razorpay Checkout parameters. Retry with the same key. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: 'One key per top-up attempt',
  })
  async create(
    @CurrentPrincipal() principal: Principal,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CreateTopUpRequest,
  ): Promise<TopUpResponse> {
    const payment = await this.topUps.createTopUp(principal, idempotencyKey, body.amountPaise);
    return toTopUpResponse(payment, this.config.razorpay.keyId);
  }

  /** Current state of one of the driver's own top-ups. */
  @Get(':paymentId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('paymentId', uuid) paymentId: string,
  ): Promise<TopUpResponse> {
    const payment = await this.topUps.getTopUp(principal, paymentId);
    return toTopUpResponse(payment, this.config.razorpay.keyId);
  }

  /**
   * Submit the Razorpay Checkout success values. The server verifies the signature and checks the
   * payment with Razorpay before crediting. Safe to call more than once.
   */
  @Post(':paymentId/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verify(
    @CurrentPrincipal() principal: Principal,
    @Param('paymentId', uuid) paymentId: string,
    @Body() body: VerifyTopUpRequest,
  ): Promise<VerifyTopUpResponse> {
    const result = await this.topUps.verifyTopUp(principal, paymentId, body);
    return {
      payment: toTopUpResponse(result.payment, this.config.razorpay.keyId),
      providerStatus: result.providerStatus,
      wallet: result.wallet ? toWalletResponse(result.wallet) : null,
    };
  }
}
