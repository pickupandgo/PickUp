import type {
  EngineBooking,
  EngineOffer,
  EngineStop,
  EngineTrip,
} from '../generated/prisma/client';
import { metersToKm, paiseToRupees, stopView } from '../trips/trip-views';
import type { RideStatus } from './rides.types';

export interface RideBundle {
  readonly booking: EngineBooking;
  readonly stops: readonly EngineStop[];
  /** Newest first. */
  readonly offers: readonly EngineOffer[];
  /** The live trip (not cancelled), else the newest one, if any. */
  readonly trip: EngineTrip | null;
}

/** An offer past its deadline is expired, whether or not a sweep marked it yet. */
export function effectiveOfferStatus(
  offer: EngineOffer,
  now: Date,
): EngineOffer['status'] {
  return offer.status === 'REQUESTED' &&
    offer.expiresAt.getTime() <= now.getTime()
    ? 'EXPIRED'
    : offer.status;
}

export function rideStatus(bundle: RideBundle, now: Date): RideStatus {
  switch (bundle.booking.status) {
    case 'PENDING_REGISTRATION':
      return 'PENDING_REGISTRATION';
    case 'REGISTRATION_FAILED':
      return 'REGISTRATION_FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'ASSIGNED':
    case 'COMPLETED':
      return 'ACCEPTED';
    case 'OPEN': {
      const latest = bundle.offers[0];
      return latest && effectiveOfferStatus(latest, now) === 'REQUESTED'
        ? 'REQUESTED'
        : bundle.booking.searchExhaustedAt
          ? 'REJECTED'
          : 'REQUESTED';
    }
  }
}

/** The customer's view of a ride: no OTPs (GET /rides/:id/otps, gated by payment). */
export function rideView(bundle: RideBundle, now: Date) {
  const { booking, stops, offers, trip } = bundle;
  const latest = offers[0] ?? null;
  const liveTrip = trip && trip.status !== 'CANCELLED' ? trip : null;
  const drops = stops.map((stop) => {
    const view = stopView(stop);
    return {
      sequence: view.sequence,
      latitude: view.location.latitude,
      longitude: view.location.longitude,
      address: view.location.address,
      receiver: view.receiver,
      instructions: view.instructions,
      payablePaise: view.payablePaise,
    };
  });
  return {
    id: booking.id,
    status: rideStatus(bundle, now),
    bookingStatus: booking.status,
    searchStatus:
      booking.status !== 'OPEN'
        ? null
        : booking.searchExhaustedAt
          ? 'EXHAUSTED'
          : latest && effectiveOfferStatus(latest, now) === 'REQUESTED'
            ? 'OFFERED'
            : 'SEARCHING',
    offerStatus: latest ? effectiveOfferStatus(latest, now) : null,
    offerExpiresAt: latest?.expiresAt.toISOString() ?? null,
    requestedDriverId: latest?.driverSubject ?? null,
    assignedDriverId: liveTrip?.driverSubject ?? null,
    externalRef: booking.externalRef,
    quoteId: booking.quoteId,
    paymentBookingId: booking.paymentBookingId,
    paymentMethod: booking.paymentMethod,
    metadata: booking.metadata ?? undefined,
    registrationError: booking.registrationError,
    /** INR, display copy of the payment backend quote. */
    fare: paiseToRupees(booking.payablePaise),
    payablePaise: Number(booking.payablePaise),
    currency: 'INR' as const,
    weight: booking.weightGrams / 1000,
    vehicleType: booking.vehicleCategory,
    totalDistanceKm: metersToKm(booking.distanceMeters),
    pickup: {
      latitude: booking.pickupLatitude,
      longitude: booking.pickupLongitude,
      address: booking.pickupAddress ?? undefined,
    },
    drop: drops[0] ?? null,
    drops,
    tripId: liveTrip?.id ?? null,
    paymentTripId: liveTrip?.paymentTripId ?? null,
    tripStatus: liveTrip?.status ?? null,
    cancellationReason: booking.cancellationReason,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

/** A pending offer as the driver's app lists it (no OTPs, no customer identity). */
export function offerView(
  booking: EngineBooking,
  stops: readonly EngineStop[],
  offer: EngineOffer,
) {
  const drops = stops.map((stop) => {
    const view = stopView(stop);
    return {
      latitude: view.location.latitude,
      longitude: view.location.longitude,
      address: view.location.address,
      receiver: view.receiver,
      instructions: view.instructions,
    };
  });
  return {
    rideId: booking.id,
    offerId: offer.id,
    pickup: {
      latitude: booking.pickupLatitude,
      longitude: booking.pickupLongitude,
      address: booking.pickupAddress ?? undefined,
    },
    drop: drops[0] ?? null,
    drops,
    vehicleType: booking.vehicleCategory,
    weight: booking.weightGrams / 1000,
    fare: paiseToRupees(booking.payablePaise),
    payablePaise: Number(booking.payablePaise),
    paymentMethod: booking.paymentMethod,
    metadata: booking.metadata ?? undefined,
    status: offer.status,
    createdAt: offer.createdAt.toISOString(),
    expiresAt: offer.expiresAt.toISOString(),
  };
}
