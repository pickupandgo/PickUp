import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, borderRadius, shadows } from '../../theme';

export interface SkeletonCardProps {
  /** Child placeholders inside the card container. */
  readonly children?: React.ReactNode;
  /** Optional custom container style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Surface card container for driver skeleton loaders.
 * Uses #FFFFFF card surface, subtle border, and soft elevation to match light mode.
 */
export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  children,
  style,
  testID = 'skeleton-card',
}) => {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#ECEEF1',
    padding: spacing.md,
    marginVertical: spacing.xs,
    ...shadows.sm,
  },
});
