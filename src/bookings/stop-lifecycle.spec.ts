import type { BookingStopStatus, TripStatus } from '../generated/prisma/enums';
import {
  decideEngineStopRequest,
  decideStopResolution,
  focusStop,
  type StopContext,
  type StopState,
  tripAdvanceAfterStops,
} from './stop-lifecycle';

const stop = (
  sequence: number,
  status: BookingStopStatus,
  extra: Partial<StopState> = {},
): StopState => ({ sequence, status, paid: false, failedAt: null, ...extra });

const context = (stops: StopState[], overrides: Partial<StopContext> = {}): StopContext => ({
  paymentMethod: 'PAY_AT_DELIVERY',
  bookingPaid: false,
  closed: false,
  tripStatus: 'DROP_PROGRESS',
  stops,
  ...overrides,
});

/** The decision for the stop with `sequence` in `stops`. */
function engineRequest(
  stops: StopState[],
  sequence: number,
  requested: 'ARRIVED' | 'DELIVERED' | 'DELIVERY_FAILED',
  overrides: Partial<StopContext> = {},
) {
  const target = stops.find((candidate) => candidate.sequence === sequence);
  if (!target) {
    throw new Error(`no stop ${sequence}`);
  }
  return decideEngineStopRequest(context(stops, overrides), target, requested);
}

const moveTo = (to: BookingStopStatus) => ({ kind: 'MOVE', to });
const refused = (refusal: string) => ({ kind: 'REFUSE', refusal });
const NO_CHANGE = { kind: 'NO_CHANGE' };
const FAILED_AT = new Date('2026-10-15T10:00:00Z');

