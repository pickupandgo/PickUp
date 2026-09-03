import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockActiveTrip } from '../../data/mockData';
import { MultiStopTimeline } from '../../components/organisms/MultiStopTimeline';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { DriverMap, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import { useTripRoute } from '../../hooks/useTripRoute';
import type { HomeScreenProps } from '../../types/navigation';

export interface MultiStopJourneyScreenProps {
  readonly navigation: HomeScreenProps<'MultiStopJourney'>['navigation'];
  readonly route: HomeScreenProps<'MultiStopJourney'>['route'];
  readonly testID?: string;
}

/** Turn a raw address into a compact label, dropping a leading house/door number. */
function compactAddress(address?: string): string {
  if (!address) return 'Destination';
  const parts = address
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Drop a leading pure-number token like "222" so the area name shows first.
  if (parts.length > 1 && /^\d+$/.test(parts[0])) parts.shift();
  const label = parts.slice(0, 2).join(', ');
  return label || address;
}

export const MultiStopJourneyScreen: React.FC<MultiStopJourneyScreenProps> = ({
  navigation,
  route: navRoute,
  testID,
}) => {
  const { currentLocation } = useDriverLocation();
  const trip = useActiveTrip() || mockActiveTrip;
  const { route: routingData } = useTripRoute();

  const handleNavigateToStop = useCallback(
    (stopId: string) => {
      const stopIndex = trip.stops.findIndex((s) => s.id === stopId);
      const stop = trip.stops[stopIndex];
      if (!stop) return;
      if (stop.type === 'pickup') {
        navigation.navigate('ArrivedAtPickup', { tripId: trip.id, stopId });
      } else {
        navigation.navigate('DropOTP', { tripId: trip.id, stopId });
      }
    },
    [navigation, trip],
  );

  const routeData = useMemo<RouteData | undefined>(() => {
    if (!trip) return undefined;
    return {
      polylinePoints: routingData?.polylinePoints || [],
      bounds: routingData?.bounds,
      stops: trip.stops.map((stop, index) => ({
        id: stop.id,
        type: stop.type as StopType,
        coordinate: { latitude: stop.latitude, longitude: stop.longitude },
        isCurrent: index === trip.currentStopIndex,
        completed: stop.status === 'completed',
        label: stop.type === 'drop' && trip.stops.length > 2 ? String(index) : undefined,
      })),
    };
  }, [trip, routingData]);

  const currentStopIndex = trip.currentStopIndex;
  const totalDrops = trip.stops.filter((s) => s.type === 'drop').length;
  const currentDropNumber = currentStopIndex;
  const currentStop = trip.stops[currentStopIndex];
  const isPickup = currentStop?.type === 'pickup';

  const topIndicatorLabel = isPickup ? 'PICKUP' : `DROP ${currentDropNumber} OF ${totalDrops}`;
  const topIndicatorName = compactAddress(currentStop?.address);

  const displayEta = routingData?.eta
    ? Math.max(0, Math.ceil((routingData.eta.getTime() - Date.now()) / 60000))
    : currentStop?.etaMinutes || 0;

  const displayDistance = routingData?.totalDistanceMeters
    ? (routingData.totalDistanceMeters / 1000).toFixed(1)
    : currentStop?.distanceKm ?? trip.totalDistanceKm;

  return (
    <View style={styles.root} testID={testID}>
      {/* Full-screen map */}
      <View style={StyleSheet.absoluteFill}>
        <DriverMap
          currentLocation={currentLocation || undefined}
          routeData={routeData}
          followDriver
          showControls={false}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Top overlay: back + compact status pill */}
      <SafeAreaView edges={['top']} style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Icon name="arrow_back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>{topIndicatorLabel}</Text>
            <Text style={styles.pillName} numberOfLines={1}>
              {topIndicatorName}
            </Text>
          </View>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      {/* Bottom panel */}
      <SafeAreaView edges={['bottom']} style={styles.bottomPanel}>
        <View style={styles.summaryRow}>
          <Text style={styles.distanceText}>
            {displayDistance != null ? `${displayDistance} km` : '—'}
          </Text>
          <Text style={styles.etaText}> • {displayEta} min</Text>
        </View>

        <View style={styles.arrivingRow}>
          <Text style={styles.arrivingText}>
            {isPickup ? 'Arriving at Pickup' : `Arriving at Drop ${currentDropNumber}`}
          </Text>
          <View style={styles.onTimeBadge}>
            <Icon name="schedule" size={14} color={colors.onSecondaryContainer} />
            <Text style={styles.onTimeText}>On Time</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.timelineContainer}>
          <MultiStopTimeline stops={trip.stops} currentStopIndex={trip.currentStopIndex} />
        </View>

        <PrimaryButton
          label={isPickup ? 'ARRIVED AT PICKUP' : `CONFIRM DROP ${currentDropNumber}`}
          onPress={() => {
            if (currentStop) handleNavigateToStop(currentStop.id);
          }}
        />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Top overlay
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  pill: {
    maxWidth: '68%',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 6,
    borderRadius: borderRadius.lg,
    ...shadows.md,
  },
  pillLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  pillName: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  // Bottom panel
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.outlineVariant,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    ...shadows.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  distanceText: {
    ...typography.headlineMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  etaText: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
  },
  arrivingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  arrivingText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  onTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    gap: 4,
  },
  onTimeText: {
    ...typography.labelSm,
    color: colors.onSecondaryContainer,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.md,
  },
  timelineContainer: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.lg,
  },
});

export default MultiStopJourneyScreen;
