import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { CollectionsModule } from '../collections/collections.module';
import { InternalBookingsController } from './internal-bookings.controller';

/** Server-to-server integration with the trip engine. */
@Module({
  imports: [BookingsModule, CollectionsModule],
  controllers: [InternalBookingsController],
})
export class EngineModule {}
