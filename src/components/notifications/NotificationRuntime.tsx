import React, { useEffect, useSyncExternalStore } from 'react';
import { AppState, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getInitialNotification, getMessaging, onMessage, onNotificationOpenedApp, onTokenRefresh } from '@react-native-firebase/messaging';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { colors, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../types/navigation';
import { attachNotificationNavigation, pushSession, pushState } from '../../services/notifications/notifications';
import { notificationInbox } from '../../services/notifications/NotificationInbox';
import { ChatService } from '../../services/chat/ChatService';
import { TripController } from '../../services/trip/TripController';

/** One listener set for the app, not one per tab or inbox mount. */
export function NotificationRuntime() {
  const { locale } = useI18n();
  useEffect(() => {
    const messaging = getMessaging();
    let previousTrip = TripController.getInstance().getTrip()?.id;
    const stopTrip = TripController.getInstance().subscribe(trip => {
      if (!trip || trip.id !== previousTrip || [trip.status, trip.engineStatus].some(status => ['COMPLETED', 'CANCELLED'].includes(String(status).toUpperCase()))) ChatService.getInstance().clear();
      previousTrip = trip?.id;
    });
    let chatUid = getAuth().currentUser?.uid;
    const stopAuth = onAuthStateChanged(getAuth(), user => {
      if (user?.uid !== getAuth().currentUser?.uid) return;
      if (chatUid !== user?.uid) { ChatService.getInstance().clear(); chatUid = user?.uid; }
      pushSession.setUser(user, locale).catch(() => {});
    });
    const stopMessage = onMessage(messaging, message => pushSession.receive(message));
    const stopTap = onNotificationOpenedApp(messaging, message => pushSession.tap(message));
    const stopToken = onTokenRefresh(messaging, token => pushSession.register(token).catch(() => {}));
    let mounted = true;
    getInitialNotification(messaging).then(message => { if (mounted && message) pushSession.tap(message); }).catch(() => {});
    const foreground = AppState.addEventListener('change', next => {
      if (next !== 'active') ChatService.getInstance().clear();
      if (next === 'active') {
        pushSession.register().catch(() => {});
        notificationInbox.refresh().catch(() => {});
      }
    });
    return () => { mounted = false; stopTrip(); stopAuth(); stopMessage(); stopTap(); stopToken(); foreground.remove(); };
  }, [locale]);
  return null;
}

export async function enablePushAlerts() {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  await pushSession.register();
  return true;
}

/** Lives inside Main so taps cannot bypass auth/onboarding navigation readiness. */
export function NotificationBanner() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { top } = useSafeAreaInsets();
  const { banner } = useSyncExternalStore(pushState.subscribe, pushState.getSnapshot);
  useEffect(() => attachNotificationNavigation((id, bookingId) => {
    if (bookingId) navigation.navigate('TripChat', {bookingId});
    else navigation.navigate('Notifications', id ? { notificationId: id } : undefined);
  }), [navigation]);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(pushState.dismiss, 6000);
    return () => clearTimeout(timer);
  }, [banner]);
  if (!banner) return null;
  return <View style={[styles.banner, { top: top + spacing.sm }]} accessibilityLiveRegion="polite">
    <Pressable style={styles.content} accessibilityRole="button" accessibilityLabel="Open new notification" onPress={() => pushSession.tap(banner)}>
      <Text style={styles.title}>New update</Text>
      <Text style={styles.body}>Open notifications to view your latest update.</Text>
    </Pressable>
    <Pressable style={styles.dismiss} accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={pushState.dismiss}><Text style={styles.body}>✕</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  banner: { position: 'absolute', left: spacing.containerPadding, right: spacing.containerPadding,
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.outlineSubtle, elevation: 5 },
  content: { flex: 1, padding: spacing.containerPadding }, title: { color: colors.onSurface, fontSize: 16, fontWeight: '600' },
  body: { color: colors.onSurfaceMuted, fontSize: 14 }, dismiss: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
