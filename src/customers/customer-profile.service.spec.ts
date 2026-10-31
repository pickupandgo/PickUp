import { CustomersService } from './customers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Principal } from '../auth/principal';

describe('Customer profile ownership and persistence', () => {
  const principal: Principal = {
    userId: 'owner',
    role: 'CUSTOMER',
    driver: null,
    customer: { id: 'profile' },
    session: { authenticatedAt: null, signInProvider: 'phone', phoneNumber: null },
  };
  function setup() {
    const saved = {
      id: 'profile',
      name: 'Edited Name',
      email: 'edited@example.com',
      age: 25,
      address: 'Synthetic staging address',
      createdAt: new Date('2026-01-01'),
      user: { phone: '+910000000000', status: 'ACTIVE' },
    };
    const customer = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(saved),
      findFirst: jest.fn().mockResolvedValue({ id: 'profile' }),
    };
    const prisma = {
      customer,
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({ customer })),
    };
    return { service: new CustomersService(prisma as unknown as PrismaService), customer };
  }
  it('writes a strict allowlist for the authenticated ACTIVE CUSTOMER only', async () => {
    const { service, customer } = setup();
    const result = await service.update(principal, { name: 'Edited Name', age: 25 });
    expect(customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'profile', userId: 'owner', user: { role: 'CUSTOMER', status: 'ACTIVE' } },
      data: { name: 'Edited Name', age: 25 },
    });
    expect(result).toMatchObject({
      name: 'Edited Name',
      email: 'edited@example.com',
      age: 25,
      address: 'Synthetic staging address',
    });
  });
  it('preserves omission and allows explicit clearing', async () => {
    const { service, customer } = setup();
    await service.update(principal, { age: null, address: null });
    expect(customer.updateMany.mock.calls[0]?.[0].data).toEqual({ age: null, address: null });
  });
  it('treats empty PATCH as an ownership-checked no-op', async () => {
    const { service, customer } = setup();
    await service.update(principal, {});
    expect(customer.updateMany).not.toHaveBeenCalled();
    expect(customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'profile', userId: 'owner', user: { role: 'CUSTOMER', status: 'ACTIVE' } },
      select: { id: true },
    });
  });
  it('denies stale, disabled or mismatched ownership without reporting success', async () => {
    const { service, customer } = setup();
    customer.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.update(principal, { age: 25 })).rejects.toMatchObject({ status: 403 });
    expect(customer.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('rejects DRIVER principals even if a forged customer field is supplied internally', async () => {
    const { service, customer } = setup();
    await expect(
      service.update({ ...principal, role: 'DRIVER' }, { name: 'Untrusted' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(customer.updateMany).not.toHaveBeenCalled();
  });
  it('propagates database failures', async () => {
    const { service, customer } = setup();
    customer.updateMany.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.update(principal, { name: 'Edited Name' })).rejects.toThrow(
      'DB unavailable',
    );
    expect(customer.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
