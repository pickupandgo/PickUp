import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, CustomerOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { CreateFareQuoteRequest, FareQuoteResponse } from './fare.dto';
import { FareQuotesService } from './fare-quotes.service';

/** Fare quotes: the server prices the route; the app shows the result and books with quoteId. */
@ApiTags('fare')
@CustomerOnly()
@Controller({ path: 'fare/quotes', version: '1' })
export class FareQuotesController {
  constructor(private readonly quotes: FareQuotesService) {}

  /**
   * Prices a route under the pricing version in effect: the total and each drop's amount, valid
   * until expiresAt. The request carries locations, vehicle category and weight, never an amount.
   */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateFareQuoteRequest,
  ): Promise<FareQuoteResponse> {
    return this.quotes.create(principal, body);
  }

  @Get(':quoteId')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string,
  ): Promise<FareQuoteResponse> {
    return this.quotes.get(principal, quoteId);
  }
}
