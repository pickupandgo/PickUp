import {
  bool,
  invalid,
  list,
  nullableOneOf,
  nullableText,
  nullableTimestamp,
  nullableWholeNumber,
  oneOf,
  record,
  text,
  timestamp,
  UUID_PATTERN,
  wholeNumber,
} from './responseChecks';

/*
 * The driver's trips and pickup/delivery payment collection (raj_backend /v1/trips). The server
 * owns every amount: the fare is fixed at booking, the platform fee comes from the rule pinned
 * then, and the app only confirms the fare it was shown.
 */

export type BookingPaymentMethodDto =
  | 'PREPAID_UPI'
  | 'PAY_AT_PICKUP'
  | 'PAY_AT_DELIVERY';
export type BookingPaymentStatusDto =
  | 'UNPAID'
  /** Some drops of a booking paid drop by drop are paid. */
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';
export type CollectionStageDto = 'PICKUP' | 'DELIVERY';
export type GateStageDto = 'PICKUP' | 'DROP';
export type GatePaymentStateDto =
  /** Nothing is owed at this point. */
  | 'NOT_REQUIRED'
  /** Owed at a later point (before arrival at the pickup, or a drop not reached yet). */
  | 'NOT_YET'
  /** Owed now and not paid; no payment in progress. */
  | 'PAYMENT_REQUIRED'
  /** A QR is open and waiting for the customer or receiver to pay. */
  | 'PAYMENT_PROCESSING'
  /** The last QR expired or was closed unpaid: a new attempt is needed. */
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CONFIRMED';

/**
 * The payment gate (docs/PAYMENT_FLOW_FINAL_REVIEW.md D, E): what must be paid at the handover
 * point the trip is at now, and whether the goods may be handed over. The only source of what
 * the driver can collect and whether an OTP can be entered.
 */
export interface PaymentGateDto {
  readonly stage: GateStageDto | null;
  /** The drop this obligation is for; null for the whole booking. */
  readonly stopSequence: number | null;
  readonly paymentState: GatePaymentStateDto;
  /** What is owed at this point, in paise. */
  readonly amountPaise: number | null;
  /** The platform fee debited from the driver's wallet if this is paid in cash. */
  readonly cashFeePaise: number | null;
  /** The goods may be handed over now (pickup OTP / drop OTP). */
  readonly handoverAllowed: boolean;
  /** The collection behind paymentState (live, completed, or the last failed one). */
  readonly collectionId: string | null;
  /** Why the last collection attempt failed (PAYMENT_FAILED). */
  readonly lastFailure: string | null;
}

/** A drop of the booking, as the payment backend has it. */
export interface TripStopPaymentDto {
  readonly sequence: number;
  readonly payablePaise: number;
  readonly status: string;
  readonly paid: boolean;
}
export type CollectionMethodDto = 'CASH' | 'ONLINE_QR';
/** PENDING: QR shown, not paid yet. FAILED: QR expired or was cancelled. */
export type CollectionStatusDto =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';
export type QrProductDto = 'PAYMENT_LINK' | 'QR_CODE';

export interface TripPaymentDto {
  readonly method: BookingPaymentMethodDto;
  readonly status: BookingPaymentStatusDto;
  /** What the customer pays, fixed at booking. */
  readonly farePaise: number;
  /** Platform fee under the rule pinned at booking. Debited from the wallet for cash trips. */
  readonly platformFeePaise: number;
  /** Fare minus platform fee. */
  readonly driverSharePaise: number;
  /** PICKUP or DELIVERY for pay-at-pickup / pay-at-delivery bookings; null when prepaid. */
  readonly collectionStage: CollectionStageDto | null;
  /** True when the server accepts a cash or QR collection right now. */
  readonly collectionOpen: boolean;
  /** Whether the goods may be handed over now, and what is owed first. */
  readonly paymentGate: PaymentGateDto;
  /** In delivery order; empty for a historical booking. */
  readonly stops: readonly TripStopPaymentDto[];
}

export interface DriverTripDto {
  readonly tripId: string;
  readonly bookingId: string;
  /** The trip engine's booking reference. */
  readonly externalRef: string;
  readonly status: string;
  readonly assignedAt: string;
  readonly completedAt: string | null;
  readonly payment: TripPaymentDto;
}

export interface CollectionQrDto {
  readonly product: QrProductDto;
  /**
   * PAYMENT_LINK: the link to encode as a QR. QR_CODE: the QR image. Null once the QR is paid,
   * expired or cancelled. Always an https Razorpay URL (checked by isRazorpayUrl).
   */
  readonly url: string | null;
  readonly expiresAt: string | null;
}

