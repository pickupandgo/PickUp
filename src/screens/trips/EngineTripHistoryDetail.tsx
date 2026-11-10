import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { TripStopRow } from '../../components/molecules/TripStopRow';
import { TripEarningCard } from '../../components/molecules/TripEarningCard';
import { useHistoricalTrip } from '../../hooks/useHistoricalTrip';
import { fareText } from '../../services/payments/money';
import type { TripsScreenProps } from '../../types/navigation';

export function DriverHistoryDetail({
  tripId,
  onBack,
  testID,
}: {
  tripId: string;
  onBack: () => void;
  testID?: string;
}) {
  const { trip, loading, error, reload } = useHistoricalTrip(tripId);
  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader title="Trip details" onBackPress={onBack} showBackButton />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!trip ? (
          <View style={styles.sectionCard}>
            <Text style={styles.detailLabel}>
              {loading ? 'Loading trip?' : error ?? 'Trip unavailable'}
            </Text>
            {error ? (
              <Pressable accessibilityRole="button" onPress={reload}>
                <Text style={styles.detailValue}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.headerCard}>
              <Text style={styles.tripId}>Trip #{trip.id}</Text>
              <Text style={styles.tripDate}>
                {trip.date} ? {trip.time}
              </Text>
              <Text style={styles.detailValue}>
                {trip.status === 'completed'
                  ? 'Completed'
                  : trip.status === 'cancelled'
                  ? 'Cancelled'
                  : trip.status}
              </Text>
            </View>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Route</Text>
              {trip.stops.map(stop => (
                <TripStopRow
                  key={stop.id}
                  label={stop.label}
                  address={stop.address}
                  status={stop.status}
                  type={stop.type}
                />
              ))}
            </View>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Trip information</Text>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Vehicle</Text>
                <Text style={styles.detailValue}>{trip.vehicleType}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Weight</Text>
                <Text style={styles.detailValue}>{trip.totalWeight}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Customer fare</Text>
                <Text style={styles.detailValue}>
                  {fareText(trip.customerFarePaise)}
                </Text>
              </View>
              <Text style={styles.detailLabel}>
                Customer fare is separate from your net earnings.
              </Text>
            </View>
            <TripEarningCard tripId={trip.paymentTripId} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
export interface HistoricalTripDetailScreenProps {
  navigation: TripsScreenProps<'HistoricalTripDetail'>['navigation'];
  route: TripsScreenProps<'HistoricalTripDetail'>['route'];
  testID?: string;
}
export const HistoricalTripDetailScreen: React.FC<
  HistoricalTripDetailScreenProps
> = ({ navigation, route, testID }) => (
  <DriverHistoryDetail
    tripId={route.params.tripId}
    onBack={() => navigation.goBack()}
    testID={testID}
  />
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.containerPadding,
  },
  headerCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    ...shadows.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  headerIcon: {
    fontSize: 28,
    color: colors.primary,
  },
  tripId: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  tripDate: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.gutter,
  },
  metricCard: {
    flex: 1,
  },
  sectionCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    ...shadows.sm,
  },
  sectionLabel: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  finRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  finLabel: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  finValue: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  finLabelDeduct: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  finValueDeduct: {
    ...typography.bodyMd,
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  finLabelNet: {
    ...typography.bodyMd,
    fontWeight: '700',
    color: colors.onSurface,
  },
  finValueNet: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#e8f5e9',
    padding: spacing.gutter,
    borderRadius: borderRadius.sm,
    marginTop: 4,
  },
  paidIcon: {
    fontSize: 18,
    color: '#2e7d32',
  },
  paidText: {
    ...typography.labelSm,
    color: '#2e7d32',
    fontWeight: '600',
  },
});

export default HistoricalTripDetailScreen;
