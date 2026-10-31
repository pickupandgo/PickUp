import { DriversService } from '../drivers/drivers.service';
import { RidesService } from './rides.service';
import { rideView } from './ride-views';

function setup() {
  const booking: any = {
    id: '00000000-0000-4000-8000-000000000001',
    customerSubject: 'customer',
    status: 'OPEN',
    vehicleCategory: 'MINI_TRUCK',
    pickupLatitude: 1,
    pickupLongitude: 2,
    searchExhaustedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    payablePaise: 100n,
    weightGrams: 10000,
    distanceMeters: 100,
  };
  const offers: any[] = [];
  const trips: any[] = [];
  const categories: Record<string, string | null> = {
    near: 'TWO_WHEELER',
    first: 'MINI_TRUCK',
    second: 'MINI_TRUCK',
  };
  let fail = false;
  const backend = {
    getDriverEligibilityForSubject: jest.fn((id: string) =>
      Promise.resolve(
        fail
          ? { kind: 'UNAVAILABLE' }
          : {
              kind: 'OK',
              value: {
                eligible: true,
                vehicleCategory: categories[id],
              },
            },
      ),
    ),
  };
  const tx: any = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: booking.id }])),
    engineBooking: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...booking })),
      findUnique: jest.fn(() =>
        Promise.resolve({
          ...booking,
          stops: [],
          offers: [...offers].reverse(),
          trips: [...trips].reverse(),
        }),
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          booking.status === 'OPEN' &&
            !booking.searchExhaustedAt &&
            !offers.some(
              (o) => o.status === 'REQUESTED' && o.expiresAt > new Date(),
            )
            ? [booking]
            : [],
        ),
      ),
      update: jest.fn(({ data }: any) => {
        Object.assign(booking, data);
        return Promise.resolve(booking);
      }),
    },
    engineOffer: {
      updateMany: jest.fn(({ where, data }: any) => {
        offers
          .filter(
            (o) =>
              o.status === 'REQUESTED' && o.expiresAt <= where.expiresAt.lte,
          )
          .forEach((o) => Object.assign(o, data));
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.status
            ? offers.filter((o) => where.status.in.includes(o.status))
            : [...offers].reverse(),
        ),
      ),
      findFirst: jest.fn(() =>
        Promise.resolve(offers.find((o) => o.status === 'REQUESTED') ?? null),
      ),
      count: jest.fn(() => Promise.resolve(offers.length)),
      create: jest.fn(({ data }: any) => {
        const offer = { ...data, status: 'REQUESTED', createdAt: new Date() };
        offers.push(offer);
        return Promise.resolve(offer);
      }),
      update: jest.fn(({ where, data }: any) => {
        const offer = offers.find((o) => o.id === where.id);
        Object.assign(offer, data);
        return Promise.resolve(offer);
      }),
    },
    engineTrip: {
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: any) => {
        const trip = { ...data, status: 'ASSIGNED', createdAt: new Date() };
        trips.push(trip);
        return Promise.resolve(trip);
      }),
    },
  };
  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...tx,
    runInTransaction: jest.fn((work: any) => {
      const result = queue.then(() => work(tx));
      queue = result.catch(() => undefined);
      return result;
    }),
  };
  const drivers = new DriversService(prisma as never, backend as never);
  for (const [id, latitude] of [
    ['near', 1.0001],
    ['first', 1.001],
    ['second', 1.002],
  ] as const) {
    drivers.updateLocation(id, latitude, 2);
    drivers.markAvailable(id);
    // Client-supplied labels must not override the backend category.
    drivers.updateVehicleType(id, 'Mini Truck');
  }
  const outbox = {
    enqueue: jest.fn(() => Promise.resolve('outbox')),
    findPending: jest.fn(() => Promise.resolve(null)),
    flushBooking: jest.fn(() => Promise.resolve({ status: 'DELIVERED' })),
  };
  const service = new RidesService(
    prisma as never,
    backend as never,
    outbox as never,
    drivers,
    { viewForBooking: jest.fn(() => Promise.resolve(null)) } as never,
    { dispatch: { offerTtlSeconds: 15, pollIntervalMs: 0 } } as never,
  );
  return {
    service,
    drivers,
    booking,
    offers,
    trips,
    categories,
    tx,
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}

