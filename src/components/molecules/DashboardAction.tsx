import React from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { borderRadius, colors, spacing, typography } from '../../theme';

export function DashboardAction({ label, onPress, style, variant = 'button' }: { label: string; onPress: () => void; style?: ViewStyle; variant?: 'button' | 'link' }) {
  const isLink = variant === 'link';
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={({ pressed }) => [styles.button, isLink && styles.link, pressed && styles.pressed, style]}>
    <Text style={[styles.label, isLink && styles.linkLabel]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { backgroundColor: colors.surfaceContainerLowest, borderWidth: 1,
    borderColor: colors.secondaryContainer, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 36,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  pressed: { backgroundColor: colors.secondaryContainer },
  label: { ...typography.labelCaps, fontSize: 11, color: colors.startupBlueDark, fontWeight: '700' },
  link: { borderWidth: 0, borderRadius: 6, alignSelf: 'flex-start', paddingHorizontal: 0, paddingVertical: 6, minHeight: 36 },
  linkLabel: { fontSize: 12, letterSpacing: 0, fontWeight: '500', color: colors.homeGreen },
});
