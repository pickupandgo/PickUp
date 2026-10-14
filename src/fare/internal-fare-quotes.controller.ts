import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InternalOnly } from '../auth/decorators';
import { InternalFareQuoteResponse } from './fare.dto';
import { FareQuotesService } from './fare-quotes.service';

/**
 * For the trip engine: the route and amounts of a quote, so the trip it creates (pickup and
 * drops, in order) is exactly the route that was priced.
 */
@ApiExcludeController()
@InternalOnly()
@Throttle({ default: { limit: 1_200, ttl: 60_000 } })
@Controller({ path: 'internal/fare-quotes', version: '1' })
export class InternalFareQuotesController {
  constructor(private readonly quotes: FareQuotesService) {}

  @Get(':quoteId')
  get(
    @Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string,
  ): Promise<InternalFareQuoteResponse> {
    return this.quotes.getForEngine(quoteId);
  }
}
