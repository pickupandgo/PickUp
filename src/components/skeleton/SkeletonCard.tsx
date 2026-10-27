import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing, borderRadius } from '../../theme';

export interface SkeletonCardProps {
  /** Nested skeleton placeholders inside the card surface. */
  readonly children?: React.ReactNode;
  /** Custom container style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Light-mode card surface placeholder resembling real elevated cards.
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
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#ECEEF1',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
});
