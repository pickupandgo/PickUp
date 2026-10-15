import type { BookingStopStatus, TripStatus } from '../generated/prisma/enums';
import {
  customerStopState,
  derivePaymentGate,
  type GateBooking,
  type GateCollection,
  type GateInput,
  type GateStop,
  isStopPaid,
  type PaymentGate,
  toCustomerPaymentGate,
} from './payment-gate';

const FEE = 5_000n;

const booking = (overrides: Partial<GateBooking> = {}): GateBooking => ({
  status: 'DRIVER_ASSIGNED',
  paymentMethod: 'PAY_AT_PICKUP',
  paymentModel: 'QUOTE_PER_STOP',
  paymentStatus: 'UNPAID',
  finalFareMinor: 50_000n,
  ...overrides,
});

/** Drops of Rs 200 and Rs 300 with fee shares of Rs 20 and Rs 30. */
const stops = (...statuses: BookingStopStatus[]): GateStop[] =>
  statuses.map((status, index) => ({
    id: `stop-${index + 1}`,
    sequence: index + 1,
    status,
    payablePaise: BigInt(20_000 + index * 10_000),
    platformFeeSharePaise: BigInt(2_000 + index * 1_000),
  }));

let clock = 0;
const collection = (
  status: 'PENDING' | 'COMPLETED' | 'FAILED',
  options: { stopId?: string; reason?: string } = {},
): GateCollection => {
  clock += 1;
  return {
    id: `col-${clock}`,
    bookingStopId: options.stopId ?? null,
    status,
    failureReason: status === 'FAILED' ? (options.reason ?? 'EXPIRED') : null,
    createdAt: new Date(Date.UTC(2026, 9, 15, 10, 0, clock)),
  };
};

function gate(input: Partial<Omit<GateInput, 'booking'>> & { booking?: Partial<GateBooking> }) {
  return derivePaymentGate({
    tripStatus: 'DRIVER_ASSIGNED',
    stops: stops('PENDING'),
    collections: [],
    platformFeePaise: FEE,
    ...input,
    booking: booking(input.booking),
  });
}

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

