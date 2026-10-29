import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import { getCurrentPlace, reverseGeocode, type ResolvedPlace } from '../../api/geocoding';
import type { GeoPoint } from '../../api/types';
import { getActiveTripForCustomer, getDriver, getRide } from '../../api/engine';
import { toApiError } from '../../api/http';
import { useNearbyDrivers } from '../../hooks/useNearbyDrivers';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useRecentLocations, saveRecentLocation, type RecentLocation } from '../../state/recentLocations';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { DEFAULT_DELTA } from '../../components/map/MapCanvas.types';
import { getVehicleImage } from '../../utils/vehicleAssets';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Button from '../../components/atoms/Button';
import Divider from '../../components/atoms/Divider';
import DraggableBottomSheet from '../../components/organisms/DraggableBottomSheet';
import Feather from 'react-native-vector-icons/Feather';
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
    setRide,
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

  // Available drivers around the pickup point, refreshed on an interval.
  // 8 km radius keeps the map focused on drivers the customer can realistically
  // use — wider ranges just pull the camera out and clutter the view. `refresh`
  // fires an immediate fetch whenever Home regains focus so a driver that just
  // came back online is picked up without waiting for the interval.
  const {
    drivers: nearbyDrivers,
    error: nearbyError,
    isLoading: nearbyLoading,
    refresh: refreshNearby,
  } = useNearbyDrivers(draft.pickup, { radiusKm: 8 });
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

  // Restore or refresh active trip and driver info from engine
  const refreshActiveTrip = useCallback(async () => {
    if (!customerId) return;
    try {
      const found = await getActiveTripForCustomer(customerId);
      if (found) {
        setTrip(found);
        if (found.driverId) {
          const d = await getDriver(found.driverId).catch(() => null);
          if (d) setAssignedDriver(d);
        }
        if (found.rideId) {
          const r = await getRide(found.rideId).catch(() => null);
          if (r) setRide(r);
        }
      } else if (trip && isTripActive) {
        // Server reports no active trip anymore
        setTrip(undefined);
      }
    } catch {
      // Offline or backend down: Home still works.
    }
  }, [customerId, trip, isTripActive, setTrip, setAssignedDriver, setRide]);

  useEffect(() => {
    void refreshActiveTrip();
  }, [refreshActiveTrip]);

  useFocusEffect(
    useCallback(() => {
      refreshNearby();
      refreshRecent();
      void refreshActiveTrip();
      if (!draft.pickup) {
        void centerOnUser();
      }
    }, [refreshNearby, refreshRecent, refreshActiveTrip, draft.pickup, centerOnUser])
  );

  const handleRecentLocationSelect = useCallback(
    (loc: RecentLocation) => {
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
    [startNewBooking, setPendingDrop, customerId, onRecentLocationPress, navigation]
  );

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
        description: draft.pickup.address || 'Pickup location',
      });
    }
    if (Array.isArray(nearbyDrivers)) {
      nearbyDrivers.forEach((driver, idx) => {
        if (
          !driver ||
          typeof driver.latitude !== 'number' ||
          typeof driver.longitude !== 'number' ||
          !Number.isFinite(driver.latitude) ||
          !Number.isFinite(driver.longitude)
        ) {
          return;
        }
        const distNum =
          typeof driver.distanceKm === 'number'
            ? driver.distanceKm
            : Number(driver.distanceKm);
        const distStr =
          Number.isFinite(distNum) && distNum >= 0
            ? `${distNum.toFixed(1)} km away`
            : '';
        const vehicle = driver.vehicleType || 'Vehicle';
        const description = distStr ? `${vehicle} · ${distStr}` : vehicle;
        markers.push({
          id: `driver-${driver.id || idx}`,
          kind: 'nearby',
          coordinate: { latitude: driver.latitude, longitude: driver.longitude },
          title: driver.name || 'Driver',
          description,
          vehicleType: driver.vehicleType,
          bearing: driver.bearingDegrees,
        });
      });
    }

    if (
      isTripActive &&
      assignedDriver &&
      typeof assignedDriver.latitude === 'number' &&
      typeof assignedDriver.longitude === 'number' &&
      Number.isFinite(assignedDriver.latitude) &&
      Number.isFinite(assignedDriver.longitude)
    ) {
      markers.push({
        id: `assigned-driver-${assignedDriver.id}`,
        kind: 'driver',
        coordinate: { latitude: assignedDriver.latitude, longitude: assignedDriver.longitude },
        title: assignedDriver.name || 'Your Driver',
        vehicleType:
          assignedDriver.vehicleType ||
          (trip as any)?.vehicleType ||
          draft.vehicleType,
        bearing: assignedDriver.bearingDegrees,
      });
    }
    return markers;
  }, [draft.pickup, nearbyDrivers, isTripActive, assignedDriver]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Live map with nearby drivers behind the sheet. */}
      <MapCanvas
          style={styles.mapBackground}
          center={draft.pickup || deviceLocation}
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

        {/* Driver availability readout, so an empty map is explained.
            Tappable to force an immediate refresh — useful when a driver has
            just come online and the customer doesn't want to wait for the
            8 s poll. Also surfaces any polling error so a broken API call
            doesn't look identical to "no drivers online". */}
        {!isTripActive && (
          <Pressable
            style={[styles.driverCountPill, { top: topSafeOffset }]}
            onPress={refreshNearby}
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby drivers"
          >
            {nearbyError ? (
              <Feather name="alert-circle" size={12} color={colors.error} />
            ) : (
              <Image
                source={getVehicleImage(nearbyDrivers[0]?.vehicleType)}
                style={{ width: 16, height: 16, resizeMode: 'contain' }}
              />
            )}
            <Text
              style={[styles.driverCountText, nearbyError && { color: colors.error }]}
              numberOfLines={1}
            >
              {nearbyError
                ? 'Cannot reach server · tap to retry'
                : nearbyLoading && !nearbyDrivers.length
                ? 'Looking for drivers…'
                : nearbyDrivers.length
                ? `${nearbyDrivers.length} driver${nearbyDrivers.length === 1 ? '' : 's'} nearby`
                : 'No drivers nearby · tap to refresh'}
            </Text>
          </Pressable>
        )}
      </MapCanvas>

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
                  screen: 'CustomerLiveTrackingScreen',
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
      <DraggableBottomSheet>
        <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
          {/* Booking Card */}
          <View style={styles.bookingCardWrapper}>
            <Card variant="filled" padding="md">
              <View style={styles.bookingInputsContainer}>
                {/* Pickup */}
                <View style={styles.inputRowContainer}>
                  <View style={styles.dotLineWrapper}>
                    <View style={[styles.dot, styles.pickupDot]} />
                    <View style={styles.connectingLine} />
                  </View>
                  <View style={styles.inputContentWrapper}>
                    <Text style={styles.inputLabel}>Pickup</Text>
                    <View style={styles.inputFieldRow}>
                      {/* `flex: 1` on the address so it truncates instead of
                          shoving the Change action off the right edge. */}
                      <Text style={styles.inputValue} numberOfLines={1}>
                        {isLocating
                          ? 'Finding your location…'
                          : draft.pickup?.address ?? 'Set pickup location'}
                      </Text>
                      <Pressable
                        onPress={() => {
                          startNewBooking();
                          navigation?.navigate('BookingStack', {
                            screen: 'AddressSearchScreen',
                            params: { mode: 'pickup' },
                          });
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        style={styles.changeActionButton}
                      >
                        <Text style={styles.changeAction}>Change</Text>
                      </Pressable>
                    </View>
                    {locationError && (
                      <Pressable onPress={locatePickup} accessibilityRole="button">
                        <Text style={styles.pickupError}>{locationError} Tap to retry.</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                <Divider />

                <View style={styles.inputRowContainer}>
                  <Pressable style={styles.dotLineWrapper} onPress={() => {
                    startNewBooking();
                    navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen' });
                  }}>
                    <Text style={styles.dropPinIcon}>📍</Text>
                    <View style={[styles.connectingLine, styles.connectingLineShort]} />
                  </Pressable>
                  <Pressable style={styles.inputContentWrapper} onPress={() => {
                    startNewBooking();
                    navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen' });
                  }}>
                    <View style={styles.inputFieldRow}>
                      <Text style={styles.placeholderValue}>Enter drop location</Text>
                      <View style={styles.arrowCircle}>
                        <Feather name="arrow-right" size={12} color={colors.onSurfaceVariant} />
                      </View>
                    </View>
                  </Pressable>
                </View>
                
                {/* Add another drop */}
                <Pressable
                  style={styles.addDropRow}
                  onPress={() => {
                    startNewBooking();
                    navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen' });
                  }}
                >
                  <Feather name="plus" size={16} color={colors.onSurfaceVariant} />
                  <Text style={styles.addDropText}>Add another drop</Text>
                </Pressable>
              </View>

              <Button
                label={strings.home.startBooking}
                onPress={() => {
                  startNewBooking();
                  navigation?.navigate('BookingStack', { screen: 'AddressSearchScreen' });
                }}
                variant="primary"
                size="lg"
                fullWidth
              />
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
                      title={loc.name}
                      subtitle={loc.address}
                      leading={<Feather name="clock" size={18} color={colors.onSurfaceVariant} />}
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
      </DraggableBottomSheet>


    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F3F4F1',
    zIndex: 0,
    top: 0, // full screen map
    bottom: 80, // above tabs
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
    top: '50%',
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
    marginBottom: spacing.xxl,
  },
  bookingInputsContainer: {
    marginBottom: spacing.xl,
  },
  inputRowContainer: {
    flexDirection: 'row',
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
    backgroundColor: colors.primary,
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
    flex: 1,
    minWidth: 0,
    fontSize: typography.bodyLg.fontSize,
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
    backgroundColor: colors.surfaceContainerHigh,
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

