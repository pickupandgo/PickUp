import { Module } from '@nestjs/common';
import { EarningsModule } from '../earnings/earnings.module';
import { FareModule } from '../fare/fare.module';
import { FeesModule } from '../fees/fees.module';
import { BookingsService } from './bookings.service';
import { CustomerBookingsController } from './customer-bookings.controller';
import { DriverTripsController } from './driver-trips.controller';

@Module({
  // FareModule exports only FareQuoteRedeemer: bookings copy a quote's amounts, never price.
  imports: [FeesModule, EarningsModule, FareModule],
  controllers: [CustomerBookingsController, DriverTripsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
