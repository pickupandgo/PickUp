import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Bilingual templates (English and pure Devanagari Hindi)
  private readonly templates: Record<
    BackendNotificationType,
    {
      en: (vars: Record<string, any>) => { title: string; body: string };
      hi: (vars: Record<string, any>) => { title: string; body: string };
      channelId: string;
    }
  > = {
    RIDE_OFFER: {
      en: (v) => ({
        title: 'New Ride Offer Available',
        body: `New ride request near ${v.pickup || 'your location'}. Tap to review.`,
      }),
      hi: (v) => ({
        title: 'नई सवारी का प्रस्ताव उपलब्ध है',
        body: `${v.pickup || 'आपके स्थान'} के पास नई सवारी अनुरोध। समीक्षा करने के लिए टैप करें।`,
      }),
      channelId: 'ride_updates',
    },
    DRIVER_ASSIGNED: {
      en: (v) => ({
        title: 'Driver Assigned',
        body: `${v.driverName || 'Driver'} (${v.vehicleType || 'Vehicle'}) has accepted your booking!`,
      }),
      hi: (v) => ({
        title: 'चालक नियुक्त हो गया है',
        body: `${v.driverName || 'चालक'} (${v.vehicleType || 'वाहन'}) ने आपकी बुकिंग स्वीकार कर ली है!`,
      }),
      channelId: 'ride_updates',
    },
    DRIVER_ARRIVED: {
      en: (v) => ({
        title: 'Driver Arrived at Pickup',
        body: `${v.driverName || 'Your driver'} has arrived at your pickup location.`,
      }),
      hi: (v) => ({
        title: 'चालक पिकअप पर पहुंच गया है',
        body: `${v.driverName || 'आपका चालक'} आपके पिकअप स्थान पर पहुंच चुका है।`,
      }),
      channelId: 'ride_updates',
    },
    TRIP_STARTED: {
      en: () => ({
        title: 'Trip Started',
        body: 'Your trip is now in transit. You can track the live progress in the app.',
      }),
      hi: () => ({
        title: 'यात्रा शुरू हो गई है',
        body: 'आपकी यात्रा अब प्रगति पर है। आप ऐप में लाइव देख सकते हैं।',
      }),
      channelId: 'ride_updates',
    },
    ARRIVED_AT_STOP: {
      en: (v) => ({
        title: `Driver Arrived at Stop ${v.stopNumber || 1}`,
        body: 'Driver is at the delivery stop. Prepare OTP for delivery verification.',
      }),
      hi: (v) => ({
        title: `चालक स्टॉप ${v.stopNumber || 1} पर पहुंच गया है`,
        body: 'चालक डिलीवरी स्टॉप पर है। डिलीवरी सत्यापन के लिए ओटीपी तैयार रखें।',
      }),
      channelId: 'ride_updates',
    },
    STOP_DELIVERED: {
      en: (v) => ({
        title: `Stop ${v.stopNumber || 1} Delivered`,
        body: 'Delivery confirmed with proof for this stop.',
      }),
      hi: (v) => ({
        title: `स्टॉप ${v.stopNumber || 1} डिलीवर हो गया है`,
        body: 'इस स्टॉप के लिए डिलीवरी सत्यापन प्रमाण के साथ पूरी हुई।',
      }),
      channelId: 'ride_updates',
    },
    TRIP_COMPLETED: {
      en: () => ({
        title: 'Trip Completed',
        body: 'Your ride has successfully completed. Thank you for using MultipleRide!',
      }),
      hi: () => ({
        title: 'यात्रा पूरी हो गई',
        body: 'आपकी यात्रा सफलतापूर्वक पूरी हो गई है। मल्टीपलराइड का उपयोग करने के लिए धन्यवाद!',
      }),
      channelId: 'ride_updates',
    },
    BOOKING_CANCELLED: {
      en: (v) => ({
        title: 'Booking Cancelled',
        body: v.reason ? `Booking was cancelled: ${v.reason}` : 'The booking has been cancelled.',
      }),
      hi: (v) => ({
        title: 'बुकिंग रद्द कर दी गई',
        body: v.reason ? `बुकिंग रद्द की गई: ${v.reason}` : 'बुकिंग रद्द कर दी गई है।',
      }),
      channelId: 'ride_updates',
    },
    NEW_CHAT_MESSAGE: {
      en: (v) => ({
        title: `New message from ${v.senderName || 'Driver'}`,
        body: v.text ? (v.text.length > 80 ? `${v.text.slice(0, 77)}...` : v.text) : 'New message received',
      }),
      hi: (v) => ({
        title: `${v.senderName || 'चालक'} से नया संदेश`,
        body: v.text ? (v.text.length > 80 ? `${v.text.slice(0, 77)}...` : v.text) : 'नया संदेश प्राप्त हुआ',
      }),
      channelId: 'chat_messages',
    },
  };

  /**
   * Registers/refreshes an FCM device token for an authenticated user.
   */
  async registerToken(userId: string, dto: RegisterDeviceTokenDto) {
    try {
      const token = await (this.prisma as any).deviceToken.upsert({
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
      return token;
    } catch (err: any) {
      this.logger.warn(`DeviceToken table fallback in memory: ${err.message}`);
      return { token: dto.token, userId, role: dto.role, platform: dto.platform, language: dto.language };
    }
  }

  /**
   * Unregisters an FCM device token on logout.
   */
  async unregisterToken(token: string) {
    try {
      await (this.prisma as any).deviceToken.updateMany({
        where: { token },
        data: { isActive: false },
      });
      this.logger.log(`Unregistered device token: ${token.slice(0, 10)}...`);
      return { success: true };
    } catch (err: any) {
      this.logger.warn(`Could not unregister token in DB: ${err.message}`);
      return { success: true };
    }
  }

  /**
   * Retrieves notification preferences for a user.
   */
  async getPreferences(userId: string) {
    try {
      const prefs = await (this.prisma as any).notificationPreference.findUnique({
        where: { userId },
      });
      if (prefs) return prefs;
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
  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    try {
      return await (this.prisma as any).notificationPreference.upsert({
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
    } catch (err: any) {
      this.logger.warn(`Could not save notification preferences: ${err.message}`);
      return { userId, ...dto };
    }
  }

  /**
   * Finds active device tokens for a user.
   */
  async getActiveTokens(userId: string, role?: 'CUSTOMER' | 'DRIVER') {
    try {
      return await (this.prisma as any).deviceToken.findMany({
        where: {
          userId,
          isActive: true,
          ...(role ? { role } : {}),
        },
      });
    } catch {
      return [];
    }
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
    variables: Record<string, any> = {},
    customData: Record<string, string> = {},
  ): Promise<number> {
    const userId = await this.resolveUserId(targetId, role);
    const prefs = await this.getPreferences(userId);
    if (!prefs.pushEnabled) {
      this.logger.log(`Push notifications disabled by user preferences for ${userId}`);
      return 0;
    }

    const template = this.templates[type];
    if (!template) {
      this.logger.warn(`No template found for notification type ${type}`);
      return 0;
    }

    const devices = await this.getActiveTokens(userId, role);
    if (devices.length === 0) {
      this.logger.debug(`No active device tokens found for user ${userId} (${role})`);
      return 0;
    }

    let sent = 0;
    for (const dev of devices) {
      const lang = prefs.language || dev.language || 'en';
      const copy = lang === 'hi' ? template.hi(variables) : template.en(variables);

      const payload: NotificationPayload = {
        title: copy.title,
        body: copy.body,
        channelId: template.channelId,
        data: {
          notificationType: type,
          recipientId: userId,
          role,
          ...customData,
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
    const serverKey = process.env.FIREBASE_SERVER_KEY || process.env.FCM_SERVER_KEY;

    if (serverKey) {
      try {
        const res = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${serverKey}`,
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title: payload.title,
              body: payload.body,
              android_channel_id: payload.channelId,
              sound: 'default',
            },
            data: payload.data,
            priority: 'high',
          }),
        });

        if (res.ok) {
          this.logger.log(`FCM delivered to ${token.slice(0, 10)}...`);
          return true;
        } else {
          const body = await res.text();
          this.logger.warn(`FCM delivery failed: ${body}`);
          if (body.includes('NotRegistered') || body.includes('InvalidRegistration')) {
            await this.unregisterToken(token);
          }
          return false;
        }
      } catch (err: any) {
        this.logger.error(`Failed to send FCM: ${err.message}`);
        return false;
      }
    }

    // Dev/Test simulation mode
    this.logger.log(
      `[SIMULATED PUSH] To: ${token.slice(0, 10)}... | Title: "${payload.title}" | Body: "${payload.body}" | Channel: ${payload.channelId} | Data: ${JSON.stringify(payload.data)}`,
    );
    return true;
  }
}