export interface CollectionDto {
  readonly collectionId: string;
  readonly bookingId: string;
  readonly tripId: string;
  readonly stage: CollectionStageDto;
  readonly method: CollectionMethodDto;
  readonly status: CollectionStatusDto;
  readonly amountPaise: number;
  /** CASH only: the platform fee debited from the driver wallet. */
  readonly platformFeePaise: number | null;
  readonly qr: CollectionQrDto | null;
  /** How the customer paid online (upi, card, ...), once known. */
  readonly paymentMethod: string | null;
  readonly failureReason: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  /** True when this request had already been processed (a retry). */
  readonly replayed: boolean;
  /** The drop this collection pays for; null for the whole booking. */
  readonly stopSequence: number | null;
  /** The booking's payment status as the server recorded it (when the server sent it). */
  readonly bookingPaymentStatus: BookingPaymentStatusDto | null;
  /** The payment gate right after this collection (when the server sent it). */
  readonly paymentGate: PaymentGateDto | null;
}

const PAYMENT_METHODS: readonly BookingPaymentMethodDto[] = [
  'PREPAID_UPI',
  'PAY_AT_PICKUP',
  'PAY_AT_DELIVERY',
];
const PAYMENT_STATUSES: readonly BookingPaymentStatusDto[] = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'REFUND_PENDING',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];
const STAGES: readonly CollectionStageDto[] = ['PICKUP', 'DELIVERY'];
const GATE_STAGES: readonly GateStageDto[] = ['PICKUP', 'DROP'];
const GATE_STATES: readonly GatePaymentStateDto[] = [
  'NOT_REQUIRED',
  'NOT_YET',
  'PAYMENT_REQUIRED',
  'PAYMENT_PROCESSING',
  'PAYMENT_FAILED',
  'PAYMENT_CONFIRMED',
];
const STOP_STATUS_PATTERN = /^[A-Z_]{3,40}$/;
const MAX_STOPS = 25;
export const COLLECTION_METHODS: readonly CollectionMethodDto[] = [
  'CASH',
  'ONLINE_QR',
];
const COLLECTION_STATUSES: readonly CollectionStatusDto[] = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
];
const QR_PRODUCTS: readonly QrProductDto[] = ['PAYMENT_LINK', 'QR_CODE'];
const TRIP_STATUS_PATTERN = /^[A-Z_]{3,40}$/;
const EXTERNAL_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

/**
 * Razorpay payment links and QR images only: https, host rzp.io or (a subdomain of)
 * razorpay.com, no credentials, no port. A customer must never be shown a QR for anything else.
 * Plain pattern matching: React Native's URL class does not implement `hostname`.
 */
