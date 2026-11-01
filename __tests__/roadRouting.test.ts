import { getRoute, decodeRoadPolyline } from '../src/services/engine/directions';
import { EngineRoutingProvider } from '../src/services/routing/EngineRoutingProvider';
import { TripRoutePlanner, navigationStops } from '../src/services/routing/TripRoutePlanner';
import type { ActiveTrip } from '../src/types/trip';
import type { LocationResult } from '../src/location/types';
import type { RoutingResponse } from '../src/services/routing/types';
import { getFirebaseIdToken } from '../src/services/payments/firebaseToken';
jest.mock('../src/config/env', () => ({ env: { PAYMENTS_API_BASE_URL: 'https://backend.test' } }));
jest.mock('../src/services/payments/firebaseToken', () => ({ getFirebaseIdToken: jest.fn(async () => 'synthetic-firebase-token') }));
const id = '00000000-0000-4000-8000-000000000001';
const origin = { latitude: 38.5, longitude: -120.2 };
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const now = 1800000000000;
const fix = (time = now) => ({ ...origin, timestamp: time, accuracy: 5 } as LocationResult);
const trip = (stage = 'IN_TRANSIT', index = 1) => ({ id, paymentTripId: id, engineStatus: stage, currentStopIndex: index,
  stops: [{ id: 'pickup', ...origin, status: 'completed' },
    { id: 'drop1', latitude: 40.7, longitude: -120.95, status: 'current' },
    { id: 'drop2', latitude: 43.252, longitude: -126.453, status: 'pending' }] } as unknown as ActiveTrip);
const road = { polylinePoints: decodeRoadPolyline(encoded), totalDistanceMeters: 5000, totalDurationSeconds: 300,
  eta: new Date(now + 300000), bounds: { southwest: origin, northeast: origin } } as RoutingResponse;
const previousFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = previousFetch; jest.mocked(getFirebaseIdToken).mockReset().mockResolvedValue('synthetic-firebase-token'); });

it('uses the Driver-authorized server contract, never a Google key, preserving waypoint order', async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ encodedPolyline: encoded, distanceMeters: 5000, durationSeconds: 300 }) }));
  globalThis.fetch = fetchMock as never;
  await getRoute(origin, road.polylinePoints[2], { tripId: id, waypoints: [road.polylinePoints[1]] });
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://backend.test/v1/driver/routes/road');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-firebase-token' });
  expect(JSON.stringify(options.headers)).not.toContain('X-Goog');
  expect(JSON.parse(options.body as string).waypoints).toEqual([road.polylinePoints[1]]);
});
it('never replaces a provider failure with artificial geometry', async () => {
  globalThis.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => '{}' })) as never;
  await expect(new EngineRoutingProvider().getRoute({ tripId: id, origin, destinations: [origin] })).rejects.toThrow('Road routing is unavailable');
});
it('validates encoded geometry and uses only pickup before transit, ordered remaining drops afterward', () => {
  expect(decodeRoadPolyline(encoded)).toHaveLength(3);
  expect(() => decodeRoadPolyline('~~~~')).toThrow();
  expect(navigationStops(trip('DRIVER_ASSIGNED', 0)).map(s => s.id)).toEqual(['pickup']);
  expect(navigationStops(trip()).map(s => s.id)).toEqual(['drop1', 'drop2']);
  expect(navigationStops(trip('DROP_PROGRESS', 2)).map(s => s.id)).toEqual(['drop2']);
  expect(navigationStops(trip('COMPLETED'))).toEqual([]);
});
it('single-flights requests, rejects late responses for old targets and permits a new route', async () => {
  let complete!: (r: RoutingResponse) => void;
  const provider = { getRoute: jest.fn().mockReturnValueOnce(new Promise(r => { complete = r; })).mockResolvedValue(road) };
  const planner = new TripRoutePlanner(provider);
  const old = planner.update(trip(), fix(), now);
  await planner.update(trip('DROP_PROGRESS', 2), fix(now + 1), now + 1);
  expect(provider.getRoute).toHaveBeenCalledTimes(1);
  complete(road); await old; expect(planner.state.route).toBeNull();
  await planner.update(trip('DROP_PROGRESS', 2), fix(now + 5001), now + 5001);
  expect(planner.state.route).toBe(road);
});
it('expires GPS and surfaces network failures without fake routes or aggressive retry', async () => {
  const provider = { getRoute: jest.fn().mockRejectedValue(new Error('offline')) };
  const planner = new TripRoutePlanner(provider);
  await planner.update(trip(), fix(now - 31000), now);
  expect(provider.getRoute).not.toHaveBeenCalled(); expect(planner.state.error?.code).toBe('GPS_UNAVAILABLE');
  await planner.update(trip(), fix(), now);
  expect(planner.state.route).toBeNull(); expect(planner.state.error?.code).toBe('PROVIDER_ERROR');
  await planner.update(trip(), fix(now + 1), now + 1);
  expect(provider.getRoute).toHaveBeenCalledTimes(1);
  await planner.update(trip(), fix(now + 5001), now + 5001);
  expect(provider.getRoute).toHaveBeenCalledTimes(2);
});
it('bounds Firebase refresh time so routing can recover instead of remaining busy forever', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(getFirebaseIdToken).mockReturnValueOnce(new Promise(() => {}));
    const result = getRoute(origin, origin, { tripId: id }).then(() => 'unexpected success', (error: Error) => error.message);
    await jest.advanceTimersByTimeAsync(10000);
    expect(await result).toBe('Routing authentication timed out');
  } finally { jest.useRealTimers(); }
});
it('reroutes on GPS deviation while enforcing the minimum request interval', async () => {
  const provider = { getRoute: jest.fn().mockResolvedValue(road) };
  const planner = new TripRoutePlanner(provider);
  await planner.update(trip(), fix(), now);
  const deviated = { ...fix(now + 1000), latitude: 38.6 };
  await planner.update(trip(), deviated, now + 1000);
  expect(provider.getRoute).toHaveBeenCalledTimes(1);
  await planner.update(trip(), { ...deviated, timestamp: now + 5000 }, now + 5000);
  expect(provider.getRoute).toHaveBeenCalledTimes(2);
});
