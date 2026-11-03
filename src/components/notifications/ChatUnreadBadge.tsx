import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chatNotifications } from '../../services/notifications/notifications';
import { colors } from '../../theme';

/** Adds only the missing unread indicator to the existing chat buttons. */
export function ChatUnreadBadge({
  backendTripId,
}: {
  backendTripId?: string | null;
}) {
  const state = useSyncExternalStore(
    chatNotifications.subscribe,
    chatNotifications.getSnapshot,
  );
  const count =
    state.backendTripId === backendTripId ? state.unreadCount : null;
  if (!count) return null;
  return (
    <View
      pointerEvents="none"
      style={styles.badge}
      accessibilityLabel={`${count} unread chat messages`}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  text: { fontSize: 10, fontWeight: '700', color: colors.onError },
});
