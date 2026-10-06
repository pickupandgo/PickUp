import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, CustomerOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { CustomerBookingResponse } from './bookings.dto';
import { toCustomerBookingResponse } from './bookings.mapper';
import { BookingsService } from './bookings.service';

/** The signed-in customer's own bookings (payment view). */
@ApiTags('bookings')
@CustomerOnly()
@Controller({ path: 'bookings', version: '1' })
export class CustomerBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(':bookingId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
  ): Promise<CustomerBookingResponse> {
    const { booking, trip } = await this.bookings.getForCustomer(principal, bookingId);
    return toCustomerBookingResponse(booking, trip);
  }
}
