import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { DriverRoutingController } from './driver-routing.controller';
import { DriverRoutingService } from './driver-routing.service';
@Module({
  controllers: [RoutingController, DriverRoutingController],
  providers: [RoutingService, DriverRoutingService],
})
export class RoutingModule {}
