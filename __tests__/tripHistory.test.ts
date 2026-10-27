import { parseHistoricalTrip } from '../src/services/engine/dispatch';
import { ApiTripService } from '../src/services/trip/TripService';
import * as dispatch from '../src/services/engine/dispatch';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'driver-test-123' } }),
  getIdToken: jest.fn(async () => 'fake-token'),
}));

jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

describe('Driver Trip History', () => {
  it('parses engine trip view into HistoricalTrip correctly', () => {
    const rawTripView = {
      id: 'trip-abc-123',
      rideId: 'ride-xyz-789',
      status: 'COMPLETED',
      createdAt: '2026-10-24T10:30:00.000Z',
      completedAt: '2026-10-24T11:15:00.000Z',
      vehicleType: 'Tata Ace',
      weight: 50,
      fare: 1450,
      payablePaise: 145000,
      pickup: {
        latitude: 26.29,
        longitude: 73.02,
        address: '124 Industrial Park, Sector 4',
      },
      stops: [
        {
          id: 'stop-1',
          sequence: 1,
          location: {
            latitude: 26.31,
            longitude: 73.05,
            address: 'Wholesale Market',
          },
          status: 'DELIVERED',
          payablePaise: 145000,
          otpVerified: true,
        },
      ],
      externalRef: 'LOG-9921',
    };

    const parsed = parseHistoricalTrip(rawTripView);

    expect(parsed.id).toBe('trip-abc-123');
    expect(parsed.status).toBe('completed');
    expect(parsed.vehicleType).toBe('Tata Ace');
    expect(parsed.vehicleRegistration).toBe('LOG-9921');
    expect(parsed.stops.length).toBe(2); // 1 pickup + 1 drop
    expect(parsed.stops[0].type).toBe('pickup');
    expect(parsed.stops[0].address).toBe('124 Industrial Park, Sector 4');
    expect(parsed.stops[1].type).toBe('drop_final');
    expect(parsed.stops[1].address).toBe('Wholesale Market');
    expect(parsed.earnings.grossEarning).toBe(1450);
    expect(parsed.earnings.platformCommissionPercent).toBe(8);
    expect(parsed.earnings.netEarning).toBe(1334); // 1450 - 116 = 1334
    expect(parsed.earnings.paidToWallet).toBe(true);
  });

  it('parses cancelled trips with zero earnings', () => {
    const rawCancelled = {
      id: 'trip-cancelled-1',
      rideId: 'ride-c-1',
      status: 'CANCELLED',
      createdAt: '2026-10-23T14:15:00.000Z',
      cancelledAt: '2026-10-23T14:20:00.000Z',
      vehicleType: 'Heavy Truck',
      fare: 0,
      pickup: {
        latitude: 26.29,
        longitude: 73.02,
        address: '124 Industrial Park, Sector 4',
      },
      stops: [],
      externalRef: 'LOG-4402',
    };

    const parsed = parseHistoricalTrip(rawCancelled);

    expect(parsed.id).toBe('trip-cancelled-1');
    expect(parsed.status).toBe('cancelled');
    expect(parsed.cancellationReason).toBe('Cancelled by user');
    expect(parsed.earnings.netEarning).toBe(0);
    expect(parsed.earnings.paidToWallet).toBe(false);
  });

  it('formats raw vehicle enum and generates clean reference for ENG- externalRef', () => {
    const rawTripView = {
      id: 'fe2e05e5-abcd-1234-5678-90abcdef1234',
      status: 'CANCELLED',
      createdAt: '2026-10-26T14:00:00.000Z',
      vehicleType: 'TWO_WHEELER',
      externalRef: 'ENG-fe2e05e5-abcd-1234-5678-90abcdef1234',
      cancellationReason: 'Driver requested cancellation',
      pickup: {
        latitude: 26.29,
        longitude: 73.02,
        address: '255, Mansarover Colony, Jodhpur',
      },
      drop: {
        latitude: 26.35,
        longitude: 73.08,
        address: 'Clock Tower, Jodhpur',
      },
      stops: [],
    };

    const parsed = parseHistoricalTrip(rawTripView);

    expect(parsed.vehicleType).toBe('Two Wheeler');
    expect(parsed.vehicleRegistration).toBe('#fe2e05e5');
    expect(parsed.cancellationReason).toBe('Driver requested cancellation');
    expect(parsed.stops.length).toBe(2);
    expect(parsed.stops[0].address).toBe('255, Mansarover Colony, Jodhpur');
    expect(parsed.stops[1].address).toBe('Clock Tower, Jodhpur');
    expect(parsed.stops[1].type).toBe('drop_final');
  });

  it('ApiTripService calls engine.getDriverTripHistory with signed-in driver id', async () => {
    const mockTrips = [
      {
        id: 'trip-1',
        date: 'Oct 26, 2026',
        time: '12:00 PM',
        status: 'completed' as const,
        stops: [],
        loadType: 'other' as const,
        goodsType: 'Mini Truck',
        totalWeight: 'N/A',
        vehicleType: 'Mini Truck',
        vehicleRegistration: 'RJ-19',
        earnings: {
          tripId: 'trip-1',
          grossEarning: 500,
          platformCommission: 75,
          platformCommissionPercent: 15,
          otherDeductions: 0,
          netEarning: 425,
          currency: '₹',
          paidToWallet: true,
        },
      },
    ];

    const spy = jest
      .spyOn(dispatch, 'getDriverTripHistory')
      .mockResolvedValueOnce(mockTrips);

    const apiService = new ApiTripService();
    const result = await apiService.getHistory();

    expect(spy).toHaveBeenCalledWith('driver-test-123');
    expect(result).toEqual(mockTrips);

    spy.mockRestore();
  });
});