describe('decideEngineStopRequest', () => {
  describe('ARRIVED', () => {
    it.each<TripStatus>(['IN_TRANSIT', 'DROP_PROGRESS'])(
      'reaches the first drop while the trip is %s',
      (tripStatus) => {
        expect(engineRequest([stop(1, 'PENDING')], 1, 'ARRIVED', { tripStatus })).toEqual(
          moveTo('ARRIVED'),
        );
      },
    );

    it.each<TripStatus>(['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'DELIVERED'])(
      'refuses a drop while the trip is %s',
      (tripStatus) => {
        expect(engineRequest([stop(1, 'PENDING')], 1, 'ARRIVED', { tripStatus })).toEqual(
          refused('TRIP_NOT_UNDER_WAY'),
        );
      },
    );

    it.each<BookingStopStatus>(['PENDING', 'ARRIVED', 'PAYMENT_CONFIRMED', 'DELIVERY_FAILED'])(
      'refuses the next drop while the earlier one is %s',
      (earlier) => {
        expect(engineRequest([stop(1, earlier), stop(2, 'PENDING')], 2, 'ARRIVED')).toEqual(
          refused('OUT_OF_ORDER'),
        );
      },
    );

    it.each<BookingStopStatus>(['DELIVERED', 'UNDELIVERED'])(
      'reaches the next drop once the earlier one is %s',
      (earlier) => {
        expect(engineRequest([stop(1, earlier), stop(2, 'PENDING')], 2, 'ARRIVED')).toEqual(
          moveTo('ARRIVED'),
        );
      },
    );

    it.each<BookingStopStatus>(['ARRIVED', 'PAYMENT_CONFIRMED', 'DELIVERED', 'UNDELIVERED'])(
      'changes nothing for a drop already %s',
      (status) => {
        expect(engineRequest([stop(1, status, { failedAt: FAILED_AT })], 1, 'ARRIVED')).toEqual(
          NO_CHANGE,
        );
      },
    );

    it('retries a failed attempt: unpaid as ARRIVED, paid as PAYMENT_CONFIRMED', () => {
      const failed = { failedAt: FAILED_AT };
      expect(engineRequest([stop(1, 'DELIVERY_FAILED', failed)], 1, 'ARRIVED')).toEqual(
        moveTo('ARRIVED'),
      );
      expect(
        engineRequest([stop(1, 'DELIVERY_FAILED', { ...failed, paid: true })], 1, 'ARRIVED'),
      ).toEqual(moveTo('PAYMENT_CONFIRMED'));
      // A pay-at-pickup drop was paid with the booking: it is simply reached again.
      expect(
        engineRequest([stop(1, 'DELIVERY_FAILED', failed)], 1, 'ARRIVED', {
          paymentMethod: 'PAY_AT_PICKUP',
          bookingPaid: true,
        }),
      ).toEqual(moveTo('ARRIVED'));
    });

    it('refuses on a closed booking, but repeats stay harmless', () => {
      expect(engineRequest([stop(1, 'PENDING')], 1, 'ARRIVED', { closed: true })).toEqual(
        refused('BOOKING_CLOSED'),
      );
      expect(engineRequest([stop(1, 'DELIVERED')], 1, 'ARRIVED', { closed: true })).toEqual(
        NO_CHANGE,
      );
      expect(engineRequest([stop(1, 'CANCELLED')], 1, 'ARRIVED')).toEqual(
        refused('BOOKING_CLOSED'),
      );
    });
  });

  describe('DELIVERED', () => {
    it('hands a pay-at-delivery drop over only once that drop is paid', () => {
      expect(engineRequest([stop(1, 'ARRIVED')], 1, 'DELIVERED')).toEqual(
        refused('PAYMENT_REQUIRED'),
      );
      expect(engineRequest([stop(1, 'PAYMENT_CONFIRMED', { paid: true })], 1, 'DELIVERED')).toEqual(
        moveTo('DELIVERED'),
      );
      // A confirmation whose collection no longer counts as paid is not a handover.
      expect(engineRequest([stop(1, 'PAYMENT_CONFIRMED')], 1, 'DELIVERED')).toEqual(
        refused('PAYMENT_REQUIRED'),
      );
      // A paid booking says nothing about a pay-at-delivery drop.
      expect(engineRequest([stop(1, 'ARRIVED')], 1, 'DELIVERED', { bookingPaid: true })).toEqual(
        refused('PAYMENT_REQUIRED'),
      );
    });

    it('hands a pay-at-pickup drop over once the booking is paid', () => {
      const pickup = { paymentMethod: 'PAY_AT_PICKUP' as const };
      expect(
        engineRequest([stop(1, 'ARRIVED')], 1, 'DELIVERED', { ...pickup, bookingPaid: true }),
      ).toEqual(moveTo('DELIVERED'));
      expect(engineRequest([stop(1, 'ARRIVED')], 1, 'DELIVERED', pickup)).toEqual(
        refused('PAYMENT_REQUIRED'),
      );
    });

    it.each<BookingStopStatus>(['PENDING', 'DELIVERY_FAILED', 'UNDELIVERED'])(
      'refuses a drop that is %s',
      (status) => {
        expect(engineRequest([stop(1, status, { paid: true })], 1, 'DELIVERED')).toEqual(
          refused('INVALID_TRANSITION'),
        );
      },
    );

    it('changes nothing for a delivered drop, even after completion', () => {
      expect(engineRequest([stop(1, 'DELIVERED')], 1, 'DELIVERED', { closed: true })).toEqual(
        NO_CHANGE,
      );
    });

    it('refuses on a closed booking', () => {
      expect(
        engineRequest([stop(1, 'PAYMENT_CONFIRMED', { paid: true })], 1, 'DELIVERED', {
          closed: true,
        }),
      ).toEqual(refused('BOOKING_CLOSED'));
    });
  });

  describe('DELIVERY_FAILED', () => {
    it.each<BookingStopStatus>(['ARRIVED', 'PAYMENT_CONFIRMED'])(
      'records a failed attempt at a drop that is %s',
      (status) => {
        expect(engineRequest([stop(1, status)], 1, 'DELIVERY_FAILED')).toEqual(
          moveTo('DELIVERY_FAILED'),
        );
      },
    );

    it.each<BookingStopStatus>(['PENDING', 'DELIVERED'])('refuses a drop that is %s', (status) => {
      expect(engineRequest([stop(1, status)], 1, 'DELIVERY_FAILED')).toEqual(
        refused('INVALID_TRANSITION'),
      );
    });

    it.each<BookingStopStatus>(['DELIVERY_FAILED', 'UNDELIVERED'])(
      'changes nothing for a drop already %s',
      (status) => {
        expect(engineRequest([stop(1, status)], 1, 'DELIVERY_FAILED')).toEqual(NO_CHANGE);
      },
    );
  });
});

describe('decideStopResolution', () => {
  const resolve = (
    target: StopState,
    resolution: 'RETRY' | 'UNDELIVERED',
    overrides: Partial<StopContext> = {},
  ) => decideStopResolution(context([target], overrides), target, resolution);

  it('resolves only a failed attempt as undelivered', () => {
    expect(resolve(stop(1, 'DELIVERY_FAILED', { failedAt: FAILED_AT }), 'UNDELIVERED')).toEqual(
      moveTo('UNDELIVERED'),
    );
    expect(resolve(stop(1, 'UNDELIVERED', { failedAt: FAILED_AT }), 'UNDELIVERED')).toEqual(
      NO_CHANGE,
    );
    for (const status of ['PENDING', 'ARRIVED', 'PAYMENT_CONFIRMED', 'DELIVERED'] as const) {
      expect(resolve(stop(1, status), 'UNDELIVERED')).toEqual(refused('INVALID_TRANSITION'));
    }
    expect(resolve(stop(1, 'CANCELLED'), 'UNDELIVERED')).toEqual(refused('BOOKING_CLOSED'));
    expect(
      resolve(stop(1, 'DELIVERY_FAILED', { failedAt: FAILED_AT }), 'UNDELIVERED', {
        closed: true,
      }),
    ).toEqual(refused('BOOKING_CLOSED'));
  });

  it('retries only a failed attempt, and a repeat changes nothing', () => {
    const failed = { failedAt: FAILED_AT };
    expect(resolve(stop(1, 'DELIVERY_FAILED', failed), 'RETRY')).toEqual(moveTo('ARRIVED'));
    expect(resolve(stop(1, 'DELIVERY_FAILED', { ...failed, paid: true }), 'RETRY')).toEqual(
      moveTo('PAYMENT_CONFIRMED'),
    );
    expect(resolve(stop(1, 'ARRIVED', failed), 'RETRY')).toEqual(NO_CHANGE);
    expect(resolve(stop(1, 'PAYMENT_CONFIRMED', failed), 'RETRY')).toEqual(NO_CHANGE);
    // Never failed, or finished: nothing to retry.
    for (const status of ['PENDING', 'ARRIVED', 'DELIVERED', 'UNDELIVERED'] as const) {
      expect(resolve(stop(1, status), 'RETRY')).toEqual(refused('INVALID_TRANSITION'));
    }
  });
});

describe('focusStop', () => {
  it('is the current drop, else the first unfinished one, else none', () => {
    expect(focusStop([stop(2, 'PENDING'), stop(1, 'ARRIVED')])?.sequence).toBe(1);
    expect(
      focusStop([stop(1, 'DELIVERED'), stop(2, 'PENDING'), stop(3, 'PENDING')])?.sequence,
    ).toBe(2);
    expect(focusStop([stop(1, 'DELIVERY_FAILED'), stop(2, 'PENDING')])?.sequence).toBe(1);
    expect(focusStop([stop(1, 'DELIVERED'), stop(2, 'UNDELIVERED')])).toBeNull();
  });
});

describe('tripAdvanceAfterStops', () => {
  const statuses = (...values: BookingStopStatus[]) => values.map((status) => ({ status }));

  it('moves the trip to DROP_PROGRESS when a drop is reached', () => {
    expect(tripAdvanceAfterStops('IN_TRANSIT', statuses('ARRIVED', 'PENDING'))).toEqual([
      'DROP_PROGRESS',
    ]);
    expect(tripAdvanceAfterStops('IN_TRANSIT', statuses('PENDING', 'PENDING'))).toEqual([]);
  });

  it('moves it to DELIVERED once every drop is finished', () => {
    expect(
      tripAdvanceAfterStops('DROP_PROGRESS', statuses('DELIVERED', 'UNDELIVERED', 'DELIVERED')),
    ).toEqual(['DELIVERED']);
    expect(
      tripAdvanceAfterStops('DROP_PROGRESS', statuses('DELIVERED', 'DELIVERY_FAILED')),
    ).toEqual([]);
    expect(tripAdvanceAfterStops('IN_TRANSIT', statuses('DELIVERED'))).toEqual([
      'DROP_PROGRESS',
      'DELIVERED',
    ]);
  });

  it('never moves a trip that is not under way', () => {
    expect(tripAdvanceAfterStops('PICKUP_VERIFIED', statuses('PENDING'))).toEqual([]);
    expect(tripAdvanceAfterStops('DELIVERED', statuses('DELIVERED'))).toEqual([]);
    expect(tripAdvanceAfterStops('DROP_PROGRESS', [])).toEqual([]);
  });
});
