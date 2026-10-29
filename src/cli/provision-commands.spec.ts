import type { PrismaClient } from '../generated/prisma/client';
import { runProvisionCommand } from './provision-commands';

describe('admin ops provisioning commands', () => {
  function mockPrisma() {
    const tx = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      authIdentity: { findUnique: jest.fn(), create: jest.fn() },
      adminAction: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;
    return { prisma, tx };
  }

  it('creates an admin once and records the approved access reason', async () => {
    const { prisma, tx } = mockPrisma();
    tx.user.findUnique.mockResolvedValue(null);
    tx.authIdentity.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'admin-id', role: 'ADMIN', status: 'ACTIVE' });
    tx.authIdentity.create.mockResolvedValue({ id: 'identity-id' });
    tx.adminAction.create.mockResolvedValue({ id: 'audit-id' });

    await expect(
      runProvisionCommand(prisma, 'firebase', {
        kind: 'create-admin',
        phone: '+919876543210',
        subject: 'firebase_admin_1',
        reason: 'Approved staging administrator access ticket ADM-42',
      }),
    ).resolves.toMatchObject({
      userId: 'admin-id',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    });
    expect(tx.adminAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ADMIN_PROVISIONED',
          reason: 'Approved staging administrator access ticket ADM-42',
        }),
      }),
    );
  });

  it('is idempotent only for the exact active ADMIN identity', async () => {
    const { prisma, tx } = mockPrisma();
    const existing = {
      id: 'admin-id',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
      driver: null,
      customer: null,
    };
    tx.user.findUnique.mockResolvedValue(existing);
    tx.authIdentity.findUnique.mockResolvedValue({ userId: 'admin-id' });

    await expect(
      runProvisionCommand(prisma, 'firebase', {
        kind: 'create-admin',
        phone: '+919876543210',
        subject: 'firebase_admin_1',
        reason: 'Approved staging administrator access ticket ADM-42',
      }),
    ).resolves.toMatchObject({ userId: 'admin-id', role: 'ADMIN', accountStatus: 'ACTIVE' });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.authIdentity.create).not.toHaveBeenCalled();
    expect(tx.adminAction.create).not.toHaveBeenCalled();
  });

  it('never repurposes an existing account when only the requested phone matches', async () => {
    const { prisma, tx } = mockPrisma();
    tx.user.findUnique.mockResolvedValue({
      id: 'customer-id',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      driver: null,
      customer: { id: 'customer-profile-id' },
    });
    tx.authIdentity.findUnique.mockResolvedValue(null);

    await expect(
      runProvisionCommand(prisma, 'firebase', {
        kind: 'create-admin',
        phone: '+919876543210',
        subject: 'different_firebase_subject',
        reason: 'Approved staging administrator access ticket ADM-42',
      }),
    ).rejects.toThrow('A user with this phone number already exists');
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.authIdentity.create).not.toHaveBeenCalled();
    expect(tx.adminAction.create).not.toHaveBeenCalled();
  });

  it('suspends an active admin and records an immutable audit action', async () => {
    const { prisma, tx } = mockPrisma();
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      role: 'ADMIN',
      status: 'ACTIVE',
      driver: null,
      customer: null,
    });
    tx.user.update.mockResolvedValue({ id: 'admin-id', role: 'ADMIN', status: 'SUSPENDED' });
    tx.adminAction.create.mockResolvedValue({ id: 'audit-id' });

    await expect(
      runProvisionCommand(prisma, 'firebase', {
        kind: 'suspend-admin',
        phone: '+919876543210',
        reason: 'Approved incident response ticket INC-42',
      }),
    ).resolves.toMatchObject({ userId: 'admin-id', role: 'ADMIN', accountStatus: 'SUSPENDED' });
    expect(tx.adminAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ADMIN_SUSPENDED',
          reason: 'Approved incident response ticket INC-42',
        }),
      }),
    );
  });

  it('treats a repeated suspension as idempotent and does not create another audit action', async () => {
    const { prisma, tx } = mockPrisma();
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      role: 'ADMIN',
      status: 'SUSPENDED',
      driver: null,
      customer: null,
    });

    await expect(
      runProvisionCommand(prisma, 'firebase', {
        kind: 'suspend-admin',
        phone: '+919876543210',
        reason: 'Approved incident response ticket INC-42',
      }),
    ).resolves.toMatchObject({ userId: 'admin-id', accountStatus: 'SUSPENDED' });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.adminAction.create).not.toHaveBeenCalled();
  });
});
