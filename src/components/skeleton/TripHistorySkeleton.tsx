import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';
import { spacing, borderRadius } from '../../theme';

export interface TripHistorySkeletonProps {
  /** Number of trip cards to render. Defaults to 3. */
  readonly count?: number;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder matching the TripHistoryScreen card layout:
 * Header with date & fare, route timeline with pickup/drop locations, and vehicle footer.
 */
export const TripHistorySkeleton: React.FC<TripHistorySkeletonProps> = ({
  count = 3,
  testID = 'trip-history-skeleton',
}) => {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      testID={testID}
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} style={styles.card}>
          {/* Card Header: Date & Status/Fare */}
          <View style={styles.cardHeader}>
            <View>
              <Skeleton width={120} height={15} borderRadius={4} />
              <Skeleton width={70} height={11} borderRadius={4} style={styles.subLine} />
            </View>
            <View style={styles.headerRight}>
              <Skeleton width={64} height={16} borderRadius={4} />
              <Skeleton width={44} height={11} borderRadius={4} style={styles.subLine} />
            </View>
          </View>

          {/* Route Timeline */}
          <View style={styles.routeContainer}>
            <View style={styles.timelineColumn}>
              <SkeletonCircle size={10} />
              <View style={styles.timelineVerticalLine} />
              <SkeletonCircle size={10} />
            </View>
            <View style={styles.addressColumn}>
              <Skeleton width="90%" height={13} borderRadius={4} />
              <Skeleton width="80%" height={13} borderRadius={4} style={styles.dropAddressLine} />
            </View>
          </View>

          {/* Card Footer: Vehicle and Chevron */}
          <View style={styles.cardFooter}>
            <View style={styles.vehicleRow}>
              <Skeleton width={20} height={20} borderRadius={borderRadius.sm} />
              <Skeleton width={50} height={12} borderRadius={4} style={styles.vehicleText} />
            </View>
            <Skeleton width={16} height={16} borderRadius={borderRadius.sm} />
          </View>
        </SkeletonCard>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F7',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  subLine: {
    marginTop: 4,
  },
  routeContainer: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  timelineColumn: {
    alignItems: 'center',
    marginRight: spacing.sm,
    paddingVertical: 2,
  },
  timelineVerticalLine: {
    width: 2,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  addressColumn: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  dropAddressLine: {
    marginTop: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleText: {
    marginLeft: 6,
  },
});
