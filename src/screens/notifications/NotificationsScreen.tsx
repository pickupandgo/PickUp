import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { NotificationCard } from '../../components/molecules/NotificationCard';
import { enablePushAlerts } from '../../components/notifications/NotificationRuntime';
import { notificationInbox, notificationPresentation } from '../../services/notifications/NotificationInbox';
import { pushSession, pushState } from '../../services/notifications/notifications';
import { colors, spacing, typography } from '../../theme';
import type { RootScreenProps } from '../../types/navigation';

export function NotificationsScreen({ navigation, route }: RootScreenProps<'Notifications'>) {
  const inbox = useSyncExternalStore(notificationInbox.subscribe, notificationInbox.getSnapshot);
  const push = useSyncExternalStore(pushState.subscribe, pushState.getSnapshot);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(route.params?.notificationId);
  const attemptedRead = useRef<string | null>(null);
  useEffect(() => { notificationInbox.refresh().catch(() => {}); }, []);
  useEffect(() => { setSelectedId(route.params?.notificationId); }, [route.params?.notificationId]);
  useEffect(() => {
    // Only mark a push reference if it resolves to a recipient-authorized backend record.
    if (selectedId && attemptedRead.current !== selectedId && inbox.items.some(item => item.id === selectedId && item.readAt === null)) {
      attemptedRead.current = selectedId;
      notificationInbox.markRead(selectedId).catch(() => {});
    }
  }, [selectedId, inbox.items]);
  const refresh = () => {
    notificationInbox.refresh().catch(() => {});
    pushSession.register().catch(() => {});
  };
  const enable = async () => {
    try {
      const allowed = await enablePushAlerts();
      setPermissionMessage(allowed ? 'Notification permission is enabled on this device.' : 'Enable notifications in Android app settings to receive alerts.');
    } catch { setPermissionMessage('Could not enable alerts. Please try again.'); }
  };
  return <SafeAreaView style={styles.root}>
    <AppHeader title="Notifications" showBackButton onBackPress={() => navigation.goBack()} />
    <View style={styles.toolbar}>
      <Text style={styles.secondary} accessibilityLiveRegion="polite">{inbox.unreadCount === null ? 'Unread count unavailable' : `${inbox.unreadCount} unread`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Mark all as read" disabled={!inbox.available || !inbox.unreadCount || inbox.updating} onPress={() => { notificationInbox.markRead().catch(() => {}); }}
        style={styles.action} accessibilityState={{ disabled: !inbox.available || !inbox.unreadCount || inbox.updating }}>
        <Text style={[styles.actionText, (!inbox.available || !inbox.unreadCount || inbox.updating) && styles.disabled]}>Mark all as read</Text>
      </Pressable>
    </View>
    <FlatList data={inbox.items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={inbox.loading && inbox.items.length > 0} onRefresh={refresh} />}
      onEndReached={() => { notificationInbox.loadMore().catch(() => {}); }} onEndReachedThreshold={0.3}
      renderItem={({ item }) => {
        const presentation = notificationPresentation(item.type);
        const date = new Date(item.createdAt);
        return <NotificationCard title={item.title} description={item.body} isRead={item.readAt !== null}
          timestamp={Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString()}
          iconName={presentation.icon} category={presentation.category}
          reference={item.relatedEntityId ? `${item.relatedEntityType ?? 'Reference'}: ${item.relatedEntityId}` : undefined}
          expanded={selectedId === item.id} onPress={() => { attemptedRead.current = item.id; setSelectedId(item.id); notificationInbox.markRead(item.id).catch(() => {}); }} />;
      }}
      ListHeaderComponent={<>
        {inbox.error && inbox.items.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{inbox.error}</Text> : null}
        {push.error ? <Text style={styles.secondary}>{push.error}</Text> : null}
        {permissionMessage ? <Text accessibilityLiveRegion="polite" style={styles.secondary}>{permissionMessage}</Text> : null}
        <Pressable style={styles.permission} accessibilityRole="button" onPress={() => { enable().catch(() => {}); }}><Text style={styles.actionText}>Enable push alerts</Text></Pressable>
      </>}
      ListEmptyComponent={<View style={styles.empty}>
        {inbox.loading ? <ActivityIndicator accessibilityLabel="Loading notifications" color={colors.primary} /> : <>
          <Text style={styles.title}>{inbox.error ? 'Notifications unavailable' : 'No notifications'}</Text>
          <Text style={styles.secondary} accessibilityRole={inbox.error ? 'alert' : undefined}>{inbox.error ?? 'Your updates will appear here.'}</Text>
          {inbox.error ? <Pressable accessibilityRole="button" style={styles.action} onPress={refresh}><Text style={styles.actionText}>Retry</Text></Pressable> : null}
        </>}
      </View>}
      ListFooterComponent={<View>
        {inbox.loadingMore ? <ActivityIndicator accessibilityLabel="Loading more notifications" /> : null}
        {inbox.nextCursor && !inbox.loadingMore ? <Pressable style={styles.action} accessibilityRole="button" onPress={() => { notificationInbox.loadMore().catch(() => {}); }}><Text style={styles.actionText}>Load more</Text></Pressable> : null}
        {inbox.items.length > 0 && inbox.error ? <Pressable style={styles.action} accessibilityRole="button" onPress={refresh}><Text style={styles.actionText}>Retry</Text></Pressable> : null}
      </View>} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.containerPadding },
  content: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.containerPadding, gap: spacing.sm },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  permission: { minHeight: 48, justifyContent: 'center' },
  actionText: { color: colors.startupBlue, fontSize: 14, fontWeight: '600' },
  disabled: { color: colors.outline }, secondary: { ...typography.bodyMd, color: colors.onSurfaceMuted },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  title: { ...typography.headlineSm, color: colors.onSurface }, error: { color: colors.error },
});
