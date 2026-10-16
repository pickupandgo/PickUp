import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AdminOnly } from '../auth/decorators';
import { CollectionLinkGateway } from '../collections/collection-link.gateway';
import { SimulatedCollectionLinkGateway } from '../collections/simulated-collection-link.gateway';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PayoutGateway } from '../payouts/payout.gateway';
import { SimulatedPayoutGateway } from '../payouts/simulated-payout.gateway';
import { RAZORPAY_PAYMENT_ID_PATTERN } from '../razorpay/razorpay.types';
import { RefundGateway } from '../refunds/refund.gateway';
import { refundEntity, SimulatedRefundGateway } from '../refunds/simulated-refund.gateway';
import { SettlementGateway } from '../settlements/settlement.gateway';
import { SimulatedSettlementGateway } from '../settlements/simulated-settlement.gateway';

const PROVIDER_ID = /^[A-Za-z0-9_]{6,60}$/;

export class SimulateSettlementRequest {
  @Matches(RAZORPAY_PAYMENT_ID_PATTERN, { message: 'providerPaymentId must be a pay_ id' })
  providerPaymentId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  settledAt?: string;
}

export class SimulateValidationRequest {
  @IsIn(['active', 'invalid'])
  accountStatus!: 'active' | 'invalid';

  @IsOptional()
  @IsString()
  @Length(1, 120)
  registeredName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  nameMatchScore?: number;
}

export class SimulateQrPaymentRequest {
  /** What the customer pays; defaults to the QR's fixed amount. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise?: number;
}

export class SimulatePayoutRequest {
  @IsIn(['processed', 'reversed', 'failed'])
  status!: 'processed' | 'reversed' | 'failed';

  @IsOptional()
  @IsString()
  @Length(3, 200)
  failureReason?: string;
}

export class SimulateRefundRequest {
  @IsIn(['processed', 'failed'])
  status!: 'processed' | 'failed';
}

/**
 * NON-PRODUCTION ONLY. Mounted only when a simulated provider is configured, which config
 * validation allows only outside production with Razorpay test keys; admin authentication still
 * applies. Each endpoint changes the simulated provider's state, the way the Razorpay dashboard
 * moves test-mode objects, and returns the provider entity so a test can deliver it through the
 * real, signed webhook endpoints. Nothing here writes to the database.
 */
@ApiTags('dev')
@AdminOnly()
@Controller({ path: 'dev/simulate', version: '1' })
export class DevSimulationController {
  constructor(
    private readonly settlements: SettlementGateway,
    private readonly payouts: PayoutGateway,
    private readonly collections: CollectionLinkGateway,
    private readonly refunds: RefundGateway,
  ) {}

  /** Razorpay settles a customer payment to Nikhil Enterprises (test mode never does). */
  @Post('settlements')
  @HttpCode(HttpStatus.OK)
  settle(@Body() body: SimulateSettlementRequest): Record<string, unknown> {
    if (!(this.settlements instanceof SimulatedSettlementGateway)) {
      throw notSimulated();
    }
    const settled = this.settlements.settle({
      providerPaymentId: body.providerPaymentId,
      amountPaise: body.amountPaise,
      settledAt: body.settledAt ? new Date(body.settledAt) : undefined,
    });
    const createdAt = Math.floor(settled.settledAt.getTime() / 1000);
    return {
      settledPayment: { ...settled, settledAt: settled.settledAt.toISOString() },
      // settlement.processed webhook entity (Razorpay sends no per-payment list).
      entity: {
        id: settled.providerSettlementId,
        entity: 'settlement',
        amount: settled.amountPaise - settled.feePaise - settled.taxPaise,
        status: 'processed',
        fees: settled.feePaise,
        tax: settled.taxPaise,
        utr: settled.settlementUtr,
        created_at: createdAt,
      },
    };
  }

