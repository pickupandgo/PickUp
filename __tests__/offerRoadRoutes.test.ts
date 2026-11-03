import { fetchOfferRoadRoutes } from '../src/services/trip/OfferRoadRoutes';
import { getCurrentDriverId } from '../src/services/engine/dispatch';
import { getEngineClient } from '../src/services/engine/engineClient';
import type { TripOffer } from '../src/types/trip';
import type { LocationResult } from '../src/location/types';
jest.mock('../src/services/engine/dispatch', () => ({ getCurrentDriverId: jest.fn(() => 'driver') }));
jest.mock('../src/services/engine/engineClient', () => ({ getEngineClient: jest.fn() }));
const request = jest.fn();
const id = '00000000-0000-4000-8000-000000000001';
const offerId = '00000000-0000-4000-8000-000000000002';
const routes = { toPickup: { distanceMeters: 5600, durationSeconds: 1020 }, delivery: { distanceMeters: 12000, durationSeconds: 2100 } };
let offer: TripOffer, fix: LocationResult;
beforeEach(() => {
  jest.mocked(getCurrentDriverId).mockReturnValue('driver');
  jest.mocked(getEngineClient).mockReturnValue({ request });
  offer = { id, dispatchOfferId: offerId, expiresAt: Date.now() + 30000 } as TripOffer;
  fix = { latitude: 26.2, longitude: 73.1, accuracy: 5, timestamp: Date.now() } as LocationResult;
  request.mockReset().mockResolvedValue({ rideId: id, offerId, expiresAt: new Date(offer.expiresAt).toISOString(), routes });
});
test('uses authenticated Engine offer routing with a fresh origin and no client destination or money', async () => {
  expect(await fetchOfferRoadRoutes(offer, fix)).toEqual(routes);
  expect(request).toHaveBeenCalledWith({ method: 'POST', path: `/rides/${id}/offer-road-route`, retry: false,
    body: { latitude: fix.latitude, longitude: fix.longitude, capturedAt: fix.timestamp, accuracy: fix.accuracy } });
});
test('rejects stale/inaccurate GPS and expired offers without requesting any route', async () => {
  for (const input of [{ ...fix, timestamp: Date.now()-31000 }, { ...fix, accuracy: 101 }])
    await expect(fetchOfferRoadRoutes(offer, input)).rejects.toThrow();
  await expect(fetchOfferRoadRoutes({ ...offer, expiresAt: 0 }, fix)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
test.each([null, { ...routes, toPickup: { distanceMeters: -1, durationSeconds: 1 } }])('rejects invalid route metrics %s without inventing an aerial fallback', async result => {
  request.mockResolvedValue({ rideId: id, offerId, expiresAt: new Date(offer.expiresAt).toISOString(), routes: result });
  await expect(fetchOfferRoadRoutes(offer, fix)).rejects.toThrow();
});
test('discards reassigned offers and late responses after account switching', async () => {
  request.mockResolvedValueOnce({ rideId: id, offerId: id, expiresAt: new Date(offer.expiresAt).toISOString(), routes });
  await expect(fetchOfferRoadRoutes(offer, fix)).rejects.toThrow('Offer changed');
  request.mockImplementationOnce(async () => {
    jest.mocked(getCurrentDriverId).mockReturnValue('another-driver');
    return { rideId: id, offerId, expiresAt: new Date(offer.expiresAt).toISOString(), routes };
  });
  await expect(fetchOfferRoadRoutes(offer, fix)).rejects.toThrow('Offer changed');
});
