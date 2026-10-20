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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import {
  CreateFareQuoteRequest,
  CreatePricingVersionRequest,
  CreatePricingVersionResponse,
  DeactivatePricingVersionRequest,
  ListPricingVersionsQuery,
  PricingPreviewResponse,
  PricingVersionResponse,
} from './fare.dto';
import { toPricingPreviewResponse, toPricingVersionResponse } from './fare.mapper';
import { PricingVersionsService } from './pricing-versions.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Pricing configuration (Fare & Pricing in the admin panel). A price change is a new version
 * with its own start; versions are never edited, so every quote and booking can be explained by
 * the version that priced it.
 */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/pricing-versions', version: '1' })
export class AdminPricingVersionsController {
  constructor(private readonly versions: PricingVersionsService) {}

  @Get()
  async list(@Query() query: ListPricingVersionsQuery): Promise<PricingVersionResponse[]> {
    const now = this.versions.now();
    return (await this.versions.list({ activeOnly: query.activeOnly ?? false })).map((version) =>
      toPricingVersionResponse(version, now),
    );
  }

  /** The version pricing new quotes right now. */
  @Get('current')
  async current(): Promise<PricingVersionResponse> {
    return toPricingVersionResponse(await this.versions.current(), this.versions.now());
  }

  @Get(':versionId')
  async get(@Param('versionId', uuid) versionId: string): Promise<PricingVersionResponse> {
    return toPricingVersionResponse(await this.versions.get(versionId), this.versions.now());
  }

  /**
   * Creates a version. The open-ended version in effect is closed at the new version's start;
   * quotes already given keep the version that priced them.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreatePricingVersionRequest,
  ): Promise<CreatePricingVersionResponse> {
    const result = await this.versions.create(principal, {
      code: body.code,
      model: body.model,
      config: body.config,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
      reason: body.reason,
    });
    const now = this.versions.now();
    return {
      version: toPricingVersionResponse(result.version, now),
      superseded: result.superseded ? toPricingVersionResponse(result.superseded, now) : null,
    };
  }

  /** What a route would cost under this version. Nothing is stored. */
  @Post(':versionId/preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async preview(
    @Param('versionId', uuid) versionId: string,
    @Body() body: CreateFareQuoteRequest,
  ): Promise<PricingPreviewResponse> {
    return toPricingPreviewResponse(await this.versions.preview(versionId, body));
  }

  @Post(':versionId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('versionId', uuid) versionId: string,
    @Body() body: DeactivatePricingVersionRequest,
  ): Promise<PricingVersionResponse> {
    return toPricingVersionResponse(
      await this.versions.deactivate(principal, versionId, body.reason),
      this.versions.now(),
    );
  }
}
