import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { BookingStopsService } from './booking-stops.service';
import { AdminStopResolutionResponse, ResolveStopRequest } from './bookings.dto';
import { toAdminBookingStopView } from './bookings.mapper';

/** Admin decisions on the drops of bookings priced per drop. */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/bookings', version: '1' })
export class AdminBookingsController {
  constructor(private readonly stops: BookingStopsService) {}

  /**
   * Resolves a failed delivery attempt: RETRY makes the drop current again, UNDELIVERED closes it
   * without delivery. Reason required; recorded on the drop and in the audit trail. Repeating a
   * decision changes nothing.
   */
  @Post(':bookingId/stops/:sequence/resolve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Param('sequence', ParseIntPipe) sequence: number,
    @Body() body: ResolveStopRequest,
  ): Promise<AdminStopResolutionResponse> {
    const result = await this.stops.resolve(
      principal,
      bookingId,
      sequence,
      body.resolution,
      body.reason,
    );
    return {
      bookingId: result.booking.id,
      bookingStatus: result.booking.status,
      paymentStatus: result.booking.paymentStatus,
      tripStatus: result.trip?.status ?? null,
      changed: result.changed,
      stop: toAdminBookingStopView(result.stop),
    };
  }
}
