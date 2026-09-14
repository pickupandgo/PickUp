import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripStateService } from './trip-state.service';
import { DriversModule } from '../drivers/drivers.module';

@Module({
  imports: [DriversModule],
  controllers: [TripsController],
  providers: [TripsService, TripStateService],
  exports: [TripsService],
})
export class TripsModule {}
