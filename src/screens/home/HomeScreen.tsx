import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockRecentLocations } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import { getCurrentPlace, LocationPermissionDeniedError } from '../../api/geocoding';
import { getActiveTripForCustomer } from '../../api/engine';
import { toApiError } from '../../api/http';
import { useNearbyDrivers } from '../../hooks/useNearbyDrivers';
import MapCanvas, { NEIGHBORHOOD_DELTA, type MapMarker } from '../../components/map/MapCanvas';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Button from '../../components/atoms/Button';
import Divider from '../../components/atoms/Divider';
import DraggableBottomSheet from '../../components/organisms/DraggableBottomSheet';
import { Feather } from '@expo/vector-icons';
import { setLoggedIn } from '../../state/session';

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
  const { draft, setPickup, customerId, trip, setTrip } = useBooking();
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string>();

  // Reaching Home means the user finished login/onboarding — persist the
  // session so the app reopens on Home until they explicitly log out.
  useEffect(() => {
    void setLoggedIn();
  }, []);

  /** Resolves the device position into the pickup point. */
  const locatePickup = useCallback(async () => {
    setIsLocating(true);
    setLocationError(undefined);
    try {
      setPickup(await getCurrentPlace());
    } catch (caught) {
      setLocationError(
        caught instanceof LocationPermissionDeniedError
          ? 'Location permission is off.'
          : toApiError(caught).userMessage
      );
    } finally {
      setIsLocating(false);
    }
  }, [setPickup]);

  // Resolve pickup once on first mount, unless one is already set.
  useEffect(() => {
    if (!draft.pickup) void locatePickup();
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
  useFocusEffect(
    useCallback(() => {
      refreshNearby();
    }, [refreshNearby])
  );

  const mapMarkers = useMemo<readonly MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    if (draft.pickup) {
      markers.push({
        id: 'pickup',
        kind: 'pickup',
        coordinate: draft.pickup,
        title: 'Pickup',
        description: draft.pickup.address,
      });
    }
    nearbyDrivers.forEach((driver) => {
      markers.push({
        id: `driver-${driver.id}`,
        kind: 'nearby',
        coordinate: { latitude: driver.latitude, longitude: driver.longitude },
        title: driver.name,
        description: `${driver.vehicleType} · ${driver.distanceKm.toFixed(1)} km away`,
      });
    });
    return markers;
  }, [draft.pickup, nearbyDrivers]);

  // Restore an in-flight trip so closing the app doesn't lose it.
  useEffect(() => {
    if (!customerId || trip) return;
    let active = true;
    getActiveTripForCustomer(customerId)
      .then((found) => {
        if (active && found) setTrip(found);
      })
      .catch(() => {
        // Offline or backend down: Home still works.
      });
    return () => {
      active = false;
    };
  }, [customerId, trip, setTrip]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header (Fixed on top) */}
      <View style={styles.headerWrapper}>
        <TopAppBar
          title="Pick Up"
          leadingIcon={
            <View style={styles.avatar}>
              <Feather name="user" size={16} color={colors.primary} />
            </View>
          }
          trailingIcon={<Feather name="bell" size={22} color={colors.primary} />}
          onLeadingPress={() => navigation?.navigate('ProfileScreen')}
          onTrailingPress={() => navigation?.navigate('NotificationCenterScreen')}
        />
      </View>

      {/* Live map with nearby drivers behind the sheet.
          The camera stays anchored on the customer's pickup at a stable
          neighbourhood zoom, just like Ola or Rapido. Drivers appear and
          disappear as they come online, but the map does NOT refit — a
          moving frame every time a driver joins or leaves would feel
          jumpy in production. Users can pan freely to see drivers farther
          out. */}
      <MapCanvas
        style={styles.mapBackground}
        center={draft.pickup}
        markers={mapMarkers}
        showsUserLocation
        zoomDelta={NEIGHBORHOOD_DELTA}
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
        <Pressable
          style={styles.driverCountPill}
          onPress={refreshNearby}
          accessibilityRole="button"
          accessibilityLabel="Refresh nearby drivers"
        >
          <Feather
            name={nearbyError ? 'alert-circle' : 'truck'}
            size={12}
            color={
              nearbyError
                ? colors.error
                : nearbyDrivers.length
                ? colors.primary
                : colors.onSurfaceVariant
            }
          />
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
      </MapCanvas>

      {/* Active Trip Overlay Pill — only shown when the engine reports a live
          trip for this customer. Never hardcoded mock data. */}
      {trip && trip.status !== 'DELIVERED' && trip.status !== 'COMPLETED' && trip.status !== 'CANCELLED' && (
        <View style={styles.activeTripOverlay}>
          <Card
            variant="elevated"
            padding="sm"
            onPress={() =>
              onActiveTripPress ? onActiveTripPress() : navigation?.navigate('CustomerLiveTrackingScreen')
            }
            style={styles.activeTripCard}
          >
            <View style={styles.tripContent}>
              <View style={styles.tripIcon}>
                <Feather name="truck" size={18} color={colors.primary} />
              </View>
              <View style={styles.tripInfo}>
                <View style={styles.tripStatusRow}>
                  <View style={styles.greenDot} />
                  <Text style={styles.tripStatusText}>TRIP IN PROGRESS</Text>
                </View>
                <Text style={styles.tripDriverText} numberOfLines={1}>
                  Tap to open live tracking
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
                        onPress={() => navigation?.navigate('SelectLocationScreen')}
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
                  <Pressable style={styles.dotLineWrapper} onPress={() => navigation?.navigate('AddressSearchScreen')}>
                    <Text style={styles.dropPinIcon}>📍</Text>
                    <View style={[styles.connectingLine, styles.connectingLineShort]} />
                  </Pressable>
                  <Pressable style={styles.inputContentWrapper} onPress={() => navigation?.navigate('AddressSearchScreen')}>
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
                  onPress={() => navigation?.navigate('AddressSearchScreen')}
                >
                  <Feather name="plus" size={16} color={colors.onSurfaceVariant} />
                  <Text style={styles.addDropText}>Add another drop</Text>
                </Pressable>
              </View>

              <Button
                label={strings.home.startBooking}
                onPress={() => navigation?.navigate('AddressSearchScreen')}
                variant="primary"
                size="lg"
                fullWidth
              />
            </Card>
          </View>

          {/* Recent Locations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{strings.home.recentLocations}</Text>
            <Card variant="outlined" padding="none">
              {mockRecentLocations.map((loc, index) => (
                <React.Fragment key={loc.id}>
                  {index > 0 && <Divider />}
                  <ListRow
                    title={loc.name}
                    subtitle={loc.address}
                    leading={<Feather name="clock" size={18} color={colors.onSurfaceVariant} />}
                    onPress={() => {
                      onRecentLocationPress?.(loc.address);
                      navigation?.navigate('AddressSearchScreen');
                    }}
                  />
                </React.Fragment>
              ))}
            </Card>
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

      {/* Bottom Tabs Component */}
      <View style={styles.bottomTabBar}>
        {/* Already on Home — no self-navigation */}
        <Pressable style={styles.tabItem} accessibilityState={{ selected: true }}>
          <View style={[styles.tabIconWrapper, styles.tabActiveWrapper]}>
            <Feather name="home" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.tabLabel, styles.tabLabelActive]}>Home</Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => navigation?.navigate('TripHistoryScreen')}>
          <View style={styles.tabIconWrapper}>
            <Feather name="navigation" size={20} color={colors.onSurfaceVariant} />
          </View>
          <Text style={styles.tabLabel}>Trips</Text>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => navigation?.navigate('ProfileScreen')}>
          <View style={styles.tabIconWrapper}>
            <Feather name="user" size={20} color={colors.onSurfaceVariant} />
          </View>
          <Text style={styles.tabLabel}>Account</Text>
        </Pressable>
      </View>
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
    top: 60, // below header
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
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    zIndex: 10,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
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
    top: spacing.md,
    left: spacing.marginMobile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.card,
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
