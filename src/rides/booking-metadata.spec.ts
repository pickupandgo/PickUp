import { createRideSchema, type CreateRideRequest } from './rides.types';
import { RidesService } from './rides.service';
import { rideView, offerView } from './ride-views';
import { tripView } from '../trips/trip-views';
import type {
  EngineBooking,
  EngineStop,
  EngineOffer,
  EngineTrip,
} from '../generated/prisma/client';

const metadata = {
  goodsType: 'Boxes',
  goodsDescription: 'QA goods',
  declaredValue: '1200.50',
  specialInstructions: 'Keep upright',
  sender: { name: 'QA sender', phone: '0000000000' },
  pickupInstructions: 'Gate A',
};
const request: CreateRideRequest = {
  quoteId: '12345678-1234-4234-8234-123456789abc',
  paymentMethod: 'PAY_AT_DELIVERY',
  metadata,
  drops: [
    {
      address: 'Drop one',
      receiver: { name: 'QA receiver' },
      instructions: 'Gate B',
    },
  ],
};

it('validates informational metadata and rejects identity, amount and insurance injection', () => {
  expect(createRideSchema.parse(request).metadata).toEqual(metadata);
  for (const field of ['farePaise', 'customerId', 'insured']) {
    expect(
      createRideSchema.safeParse({
        ...request,
        metadata: { ...metadata, [field]: 123 },
      }).success,
    ).toBe(false);
  }
  expect(
    createRideSchema.safeParse({
      ...request,
      metadata: { goodsDescription: 'x'.repeat(1001) },
    }).success,
  ).toBe(false);
  expect(
    createRideSchema.safeParse({
      ...request,
      metadata: { declaredValue: '-1' },
    }).success,
  ).toBe(false);
  expect(
    createRideSchema.safeParse({
      quoteId: request.quoteId,
      paymentMethod: request.paymentMethod,
    }).success,
  ).toBe(true);
});

it('writes metadata and ordered drop instructions within the existing booking transaction', async () => {
  const tx = {
    engineBooking: {
      create: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)),
    },
    engineStop: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    runInTransaction: jest.fn(
      async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const backend = {
    getFareQuote: jest.fn(() =>
      Promise.resolve({
        kind: 'OK',
        value: {
          quoteId: request.quoteId,
          redeemed: false,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          pickup: { latitude: 1, longitude: 2 },
          drops: [
            {
              sequence: 1,
              latitude: 3,
              longitude: 4,
              distanceMeters: 100,
              payablePaise: 100,
            },
          ],
          weightKg: 10,
          vehicleCategory: 'MINI_TRUCK',
          distanceMeters: 100,
          payablePaise: 100,
        },
      }),
    ),
  };
  const service = Object.assign(
    Object.create(RidesService.prototype) as object,
    { prisma, backend },
  ) as unknown as {
    createBooking: (
      uid: string,
      input: CreateRideRequest,
    ) => Promise<EngineBooking>;
  };
  const saved = await service.createBooking('verified-subject', request);
  expect(prisma.runInTransaction).toHaveBeenCalledTimes(1);
  expect(saved.metadata).toEqual(metadata);
  expect(saved.customerSubject).toBe('verified-subject');
  expect(tx.engineStop.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({
        sequence: 1,
        instructions: 'Gate B',
        receiverName: 'QA receiver',
      }),
    ],
  });
});

it('includes persisted metadata and instructions in customer, driver offer and trip read models', () => {
  const date = new Date();
  const booking = {
    id: 'booking',
    status: 'OPEN',
    metadata,
    payablePaise: 100n,
    weightGrams: 10000,
    distanceMeters: 100,
    createdAt: date,
    updatedAt: date,
  } as unknown as EngineBooking;
  const stop = {
    id: 'stop',
    sequence: 1,
    instructions: 'Gate B',
    receiverName: 'QA receiver',
    status: 'PENDING',
    distanceMeters: 100,
    payablePaise: 100n,
  } as EngineStop;
  const offer = {
    id: 'offer',
    status: 'REQUESTED',
    expiresAt: date,
    createdAt: date,
  } as EngineOffer;
  const trip = {
    id: 'trip',
    status: 'IN_TRANSIT',
    currentStopIndex: 0,
    createdAt: date,
    updatedAt: date,
  } as EngineTrip;
  expect(
    rideView({ booking, stops: [stop], offers: [], trip: null }, date),
  ).toMatchObject({ metadata, drops: [{ instructions: 'Gate B' }] });
  expect(offerView(booking, [stop], offer)).toMatchObject({
    metadata,
    drops: [{ instructions: 'Gate B' }],
  });
  expect(tripView({ booking, stops: [stop], trip })).toMatchObject({
    metadata,
    stops: [{ instructions: 'Gate B' }],
  });
});
