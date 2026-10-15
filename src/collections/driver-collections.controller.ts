import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { numberToPaise } from '../common/money';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import { CreateCollectionRequest, DriverCollectionResponse } from './collections.dto';
import { toDriverCollectionResponse } from './collections.mapper';
import { CollectionsService } from './collections.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Pickup / delivery payment collection by the assigned driver. */
@ApiTags('trips')
@DriverOnly()
@Controller({ path: 'trips/:tripId/collections', version: '1' })
export class DriverCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  /**
   * CASH: records the cash and debits the platform fee from the wallet in one step.
   * ONLINE_QR: returns a booking-linked Razorpay QR for the customer to scan.
   * For a booking paid drop by drop, `stopSequence` names the drop the driver is at.
   * Retry with the same Idempotency-Key; it never records twice. The response carries the
   * booking's payment state and payment gate as recorded by the server.
   */
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('tripId', uuid) tripId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CreateCollectionRequest,
  ): Promise<DriverCollectionResponse> {
    const result = await this.collections.collect(principal, tripId, idempotencyKey, {
      method: body.method,
      amountPaise: numberToPaise(body.amountPaise),
      stopSequence: body.stopSequence ?? null,
    });
    return toDriverCollectionResponse(
      result.collection,
      await this.collections.driverView(result.collection),
      result.replayed,
    );
  }

  /** Current state. A pending QR is re-checked with Razorpay, so the app can poll this. */
  @Get(':collectionId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('tripId', uuid) tripId: string,
    @Param('collectionId', uuid) collectionId: string,
  ): Promise<DriverCollectionResponse> {
    const collection = await this.collections.getForDriver(principal, tripId, collectionId);
    return toDriverCollectionResponse(collection, await this.collections.driverView(collection));
  }
}
