import { RidesService } from './rides.service';

const quoteId = '00000000-0000-4000-8000-000000000002';
function setup() {
  const prisma = {
    engineBooking: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };
  const service = new RidesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}
it('scopes recovery to the authenticated subject and original quote', async () => {
  const { service, prisma } = setup();
  await expect(service.recoverRide('verified-A', quoteId)).resolves.toBeNull();
  expect(prisma.engineBooking.findFirst).toHaveBeenCalledWith({
    where: { customerSubject: 'verified-A', quoteId },
    orderBy: { createdAt: 'desc' },
  });
  expect(prisma.engineBooking.create).not.toHaveBeenCalled();
});
it('discovers active pending/assigned bookings without trusting a client customer ID', async () => {
  const { service, prisma } = setup();
  await service.recoverRide('verified-B');
  expect(prisma.engineBooking.findFirst).toHaveBeenCalledWith({
    where: {
      customerSubject: 'verified-B',
      status: { in: ['PENDING_REGISTRATION', 'OPEN', 'ASSIGNED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
});
it('rejects invalid quote IDs before accessing persistence', async () => {
  const { service, prisma } = setup();
  await expect(service.recoverRide('verified-A', 'invalid')).rejects.toThrow();
  expect(prisma.engineBooking.findFirst).not.toHaveBeenCalled();
});
