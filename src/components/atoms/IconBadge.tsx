import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, borderRadius, spacing, shadows } from '../../theme';

export interface IconBadgeProps {
  readonly icon: React.ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly variant?: 'default' | 'surface' | 'primary' | 'error' | 'success';
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 56,
} as const;

const bgMap = {
  default: colors.surfaceContainerHigh,
  surface: colors.surfaceContainerLow,
  primary: colors.primaryFixed,
  error: colors.errorContainer,
  success: colors.statusGreen,
} as const;

const IconBadge: React.FC<IconBadgeProps> = ({
  icon,
  size = 'md',
  variant = 'default',
}) => {
  const dim = sizeMap[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: bgMap[variant],
        },
      ]}
      accessibilityRole="image"
    >
      {icon}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

export default IconBadge;
