import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';

export interface NotificationItem {
  id: string;
  title: string;
  timeText: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  isUnread?: boolean;
  type: 'trip' | 'account' | 'payment';
  /** Route this notification opens when tapped. */
  destination?: string;
}

export interface NotificationCenterScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onNotificationPress?: (id: string) => void;
  readonly onDeleteNotification?: (id: string) => void;
  readonly notifications?: NotificationItem[];
}

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: '1',
    title: 'Driver arriving soon',
    timeText: '2m ago',
    description: 'Your driver, Michael, is 2 minutes away in a Black Sedan (XYZ-123).',
    icon: 'directions-car',
    isUnread: true,
    type: 'trip',
    destination: 'CustomerLiveTrackingScreen',
  },
  {
    id: '2',
    title: 'Payment successful',
    timeText: '15m ago',
    description: 'Receipt for your trip to Downtown Core has been emailed.',
    icon: 'credit-card',
    isUnread: true,
    type: 'payment',
    destination: 'DigitalReceiptScreen',
  },
  {
    id: '3',
    title: 'Trip completed',
    timeText: '3h ago',
    description: 'How was your ride? Rate your trip to help us improve.',
    icon: 'check-circle',
    isUnread: false,
    type: 'trip',
    destination: 'TripCompletedSummaryScreen',
  },
  {
    id: '4',
    title: 'New device login',
    timeText: 'Yesterday',
    description: 'A new sign-in was detected on iOS Device. If this was you, no action is needed.',
    icon: 'manage-accounts',
    isUnread: false,
    type: 'account',
    destination: 'CustomerSettingsScreen',
  },
  {
    id: '5',
    title: 'Booking cancelled',
    timeText: 'Oct 24',
    description: 'Your advance booking for Oct 25 has been cancelled at your request.',
    icon: 'cancel',
    isUnread: false,
    type: 'trip',
    destination: 'TripCancelledStatusScreen',
  },
];

const FILTER_TABS = ['All', 'Trips', 'Account'];

const NotificationCenterScreen: React.FC<NotificationCenterScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onNotificationPress,
  onDeleteNotification,
  notifications = DEFAULT_NOTIFICATIONS,
  navigation,
}) => {
  const [activeTab, setActiveTab] = useState('All');

  const newNotifications = notifications.filter(n => n.isUnread);
  const earlierNotifications = notifications.filter(n => !n.isUnread);

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
      onPress={() => {
        onNotificationPress?.(item.id);
        if (item.destination) {
          navigation?.navigate(item.destination);
        }
      }}
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
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          style={styles.iconButton}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Notifications</Text>

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
