import type {
  BookingPaymentMethod,
  BookingPaymentModel,
  BookingPaymentStatus,
  BookingStatus,
  BookingStopStatus,
  TripStatus,
} from '../generated/prisma/enums';
import { focusStop, UNDER_WAY_TRIP_STATUSES } from './stop-lifecycle';

/**
 * paymentGate: what must be paid at the handover point the trip is at now, and whether the goods
 * may be handed over (docs/PAYMENT_FLOW_FINAL_REVIEW.md, sections D and E). Derived, never
 * stored: PAYMENT_REQUIRED, PROCESSING, FAILED and HANDOVER_ALLOWED are not statuses of any row.
 * The trip engine and the apps read it; the backend enforces the same rules on every transition.
 */

export type GateStage = 'PICKUP' | 'DROP';

export type GatePaymentState =
  /** Nothing is owed at this point. */
  | 'NOT_REQUIRED'
  /** Owed at a later point (before arrival at the pickup, or a drop not reached yet). */
  | 'NOT_YET'
  /** Owed now and not paid; no payment in progress. */
  | 'PAYMENT_REQUIRED'
  /** A QR is open and waiting for the customer or receiver to pay. */
  | 'PAYMENT_PROCESSING'
  /** The last QR expired or was closed unpaid; a new attempt is needed. */
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CONFIRMED';

/** Driver and trip engine view. */
export interface PaymentGate {
  readonly stage: GateStage | null;
  readonly stopSequence: number | null;
  readonly paymentState: GatePaymentState;
  /** What is owed at this point, in paise. */
  readonly amountPaise: bigint | null;
  /** The platform fee debited from the driver's wallet if this obligation is paid in cash. */
  readonly cashFeePaise: bigint | null;
  /** The goods may be handed over now (pickup OTP / drop OTP). */
  readonly handoverAllowed: boolean;
  /** The collection behind paymentState (live, completed, or the last failed one). */
  readonly collectionId: string | null;
  /** Why the last collection attempt failed (PAYMENT_FAILED). */
  readonly lastFailure: string | null;
}

/** Customer view: no database or provider ids, no fee. */
export interface CustomerPaymentGate {
  readonly stage: GateStage | null;
  readonly stopSequence: number | null;
  readonly paymentState: GatePaymentState;
  readonly amountPaise: bigint | null;
  readonly handoverAllowed: boolean;
}

export interface GateBooking {
  readonly status: BookingStatus;
  readonly paymentMethod: BookingPaymentMethod;
  readonly paymentModel: BookingPaymentModel;
  readonly paymentStatus: BookingPaymentStatus;
  /** The booking's payable amount. */
  readonly finalFareMinor: bigint;
}

export interface GateStop {
  readonly id: string;
  readonly sequence: number;
  readonly status: BookingStopStatus;
  readonly payablePaise: bigint;
  readonly platformFeeSharePaise: bigint;
}

export interface GateCollection {
  readonly id: string;
  /** The drop it is for; null for the whole booking. */
  readonly bookingStopId: string | null;
  readonly status: string;
  readonly failureReason: string | null;
  readonly createdAt: Date;
}

export interface GateInput {
  readonly booking: GateBooking;
  readonly tripStatus: TripStatus | null;
  readonly stops: readonly GateStop[];
  readonly collections: readonly GateCollection[];
  /** The booking's platform fee (frozen, or the historical booking's pinned rule's fee). */
  readonly platformFeePaise: bigint;
}

type GateFields = Pick<PaymentGate, 'paymentState' | 'collectionId' | 'lastFailure'>;

const NOTHING_OWED: PaymentGate = {
  stage: null,
  stopSequence: null,
  paymentState: 'NOT_REQUIRED',
  amountPaise: null,
  cashFeePaise: null,
  handoverAllowed: false,
  collectionId: null,
  lastFailure: null,
};

export function derivePaymentGate(input: GateInput): PaymentGate {
  const { booking, tripStatus } = input;
  if (
    booking.status === 'CANCELLED' ||
    booking.status === 'COMPLETED' ||
    tripStatus === 'CANCELLED' ||
    tripStatus === 'COMPLETED'
  ) {
    return NOTHING_OWED;
  }
  switch (booking.paymentMethod) {
    case 'PAY_AT_PICKUP':
      return pickupGate(input);
    case 'PAY_AT_DELIVERY':
      return booking.paymentModel === 'QUOTE_PER_STOP'
        ? perDropDeliveryGate(input)
        : bookingLevelDeliveryGate(input);
    default:
      return prepaidGate(input);
  }
}

