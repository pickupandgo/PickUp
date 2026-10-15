import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { CustomerStopState, GatePaymentState, GateStage } from './payment-gate';
import {
  ENGINE_STOP_STATUSES,
  type EngineStopStatus,
  STOP_RESOLUTIONS,
  type StopResolution,
} from './stop-lifecycle';
import { ENGINE_TRIP_STATUSES, type EngineTripStatus } from './trip-lifecycle';

/**
 * Every booking payment method the database knows. PREPAID_UPI exists only on historical
 * bookings: it passes validation so a new registration gets the explicit
 * PAYMENT_METHOD_NOT_OFFERED answer instead of a generic validation error.
 */
const PAYMENT_METHODS = ['PREPAID_UPI', 'PAY_AT_PICKUP', 'PAY_AT_DELIVERY'] as const;
type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

/** The only payment methods new bookings can use. */
export const OFFERED_PAYMENT_METHODS = ['PAY_AT_PICKUP', 'PAY_AT_DELIVERY'] as const;
export type OfferedPaymentMethod = (typeof OFFERED_PAYMENT_METHODS)[number];

export function isOfferedPaymentMethod(method: string): method is OfferedPaymentMethod {
  return (OFFERED_PAYMENT_METHODS as readonly string[]).includes(method);
}

export const EXTERNAL_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;
/** Firebase UIDs: up to 128 URL-safe characters. */
export const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Sent by the trip engine when the customer confirms a booking. There is no amount here: every
 * amount (fare, tax, per-drop amounts, platform fee) comes from the quote, and any amount field
 * sent anyway is rejected like any unknown field.
 */
export class RegisterBookingRequest {
  /** The engine's own booking id. Registering the same ref again returns the same booking. */
  @Matches(EXTERNAL_REF_PATTERN, { message: 'externalRef is invalid' })
  externalRef!: string;

  /** Firebase UID of the customer, from the engine's verified sign-in (never the request body). */
  @Matches(SUBJECT_PATTERN, { message: 'customerSubject is invalid' })
  customerSubject!: string;

  /** The fare quote the customer confirmed (POST /v1/fare/quotes). Redeemed exactly once. */
  @IsUUID('4', { message: 'quoteId must be a UUID' })
  quoteId!: string;

  /** PAY_AT_PICKUP or PAY_AT_DELIVERY. PREPAID_UPI is refused (PAYMENT_METHOD_NOT_OFFERED). */
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethodValue;
}

export class AssignDriverRequest {
  /** Firebase UID of the assigned driver. */
  @Matches(SUBJECT_PATTERN, { message: 'driverSubject is invalid' })
  driverSubject!: string;
}

export class TripStatusRequest {
  /** PAYMENT_CONFIRMED is set by this backend when the payment is verified, never by the engine. */
  @IsIn(ENGINE_TRIP_STATUSES)
  status!: EngineTripStatus;
}

export class CancelBookingRequest {
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason!: string;
}

/** A drop of a booking priced per drop, reported by the trip engine. */
export class StopStatusRequest {
  /**
   * ARRIVED (reached; also the retry of a failed attempt), DELIVERED or DELIVERY_FAILED.
   * PAYMENT_CONFIRMED is set by this backend when the drop is paid, never by the engine.
   */
  @IsIn(ENGINE_STOP_STATUSES)
  status!: EngineStopStatus;

  /** Why the delivery failed (3-200 characters). Required for DELIVERY_FAILED, refused otherwise. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason?: string;
}

/** An admin's decision on a failed delivery attempt. */
export class ResolveStopRequest {
  /** RETRY: the drop is attempted again. UNDELIVERED: the drop is closed without delivery. */
  @IsIn(STOP_RESOLUTIONS)
  resolution!: StopResolution;

