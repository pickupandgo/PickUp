import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { DriverTripResponse, ListTripsQuery } from './bookings.dto';
import { toDriverTripResponse } from './bookings.mapper';
import { BookingsService } from './bookings.service';

/**
 * The signed-in driver's trips, with what the customer owes, the platform fee and the driver's
 * share. Drivers only ever see their own trips.
 */
@ApiTags('trips')
@DriverOnly()
@Controller({ path: 'trips', version: '1' })
export class DriverTripsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListTripsQuery,
  ): Promise<DriverTripResponse[]> {
    const trips = await this.bookings.listTripsForDriver(principal, query.active === 'true');
    return Promise.all(
      trips.map(async ({ booking, ...trip }) =>
        toDriverTripResponse(trip, booking, await this.bookings.feeFor(booking)),
      ),
    );
  }

  @Get(':tripId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('tripId', new ParseUUIDPipe({ version: '4' })) tripId: string,
  ): Promise<DriverTripResponse> {
    const { booking, trip } = await this.bookings.getTripForDriver(principal, tripId);
    return toDriverTripResponse(trip, booking, await this.bookings.feeFor(booking));
  }
}
