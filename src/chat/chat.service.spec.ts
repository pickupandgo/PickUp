import { ChatService } from './chat.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors/app-error';

describe('ChatService', () => {
  let service: ChatService;
  let mockPrisma: {
    runInTransaction: jest.Mock;
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    booking: { findUnique: jest.Mock };
    trip: { findUnique: jest.Mock };
    chatMessage: {
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
    };
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
      runInTransaction: jest.fn((work) => work(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 't-123' }]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      booking: {
        findUnique: jest.fn(),
      },
      trip: {
        findUnique: jest.fn(),
      },
      chatMessage: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
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
        expect.objectContaining({ senderName: 'Customer' }),
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
  it('never acknowledges DB create failure or sends a push for an unsaved message', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.chatMessage.create.mockRejectedValue(new Error('DB unavailable'));
    await expect(
      service.sendMessage('b-123', makePrincipal('cust-user-1', 'CUSTOMER'), { text: 'Hello' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mockNotifications.sendNotification).not.toHaveBeenCalled();
  });
  it('reports read/ack storage failures rather than empty success', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.chatMessage.findMany.mockRejectedValue(new Error('DB unavailable'));
    mockPrisma.chatMessage.updateMany.mockRejectedValue(new Error('DB unavailable'));
    const principal = makePrincipal('cust-user-1', 'CUSTOMER');
    await expect(service.getMessages('b-123', principal)).rejects.toMatchObject({ status: 503 });
    await expect(service.markAsRead('b-123', principal)).rejects.toMatchObject({ status: 503 });
  });
  it('replays an identical client message reference and refuses different content', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.chatMessage.create.mockRejectedValue({ code: 'P2002' });
    mockPrisma.chatMessage.findFirst.mockResolvedValue({
      id: 'saved',
      bookingId: 'b-123',
      senderUserId: 'cust-user-1',
      senderRole: 'CUSTOMER',
      text: 'Hello',
      imageUrl: null,
      clientMessageId: 'client_key_123456789',
      status: 'SENT',
      createdAt: new Date(),
    });
    const principal = makePrincipal('cust-user-1', 'CUSTOMER');
    await expect(
      service.sendMessage('b-123', principal, {
        text: 'Hello',
        clientMessageId: 'client_key_123456789',
      }),
    ).resolves.toMatchObject({ id: 'saved', clientMessageId: 'client_key_123456789' });
    await expect(
      service.sendMessage('b-123', principal, {
        text: 'Changed',
        clientMessageId: 'client_key_123456789',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockNotifications.sendNotification).not.toHaveBeenCalled();
  });
  it('keeps a durable send successful when push notification fails', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.chatMessage.create.mockResolvedValue({
      id: 'saved',
      bookingId: 'b-123',
      senderRole: 'CUSTOMER',
      text: 'Hello',
      status: 'SENT',
      createdAt: new Date(),
    });
    mockNotifications.sendNotification.mockRejectedValue(new Error('Push unavailable'));
    await expect(
      service.sendMessage('b-123', makePrincipal('cust-user-1', 'CUSTOMER'), { text: 'Hello' }),
    ).resolves.toMatchObject({ id: 'saved', status: 'sent' });
  });
  it.each(['COMPLETED', 'CANCELLED'])(
    'denies every operation on a %s booking before touching messages',
    async (status) => {
      mockPrisma.booking.findUnique.mockResolvedValue({ ...mockBooking, status });
      const principal = makePrincipal('cust-user-1', 'CUSTOMER');
      for (const operation of [
        () => service.getMessages('b-123', principal),
        () => service.sendMessage('b-123', principal, { text: 'Hello' }),
        () => service.markAsRead('b-123', principal),
      ]) {
        await expect(operation()).rejects.toMatchObject({ status: 410, code: 'CHAT_CLOSED' });
      }
      expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.chatMessage.updateMany).not.toHaveBeenCalled();
      expect(mockNotifications.sendNotification).not.toHaveBeenCalled();
    },
  );
  it('denies a closed trip even if its booking projection is not yet closed', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({
      ...mockBooking,
      trip: { ...mockBooking.trip, status: 'CANCELLED' },
    });
    await expect(
      service.getMessages('b-123', makePrincipal('driver-user-1', 'DRIVER')),
    ).rejects.toMatchObject({ status: 410 });
  });
  it('requires confirmed assignment and rejects a trip created after the lock snapshot', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue({ ...mockBooking, trip: null });
    await expect(
      service.getMessages('b-123', makePrincipal('cust-user-1', 'CUSTOMER')),
    ).rejects.toMatchObject({ status: 409 });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await expect(
      service.getMessages('b-123', makePrincipal('cust-user-1', 'CUSTOMER')),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
  });
  it('never exposes messages to another driver or customer', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    for (const role of ['CUSTOMER', 'DRIVER'] as const) {
      await expect(
        service.getMessages('b-123', makePrincipal('stranger', role)),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
  });
  it('only delegates bounded cleanup to the restricted database function', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ count: 3 }]);
    await expect(service.purgeClosedConversations()).resolves.toBe(3);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith([
      'SELECT public.purge_closed_chat_conversations(100) AS count',
    ]);
  });
});
