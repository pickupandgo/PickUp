import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { getAuth } from '@react-native-firebase/auth';
import { useNotificationInbox } from '../../hooks/useNotificationInbox';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

export interface NotificationItem {
  id: string;
  title: string;
  timeText: string;
  description: string;
  icon: string;
  isUnread?: boolean;
  type: 'trip' | 'account' | 'payment';
  /** Route this notification opens when tapped. */
  destination?: string;
  bookingId?: string;
  eventType?: string;
}

export interface NotificationCenterScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onNotificationPress?: (id: string) => void;
  readonly onDeleteNotification?: (id: string) => void;
  readonly notifications?: NotificationItem[];
}

const FILTER_TABS = ['All', 'Trips', 'Account'];

const NotificationCenterScreen: React.FC<NotificationCenterScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onNotificationPress,
  onDeleteNotification,
  notifications,
  navigation,
}) => {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [activeTab, setActiveTab] = useState('All');
  const inbox = useNotificationInbox(notifications === undefined);
  const [actionError, setActionError] = useState<string>();
  const inboxAvailable = !inbox.loading && !inbox.error;
  const items: NotificationItem[] = notifications ?? inbox.items.map(event => ({
    id: event.id, title: event.title, description: event.body, timeText: new Date(event.createdAt).toLocaleString('en-IN'),
    icon: event.type === 'NEW_CHAT_MESSAGE' ? 'chat' : 'notifications', isUnread: !event.readAt,
    type: event.type.includes('PAYMENT') ? 'payment' : 'trip', eventType: event.type,
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

  const newNotifications = items.filter(n => n.isUnread);
  const earlierNotifications = items.filter(n => !n.isUnread);

  const filterItems = (items: NotificationItem[]) => {
    if (activeTab === 'All') return items;
    if (activeTab === 'Trips') return items.filter(i => i.type === 'trip');
    if (activeTab === 'Account') return items.filter(i => i.type === 'account' || i.type === 'payment');
    return items;
  };

  const displayNew = filterItems(newNotifications);
  const displayEarlier = filterItems(earlierNotifications);

  const renderNotification = (item: NotificationItem) => (
    <Pressable
      key={item.id}
      style={styles.notificationCard}
      disabled={notifications !== undefined && !onNotificationPress}
      onPress={() => { void openItem(item); }}
    >
      {item.isUnread && <View style={styles.unreadIndicator} />}
      
      <View style={[styles.iconBox, item.isUnread ? styles.iconBoxUnread : styles.iconBoxRead]}>
        <MaterialIcons 
          name={item.icon} 
          size={20} 
          color={item.isUnread ? colors.onPrimaryContainer : colors.onSurfaceVariant} 
        />
      </View>

      <View style={styles.textContent}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.timeText, item.isUnread && styles.timeTextUnread]}>{item.timeText}</Text>
        </View>
        <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          style={styles.iconButton}
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable
          disabled={!onHelp}
          onPress={() => onHelp?.()}
          style={styles.iconButton}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Notifications</Text>
        <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings(); }}><Text style={styles.description}>System notification settings</Text></Pressable>
        {notifications === undefined && <Pressable accessibilityRole="button" disabled={inbox.loading} onPress={() => { void inbox.load(); }}><Text style={styles.description}>Refresh notifications</Text></Pressable>}
        {notifications === undefined && inbox.loading && <Text style={styles.description}>Loading notifications...</Text>}
        {notifications === undefined && (inbox.error || actionError) && <Text style={styles.description}>{inbox.error ?? actionError}</Text>}

        {/* Tabs */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.tabsContainer}
          contentContainerStyle={styles.tabsContent}
        >
          {FILTER_TABS.map(tab => (
            <Pressable
              key={tab}
              style={[styles.tabButton, activeTab === tab ? styles.tabButtonActive : styles.tabButtonInactive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>
                {tab}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {notifications === undefined && !inboxAvailable ? (
          <Text style={styles.description}>Notification history is not available yet.</Text>
        ) : displayNew.length === 0 && displayEarlier.length === 0 ? (
          <Text style={styles.description}>No notifications in this category.</Text>
        ) : null}

        {/* Notification Lists */}
        {displayNew.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>NEW</Text>
            <View style={styles.list}>
              {displayNew.map(renderNotification)}
            </View>
          </View>
        )}

        {displayEarlier.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>EARLIER</Text>
            <View style={styles.list}>
              {displayEarlier.map(renderNotification)}
            </View>
          </View>
        )}
        {notifications === undefined && inbox.nextCursor && <Pressable accessibilityRole="button" disabled={inbox.loading} onPress={() => { void inbox.load(inbox.nextCursor!); }}><Text style={styles.description}>Load more notifications</Text></Pressable>}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface + 'E6', // 90% opacity for blur effect
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  pageTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.md,
  },
  tabsContainer: {
    marginBottom: spacing.xl,
    maxHeight: 40,
  },
  tabsContent: {
    gap: spacing.sm,
    paddingRight: spacing.marginMobile,
  },
  tabButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.primaryContainer,
  },
  tabButtonInactive: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  tabText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    fontFamily: typography.labelSm.fontFamily,
  },
  tabTextActive: {
    color: colors.onPrimaryContainer,
  },
  tabTextInactive: {
    color: colors.onSurfaceVariant,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    marginLeft: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  notificationCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    ...shadows.card,
    position: 'relative',
    overflow: 'hidden',
  },
  unreadIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: colors.primaryContainer,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxUnread: {
    backgroundColor: colors.primaryContainer,
  },
  iconBoxRead: {
    backgroundColor: colors.surfaceVariant,
  },
  textContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  title: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onBackground,
    fontFamily: typography.bodyMd.fontFamily,
  },
  timeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginLeft: spacing.sm,
  },
  timeTextUnread: {
    color: colors.primaryContainer, // Or a suitable highlight color
    fontWeight: '600',
  },
  description: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: 20,
  },
});

export default NotificationCenterScreen;
