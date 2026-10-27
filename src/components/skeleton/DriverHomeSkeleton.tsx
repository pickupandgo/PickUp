import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonText } from './SkeletonText';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonCard } from './SkeletonCard';
import { spacing, borderRadius } from '../../theme';

export interface DriverHomeSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Section-level and dashboard skeleton for Driver Home Screen.
 * NOTE: Never covers or blocks the Go Live / Offline control!
 */
export const DriverHomeSkeleton: React.FC<DriverHomeSkeletonProps> = ({
  testID = 'driver-home-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* Vehicle Summary Card Skeleton */}
      <SkeletonCard style={styles.vehicleCard}>
        <View style={styles.vehicleRow}>
          <SkeletonCircle size={44} />
          <View style={styles.vehicleInfo}>
            <Skeleton width={80} height={12} borderRadius={4} />
            <Skeleton width={140} height={16} borderRadius={4} style={{ marginTop: 6 }} />
          </View>
          <Skeleton width={64} height={22} borderRadius={borderRadius.full} />
        </View>
      </SkeletonCard>

      {/* Earnings & Wallet Cards Row */}
      <View style={styles.dashboardRow}>
        <SkeletonCard style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <SkeletonCircle size={28} />
            <Skeleton width={48} height={12} borderRadius={4} />
          </View>
          <Skeleton width={80} height={22} borderRadius={4} style={{ marginVertical: 8 }} />
          <View style={styles.metricFooter}>
            <Skeleton width={50} height={12} borderRadius={4} />
            <Skeleton width={50} height={20} borderRadius={borderRadius.full} />
          </View>
        </SkeletonCard>

        <SkeletonCard style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <SkeletonCircle size={28} />
            <Skeleton width={48} height={12} borderRadius={4} />
          </View>
          <Skeleton width={80} height={22} borderRadius={4} style={{ marginVertical: 8 }} />
          <View style={styles.metricFooter}>
            <Skeleton width={50} height={12} borderRadius={4} />
            <Skeleton width={50} height={20} borderRadius={borderRadius.full} />
          </View>
        </SkeletonCard>
      </View>

      {/* Protocol Banner Placeholder */}
      <SkeletonCard style={styles.protocolCard}>
        <View style={styles.protocolRow}>
          <Skeleton width={28} height={28} borderRadius={6} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width={120} height={14} borderRadius={4} />
            <SkeletonText lines={2} lineHeight={12} lineSpacing={4} lastLineWidth="80%" style={{ marginTop: 6 }} />
          </View>
        </View>
      </SkeletonCard>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  vehicleCard: {
    padding: spacing.md,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  dashboardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    padding: spacing.md,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  protocolCard: {
    padding: spacing.md,
  },
  protocolRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
