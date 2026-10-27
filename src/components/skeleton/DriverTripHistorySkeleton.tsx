import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { spacing, borderRadius } from '../../theme';

export interface DriverTripHistorySkeletonProps {
  /** Number of trip card skeletons to display. Defaults to 3. */
  readonly count?: number;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton layout for Driver Trip History Screen.
 * Renders trip card placeholders with route timeline and fare.
 */
export const DriverTripHistorySkeleton: React.FC<DriverTripHistorySkeletonProps> = ({
  count = 3,
  testID = 'driver-trip-history-skeleton',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} style={styles.tripCard}>
          {/* Header: Date + Fare */}
          <View style={styles.headerRow}>
            <View>
              <Skeleton width={110} height={14} borderRadius={4} />
              <Skeleton width={70} height={11} borderRadius={4} style={{ marginTop: 4 }} />
            </View>
            <Skeleton width={64} height={20} borderRadius={4} />
          </View>

          {/* Timeline Route: Pickup + Drop */}
          <View style={styles.routeContainer}>
            <View style={styles.timelineIndicators}>
              <Skeleton width={8} height={8} borderRadius={4} />
              <View style={styles.timelineDotted} />
              <Skeleton width={8} height={8} borderRadius={4} />
            </View>
            <View style={styles.routeAddresses}>
              <Skeleton width="90%" height={13} borderRadius={4} />
              <Skeleton width="75%" height={13} borderRadius={4} style={{ marginTop: 14 }} />
            </View>
          </View>

          {/* Footer: Status pill + Details link */}
          <View style={styles.footerRow}>
            <Skeleton width={80} height={22} borderRadius={borderRadius.full} />
            <Skeleton width={60} height={14} borderRadius={4} />
          </View>
        </SkeletonCard>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  tripCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEEF1',
  },
  routeContainer: {
    flexDirection: 'row',
    marginVertical: spacing.md,
  },
  timelineIndicators: {
    alignItems: 'center',
    width: 16,
    marginRight: spacing.sm,
  },
  timelineDotted: {
    width: 1,
    height: 18,
    backgroundColor: '#ECEEF1',
    marginVertical: 4,
  },
  routeAddresses: {
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
});
