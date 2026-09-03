import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { DriverMap, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import { useArrivalDetection } from '../../hooks/useArrivalDetection';
import { useTripRoute } from '../../hooks/useTripRoute';
import type { TripStop } from '../../types/trip';
import type { HomeScreenProps } from '../../types/navigation';

export interface ActiveTripScreenProps {
  readonly navigation: HomeScreenProps<'ActiveTrip'>['navigation'];
  readonly route: HomeScreenProps<'ActiveTrip'>['route'];
  readonly testID?: string;
}

/** Human label for a stop, e.g. "Pickup", "Drop 1". */
function stopLabel(stops: readonly TripStop[], index: number): string {
  const stop = stops[index];
  if (stop.type === 'pickup') return 'Pickup';
  const dropNumber = stops.slice(0, index + 1).filter((s) => s.type !== 'pickup').length;
  return `Drop ${dropNumber}`;
}

export const ActiveTripScreen: React.FC<ActiveTripScreenProps> = ({
  navigation,
  route: navRoute,
  testID,
}) => {
  const { currentLocation } = useDriverLocation();
  const trip = useActiveTrip(navRoute.params?.tripId);
  const { route: routingData } = useTripRoute();

  useArrivalDetection((event) => {
    if (trip && event.tripId === trip.id) {
      navigation.navigate('ArrivedAtPickup', {
        tripId: event.tripId,
        stopId: event.stopId,
      });
    }
  });

  const currentStop = trip?.stops[trip?.currentStopIndex ?? 0];

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

  const displayEta = useMemo(() => {
    if (!routingData?.eta) return currentStop?.etaMinutes;
    const diffMs = routingData.eta.getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / 60000));
  }, [routingData?.eta, currentStop?.etaMinutes]);

  const displayDistance = routingData?.totalDistanceMeters
    ? (routingData.totalDistanceMeters / 1000).toFixed(1)
    : currentStop?.distanceKm ?? trip?.totalDistanceKm;

  const handleNavigate = useCallback(() => {
    if (trip) navigation.navigate('Navigation', { tripId: trip.id });
  }, [navigation, trip]);

  const handleTripDetails = useCallback(() => {
    if (trip) navigation.navigate('MultiStopJourney', { tripId: trip.id });
  }, [navigation, trip]);

  const handleSupport = useCallback(() => {
    if (trip) navigation.navigate('ActiveTripChat', { tripId: trip.id });
  }, [navigation, trip]);

  if (!trip) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading Trip...</Text>
      </View>
    );
  }

  const currentIndex = trip.currentStopIndex;
  const totalDrops = trip.stops.filter((s) => s.type !== 'pickup').length;
  const isPickup = currentStop?.type === 'pickup';
  const currentDropNumber = isPickup
    ? 0
    : trip.stops.slice(0, currentIndex + 1).filter((s) => s.type !== 'pickup').length;
  const statusCaps = isPickup ? 'PICKUP' : `DROP ${currentDropNumber} OF ${totalDrops}`;
  const arrivingLabel = isPickup ? 'Pickup' : `Drop ${currentDropNumber}`;

  return (
    <View style={styles.flex1} testID={testID}>
      {/* Full-screen map */}
      <View style={StyleSheet.absoluteFill}>
        <DriverMap
          currentLocation={currentLocation || undefined}
          routeData={routeData}
          showControls={false}
          followDriver
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Top overlay: back / status / support */}
      <SafeAreaView edges={['top']} style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable style={styles.circleBtn} onPress={() => navigation.goBack()}>
            <Icon name="arrow_back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillCaps}>{statusCaps}</Text>
            <Text style={styles.statusPillTitle} numberOfLines={1}>
              {currentStop?.label ?? ''}
            </Text>
          </View>
          <Pressable style={styles.circleBtn} onPress={handleSupport}>
            <Icon name="support_agent" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Bottom info panel */}
      <SafeAreaView edges={['bottom']} style={styles.bottomPanel}>
        <View style={styles.panelInner}>
          {/* ETA + status */}
          <View style={styles.etaRow}>
            <View style={styles.flexShrink}>
              <Text style={styles.etaText}>
                {displayDistance != null ? `${displayDistance} km` : ''}
                {displayEta != null ? <Text style={styles.etaSub}>{`  · ${displayEta} min`}</Text> : null}
              </Text>
              <Text style={styles.arrivingText}>Arriving at {arrivingLabel}</Text>
            </View>
            <View style={styles.onTimeBadge}>
              <Icon name="speed" size={16} color={colors.onSecondaryContainer} />
              <Text style={styles.onTimeText}>On Time</Text>
            </View>
          </View>

          {/* Route progression */}
          <View style={styles.timeline}>
            {trip.stops.map((stop, index) => {
              const isCompleted = stop.status === 'completed';
              const isCurrent = index === currentIndex;
              const isLast = index === trip.stops.length - 1;
              const label = stopLabel(trip.stops, index);
              return (
                <View key={stop.id} style={styles.tlRow}>
                  <View style={styles.tlIconCol}>
                    <Icon
                      name={
                        isCompleted
                          ? 'check_circle'
                          : isCurrent
                            ? 'radio_button_checked'
                            : 'radio_button_unchecked'
                      }
                      size={18}
                      color={isCurrent || isCompleted ? colors.primary : colors.outlineVariant}
                    />
                    {!isLast && <View style={styles.tlConnector} />}
                  </View>
                  <View style={[styles.tlTextCol, isCompleted && styles.tlCompleted]}>
                    {isCurrent ? (
                      <>
                        <Text style={styles.tlCurrentTitle}>{label} (Current)</Text>
                        {!!stop.address && (
                          <Text style={styles.tlCurrentAddress} numberOfLines={1}>
                            {stop.address}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.tlLabel}>{label}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable style={styles.navBtn} onPress={handleNavigate} accessibilityRole="button">
              <Icon name="navigation" size={18} color={colors.onPrimary} />
              <Text style={styles.navBtnText}>NAVIGATE</Text>
            </Pressable>
            <Pressable
              style={styles.detailsBtn}
              onPress={handleTripDetails}
              accessibilityRole="button"
            >
              <Icon name="list_alt" size={18} color={colors.primary} />
              <Text style={styles.detailsBtnText}>TRIP DETAILS</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  // Top overlay
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.xs,
  },
  circleBtn: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.md,
  },
  statusPill: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    maxWidth: '55%',
    ...shadows.md,
  },
  statusPillCaps: {
    ...typography.labelCaps,
    color: colors.secondary,
  },
  statusPillTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  // Bottom panel
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.lg,
  },
  panelInner: {
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.containerPadding,
  },
  etaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    paddingBottom: spacing.containerPadding,
  },
  flexShrink: {
    flexShrink: 1,
  },
  etaText: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  etaSub: {
    ...typography.bodyLg,
    color: colors.secondary,
  },
  arrivingText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  onTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  onTimeText: {
    ...typography.labelSm,
    color: colors.onSecondaryContainer,
  },
  // Timeline
  timeline: {
    paddingVertical: spacing.xs,
  },
  tlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tlIconCol: {
    alignItems: 'center',
    width: 18,
  },
  tlConnector: {
    width: 1,
    height: 20,
    backgroundColor: colors.outlineVariant,
    marginVertical: 2,
  },
  tlTextCol: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  tlCompleted: {
    opacity: 0.6,
  },
  tlLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  tlCurrentTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  tlCurrentAddress: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  // Actions
  actions: {
    flexDirection: 'row',
    gap: spacing.containerPadding,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: borderRadius.full,
  },
  navBtnText: {
    ...typography.labelCaps,
    color: colors.onPrimary,
  },
  detailsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
    height: 56,
    borderRadius: borderRadius.full,
  },
  detailsBtnText: {
    ...typography.labelCaps,
    color: colors.primary,
  },
});

export default ActiveTripScreen;
