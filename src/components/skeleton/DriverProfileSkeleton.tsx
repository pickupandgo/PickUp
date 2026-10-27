import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonListItem } from './SkeletonListItem';
import { spacing, borderRadius } from '../../theme';

export interface DriverProfileSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton layout for Driver Profile & Account Screen.
 */
export const DriverProfileSkeleton: React.FC<DriverProfileSkeletonProps> = ({
  testID = 'driver-profile-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {/* Profile Header Card */}
      <SkeletonCard style={styles.profileHeader}>
        <View style={styles.avatarRow}>
          <SkeletonCircle size={64} />
          <View style={styles.driverInfo}>
            <Skeleton width={140} height={18} borderRadius={4} />
            <Skeleton width={100} height={14} borderRadius={4} style={{ marginTop: 6 }} />
            <Skeleton width={80} height={20} borderRadius={borderRadius.full} style={{ marginTop: 8 }} />
          </View>
        </View>
      </SkeletonCard>

      {/* Verification Status Banner */}
      <SkeletonCard style={styles.verificationCard}>
        <View style={styles.verificationRow}>
          <Skeleton width={28} height={28} borderRadius={6} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width={130} height={14} borderRadius={4} />
            <Skeleton width={180} height={12} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        </View>
      </SkeletonCard>

      {/* Menu / Settings Rows */}
      <View style={styles.menuSection}>
        <SkeletonListItem count={4} hasAvatar={true} hasSubtitle={false} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  profileHeader: {
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverInfo: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  verificationCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuSection: {
    marginTop: spacing.xs,
  },
});
