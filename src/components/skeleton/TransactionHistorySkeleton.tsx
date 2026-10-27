import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonListItem } from './SkeletonListItem';
import { spacing, borderRadius } from '../../theme';

export interface TransactionHistorySkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton layout for Driver Transaction History Screen.
 */
export const TransactionHistorySkeleton: React.FC<TransactionHistorySkeletonProps> = ({
  testID = 'transaction-history-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* Category Filter Chips */}
      <View style={styles.filterRow}>
        <Skeleton width={64} height={32} borderRadius={borderRadius.full} />
        <Skeleton width={80} height={32} borderRadius={borderRadius.full} />
        <Skeleton width={80} height={32} borderRadius={borderRadius.full} />
      </View>

      {/* Transaction rows */}
      <SkeletonListItem count={6} hasAvatar={true} hasSubtitle={true} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
});
