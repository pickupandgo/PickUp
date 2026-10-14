import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
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

export class InternalBookingResponse {
  bookingId!: string;
  externalRef!: string;
  status!: string;
  paymentMethod!: PaymentMethodValue;
  paymentStatus!: string;
  /** How the booking was paid once PAID: PREPAID_ONLINE, CASH or ONLINE_QR. */
  paidWith!: 'PREPAID_ONLINE' | 'CASH' | 'ONLINE_QR' | null;
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