  /** Why (3-200 characters). Stored on the drop and in the audit trail. */
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason!: string;
}

export class ListTripsQuery {
  /** "true" to list only trips that are still running. */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class TripResponse {
  tripId!: string;
  bookingId!: string;
  driverId!: string;
  status!: string;
  assignedAt!: string;
  arrivedAt!: string | null;
  pickupVerifiedAt!: string | null;
  startedAt!: string | null;
  deliveredAt!: string | null;
  paymentConfirmedAt!: string | null;
  completedAt!: string | null;
  cancelledAt!: string | null;
}

export class BookingStopView {
  sequence!: number;
  /** What is collected for this drop when the receivers pay. */
  payablePaise!: number;
  status!: string;
}

/**
 * What must be paid at the handover point the trip is at now, and whether the goods may be
 * handed over (pickup OTP / drop OTP). Derived on every read; the backend enforces it.
 */
export class PaymentGateView {
  /** PICKUP, DROP, or null when nothing is owed anywhere now. */
  stage!: GateStage | null;
  /** The drop concerned (bookings priced per drop). */
  stopSequence!: number | null;
  paymentState!: GatePaymentState;
  /** What is owed at this point, in paise. */
  amountPaise!: number | null;
  /** The platform fee debited from the driver's wallet if this is paid in cash. */
  cashFeePaise!: number | null;
  /** True when the goods may be handed over now. */
  handoverAllowed!: boolean;
  /** The collection behind paymentState (open, completed, or the last failed one). */
  collectionId!: string | null;
  /** Why the last collection attempt failed. */
  lastFailure!: string | null;
}

/** The customer's view of the payment gate: no ids, no fee. */
export class CustomerPaymentGateView {
  stage!: GateStage | null;
  stopSequence!: number | null;
  paymentState!: GatePaymentState;
  amountPaise!: number | null;
  handoverAllowed!: boolean;
}

export class DriverStopView {
  sequence!: number;
  payablePaise!: number;
  status!: string;
  /** What is owed for this drop is paid (the booking at pickup, or the drop itself). */
  paid!: boolean;
}

export class CustomerStopView {
  sequence!: number;
  payablePaise!: number;
  state!: CustomerStopState;
}

/** A drop with every lifecycle fact, for admins. */
export class AdminBookingStopView {
  stopId!: string;
  sequence!: number;
  status!: string;
  payablePaise!: number;
  platformFeeSharePaise!: number;
  arrivedAt!: string | null;
  paymentConfirmedAt!: string | null;
  deliveredAt!: string | null;
  failedAt!: string | null;
  failureReason!: string | null;
  cancelledAt!: string | null;
  resolvedAt!: string | null;
  resolvedByUserId!: string | null;
  resolutionReason!: string | null;
}

export class AdminStopResolutionResponse {
  bookingId!: string;
  bookingStatus!: string;
  paymentStatus!: string;
  tripStatus!: string | null;
  /** False when the drop was already in the requested state (repeat). */
  changed!: boolean;
  stop!: AdminBookingStopView;
}

export class InternalBookingResponse {
  bookingId!: string;
  externalRef!: string;
  status!: string;
  paymentMethod!: PaymentMethodValue;
  paymentStatus!: string;
  /**
   * How the booking was paid once PAID or PARTIALLY_PAID: PREPAID_ONLINE, CASH or ONLINE_QR, or
   * MIXED for a booking whose drops were paid partly in cash and partly online.
   */
  paidWith!: 'PREPAID_ONLINE' | 'CASH' | 'ONLINE_QR' | 'MIXED' | null;
  /** QUOTE_PER_STOP for every new booking; LEGACY_BOOKING_LEVEL for historical ones. */
  paymentModel!: 'LEGACY_BOOKING_LEVEL' | 'QUOTE_PER_STOP';
  /** The redeemed fare quote; null for historical bookings. */
  quoteId!: string | null;
  pricingVersionId!: string | null;
  /** Fare excluding tax, in paise. */
  farePaise!: number;
  /** Tax in paise (0 until a tax rule is approved). */
  taxPaise!: number;
  /** What the customer, or the receivers together, pay: fare + tax. Fixed at confirmation. */
  payablePaise!: number;
  /** Platform fee under the rule pinned at confirmation (frozen for QUOTE_PER_STOP). */
  platformFeePaise!: number;
  /** One per drop, in delivery order. Empty for historical bookings. */
  stops!: BookingStopView[];
  /** Read before the pickup OTP and before every drop OTP. */
  paymentGate!: PaymentGateView;
  vehicleCategory!: string | null;
  feeRuleId!: string;
  confirmedAt!: string;
  completedAt!: string | null;
  cancelledAt!: string | null;
  cancellationReason!: string | null;
  trip!: TripResponse | null;
}

export class CustomerBookingResponse {
  bookingId!: string;
  externalRef!: string;
  status!: string;
  paymentMethod!: PaymentMethodValue;
  paymentStatus!: string;
  /** Amount payable, in paise. Fixed at confirmation. */
  farePaise!: number;
  confirmedAt!: string;
  tripStatus!: string | null;
  /** One per drop, in delivery order. Empty for historical bookings. */
  stops!: CustomerStopView[];
  paymentGate!: CustomerPaymentGateView;
}

export class TripPaymentView {
  method!: PaymentMethodValue;
  status!: string;
  farePaise!: number;
  /** Platform fee under the rule pinned at confirmation. */
  platformFeePaise!: number;
  /** What the driver earns on this trip (fare minus platform fee). */
  driverSharePaise!: number;
  /** PICKUP or DELIVERY for pay-at-pickup / pay-at-delivery bookings, else null. */
  collectionStage!: 'PICKUP' | 'DELIVERY' | null;
  /** True when the driver can record cash or show a QR right now. */
  collectionOpen!: boolean;
  /** Whether the goods may be handed over now, and what is owed first. */
  paymentGate!: PaymentGateView;
  /** One per drop, in delivery order. Empty for historical bookings. */
  stops!: DriverStopView[];
}

export class DriverTripResponse {
  tripId!: string;
  bookingId!: string;
  externalRef!: string;
  status!: string;
  assignedAt!: string;
  completedAt!: string | null;
  payment!: TripPaymentView;
}
