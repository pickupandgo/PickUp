import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface StatusBadgeProps {
  readonly label: string;
  readonly variant?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
}

const bgColors = {
  info: colors.primaryFixed,
  success: colors.statusGreen,
  warning: colors.tertiaryFixed,
  error: colors.errorContainer,
  neutral: colors.surfaceContainerHigh,
} as const;

const textColors = {
  info: colors.onPrimaryFixed,
  success: colors.white,
  warning: colors.onTertiaryFixed,
  error: colors.onErrorContainer,
  neutral: colors.onSurfaceVariant,
} as const;

const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant = 'neutral',
}) => {
  return (
    <View
      style={[styles.container, { backgroundColor: bgColors[variant] }]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Text style={[styles.text, { color: textColors[variant] }]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: typography.labelCaps.fontSize,
    lineHeight: typography.labelCaps.lineHeight,
    fontWeight: typography.labelCaps.fontWeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.labelCaps.fontFamily,
  },
});

export default StatusBadge;
