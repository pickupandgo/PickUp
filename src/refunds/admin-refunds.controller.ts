import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import {
  CancelRefundRequest,
  CreateRefundRequest,
  CreateRefundResponse,
  ListRefundsQuery,
  RefundResponse,
  SyncRefundResponse,
} from './refunds.dto';
import { toRefundResponse } from './refunds.mapper';
import { RefundsService } from './refunds.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Refunds (payment flow Phase 6), admin only. Every refund is requested by an admin with a
 * reason and audited; the server computes the amount from what the source collected, and only
 * the provider (or an admin's recorded cash return) ever completes one. Refund policy stays open
 * (OPEN_DECISIONS L-7 to L-10, L-21): nothing is refunded automatically.
 */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/refunds', version: '1' })
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /**
   * Requests a provider refund of an online payment, or records a cash return. 201 when created;
   * 200 with the original refund when the Idempotency-Key was already used for this request.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })
  async create(
    @CurrentPrincipal() principal: Principal,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CreateRefundRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateRefundResponse> {
    const result = await this.refunds.request(principal, idempotencyKey, {
      bookingId: body.bookingId,
      sourceCollectionId: body.sourceCollectionId ?? null,
      sourcePaymentId: body.sourcePaymentId ?? null,
      stopSequence: body.stopSequence ?? null,
      kind: body.kind,
      amountPaise: body.amountPaise ?? null,
      reason: body.reason,
      feeTreatment: body.feeTreatment ?? null,
    });
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return {
      refund: toRefundResponse(result.refund),
      created: result.created,
      submission: result.submission,
    };
  }

  /** Refunds, newest first, optionally for one booking or in one status. */
  @Get()
  async list(@Query() query: ListRefundsQuery): Promise<RefundResponse[]> {
    return (await this.refunds.list(query)).map(toRefundResponse);
  }

  @Get(':refundId')
  async get(@Param('refundId', uuid) refundId: string): Promise<RefundResponse> {
    return toRefundResponse(await this.refunds.get(refundId));
  }

  /** Re-reads the refund from Razorpay and applies a state a webhook missed (or resends it). */
  @Post(':refundId/sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sync(
    @CurrentPrincipal() principal: Principal,
    @Param('refundId', uuid) refundId: string,
  ): Promise<SyncRefundResponse> {
    const result = await this.refunds.sync(refundId, principal);
    return { refund: toRefundResponse(result.refund), outcome: result.outcome };
  }

  /** Withdraws a provider refund that never reached Razorpay. Reason required. */
  @Post(':refundId/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('refundId', uuid) refundId: string,
    @Body() body: CancelRefundRequest,
  ): Promise<RefundResponse> {
    return toRefundResponse(await this.refunds.cancel(refundId, principal, body.reason));
  }
}
