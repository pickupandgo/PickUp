import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, spacing, typography } from '../../theme';

/** Safe-area space is supplied once by the containing screen. Wrap at large text sizes. */
export function PartnerAppHeader({ onMenu, onNotifications }: { onMenu: () => void; onNotifications: () => void }) {
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} style={styles.button}>
      <Icon name="menu" size={24} color={colors.navigationIcon} />
    </Pressable>
    <Text accessibilityRole="header" style={styles.title}>MultipleRide Partner</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={onNotifications} style={styles.button}>
      <Icon name="notifications" size={24} color={colors.navigationIcon} />
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: spacing.xs,
    paddingVertical: spacing.unit, borderBottomWidth: 1, borderBottomColor: colors.outlineSubtle, backgroundColor: colors.surface },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headlineMd, color: colors.primary, flex: 1, minWidth: 0, textAlign: 'center', paddingHorizontal: spacing.unit },
});