  /** The bank answers a penny-drop validation. */
  @Post('bank-validations/:providerValidationId')
  @HttpCode(HttpStatus.OK)
  completeValidation(
    @Param('providerValidationId') providerValidationId: string,
    @Body() body: SimulateValidationRequest,
  ): Record<string, unknown> {
    const gateway = this.simulatedPayouts();
    const validation = PROVIDER_ID.test(providerValidationId)
      ? gateway.completeValidation(providerValidationId, {
          accountStatus: body.accountStatus,
          registeredName: body.registeredName ?? null,
          nameMatchScore: body.nameMatchScore,
        })
      : null;
    if (!validation) {
      throw unknown('validation');
    }
    return {
      entity: {
        id: validation.id,
        entity: 'fund_account.validation',
        status: validation.status,
        fund_account: { id: validation.fundAccountId },
        results: {
          account_status: validation.accountStatus,
          registered_name: validation.registeredName,
        },
        utr: validation.utr,
      },
    };
  }

  /** The bank processes, returns or fails a payout. */
  @Post('payouts/:providerPayoutId')
  @HttpCode(HttpStatus.OK)
  movePayout(
    @Param('providerPayoutId') providerPayoutId: string,
    @Body() body: SimulatePayoutRequest,
  ): Record<string, unknown> {
    const gateway = this.simulatedPayouts();
    const payout = PROVIDER_ID.test(providerPayoutId)
      ? gateway.setPayoutStatus(providerPayoutId, body.status, body.failureReason)
      : null;
    if (!payout) {
      throw unknown('payout');
    }
    return {
      entity: {
        id: payout.id,
        entity: 'payout',
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        reference_id: payout.referenceId,
        fund_account_id: payout.fundAccountId,
        utr: payout.utr,
        failure_reason: payout.failureReason,
      },
    };
  }

  /**
   * The customer pays a collection QR code (Razorpay test mode can't pay one). Returns the
   * qr_code and payment entities of the qr_code.credited webhook to deliver, signed, through
   * /v1/webhooks/razorpay; the backend then reads the QR back from the provider, as always.
   */
  @Post('qr-codes/:qrCodeId/payments')
  @HttpCode(HttpStatus.OK)
  payQrCode(
    @Param('qrCodeId') qrCodeId: string,
    @Body() body: SimulateQrPaymentRequest,
  ): Record<string, unknown> {
    if (!(this.collections instanceof SimulatedCollectionLinkGateway)) {
      throw notSimulated();
    }
    const paid = PROVIDER_ID.test(qrCodeId)
      ? this.collections.pay(qrCodeId, body.amountPaise)
      : null;
    if (!paid) {
      throw unknown('QR code, or it is no longer payable');
    }
    return { qrCode: paid.qrCode, payment: paid.payment };
  }

  /**
   * Razorpay processes or fails a refund (payment flow Phase 6). Returns the refund entity of the
   * refund.processed / refund.failed webhook to deliver, signed, through /v1/webhooks/razorpay.
   */
  @Post('refunds/:providerRefundId')
  @HttpCode(HttpStatus.OK)
  moveRefund(
    @Param('providerRefundId') providerRefundId: string,
    @Body() body: SimulateRefundRequest,
  ): Record<string, unknown> {
    if (!(this.refunds instanceof SimulatedRefundGateway)) {
      throw notSimulated();
    }
    const refund = PROVIDER_ID.test(providerRefundId)
      ? this.refunds.setRefundStatus(providerRefundId, body.status)
      : null;
    if (!refund) {
      throw unknown('refund');
    }
    return { entity: refundEntity(refund) };
  }

  private simulatedPayouts(): SimulatedPayoutGateway {
    if (!(this.payouts instanceof SimulatedPayoutGateway)) {
      throw notSimulated();
    }
    return this.payouts;
  }
}

function notSimulated(): AppError {
  return new AppError(
    ErrorCode.NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'This provider is not simulated on this server',
  );
}

function unknown(what: string): AppError {
  return new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, `Unknown simulated ${what}`);
}
