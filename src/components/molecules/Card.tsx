import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export interface CardProps {
  readonly children: React.ReactNode;
  readonly onPress?: () => void;
  readonly variant?: 'elevated' | 'outlined' | 'filled';
  readonly padding?: 'none' | 'sm' | 'md' | 'lg';
  readonly style?: StyleProp<ViewStyle>;
}

const paddingMap = {
  none: 0,
  sm: spacing.sm,
  md: spacing.lg,
  lg: spacing.xl,
} as const;

const Card: React.FC<CardProps> = ({
  children,
  onPress,
  variant = 'outlined',
  padding = 'md',
  style,
}) => {
  const cardStyle = [
    styles.base,
    { padding: paddingMap[padding] },
    variant === 'outlined' && styles.outlined,
    variant === 'elevated' && styles.elevated,
    variant === 'filled' && styles.filled,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [
          ...cardStyle,
          pressed && styles.pressed,
        ]}
        onPress={onPress}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }

  return <View style={cardStyle}>{children}</View>;
};

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  outlined: {
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    ...shadows.ghost,
  },
  elevated: {
    ...shadows.card,
  },
  filled: {
    backgroundColor: colors.surfaceContainerLow,
  },
  pressed: {
    opacity: 0.92,
  },
});

export default Card;
