import { createHash } from 'node:crypto';
import { notificationCopy } from './notification-copy';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { UserRole } from '../generated/prisma/client';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeviceTokenResponse,
  NotificationPreferencesResponse,
  RegisterDeviceTokenDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';

export type BackendNotificationType =
  | 'RIDE_OFFER'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'ARRIVED_AT_STOP'
  | 'STOP_DELIVERED'
  | 'TRIP_COMPLETED'
  | 'BOOKING_CANCELLED'
  | 'NEW_CHAT_MESSAGE';

export interface NotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly channelId: string;
  readonly data: Record<string, string>;
}

export interface TemplateVariables {
  pickup?: string;
  driverName?: string;
  vehicleType?: string;
  stopNumber?: number | string;
  reason?: string;
  senderName?: string;
  text?: string;
  [key: string]: unknown;
}

export interface DeviceTokenRecord {
  id?: string;
  token: string;
  userId: string;
  role: 'CUSTOMER' | 'DRIVER';
  platform?: string;
  language?: string;
  isActive?: boolean;
  lastSeenAt?: Date;
}

export interface NotificationPreferenceRecord {
  userId: string;
  pushEnabled: boolean;
  soundEnabled: boolean;
  language: string;
}

interface NotificationPrismaClient {
  deviceToken?: {
    upsert: (args: unknown) => Promise<DeviceTokenRecord>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    findMany: (args: unknown) => Promise<DeviceTokenRecord[]>;
  };
  notificationPreference?: {
    findUnique: (args: unknown) => Promise<NotificationPreferenceRecord | null>;
    upsert: (args: unknown) => Promise<NotificationPreferenceRecord>;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getInbox(userId: string, role: UserRole, cursor?: string) {
    if (
      cursor &&
      !(await this.prisma.inboxNotification.findFirst({ where: { id: cursor, userId, role } }))
    ) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Notification cursor not found',
      );
    }
    const rows = await this.prisma.inboxNotification.findMany({
      where: { userId, role },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        createdAt: true,
        readAt: true,
      },
    });
    const items = rows.slice(0, 50);
    return { items, nextCursor: rows.length > 50 ? (items[items.length - 1]?.id ?? null) : null };
  }

  async readInbox(userId: string, role: UserRole, id: string) {
    const item = await this.prisma.inboxNotification.findFirst({ where: { id, userId, role } });
    if (!item)
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Notification not found');
    await this.prisma.inboxNotification.updateMany({
      where: { id, userId, role, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  private get notificationPrisma(): NotificationPrismaClient {
    return this.prisma as unknown as NotificationPrismaClient;
  }

  /**
   * Registers/refreshes an FCM device token for an authenticated user.
   */
  async registerToken(userId: string, dto: RegisterDeviceTokenDto): Promise<DeviceTokenResponse> {
    try {
      const tokenDelegate = this.notificationPrisma.deviceToken;
      if (tokenDelegate) {
        const token = await tokenDelegate.upsert({
          where: { token: dto.token },
          create: {
            userId,
            token: dto.token,
            role: dto.role,
            platform: dto.platform || 'ANDROID',
            language: dto.language || 'en',
            isActive: true,
            lastSeenAt: new Date(),
          },
          update: {
            userId,
            role: dto.role,
            platform: dto.platform || 'ANDROID',
            language: dto.language || 'en',
            isActive: true,
            lastSeenAt: new Date(),
          },
        });
        this.logger.log(`Registered device token for user ${userId} (${dto.role})`);
        return {
          token: token.token,
          userId: token.userId,
          role: token.role,
          platform: token.platform,
          language: token.language,
        };
      }
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Device registration could not be saved',
      );
    }
    throw new AppError(
      ErrorCode.SERVICE_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      'Device storage unavailable',
    );
  }

  async unregisterToken(token: string, userId?: string): Promise<{ success: boolean }> {
    const delegate = this.notificationPrisma.deviceToken;
    if (!delegate)
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Device storage unavailable',
      );
    try {
      await delegate.updateMany({
        where: { token, ...(userId ? { userId } : {}) },
        data: { isActive: false },
      });
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Device revocation could not be saved',
      );
    }
    return { success: true };
  }

  /**
   * Retrieves notification preferences for a user.
   */
  async getPreferences(userId: string): Promise<NotificationPreferencesResponse> {
    try {
      const prefDelegate = this.notificationPrisma.notificationPreference;
      if (prefDelegate) {
        const prefs = await prefDelegate.findUnique({
          where: { userId },
        });
        if (prefs) {
          return {
            userId: prefs.userId,
            pushEnabled: prefs.pushEnabled,
            soundEnabled: prefs.soundEnabled,
            language: prefs.language,
          };
        }
      }
    } catch {
      // Ignore if table not yet migrated
    }
    return {
      userId,
      pushEnabled: true,
      soundEnabled: true,
      language: 'en',
    };
  }

  /**
   * Updates notification preferences for a user.
   */
  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    try {
      const prefDelegate = this.notificationPrisma.notificationPreference;
      if (prefDelegate) {
        const updated = await prefDelegate.upsert({
          where: { userId },
          create: {
            userId,
            pushEnabled: dto.pushEnabled ?? true,
            soundEnabled: dto.soundEnabled ?? true,
            language: dto.language || 'en',
          },
          update: {
            ...(dto.pushEnabled !== undefined ? { pushEnabled: dto.pushEnabled } : {}),
            ...(dto.soundEnabled !== undefined ? { soundEnabled: dto.soundEnabled } : {}),
            ...(dto.language ? { language: dto.language } : {}),
          },
        });
        return {
          userId: updated.userId,
          pushEnabled: updated.pushEnabled,
          soundEnabled: updated.soundEnabled,
          language: updated.language,
        };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not save notification preferences: ${message}`);
    }
    return {
      userId,
      pushEnabled: dto.pushEnabled ?? true,
      soundEnabled: dto.soundEnabled ?? true,
      language: dto.language ?? 'en',
    };
  }

  /**
   * Finds active device tokens for a user.
   */
  async getActiveTokens(
    userId: string,
    role?: 'CUSTOMER' | 'DRIVER',
  ): Promise<DeviceTokenRecord[]> {
    try {
      const tokenDelegate = this.notificationPrisma.deviceToken;
      if (tokenDelegate) {
        return await tokenDelegate.findMany({
          where: {
            userId,
            isActive: true,
            ...(role ? { role } : {}),
          },
        });
      }
    } catch {
      // Ignore if table not yet migrated
    }
    return [];
  }

  /**
   * Resolves an ID (which could be a Customer.id, Driver.id, or User.id) to base User.id
   */
  async resolveUserId(id: string, role?: 'CUSTOMER' | 'DRIVER'): Promise<string> {
    if (!id) return id;
    try {
      if (role === 'CUSTOMER') {
        const customer = await this.prisma.customer.findUnique({
          where: { id },
          select: { userId: true },
        });
        if (customer?.userId) return customer.userId;
      } else if (role === 'DRIVER') {
        const driver = await this.prisma.driver.findUnique({
          where: { id },
          select: { userId: true },
        });
        if (driver?.userId) return driver.userId;
      } else {
        const customer = await this.prisma.customer.findUnique({
          where: { id },
          select: { userId: true },
        });
        if (customer?.userId) return customer.userId;

        const driver = await this.prisma.driver.findUnique({
          where: { id },
          select: { userId: true },
        });
        if (driver?.userId) return driver.userId;
      }
    } catch {
      // Ignore if table/id not found
    }
    return id;
  }

  /**
   * Dispatches an event-driven push notification to a user.
   */
  async sendNotification(
    targetId: string,
    role: 'CUSTOMER' | 'DRIVER',
    type: BackendNotificationType,
    _variables: TemplateVariables = {},
    customData: Record<string, string> = {},
  ): Promise<number> {
    // Kept for producer compatibility; private variables never enter notification copy.
    void _variables;
    const userId = await this.resolveUserId(targetId, role);
    const inboxCopy = notificationCopy(type, role);
    if (!inboxCopy) return 0;
    // Stable producer IDs deduplicate retries per recipient without collapsing distinct events.
    const eventId = customData.eventId;
    const digest = eventId
      ? createHash('sha256')
          .update(JSON.stringify([userId, role, type, eventId]))
          .digest('hex')
      : undefined;
    const notificationId = digest
      ? [
          digest.slice(0, 8),
          digest.slice(8, 12),
          '4' + digest.slice(13, 16),
          '8' + digest.slice(17, 20),
          digest.slice(20, 32),
        ].join('-')
      : undefined;
    // Inbox persists independently of device tokens and push opt-out.
    let inbox: { id: string };
    try {
      inbox = await this.prisma.inboxNotification.create({
        data: {
          ...(notificationId ? { id: notificationId } : {}),
          userId,
          role,
          type,
          title: inboxCopy.title,
          body: inboxCopy.body,
          data: customData,
        },
      });
    } catch (error: unknown) {
      if (notificationId && (error as { code?: string })?.code === 'P2002') return 0;
      throw error;
    }
    const prefs = await this.getPreferences(userId);
    if (!prefs.pushEnabled) {
      this.logger.log(`Push notifications disabled by user preferences for ${userId}`);
      return 0;
    }

    const devices = await this.getActiveTokens(userId, role);
    if (devices.length === 0) {
      this.logger.debug(`No active device tokens found for user ${userId} (${role})`);
      return 0;
    }

    let sent = 0;
    for (const dev of new Map(devices.map((device) => [device.token, device])).values()) {
      const lang = prefs.language || dev.language || 'en';
      const copy = notificationCopy(type, role, lang)!;

      const payload: NotificationPayload = {
        title: copy.title,
        body: copy.body,
        channelId: copy.channelId,
        data: {
          ...customData,
          notificationId: inbox.id,
          notificationType: type,
          recipientId: userId,
          role,
        },
      };

      const delivered = await this.dispatchFcm(dev.token, payload);
      if (delivered) sent++;
    }

    return sent;
  }

  /**
   * Dispatches payload to FCM endpoint.
   */
  private async dispatchFcm(token: string, payload: NotificationPayload): Promise<boolean> {
    if (process.env.FCM_ENABLED !== 'true' || !process.env.FCM_PROJECT_ID) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const app =
        getApps().find((item) => item.name === 'pickup-push') ??
        initializeApp(
          {
            credential: applicationDefault(),
            projectId: process.env.FCM_PROJECT_ID,
          },
          'pickup-push',
        );
      // Lock-screen text is generic; private details are fetched from the authenticated inbox.
      const sending = getMessaging(app).send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            channelId: payload.channelId,
            sound: 'default',
            tag: payload.data.notificationId,
          },
        },
      });
      await Promise.race([
        sending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('FCM timeout')), 15000);
        }),
      ]);
      return true; // Accepted by FCM; not a device-delivery/read acknowledgement.
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        await this.unregisterToken(token, payload.data.recipientId).catch(() => {});
      }
      this.logger.warn(
        'FCM send was not accepted; check provider configuration or device registration',
      );
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
