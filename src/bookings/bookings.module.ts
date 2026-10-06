import { Module } from '@nestjs/common';
import { EarningsModule } from '../earnings/earnings.module';
import { FeesModule } from '../fees/fees.module';
import { BookingsService } from './bookings.service';
import { CustomerBookingsController } from './customer-bookings.controller';
import { DriverTripsController } from './driver-trips.controller';

@Module({
  imports: [FeesModule, EarningsModule],
  controllers: [CustomerBookingsController, DriverTripsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
