import { TripsService } from './trips.service';
const cursor = '11111111-1111-4111-8111-111111111111';
describe('paged driver history', () => {
  let db: any, service: TripsService;
  beforeEach(() => {
    db = {
      engineTrip: {
        findFirst: jest.fn().mockResolvedValue({ id: cursor }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new TripsService(db, {} as any, {} as any, {} as any);
  });
  it('filters terminal trips by the caller and ends an empty page truthfully', async () => {
    await expect(service.getDriverHistoryPage('driver-a')).resolves.toEqual({
      trips: [],
      nextCursor: null,
    });
    expect(db.engineTrip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          driverSubject: 'driver-a',
          status: { in: ['COMPLETED', 'CANCELLED'] },
        },
        take: 51,
      }),
    );
  });
  it('refuses malformed/foreign cursors before reading a page', async () => {
    await expect(
      service.getDriverHistoryPage('driver-a', 'invalid'),
    ).rejects.toThrow('Invalid history cursor');
    db.engineTrip.findFirst.mockResolvedValue(null);
    await expect(
      service.getDriverHistoryPage('driver-a', cursor),
    ).rejects.toThrow('Invalid history cursor');
    expect(db.engineTrip.findMany).not.toHaveBeenCalled();
  });
  it('uses a deterministic ordered continuation without returning the extra sentinel row', async () => {
    db.engineTrip.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
    );
    const load = jest
      .spyOn(service as any, 'load')
      .mockImplementation(async (...args: any[]) => ({
        trip: {
          id: args[0],
          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'COMPLETED',
        },
        booking: {
          payablePaise: 100n,
          distanceMeters: 1000,
          weightGrams: 1000,
        },
        stops: [],
      }));
    const page = await service.getDriverHistoryPage('driver-a', cursor);
    expect(page.trips).toHaveLength(50);
    expect(page.nextCursor).toBe('49');
    expect(load).toHaveBeenCalledTimes(50);
    expect(db.engineTrip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: cursor },
        skip: 1,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});
