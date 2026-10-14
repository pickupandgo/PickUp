import { paiseToNumber } from '../common/money';
import type { Booking, BookingStop, Trip } from '../generated/prisma/client';
import type {
  BookingStopView,
  CustomerBookingResponse,
  DriverTripResponse,
  InternalBookingResponse,
  TripResponse,
} from './bookings.dto';
import { DELIVERY_COLLECTION_WINDOW, PICKUP_COLLECTION_WINDOW } from './trip-lifecycle';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toTripResponse(trip: Trip): TripResponse {
  return {
    tripId: trip.id,
    bookingId: trip.bookingId,
    driverId: trip.driverId,
    status: trip.status,
    assignedAt: trip.assignedAt.toISOString(),
    arrivedAt: iso(trip.arrivedAt),
    pickupVerifiedAt: iso(trip.pickupVerifiedAt),
    startedAt: iso(trip.startedAt),
    deliveredAt: iso(trip.deliveredAt),
    paymentConfirmedAt: iso(trip.paymentConfirmedAt),
    completedAt: iso(trip.completedAt),
    cancelledAt: iso(trip.cancelledAt),
  };
}

export function toBookingStopView(stop: BookingStop): BookingStopView {
  return {
    sequence: stop.sequence,
    payablePaise: paiseToNumber(stop.payablePaise),
    status: stop.status,
  };
}

export function toInternalBookingResponse(
  booking: Booking,
  trip: Trip | null,
  extras: {
    readonly paidWith: InternalBookingResponse['paidWith'];
    readonly platformFeePaise: bigint;
    readonly stops: readonly BookingStop[];
  },
): InternalBookingResponse {
  return {
    bookingId: booking.id,
    externalRef: booking.externalRef,
    status: booking.status,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    paidWith: extras.paidWith,
    paymentModel: booking.paymentModel,
    quoteId: booking.fareQuoteId,
    pricingVersionId: booking.pricingVersionId,
    // A legacy booking had no tax concept: its fare is its payable amount.
    farePaise: paiseToNumber(booking.farePaise ?? booking.finalFareMinor),
    taxPaise: paiseToNumber(booking.taxPaise ?? 0n),
    payablePaise: paiseToNumber(booking.finalFareMinor),
    platformFeePaise: paiseToNumber(extras.platformFeePaise),
    stops: [...extras.stops].sort((a, b) => a.sequence - b.sequence).map(toBookingStopView),
    vehicleCategory: booking.vehicleCategory,
    feeRuleId: booking.feeRuleId,
    confirmedAt: booking.confirmedAt.toISOString(),
    completedAt: iso(booking.completedAt),
    cancelledAt: iso(booking.cancelledAt),
    cancellationReason: booking.cancellationReason,
    trip: trip ? toTripResponse(trip) : null,
  };
}

export function toCustomerBookingResponse(
  booking: Booking,
  trip: Trip | null,
): CustomerBookingResponse {
  return {
    bookingId: booking.id,
    externalRef: booking.externalRef,
    status: booking.status,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    farePaise: paiseToNumber(booking.finalFareMinor),
    confirmedAt: booking.confirmedAt.toISOString(),
    tripStatus: trip ? trip.status : null,
  };
}

/** PICKUP or DELIVERY for pay-at-pickup / pay-at-delivery bookings (D-07: derived, not stored). */
export function collectionStageOf(booking: Booking): 'PICKUP' | 'DELIVERY' | null {
  switch (booking.paymentMethod) {
    case 'PAY_AT_PICKUP':
      return 'PICKUP';
    case 'PAY_AT_DELIVERY':
      return 'DELIVERY';
    default:
      return null;
  }
}

/** Whether the driver may collect payment for this booking right now. */
export function isCollectionOpen(booking: Booking, trip: Trip): boolean {
  const stage = collectionStageOf(booking);
  if (!stage || booking.paymentStatus !== 'UNPAID' || booking.status === 'CANCELLED') {
    return false;
  }
  if (stage === 'DELIVERY' && booking.paymentModel === 'QUOTE_PER_STOP') {
    // Collected per drop, which is not enabled yet (the API and the database refuse a
    // whole-booking delivery collection), so the driver app is never offered one.
    return false;
  }
  const window = stage === 'PICKUP' ? PICKUP_COLLECTION_WINDOW : DELIVERY_COLLECTION_WINDOW;
  return window.has(trip.status);
}

export function toDriverTripResponse(
  trip: Trip,
  booking: Booking,
  feePaise: bigint,
): DriverTripResponse {
  return {
    tripId: trip.id,
    bookingId: booking.id,
    externalRef: booking.externalRef,
    status: trip.status,
    assignedAt: trip.assignedAt.toISOString(),
    completedAt: iso(trip.completedAt),
    payment: {
      method: booking.paymentMethod,
      status: booking.paymentStatus,
      farePaise: paiseToNumber(booking.finalFareMinor),
      platformFeePaise: paiseToNumber(feePaise),
      driverSharePaise: paiseToNumber(booking.finalFareMinor - feePaise),
      collectionStage: collectionStageOf(booking),
      collectionOpen: isCollectionOpen(booking, trip),
    },
  };
}
