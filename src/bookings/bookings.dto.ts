import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { FEE_CATEGORY_PATTERN } from '../fees/fee-rules';
import { ENGINE_TRIP_STATUSES, type EngineTripStatus } from './trip-lifecycle';

const PAYMENT_METHODS = ['PREPAID_UPI', 'PAY_AT_PICKUP', 'PAY_AT_DELIVERY'] as const;
type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const EXTERNAL_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;
/** Firebase UIDs: up to 128 URL-safe characters. */
export const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Sent by the trip engine when the customer confirms a booking. */
export class RegisterBookingRequest {
  /** The engine's own booking id. Registering the same ref again returns the same booking. */
  @Matches(EXTERNAL_REF_PATTERN, { message: 'externalRef is invalid' })
  externalRef!: string;

  /** Firebase UID of the customer. */
  @Matches(SUBJECT_PATTERN, { message: 'customerSubject is invalid' })
  customerSubject!: string;

  /** Requested vehicle category code, e.g. MINI_TRUCK. Selects category-specific fee rules. */
  @IsOptional()
  @Matches(FEE_CATEGORY_PATTERN, { message: 'vehicleCategory must be an upper-case code' })
  vehicleCategory?: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethodValue;

  /** The fare shown to and confirmed by the customer, in paise. It never changes afterwards. */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  confirmedFarePaise!: number;
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

export class InternalBookingResponse {
  bookingId!: string;
  externalRef!: string;
  status!: string;
  paymentMethod!: PaymentMethodValue;
  paymentStatus!: string;
  /** How the booking was paid once PAID: PREPAID_ONLINE, CASH or ONLINE_QR. */
  paidWith!: 'PREPAID_ONLINE' | 'CASH' | 'ONLINE_QR' | null;
  /** Confirmed fare = amount payable, in paise. */
  farePaise!: number;
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