describe('derivePaymentGate', () => {
  describe('PAY_AT_PICKUP', () => {
    const pickupOwed = { stage: 'PICKUP', amountPaise: 50_000n, cashFeePaise: FEE };

    it('is not yet owed before the driver reaches the pickup', () => {
      expect(gate({ tripStatus: null })).toMatchObject({
        ...pickupOwed,
        paymentState: 'NOT_YET',
        handoverAllowed: false,
      });
      expect(gate({ tripStatus: 'DRIVER_ASSIGNED' })).toMatchObject({
        paymentState: 'NOT_YET',
        handoverAllowed: false,
      });
    });

    it('is required at the pickup and blocks the handover until paid', () => {
      expect(gate({ tripStatus: 'DRIVER_ARRIVED' })).toEqual({
        ...NOTHING_OWED,
        ...pickupOwed,
        paymentState: 'PAYMENT_REQUIRED',
      });
    });

    it('reports a QR in progress, and a failed one with its reason', () => {
      const failed = collection('FAILED', { reason: 'EXPIRED' });
      expect(gate({ tripStatus: 'DRIVER_ARRIVED', collections: [failed] })).toMatchObject({
        paymentState: 'PAYMENT_FAILED',
        collectionId: failed.id,
        lastFailure: 'EXPIRED',
        handoverAllowed: false,
      });
      const pending = collection('PENDING');
      expect(gate({ tripStatus: 'DRIVER_ARRIVED', collections: [failed, pending] })).toMatchObject({
        paymentState: 'PAYMENT_PROCESSING',
        collectionId: pending.id,
        handoverAllowed: false,
      });
    });

    it('allows the handover once the booking is paid', () => {
      const paid = collection('COMPLETED');
      expect(
        gate({
          tripStatus: 'DRIVER_ARRIVED',
          booking: { paymentStatus: 'PAID' },
          collections: [paid],
        }),
      ).toEqual({
        ...NOTHING_OWED,
        ...pickupOwed,
        paymentState: 'PAYMENT_CONFIRMED',
        handoverAllowed: true,
        collectionId: paid.id,
      });
    });

    it('owes nothing at the drops after the paid pickup; a reached drop is handed over', () => {
      const paid = { paymentStatus: 'PAID' as const };
      expect(gate({ tripStatus: 'PICKUP_VERIFIED', booking: paid })).toEqual(NOTHING_OWED);
      expect(
        gate({ tripStatus: 'IN_TRANSIT', booking: paid, stops: stops('PENDING', 'PENDING') }),
      ).toEqual({ ...NOTHING_OWED, stage: 'DROP', stopSequence: 1 });
      expect(
        gate({ tripStatus: 'DROP_PROGRESS', booking: paid, stops: stops('DELIVERED', 'ARRIVED') }),
      ).toEqual({ ...NOTHING_OWED, stage: 'DROP', stopSequence: 2, handoverAllowed: true });
      expect(gate({ tripStatus: 'DELIVERED', booking: paid })).toEqual(NOTHING_OWED);
    });

    it('applies the same pickup gate to historical bookings (N2)', () => {
      const legacy = { paymentModel: 'LEGACY_BOOKING_LEVEL' as const };
      expect(gate({ tripStatus: 'DRIVER_ARRIVED', booking: legacy, stops: [] })).toMatchObject({
        paymentState: 'PAYMENT_REQUIRED',
        handoverAllowed: false,
      });
      expect(
        gate({
          tripStatus: 'DRIVER_ARRIVED',
          booking: { ...legacy, paymentStatus: 'PAID' },
          stops: [],
        }),
      ).toMatchObject({ paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true });
      // Paid, under way: historical drops were never gated.
      expect(
        gate({
          tripStatus: 'IN_TRANSIT',
          booking: { ...legacy, paymentStatus: 'PAID' },
          stops: [],
        }),
      ).toEqual({ ...NOTHING_OWED, stage: 'DROP', handoverAllowed: true });
    });

    it('keeps a historical trip that passed the pickup unpaid collectable, with ungated drops', () => {
      expect(
        gate({
          tripStatus: 'IN_TRANSIT',
          booking: { paymentModel: 'LEGACY_BOOKING_LEVEL' },
          stops: [],
        }),
      ).toMatchObject({ stage: 'PICKUP', paymentState: 'PAYMENT_REQUIRED', handoverAllowed: true });
      // Priced per drop, that state can't arise; if it did, nothing would be handed over.
      expect(gate({ tripStatus: 'IN_TRANSIT', stops: stops('ARRIVED') })).toMatchObject({
        paymentState: 'PAYMENT_REQUIRED',
        handoverAllowed: false,
      });
    });
  });

  describe('PAY_AT_DELIVERY priced per drop', () => {
    const delivery = { paymentMethod: 'PAY_AT_DELIVERY' as const };

    it('owes nothing at the pickup; the goods are handed over once the driver is there', () => {
      expect(gate({ booking: delivery, tripStatus: 'DRIVER_ASSIGNED' })).toEqual({
        ...NOTHING_OWED,
        stage: 'PICKUP',
      });
      expect(gate({ booking: delivery, tripStatus: 'DRIVER_ARRIVED' })).toEqual({
        ...NOTHING_OWED,
        stage: 'PICKUP',
        handoverAllowed: true,
      });
    });

    it('shows the next drop as not yet owed while in transit', () => {
      expect(
        gate({ booking: delivery, tripStatus: 'IN_TRANSIT', stops: stops('PENDING', 'PENDING') }),
      ).toEqual({
        ...NOTHING_OWED,
        stage: 'DROP',
        stopSequence: 1,
        paymentState: 'NOT_YET',
        amountPaise: 20_000n,
        cashFeePaise: 2_000n,
      });
    });

    it.each<[string, (stopId: string) => GateCollection[], Partial<PaymentGate>]>([
      ['nothing tried yet', () => [], { paymentState: 'PAYMENT_REQUIRED' }],
      [
        'a QR waiting',
        (stopId) => [collection('PENDING', { stopId })],
        { paymentState: 'PAYMENT_PROCESSING' },
      ],
      [
        'a QR that expired',
        (stopId) => [collection('FAILED', { stopId })],
        { paymentState: 'PAYMENT_FAILED', lastFailure: 'EXPIRED' },
      ],
      [
        'only another drop has a QR',
        () => [collection('PENDING', { stopId: 'stop-1' })],
        { paymentState: 'PAYMENT_REQUIRED', collectionId: null },
      ],
    ])('blocks the handover at a reached, unpaid drop (%s)', (_label, collections, expected) => {
      const result = gate({
        booking: delivery,
        tripStatus: 'DROP_PROGRESS',
        stops: stops('DELIVERED', 'ARRIVED'),
        collections: collections('stop-2'),
      });
      expect(result).toMatchObject({
        stage: 'DROP',
        stopSequence: 2,
        amountPaise: 30_000n,
        cashFeePaise: 3_000n,
        handoverAllowed: false,
        ...expected,
      });
    });

    it('allows the handover once that drop is paid', () => {
      const paid = collection('COMPLETED', { stopId: 'stop-1' });
      expect(
        gate({
          booking: delivery,
          tripStatus: 'DROP_PROGRESS',
          stops: stops('PAYMENT_CONFIRMED', 'PENDING'),
          collections: [paid],
        }),
      ).toEqual({
        stage: 'DROP',
        stopSequence: 1,
        paymentState: 'PAYMENT_CONFIRMED',
        amountPaise: 20_000n,
        cashFeePaise: 2_000n,
        handoverAllowed: true,
        collectionId: paid.id,
        lastFailure: null,
      });
    });

    it('hands nothing over at a failed attempt, paid or not', () => {
      expect(
        gate({ booking: delivery, tripStatus: 'DROP_PROGRESS', stops: stops('DELIVERY_FAILED') }),
      ).toMatchObject({ stopSequence: 1, paymentState: 'NOT_YET', handoverAllowed: false });
      expect(
        gate({
          booking: delivery,
          tripStatus: 'DROP_PROGRESS',
          stops: stops('DELIVERY_FAILED'),
          collections: [collection('COMPLETED', { stopId: 'stop-1' })],
        }),
      ).toMatchObject({ paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: false });
    });

    it('owes nothing once every drop is finished', () => {
      for (const tripStatus of ['DELIVERED', 'PAYMENT_CONFIRMED'] as const) {
        expect(
          gate({ booking: delivery, tripStatus, stops: stops('DELIVERED', 'UNDELIVERED') }),
        ).toEqual(NOTHING_OWED);
      }
    });
  });

  describe('historical PAY_AT_DELIVERY (one collection after the last drop)', () => {
    const legacy = {
      paymentMethod: 'PAY_AT_DELIVERY' as const,
      paymentModel: 'LEGACY_BOOKING_LEVEL' as const,
    };

    it('keeps its drops ungated and collects the whole booking once delivered', () => {
      expect(gate({ booking: legacy, tripStatus: 'IN_TRANSIT', stops: [] })).toEqual({
        ...NOTHING_OWED,
        stage: 'DROP',
        paymentState: 'NOT_YET',
        amountPaise: 50_000n,
        cashFeePaise: FEE,
        handoverAllowed: true,
      });
      const qr = collection('PENDING');
      expect(
        gate({ booking: legacy, tripStatus: 'DELIVERED', stops: [], collections: [qr] }),
      ).toMatchObject({
        stage: 'DROP',
        paymentState: 'PAYMENT_PROCESSING',
        collectionId: qr.id,
        handoverAllowed: false,
      });
      expect(
        gate({
          booking: { ...legacy, paymentStatus: 'PAID' },
          tripStatus: 'PAYMENT_CONFIRMED',
          stops: [],
        }),
      ).toMatchObject({ paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: false });
    });
  });

  describe('historical PREPAID_UPI', () => {
    it('reports the in-app payment and never gates a handover', () => {
      const prepaid = {
        paymentMethod: 'PREPAID_UPI' as const,
        paymentModel: 'LEGACY_BOOKING_LEVEL' as const,
      };
      expect(gate({ booking: prepaid, tripStatus: 'DRIVER_ARRIVED', stops: [] })).toMatchObject({
        stage: null,
        paymentState: 'PAYMENT_REQUIRED',
        cashFeePaise: null,
        handoverAllowed: true,
      });
      expect(
        gate({
          booking: { ...prepaid, paymentStatus: 'PAID' },
          tripStatus: 'DROP_PROGRESS',
          stops: [],
        }),
      ).toMatchObject({ paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true });
    });
  });

  it.each<[string, Partial<GateBooking>, TripStatus | null]>([
    ['cancelled booking', { status: 'CANCELLED' }, 'CANCELLED'],
    ['completed booking', { status: 'COMPLETED', paymentStatus: 'PAID' }, 'COMPLETED'],
    ['cancelled trip', {}, 'CANCELLED'],
  ])('owes nothing and hands nothing over for a %s', (_label, overrides, tripStatus) => {
    for (const paymentMethod of ['PAY_AT_PICKUP', 'PAY_AT_DELIVERY', 'PREPAID_UPI'] as const) {
      expect(gate({ booking: { ...overrides, paymentMethod }, tripStatus })).toEqual(NOTHING_OWED);
    }
  });

  it('gives customers no ids and no fee', () => {
    const view = toCustomerPaymentGate(
      gate({ tripStatus: 'DRIVER_ARRIVED', collections: [collection('PENDING')] }),
    );
    expect(view).toEqual({
      stage: 'PICKUP',
      stopSequence: null,
      paymentState: 'PAYMENT_PROCESSING',
      amountPaise: 50_000n,
      handoverAllowed: false,
    });
  });
});

