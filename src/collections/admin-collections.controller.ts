import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly } from '../auth/decorators';
import { AdminCollectionResponse, SyncCollectionResponse } from './collections.dto';
import { toAdminCollectionResponse } from './collections.mapper';
import { CollectionsService } from './collections.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/collections', version: '1' })
export class AdminCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get(':collectionId')
  async get(@Param('collectionId', uuid) collectionId: string): Promise<AdminCollectionResponse> {
    const collection = await this.collections.get(collectionId);
    return toAdminCollectionResponse(collection, await this.collections.stopSequenceOf(collection));
  }

  /**
   * Re-reads an online collection from Razorpay and applies a payment the webhook missed, through
   * the same finalizer as the webhook and the driver's refresh.
   */
  @Post(':collectionId/sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sync(@Param('collectionId', uuid) collectionId: string): Promise<SyncCollectionResponse> {
    const result = await this.collections.sync(collectionId);
    return {
      collection: toAdminCollectionResponse(
        result.collection,
        await this.collections.stopSequenceOf(result.collection),
      ),
      outcome: result.outcome,
    };
  }
}
