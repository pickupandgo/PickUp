import { Body, Controller, HttpCode, HttpStatus, Post, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomerOnly } from '../auth/decorators';
import { RoadRouteRequest } from './routing.dto';
import { RoutingService } from './routing.service';
@CustomerOnly()
@Controller({ path: 'routes', version: '1' })
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}
  @Header('Cache-Control', 'no-store')
  @Post('road')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  road(@Body() input: RoadRouteRequest) {
    return this.routing.route(input);
  }
}