describe('isStopPaid', () => {
  const completed = [{ bookingStopId: 'stop-1', status: 'COMPLETED' }];

  it('is the booking for a pay-at-pickup drop and the drop itself at delivery', () => {
    expect(
      isStopPaid({ paymentMethod: 'PAY_AT_PICKUP', paymentStatus: 'PAID' }, 'stop-1', []),
    ).toBe(true);
    expect(
      isStopPaid({ paymentMethod: 'PAY_AT_PICKUP', paymentStatus: 'UNPAID' }, 'stop-1', completed),
    ).toBe(false);
    expect(
      isStopPaid(
        { paymentMethod: 'PAY_AT_DELIVERY', paymentStatus: 'UNPAID' },
        'stop-1',
        completed,
      ),
    ).toBe(true);
    expect(
      isStopPaid({ paymentMethod: 'PAY_AT_DELIVERY', paymentStatus: 'PAID' }, 'stop-2', completed),
    ).toBe(false);
  });
});

describe('customerStopState', () => {
  it.each<[BookingStopStatus, boolean, string]>([
    ['PENDING', false, 'UPCOMING'],
    ['ARRIVED', false, 'ARRIVED'],
    ['PAYMENT_CONFIRMED', true, 'PAID'],
    ['DELIVERED', true, 'DELIVERED'],
    ['DELIVERY_FAILED', false, 'ARRIVED'],
    ['DELIVERY_FAILED', true, 'PAID'],
    ['UNDELIVERED', false, 'NOT_DELIVERED'],
    ['CANCELLED', false, 'CANCELLED'],
  ])('shows a %s drop (paid: %s) as %s', (status, paid, expected) => {
    expect(customerStopState('PAY_AT_DELIVERY', status, paid)).toBe(expected);
  });
});
