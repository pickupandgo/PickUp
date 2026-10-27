import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonListItem } from './SkeletonListItem';
import { spacing, borderRadius } from '../../theme';

export interface WalletSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton layout for Driver Wallet Screen.
 * Renders hero balance card, quick action buttons, and recent transactions.
 */
export const WalletSkeleton: React.FC<WalletSkeletonProps> = ({
  testID = 'wallet-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* Balance Hero Card */}
      <SkeletonCard style={styles.heroCard}>
        <Skeleton width={100} height={14} borderRadius={4} />
        <Skeleton width={160} height={36} borderRadius={6} style={{ marginVertical: 12 }} />
        <View style={styles.rechargeCtaRow}>
          <Skeleton width={110} height={38} borderRadius={borderRadius.full} />
          <Skeleton width={90} height={14} borderRadius={4} />
        </View>
      </SkeletonCard>

      {/* Quick Amount Pills */}
      <View style={styles.pillsRow}>
        <Skeleton width={80} height={36} borderRadius={borderRadius.md} />
        <Skeleton width={80} height={36} borderRadius={borderRadius.md} />
        <Skeleton width={80} height={36} borderRadius={borderRadius.md} />
        <Skeleton width={80} height={36} borderRadius={borderRadius.md} />
      </View>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Skeleton width={140} height={16} borderRadius={4} />
      </View>

      {/* Transaction List */}
      <SkeletonListItem count={4} hasAvatar={true} hasSubtitle={true} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heroCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rechargeCtaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeader: {
    marginVertical: spacing.sm,
  },
});
