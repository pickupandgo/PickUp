import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { DashboardResource } from '../../hooks/useHomeDashboard';
import type { DriverOnboardingSummary } from '../../services/onboarding/DriverOnboardingService';
import { currentVehicle } from '../../services/dashboard/HomeDashboardService';
import { VehicleAvatar } from '../atoms/VehicleAvatar';
import { DashboardAction } from './DashboardAction';
import { borderRadius, colors, spacing, typography } from '../../theme';

export function CurrentVehicleCard({ resource, onManage, onRetry }: {
  resource: DashboardResource<DriverOnboardingSummary>; onManage: () => void; onRetry: () => void;
}) {
  const vehicle = resource.data ? currentVehicle(resource.data) : null;
  return <View style={styles.card} testID="current-vehicle-card">
    <Text style={styles.heading}>CURRENT VEHICLE</Text>
    {resource.loading ? <View accessibilityLabel="Loading vehicle information" style={styles.skeleton}>
      <ActivityIndicator color={colors.startupBlueDark} /><View style={styles.skeletonLine} />
    </View> : resource.error ? <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{resource.error}</Text>
      <DashboardAction label="RETRY VEHICLE" onPress={onRetry} />
    </> : vehicle ? <View style={styles.row}>
      <VehicleAvatar vehicle={vehicle.category} size={56} />
      <View style={styles.details}>
        <Text style={styles.name}>{vehicle.makeModel}</Text>
        <Text style={styles.body}>{vehicle.registrationNumber}</Text>
        <View style={styles.badge}><Text style={styles.status}>{vehicle.status.replace(/_/g, ' ')}</Text></View>
        {vehicle.status === 'REJECTED' && vehicle.rejectionReason ? <Text style={styles.body}>{vehicle.rejectionReason}</Text> : null}
        {!vehicle.active ? <Text style={styles.body}>Not active for trips</Text> : null}
      </View>
    </View> : <>
      <Text style={styles.body}>{resource.data?.vehicles.length ? 'Choose your current vehicle in vehicle registration.' : 'No vehicle registered yet.'}</Text>
      <DashboardAction label={resource.data?.vehicles.length ? 'MANAGE VEHICLES' : 'REGISTER VEHICLE'} onPress={onManage} />
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: borderRadius.xl,
    padding: spacing.containerPadding, gap: spacing.sm, borderWidth: 1, borderColor: colors.outlineVariant },
  heading: { ...typography.labelCaps, color: colors.onSurfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  details: { flex: 1, minWidth: 0, gap: spacing.xs },
  name: { ...typography.bodyMd, fontWeight: '600', color: colors.onSurface },
  body: { ...typography.labelSm, color: colors.onSurfaceVariant, flexShrink: 1 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, maxWidth: '100%' },
  status: { ...typography.labelCaps, color: colors.onSurface, fontSize: 11 },
  skeleton: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skeletonLine: { flex: 1, height: 20, borderRadius: 4, backgroundColor: colors.surfaceContainerHigh },
});
