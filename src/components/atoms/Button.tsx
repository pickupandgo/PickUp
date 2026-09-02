import React from 'react';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
  readonly accessibilityHint?: string;
  readonly icon?: React.ReactNode;
  readonly style?: ViewStyle;
}

const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityHint,
  icon,
  style: customStyle,
}) => {
  const containerStyle: ViewStyle[] = [
    styles.base,
    styles[`container_${variant}`],
    styles[`size_${size}`],
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    customStyle,
  ].filter(Boolean) as ViewStyle[];

  const textStyle: TextStyle[] = [
    styles.text,
    styles[`text_${variant}`],
    styles[`textSize_${size}`],
  ];

  return (
    <Pressable
      style={({ pressed }) => [
        ...containerStyle,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.onPrimary : colors.primary}
        />
      ) : (
        <>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text style={textStyle}>{label}</Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  fullWidth: {
    width: '100%',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.4,
  },
  iconContainer: {
    marginRight: spacing.xs,
  },
  text: {
    fontFamily: typography.headlineSm.fontFamily,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Variant: container ──
  container_primary: {
    backgroundColor: colors.primary,
  },
  container_secondary: {
    backgroundColor: colors.secondaryContainer,
  },
  container_outline: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
  },
  container_ghost: {
    backgroundColor: colors.transparent,
  },
  container_danger: {
    backgroundColor: colors.error,
  },

  // ── Variant: text color ──
  text_primary: {
    color: colors.onPrimary,
  },
  text_secondary: {
    color: colors.onSecondaryContainer,
  },
  text_outline: {
    color: colors.primary,
  },
  text_ghost: {
    color: colors.primary,
  },
  text_danger: {
    color: colors.onError,
  },

  // ── Size: container ──
  size_sm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  size_md: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
  },
  size_lg: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    minHeight: spacing.rowHeightStandard,
  },

  // ── Size: text ──
  textSize_sm: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
  },
  textSize_md: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
  },
  textSize_lg: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
  },
});

export default Button;
