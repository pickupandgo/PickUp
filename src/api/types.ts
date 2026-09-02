/**
 * Wire types for Pickup-Go-Core-Engine.
 * Mirrored from the backend's own definitions:
 *   src/rides/rides.types.ts, src/trips/trips.types.ts,
 *   src/drivers/drivers.types.ts, src/fare/fare.service.ts
 *
 * Keep this file in sync with the backend. It is the single place the app
 * describes the server contract.
 */

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

export interface Driver {
  readonly id: string;
  readonly name: string;
  readonly vehicleType: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly isAvailable: boolean;
  readonly lastSeen?: number;
}

export interface NearbyDriver extends Driver {
  readonly distanceKm: number;
}

// ─── Fare ────────────────────────────────────────────────────────────────────

export interface FareEstimate {
  readonly fare: number;
  readonly distanceKm: number;
  readonly durationMin: number;
  readonly baseFare: number;
  readonly perKmCharge: number;
  readonly weightMultiplier: number;
  readonly breakdown: {
    readonly base: number;
    readonly distance: number;
    readonly weightSurcharge: number;
  };
}

// ─── Rides ───────────────────────────────────────────────────────────────────

export type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface Ride {
  readonly id: string;
  readonly status: RideStatus;
  readonly requestedDriverId?: string;
  readonly assignedDriverId?: string;
  readonly fare?: number;
  readonly weight?: number;
  /** The engine returns the pickup OTP to the customer, who reads it to the driver. */
  readonly otp?: string;
  readonly pickup?: GeoPoint;
  readonly drop?: GeoPoint;
  readonly vehicleType?: string;
}

export interface CreateRideInput {
  readonly customerId: string;
  /** The engine has no server-side matching: the client names the driver. */
  readonly driverId: string;
  readonly pickup: GeoPoint;
  readonly drop: GeoPoint;
  readonly vehicleType?: string;
  readonly weight?: number;
  readonly fare?: number;
}

// ─── Trips ───────────────────────────────────────────────────────────────────

export type TripStatus =
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'PICKUP_VERIFIED'
  | 'IN_TRANSIT'
  | 'DROP_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Trip {
  readonly id: string;
  readonly rideId: string;
  readonly customerId: string;
  readonly driverId: string;
  readonly pickup: GeoPoint;
  readonly drop: GeoPoint;
  readonly status: TripStatus;
  readonly weight?: number;
  readonly fare?: number;
  readonly otp?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly arrivedAt?: string;
  readonly pickupVerifiedAt?: string;
  readonly startedAt?: string;
  readonly deliveredAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly cancelledBy?: 'CUSTOMER' | 'DRIVER';
  readonly cancellationReason?: string;
}

/** Trip states after which no further progress is expected. */
export const TERMINAL_TRIP_STATUSES: readonly TripStatus[] = ['COMPLETED', 'CANCELLED'];

export const isTripTerminal = (status: TripStatus): boolean =>
  TERMINAL_TRIP_STATUSES.includes(status);
