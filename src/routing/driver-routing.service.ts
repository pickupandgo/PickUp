import { Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { forbidden } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { RoutingService } from './routing.service';
import type { RoadRouteRequest } from './routing.dto';

/** Geometry only. Engine/Driver select the operational stage; no trip/money state is changed. */
@Injectable()
export class DriverRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
  ) {}

  async route(principal: Principal, input: RoadRouteRequest & { tripId: string }) {
    if (principal.role !== 'DRIVER' || !principal.driver) throw forbidden();
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: input.tripId,
        driverId: principal.driver.id,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: {
        booking: {
          select: {
            fareQuote: {
              select: {
                pickupLatitude: true,
                pickupLongitude: true,
                stops: {
                  orderBy: { sequence: 'asc' },
                  select: { latitude: true, longitude: true },
                },
              },
            },
          },
        },
      },
    });
    const quote = trip?.booking.fareQuote;
    if (!quote) throw forbidden('An assigned trip is required for navigation');
    const itinerary = [
      { latitude: Number(quote.pickupLatitude), longitude: Number(quote.pickupLongitude) },
      ...quote.stops.map((point) => ({
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
      })),
    ];
    // A driver may omit completed/closed stops, but cannot invent or reorder booking stops.
    let after = 0;
    for (const point of [...(input.waypoints ?? []), input.destination]) {
      const found = itinerary.findIndex(
        (allowed, i) =>
          i >= after &&
          Math.abs(allowed.latitude - point.latitude) <= 0.00001 &&
          Math.abs(allowed.longitude - point.longitude) <= 0.00001,
      );
      if (found < 0) throw forbidden('Navigation stops must follow the assigned booking');
      after = found + 1;
    }
    return this.routing.route({
      origin: input.origin,
      destination: input.destination,
      waypoints: input.waypoints,
    });
  }
}
