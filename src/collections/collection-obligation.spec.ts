import type { BookingStopStatus, TripStatus } from '../generated/prisma/enums';
import {
  type ObligationBooking,
  type ObligationContext,
  type ObligationStop,
  isPerDropDelivery,
  resolveObligation,
} from './collection-obligation';

const booking = (overrides: Partial<ObligationBooking> = {}): ObligationBooking => ({
  status: 'DRIVER_ASSIGNED',
  paymentMethod: 'PAY_AT_PICKUP',
  paymentModel: 'QUOTE_PER_STOP',
  paymentStatus: 'UNPAID',
  finalFareMinor: 50_000n,
  ...overrides,
});

const stop = (sequence: number, status: BookingStopStatus, payable: bigint): ObligationStop => ({
  id: `stop-${sequence}`,
  sequence,
  status,
  payablePaise: payable,
  platformFeeSharePaise: payable / 10n,
});

const context = (
  overrides: Partial<ObligationBooking>,
  tripStatus: TripStatus,
  stops: ObligationStop[] = [],
): ObligationContext => ({
  booking: booking(overrides),
  tripStatus,
  stops,
  bookingFeePaise: 5_000n,
});

const perDrop = { paymentMethod: 'PAY_AT_DELIVERY', paymentModel: 'QUOTE_PER_STOP' } as const;
const threeDrops = (first: BookingStopStatus, second: BookingStopStatus = 'PENDING') => [
  stop(1, first, 20_000n),
  stop(2, second, 10_000n),
  stop(3, 'PENDING', 20_000n),
];

