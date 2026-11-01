import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
function setup() {
  const categories: Record<string, string | null> = {
    bike: 'TWO_WHEELER',
    truck: 'MINI_TRUCK',
    revoked: null,
    stale: 'TWO_WHEELER',
    busy: 'TWO_WHEELER',
  };
  let unavailable = false;
  const positions = Object.keys(categories).map((subject, index) => ({
    subject,
    latitude: 26.2 + index * 0.0001,
    longitude: 73.1,
    capturedAt: BigInt(Date.now() - (subject === 'stale' ? 70_000 : 1_000)),
    accuracy: 5,
    receivedAt: new Date(),
  }));
  const prisma = {
    engineTrip: {
      findMany: jest.fn(() => Promise.resolve([{ driverSubject: 'busy' }])),
    },
  };
  const backend = {
    getDriverEligibilityForSubject: jest.fn((id: string) =>
      Promise.resolve(
        unavailable
          ? { kind: 'UNAVAILABLE' }
          : {
              kind: 'OK',
              value: {
                eligible: Boolean(categories[id]),
                vehicleCategory: categories[id],
              },
            },
      ),
    ),
  };
  const locations = {
    fresh: jest.fn(() =>
      Promise.resolve(
        positions.filter((p) => Date.now() - Number(p.capturedAt) < 60_000),
      ),
    ),
  };
  const service = new DriversService(
    prisma as any,
    backend as any,
    locations as any,
  );
  Object.keys(categories).forEach((id) => service.markAvailable(id));
  return {
    service,
    locations,
    positions,
    setUnavailable: () => {
      unavailable = true;
    },
  };
}
const search = {
  latitude: 26.2,
  longitude: 73.1,
  radiusKm: 5,
  vehicleCategory: 'TWO_WHEELER',
};
it('previews only fresh eligible category-compatible idle vehicles without identity', async () => {
  const { service } = setup();
  service.updateVehicleType('bike', 'Mini Truck');
  const result = await service.previewNearby('customer-a', search);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]).toEqual({
    key: expect.stringMatching(/^[a-f0-9]{20}$/),
    latitude: 26.2,
    longitude: 73.1,
    vehicleCategory: 'TWO_WHEELER',
    capturedAt: expect.any(Number),
  });
  expect(
    (await service.previewNearby('customer-a', search)).vehicles[0].key,
  ).toBe(result.vehicles[0].key);
  expect(
    (await service.previewNearby('customer-b', search)).vehicles[0].key,
  ).not.toBe(result.vehicles[0].key);
});
it('rechecks GPS before emitting preview', async () => {
  const { service, locations, positions } = setup();
  locations.fresh
    .mockResolvedValueOnce(positions.filter((p) => p.subject !== 'stale'))
    .mockResolvedValueOnce([]);
  expect((await service.previewNearby('customer', search)).vehicles).toEqual(
    [],
  );
});
it('fails closed on eligibility outage instead of claiming no vehicles', async () => {
  const { service, setUnavailable } = setup();
  setUnavailable();
  await expect(service.previewNearby('customer', search)).rejects.toMatchObject(
    {
      response: expect.objectContaining({
        code: 'DRIVER_ELIGIBILITY_UNAVAILABLE',
      }),
    },
  );
});
it('bounds refresh requests per viewer', async () => {
  const { service } = setup();
  for (let i = 0; i < 12; i++) await service.previewNearby('customer', search);
  await expect(service.previewNearby('customer', search)).rejects.toMatchObject(
    { response: expect.objectContaining({ code: 'PREVIEW_RATE_LIMITED' }) },
  );
});
it('requires valid coordinates, canonical category and radius at most 10 km', async () => {
  const previewNearby = jest.fn(() =>
    Promise.resolve({ generatedAt: Date.now(), vehicles: [] }),
  );
  const controller = new DriversController({ previewNearby } as any);
  for (const args of [
    ['26oops', '73', 'TWO_WHEELER', '5'],
    ['26', 'Infinity', 'TWO_WHEELER', '5'],
    ['26', '73', 'JCB', '5'],
    ['26', '73', 'TWO_WHEELER', '11'],
  ])
    await expect(
      controller.preview('customer', args[0], args[1], args[2], args[3]),
    ).rejects.toThrow();
  await controller.preview('customer', '26', '73', 'MINI_TRUCK', '5');
  expect(previewNearby).toHaveBeenCalledTimes(1);
  expect(previewNearby).toHaveBeenCalledWith('customer', {
    latitude: 26,
    longitude: 73,
    radiusKm: 5,
    vehicleCategory: 'MINI_TRUCK',
  });
});
