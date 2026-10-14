import { Module } from '@nestjs/common';
import { AdminPricingVersionsController } from './admin-pricing-versions.controller';
import { FareQuoteRedeemer } from './fare-contract';
import { FarePricer } from './fare-pricer';
import { FareQuotesController } from './fare-quotes.controller';
import { FareQuotesService } from './fare-quotes.service';
import { InternalFareQuotesController } from './internal-fare-quotes.controller';
import { PricingVersionsService } from './pricing-versions.service';

/**
 * Fare calculation: pricing versions and quotes. A separate boundary from payments: it exports
 * only FareQuoteRedeemer (fare-contract.ts), which hands a quote's frozen amounts to booking
 * registration. It never reads payments, collections, earnings or wallets.
 */
@Module({
  controllers: [FareQuotesController, AdminPricingVersionsController, InternalFareQuotesController],
  providers: [FarePricer, FareQuotesService, PricingVersionsService, FareQuoteRedeemer],
  exports: [FareQuoteRedeemer],
})
export class FareModule {}
