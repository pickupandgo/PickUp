import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';
import { getDriver } from '../../api/engine';
import type { GeoPoint } from '../../api/types';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoute } from '../../hooks/useRoute';

export interface CustomerLiveTrackingScreenProps {
  readonly onBack?: () => void;
  readonly onCall?: () => void;
  readonly onChat?: () => void;
}

const CustomerLiveTrackingScreen: React.FC<CustomerLiveTrackingScreenProps & { navigation?: any }> = ({
  onBack,
  onCall,
  onChat,
  navigation,
}) => {
  const { trip, setTrip, assignedDriver } = useBooking();

  // No push channel, so the trip and the driver's position are both polled.
  const { trip: polled } = useTripStatus(trip?.id);
  useEffect(() => {
    if (polled) setTrip(polled);
  }, [polled, setTrip]);

  const current = polled ?? trip;
  const driverId = current?.driverId ?? assignedDriver?.id;
  // Declared up-front because effects below read `status` in their dependency
  // arrays; a later `const` would be in the temporal dead zone at render time
  // and Hermes throws "Property 'status' doesn't exist".
  const status = current?.status;

  // Take the customer through completion the moment the driver finishes.
  // `replace` swaps this screen out of the stack so back-swipe doesn't return
  // to live tracking after the trip is done.
  useEffect(() => {
    if (!status) return;
    if (status === 'DELIVERED' || status === 'COMPLETED') {
      navigation?.replace('TripCompletedScreen');
    } else if (status === 'CANCELLED') {
      navigation?.replace('TripCancelledStatusScreen');
    }
  }, [status, navigation]);
  const [driverPoint, setDriverPoint] = useState<GeoPoint | undefined>(
    assignedDriver
      ? { latitude: assignedDriver.latitude, longitude: assignedDriver.longitude }
      : undefined
  );

  // The engine only exposes the driver's location via GET /drivers/:id, and it
  // changes when the driver app pushes an update.
  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const driver = await getDriver(driverId);
        if (!cancelled) {
          setDriverPoint({ latitude: driver.latitude, longitude: driver.longitude });
        }
      } catch {
        // Keep the last known position on a transient failure.
      }
    };

    void tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [driverId]);

  const markers = useMemo<readonly MapMarker[]>(() => {
    const built: MapMarker[] = [];
    if (current?.pickup) {
      built.push({ id: 'pickup', kind: 'pickup', coordinate: current.pickup, title: 'Pickup' });
    }
    if (current?.drop) {
      built.push({ id: 'drop', kind: 'drop', coordinate: current.drop, title: 'Drop' });
    }
    if (driverPoint) {
      built.push({
        id: 'driver',
        kind: 'driver',
        coordinate: driverPoint,
        title: assignedDriver?.name ?? 'Driver',
        description: assignedDriver?.vehicleType,
      });
    }
    return built;
  }, [current?.pickup, current?.drop, driverPoint, assignedDriver]);

  // Route always starts from the driver so the polyline shrinks as they close
  // the distance. Destination flips from pickup to drop once the trip is under
  // way. `useRoute` rounds coordinates to ~11 m before refetching, so a moving
  // driver doesn't blow through the Directions quota.
  const preTransit =
    status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED' || status === 'PICKUP_VERIFIED';
  const routeDestination = preTransit ? current?.pickup : current?.drop;
  const roadRoute = useRoute(driverPoint ?? current?.pickup, routeDestination);

  // Short status labels driven off the engine's own trip status. No mocks.
  const tripHeadline = (() => {
    switch (status) {
      case 'DRIVER_ASSIGNED':
        return 'Driver assigned';
      case 'DRIVER_ARRIVED':
        return 'Driver has arrived';
      case 'PICKUP_VERIFIED':
        return 'Pickup confirmed';
      case 'IN_TRANSIT':
      case 'DROP_PROGRESS':
        return 'On the way to the drop';
      case 'DELIVERED':
      case 'COMPLETED':
        return 'Trip completed';
      case 'CANCELLED':
        return 'Trip cancelled';
      default:
        return 'Tracking your trip';
    }
  })();

  const tripSubtitle = preTransit
    ? `Pickup: ${current?.pickup?.address ?? '—'}`
    : `Drop: ${current?.drop?.address ?? '—'}`;

  // Bar advances as the engine reports progress.
  const progressPercent: `${number}%` =
    status === 'DRIVER_ARRIVED'
      ? '20%'
      : status === 'PICKUP_VERIFIED'
      ? '40%'
      : status === 'IN_TRANSIT'
      ? '65%'
      : status === 'DROP_PROGRESS'
      ? '85%'
      : status === 'DELIVERED' || status === 'COMPLETED'
      ? '100%'
      : '10%';

  return (
    <View style={styles.container}>
      {/* Network Offline Banner (Simulated Hidden State) */}
      {/* 
      <View style={styles.networkBanner}>
        <Feather name="wifi-off" size={16} color={colors.onErrorContainer} />
        <Text style={styles.networkBannerText}>Reconnecting... trying to find your driver</Text>
      </View>
      */}

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onBack ? onBack() : navigation?.goBack())}
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
            <Text style={styles.headerTitle}>Live Tracking</Text>
          </View>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Live map: pickup, drop and the driver's last reported position. */}
      <MapCanvas
        style={styles.mapCanvas}
        markers={markers}
        fitToMarkers={markers.length > 1}
        polyline={roadRoute}
      />

      {/* Bottom Overlay Container */}
      <View style={styles.bottomOverlay}>
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.tripStatusCard}>
            <View style={styles.tripStatusHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripStatusTitle}>{tripHeadline}</Text>
                {current?.drop?.address && (
                  <Text style={styles.tripStatusSubtitle} numberOfLines={1}>
                    {tripSubtitle}
                  </Text>
                )}
              </View>
            </View>

            {/* Coarse progress bar driven off the trip status. */}
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: progressPercent }]} />
            </View>

            <View style={styles.driverDetailsContainer}>
              <View style={styles.driverDetailsHeader}>
                <View style={styles.driverInfoLeft}>
                  <View style={styles.driverAvatarContainer}>
                    <Feather name="user" size={22} color={colors.onSurfaceVariant} />
                  </View>
                  <View>
                    <Text style={styles.driverName}>
                      {assignedDriver?.name ?? 'Your driver'}
                    </Text>
                    {assignedDriver?.vehicleType && (
                      <View style={styles.driverSubInfo}>
                        <Feather name="truck" size={12} color={colors.onSurfaceVariant} />
                        <Text style={styles.driverSubInfoText}>
                          {assignedDriver.vehicleType}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                {typeof assignedDriver?.distanceKm === 'number' && (
                  <View style={styles.licensePlateBadge}>
                    <Text style={styles.licensePlateText}>
                      {assignedDriver.distanceKm.toFixed(1)} km
                    </Text>
                  </View>
                )}
              </View>

              {/* The trip is ended by the driver in-app; customer only calls or
                  chats. Cancellation is available from the header back path. */}
              <View style={styles.actionsContainer}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => (onCall ? onCall() : navigation?.navigate('CallDriverScreen'))}
                  accessibilityRole="button"
                >
                  <Feather name="phone" size={18} color={colors.onSurface} />
                  <Text style={styles.actionButtonText}>Call</Text>
                </Pressable>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => (onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen'))}
                  accessibilityRole="button"
                >
                  <Feather name="message-circle" size={18} color={colors.onSurface} />
                  <Text style={styles.actionButtonText}>Chat</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f0f2', // map bg pattern color
  },
  
  // Header
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  liveBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },

  // Map Canvas
  mapCanvas: {
    flex: 1,
    position: 'relative',
  },
  mockMapPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f3f0f2',
  },
  pickupMarkerContainer: {
    position: 'absolute',
    top: '20%',
    left: '20%',
    alignItems: 'center',
    zIndex: 10,
  },
  pickupMarkerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primaryContainer,
    ...shadows.sm,
  },
  pickupMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primaryContainer,
  },
  markerLabelContainer: {
    marginTop: 4,
    backgroundColor: colors.surface + 'CC',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  markerLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  driverMarkerContainer: {
    position: 'absolute',
    top: '40%',
    left: '40%',
    alignItems: 'center',
    zIndex: 20,
  },
  driverMarkerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  driverTimeLabel: {
    marginTop: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...shadows.sm,
  },
  driverTimeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },

  drop1MarkerContainer: {
    position: 'absolute',
    top: '55%',
    left: '45%',
    alignItems: 'center',
    zIndex: 10,
  },
  drop2MarkerContainer: {
    position: 'absolute',
    top: '75%',
    left: '80%',
    alignItems: 'center',
    zIndex: 10,
  },
  dropMarkerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    ...shadows.sm,
  },
  dropMarkerText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
  },

  // Bottom Overlay
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.lg,
    zIndex: 30,
  },
  safeArea: {
    width: '100%',
  },
  tripStatusCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...shadows.card,
  },
  tripStatusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  tripStatusTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  tripStatusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  tripStatusHighlight: {
    fontWeight: '600',
    color: colors.primary,
  },
  onTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  onTimeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primaryContainer,
    borderRadius: borderRadius.full,
  },
  
  driverDetailsContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
    paddingTop: spacing.lg,
  },
  driverDetailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  driverInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  driverAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  driverAvatar: {
    width: '100%',
    height: '100%',
  },
  driverName: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  driverSubInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  driverSubInfoText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  licensePlateBadge: {
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  licensePlateText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  actionButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  iconOnlyButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
});

export default CustomerLiveTrackingScreen;
