import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../atoms/Icon';
import { borderRadius, colors, shadows, spacing, typography } from '../../theme';

/** Shared neutral treatment for the Profile entry and all Documents Hub categories. */
export function DocumentNavigationCard({ title, subtitle, icon, onPress }: {
  title: string; subtitle?: string; icon: string; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [styles.card, subtitle && styles.category, pressed && styles.pressed]}>
    <View style={styles.iconContainer}><Icon name={icon} size={22} color={colors.navigationIcon} /></View>
    <View style={styles.details}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    <Icon name="chevron_right" size={20} color={colors.onSurfaceMuted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 72,
    paddingHorizontal: spacing.containerPadding, paddingVertical: spacing.sm, borderWidth: 1,
    borderColor: colors.outlineSubtle, borderRadius: borderRadius.xl,
    backgroundColor: colors.surfaceContainerLowest, ...shadows.sm },
  category: { minHeight: 88, paddingVertical: spacing.containerPadding },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  iconContainer: { width: 40, height: 40, borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1, minWidth: 0, gap: spacing.unit },
  title: { ...typography.headlineSm, color: colors.onSurface, fontWeight: '600' },
  subtitle: { ...typography.bodyMd, fontSize: 13, lineHeight: 19, color: colors.onSurfaceMuted, flexShrink: 1 },
});