describe('resolveObligation', () => {
  describe('PAY_AT_PICKUP (the whole booking, at the pickup)', () => {
    it.each(['QUOTE_PER_STOP', 'LEGACY_BOOKING_LEVEL'] as const)(
      'is the booking payable and fee from the driver arrival (%s)',
      (paymentModel) => {
        expect(
          resolveObligation(context({ paymentModel }, 'DRIVER_ARRIVED'), {
            amountPaise: 50_000n,
            stopSequence: null,
          }),
        ).toEqual({
          ok: true,
          obligation: { stage: 'PICKUP', stop: null, amountPaise: 50_000n, cashFeePaise: 5_000n },
        });
      },
    );

    it('is not owed before the driver arrives, nor once the booking is paid or closed', () => {
      const request = { amountPaise: 50_000n, stopSequence: null };
      expect(resolveObligation(context({}, 'DRIVER_ASSIGNED'), request)).toEqual({
        ok: false,
        refusal: { kind: 'WINDOW_CLOSED', stage: 'PICKUP' },
      });
      expect(
        resolveObligation(context({ paymentStatus: 'PAID' }, 'DRIVER_ARRIVED'), request),
      ).toEqual({ ok: false, refusal: { kind: 'ALREADY_PAID' } });
      expect(resolveObligation(context({ status: 'CANCELLED' }, 'CANCELLED'), request)).toEqual({
        ok: false,
        refusal: { kind: 'BOOKING_CLOSED' },
      });
    });

    it('refuses a different amount and any drop: the server decides what is owed', () => {
      expect(
        resolveObligation(context({}, 'DRIVER_ARRIVED'), {
          amountPaise: 49_999n,
          stopSequence: null,
        }),
      ).toEqual({ ok: false, refusal: { kind: 'AMOUNT_MISMATCH', expectedPaise: 50_000n } });
      expect(
        resolveObligation(context({}, 'DRIVER_ARRIVED', threeDrops('PENDING')), {
          amountPaise: 50_000n,
          stopSequence: 1,
        }),
      ).toEqual({ ok: false, refusal: { kind: 'STOP_NOT_EXPECTED' } });
    });
  });

  describe('historical PAY_AT_DELIVERY (the whole booking, once delivered)', () => {
    const legacy = {
      paymentMethod: 'PAY_AT_DELIVERY',
      paymentModel: 'LEGACY_BOOKING_LEVEL',
    } as const;

    it('is the booking payable once delivered, and not before', () => {
      const request = { amountPaise: 50_000n, stopSequence: null };
      expect(resolveObligation(context(legacy, 'DELIVERED'), request)).toEqual({
        ok: true,
        obligation: { stage: 'DELIVERY', stop: null, amountPaise: 50_000n, cashFeePaise: 5_000n },
      });
      expect(resolveObligation(context(legacy, 'DROP_PROGRESS'), request)).toEqual({
        ok: false,
        refusal: { kind: 'WINDOW_CLOSED', stage: 'DELIVERY' },
      });
    });
  });

  describe('PAY_AT_DELIVERY priced per drop (the drop the driver is at)', () => {
    it('is that drop, for its own payable amount and fee share', () => {
      expect(
        resolveObligation(context(perDrop, 'DROP_PROGRESS', threeDrops('ARRIVED')), {
          amountPaise: 20_000n,
          stopSequence: 1,
        }),
      ).toEqual({
        ok: true,
        obligation: {
          stage: 'DELIVERY',
          stop: { id: 'stop-1', sequence: 1 },
          amountPaise: 20_000n,
          cashFeePaise: 2_000n,
        },
      });
    });

    it('collects the next drop of a partly paid booking', () => {
      expect(
        resolveObligation(
          context(
            { ...perDrop, paymentStatus: 'PARTIALLY_PAID' },
            'DROP_PROGRESS',
            threeDrops('DELIVERED', 'ARRIVED'),
          ),
          { amountPaise: 10_000n, stopSequence: 2 },
        ),
      ).toMatchObject({ ok: true, obligation: { stop: { sequence: 2 }, amountPaise: 10_000n } });
    });

    it('needs the drop named, and only an existing one', () => {
      const drops = context(perDrop, 'DROP_PROGRESS', threeDrops('ARRIVED'));
      expect(resolveObligation(drops, { amountPaise: 20_000n, stopSequence: null })).toEqual({
        ok: false,
        refusal: { kind: 'STOP_REQUIRED' },
      });
      expect(resolveObligation(drops, { amountPaise: 20_000n, stopSequence: 4 })).toEqual({
        ok: false,
        refusal: { kind: 'STOP_NOT_FOUND', stopSequence: 4 },
      });
    });

    it('never collects a later drop in place of the current one, nor a paid one again', () => {
      const atFirst = context(perDrop, 'DROP_PROGRESS', threeDrops('ARRIVED'));
      expect(resolveObligation(atFirst, { amountPaise: 10_000n, stopSequence: 2 })).toEqual({
        ok: false,
        refusal: {
          kind: 'NOT_CURRENT_STOP',
          stopSequence: 2,
          reason: 'NOT_CURRENT',
          stopStatus: 'PENDING',
          currentStop: 1,
        },
      });
      const paid = context(
        { ...perDrop, paymentStatus: 'PARTIALLY_PAID' },
        'DROP_PROGRESS',
        threeDrops('PAYMENT_CONFIRMED'),
      );
      expect(resolveObligation(paid, { amountPaise: 20_000n, stopSequence: 1 })).toEqual({
        ok: false,
        refusal: {
          kind: 'NOT_CURRENT_STOP',
          stopSequence: 1,
          reason: 'STOP_ALREADY_PAID',
          stopStatus: 'PAYMENT_CONFIRMED',
          currentStop: 1,
        },
      });
      const delivered = context(
        { ...perDrop, paymentStatus: 'PARTIALLY_PAID' },
        'DROP_PROGRESS',
        threeDrops('DELIVERED', 'ARRIVED'),
      );
      expect(resolveObligation(delivered, { amountPaise: 20_000n, stopSequence: 1 })).toMatchObject(
        { ok: false, refusal: { reason: 'STOP_ALREADY_PAID', currentStop: 2 } },
      );
    });

    it.each<BookingStopStatus>(['DELIVERY_FAILED', 'UNDELIVERED', 'CANCELLED', 'PENDING'])(
      'does not collect a drop that is %s',
      (status) => {
        expect(
          resolveObligation(
            context(perDrop, 'DROP_PROGRESS', [
              stop(1, status, 20_000n),
              stop(2, 'PENDING', 30_000n),
            ]),
            { amountPaise: 20_000n, stopSequence: 1 },
          ),
        ).toMatchObject({
          ok: false,
          refusal: { kind: 'NOT_CURRENT_STOP', reason: 'NOT_CURRENT' },
        });
      },
    );

    it("refuses another drop's amount, a paid booking and a closed one", () => {
      const drops = threeDrops('ARRIVED');
      expect(
        resolveObligation(context(perDrop, 'DROP_PROGRESS', drops), {
          amountPaise: 50_000n,
          stopSequence: 1,
        }),
      ).toEqual({ ok: false, refusal: { kind: 'AMOUNT_MISMATCH', expectedPaise: 20_000n } });
      expect(
        resolveObligation(context({ ...perDrop, paymentStatus: 'PAID' }, 'DROP_PROGRESS', drops), {
          amountPaise: 20_000n,
          stopSequence: 1,
        }),
      ).toEqual({ ok: false, refusal: { kind: 'ALREADY_PAID' } });
      expect(
        resolveObligation(context({ ...perDrop, status: 'CANCELLED' }, 'CANCELLED', drops), {
          amountPaise: 20_000n,
          stopSequence: 1,
        }),
      ).toEqual({ ok: false, refusal: { kind: 'BOOKING_CLOSED' } });
    });
  });

  it('never collects a prepaid booking', () => {
    expect(
      resolveObligation(
        context(
          { paymentMethod: 'PREPAID_UPI', paymentModel: 'LEGACY_BOOKING_LEVEL' },
          'DELIVERED',
        ),
        { amountPaise: 50_000n, stopSequence: null },
      ),
    ).toEqual({ ok: false, refusal: { kind: 'NOT_COLLECTED' } });
  });
});

describe('isPerDropDelivery', () => {
  it('is true only for pay at delivery priced per drop', () => {
    expect(isPerDropDelivery(perDrop)).toBe(true);
    expect(
      isPerDropDelivery({ paymentMethod: 'PAY_AT_DELIVERY', paymentModel: 'LEGACY_BOOKING_LEVEL' }),
    ).toBe(false);
    expect(
      isPerDropDelivery({ paymentMethod: 'PAY_AT_PICKUP', paymentModel: 'QUOTE_PER_STOP' }),
    ).toBe(false);
  });
});
