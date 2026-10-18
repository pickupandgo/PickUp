import type {
  EngineBooking,
  EngineStop,
  EngineTrip,
} from '../generated/prisma/client';
import { FINAL_STOP_STATUSES } from './trip-progress';

export interface TripBundle {
  readonly trip: EngineTrip;
  readonly booking: EngineBooking;
  /** In delivery order. */
  readonly stops: readonly EngineStop[];
}

export const paiseToRupees = (paise: bigint): number => Number(paise) / 100;
export const metersToKm = (meters: number): number =>
  Math.round(meters / 100) / 10;

/** A drop without its OTP: safe for the customer and the driver. */
export function stopView(stop: EngineStop) {
  return {
    id: stop.id,
    sequence: stop.sequence,
    location: {
      latitude: stop.latitude,
      longitude: stop.longitude,
      address: stop.address ?? undefined,
    },
    receiver:
      stop.receiverName || stop.receiverPhone
        ? {
            name: stop.receiverName ?? undefined,
            phone: stop.receiverPhone ?? undefined,
          }
        : undefined,
    status: stop.status,
    distanceFromPreviousStopKm: metersToKm(stop.distanceMeters),
    /** What this drop's receiver pays at delivery (display copy of the payment backend quote). */
    fareFromPreviousStop: paiseToRupees(stop.payablePaise),
    payablePaise: Number(stop.payablePaise),
    arrivedAt: stop.arrivedAt?.toISOString(),
    deliveredAt: stop.deliveredAt?.toISOString(),
    failedAt: stop.failedAt?.toISOString(),
    failureReason: stop.failureReason ?? undefined,
    otpVerified: stop.otpVerified,
    deliveryProof: stop.proofUri
      ? {
          type: 'PHOTO' as const,
          uri: stop.proofUri,
          submittedAt: stop.proofSubmittedAt?.toISOString(),
        }
      : undefined,
    // otp intentionally omitted: the receiver tells the driver at the drop
  };
}

/**
 * The trip as the apps read it (the prototype's sanitized shape), with the stable ids the apps
 * need for the payment backend: paymentBookingId (customer) and paymentTripId (driver).
 */
export function tripView({ trip, booking, stops }: TripBundle) {
  const sanitizedStops = stops.map(stopView);
  const finished =
    trip.status === 'DELIVERED' ||
    trip.status === 'COMPLETED' ||
    trip.status === 'CANCELLED';
  const currentStop = finished
    ? null
    : (sanitizedStops[trip.currentStopIndex] ?? null);
  const completedStops = stops.filter(
    (stop) => stop.status === 'DELIVERED',
  ).length;
  const remainingStops = stops.filter(
    (stop) => !FINAL_STOP_STATUSES.has(stop.status),
  ).length;
  const heading = currentStop ?? sanitizedStops[0] ?? null;
  return {
    id: trip.id,
    rideId: booking.id,
    customerId: booking.customerSubject,
    driverId: trip.driverSubject,
    externalRef: booking.externalRef,
    paymentBookingId: booking.paymentBookingId,
    paymentTripId: trip.paymentTripId,
    paymentMethod: booking.paymentMethod,
    pickup: {
      latitude: booking.pickupLatitude,
      longitude: booking.pickupLongitude,
      address: booking.pickupAddress ?? undefined,
    },
    drop: heading?.location ?? null,
    stops: sanitizedStops,
    currentStopIndex: trip.currentStopIndex,
    currentStop,
    totalStops: stops.length,
    completedStops,
    remainingStops,
    status: trip.status,
    weight: booking.weightGrams / 1000,
    vehicleType: booking.vehicleCategory,
    /** INR, display copy of the payment backend quote (payablePaise is authoritative there). */
    fare: paiseToRupees(booking.payablePaise),
    payablePaise: Number(booking.payablePaise),
    totalDistanceKm: metersToKm(booking.distanceMeters),
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    arrivedAt: trip.arrivedAt?.toISOString(),
    pickupVerifiedAt: trip.pickupVerifiedAt?.toISOString(),
    startedAt: trip.startedAt?.toISOString(),
    deliveredAt: trip.deliveredAt?.toISOString(),
    completionRequestedAt: trip.completionRequestedAt?.toISOString(),
    completedAt: trip.completedAt?.toISOString(),
    cancelledAt: trip.cancelledAt?.toISOString(),
    cancelledBy: trip.cancelledBy ?? undefined,
    cancellationReason: trip.cancellationReason ?? undefined,
    // otp intentionally omitted: the customer shows it to the driver (GET /rides/:id/otps)
  };
}

export type TripView = ReturnType<typeof tripView>;
