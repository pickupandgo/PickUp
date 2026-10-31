const mockFcmSend = jest.fn();
jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'test' })),
  applicationDefault: jest.fn(() => ({})),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: mockFcmSend })),
}));
import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: {
    inboxNotification: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    deviceToken: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
    notificationPreference: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    customer: {
      findUnique: jest.Mock;
    };
    driver: {
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      inboxNotification: {
        create: jest.fn().mockResolvedValue({ id: 'notification' }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      deviceToken: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      notificationPreference: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      customer: {
        findUnique: jest.fn(),
      },
      driver: {
        findUnique: jest.fn(),
      },
    };

    service = new NotificationsService(mockPrisma as unknown as PrismaService);
  });

  describe('Device token management', () => {
    it('registers or updates a device token', async () => {
      mockPrisma.deviceToken.upsert.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        token: 'fcm-token-123',
        role: 'CUSTOMER',
      });

      const result = await service.registerToken('user-1', {
        token: 'fcm-token-123',
        role: 'CUSTOMER',
        platform: 'ANDROID',
        language: 'en',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.deviceToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'fcm-token-123' },
          create: expect.objectContaining({ userId: 'user-1', token: 'fcm-token-123' }),
        }),
      );
    });

    it('unregisters device token by deactivating it', async () => {
      mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unregisterToken('fcm-token-123');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'fcm-token-123' },
        data: { isActive: false },
      });
    });
  });

  describe('User ID Resolution', () => {
    it('resolves customer ID to user ID', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ userId: 'resolved-user-id' });

      const resolved = await service.resolveUserId('cust-123', 'CUSTOMER');
      expect(resolved).toBe('resolved-user-id');
      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({
        where: { id: 'cust-123' },
        select: { userId: true },
      });
    });

    it('resolves driver ID to user ID', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({ userId: 'resolved-driver-user-id' });

      const resolved = await service.resolveUserId('drv-123', 'DRIVER');
      expect(resolved).toBe('resolved-driver-user-id');
    });

    it('returns original ID if no customer/driver match found (already a user ID)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      const resolved = await service.resolveUserId('raw-user-id', 'CUSTOMER');
      expect(resolved).toBe('raw-user-id');
    });
  });

  describe('Bilingual Push Notification templates and delivery', () => {
    it('does not simulate push success when FCM is unconfigured', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: true,
        language: 'hi',
      });
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-hi-1', language: 'hi' }]);

      const sentCount = await service.sendNotification('user-1', 'CUSTOMER', 'DRIVER_ASSIGNED', {
        driverName: 'राकेश',
        vehicleType: 'ऑटो',
      });

      expect(sentCount).toBe(0);
    });

    it('suppresses push notifications when preferences disable push', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: false,
      });

      const sentCount = await service.sendNotification('user-1', 'CUSTOMER', 'DRIVER_ARRIVED');
      expect(sentCount).toBe(0);
      expect(mockPrisma.deviceToken.findMany).not.toHaveBeenCalled();
    });
  });
  it('scopes inbox reads and cursors to the authenticated user and role', async () => {
    mockPrisma.inboxNotification.findMany.mockResolvedValue([]);
    await expect(service.getInbox('user-A', 'CUSTOMER')).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(mockPrisma.inboxNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-A', role: 'CUSTOMER' }, take: 51 }),
    );
    mockPrisma.inboxNotification.findFirst.mockResolvedValue(null);
    await expect(service.getInbox('user-B', 'CUSTOMER', 'foreign-cursor')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('does not acknowledge another user notification', async () => {
    mockPrisma.inboxNotification.findFirst.mockResolvedValue(null);
    await expect(service.readInbox('user-B', 'CUSTOMER', 'notification-A')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockPrisma.inboxNotification.updateMany).not.toHaveBeenCalled();
  });
  it('persists inbox events even when push is disabled', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ userId: 'user-A' });
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      pushEnabled: false,
      language: 'en',
    });
    await service.sendNotification(
      'customer-A',
      'CUSTOMER',
      'DRIVER_ARRIVED',
      {},
      { bookingId: 'booking-A' },
    );
    expect(mockPrisma.inboxNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-A',
        role: 'CUSTOMER',
        type: 'DRIVER_ARRIVED',
        data: { bookingId: 'booking-A' },
      }),
    });
  });
  it('surfaces inbox DB failure instead of reporting an empty successful inbox', async () => {
    mockPrisma.inboxNotification.findMany.mockRejectedValue(new Error('DB unavailable'));
    await expect(service.getInbox('user-A', 'CUSTOMER')).rejects.toThrow('DB unavailable');
  });
  it('paginates using the last returned event and never returns the extra row', async () => {
    mockPrisma.inboxNotification.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ id: `n-${i}` })),
    );
    const page = await service.getInbox('user-A', 'CUSTOMER');
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('n-49');
  });
  it('marks read only within the authenticated owner and role', async () => {
    mockPrisma.inboxNotification.findFirst.mockResolvedValue({ id: 'own' });
    mockPrisma.inboxNotification.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.readInbox('user-A', 'CUSTOMER', 'own')).resolves.toEqual({
      success: true,
    });
    expect(mockPrisma.inboxNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'own', userId: 'user-A', role: 'CUSTOMER', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
  it('uses the Admin SDK and reports only provider acceptance', async () => {
    const oldEnabled = process.env.FCM_ENABLED;
    const oldProject = process.env.FCM_PROJECT_ID;
    process.env.FCM_ENABLED = 'true';
    process.env.FCM_PROJECT_ID = 'test-project';
    mockFcmSend.mockResolvedValueOnce('projects/test/messages/1');
    try {
      await expect(
        service['dispatchFcm']('token', {
          title: 'Private detail',
          body: 'Private chat text',
          channelId: 'chat_messages',
          data: { recipientId: 'user-A', role: 'CUSTOMER' },
        }),
      ).resolves.toBe(true);
      expect(mockFcmSend).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'token',
          notification: { title: 'PICKUP update', body: 'Open PICKUP to view your update.' },
        }),
      );
    } finally {
      if (oldEnabled === undefined) delete process.env.FCM_ENABLED;
      else process.env.FCM_ENABLED = oldEnabled;
      if (oldProject === undefined) delete process.env.FCM_PROJECT_ID;
      else process.env.FCM_PROJECT_ID = oldProject;
    }
  });
  it('invalidates rejected tokens only for their registered owner', async () => {
    const oldEnabled = process.env.FCM_ENABLED;
    const oldProject = process.env.FCM_PROJECT_ID;
    process.env.FCM_ENABLED = 'true';
    process.env.FCM_PROJECT_ID = 'test-project';
    mockFcmSend.mockRejectedValueOnce({ code: 'messaging/registration-token-not-registered' });
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    try {
      await expect(
        service['dispatchFcm']('token', {
          title: '',
          body: '',
          channelId: 'ride_updates',
          data: { recipientId: 'user-A' },
        }),
      ).resolves.toBe(false);
      expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'token', userId: 'user-A' },
        data: { isActive: false },
      });
    } finally {
      if (oldEnabled === undefined) delete process.env.FCM_ENABLED;
      else process.env.FCM_ENABLED = oldEnabled;
      if (oldProject === undefined) delete process.env.FCM_PROJECT_ID;
      else process.env.FCM_PROJECT_ID = oldProject;
    }
  });
  it('surfaces token registration/revocation storage errors', async () => {
    mockPrisma.deviceToken.upsert.mockRejectedValue(new Error('DB down'));
    mockPrisma.deviceToken.updateMany.mockRejectedValue(new Error('DB down'));
    await expect(
      service.registerToken('user-A', { token: 'token', role: 'CUSTOMER' }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(service.unregisterToken('token', 'user-A')).rejects.toMatchObject({ status: 503 });
  });
});
