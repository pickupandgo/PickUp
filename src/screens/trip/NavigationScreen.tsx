import { TripMapSheet } from '../../components/organisms/TripMapSheet';
import { useTripMapLayout } from '../../hooks/useTripMapLayout';
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} from '../../theme';
import { DriverMap, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { TrackingService } from '../../services/tracking/TrackingService';
import { useLiveTrip } from '../../hooks/useActiveTrip';
import { TripLoadNotice } from '../../components/molecules/TripLoadNotice';
import { useTripRoute } from '../../hooks/useTripRoute';
import type { HomeScreenProps } from '../../types/navigation';
import { ChatUnreadBadge } from '../../components/notifications/ChatUnreadBadge';

export interface NavigationScreenProps {
  readonly navigation: HomeScreenProps<'Navigation'>['navigation'];
  readonly route: HomeScreenProps<'Navigation'>['route'];
  readonly testID?: string;
}

export const NavigationScreen: React.FC<NavigationScreenProps> = ({
  navigation,
  route: navRoute,
  testID,
}) => {
  const mapLayout = useTripMapLayout();
  const {
    currentLocation,
    permissionState,
    providerEnabled,
    error: locationError,
    requestPermission,
    getCurrentLocation,
  } = useDriverLocation();
  const trip = useLiveTrip(navRoute.params.tripId);
  const {
    route: routingData,
    error: routeError,
    retry: retryRoute,
  } = useTripRoute({ tripId: navRoute.params.tripId });

  const granted = permissionState === 'granted';

  // Once we have permission but no fix yet, ask for an immediate location.
  useEffect(() => {
    if (granted && !currentLocation) {
      getCurrentLocation().catch(() => {});
    }
  }, [granted, currentLocation, getCurrentLocation]);

  const currentStop = trip?.stops[trip?.currentStopIndex ?? 0];
  const isPickup = currentStop?.type === 'pickup';

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
        label:
          stop.type === 'drop' && trip.stops.length > 2
            ? String(index)
            : undefined,
      })),
    };
  }, [trip, routingData]);

  const displayEta = useMemo(() => {
    if (!routingData?.eta) return undefined;
    const diffMs = routingData.eta.getTime() - Date.now();
    return Math.max(0, Math.ceil(diffMs / 60000));
  }, [routingData?.eta]);

  const displayDistance = routingData?.totalDistanceMeters
    ? (routingData.totalDistanceMeters / 1000).toFixed(1)
    : undefined;

  const destinationName =
    currentStop?.label || currentStop?.address?.split(',')[0] || 'Destination';

  // ── Derived UI states ──────────────────────────────────────────────
  const showPermissionModal = !granted;
  const gpsLost = granted && (!providerEnabled || !!locationError);
  const reconnecting = granted && providerEnabled && !currentLocation;
  const networkLost = !!routeError && !routingData;

  // ── Handlers ───────────────────────────────────────────────────────
  const openExternalMaps = useCallback(() => {
    if (!currentStop) return;
    const { latitude, longitude } = currentStop;
    const url = Platform.select({
      ios: `maps://?daddr=${latitude},${longitude}`,
      android: `google.navigation:q=${latitude},${longitude}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    }) as string;
    Linking.openURL(url).catch(() => {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
      ).catch(() => {});
    });
  }, [currentStop]);

  const handleChat = useCallback(() => {
    if (trip)
      navigation.navigate('ActiveTripChat', {
        tripId: trip.id,
        paymentTripId: trip.paymentTripId ?? undefined,
      });
  }, [navigation, trip]);

  const handleMarkArrived = useCallback(() => {
    if (!trip || !currentStop) return;
    if (isPickup) {
      navigation.navigate('ArrivedAtPickup', {
        tripId: trip.id,
        stopId: currentStop.id,
      });
    } else {
      navigation.navigate('DropOTP', {
        tripId: trip.id,
        stopId: currentStop.id,
      });
    }
  }, [navigation, trip, currentStop, isPickup]);

  const handleGrantPermission = useCallback(async () => {
    await requestPermission();
    try {
      await TrackingService.getInstance().recover();
      await getCurrentLocation();
    } catch {
      /* handled via state */
    }
  }, [requestPermission, getCurrentLocation]);

  const handleRetryNetwork = useCallback(() => {
    if (routeError?.code === 'GPS_UNAVAILABLE')
      getCurrentLocation().catch(() => {});
    retryRoute();
  }, [getCurrentLocation, retryRoute, routeError]);

  if (!trip) {
    return (
      <TripLoadNotice
        tripId={navRoute.params.tripId}
        onHome={() => navigation.popToTop()}
      />
    );
  }

  return (
    <View style={styles.flex1} testID={testID}>
      {/* Engine-backed map */}
      <View style={StyleSheet.absoluteFill}>
        <DriverMap
          currentLocation={currentLocation || undefined}
          routeData={routeData}
          cameraScopeKey={trip.id}
          viewportPadding={mapLayout.viewportPadding}
          heading={currentLocation?.bearing}
          showControls
          followDriver
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Top bar */}
      <SafeAreaView
        edges={['top']}
        style={styles.topBar}
        onLayout={mapLayout.onTopLayout}
      >
        <Pressable style={styles.topBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow_back" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.topTitle}>
          {isPickup ? 'NAVIGATING TO PICKUP' : 'NAVIGATING TO DROP'}
        </Text>
        <View style={styles.topBtn} />
      </SafeAreaView>

      {/* GPS lost toast */}
      {gpsLost && (
        <SafeAreaView
          edges={['top']}
          style={styles.gpsToastWrap}
          pointerEvents="none"
        >
          <View style={styles.gpsToast}>
            <Icon name="warning" size={18} color={colors.error} />
            <Text style={styles.gpsToastText}>
              GPS Signal Lost. Searching for location...
            </Text>
          </View>
        </SafeAreaView>
      )}

      {/* Reconnecting pill */}
      {reconnecting && !gpsLost && (
        <View style={styles.reconnectWrap} pointerEvents="none">
          <View style={styles.reconnectPill}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.reconnectText}>Restoring connection...</Text>
          </View>
        </View>
      )}

      {/* Bottom sheet */}
      <TripMapSheet
        title="Trip controls"
        onHeightChange={mapLayout.onSheetHeight}
        footer={
          <Pressable
            style={styles.primaryBtn}
            onPress={handleMarkArrived}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {isPickup ? 'PICKUP DETAILS' : 'DROP DETAILS'}
            </Text>
          </Pressable>
        }
      >
        <View style={styles.sheetInner}>
          {networkLost ? (
            <View style={{ paddingVertical: spacing.gutter }}>
              <Text style={styles.networkTitle}>
                {routeError?.message ?? 'Road routing unavailable'}
              </Text>
              <Pressable
                onPress={handleRetryNetwork}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>RETRY ROUTE</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.tripInfoRow}>
            <View style={styles.flexShrink}>
              <Text style={styles.destName} numberOfLines={1}>
                {destinationName}
              </Text>
              <View style={styles.metaRow}>
                <Icon name="route" size={16} color={colors.onSurfaceVariant} />
                <Text style={styles.metaText}>
                  {displayDistance != null ? `${displayDistance} km` : '—'}
                </Text>
                <View style={styles.metaDot} />
                <Text style={styles.metaMins}>
                  {displayEta != null ? `${displayEta} mins` : '—'}
                </Text>
              </View>
            </View>
            <View style={styles.secondaryActions}>
              <Pressable
                disabled
                accessibilityRole="button"
                accessibilityLabel="Calling unavailable"
                style={[styles.circleAction, { opacity: 0.4 }]}
              >
                <Icon name="phone_disabled" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                style={styles.circleAction}
                onPress={handleChat}
                accessibilityLabel="Chat"
              >
                <Icon name="chat" size={20} color={colors.primary} />
                <ChatUnreadBadge backendTripId={trip.paymentTripId} />
              </Pressable>
            </View>
          </View>
          <Pressable
            style={styles.mapsBtn}
            onPress={openExternalMaps}
            accessibilityRole="button"
          >
            <Icon name="navigation" size={18} color={colors.primary} />
            <Text style={styles.mapsBtnText}>OPEN IN GOOGLE MAPS</Text>
          </Pressable>
        </View>
      </TripMapSheet>

      {/* Permission modal */}
      {showPermissionModal && (
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Icon name="location_on" size={26} color={colors.primary} />
            </View>
            <Text style={styles.modalTitle}>Enable Location Services</Text>
            <Text style={styles.modalBody}>
              MultipleRide Partner collects and shares your precise location
              with the trip service and your assigned customer during delivery,
              including while minimized or with the screen locked. Android runs
              a location foreground service. Sharing stops when you go offline
              without an active trip or sign out.
            </Text>
            <Pressable
              style={styles.modalBtn}
              onPress={handleGrantPermission}
              accessibilityRole="button"
            >
              <Text style={styles.modalBtnText}>GRANT PERMISSION</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  loadingText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  // GPS toast
  gpsToastWrap: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  gpsToast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.errorContainer,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.containerPadding,
  },
  gpsToastText: {
    ...typography.labelSm,
    color: colors.onErrorContainer,
  },
  // Reconnecting
  reconnectWrap: {
    position: 'absolute',
    bottom: 200,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  reconnectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  reconnectText: { ...typography.labelSm, color: colors.onSurface },
  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.lg,
  },
  sheetInner: {},
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceVariant,
    alignSelf: 'center',
    marginBottom: spacing.containerPadding,
  },
  tripInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.lg,
  },
  flexShrink: { flexShrink: 1, paddingRight: spacing.sm },
  destName: {
    ...typography.headlineMd,
    color: colors.primary,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  metaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  metaMins: { ...typography.dataMono, color: colors.primary },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  circleAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 48,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  mapsBtnText: {
    ...typography.labelCaps,
    color: colors.primary,
    letterSpacing: 1,
  },
  primaryBtn: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    ...typography.labelCaps,
    color: colors.onPrimary,
    letterSpacing: 1,
  },
  // Permission modal
  modalScrim: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    backgroundColor: 'rgba(3,7,29,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.containerPadding,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.lg,
  },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.containerPadding,
  },
  modalTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  modalBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  modalBtn: {
    width: '100%',
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: {
    ...typography.labelCaps,
    color: colors.onPrimary,
    letterSpacing: 1,
  },
  // Network overlay
  networkOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 60,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  networkIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  networkTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    marginBottom: spacing.lg,
  },
  retryBtn: {
    minWidth: 160,
    height: 40,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    ...typography.labelCaps,
    color: colors.primary,
    letterSpacing: 1,
  },
});

export default NavigationScreen;
