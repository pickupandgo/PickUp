import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService, type Tx } from '../prisma/prisma.service';
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
  async requireAuthorizedBooking(
    bookingId: string,
    principal: Principal,
    db: Tx | PrismaService = this.prisma,
  ) {
    const booking = await db.booking.findUnique({
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

  private requireActive(context: Awaited<ReturnType<ChatService['requireAuthorizedBooking']>>) {
    if (
      ['COMPLETED', 'CANCELLED'].includes(context.booking.status) ||
      (context.trip && ['COMPLETED', 'CANCELLED'].includes(context.trip.status))
    ) {
      throw new AppError(
        ErrorCode.CHAT_CLOSED,
        HttpStatus.GONE,
        'This trip has ended. Chat is closed.',
      );
    }
    if (!context.trip || !context.driverUserId) {
      throw new AppError(
        ErrorCode.CHAT_NOT_ASSIGNED,
        HttpStatus.CONFLICT,
        'Chat becomes available after driver assignment is confirmed.',
      );
    }
  }

  private async lockedContext(tx: Tx, bookingId: string, principal: Principal) {
    // Same booking -> trip lock order as assignment/cancellation. Shared locks do not
    // change business rows, but prevent authorization becoming stale during a chat write.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR SHARE`;
    const trips = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM trips WHERE booking_id = ${bookingId}::uuid FOR SHARE`;
    const context = await this.requireAuthorizedBooking(bookingId, principal, tx);
    this.requireActive(context);
    if (!trips.some((trip) => trip.id === context.trip!.id)) {
      throw new AppError(
        ErrorCode.CHAT_NOT_ASSIGNED,
        HttpStatus.CONFLICT,
        'Assignment confirmation is pending. Please retry.',
      );
    }
    return context;
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
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        await this.lockedContext(tx, bookingId, principal);
        const records = await tx.chatMessage.findMany({
          where: { bookingId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return records.map(this.toDto);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
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
    const now = new Date();
    let savedMessage: ChatRecord;
    let context: Awaited<ReturnType<ChatService['requireAuthorizedBooking']>>;

    try {
      const result = await this.prisma.runInTransaction(async (tx) => {
        const authorized = await this.lockedContext(tx, bookingId, principal);
        const saved = await tx.chatMessage.create({
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
        return { saved, authorized };
      });
      savedMessage = result.saved;
      context = result.authorized;
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (dto.clientMessageId && (error as { code?: string })?.code === 'P2002') {
        // The conflicting transaction has rolled back before this lookup. Never query
        // inside an aborted PostgreSQL transaction or replay for a revoked participant.
        try {
          const existing = await this.prisma.runInTransaction(async (tx) => {
            await this.lockedContext(tx, bookingId, principal);
            const record = await tx.chatMessage.findFirst({
              where: {
                bookingId,
                senderUserId: principal.userId,
                clientMessageId: dto.clientMessageId,
              },
            });
            if (
              record &&
              (record.text !== dto.text || (record.imageUrl ?? null) !== (dto.imageUrl ?? null))
            ) {
              throw new AppError(
                ErrorCode.IDEMPOTENCY_KEY_REUSED,
                HttpStatus.CONFLICT,
                'This message reference was already used for different content',
              );
            }
            return record ? this.toDto(record) : null;
          });
          if (existing) return existing;
        } catch (replayError) {
          if (replayError instanceof AppError) throw replayError;
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
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        await this.lockedContext(tx, bookingId, principal);
        const result = await tx.chatMessage.updateMany({
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
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Read acknowledgement could not be saved',
      );
    }
  }

  /** Only temporary chat content/its inbox alerts; never bookings, users or financial rows. */
  async purgeClosedConversations(): Promise<number> {
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
      const rows = await tx.$queryRaw<
        { count: number }[]
      >`SELECT public.purge_closed_chat_conversations(100) AS count`;
      return rows[0]?.count ?? 0;
    });
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
