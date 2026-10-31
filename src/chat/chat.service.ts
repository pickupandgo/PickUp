import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Principal } from '../auth/principal';
import { ChatMessageDto, SendChatMessageDto } from './chat.dto';

interface ChatRecord {
  id: string;
  clientMessageId?: string | null;
  bookingId: string;
  senderUserId: string;
  senderRole: string;
  text: string;
  imageUrl?: string | null;
  status?: string | null;
  createdAt: Date | string;
  readAt?: Date | string | null;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Verifies that the principal is authorized to participate in the booking's chat.
   * Returns the booking, trip, customerUserId, and driverUserId.
   */
  async requireAuthorizedBooking(bookingId: string, principal: Principal) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        trip: {
          include: {
            driver: true,
          },
        },
      },
    });

    if (!booking) {
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
    }

    const customerUserId = booking.customer.userId;
    const driverUserId = booking.trip?.driver?.userId ?? null;

    const isCustomer = principal.userId === customerUserId;
    const isDriver = driverUserId !== null && principal.userId === driverUserId;

    if (!isCustomer && !isDriver && principal.role !== 'ADMIN') {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'You are not authorized to view or send messages for this booking',
      );
    }

    return {
      booking,
      trip: booking.trip,
      customerUserId,
      driverUserId,
      isCustomer,
      isDriver,
    };
  }

  /**
   * Resolves a bookingId from a tripId.
   */
  async getBookingIdForTrip(tripId: string): Promise<string> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!trip) {
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
    }
    return trip.bookingId;
  }

  /**
   * Retrieves all messages for an authorized booking conversation.
   */
  async getMessages(bookingId: string, principal: Principal): Promise<ChatMessageDto[]> {
    await this.requireAuthorizedBooking(bookingId, principal);

    try {
      const records = await this.prisma.chatMessage.findMany({
        where: { bookingId },
        orderBy: { createdAt: 'asc' },
      });

      return records.map(this.toDto);
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Chat history is temporarily unavailable',
      );
    }
  }

  /**
   * Sends a message in a booking conversation, saves to database, and triggers push notification.
   */
  async sendMessage(
    bookingId: string,
    principal: Principal,
    dto: SendChatMessageDto,
  ): Promise<ChatMessageDto> {
    const context = await this.requireAuthorizedBooking(bookingId, principal);

    const now = new Date();
    let savedMessage: ChatRecord;

    try {
      savedMessage = await this.prisma.chatMessage.create({
        data: {
          bookingId,
          clientMessageId: dto.clientMessageId ?? null,
          senderUserId: principal.userId,
          senderRole: principal.role,
          text: dto.text,
          imageUrl: dto.imageUrl ?? null,
          status: 'SENT',
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (error: unknown) {
      if (dto.clientMessageId && (error as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.chatMessage.findFirst({
          where: {
            bookingId,
            senderUserId: principal.userId,
            clientMessageId: dto.clientMessageId,
          },
        });
        if (existing) {
          if (
            existing.text !== dto.text ||
            (existing.imageUrl ?? null) !== (dto.imageUrl ?? null)
          ) {
            throw new AppError(
              ErrorCode.IDEMPOTENCY_KEY_REUSED,
              HttpStatus.CONFLICT,
              'This message reference was already used for different content',
            );
          }
          return this.toDto(existing);
        }
      }
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Message was not confirmed. Retry with the same message reference.',
      );
    }

    try {
      // Determine recipient for push notification
      if (context.isCustomer && context.driverUserId) {
        // Customer sent to Driver
        await this.notifications.sendNotification(
          context.driverUserId,
          'DRIVER',
          'NEW_CHAT_MESSAGE',
          {
            senderName: 'Customer',
            text: dto.text,
          },
          {
            bookingId,
            tripId: context.trip?.id || '',
          },
        );
      } else if (context.isDriver) {
        // Driver sent to Customer
        await this.notifications.sendNotification(
          context.customerUserId,
          'CUSTOMER',
          'NEW_CHAT_MESSAGE',
          {
            senderName: 'Driver',
            text: dto.text,
          },
          {
            bookingId,
            tripId: context.trip?.id || '',
          },
        );
      }
    } catch {
      this.logger.warn('Chat saved; push notification failed');
    }
    return this.toDto(savedMessage);
  }

  /**
   * Marks unread messages as read for this booking.
   */
  async markAsRead(bookingId: string, principal: Principal): Promise<{ updatedCount: number }> {
    await this.requireAuthorizedBooking(bookingId, principal);

    try {
      const result = await this.prisma.chatMessage.updateMany({
        where: {
          bookingId,
          senderUserId: { not: principal.userId },
          readAt: null,
        },
        data: {
          status: 'READ',
          readAt: new Date(),
        },
      });

      return { updatedCount: result.count };
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Read acknowledgement could not be saved',
      );
    }
  }

  private toDto = (record: ChatRecord): ChatMessageDto => {
    const rawStatus = (record.status || 'SENT').toLowerCase();
    const status: ChatMessageDto['status'] =
      rawStatus === 'read'
        ? 'read'
        : rawStatus === 'delivered'
          ? 'delivered'
          : rawStatus === 'sending'
            ? 'sending'
            : rawStatus === 'error'
              ? 'error'
              : 'sent';

    return {
      id: record.id,
      clientMessageId: record.clientMessageId,
      bookingId: record.bookingId,
      senderUserId: record.senderUserId,
      senderRole: record.senderRole as 'CUSTOMER' | 'DRIVER' | 'SYSTEM',
      text: record.text,
      imageUrl: record.imageUrl,
      status,
      timestamp:
        record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : String(record.createdAt),
      readAt:
        record.readAt instanceof Date
          ? record.readAt.toISOString()
          : record.readAt
            ? String(record.readAt)
            : null,
    };
  };
}