it('skips a nearer incompatible vehicle even when its local label claims Mini Truck', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  expect(h.offers.map((o) => o.driverSubject)).toEqual(['first']);
});

it('expires the first offer and offers the next candidate from the server sweep without a POST', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  h.offers[0].expiresAt = new Date(Date.now() - 1);
  await h.service.progressDispatch();
  expect(h.offers.map((o) => [o.driverSubject, o.status])).toEqual([
    ['first', 'EXPIRED'],
    ['second', 'REQUESTED'],
  ]);
  expect(h.booking.searchExhaustedAt).toBeNull();
});

it('progresses rejection, then reports exhaustion separately from an individual rejection', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  const ride = await h.service.rejectRide('first', h.booking.id);
  expect(ride).toMatchObject({ status: 'REQUESTED', searchStatus: 'OFFERED' });
  h.offers[1].expiresAt = new Date(Date.now() - 1);
  await h.service.progressDispatch();
  expect(h.booking.searchExhaustedAt).toBeInstanceOf(Date);
  expect(
    rideView(
      {
        booking: h.booking,
        stops: [],
        offers: [...h.offers].reverse(),
        trip: null,
      },
      new Date(),
    ),
  ).toMatchObject({ status: 'REJECTED', searchStatus: 'EXHAUSTED' });
});

it('does not classify a backend eligibility outage as exhausted search', async () => {
  const h = setup();
  h.fail();
  await h.service.progressDispatch();
  expect(h.offers).toHaveLength(0);
  expect(h.booking.searchExhaustedAt).toBeNull();
});

it('rejects revoked or wrong-category eligibility at accept time', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  h.categories.first = 'TWO_WHEELER';
  await expect(h.service.acceptRide('first', h.booking.id)).rejects.toThrow();
  expect(h.trips).toHaveLength(0);
});

it('serializes concurrent dispatch and concurrent accepts into one offer and trip', async () => {
  const h = setup();
  await Promise.all([
    h.service['dispatch'](h.booking),
    h.service['dispatch'](h.booking),
  ]);
  expect(h.offers).toHaveLength(1);
  const result = await Promise.allSettled([
    h.service.acceptRide('first', h.booking.id),
    h.service.acceptRide('second', h.booking.id),
  ]);
  expect(h.trips).toHaveLength(1);
  expect(h.trips[0].driverSubject).toBe('first');
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
});

it('fails closed on an older eligibility response missing a verified category', async () => {
  const h = setup();
  h.categories.first = null;
  await expect(
    h.drivers.requireEligibleForNewWork('first', 'MINI_TRUCK'),
  ).rejects.toThrow();
});

it('retries after an eligibility outage rather than exhausting drivers removed only by that outage', async () => {
  const h = setup();
  h.fail();
  await h.service.progressDispatch();
  expect(h.drivers.findById('first').isAvailable).toBe(true);
  expect(h.booking.searchExhaustedAt).toBeNull();
});

it('resumes search after the eligibility service recovers', async () => {
  const h = setup();
  h.fail();
  await h.service.progressDispatch();
  h.recover();
  await h.service.progressDispatch();
  expect(h.offers.map((o) => o.driverSubject)).toEqual(['first']);
});

it('blocks revoked eligibility before creating an assignment', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  jest
    .spyOn(h.drivers, 'checkEligibility')
    .mockResolvedValue({ kind: 'INELIGIBLE' });
  await expect(h.service.acceptRide('first', h.booking.id)).rejects.toThrow();
  expect(h.trips).toHaveLength(0);
});

it('starts a server scan on bootstrap so an expired persisted offer progresses after restart', async () => {
  const h = setup();
  await h.service['dispatch'](h.booking);
  h.offers[0].expiresAt = new Date(Date.now() - 1);
  Object.assign(h.service['config'].dispatch, { pollIntervalMs: 1000 });
  try {
    h.service.onApplicationBootstrap();
    await h.service.progressDispatch();
    expect(h.offers[1].driverSubject).toBe('second');
  } finally {
    await h.service.onModuleDestroy();
  }
});
