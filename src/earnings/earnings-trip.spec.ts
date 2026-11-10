import { EarningsService } from './earnings.service';
describe('driver trip earning identity', () => {
  it('scopes the lookup to both driver and selected payment trip', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'earning-a', tripId: 'trip-a', status: 'ON_HOLD' });
    const service = new EarningsService({ driverEarning: { findFirst } } as any, {} as any);
    await expect(service.getForDriverTrip('driver-a', 'trip-a')).resolves.toMatchObject({
      tripId: 'trip-a',
      status: 'ON_HOLD',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driverId: 'driver-a', tripId: 'trip-a' } }),
    );
    findFirst.mockResolvedValue(null);
    await expect(service.getForDriverTrip('driver-b', 'trip-a')).resolves.toBeNull();
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { driverId: 'driver-b', tripId: 'trip-a' } }),
    );
  });
});
