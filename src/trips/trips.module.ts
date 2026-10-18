import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [DriversModule, OutboxModule],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
