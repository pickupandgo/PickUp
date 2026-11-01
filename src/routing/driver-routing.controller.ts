import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsUUID } from 'class-validator';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { RoadRouteRequest } from './routing.dto';
import { DriverRoutingService } from './driver-routing.service';

export class DriverRoadRouteRequest extends RoadRouteRequest {
  /** The backend trip id already returned to the Driver by the Engine. */
  @IsUUID() tripId!: string;
}

@DriverOnly()
@Controller({ path: 'driver/routes', version: '1' })
export class DriverRoutingController {
  constructor(private readonly routing: DriverRoutingService) {}
  @Post('road')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  road(@CurrentPrincipal() principal: Principal, @Body() input: DriverRoadRouteRequest) {
    return this.routing.route(principal, input);
  }
}
