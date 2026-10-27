import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonButton } from './SkeletonButton';
import { spacing, borderRadius } from '../../theme';

export interface VehicleSelectionSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder for SelectVehicleScreen:
 * Route summary card, 4 vehicle option cards, and bottom CTA button.
 */
export const VehicleSelectionSkeleton: React.FC<VehicleSelectionSkeletonProps> = ({
  testID = 'vehicle-selection-skeleton',
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
      {/* Route Summary Card Skeleton */}
      <SkeletonCard style={styles.routeCard}>
        <View style={styles.routeRow}>
          <View style={styles.timelineCol}>
            <Skeleton width={8} height={8} borderRadius={4} />
            <View style={styles.dashedLine} />
            <Skeleton width={8} height={8} borderRadius={4} />
          </View>
          <View style={styles.addressCol}>
            <Skeleton width="85%" height={14} borderRadius={4} />
            <Skeleton width="75%" height={14} borderRadius={4} style={styles.dropAddress} />
          </View>
        </View>
      </SkeletonCard>

      <Skeleton width={180} height={14} borderRadius={4} style={styles.subtitle} />

      {/* Vehicle Option Cards */}
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonCard key={index} style={styles.vehicleCard}>
          <View style={styles.vehicleRow}>
            {/* Vehicle image placeholder */}
            <Skeleton width={52} height={52} borderRadius={borderRadius.md} />

            {/* Vehicle Info */}
            <View style={styles.vehicleDetails}>
              <View style={styles.topRow}>
                <Skeleton width={90} height={16} borderRadius={4} />
                <Skeleton width={56} height={16} borderRadius={4} />
              </View>
              <Skeleton width="80%" height={12} borderRadius={4} style={styles.descLine} />
              <View style={styles.bottomRow}>
                <Skeleton width={64} height={12} borderRadius={4} />
                <Skeleton width={44} height={12} borderRadius={4} />
              </View>
            </View>
          </View>
        </SkeletonCard>
      ))}

      {/* Footer Button */}
      <SkeletonButton height={52} borderRadius={borderRadius.full} style={styles.footerButton} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  routeCard: {
    marginBottom: spacing.md,
  },
  routeRow: {
    flexDirection: 'row',
  },
  timelineCol: {
    alignItems: 'center',
    marginRight: spacing.sm,
    paddingVertical: 2,
  },
  dashedLine: {
    width: 2,
    height: 28,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  addressCol: {
    flex: 1,
    justifyContent: 'space-between',
  },
  dropAddress: {
    marginTop: 20,
  },
  subtitle: {
    marginBottom: spacing.md,
  },
  vehicleCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleDetails: {
    marginLeft: spacing.md,
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  descLine: {
    marginTop: 6,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  footerButton: {
    marginTop: spacing.md,
  },
});