export function toCustomerPaymentGate(gate: PaymentGate): CustomerPaymentGate {
  return {
    stage: gate.stage,
    stopSequence: gate.stopSequence,
    paymentState: gate.paymentState,
    amountPaise: gate.amountPaise,
    handoverAllowed: gate.handoverAllowed,
  };
}

/** Whether what is owed for this drop is paid: the booking at pickup, or the drop itself. */
export function isStopPaid(
  booking: Pick<GateBooking, 'paymentMethod' | 'paymentStatus'>,
  stopId: string,
  collections: readonly Pick<GateCollection, 'bookingStopId' | 'status'>[],
): boolean {
  switch (booking.paymentMethod) {
    case 'PAY_AT_PICKUP':
      return booking.paymentStatus !== 'UNPAID';
    case 'PAY_AT_DELIVERY':
      return collections.some(
        (collection) => collection.bookingStopId === stopId && collection.status === 'COMPLETED',
      );
    default:
      return false;
  }
}

export type CustomerStopState =
  'UPCOMING' | 'ARRIVED' | 'PAID' | 'DELIVERED' | 'NOT_DELIVERED' | 'CANCELLED';

/**
 * A drop as the customer sees it. A failed attempt that may still be retried shows as where the
 * drop stands (ARRIVED, or PAID for a paid pay-at-delivery drop); NOT_DELIVERED only once an
 * admin has resolved it.
 */
