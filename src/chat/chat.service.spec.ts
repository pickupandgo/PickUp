import { ChatService } from './chat.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors/app-error';

describe('ChatService', () => {
  let service: ChatService;
  let mockPrisma: {
    booking: { findUnique: jest.Mock };
    trip: { findUnique: jest.Mock };
    chatMessage: { findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
  };
  let mockNotifications: {
    sendNotification: jest.Mock;
  };

  const mockBooking = {
    id: 'b-123',
    customer: { userId: 'cust-user-1' },
    trip: {
      id: 't-123',
      driver: { userId: 'driver-user-1' },
    },
  };

  beforeEach(() => {
    mockPrisma = {
      booking: {
        findUnique: jest.fn(),
      },
      trip: {
        findUnique: jest.fn(),
      },
      chatMessage: {
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockNotifications = {
      sendNotification: jest.fn().mockResolvedValue(1),
    };

    service = new ChatService(
      mockPrisma as unknown as PrismaService,
      mockNotifications as unknown as NotificationsService,
    );
  });

  const makePrincipal = (userId: string, role: 'CUSTOMER' | 'DRIVER' | 'ADMIN'): Principal => ({
    userId,
    role,
    driver: role === 'DRIVER' ? { id: 'd-1', approvalStatus: 'APPROVED' } : null,
    customer: role === 'CUSTOMER' ? { id: 'c-1' } : null,
    session: {
      authenticatedAt: new Date(),
      signInProvider: 'phone',
      phoneNumber: '+919999999999',
    },
  });

  describe('requireAuthorizedBooking', () => {
    it('allows the customer of the booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

      const customerPrincipal = makePrincipal('cust-user-1', 'CUSTOMER');

      const result = await service.requireAuthorizedBooking('b-123', customerPrincipal);
      expect(result.isCustomer).toBe(true);
      expect(result.customerUserId).toBe('cust-user-1');
    });

    it('allows the assigned driver of the booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

      const driverPrincipal = makePrincipal('driver-user-1', 'DRIVER');

      const result = await service.requireAuthorizedBooking('b-123', driverPrincipal);
      expect(result.isDriver).toBe(true);
      expect(result.driverUserId).toBe('driver-user-1');
    });

    it('throws FORBIDDEN for unrelated user', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

      const strangerPrincipal = makePrincipal('stranger-user-99', 'CUSTOMER');

      await expect(service.requireAuthorizedBooking('b-123', strangerPrincipal)).rejects.toThrow(
        AppError,
      );
    });
  });

  describe('sendMessage', () => {
    it('saves message and dispatches push notification to driver when customer sends', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      const now = new Date();
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'msg-1',
        bookingId: 'b-123',
        senderUserId: 'cust-user-1',
        senderRole: 'CUSTOMER',
        text: 'Where are you?',
        imageUrl: null,
        status: 'SENT',
        readAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const customerPrincipal = makePrincipal('cust-user-1', 'CUSTOMER');

      const sent = await service.sendMessage('b-123', customerPrincipal, {
        text: 'Where are you?',
      });

      expect(sent.text).toBe('Where are you?');
      expect(sent.senderRole).toBe('CUSTOMER');
      expect(mockNotifications.sendNotification).toHaveBeenCalledWith(
        'driver-user-1',
        'DRIVER',
        'NEW_CHAT_MESSAGE',
        expect.objectContaining({ text: 'Where are you?' }),
        expect.objectContaining({ bookingId: 'b-123', tripId: 't-123' }),
      );
    });
  });

  describe('markAsRead', () => {
    it('marks counterpart messages as read', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
      mockPrisma.chatMessage.updateMany.mockResolvedValue({ count: 2 });

      const customerPrincipal = makePrincipal('cust-user-1', 'CUSTOMER');

      const result = await service.markAsRead('b-123', customerPrincipal);
      expect(result.updatedCount).toBe(2);
      expect(mockPrisma.chatMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bookingId: 'b-123',
            senderUserId: { not: 'cust-user-1' },
            readAt: null,
          },
          data: expect.objectContaining({ status: 'READ' }),
        }),
      );
    });
  });
});
