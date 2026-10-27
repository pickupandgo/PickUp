/**
 * Wire types for the Pickup-Go trip engine and the payments backend (Phase 8 contract).
 * Mirrored from the servers' own definitions:
 *   engine  src/rides/{rides.types,ride-views}.ts, src/trips/trip-views.ts
 *   backend src/fare/fare.dto.ts, src/bookings/bookings.dto.ts
 *
 * The client is never authoritative for money: it sends a server fare quote id and a payment
 * method, never an amount, a payment status or a confirmation. No ride or trip ever carries an
 * OTP; the pickup/drop OTPs are read from the gated GET /rides/:id/otps.
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
  readonly bearingDegrees?: number;
}

export interface NearbyDriver extends Driver {
  readonly distanceKm: number;
  readonly etaMinutes?: number;
}

// ─── Fare quote (payments backend: POST /v1/fare/quotes) ──────────────────────

/** Exactly two payment methods (review H): PAY_AT_PICKUP or PAY_AT_DELIVERY. */
export type PaymentMethod = 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';

export interface FareQuoteDrop {
  readonly sequence: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly distanceMeters: number;
  readonly farePaise: number;
  readonly taxPaise: number;
  /** What this drop's receiver pays when the receivers pay. */
  readonly payablePaise: number;
}

/**
 * A server-priced route, valid until `expiresAt`. The server owns every amount; the app shows
 * it and books with `quoteId`. Any change to route, vehicle or weight needs a fresh quote.
 */
export interface FareQuote {
  readonly quoteId: string;
  readonly vehicleCategory: string;
  readonly weightKg: number;
  readonly pickup: { readonly latitude: number; readonly longitude: number };
  readonly distanceMeters: number;
  /** Fare excluding taxes, in paise. */
  readonly farePaise: number;
  readonly taxPaise: number;
  /** Total to pay: fare + taxes. The sender pays this at once when the sender pays. */
  readonly payablePaise: number;
  readonly currency: 'INR';
  readonly drops: readonly FareQuoteDrop[];
  /** Book before this instant, or ask for a new quote. */
  readonly expiresAt: string;
  /** True once a booking was registered from this quote. */
  readonly redeemed: boolean;
  readonly createdAt: string;
}

// ─── Rides (engine: POST /rides, GET /rides/:id) ──────────────────────────────

export type RideStatus =
  | 'PENDING_REGISTRATION'
  | 'REGISTRATION_FAILED'
  | 'REQUESTED'
  | 'REJECTED'
  | 'ACCEPTED'
  | 'CANCELLED';

/** A drop as the customer books it: who receives it and (optionally) the address label. */
export interface DropDetailInput {
  readonly address?: string;
  readonly receiver?: { readonly name?: string; readonly phone?: string };
}

/**
 * POST /rides. The route, vehicle, weight and fare all come from the quote; the customer is the
 * signed-in user (the token), never a body field. `driverId` names the driver to offer it to
 * (the prototype dispatches to a chosen driver). No amount is ever sent.
 */
export interface CreateRideInput {
  readonly driverId: string;
  readonly quoteId: string;
  readonly paymentMethod: PaymentMethod;
  /** Optional address label for the pickup; coordinates come from the quote. */
  readonly pickup?: { readonly address?: string };
  /** Receiver details per drop, in the quote's order. Coordinates come from the quote. */
  readonly drops?: readonly DropDetailInput[];
}

export interface RideDrop {
  readonly sequence?: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
  readonly receiver?: { readonly name?: string; readonly phone?: string };
  readonly payablePaise?: number;
}

