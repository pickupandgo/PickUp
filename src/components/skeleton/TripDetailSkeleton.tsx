import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonCircle } from './SkeletonCircle';
import { spacing } from '../../theme';

export interface TripDetailSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder for HistoricalTripDetailScreen:
 * Status banner, Route timeline card, Payment breakdown card, Driver/Vehicle card.
 */
export const TripDetailSkeleton: React.FC<TripDetailSkeletonProps> = ({
  testID = 'trip-detail-skeleton',
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
      {/* Status & Meta Banner */}
      <View style={styles.statusSection}>
        <View style={styles.statusCard}>
          <SkeletonCircle size={28} />
          <View style={styles.statusTextWrap}>
            <Skeleton width={140} height={16} borderRadius={4} />
            <Skeleton width={110} height={12} borderRadius={4} style={styles.subText} />
          </View>
        </View>
        <View style={styles.metaRow}>
          <Skeleton width={80} height={11} borderRadius={4} />
          <Skeleton width={60} height={11} borderRadius={4} />
        </View>
      </View>

      {/* Route Timeline Card */}
      <SkeletonCard style={styles.card}>
        <Skeleton width={130} height={16} borderRadius={4} style={styles.cardTitle} />
        <View style={styles.timelineRow}>
          <SkeletonCircle size={12} />
          <View style={styles.addressWrap}>
            <Skeleton width={60} height={10} borderRadius={4} />
            <Skeleton width="85%" height={14} borderRadius={4} style={styles.subText} />
          </View>
        </View>
        <View style={styles.timelineLine} />
        <View style={styles.timelineRow}>
          <SkeletonCircle size={12} />
          <View style={styles.addressWrap}>
            <Skeleton width={70} height={10} borderRadius={4} />
            <Skeleton width="75%" height={14} borderRadius={4} style={styles.subText} />
          </View>
        </View>
      </SkeletonCard>

      {/* Payment Summary Card */}
      <SkeletonCard style={styles.card}>
        <Skeleton width={140} height={16} borderRadius={4} style={styles.cardTitle} />
        <View style={styles.priceRow}>
          <Skeleton width={80} height={13} borderRadius={4} />
          <Skeleton width={60} height={13} borderRadius={4} />
        </View>
        <View style={styles.priceRow}>
          <Skeleton width={90} height={13} borderRadius={4} />
          <Skeleton width={45} height={13} borderRadius={4} />
        </View>
        <View style={[styles.priceRow, styles.totalRow]}>
          <Skeleton width={100} height={16} borderRadius={4} />
          <Skeleton width={75} height={16} borderRadius={4} />
        </View>
      </SkeletonCard>

      {/* Driver Card */}
      <SkeletonCard style={styles.card}>
        <View style={styles.driverRow}>
          <SkeletonCircle size={48} />
          <View style={styles.driverInfo}>
            <Skeleton width={130} height={16} borderRadius={4} />
            <Skeleton width={90} height={12} borderRadius={4} style={styles.subText} />
          </View>
          <Skeleton width={50} height={24} borderRadius={12} />
        </View>
      </SkeletonCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  statusSection: {
    marginBottom: spacing.md,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEEF1',
  },
  statusTextWrap: {
    marginLeft: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  subText: {
    marginTop: 6,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardTitle: {
    marginBottom: spacing.md,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineLine: {
    width: 2,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginLeft: 5,
    marginVertical: 4,
  },
  addressWrap: {
    marginLeft: spacing.md,
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#ECEEF1',
    marginTop: 6,
    paddingTop: 10,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
});
