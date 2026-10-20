import { Platform, PermissionsAndroid } from 'react-native';
import { request } from '../../api/http';

export interface RemoteNotificationPayload {
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

class CustomerNotificationService {
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
              message: 'Allow MultipleRide to send you updates about your trips and messages.',
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
   * Safe getter for Firebase messaging module without crashing if not installed.
   */
  private getMessagingInstance(): any | null {
    try {
      // Dynamic require to prevent bundling failure if native messaging library is unlinked
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
        // Fallback placeholder token for local testing
        token = `cust-device-${Date.now()}`;
      }

      if (!token) return null;
      this.currentFcmToken = token;

      // Register with MultipleRide backend
      await request('/v1/notifications/tokens', {
        method: 'POST',
        body: {
          token,
          role: 'CUSTOMER',
          platform: Platform.OS.toUpperCase() as 'ANDROID' | 'IOS',
          language: locale,
        },
        retries: 1,
      });

      return token;
    } catch {
      // Non-fatal if offline or backend is initializing
      return this.currentFcmToken;
    }
  }

  /**
   * Unregisters token upon logout.
   */
  async unregisterDeviceToken(): Promise<void> {
    if (!this.currentFcmToken) return;

    try {
      await request('/v1/notifications/tokens', {
        method: 'DELETE',
        body: { token: this.currentFcmToken },
        retries: 0,
      });
    } catch {
      // Suppress network error during logout
    } finally {
      this.currentFcmToken = null;
    }
  }

  /**
   * Handles user tapping on a notification to navigate to the appropriate screen.
   */
  handleNotificationOpen(payload: RemoteNotificationPayload) {
    if (!this.navigationRef) return;

    const data = payload.data || {};
    const notificationType = data.notificationType;

    if (notificationType === 'NEW_CHAT_MESSAGE') {
      this.navigationRef.navigate('ActiveTripStack', {
        screen: 'ActiveTripChatScreen',
        params: {
          bookingId: data.bookingId,
          tripId: data.tripId,
        },
      });
    } else if (
      notificationType === 'DRIVER_ASSIGNED' ||
      notificationType === 'DRIVER_ARRIVED' ||
      notificationType === 'TRIP_STARTED' ||
      notificationType === 'ARRIVED_AT_STOP' ||
      notificationType === 'STOP_DELIVERED'
    ) {
      this.navigationRef.navigate('ActiveTripStack', {
        screen: 'ActiveTripTrackingScreen',
        params: {
          bookingId: data.bookingId,
          tripId: data.tripId,
        },
      });
    }
  }

  /**
   * Initializes notification listeners if Firebase messaging is active.
   */
  initListeners(onForegroundMessage?: (payload: RemoteNotificationPayload) => void) {
    const messaging = this.getMessagingInstance();
    if (!messaging) return () => {};

    // Foreground listener
    const unsubscribeForeground = messaging.onMessage(async (remoteMessage: any) => {
      const payload: RemoteNotificationPayload = {
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

    // Check if app was opened from cold start by a notification
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

export const notificationService = new CustomerNotificationService();