/** The customer's view of a ride (engine rideView). No OTP: see RideOtps. */
export interface Ride {
  readonly id: string;
  readonly status: RideStatus;
  readonly bookingStatus?: string;
  readonly requestedDriverId?: string | null;
  readonly assignedDriverId?: string | null;
  readonly externalRef?: string;
  readonly quoteId?: string;
  /** The payments backend's booking id: use it for the payment/gate views. */
  readonly paymentBookingId?: string | null;
  readonly paymentMethod?: PaymentMethod;
  readonly registrationError?: string | null;
  /** INR, display copy of the backend quote. Never authoritative. */
  readonly fare?: number;
  readonly payablePaise?: number;
  readonly currency?: string;
  readonly weight?: number;
  readonly vehicleType?: string;
  readonly totalDistanceKm?: number;
  readonly pickup?: GeoPoint;
  readonly drop?: RideDrop | null;
  readonly drops?: readonly RideDrop[];
  /** The engine trip id once a driver accepts, or null while still searching. */
  readonly tripId?: string | null;
  readonly paymentTripId?: string | null;
  readonly tripStatus?: TripStatus | null;
  readonly cancellationReason?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

/**
 * The handover OTPs (engine: GET /rides/:id/otps). The code is withheld (null, with a reason)
 * until the payment backend allows that handover. The customer reads the shown code to the
 * driver; it is never available before authorization.
 */
export type OtpWithholdReason = 'PAYMENT_REQUIRED' | 'FINISHED' | 'CLOSED';

export interface RideOtps {
  readonly rideId: string;
  readonly paymentMethod: PaymentMethod;
  readonly paymentStatus: string;
  readonly pickup: {
    readonly otp: string | null;
    readonly withheld: OtpWithholdReason | null;
  };
  readonly stops: readonly {
    readonly sequence: number;
    readonly otp: string | null;
    readonly withheld: OtpWithholdReason | null;
  }[];
}

// ─── Trips (engine: GET /trips/:id) ───────────────────────────────────────────

export type TripStatus =
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'PICKUP_VERIFIED'
  | 'IN_TRANSIT'
  | 'DROP_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type StopStatus =
  | 'PENDING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'UNDELIVERED'
  | 'CANCELLED';

export interface StopReceiver {
  readonly name?: string;
  readonly phone?: string;
}

export interface TripStop {
  readonly id: string;
  readonly sequence: number;
  readonly location: GeoPoint;
  readonly receiver?: StopReceiver;
  readonly status: StopStatus;
  readonly otpVerified?: boolean;
  readonly distanceFromPreviousStopKm?: number;
  readonly fareFromPreviousStop?: number;
  readonly payablePaise?: number;
  readonly arrivedAt?: string;
  readonly deliveredAt?: string;
  readonly failedAt?: string;
  readonly failureReason?: string;
}

/** The customer's view of a trip (engine tripView). No OTP. */
export interface Trip {
  readonly id: string;
  readonly rideId: string;
  readonly customerId: string;
  readonly driverId: string;
  readonly externalRef?: string;
  readonly paymentBookingId?: string | null;
  readonly paymentTripId?: string | null;
  readonly paymentMethod?: PaymentMethod;
  readonly pickup: GeoPoint;
  readonly drop: GeoPoint | null;
  readonly stops: readonly TripStop[];
  readonly currentStopIndex: number;
  readonly currentStop?: TripStop | null;
  readonly totalStops?: number;
  readonly completedStops?: number;
  readonly remainingStops?: number;
  readonly status: TripStatus;
  readonly weight?: number;
  /** INR, display copy of the backend quote. Never authoritative. */
  readonly fare?: number;
  readonly payablePaise?: number;
  readonly totalDistanceKm?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly arrivedAt?: string;
  readonly pickupVerifiedAt?: string;
  readonly startedAt?: string;
  readonly deliveredAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly cancelledBy?: 'CUSTOMER' | 'DRIVER' | 'SYSTEM';
  readonly cancellationReason?: string;
}

/** Trip states after which no further progress is expected. */
export const TERMINAL_TRIP_STATUSES: readonly TripStatus[] = ['COMPLETED', 'CANCELLED'];

export const isTripTerminal = (status: TripStatus): boolean =>
  TERMINAL_TRIP_STATUSES.includes(status);

// ─── Payment state (payments backend: GET /v1/bookings/:id) ───────────────────

export type BookingPaymentStatus =
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type GateStage = 'PICKUP' | 'DROP';

export type GatePaymentState =
  | 'NOT_REQUIRED'
  | 'NOT_YET'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CONFIRMED';

/** The customer's view of the payment gate: no ids, no fee. */
export interface CustomerPaymentGate {
  readonly stage: GateStage | null;
  readonly stopSequence: number | null;
  readonly paymentState: GatePaymentState;
  readonly amountPaise: number | null;
  readonly handoverAllowed: boolean;
}

export type CustomerStopState =
  | 'UPCOMING'
  | 'ARRIVED'
  | 'PAID'
  | 'DELIVERED'
  | 'NOT_DELIVERED'
  | 'CANCELLED';

export interface CustomerBookingStop {
  readonly sequence: number;
  readonly payablePaise: number;
  readonly state: CustomerStopState;
}

/** The signed-in customer's booking payment view (backend). The source of truth for money. */
export interface CustomerBooking {
  readonly bookingId: string;
  readonly externalRef: string;
  readonly status: string;
  readonly paymentMethod: PaymentMethod | 'PREPAID_UPI';
  readonly paymentStatus: BookingPaymentStatus;
  readonly farePaise: number;
  readonly confirmedAt: string;
  readonly tripStatus: TripStatus | null;
  readonly stops: readonly CustomerBookingStop[];
  readonly paymentGate: CustomerPaymentGate;
}

/** The customer's account (backend: POST /v1/customers/me). */
export interface CustomerAccount {
  readonly customerId: string;
  readonly phone: string;
  readonly status: string;
  readonly createdAt: string;
}
