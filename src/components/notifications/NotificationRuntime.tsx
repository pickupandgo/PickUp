import { notificationCopy } from '../../services/notifications/NotificationCopy';
import { authorizeTripNotification } from '../../services/notifications/TripNotificationNavigation';
import { getEngineClient } from '../../services/engine/engineClient';
import { parseEngineTrip, engineTripToActiveTrip } from '../../services/engine/dispatch';
import { createNotificationRequest } from '../../services/notifications/NotificationApi';
import { createNotificationHistory } from '../../services/notifications/NotificationHistory';
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import {
  getInitialNotification,
  getMessaging,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
} from '@react-native-firebase/messaging';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { colors, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../types/navigation';
import {
  attachNotificationNavigation,
  pushSession,
  pushState,
  chatNotifications,
  openChatNotification,
} from '../../services/notifications/notifications';
import { notificationInbox } from '../../services/notifications/NotificationInbox';
import { ChatService } from '../../services/chat/ChatService';
import { TripController } from '../../services/trip/TripController';
import { chatNotificationSignals } from '../../services/notifications/ChatNotificationSignals';
import { authorizeChatNotification } from '../../services/notifications/ChatNotificationNavigation';
import {
  createChatSummaryRequest,
  NotificationError,
} from '../../services/notifications/NotificationApi';
import { AuthService } from '../../services/auth/AuthService';
import { TripService } from '../../services/trip/TripService';

/** One listener set for the app, not one per tab or inbox mount. */
export function NotificationRuntime() {
  const { locale } = useI18n();
  useEffect(() => {
    const messaging = getMessaging();
    chatNotifications.setForeground(AppState.currentState === 'active');
    let previousTrip = TripController.getInstance().getTrip()?.id;
    const stopTrip = TripController.getInstance().subscribe(trip => {
      chatNotifications.setTrip(trip);
      if (
        !trip ||
        trip.id !== previousTrip ||
        [trip.status, trip.engineStatus].some(status =>
          ['COMPLETED', 'CANCELLED'].includes(String(status).toUpperCase()),
        )
      )
        ChatService.getInstance().clear();
      previousTrip = trip?.id;
    });
    let chatUid = getAuth().currentUser?.uid;
    const stopAuth = onAuthStateChanged(getAuth(), user => {
      if (user?.uid !== getAuth().currentUser?.uid) return;
      if (chatUid !== user?.uid) {
        ChatService.getInstance().clear();
        chatUid = user?.uid;
      }
      chatNotifications.setSession(user?.uid ?? null);
      pushSession.setUser(user, locale).catch(() => {});
    });
    const stopSignals = chatNotificationSignals.subscribe(event => {
      if (event.type === 'view') {
        chatNotifications.setViewing(event.view);
        return;
      }
      if (!chatNotifications.matches(event.ref, event.uid)) return;
      const synchronize = async () => {
        if (event.confirmed) await notificationInbox.refresh();
        if (
          getAuth().currentUser?.uid !== event.uid ||
          !chatNotifications.matches(event.ref, event.uid)
        )
          return;
        const readIds = notificationInbox
          .getSnapshot()
          .items.filter(
            item =>
              item.type === 'NEW_CHAT_MESSAGE' &&
              item.readAt === null &&
              (event.ref.kind === 'BOOKING'
                ? item.bookingId === event.ref.id
                : item.backendTripId === event.ref.id),
          )
          .map(item => item.id);
        if (
          !event.confirmed &&
          !readIds.length &&
          !chatNotifications.getSnapshot().unreadCount
        )
          return;
        const summary = await chatNotifications.refreshAfterRead();
        if (
          summary?.bookingId &&
          summary.unreadCount === 0 &&
          getAuth().currentUser?.uid === event.uid
        )
          await notificationInbox.markChatRead(summary.bookingId, readIds);
      };
      synchronize().catch(() => {});
    });
    const stopMessage = onMessage(messaging, message =>
      pushSession.receive(message),
    );
    const stopTap = onNotificationOpenedApp(messaging, message =>
      pushSession.tap(message),
    );
    const stopToken = onTokenRefresh(messaging, token =>
      pushSession.register(token).catch(() => {}),
    );
    let mounted = true;
    getInitialNotification(messaging)
      .then(message => {
        if (mounted && message) pushSession.tap(message);
      })
      .catch(() => {});
    const foreground = AppState.addEventListener('change', next => {
      chatNotifications.setForeground(next === 'active');
      if (next !== 'active') ChatService.getInstance().clear();
      if (next === 'active') {
        pushSession.register().catch(() => {});
        notificationInbox.refresh().catch(() => {});
      }
    });
    return () => {
      mounted = false;
      stopSignals();
      stopTrip();
      stopAuth();
      stopMessage();
      stopTap();
      stopToken();
      foreground.remove();
      chatNotifications.setForeground(false);
    };
  }, [locale]);
  return null;
}

export async function enablePushAlerts() {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  await pushSession.register();
  return true;
}

/** Lives inside Main so taps cannot bypass auth/onboarding navigation readiness. */
export function NotificationBanner() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { top } = useSafeAreaInsets();
  const { banner } = useSyncExternalStore(
    pushState.subscribe,
    pushState.getSnapshot,
  );
  const opening = useRef(0);
  const openingKey = useRef<string | null>(null);
  useEffect(() => {
    chatNotifications.setAllowed(true);
    notificationInbox.refresh().catch(() => {});
    return () => {
      chatNotifications.setAllowed(false);
    };
  }, []);
  useEffect(
    () =>
      attachNotificationNavigation((id, bookingId, target) => {
        if (target) {
          const uid = getAuth().currentUser?.uid;
          if (!uid) return;
          const epoch = ++opening.current;
          const current = () => getAuth().currentUser?.uid === uid;
          const user = getAuth().currentUser!;
          authorizeTripNotification(target, {
            uid: () => getAuth().currentUser?.uid,
            backendTrip: async backendTripId => {
              const row = await createNotificationRequest(user, current)(`/v1/trips/${backendTripId}`) as { tripId: string; bookingId: string; externalRef: string };
              if (!row || typeof row.externalRef !== 'string') throw new NotificationError('Trip is unavailable.');
              return row;
            },
            engineTrip: async rideId => {
              const response = await getEngineClient().request({ method: 'GET', path: `/rides/${rideId}/trip` }) as { trip?: unknown };
              return engineTripToActiveTrip(parseEngineTrip(response.trip));
            },
            eligibility: () => AuthService.getInstance().getOnboarding(),
          }).then(async destination => {
            if (opening.current !== epoch || !current()) return;
            if (target.notificationId) {
              await createNotificationHistory(user, current).markRead(target.notificationId).catch(() => {});
              if (opening.current !== epoch || !current()) return;
              notificationInbox.refresh().catch(() => {});
            }
            pushState.dismiss();
            navigation.navigate('Main', { screen: 'HomeTab', params: {
              screen: destination.screen,
              params: { tripId: destination.trip.id, notificationTrip: destination.trip },
            } });
          }).catch(() => {
            if (opening.current === epoch && current()) navigation.navigate('Notifications', target.notificationId ? { notificationId: target.notificationId } : undefined);
          });
        } else if (bookingId) {
          const uid = getAuth().currentUser?.uid;
          if (!uid) return;
          const key = `${uid}:${bookingId}`;
          if (openingKey.current === key) return;
          openingKey.current = key;
          const epoch = ++opening.current;
          authorizeChatNotification(bookingId, {
            uid: () => getAuth().currentUser?.uid,
            eligibility: () => AuthService.getInstance().getOnboarding(),
            activeTrip: () => TripService.getInstance().getActiveTrip(),
            summary: async backendTripId => {
              const user = getAuth().currentUser;
              if (!user || user.uid !== uid)
                throw new NotificationError('Your sign-in changed.');
              return createChatSummaryRequest(
                user,
                () => getAuth().currentUser?.uid === uid,
              )(backendTripId);
            },
          })
            .then(params => {
              if (
                opening.current === epoch &&
                getAuth().currentUser?.uid === uid
              ) {
                pushState.dismiss();
                navigation.navigate('TripChat', params);
              }
            })
            .catch(error => {
              if (
                opening.current === epoch &&
                getAuth().currentUser?.uid === uid
              )
                Alert.alert(
                  'Trip messages unavailable',
                  error instanceof NotificationError
                    ? error.message
                    : 'We could not verify an active authorized trip. Please refresh and try again.',
                );
            })
            .finally(() => {
              if (opening.current === epoch) openingKey.current = null;
            });
        } else {
          ++opening.current;
          openingKey.current = null;
          navigation.navigate(
            'Notifications',
            id ? { notificationId: id } : undefined,
          );
        }
      }),
    [navigation],
  );
  useEffect(
    () => () => {
      ++opening.current;
    },
    [],
  );
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(pushState.dismiss, 6000);
    return () => clearTimeout(timer);
  }, [banner]);
  if (!banner) return null;
  return (
    <View
      style={[styles.banner, { top: top + spacing.sm }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        style={styles.content}
        accessibilityRole="button"
        accessibilityLabel="Open new notification"
        onPress={() => {
          const id = banner.data?.bookingId;
          if (
            banner.data?.notificationType === 'NEW_CHAT_MESSAGE' &&
            typeof id === 'string'
          )
            openChatNotification(id);
          else pushSession.tap(banner);
        }}
      >
        <Text style={styles.title}>
          {notificationCopy(banner.data?.notificationType).title}
        </Text>
        <Text style={styles.body}>
          {notificationCopy(banner.data?.notificationType).body}
        </Text>
      </Pressable>
      <Pressable
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        onPress={pushState.dismiss}
      >
        <Text style={styles.body}>✕</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.containerPadding,
    right: spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    elevation: 5,
  },
  content: { flex: 1, padding: spacing.containerPadding },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: '600' },
  body: { color: colors.onSurfaceMuted, fontSize: 14 },
  dismiss: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
