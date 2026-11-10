import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DashboardResource } from '../../hooks/useHomeDashboard';
import type { DriverOnboardingSummary } from '../../services/onboarding/DriverOnboardingService';
import { currentVehicle } from '../../services/dashboard/HomeDashboardService';
import { VehicleAvatar } from '../atoms/VehicleAvatar';
import Icon from '../atoms/Icon';
import { DashboardAction } from './DashboardAction';
import { borderRadius, colors, spacing, typography } from '../../theme';

export function CurrentVehicleCard({ resource, onManage, onRetry, compact = false }: {
  resource: DashboardResource<DriverOnboardingSummary>; onManage: () => void; onRetry: () => void; compact?: boolean;
}) {
  const vehicle = resource.data ? currentVehicle(resource.data) : null;
  return <View>
    {compact && <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>Your vehicle</Text>
      <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel="View vehicle" style={styles.viewButton}>
        <Text style={styles.viewLabel}>View</Text>
      </Pressable>
    </View>}
    <View style={[styles.card, compact && styles.compact]} testID="current-vehicle-card">
    {!compact && <Text style={styles.heading}>CURRENT VEHICLE</Text>}
    {resource.loading ? <View accessibilityLabel="Loading vehicle information" style={styles.skeleton}>
      <ActivityIndicator color={colors.startupBlueDark} /><View style={styles.skeletonLine} />
    </View> : resource.error ? <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{resource.error}</Text>
      <DashboardAction label="RETRY VEHICLE" onPress={onRetry} />
    </> : vehicle ? <View style={styles.row}>
      <VehicleAvatar vehicle={vehicle.category} size={compact ? 58 : 56} />
      <View style={styles.details}>
        <Text style={[styles.name, compact && styles.compactName]}>{vehicle.makeModel}</Text>
        <Text style={[styles.body, compact && styles.compactBody]}>{vehicle.registrationNumber}</Text>
        {!compact && <View style={styles.badge}><Text style={styles.status}>{vehicle.status.replace(/_/g, ' ')}</Text></View>}
        {vehicle.status === 'REJECTED' && vehicle.rejectionReason ? <Text style={styles.body}>{vehicle.rejectionReason}</Text> : null}
        {!vehicle.active ? <Text style={styles.body}>Not active for trips</Text> : null}
      </View>
      {compact && <View style={[styles.badge, styles.compactBadge, vehicle.status === 'VERIFIED' && styles.verifiedBadge]}>
        {vehicle.status === 'VERIFIED' && <Icon name="verified_user" size={13} color={colors.homeGreen} />}
        <Text style={[styles.compactStatus, vehicle.status === 'VERIFIED' && styles.verifiedText]}>
          {vehicle.status === 'VERIFIED' ? 'Verified' : vehicle.status.replace(/_/g, ' ')}
        </Text>
      </View>}
    </View> : <>
      <Text style={styles.body}>{resource.data?.vehicles.length ? 'Choose your current vehicle in vehicle registration.' : 'No vehicle registered yet.'}</Text>
      <DashboardAction label={resource.data?.vehicles.length ? 'MANAGE VEHICLES' : 'REGISTER VEHICLE'} onPress={onManage} />
    </>}
  </View></View>;
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
  compact: { borderRadius: 10, borderColor: colors.homeBorder, paddingVertical: 8, paddingHorizontal: 12, gap: 6, minHeight: 72 },
  compactName: { fontSize: 13, lineHeight: 18, color: colors.primary },
  compactBody: { fontSize: 11, lineHeight: 15, color: colors.homeMuted },
  compactBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'center', maxWidth: '36%', paddingHorizontal: 6, paddingVertical: 4 },
  verifiedBadge: { backgroundColor: colors.homeMint },
  compactStatus: { fontSize: 10, lineHeight: 14, color: colors.onSurfaceVariant, flexShrink: 1 },
  verifiedText: { color: colors.homeGreen, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.primary },
  viewButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  viewLabel: { fontSize: 12, color: colors.homeGreen, fontWeight: '500' },
});
