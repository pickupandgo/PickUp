import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { DriversModule } from '../drivers/drivers.module';
import { TripsModule } from '../trips/trips.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [DriversModule, TripsModule, OutboxModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
