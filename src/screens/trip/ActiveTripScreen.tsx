import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { MultiStopTimeline } from '../../components/organisms/MultiStopTimeline';
import { DriverMap, MapOverlay, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import { useArrivalDetection } from '../../hooks/useArrivalDetection';
import { useTripRoute } from '../../hooks/useTripRoute';
import type { HomeScreenProps } from '../../types/navigation';

export interface ActiveTripScreenProps {
  readonly navigation: HomeScreenProps<'ActiveTrip'>['navigation'];
  readonly route: HomeScreenProps<'ActiveTrip'>['route'];
  readonly testID?: string;
}

export const ActiveTripScreen: React.FC<ActiveTripScreenProps> = ({
  navigation,
  route: navRoute,
  testID,
}) => {
  const { currentLocation, error: locationError } = useDriverLocation();
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

  const currentStop = trip?.stops[trip.currentStopIndex];
  const isPickupPhase = currentStop?.type === 'pickup';

  const routeData = useMemo<RouteData | undefined>(() => {
    if (!trip) return undefined;
    return {
      polylinePoints: routingData?.polylinePoints || [],
      bounds: routingData?.bounds,
      stops: trip.stops.map((stop, index) => ({
        id: stop.id,
        type: stop.type as StopType,
        coordinate: {
          latitude: stop.latitude,
          longitude: stop.longitude,
        },
        isCurrent: index === trip.currentStopIndex,
        completed: stop.status === 'completed',
        label: stop.type === 'drop' && trip.stops.length > 2 ? String(index) : undefined
      }))
    };
  }, [trip, routingData]);

  const displayEta = useMemo(() => {
    if (!routingData?.eta) return currentStop?.etaMinutes;
    const diffMs = routingData.eta.getTime() - Date.now();
    const mins = Math.max(0, Math.ceil(diffMs / 60000));
    return mins;
  }, [routingData?.eta, currentStop?.etaMinutes]);

  const displayDistance = routingData?.totalDistanceMeters ? (routingData.totalDistanceMeters / 1000).toFixed(1) : 4.2; // mock fallback

  const handleNavigateToStop = useCallback(() => {
    if (trip && currentStop) {
      // Drop phase: go to the drop confirmation flow.
      navigation.navigate('DropOTP', { tripId: trip.id, stopId: currentStop.id });
    }
  }, [navigation, currentStop, trip]);

  const handleArrivedAtPickup = useCallback(() => {
    if (trip && currentStop) {
      navigation.navigate('ArrivedAtPickup', { tripId: trip.id, stopId: currentStop.id });
    }
  }, [navigation, trip, currentStop]);

  const handleOpenMultiStop = useCallback(() => {
    if (trip) {
      navigation.navigate('MultiStopJourney', { tripId: trip.id });
    }
  }, [navigation, trip]);

  const handleCall = useCallback(() => {}, []);
  const handleChat = useCallback(() => {
    if (trip) {
      navigation.navigate('ActiveTripChat', { tripId: trip.id });
    }
  }, [navigation, trip]);

  if (!trip) {
    return (
      <View style={[styles.flex1, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text>Loading Trip...</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex1} testID={testID}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.header}>
          <Icon name="menu" style={styles.menuIcon} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>TRIP #{trip.id.split('-')[0].toUpperCase()}</Text>
            <View style={styles.inProgressContainer}>
              <View style={styles.inProgressDot} />
              <Text style={styles.inProgressText}>IN PROGRESS</Text>
            </View>
          </View>
          <Icon name="notifications_none" style={styles.bellIcon} />
        </SafeAreaView>

        {/* Embedded Map Card */}
        <View style={styles.mapCard}>
          <DriverMap
            currentLocation={currentLocation || undefined}
            routeData={routeData}
            showControls={false}
            followDriver={true}
          />
          
          <MapOverlay position="top" style={styles.mapOverlayTop}>
            {locationError && (
              <View style={styles.gpsWarning}>
                <Icon name="gps_off" style={styles.gpsWarningIcon} />
                <Text style={styles.gpsWarningText}>GPS Signal Weak</Text>
              </View>
            )}
            {locationError && (
              <View style={styles.reconnectingPill}>
                <Icon name="sync" style={styles.reconnectingIcon} />
                <Text style={styles.reconnectingText}>Reconnecting...</Text>
              </View>
            )}
          </MapOverlay>

          {/* Metrics Overlay (Inside Map at Bottom) */}
          <MapOverlay position="bottom" style={styles.metricsOverlay}>
            <View style={styles.metricsCard}>
              <Text style={styles.metricValue}>ETA {displayEta} min • {displayDistance} km</Text>
            </View>
          </MapOverlay>
        </View>

        {/* Flat Content below map */}
        <View style={styles.contentSection}>
          <View style={styles.stopHeader}>
            <View style={styles.stopHeaderLeft}>
              <Text style={styles.stopTitle}>
                {currentStop?.type === 'pickup' ? 'Pickup' : `Drop-off ${trip.currentStopIndex}`}
              </Text>
              <Text style={styles.stopAddress} numberOfLines={1}>{currentStop?.address}</Text>
            </View>
            <View style={styles.stopHeaderRight}>
              <Pressable style={styles.actionButtonCircle} onPress={handleCall}>
                <Icon name="call" style={styles.actionButtonIcon} />
              </Pressable>
              <Pressable style={styles.actionButtonCircle} onPress={handleChat}>
                <Icon name="chat" style={styles.actionButtonIcon} />
              </Pressable>
            </View>
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>STATUS</Text>
              <View style={styles.onTimeBadge}>
                <Text style={styles.onTimeText}>On Time</Text>
              </View>
            </View>
          </View>

          <PrimaryButton
            label="NAVIGATE"
            onPress={isPickupPhase ? handleArrivedAtPickup : handleNavigateToStop}
            style={styles.navigateButton}
          />

          <View style={styles.timelineContainer}>
            <MultiStopTimeline stops={trip.stops} currentStopIndex={trip.currentStopIndex} />
          </View>
          
          <Pressable onPress={handleOpenMultiStop} style={styles.invisibleTouch} />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  menuIcon: { fontSize: 24, color: '#000022' },
  bellIcon: { fontSize: 24, color: '#000022' },
  headerCenter: { alignItems: 'flex-start', flex: 1, paddingLeft: spacing.md },
  headerTitle: { ...typography.headlineMd, fontWeight: 'bold', color: '#000022' },
  inProgressContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  inProgressDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3F51B5' },
  inProgressText: { ...typography.labelSm, color: '#3F51B5', fontWeight: '700' },
  
  mapCard: {
    height: 260,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapOverlayTop: { width: '100%', paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  gpsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffcdd2',
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  gpsWarningIcon: { fontSize: 16, color: colors.error },
  gpsWarningText: { ...typography.labelSm, color: colors.error },
  reconnectingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
  },
  reconnectingIcon: { fontSize: 16, color: colors.surface },
  reconnectingText: { ...typography.labelSm, color: colors.surface },
  
  metricsOverlay: {
    bottom: 8,
    right: 8,
    alignItems: 'flex-end',
  },
  metricsCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  metricValue: {
    ...typography.labelSm,
    color: colors.surface,
  },
  
  contentSection: { gap: spacing.md },
  stopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stopHeaderLeft: { flex: 1, paddingRight: spacing.xs },
  stopTitle: { ...typography.headlineMd, fontWeight: 'bold', color: '#000022' },
  stopAddress: { ...typography.bodyLg, color: colors.onSurfaceVariant, marginTop: 4 },
  stopHeaderRight: { flexDirection: 'row', gap: spacing.xs },
  actionButtonCircle: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  actionButtonIcon: { fontSize: 20, color: '#000022' },
  
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: '700' },
  onTimeBadge: {
    backgroundColor: '#E8EAF6',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#C5CAE9',
  },
  onTimeText: { ...typography.labelSm, color: '#3F51B5', fontWeight: '600' },
  
  navigateButton: { backgroundColor: '#000022', borderRadius: borderRadius.full },
  timelineContainer: { marginTop: spacing.md },
  invisibleTouch: { height: 20, width: '100%' },
});

export default ActiveTripScreen;
