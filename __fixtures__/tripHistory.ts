import { parseHistoryTrip } from '../src/services/trip/TripHistoryService';
import type { EarningDto } from '../src/services/payments/earningsDto';
export const uid = 'partner-test-uid';
export const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
/** Test-only shape from the inspected engine TripView contract. */
export const engineTrip = (overrides: Record<string, unknown> = {}) => ({
  id: uuid(1), rideId: uuid(2), driverId: uid, externalRef: 'actual-booking-reference',
  paymentTripId: uuid(3), paymentBookingId: uuid(4), status: 'COMPLETED',
  createdAt: '2026-11-01T23:50:00.000Z', updatedAt: '2026-11-02T00:30:00.000Z', completedAt: '2026-11-02T00:30:00.000Z',
  arrivedAt: '2026-11-02T00:00:00.000Z', startedAt: '2026-11-02T00:05:00.000Z',
  vehicleType: 'MINI_TRUCK', pickup: { latitude: 26, longitude: 73, address: 'Backend pickup address' },
  fare: 99999, weight: 250, totalDistanceKm: 12.6,
  stops: [{ id: uuid(5), sequence: 2, location: { address: 'Backend second drop' }, status: 'DELIVERED' },
    { id: uuid(6), sequence: 1, location: { address: 'Backend first drop' }, status: 'DELIVERED', receiver: { phone: 'private-test-contact' } }],
  ...overrides,
});
export const historyTrip = (overrides: Record<string, unknown> = {}) => parseHistoryTrip(engineTrip(overrides), uid);
export const earning = (overrides: Partial<EarningDto> = {}): EarningDto => ({
  earningId: uuid(7), tripId: uuid(3), bookingId: uuid(4), settlement: 'ONLINE', status: 'PAYABLE',
  grossAmountPaise: 200000, platformFeePaise: 20000, otherDeductionsPaise: 1000, tdsAmountPaise: 9000,
  netAmountPaise: 170000, merchantSettled: true, payableAt: '2026-11-02T01:00:00.000Z', paidAt: null,
  createdAt: '2026-11-02T00:30:00.000Z', ...overrides,
});
