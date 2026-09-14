import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { DriversModule } from '../drivers/drivers.module';
import { TripsModule } from '../trips/trips.module';
import { FareModule } from '../fare/fare.module';

@Module({
  imports: [DriversModule, TripsModule, FareModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
