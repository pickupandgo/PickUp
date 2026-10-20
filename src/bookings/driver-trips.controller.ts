import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { DriverTripResponse, ListTripsQuery } from './bookings.dto';
import { toDriverTripResponse } from './bookings.mapper';
import { BookingsService } from './bookings.service';

/**
 * The signed-in driver's trips, with what the customer owes, the platform fee, the driver's
 * share, each drop, and the payment gate (whether the goods may be handed over now). Drivers only
 * ever see their own trips.
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
    const rows = (await this.bookings.listTripsForDriver(principal, query.active === 'true')).map(
      ({ booking, ...trip }) => ({ booking, trip }),
    );
    const contexts = await this.bookings.paymentContexts(rows);
    return rows.map(({ booking, trip }, index) => {
      const context = contexts[index];
      if (!context) {
        throw new Error('Payment context missing for a trip');
      }
      return toDriverTripResponse(trip, booking, context);
    });
  }

  @Get(':tripId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('tripId', new ParseUUIDPipe({ version: '4' })) tripId: string,
  ): Promise<DriverTripResponse> {
    const { booking, trip } = await this.bookings.getTripForDriver(principal, tripId);
    return toDriverTripResponse(trip, booking, await this.bookings.paymentContext(booking, trip));
  }
}
