import React from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { borderRadius, colors, spacing, typography } from '../../theme';

export function DashboardAction({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}>
    <Text style={styles.label}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { backgroundColor: colors.surfaceContainerLowest, borderWidth: 1,
    borderColor: colors.secondaryContainer, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 36,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  pressed: { backgroundColor: colors.secondaryContainer },
  label: { ...typography.labelCaps, fontSize: 11, color: colors.startupBlueDark, fontWeight: '700' },
});
