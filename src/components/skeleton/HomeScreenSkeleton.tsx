import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonButton } from './SkeletonButton';
import { spacing, borderRadius } from '../../theme';

export interface HomeScreenSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder for HomeScreen bottom sheet content:
 * Pickup/Drop inputs, Start Booking button, Recent Locations, and Quick Actions.
 */
export const HomeScreenSkeleton: React.FC<HomeScreenSkeletonProps> = ({
  testID = 'home-screen-skeleton',
}) => {
  return (
    <View
      style={styles.container}
      testID={testID}
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Booking Input Box Card */}
      <SkeletonCard style={styles.bookingCard}>
        {/* Pickup row */}
        <View style={styles.inputRow}>
          <SkeletonCircle size={10} style={styles.dot} />
          <View style={styles.inputContent}>
            <Skeleton width={50} height={11} borderRadius={4} />
            <Skeleton width="85%" height={15} borderRadius={4} style={styles.inputText} />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Drop row */}
        <View style={styles.inputRow}>
          <SkeletonCircle size={10} style={styles.dot} />
          <View style={styles.inputContent}>
            <Skeleton width="75%" height={15} borderRadius={4} />
          </View>
        </View>

        {/* Start Booking Button */}
        <SkeletonButton height={48} borderRadius={borderRadius.full} style={styles.button} />
      </SkeletonCard>

      {/* Recent Locations Section */}
      <View style={styles.section}>
        <Skeleton width={140} height={16} borderRadius={4} style={styles.sectionTitle} />
        <SkeletonCard style={styles.recentCard}>
          {Array.from({ length: 3 }).map((_, index) => (
            <View key={index} style={[styles.recentRow, index > 0 && styles.rowBorder]}>
              <SkeletonCircle size={24} />
              <View style={styles.recentTextWrap}>
                <Skeleton width="55%" height={14} borderRadius={4} />
                <Skeleton width="80%" height={11} borderRadius={4} style={styles.subText} />
              </View>
            </View>
          ))}
        </SkeletonCard>
      </View>

      {/* Quick Actions Grid */}
      <View style={styles.gridRow}>
        <SkeletonCard style={styles.gridItem}>
          <Skeleton width={32} height={32} borderRadius={8} />
          <Skeleton width={80} height={14} borderRadius={4} style={styles.gridText} />
        </SkeletonCard>
        <SkeletonCard style={styles.gridItem}>
          <Skeleton width={32} height={32} borderRadius={8} />
          <Skeleton width={80} height={14} borderRadius={4} style={styles.gridText} />
        </SkeletonCard>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  bookingCard: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dot: {
    marginRight: spacing.md,
  },
  inputContent: {
    flex: 1,
  },
  inputText: {
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#F2F4F7',
    marginVertical: spacing.sm,
  },
  button: {
    marginTop: spacing.md,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
  recentCard: {
    padding: 0,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
  },
  recentTextWrap: {
    marginLeft: spacing.md,
    flex: 1,
  },
  subText: {
    marginTop: 4,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  gridItem: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  gridText: {
    marginTop: spacing.sm,
  },
});
