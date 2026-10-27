import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonListItem } from './SkeletonListItem';
import { spacing, borderRadius } from '../../theme';

export interface ProfileSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Skeleton placeholder for Customer ProfileScreen:
 * Large avatar circle, display name & phone lines, edit button, and navigation menu list items.
 */
export const ProfileSkeleton: React.FC<ProfileSkeletonProps> = ({
  testID = 'profile-skeleton',
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
      {/* Profile Header */}
      <View style={styles.headerSection}>
        <SkeletonCircle size={88} style={styles.avatar} />
        <Skeleton width={160} height={20} borderRadius={4} style={styles.name} />
        <Skeleton width={120} height={14} borderRadius={4} style={styles.phone} />
        <Skeleton width={110} height={32} borderRadius={borderRadius.full} style={styles.badge} />
      </View>

      {/* Primary Section Cards */}
      <SkeletonCard style={styles.menuCard}>
        <SkeletonListItem iconSize={24} lines={1} style={styles.menuRow} />
        <SkeletonListItem iconSize={24} lines={1} style={styles.menuRow} />
        <SkeletonListItem iconSize={24} lines={1} style={styles.menuRow} />
      </SkeletonCard>

      <SkeletonCard style={styles.menuCard}>
        <SkeletonListItem iconSize={24} lines={1} style={styles.menuRow} />
        <SkeletonListItem iconSize={24} lines={1} style={styles.menuRow} />
      </SkeletonCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerSection: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  avatar: {
    marginBottom: spacing.md,
  },
  name: {
    marginBottom: 6,
  },
  phone: {
    marginBottom: spacing.md,
  },
  badge: {
    marginTop: 2,
  },
  menuCard: {
    marginBottom: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  menuRow: {
    marginVertical: 0,
    borderWidth: 0,
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F7',
  },
});
