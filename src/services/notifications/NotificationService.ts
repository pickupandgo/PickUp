import { Platform, PermissionsAndroid } from 'react-native';
import { ApiClient } from '../api/ApiClient';

export interface DriverNotificationPayload {
  readonly title?: string;
  readonly body?: string;
  readonly data?: {
    readonly notificationType?: string;
    readonly bookingId?: string;
    readonly tripId?: string;
    readonly recipientId?: string;
    readonly [key: string]: string | undefined;
  };
}

class DriverNotificationService {
  private currentFcmToken: string | null = null;
  private navigationRef: any = null;

  /**
   * Set root navigation reference for notification-tap deep links.
   */
  setNavigationRef(ref: any) {
    this.navigationRef = ref;
  }

  /**
   * Request push notification permissions on Android (Android 13+ requires POST_NOTIFICATIONS).
   */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            {
              title: 'Notification Permission',
              message: 'Allow MultipleRide Driver to send you trip requests, customer messages, and status updates.',
              buttonNeutral: 'Ask Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        } catch {
          return false;
        }
      }
      return true;
    }
    return true;
  }

  /**
   * Safe getter for Firebase messaging module without crashing if not installed or unlinked.
   */
  private getMessagingInstance(): any | null {
    try {
      const messagingModule = require('@react-native-firebase/messaging');
      return messagingModule.default ? messagingModule.default() : messagingModule();
    } catch {
      return null;
    }
  }

  /**
   * Obtains the FCM registration token and registers it with the backend.
   */
  async registerDeviceToken(locale: 'en' | 'hi' = 'en'): Promise<string | null> {
    const messaging = this.getMessagingInstance();

    try {
      let token = this.currentFcmToken;

      if (messaging) {
        token = await messaging.getToken();
      } else {
        token = `driver-device-${Date.now()}`;
      }

      if (!token) return null;
      this.currentFcmToken = token;

      // Register token with MultipleRide backend for role DRIVER
      await ApiClient.getInstance().request({
        endpoint: '/v1/notifications/tokens',
        method: 'POST',
        body: {
          token,
          role: 'DRIVER',
          platform: Platform.OS.toUpperCase() as 'ANDROID' | 'IOS',
          language: locale,
        },
        retryable: false,
      });

      return token;
    } catch {
      // Non-fatal if offline or backend is initializing
      return this.currentFcmToken;
    }
  }

  /**
   * Unregisters token upon driver logout.
   */
  async unregisterDeviceToken(): Promise<void> {
    if (!this.currentFcmToken) return;

    try {
      await ApiClient.getInstance().request({
        endpoint: '/v1/notifications/tokens',
        method: 'DELETE',
        body: { token: this.currentFcmToken },
        retryable: false,
      });
    } catch {
      // Suppress network error during logout
    } finally {
      this.currentFcmToken = null;
    }
  }

  /**
   * Handles driver tapping on a notification to navigate to the appropriate screen.
   */
  handleNotificationOpen(payload: DriverNotificationPayload) {
    if (!this.navigationRef) return;

    const data = payload.data || {};
    const notificationType = data.notificationType;

    if (notificationType === 'NEW_CHAT_MESSAGE') {
      this.navigationRef.navigate('ActiveTripChat', {
        tripId: data.tripId || 'active-trip',
      });
    } else if (notificationType === 'RIDE_OFFER') {
      if (data.offer) {
        try {
          const parsedOffer = JSON.parse(data.offer);
          this.navigationRef.navigate('TripOffer', {
            offer: parsedOffer,
            driverId: data.driverId || '',
          });
          return;
        } catch {
          // Fallback to home
        }
      }
      this.navigationRef.navigate('DriverHome');
    } else if (notificationType === 'BOOKING_CANCELLED') {
      this.navigationRef.navigate('DriverHome');
    }
  }

  /**
   * Initializes notification listeners if Firebase messaging is active.
   */
  initListeners(onForegroundMessage?: (payload: DriverNotificationPayload) => void) {
    const messaging = this.getMessagingInstance();
    if (!messaging) return () => {};

    // Foreground listener
    const unsubscribeForeground = messaging.onMessage(async (remoteMessage: any) => {
      const payload: DriverNotificationPayload = {
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        data: remoteMessage.data,
      };
      onForegroundMessage?.(payload);
    });

    // Background notification tap
    messaging.onNotificationOpenedApp((remoteMessage: any) => {
      this.handleNotificationOpen({
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        data: remoteMessage.data,
      });
    });

    // Cold start notification tap
    messaging.getInitialNotification().then((remoteMessage: any) => {
      if (remoteMessage) {
        this.handleNotificationOpen({
          title: remoteMessage.notification?.title,
          body: remoteMessage.notification?.body,
          data: remoteMessage.data,
        });
      }
    });

    return () => {
      unsubscribeForeground();
    };
  }
}

export const driverNotificationService = new DriverNotificationService();
