import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings } from '../../data/mockData';
import { bookingOwner, bookingRevision } from '../../state/pendingBooking';
import { useBooking } from '../../state/BookingContext';
import { getCurrentPlace, reverseGeocode, type ResolvedPlace } from '../../api/geocoding';
import type { GeoPoint } from '../../api/types';
import { getActiveTripForCustomer, getDriver, getRide } from '../../api/engine';
import { toApiError } from '../../api/http';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useRecentLocations, saveRecentLocation, type RecentLocation } from '../../state/recentLocations';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { DEFAULT_DELTA } from '../../components/map/MapCanvas.types';
import { getVehicleImage } from '../../utils/vehicleAssets';

import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Button from '../../components/atoms/Button';
import Divider from '../../components/atoms/Divider';

import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { setLoggedIn, setProfileComplete } from '../../state/session';
import { SkeletonListItem, useSkeletonVisibility } from '../../components/skeleton';

export interface HomeScreenProps {
  readonly onSearchPress?: () => void;
  readonly onTripHistory?: () => void;
  readonly onManageAddresses?: () => void;
  readonly onRecentLocationPress?: (addr: string) => void;
  readonly onActiveTripPress?: () => void;
  readonly navigation?: any;
}

const HomeScreen: React.FC<HomeScreenProps & { navigation?: any }> = ({
  navigation,
  onSearchPress,
  onTripHistory,
  onManageAddresses,
  onRecentLocationPress,
  onActiveTripPress,
}) => {
  const {
    draft,
    setPickup,
    setPendingDrop,
    customerId,
    trip,
    setTrip,
    startNewBooking,
    assignedDriver,
    setAssignedDriver,
    setRide, ride, pendingInput, recoveringBooking, bookingRecoveryError, recoverBooking,
  } = useBooking();
  const {
    locations: recentLocations,
    isLoading: isRecentLoading,
    refresh: refreshRecent,
  } = useRecentLocations(customerId);
  const showRecentSkeleton = useSkeletonVisibility({
    isLoading: isRecentLoading,
    hasData: recentLocations.length > 0,
  });
  const insets = useSafeAreaInsets();
  const topSafeOffset = Math.max(insets.top, 36) + spacing.sm;
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string>();
  const blueDotRef = useRef<GeoPoint | undefined>(undefined);
  const [forceCenterKey, setForceCenterKey] = useState(1);
  const [deviceLocation, setDeviceLocation] = useState<any>();
  const deviceLocationRef = useRef<any>(null);
  const isResolvingLocationRef = useRef(false);

  const handleUserLocationChange = useCallback(
    async (loc: any) => {
      if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
      blueDotRef.current = loc;
      deviceLocationRef.current = loc;
      setDeviceLocation(loc);

      // Automatically populate pickup location as soon as map detects user location
      if (!draft.pickup && !isResolvingLocationRef.current) {
        isResolvingLocationRef.current = true;
        try {
          const bp: GeoPoint = {
            latitude: loc.latitude,
            longitude: loc.longitude,
          };
          const resolved = await reverseGeocode(bp).catch(() => '');
          const address = resolved || `${bp.latitude.toFixed(5)}, ${bp.longitude.toFixed(5)}`;
          setPickup({
            latitude: bp.latitude,
            longitude: bp.longitude,
            address,
          });
        } catch {
          // ignore background reverse geocode error
        } finally {
          isResolvingLocationRef.current = false;
        }
      }
    },
    [draft.pickup, setPickup]
  );

  // Reaching Home means the user finished login/onboarding — persist the
  // session so the app reopens on Home until they explicitly log out.
  useEffect(() => {
    void setLoggedIn();
    void setProfileComplete();
  }, []);

  /** Resolves the device position into the pickup point. */
  const locatePickup = useCallback(async () => {
    console.log('[CUSTOMER_MAP] locate button pressed');
    setIsLocating(true);
    setLocationError(undefined);
    try {
      let place = await getCurrentPlace().catch(async (err) => {
        if (
          blueDotRef.current &&
          typeof blueDotRef.current.latitude === 'number' &&
          typeof blueDotRef.current.longitude === 'number' &&
          Number.isFinite(blueDotRef.current.latitude) &&
          Number.isFinite(blueDotRef.current.longitude)
        ) {
          const bp: GeoPoint = {
            latitude: blueDotRef.current.latitude,
            longitude: blueDotRef.current.longitude,
          };
          const resolved = await reverseGeocode(bp).catch(() => '');
          return {
            ...bp,
            address:
              resolved ||
              `${bp.latitude.toFixed(5)}, ${bp.longitude.toFixed(5)}`,
          };
        }
        throw err;
      });
      
      if (
        blueDotRef.current &&
        typeof blueDotRef.current.latitude === 'number' &&
        typeof blueDotRef.current.longitude === 'number' &&
        Number.isFinite(blueDotRef.current.latitude) &&
        Number.isFinite(blueDotRef.current.longitude)
      ) {
        place = {
          ...place,
          latitude: blueDotRef.current.latitude,
          longitude: blueDotRef.current.longitude,
        };
      }
      
      if (place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
        setPickup(place);
        setForceCenterKey(k => k + 1);
      }
    } catch (caught) {
      const apiErr = toApiError(caught);
      if (apiErr.kind === 'network' && caught && (caught as Error).message) {
        setLocationError('DEBUG: ' + (caught as Error).message);
      } else {
        setLocationError(apiErr.userMessage);
      }
    } finally {
      setIsLocating(false);
    }
  }, [setPickup]);

  // Center on user on first mount and initialize pickup with readable address.
  const centerOnUser = useCallback(async () => {
    try {
      const place = await getCurrentPlace().catch(async (err) => {
        if (
          blueDotRef.current &&
          typeof blueDotRef.current.latitude === 'number' &&
          typeof blueDotRef.current.longitude === 'number' &&
          Number.isFinite(blueDotRef.current.latitude) &&
          Number.isFinite(blueDotRef.current.longitude)
        ) {
          const bp: GeoPoint = {
            latitude: blueDotRef.current.latitude,
            longitude: blueDotRef.current.longitude,
          };
          const resolved = await reverseGeocode(bp).catch(() => '');
          return {
            ...bp,
            address:
              resolved ||
              `${bp.latitude.toFixed(5)}, ${bp.longitude.toFixed(5)}`,
          };
        }
        throw err;
      });
      if (place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
        setDeviceLocation(place);
        if (!draft.pickup) {
          setPickup(place);
        }
        setForceCenterKey(k => k + 1);
      }
    } catch {
      // Ignore background errors
    }
  }, [draft.pickup, setPickup]);

  useEffect(() => {
    if (!draft.pickup) void centerOnUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTripActive = Boolean(
    trip &&
    trip.status !== 'DELIVERED' &&
    trip.status !== 'COMPLETED' &&
    trip.status !== 'CANCELLED'
  );

  // Poll trip status while active so pill updates and disappears immediately when completed/cancelled
  const { trip: polledTrip } = useTripStatus(trip?.id, {
    enabled: isTripActive,
    intervalMs: 4_000,
  });

  useEffect(() => {
    if (polledTrip) {
      setTrip(polledTrip);
    }
  }, [polledTrip, setTrip]);

  const latestTrip = useRef(trip);
  latestTrip.current = trip;

  // Restore or refresh active trip and driver info from engine
  const refreshActiveTrip = useCallback(async () => {
    if (!customerId) return;
    const snapshot = latestTrip.current;
    const revision = bookingRevision(customerId);
    const valid = () => bookingOwner() === customerId && bookingRevision(customerId) === revision && latestTrip.current?.id === snapshot?.id;
    try {
      const found = await getActiveTripForCustomer(customerId);
      if (!valid()) return;
      if (found) {
        setTrip(found);
        if (found.driverId) {
          const d = await getDriver(found.driverId).catch(() => null);
          if (d && bookingOwner() === customerId && bookingRevision(customerId) === revision) setAssignedDriver(d);
        }
        if (found.rideId) {
          const r = await getRide(found.rideId).catch(() => null);
          if (r && r.status !== 'CANCELLED' && r.bookingStatus !== 'COMPLETED' && bookingOwner() === customerId && bookingRevision(customerId) === revision) setRide(r);
        }
      } else if (snapshot && latestTrip.current?.id === snapshot.id) {
        // Server reports no active trip anymore
        setTrip(undefined);
      }
    } catch {
      // Offline or backend down: Home still works.
    }
  }, [customerId, setTrip, setAssignedDriver, setRide]);

  useEffect(() => {
    void refreshActiveTrip();
  }, [refreshActiveTrip]);

  useFocusEffect(
    useCallback(() => {
      refreshRecent();
      void recoverBooking?.();
      void refreshActiveTrip();
      if (!draft.pickup) {
        void centerOnUser();
      }
    }, [refreshRecent, refreshActiveTrip, draft.pickup, centerOnUser, recoverBooking])
  );

  const handleRecentLocationSelect = useCallback(
    (loc: RecentLocation) => {
      if (ride || pendingInput || recoveringBooking || bookingRecoveryError) {
        if (ride || pendingInput) navigation?.navigate('ActiveTripStack', { screen: 'FindingDriverScreen' });
        else void recoverBooking?.();
        return;
      }
      startNewBooking();
      const place: ResolvedPlace = {
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        placeId: loc.placeId,
      };
      setPendingDrop(place);
      void saveRecentLocation(loc, customerId);
      onRecentLocationPress?.(loc.address);
      navigation?.navigate('BookingStack', { screen: 'SelectDropLocationScreen' });
    },
    [startNewBooking, setPendingDrop, customerId, onRecentLocationPress, navigation, ride, pendingInput, recoveringBooking, bookingRecoveryError, recoverBooking]
  );

  const resumePreviousBooking = () => {
    if (ride || pendingInput) { navigation?.navigate('ActiveTripStack', { screen: 'FindingDriverScreen' }); return true; }
    if (recoveringBooking || bookingRecoveryError) { void recoverBooking?.(); return true; }
    return false;
  };

  const mapMarkers = useMemo<readonly MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    if (
      draft.pickup &&
      typeof draft.pickup.latitude === 'number' &&
      typeof draft.pickup.longitude === 'number' &&
      Number.isFinite(draft.pickup.latitude) &&
      Number.isFinite(draft.pickup.longitude)
    ) {
      markers.push({
        id: 'pickup',
        kind: 'pickup',
        coordinate: draft.pickup,
        title: 'Pickup',
        label: 'Pickup Point',
        description: draft.pickup.address || 'Pickup location',
      });
    }
    return markers;
  }, [draft.pickup]);

  const pickupAddress = draft.pickup?.address ?? 'Set pickup location';
  const pickupSummary = pickupAddress.split(',').map(part => part.trim()).filter(Boolean).slice(0, 2).join(', ');
  const openDrop = () => {
    if (resumePreviousBooking()) return;
    startNewBooking();
    if (onSearchPress) onSearchPress();
    else navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen' });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Live map with nearby drivers behind the sheet. */}
      <MapCanvas
          style={styles.mapBackground}
          center={draft.pickup || deviceLocation}
          appearance="home"
        markers={mapMarkers}
        showsUserLocation
        onUserLocationChange={handleUserLocationChange}
        zoomDelta={DEFAULT_DELTA}
        forceCenterKey={forceCenterKey}
      >
        <Pressable
          style={({ pressed }) => [
            styles.mapGpsButton,
            pressed && styles.mapGpsButtonPressed,
          ]}
          onPress={locatePickup}
          disabled={isLocating}
          android_ripple={{ color: colors.primaryFixed, borderless: true, radius: 22 }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Recentre on my location"
        >
          {isLocating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="crosshair" size={18} color={colors.primary} />
          )}
        </Pressable>

        <View style={styles.homeBrand} pointerEvents="none"><Text style={styles.homeBrandText}>PICKUP</Text><View style={styles.brandDot} /></View>


      </MapCanvas>

      {!isTripActive && (ride || pendingInput || bookingRecoveryError || recoveringBooking) && (
        <View style={[styles.activeTripOverlay, { top: topSafeOffset }]}>
          <Card variant="elevated" padding="md">
            <Pressable accessibilityRole="button" onPress={() => {
              if (ride || pendingInput) navigation?.navigate('ActiveTripStack', { screen: 'FindingDriverScreen' });
              else void recoverBooking?.();
            }}>
              <Text>{recoveringBooking ? 'Checking your previous booking...' : ride || pendingInput ? 'Resume your booking' : 'Retry booking recovery'}</Text>
              {bookingRecoveryError && <Text>{bookingRecoveryError}</Text>}
            </Pressable>
          </Card>
        </View>
      )}

      {/* Active Trip Overlay Pill — only shown when the engine reports a live
          trip for this customer. Never hardcoded mock data. */}
      {isTripActive && (
        <View style={[styles.activeTripOverlay, { top: topSafeOffset }]}>
          <Card
            variant="elevated"
            padding="sm"
            onPress={() => {
              if (onActiveTripPress) {
                onActiveTripPress();
              } else {
                navigation?.navigate('ActiveTripStack', {
                  screen: trip?.status === 'DRIVER_ASSIGNED' ? 'DriverAssignedExpandedScreen' : 'CustomerLiveTrackingScreen',
                });
              }
            }}
            style={styles.activeTripCard}
          >
            <View style={styles.tripContent}>
              <View style={styles.tripIcon}>
                <Image
                  source={getVehicleImage(assignedDriver?.vehicleType || (trip as any)?.vehicleType)}
                  style={styles.tripVehicleImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.tripInfo}>
                <View style={styles.tripStatusRow}>
                  <View style={styles.greenDot} />
                  <Text style={styles.tripStatusText}>
                    {trip?.status === 'DRIVER_ARRIVED'
                      ? 'DRIVER ARRIVED'
                      : trip?.status === 'PICKUP_VERIFIED'
                      ? 'PICKUP CONFIRMED'
                      : trip?.status === 'IN_TRANSIT'
                      ? 'ON THE WAY'
                      : trip?.status === 'DROP_PROGRESS'
                      ? 'DELIVERING'
                      : 'TRIP IN PROGRESS'}
                  </Text>
                </View>
                <Text style={styles.tripDriverText} numberOfLines={1}>
                  {assignedDriver?.name
                    ? `${assignedDriver.name} · Tap to open live tracking`
                    : 'Tap to open live tracking'}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.onSurfaceVariant} />
            </View>
          </Card>
        </View>
      )}

      {/* Draggable Bottom Sheet */}
      <View style={styles.homeSheet}>
        <View style={styles.sheetHandle} />
        <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
          {/* Booking Card */}
          <View style={styles.bookingCardWrapper}>
            <Card variant="filled" padding="md" style={styles.bookingCard}>
            <Text style={styles.bookingHeading}>Where are you sending?</Text>
            <View style={styles.bookingInputsContainer}>
              <View style={styles.inputRowContainer}>
                <View style={styles.dotLineWrapper}><View style={[styles.dot, styles.pickupDot]} /><View style={styles.homeConnector}>{[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={styles.connectorDash} />)}</View></View>
                <View style={styles.inputContentWrapper}>
                  <Text style={styles.inputLabel}>Pickup</Text>
                  <Text style={styles.inputValue} numberOfLines={1} accessibilityLabel={pickupAddress}>
                    {isLocating ? 'Finding your location...' : pickupSummary}
                  </Text>
                </View>
                <Pressable onPress={() => {
                  if (resumePreviousBooking()) return;
                  startNewBooking();
                  navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen', params: { mode: 'pickup' } });
                }} hitSlop={spacing.sm} accessibilityRole="button" accessibilityLabel="Change pickup location" style={styles.changeActionButton}>
                  <Text style={styles.changeAction}>Change</Text>
                </Pressable>
              </View>
              {locationError && <Pressable onPress={locatePickup} accessibilityRole="button"><Text style={styles.pickupError}>{locationError} Tap to retry.</Text></Pressable>}
              <Pressable style={styles.destinationInput} onPress={openDrop} accessibilityRole="button" accessibilityLabel="Enter drop location">
                <View style={styles.destinationIcon}><MaterialIcons name="place" size={spacing.lg} color={colors.onPrimary} /></View>
                <Text style={styles.destinationText}>Enter drop location</Text>
                <Feather name="chevron-right" size={spacing.xl} color={colors.primary} />
              </Pressable>
            </View>
            <Button label="Choose drop location" onPress={openDrop} variant="primary" size="md" fullWidth style={styles.bookingAction} />
            </Card>
          </View>

          {/* Recent Locations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{strings.home.recentLocations}</Text>
            {showRecentSkeleton ? (
              <Card variant="outlined" padding="none">
                <SkeletonListItem count={3} hasAvatar={true} hasSubtitle={true} />
              </Card>
            ) : recentLocations.length > 0 ? (
              <Card variant="outlined" padding="none">
                {recentLocations.slice(0, 5).map((loc, index) => (
                  <React.Fragment key={loc.id}>
                    {index > 0 && <Divider />}
                    <ListRow
                      title={/^\d+$/.test(loc.name.trim()) ? loc.address.split(',').slice(0, 2).join(',') : loc.name}
                      subtitle={loc.address}
                      leading={<Feather name="clock" size={spacing.lg} color={colors.onSurfaceVariant} />}
                      onPress={() => handleRecentLocationSelect(loc)}
                    />
                  </React.Fragment>
                ))}
              </Card>
            ) : (
              <Card variant="outlined" padding="lg" style={styles.emptyRecentCard}>
                <View style={styles.emptyRecentIconWrapper}>
                  <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                </View>
                <Text style={styles.emptyRecentTitle}>No recent searches yet.</Text>
                <Text style={styles.emptyRecentSubtitle}>
                  Your recently searched locations will appear here.
                </Text>
              </Card>
            )}
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActionsGrid}>
            <Card
              variant="outlined"
              padding="lg"
              onPress={() => (onTripHistory ? onTripHistory() : navigation?.navigate('TripHistoryScreen'))}
              style={styles.quickActionCard}
            >
              <View style={styles.iconBadgePrimary}>
                <Feather name="file-text" size={20} color={colors.primary} />
              </View>
              <View style={styles.actionTextWrapper}>
                <Text style={styles.actionTitle}>Trip History</Text>
                <Text style={styles.actionSubtitle}>View past deliveries</Text>
              </View>
            </Card>

            <Card
              variant="outlined"
              padding="lg"
              onPress={() =>
                onManageAddresses ? onManageAddresses() : navigation?.navigate('SavedAddressesScreen')
              }
              style={styles.quickActionCard}
            >
              <View style={styles.iconBadgeSecondary}>
                <Feather name="bookmark" size={20} color={colors.onSurfaceVariant} />
              </View>
              <View style={styles.actionTextWrapper}>
                <Text style={styles.actionTitle}>Manage Addresses</Text>
                <Text style={styles.actionSubtitle}>Saved locations</Text>
              </View>
            </Card>
          </View>
        </ScrollView>
      </View>


    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  homeSheet: { flex: 0.51, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, marginTop: -spacing.sm, overflow: 'hidden' },
  homeConnector: { position: 'absolute', top: spacing.xl, alignItems: 'center', gap: spacing.xs / 2 },
  connectorDash: { width: spacing.xs / 2, height: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.outlineVariant },
  bookingAction: { backgroundColor: colors.homeAction },
  recentIcon: { width: spacing.xxxl, height: spacing.xxxl, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  sheetHandle: { width: spacing.xxxl, height: spacing.xs, backgroundColor: colors.outlineVariant, borderRadius: borderRadius.full, alignSelf: 'center', marginTop: spacing.md },
  bookingCard: { padding: spacing.xl, borderRadius: borderRadius.xxl },
  bookingHeading: { ...typography.headlineMd, color: colors.primary, fontWeight: '700', marginBottom: spacing.md },
  homeBrand: { position: 'absolute', top: spacing.md, left: spacing.lg, flexDirection: 'row', alignItems: 'flex-start' },
  homeBrandText: { ...typography.headlineMd, fontWeight: '800', color: colors.primary },
  brandDot: { width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.statusGreen, marginLeft: spacing.xs },
  mapAddress: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.xxxl * 2 + spacing.md, backgroundColor: colors.surface, borderRadius: borderRadius.full, padding: spacing.sm, minHeight: spacing.rowHeightSm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, ...shadows.card },
  addressDot: { width: spacing.md, height: spacing.md, borderRadius: borderRadius.full, borderWidth: spacing.xs, borderColor: colors.statusGreen },
  mapAddressText: { ...typography.labelSm, color: colors.primary, flex: 1 },
  destinationInput: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: borderRadius.xl, padding: spacing.sm, minHeight: spacing.rowHeightStandard, marginTop: spacing.md },
  destinationIcon: { width: spacing.xxl + spacing.xs, height: spacing.xxl + spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  destinationText: { ...typography.bodyMd, color: colors.onSurfaceVariant, flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrapper: {
    zIndex: 10,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // Map Section (Absolute)
  mapBackground: {
    flex: 0.49,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapPin: {
    alignItems: 'center',
    marginTop: '30%',
  },
  mapPinLabel: {
    backgroundColor: '#03071D',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginBottom: 4,
  },
  mapPinText: {
    color: colors.white,
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
  },
  mapPinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: '#03071D',
    backgroundColor: colors.white,
  },
  // "Recenter on my location" — pinned at mid-right of the visible map.
  mapGpsButton: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.marginMobile,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  // Pressed state — darkened background + slight scale so the tap is
  // unambiguous. Applied via Pressable's `style` callback.
  mapGpsButtonPressed: {
    backgroundColor: colors.surfaceContainerHigh,
    transform: [{ scale: 0.92 }],
  },
  
  activeTripOverlay: {
    position: 'absolute',
    left: spacing.marginMobile,
    right: spacing.marginMobile,
    zIndex: 20,
  },
  activeTripCard: {
    borderRadius: borderRadius.lg,
  },
  tripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tripIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...shadows.elevated,
  },
  tripVehicleImage: {
    width: 38,
    height: 38,
  },
  tripInfo: {
    flex: 1,
  },
  tripStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusGreen,
  },
  tripStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  tripDriverText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontWeight: '500',
  },

  // Sheet Content
  sheetScrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl * 2, // extra padding for scrolling
  },
  bookingCardWrapper: {
    paddingHorizontal: spacing.marginMobile,
    marginBottom: spacing.xl,
  },
  bookingInputsContainer: {
    marginBottom: spacing.lg,
  },
  inputRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dotLineWrapper: {
    width: 24,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  pickupDot: {
    backgroundColor: colors.homePickup,
  },
  dropPinIcon: {
    fontSize: 14,
    marginTop: 2,
  },
  connectingLine: {
    width: 1,
    flex: 1,
    backgroundColor: colors.outlineVariant,
    marginTop: 4,
    marginBottom: -16,
  },
  connectingLineShort: {
    marginBottom: -8,
  },
  inputContentWrapper: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
  },
  inputFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sm,
  },
  inputValue: {
    // Fill available width so long pickup addresses truncate with an ellipsis
    // instead of pushing the Change action off the right edge of the card.
    minWidth: 0,
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  placeholderValue: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
  },
  driverCountPill: {
    position: 'absolute',
    left: spacing.marginMobile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    ...shadows.elevated,
  },

  driverCountText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  pickupError: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  // Wraps the Change label with visible padding so the tap target is a full
  // 44 pt touch region, not just the text glyphs.
  changeActionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLow,
    flexShrink: 0,
  },
  changeAction: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  arrowCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 32,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  addDropText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
  },

  // Sections
  section: {
    paddingHorizontal: spacing.marginMobile,
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadingRecentCard: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecentCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyRecentIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyRecentTitle: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyRecentSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textAlign: 'center',
  },

  quickActionsGrid: {
    flexDirection: 'row',
    paddingHorizontal: spacing.marginMobile,
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  actionTextWrapper: {
    marginTop: spacing.md,
    gap: 2,
  },
  actionTitle: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  quickActionCard: {
    flex: 1,
  },
  iconBadgePrimary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgeSecondary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Bottom Tabs
  bottomTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
    zIndex: 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tabIconWrapper: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 4,
    borderRadius: 16,
  },
  tabActiveWrapper: {
    backgroundColor: colors.primaryFixed,
  },
  tabLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  tabLabelActive: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default HomeScreen;
