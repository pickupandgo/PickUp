import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonListItem } from './SkeletonListItem';
import { spacing, borderRadius } from '../../theme';

export interface EarningsHistorySkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton layout for Driver Earnings History Screen.
 * Renders weekly summary card, stat pills, and transaction list items.
 */
export const EarningsHistorySkeleton: React.FC<EarningsHistorySkeletonProps> = ({
  testID = 'earnings-history-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* Top Filter Chips */}
      <View style={styles.filterRow}>
        <Skeleton width={72} height={32} borderRadius={borderRadius.full} />
        <Skeleton width={72} height={32} borderRadius={borderRadius.full} />
        <Skeleton width={72} height={32} borderRadius={borderRadius.full} />
      </View>

      {/* Hero Summary Card */}
      <SkeletonCard style={styles.summaryCard}>
        <Skeleton width={110} height={14} borderRadius={4} />
        <Skeleton width={150} height={32} borderRadius={6} style={{ marginVertical: 12 }} />
        <View style={styles.statsRow}>
          <View style={{ flex: 1 }}>
            <Skeleton width={60} height={12} borderRadius={4} />
            <Skeleton width={40} height={18} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton width={60} height={12} borderRadius={4} />
            <Skeleton width={50} height={18} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton width={60} height={12} borderRadius={4} />
            <Skeleton width={40} height={18} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        </View>
      </SkeletonCard>

      {/* Breakdown Section Title */}
      <View style={styles.sectionHeader}>
        <Skeleton width={120} height={16} borderRadius={4} />
      </View>

      {/* Trip items */}
      <SkeletonListItem count={4} hasAvatar={true} hasSubtitle={true} />
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
  summaryCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#ECEEF1',
  },
  sectionHeader: {
    marginVertical: spacing.sm,
  },
});
