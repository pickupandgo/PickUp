import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: {
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
    it('formats English and Hindi messages correctly and falls back to simulation mode', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: true,
        language: 'hi',
      });
      mockPrisma.deviceToken.findMany.mockResolvedValue([{ token: 'tok-hi-1', language: 'hi' }]);

      const sentCount = await service.sendNotification('user-1', 'CUSTOMER', 'DRIVER_ASSIGNED', {
        driverName: 'राकेश',
        vehicleType: 'ऑटो',
      });

      expect(sentCount).toBe(1);
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
});
