import type { BookingStopStatus } from '../generated/prisma/enums';
import { checkTripRequest, type TripRequestContext } from './trip-lifecycle';

const stops = (...statuses: BookingStopStatus[]) =>
  statuses.map((status, index) => ({ sequence: index + 1, status }));

const context = (overrides: Partial<TripRequestContext> = {}): TripRequestContext => ({
  paymentMethod: 'PAY_AT_PICKUP',
  paymentModel: 'QUOTE_PER_STOP',
  bookingPaid: false,
  tripStatus: 'DRIVER_ARRIVED',
  stops: stops('PENDING'),
  ...overrides,
});

describe('checkTripRequest', () => {
  describe('pickup gate (PAY_AT_PICKUP)', () => {
    it.each(['QUOTE_PER_STOP', 'LEGACY_BOOKING_LEVEL'] as const)(
      'holds an unpaid trip at the pickup (%s)',
      (paymentModel) => {
        const unpaid = context({ paymentModel, stops: [] });
        expect(checkTripRequest(unpaid, 'PICKUP_VERIFIED')).toEqual({ kind: 'PAYMENT_REQUIRED' });
        // Skipping ahead is held by the same gate, not reported as a skip.
        expect(checkTripRequest(unpaid, 'IN_TRANSIT')).toEqual({ kind: 'PAYMENT_REQUIRED' });
      },
    );

    it('lets a paid trip through the pickup', () => {
      expect(checkTripRequest(context({ bookingPaid: true }), 'PICKUP_VERIFIED')).toBeNull();
      expect(
        checkTripRequest(
          context({ bookingPaid: true, tripStatus: 'PICKUP_VERIFIED' }),
          'IN_TRANSIT',
        ),
      ).toBeNull();
    });

    it('never starts an unpaid trip priced per drop', () => {
      expect(checkTripRequest(context({ tripStatus: 'PICKUP_VERIFIED' }), 'IN_TRANSIT')).toEqual({
        kind: 'PAYMENT_REQUIRED',
      });
    });

    it('lets a historical trip that passed the pickup unpaid before the gate carry on', () => {
      const historical = context({
        paymentModel: 'LEGACY_BOOKING_LEVEL',
        tripStatus: 'PICKUP_VERIFIED',
        stops: [],
      });
      expect(checkTripRequest(historical, 'IN_TRANSIT')).toBeNull();
    });

    it('does not gate the pickup of other payment methods', () => {
      for (const paymentMethod of ['PAY_AT_DELIVERY', 'PREPAID_UPI'] as const) {
        expect(checkTripRequest(context({ paymentMethod }), 'PICKUP_VERIFIED')).toBeNull();
      }
    });

    it('still refuses skipping the arrival', () => {
      expect(
        checkTripRequest(context({ tripStatus: 'DRIVER_ASSIGNED' }), 'PICKUP_VERIFIED'),
      ).toEqual({ kind: 'INVALID_TRANSITION' });
    });
  });

  describe('trips priced per drop', () => {
    const underWay = (overrides: Partial<TripRequestContext> = {}) =>
      context({ bookingPaid: true, tripStatus: 'IN_TRANSIT', ...overrides });

    it('reach DROP_PROGRESS through a drop, never from an engine report', () => {
      expect(checkTripRequest(underWay(), 'DROP_PROGRESS')).toEqual({ kind: 'STOP_REQUIRED' });
      expect(
        checkTripRequest(underWay({ paymentMethod: 'PAY_AT_DELIVERY' }), 'DROP_PROGRESS'),
      ).toEqual({ kind: 'STOP_REQUIRED' });
    });

    it('reach DELIVERED only once every drop is finished', () => {
      expect(
        checkTripRequest(
          underWay({
            tripStatus: 'DROP_PROGRESS',
            stops: stops('DELIVERED', 'DELIVERY_FAILED', 'PENDING'),
          }),
          'DELIVERED',
        ),
      ).toEqual({ kind: 'STOPS_PENDING', pendingStops: [2, 3] });
      expect(checkTripRequest(underWay({ stops: stops('PENDING') }), 'DELIVERED')).toEqual({
        kind: 'STOPS_PENDING',
        pendingStops: [1],
      });
      expect(
        checkTripRequest(
          underWay({ tripStatus: 'DROP_PROGRESS', stops: stops('DELIVERED', 'UNDELIVERED') }),
          'DELIVERED',
        ),
      ).toBeNull();
    });

    it('still refuse skipping', () => {
      expect(
        checkTripRequest(context({ bookingPaid: true, tripStatus: 'DRIVER_ARRIVED' }), 'DELIVERED'),
      ).toEqual({ kind: 'INVALID_TRANSITION' });
    });
  });

  describe('historical bookings', () => {
    it('keep the engine-reported order through delivery', () => {
      const historical = (tripStatus: TripRequestContext['tripStatus']) =>
        context({
          paymentMethod: 'PAY_AT_DELIVERY',
          paymentModel: 'LEGACY_BOOKING_LEVEL',
          tripStatus,
          stops: [],
        });
      for (const [from, to] of [
        ['DRIVER_ARRIVED', 'PICKUP_VERIFIED'],
        ['PICKUP_VERIFIED', 'IN_TRANSIT'],
        ['IN_TRANSIT', 'DROP_PROGRESS'],
        ['DROP_PROGRESS', 'DELIVERED'],
      ] as const) {
        expect(checkTripRequest(historical(from), to)).toBeNull();
      }
      expect(checkTripRequest(historical('IN_TRANSIT'), 'DELIVERED')).toEqual({
        kind: 'INVALID_TRANSITION',
      });
    });
  });
});
