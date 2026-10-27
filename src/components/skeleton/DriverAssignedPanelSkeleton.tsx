import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonButton } from './SkeletonButton';
import { spacing, borderRadius } from '../../theme';

export interface DriverAssignedPanelSkeletonProps {
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Bottom sheet panel skeleton for tracking screens (DriverAssignedScreen, DriverAssignedExpandedScreen):
 * Sits over the live MapCanvas while driver/vehicle data hydrations finish.
 */
export const DriverAssignedPanelSkeleton: React.FC<DriverAssignedPanelSkeletonProps> = ({
  testID = 'driver-assigned-panel-skeleton',
}) => {
  return (
    <View
      style={styles.container}
      testID={testID}
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Status Header */}
      <View style={styles.statusRow}>
        <View style={styles.statusCol}>
          <Skeleton width={140} height={18} borderRadius={4} />
          <Skeleton width={180} height={13} borderRadius={4} style={styles.subText} />
        </View>
        <Skeleton width={50} height={24} borderRadius={12} />
      </View>

      {/* Driver Card */}
      <View style={styles.driverCard}>
        <SkeletonCircle size={52} />
        <View style={styles.driverInfo}>
          <Skeleton width={130} height={16} borderRadius={4} />
          <Skeleton width={90} height={12} borderRadius={4} style={styles.subText} />
        </View>
        <Skeleton width={70} height={28} borderRadius={borderRadius.md} />
      </View>

      {/* OTP Code Badge */}
      <View style={styles.otpRow}>
        <Skeleton width={90} height={14} borderRadius={4} />
        <Skeleton width={60} height={24} borderRadius={6} />
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonRow}>
        <SkeletonButton height={44} style={styles.buttonHalf} borderRadius={borderRadius.full} />
        <SkeletonButton height={44} style={styles.buttonHalf} borderRadius={borderRadius.full} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statusCol: {
    flex: 1,
  },
  subText: {
    marginTop: 6,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  driverInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  buttonHalf: {
    flex: 1,
  },
});
