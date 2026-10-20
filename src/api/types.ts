/**
 * Wire types for Pickup-Go-Core-Engine and MultiRide Payments Backend.
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

export interface FareQuoteBreakdown {
  readonly basePaise: number;
  readonly distancePaise: number;
  readonly weightPaise: number;
  readonly stopsPaise: number;
  readonly vehicleMultiplier: number;
}

export interface FareQuoteStop {
  readonly sequence: number;
  readonly location: GeoPoint;
  readonly distanceKm: number;
  readonly payablePaise: number;
}

export interface FareQuote {
  readonly quoteId: string;
  readonly pricingVersion: string;
  readonly vehicleCategory: string;
  readonly weightKg: number;
  readonly totalDistanceKm: number;
  readonly totalDurationMin: number;
  readonly totalFarePaise: number;
  readonly pickup: GeoPoint;
  readonly stops: readonly FareQuoteStop[];
  readonly breakdown: FareQuoteBreakdown;
  readonly expiresAt: string;
  readonly redeemed: boolean;
}

// ─── Payment Methods ─────────────────────────────────────────────────────────

export type PaymentMethod =
  | 'PAY_AT_PICKUP'
  | 'PAY_AT_DELIVERY'
  | 'COD'
  | 'ONLINE'
  | string;

// ─── Rides ───────────────────────────────────────────────────────────────────

export type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface DropDetailInput {
  readonly receiver?: { readonly name?: string; readonly phone?: string };
}

export interface RideDrop {
  readonly sequence?: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
  readonly receiver?: { readonly name?: string; readonly phone?: string };
  readonly payablePaise?: number;
}

export interface Ride {
  readonly id: string;
  readonly status: RideStatus;
  readonly bookingStatus?: string;
  readonly requestedDriverId?: string | null;
  readonly assignedDriverId?: string | null;
  readonly externalRef?: string;
  readonly quoteId?: string;
  readonly paymentBookingId?: string | null;
  readonly paymentMethod?: PaymentMethod;
  readonly registrationError?: string | null;
  readonly fare?: number;
  readonly payablePaise?: number;
  readonly currency?: string;
  readonly weight?: number;
  readonly otp?: string;
  readonly pickup?: GeoPoint;
  readonly drop?: GeoPoint | RideDrop | null;
  readonly drops?: readonly (GeoPoint | RideDrop)[];
  readonly stopOtps?: readonly string[];
  readonly vehicleType?: string;
  readonly totalDistanceKm?: number;
  readonly tripId?: string | null;
  readonly paymentTripId?: string | null;
  readonly tripStatus?: TripStatus | null;
  readonly cancellationReason?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface CreateRideInput {
  readonly customerId?: string;
  readonly driverId?: string;
  readonly quoteId?: string;
  readonly paymentMethod?: PaymentMethod;
  readonly pickup: GeoPoint;
  readonly drop?: GeoPoint | RideDrop;
  readonly drops?: readonly (GeoPoint | RideDrop)[];
  readonly vehicleType?: string;
  readonly weight?: number;
  readonly fare?: number;
}

// ─── OTPs ────────────────────────────────────────────────────────────────────

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

export interface Trip {
  readonly id: string;
  readonly rideId: string;
  readonly bookingId?: string;
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
  readonly fare?: number;
  readonly payablePaise?: number;
  readonly totalDistanceKm?: number;
  readonly otp?: string;
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

export interface CustomerAccount {
  readonly customerId: string;
  readonly phone: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface RazorpayCheckoutParams {
  readonly keyId: string;
  readonly orderId: string;
  readonly amountPaise: number;
  readonly currency: 'INR';
}

export interface BookingPayment {
  readonly paymentId: string;
  readonly bookingId: string;
  readonly status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';
  readonly amountPaise: number;
  readonly currency: 'INR';
  readonly checkout: RazorpayCheckoutParams | null;
  readonly providerPaymentId: string | null;
  readonly paymentMethod: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BookingPaymentState {
  readonly booking: CustomerBooking;
  readonly payment: BookingPayment | null;
}

export interface VerifyBookingPaymentResult {
  readonly booking: CustomerBooking;
  readonly payment: BookingPayment;
  readonly providerStatus: string;
}