export function customerStopState(
  paymentMethod: BookingPaymentMethod,
  status: BookingStopStatus,
  paid: boolean,
): CustomerStopState {
  switch (status) {
    case 'PENDING':
      return 'UPCOMING';
    case 'ARRIVED':
      return 'ARRIVED';
    case 'PAYMENT_CONFIRMED':
      return 'PAID';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'DELIVERY_FAILED':
      return paymentMethod === 'PAY_AT_DELIVERY' && paid ? 'PAID' : 'ARRIVED';
    case 'UNDELIVERED':
      return 'NOT_DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/** PAY_AT_PICKUP: the whole booking is paid at the pickup, before the goods are handed over. */
function pickupGate(input: GateInput): PaymentGate {
  const { booking, tripStatus } = input;
  const atPickup = isAtPickup(tripStatus);
  const arrived = tripStatus === 'DRIVER_ARRIVED';
  const owed = {
    stage: 'PICKUP' as const,
    stopSequence: null,
    amountPaise: booking.finalFareMinor,
    cashFeePaise: input.platformFeePaise,
  };
  const forBooking = bookingLevel(input.collections);

  if (booking.paymentStatus !== 'UNPAID') {
    if (atPickup) {
      return {
        ...owed,
        paymentState: 'PAYMENT_CONFIRMED',
        handoverAllowed: arrived,
        collectionId: completedId(forBooking),
        lastFailure: null,
      };
    }
    return paidDropsGate(input);
  }
  if (atPickup && !arrived) {
    return { ...owed, ...notYet(), handoverAllowed: false };
  }
  // Owed now. At the pickup nothing is handed over until it is paid. A historical trip that
  // passed the pickup unpaid before the gate existed keeps its old (ungated) drops.
  const historicalDrops =
    !atPickup && booking.paymentModel === 'LEGACY_BOOKING_LEVEL' && isUnderWay(tripStatus);
  return { ...owed, ...openState(forBooking), handoverAllowed: historicalDrops };
}

/** PAY_AT_PICKUP after a paid pickup: nothing more is owed, the drops are handed over freely. */
function paidDropsGate(input: GateInput): PaymentGate {
  if (!isUnderWay(input.tripStatus)) {
    return NOTHING_OWED;
  }
  if (input.booking.paymentModel !== 'QUOTE_PER_STOP') {
    return { ...NOTHING_OWED, stage: 'DROP', handoverAllowed: true };
  }
  const focus = focusStop(input.stops);
  return {
    ...NOTHING_OWED,
    stage: 'DROP',
    stopSequence: focus?.sequence ?? null,
    handoverAllowed: focus?.status === 'ARRIVED',
  };
}

/** PAY_AT_DELIVERY priced per drop: each drop is paid when the driver is there, then handed over. */
function perDropDeliveryGate(input: GateInput): PaymentGate {
  const { tripStatus } = input;
  if (isAtPickup(tripStatus)) {
    return pickupWithoutPayment(tripStatus);
  }
  if (tripStatus === 'DELIVERED' || tripStatus === 'PAYMENT_CONFIRMED') {
    return NOTHING_OWED;
  }
  const focus = focusStop(input.stops);
  if (!focus) {
    return NOTHING_OWED;
  }
  const owed = {
    stage: 'DROP' as const,
    stopSequence: focus.sequence,
    amountPaise: focus.payablePaise,
    cashFeePaise: focus.platformFeeSharePaise,
  };
  const forStop = input.collections.filter((collection) => collection.bookingStopId === focus.id);
  const completed = completedId(forStop);
  switch (focus.status) {
    case 'ARRIVED':
      return { ...owed, ...openState(forStop), handoverAllowed: false };
    case 'PAYMENT_CONFIRMED':
      return {
        ...owed,
        paymentState: 'PAYMENT_CONFIRMED',
        handoverAllowed: true,
        collectionId: completed,
        lastFailure: null,
      };
    case 'DELIVERY_FAILED':
      // Waiting for a retry or an admin's resolution: nothing is handed over meanwhile.
      return completed
        ? {
            ...owed,
            paymentState: 'PAYMENT_CONFIRMED',
            handoverAllowed: false,
            collectionId: completed,
            lastFailure: null,
          }
        : { ...owed, ...notYet(), handoverAllowed: false };
    default:
      // PENDING: the next drop, not reached yet.
      return { ...owed, ...notYet(), handoverAllowed: false };
  }
}

/** Historical PAY_AT_DELIVERY: one collection for the whole booking, after the last drop. */
function bookingLevelDeliveryGate(input: GateInput): PaymentGate {
  const { booking, tripStatus } = input;
  if (isAtPickup(tripStatus)) {
    return pickupWithoutPayment(tripStatus);
  }
  const owed = {
    stage: 'DROP' as const,
    stopSequence: null,
    amountPaise: booking.finalFareMinor,
    cashFeePaise: input.platformFeePaise,
  };
  const forBooking = bookingLevel(input.collections);
  if (booking.paymentStatus !== 'UNPAID') {
    return {
      ...owed,
      paymentState: 'PAYMENT_CONFIRMED',
      handoverAllowed: isUnderWay(tripStatus),
      collectionId: completedId(forBooking),
      lastFailure: null,
    };
  }
  if (tripStatus !== 'DELIVERED') {
    // Its drops were never gated: the goods are handed over, then the booking is collected.
    return { ...owed, ...notYet(), handoverAllowed: isUnderWay(tripStatus) };
  }
  return { ...owed, ...openState(forBooking), handoverAllowed: false };
}

/** Historical PREPAID_UPI: paid in the app. Its handovers were never gated and still are not. */
function prepaidGate(input: GateInput): PaymentGate {
  const { booking, tripStatus } = input;
  return {
    ...NOTHING_OWED,
    paymentState: booking.paymentStatus === 'UNPAID' ? 'PAYMENT_REQUIRED' : 'PAYMENT_CONFIRMED',
    amountPaise: booking.finalFareMinor,
    handoverAllowed: tripStatus === 'DRIVER_ARRIVED' || isUnderWay(tripStatus),
  };
}

/** Nothing is collected at the pickup of a pay-at-delivery booking. */
function pickupWithoutPayment(tripStatus: TripStatus | null): PaymentGate {
  return { ...NOTHING_OWED, stage: 'PICKUP', handoverAllowed: tripStatus === 'DRIVER_ARRIVED' };
}

function isAtPickup(tripStatus: TripStatus | null): boolean {
  return tripStatus === null || tripStatus === 'DRIVER_ASSIGNED' || tripStatus === 'DRIVER_ARRIVED';
}

function isUnderWay(tripStatus: TripStatus | null): boolean {
  return tripStatus !== null && UNDER_WAY_TRIP_STATUSES.has(tripStatus);
}

function bookingLevel(collections: readonly GateCollection[]): GateCollection[] {
  return collections.filter((collection) => collection.bookingStopId === null);
}

function completedId(collections: readonly GateCollection[]): string | null {
  return collections.find((collection) => collection.status === 'COMPLETED')?.id ?? null;
}

function notYet(): GateFields {
  return { paymentState: 'NOT_YET', collectionId: null, lastFailure: null };
}

/**
 * An obligation that is owed now and not paid: a live QR means the payment is in progress; if
 * the last attempt failed, a new one is needed; otherwise nothing has been tried yet.
 */
function openState(collections: readonly GateCollection[]): GateFields {
  const pending = collections.find((collection) => collection.status === 'PENDING');
  if (pending) {
    return { paymentState: 'PAYMENT_PROCESSING', collectionId: pending.id, lastFailure: null };
  }
  const latest = [...collections].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (latest && (latest.status === 'FAILED' || latest.status === 'REVERSED')) {
    return {
      paymentState: 'PAYMENT_FAILED',
      collectionId: latest.id,
      lastFailure: latest.failureReason ?? latest.status,
    };
  }
  return { paymentState: 'PAYMENT_REQUIRED', collectionId: null, lastFailure: null };
}
