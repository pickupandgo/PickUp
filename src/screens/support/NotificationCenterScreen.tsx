import BrandMark from '../../components/atoms/BrandMark';
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Linking, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { getAuth } from '@react-native-firebase/auth';
import { useNotificationInbox } from '../../hooks/useNotificationInbox';

export interface NotificationItem {
  id: string; title: string; timeText: string; description: string; icon: string;
  isUnread?: boolean; type: 'trip' | 'account' | 'payment';
  destination?: string; bookingId?: string; eventType?: string; createdAt?: string;
}
export interface NotificationCenterScreenProps {
  readonly onBack?: () => void; readonly onHelp?: () => void;
  readonly onNotificationPress?: (id: string) => void;
  readonly onDeleteNotification?: (id: string) => void;
  readonly notifications?: NotificationItem[];
}
const FILTER_TABS = ['All', 'Trips', 'Account'];
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const relativeTime = (timestamp: string) => {
  const date = new Date(timestamp), minutes = Math.max(0, Math.floor((Date.now()-date.getTime())/60000));
  if (day(date) === day(new Date())) return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes/60)} hr ago`;
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
function groupLabel(item: NotificationItem) {
  if (!item.createdAt || !Number.isFinite(Date.parse(item.createdAt))) return item.isUnread ? 'NEW' : 'EARLIER';
  const now = new Date(), yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
  if (day(new Date(item.createdAt)) === day(now)) return item.isUnread ? 'TODAY' : 'EARLIER TODAY';
  return day(new Date(item.createdAt)) === day(yesterday) ? 'YESTERDAY' : 'EARLIER';
}
function eventIcon(item: NotificationItem) {
  const event = item.eventType ?? '';
  if (event === 'NEW_CHAT_MESSAGE') return 'chat-bubble-outline';
  if (event.includes('COMPLETED')) return 'check-circle';
  if (event.includes('DELIVERED')) return 'inventory-2';
  if (event.includes('ARRIVED')) return 'place';
  if (event.includes('ASSIGNED') || event.includes('ACCEPTED')) return 'person-outline';
  if (event.includes('STARTED')) return 'local-shipping';
  if (event.includes('CANCEL')) return 'cancel';
  return item.icon || 'notifications-none';
}
const NotificationCenterScreen: React.FC<NotificationCenterScreenProps & { navigation?: any }> = ({ onBack, onNotificationPress, notifications, navigation }) => {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [activeTab, setActiveTab] = useState('All');
  const inbox = useNotificationInbox(notifications === undefined);
  const [actionError, setActionError] = useState<string>();
  const [marking, setMarking] = useState(false);
  const markingRef = useRef(false);
  const inboxAvailable = !inbox.loading && !inbox.error;
  const items: NotificationItem[] = notifications ?? inbox.items.map(event => ({
    id: event.id, title: event.title, description: event.body, createdAt: event.createdAt, timeText: relativeTime(event.createdAt),
    icon: 'notifications-none', isUnread: !event.readAt,
    type: event.type.includes('PAYMENT') ? 'payment' : /ACCOUNT|PROFILE|SECURITY/.test(event.type) ? 'account' : 'trip', eventType: event.type,
    bookingId: typeof event.data?.bookingId === 'string' ? event.data.bookingId : undefined,
  }));
  const openItem = async (item: NotificationItem) => {
    if (onNotificationPress) { onNotificationPress(item.id); return; }
    if (notifications !== undefined) return;
    const owner = getAuth().currentUser?.uid;
    try { await inbox.markRead(item.id); if (!mounted.current) return; setActionError(undefined); }
    catch { if (!mounted.current) return; setActionError('Read status could not be saved. Please retry.'); }
    if (!mounted.current || getAuth().currentUser?.uid !== owner) return;
    if (item.bookingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.bookingId)) {
      if (item.eventType === 'NEW_CHAT_MESSAGE') navigation?.navigate('ActiveTripStack', { screen: 'ActiveTripChatScreen', params: { bookingId: item.bookingId } });
      else navigation?.navigate('BookingStack', { screen: 'DigitalReceiptScreen', params: { paymentBookingId: item.bookingId } });
    } else Alert.alert(item.title, item.description);
  };
  const markAll = async () => {
    if (markingRef.current) return;
    markingRef.current = true; setMarking(true);
    try { await inbox.markAllRead(); if (mounted.current) setActionError(undefined); }
    catch { if (mounted.current) setActionError('Some notifications could not be marked as read. Please retry.'); }
    finally { markingRef.current = false; if (mounted.current) setMarking(false); }
  };
  const openSettings = () => { void Linking.openSettings().catch(() => Alert.alert('Notification settings', 'Open your phone Settings to manage Multiple Ride notifications.')); };
  const filtered = items.filter(item => activeTab === 'All' || (activeTab === 'Trips' ? item.type === 'trip' : item.type !== 'trip'));
  const sections = ['TODAY', 'NEW', 'EARLIER TODAY', 'YESTERDAY', 'EARLIER'].map(title => ({ title, data: filtered.filter(item => groupLabel(item) === title) })).filter(section => section.data.length);
  const canMark = notifications === undefined && inboxAvailable && items.some(item => item.isUnread);

  return <SafeAreaView style={styles.safeArea}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.iconButton} onPress={() => onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.lg} color={colors.homeAction} /></Pressable>
      <BrandMark size={spacing.xxl} textStyle={styles.brandName} />
      <Pressable accessibilityRole="button" accessibilityLabel="Notification settings" style={styles.iconButton} onPress={openSettings}><Feather name="settings" size={spacing.lg} color={colors.homeAction} /></Pressable>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} refreshControl={notifications === undefined ? <RefreshControl refreshing={inbox.loading && items.length > 0} onRefresh={() => { if (!markingRef.current) void inbox.load(); }} tintColor={colors.homePickup} /> : undefined}>
      <Text style={styles.pageTitle}>Notifications</Text><Text style={styles.subtitle}>Delivery updates</Text>
      <View style={styles.filterRow}>
        <View style={styles.tabs}>{FILTER_TABS.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}><Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text></Pressable>)}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Mark all as read" disabled={!canMark || marking} onPress={() => { void markAll(); }} style={styles.markAction}><Text style={[styles.markText, (!canMark || marking) && styles.muted]}>{marking ? 'Saving…' : 'Mark all as read'}</Text></Pressable>
      </View>
      {notifications === undefined && inbox.loading && items.length === 0 && <ActivityIndicator style={styles.loading} color={colors.homePickup} accessibilityLabel="Loading notifications" />}
      {notifications === undefined && (inbox.error || actionError) && <View style={styles.error}><Text style={styles.description}>{inbox.error ?? actionError}</Text><Pressable accessibilityRole="button" onPress={() => { if (!markingRef.current) void inbox.load(); }}><Text style={styles.markText}>Retry</Text></Pressable></View>}
      {notifications === undefined && !inboxAvailable ? <Text style={styles.empty}>Notification history is not available yet.</Text> : !filtered.length ? <Text style={styles.empty}>No notifications in this category.</Text> : null}
      {sections.map(section => <View key={section.title} style={styles.section}><Text style={styles.sectionHeader}>{section.title}</Text>
        {section.data.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}${item.isUnread ? ', unread' : ''}`} disabled={marking || (notifications !== undefined && !onNotificationPress)} onPress={() => { void openItem(item); }} style={[styles.card, item.isUnread && styles.unreadCard]}>
          <View style={[styles.iconBox, item.isUnread && styles.unreadIcon]}><MaterialIcons name={eventIcon(item)} size={spacing.xl} color={item.isUnread ? colors.homePickup : colors.homeAction} /></View>
          <View style={styles.content}><View style={styles.titleRow}><Text style={styles.title}>{item.title}</Text>{item.isUnread && <View style={styles.unreadDot} />}</View><Text style={styles.description} numberOfLines={2}>{item.description}</Text><Text style={styles.time}>{item.timeText}</Text></View>
        </Pressable>)}
      </View>)}
      {notifications === undefined && inbox.nextCursor && <Pressable accessibilityRole="button" disabled={inbox.loading || marking} onPress={() => { void inbox.load(inbox.nextCursor!); }} style={styles.loadMore}><Text style={styles.markText}>Load more notifications</Text></Pressable>}
    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="Manage alerts in notification settings" style={styles.footer} onPress={openSettings}><Feather name="bell" size={spacing.lg} color={colors.homeAction} /><Text style={styles.footerText}>Manage alerts in notification settings</Text><Feather name="chevron-right" size={spacing.lg} color={colors.secondary} /></Pressable>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, minHeight: spacing.rowHeightStandard },
  iconButton: { width: spacing.rowHeightStandard, height: spacing.rowHeightStandard, alignItems: 'center', justifyContent: 'center' },
  brandName: { ...typography.headlineSm, fontSize: 16, fontWeight: '600' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  pageTitle: { ...typography.headlineLg, fontSize: 24, fontWeight: '600', color: colors.homeAction },
  subtitle: { ...typography.labelSm, color: colors.secondary, marginTop: spacing.xs },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: { borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tabActive: { backgroundColor: colors.homeAction },
  tabText: { ...typography.labelSm, fontSize: 12, color: colors.homeAction },
  tabTextActive: { color: colors.onPrimary },
  markAction: { minHeight: spacing.rowHeightSm, justifyContent: 'center' },
  markText: { ...typography.labelSm, fontSize: 11, color: colors.homePickup, fontWeight: '500' },
  muted: { color: colors.secondary },
  section: { marginBottom: spacing.lg },
  sectionHeader: { ...typography.labelSm, fontSize: 10, lineHeight: 16, letterSpacing: 0.5, color: colors.secondary, marginBottom: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.outlineHairline, backgroundColor: colors.surface, marginBottom: spacing.sm },
  unreadCard: { backgroundColor: colors.selectionTint, borderColor: colors.successContainer },
  iconBox: { width: 36, height: 36, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  unreadIcon: { backgroundColor: colors.successContainer },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.bodyMd, fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.homeAction, flex: 1 },
  unreadDot: { width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.homePickup },
  description: { ...typography.labelSm, fontSize: 11, lineHeight: 16, fontWeight: '400', color: colors.secondary, marginTop: spacing.xs },
  time: { ...typography.labelSm, fontSize: 10, lineHeight: 14, color: colors.secondary, marginTop: spacing.xs },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.outlineHairline },
  footerText: { ...typography.labelSm, fontSize: 11, color: colors.secondary, flex: 1 },
  error: { padding: spacing.md, backgroundColor: colors.surfaceContainerLow, borderRadius: borderRadius.md, gap: spacing.sm, marginBottom: spacing.md },
  empty: { ...typography.labelSm, color: colors.secondary, paddingVertical: spacing.lg },
  loading: { marginVertical: spacing.lg },
  loadMore: { paddingVertical: spacing.md, alignItems: 'center' },
});
export default NotificationCenterScreen;
