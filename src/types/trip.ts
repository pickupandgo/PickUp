/**
 * Trip-related type definitions.
 */

export type TripStatus =
  | 'offered'
  | 'accepted'
  | 'en_route_pickup'
  | 'arrived_pickup'
  | 'pickup_verified'
  | 'in_transit'
  | 'arrived_drop'
  | 'drop_verified'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type StopType = 'pickup' | 'drop' | 'drop_final';

export type StopStatus = 'pending' | 'current' | 'completed';

export type LoadType =
  | 'box_parcel'
  | 'furniture'
  | 'electronics'
  | 'documents'
  | 'food'
  | 'other';

export type CancellationReason =
  | 'vehicle_breakdown'
  | 'customer_unavailable'
  | 'wrong_address'
  | 'safety_concern'
  | 'other';

export interface TripStop {
  readonly id: string;
  readonly type: StopType;
  readonly label: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly status: StopStatus;
  readonly etaMinutes?: number;
  readonly distanceKm?: number;
  readonly notes?: string;
  readonly requiresSignature?: boolean;
  readonly requiresPhoto?: boolean;
  readonly requiresOtp?: boolean;
  /** Engine trips only (drops): the drop's position in the trip, from 1. */
  readonly sequence?: number;
  /**
   * Engine trips only (drops): the engine's drop status (PENDING, IN_TRANSIT, ARRIVED,
   * DELIVERED, DELIVERY_FAILED, UNDELIVERED, CANCELLED). Authoritative for what the driver can do.
   */
  readonly engineStatus?: string;
  /** What this drop's receiver pays at delivery: display copy, the payment backend decides. */
  readonly payablePaise?: number;
  /** The engine accepted this drop's OTP: the delivery photo is next. */
  readonly otpVerified?: boolean;
  /** Why the last delivery attempt failed. */
  readonly failureReason?: string;
}

export interface TripOffer {
  readonly id: string;
  readonly estimatedEarning: number;
  readonly currency: string;
  readonly pickupStop: TripStop;
  readonly dropStops: readonly TripStop[];
  readonly totalDistanceKm: number;
  readonly loadType: LoadType;
  readonly vehicleType: string;
  readonly expiresAt: number;
  readonly demandLevel?: 'low' | 'medium' | 'high';
}

export interface ActiveTrip {
  readonly id: string;
  readonly status: TripStatus;
  readonly stops: readonly TripStop[];
  readonly currentStopIndex: number;
  readonly estimatedEarning: number;
  readonly currency: string;
  readonly totalDistanceKm: number;
  readonly loadType: LoadType;
  readonly goodsType: string;
  readonly vehicleId: string;
  readonly vehicleRegistration: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
  /**
   * Engine trips only: the engine's trip status (DRIVER_ASSIGNED ... COMPLETED, CANCELLED).
   * Authoritative; `status` is its display mapping.
   */
  readonly engineStatus?: string;
  /** The engine ride (booking) this trip was created for. */
  readonly rideId?: string;
  /** The payment backend's trip id: null until the backend confirmed the assignment. */
  readonly paymentTripId?: string | null;
  /** The booking reference shared with the payment backend. */
  readonly externalRef?: string;
  /** PAY_AT_PICKUP, PAY_AT_DELIVERY or PREPAID_UPI. */
  readonly paymentMethod?: string;
  /** Display copy of the booking's payable amount; the payment backend decides what is owed. */
  readonly payablePaise?: number;
  readonly totalStops?: number;
  readonly completedStops?: number;
  readonly remainingStops?: number;
  /** When the engine last changed the trip (epoch ms): an older answer never replaces a newer one. */
  readonly updatedAt?: number;
}

export interface TripEarnings {
  readonly tripId: string;
  readonly grossEarning: number;
  readonly platformCommission: number;
  readonly platformCommissionPercent: number;
  readonly otherDeductions: number;
  readonly netEarning: number;
  readonly currency: string;
  readonly paidToWallet: boolean;
}

export interface HistoricalTrip {
  readonly id: string;
  readonly date: string;
  readonly time: string;
  readonly status: TripStatus;
  readonly stops: readonly TripStop[];
  readonly loadType: LoadType;
  readonly goodsType: string;
  readonly totalWeight: string;
  readonly vehicleType: string;
  readonly vehicleRegistration: string;
  readonly earnings: TripEarnings;
}

export interface CancellationRequest {
  readonly tripId: string;
  readonly reason: CancellationReason;
  readonly details?: string;
}
