import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../atoms/Icon';
import { HomeBrandMark } from '../molecules/HomeArtwork';
import { colors } from '../../theme';
import { notificationInbox } from '../../services/notifications/NotificationInbox';

export function AccountHeader({ title, onBack, onNotifications }: { title: string; onBack?: () => void; onNotifications?: () => void }) {
  return <View style={styles.header}>
    {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
      <Icon name="arrow_back" size={23} color={colors.primary} />
    </Pressable> : <HomeBrandMark />}
    <Text style={styles.headerTitle}>{title}</Text>
    {onNotifications ? <AccountNotificationButton onPress={onNotifications} /> : onBack ? <HomeBrandMark /> : null}
  </View>;
}

function AccountNotificationButton({ onPress }: { onPress: () => void }) {
  const { unreadCount, items } = useSyncExternalStore(notificationInbox.subscribe, notificationInbox.getSnapshot);
  const unread = unreadCount !== null ? unreadCount > 0 : items.some(item => item.readAt === null);
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Notifications" style={styles.notificationButton}>
    <Icon name="notifications_none" size={23} color={colors.primary} />
    {unread && <View style={styles.unreadDot} accessibilityLabel="Unread notifications" />}
  </Pressable>;
}

export function AccountGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export interface AccountMenuRowProps {
  title: string;
  icon: string;
  subtitle?: string;
  value?: string;
  mint?: boolean;
  last?: boolean;
  onPress?: () => void;
  testID?: string;
}
export function AccountMenuRow({ title, subtitle, value, icon, mint = false, last = false, onPress, testID }: AccountMenuRowProps) {
  return <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={title} testID={testID}
    style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
    <View style={[styles.icon, mint && styles.iconMint]}>
      <Icon name={icon} size={21} color={mint ? colors.homeGreen : colors.navigationIcon} />
    </View>
    <View style={styles.text}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {value ? <Text style={styles.value}>{value}</Text> : null}
    <Icon name="chevron_right" size={20} color={colors.onSurfaceMuted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 20 },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23, fontWeight: '600', color: colors.primary },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  notificationButton: { width: 44, height: 44, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { position: 'absolute', top: 9, right: 10, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.homeGreen, borderWidth: 1, borderColor: colors.surfaceContainerLowest },
  group: { borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.surfaceContainerLowest, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 13 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconMint: { backgroundColor: colors.homeMint },
  text: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.primary },
  subtitle: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
  value: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted, flexShrink: 1, maxWidth: '30%' },
});
