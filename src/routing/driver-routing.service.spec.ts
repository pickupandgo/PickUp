import 'reflect-metadata';
import { ACCESS_POLICY_KEY } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import type { PrismaService } from '../prisma/prisma.service';
import { DriverRoutingController } from './driver-routing.controller';
import { DriverRoutingService } from './driver-routing.service';
import type { RoutingService } from './routing.service';

const pickup = { latitude: 26.2389, longitude: 73.0243 };
const first = { latitude: 26.3, longitude: 73.0458 };
const last = { latitude: 26.31, longitude: 73.0458 };
const principal = { role: 'DRIVER', driver: { id: 'verified-driver' } } as Principal;
function setup() {
  const findFirst = jest.fn().mockResolvedValue({
    booking: {
      fareQuote: {
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        stops: [first, last],
      },
    },
  });
  const route = jest
    .fn()
    .mockResolvedValue({ encodedPolyline: 'road', distanceMeters: 5, durationSeconds: 1 });
  const service = new DriverRoutingService(
    { trip: { findFirst } } as unknown as PrismaService,
    { route } as unknown as RoutingService,
  );
  return { service, findFirst, route };
}
it('uses a separate Driver-only policy', () => {
  expect(Reflect.getMetadata(ACCESS_POLICY_KEY, DriverRoutingController)).toBe('DRIVER');
});
it('resolves ownership from the verified principal and preserves ordered remaining stops', async () => {
  const h = setup();
  await h.service.route(principal, {
    tripId: 'assigned-trip',
    origin: pickup,
    destination: last,
    waypoints: [first],
  });
  expect(h.findFirst.mock.calls[0][0].where).toEqual({
    id: 'assigned-trip',
    driverId: 'verified-driver',
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  });
  expect(h.route).toHaveBeenCalledWith({ origin: pickup, destination: last, waypoints: [first] });
  await h.service.route(principal, { tripId: 'assigned-trip', origin: first, destination: last });
});
it('rejects foreign/closed/unquoted trips before contacting Google', async () => {
  const h = setup();
  h.findFirst.mockResolvedValue(null);
  await expect(
    h.service.route(principal, { tripId: 'foreign', origin: pickup, destination: first }),
  ).rejects.toMatchObject({ status: 403 });
  expect(h.route).not.toHaveBeenCalled();
});
it('rejects arbitrary and reversed stops, even for the assigned driver', async () => {
  const h = setup();
  for (const points of [
    [last, first],
    [{ latitude: 0, longitude: 0 }, last],
  ] as const) {
    await expect(
      h.service.route(principal, {
        tripId: 'assigned-trip',
        origin: pickup,
        waypoints: [points[0]],
        destination: points[1],
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
  expect(h.route).not.toHaveBeenCalled();
});
it('propagates routing unavailability without a fallback', async () => {
  const h = setup();
  h.route.mockRejectedValue(new Error('unavailable'));
  await expect(
    h.service.route(principal, { tripId: 'assigned-trip', origin: pickup, destination: first }),
  ).rejects.toThrow('unavailable');
});
