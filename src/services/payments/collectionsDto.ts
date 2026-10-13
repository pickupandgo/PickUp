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
  | 'PAID'
  | 'REFUND_PENDING'
  | 'REFUNDED';
export type CollectionStageDto = 'PICKUP' | 'DELIVERY';
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
}

const PAYMENT_METHODS: readonly BookingPaymentMethodDto[] = [
  'PREPAID_UPI',
  'PAY_AT_PICKUP',
  'PAY_AT_DELIVERY',
];
const PAYMENT_STATUSES: readonly BookingPaymentStatusDto[] = [
  'UNPAID',
  'PAID',
  'REFUND_PENDING',
  'REFUNDED',
];
const STAGES: readonly CollectionStageDto[] = ['PICKUP', 'DELIVERY'];
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
  };
}
