import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DriverLocationStore } from './driver-location.store';

@Module({
  controllers: [DriversController],
  providers: [DriversService, DriverLocationStore],
  exports: [DriversService],
})
export class DriversModule {}
