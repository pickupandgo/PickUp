import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonCircle } from './SkeletonCircle';
import { spacing, borderRadius } from '../../theme';

export interface SavedAddressesSkeletonProps {
  /** Number of address items to render. Defaults to 3. */
  readonly count?: number;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder for SavedAddressesScreen:
 * Displays address cards with icon badge, title, two-line address snippet, and action placeholder.
 */
export const SavedAddressesSkeleton: React.FC<SavedAddressesSkeletonProps> = ({
  count = 3,
  testID = 'saved-addresses-skeleton',
}) => {
  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.headerLeft}>
              <SkeletonCircle size={40} />
              <View style={styles.titleWrap}>
                <Skeleton width={90} height={16} borderRadius={4} />
                <Skeleton width={140} height={12} borderRadius={4} style={styles.subLine} />
              </View>
            </View>
            <Skeleton width={24} height={24} borderRadius={borderRadius.sm} />
          </View>

          <View style={styles.addressBody}>
            <Skeleton width="92%" height={13} borderRadius={4} />
            <Skeleton width="65%" height={13} borderRadius={4} style={styles.subLine} />
          </View>
        </SkeletonCard>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  titleWrap: {
    marginLeft: spacing.md,
    flex: 1,
  },
  subLine: {
    marginTop: 6,
  },
  addressBody: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F2F4F7',
  },
});