const RAZORPAY_URL_PATTERN =
  /^https:\/\/(?:rzp\.io|(?:[a-z0-9-]+\.)*razorpay\.com)(?:[/?#][^\s]*)?$/;

export function isRazorpayUrl(url: string): boolean {
  return url.length <= 2048 && RAZORPAY_URL_PATTERN.test(url);
}

function stopSequenceOf(value: unknown, what: string): number {
  const sequence = wholeNumber(value, what);
  return sequence >= 1 && sequence <= MAX_STOPS ? sequence : invalid(what);
}

function nullableStopSequence(value: unknown, what: string): number | null {
  return value === null ? null : stopSequenceOf(value, what);
}

/** The gate decides OTPs and collections: anything inconsistent is refused, never guessed. */
export function parsePaymentGate(value: unknown): PaymentGateDto {
  const json = record(value, 'payment gate');
  const paymentState = oneOf(json.paymentState, GATE_STATES, 'payment state');
  const amountPaise = nullableWholeNumber(json.amountPaise, 'amount owed');
  const owedNow =
    paymentState === 'PAYMENT_REQUIRED' ||
    paymentState === 'PAYMENT_FAILED' ||
    paymentState === 'PAYMENT_PROCESSING';
  if (owedNow && (amountPaise === null || amountPaise <= 0)) {
    invalid('amount owed');
  }
  const collectionId = nullableText(
    json.collectionId,
    'collection id',
    UUID_PATTERN,
  );
  return {
    stage: nullableOneOf(json.stage, GATE_STAGES, 'gate stage'),
    stopSequence: nullableStopSequence(json.stopSequence, 'gate drop'),
    paymentState,
    amountPaise,
    cashFeePaise: nullableWholeNumber(json.cashFeePaise, 'cash fee'),
    handoverAllowed: bool(json.handoverAllowed, 'handover flag'),
    collectionId,
    lastFailure: nullableText(json.lastFailure, 'last failure'),
  };
}

function parseStopPayment(value: unknown): TripStopPaymentDto {
  const json = record(value, 'drop payment');
  return {
    sequence: stopSequenceOf(json.sequence, 'drop'),
    payablePaise: wholeNumber(json.payablePaise, 'drop amount'),
    status: text(json.status, 'drop status', STOP_STATUS_PATTERN),
    paid: bool(json.paid, 'drop paid flag'),
  };
}

export function parseTrip(value: unknown): DriverTripDto {
  const json = record(value, 'trip');
  const payment = record(json.payment, 'trip payment');
  const farePaise = wholeNumber(payment.farePaise, 'fare');
  const platformFeePaise = wholeNumber(
    payment.platformFeePaise,
    'platform fee',
  );
  const driverSharePaise = wholeNumber(
    payment.driverSharePaise,
    'driver share',
  );
  if (farePaise <= 0 || platformFeePaise + driverSharePaise !== farePaise) {
    invalid('fare split');
  }
  return {
    tripId: text(json.tripId, 'trip id', UUID_PATTERN),
    bookingId: text(json.bookingId, 'booking id', UUID_PATTERN),
    externalRef: text(
      json.externalRef,
      'booking reference',
      EXTERNAL_REF_PATTERN,
    ),
    status: text(json.status, 'trip status', TRIP_STATUS_PATTERN),
    assignedAt: timestamp(json.assignedAt, 'assignment time'),
    completedAt: nullableTimestamp(json.completedAt, 'completion time'),
    payment: {
      method: oneOf(payment.method, PAYMENT_METHODS, 'payment method'),
      status: oneOf(payment.status, PAYMENT_STATUSES, 'payment status'),
      farePaise,
      platformFeePaise,
      driverSharePaise,
      collectionStage: nullableOneOf(
        payment.collectionStage,
        STAGES,
        'collection stage',
      ),
      collectionOpen: bool(payment.collectionOpen, 'collection window'),
      paymentGate: parsePaymentGate(payment.paymentGate),
      stops: list(payment.stops, 'drops').map(parseStopPayment),
    },
  };
}

export function parseTrips(value: unknown): readonly DriverTripDto[] {
  return list(value, 'trips').map(parseTrip);
}

export function parseCollection(value: unknown): CollectionDto {
  const json = record(value, 'collection');
  const method = oneOf(json.method, COLLECTION_METHODS, 'collection method');
  const status = oneOf(json.status, COLLECTION_STATUSES, 'collection status');
  let qr: CollectionQrDto | null = null;
  if (json.qr !== null && json.qr !== undefined) {
    const raw = record(json.qr, 'QR');
    const url = nullableText(raw.url, 'QR link');
    if (url !== null && !isRazorpayUrl(url)) {
      invalid('QR link');
    }
    qr = {
      product: oneOf(raw.product, QR_PRODUCTS, 'QR product'),
      url,
      expiresAt: nullableTimestamp(raw.expiresAt, 'QR expiry'),
    };
  }
  if (method === 'ONLINE_QR' && status === 'PENDING' && !qr?.url) {
    // A pending online collection is only useful with something to show the customer.
    invalid('QR');
  }
  return {
    collectionId: text(json.collectionId, 'collection id', UUID_PATTERN),
    bookingId: text(json.bookingId, 'booking id', UUID_PATTERN),
    tripId: text(json.tripId, 'trip id', UUID_PATTERN),
    stage: oneOf(json.stage, STAGES, 'collection stage'),
    method,
    status,
    amountPaise: wholeNumber(json.amountPaise, 'collection amount'),
    platformFeePaise: nullableWholeNumber(
      json.platformFeePaise,
      'platform fee',
    ),
    qr,
    paymentMethod: nullableText(json.paymentMethod, 'payment method'),
    failureReason: nullableText(json.failureReason, 'failure reason'),
    completedAt: nullableTimestamp(json.completedAt, 'completion time'),
    createdAt: timestamp(json.createdAt, 'creation time'),
    replayed: bool(json.replayed, 'replay flag'),
    // Additive fields (Phase 8): checked when present.
    stopSequence:
      json.stopSequence === undefined
        ? null
        : nullableStopSequence(json.stopSequence, 'collection drop'),
    bookingPaymentStatus:
      json.bookingPaymentStatus === undefined
        ? null
        : oneOf(json.bookingPaymentStatus, PAYMENT_STATUSES, 'payment status'),
    paymentGate:
      json.paymentGate === undefined
        ? null
        : parsePaymentGate(json.paymentGate),
  };
}
