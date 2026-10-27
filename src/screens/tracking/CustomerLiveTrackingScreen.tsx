import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ImageBackground,
  Image,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useRideOtps } from '../../hooks/useRideOtps';
import { getActiveTripForCustomer, getDriver, getRide } from '../../api/engine';
import type { GeoPoint } from '../../api/types';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoute } from '../../hooks/useRoute';
import { getVehicleImage } from '../../utils/vehicleAssets';

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
  const {
    trip,
    setTrip,
    assignedDriver,
    setAssignedDriver,
    ride,
    setRide,
    customerId,
    draft,
  } = useBooking();

  // If customer came directly to live tracking and trip is not yet in context, restore from engine
  useEffect(() => {
    if (!trip && customerId) {
      let active = true;
      getActiveTripForCustomer(customerId)
        .then((found) => {
          if (active && found) {
            setTrip(found);
            if (found.rideId) {
              getRide(found.rideId).then((r) => { if (active && r) setRide(r); }).catch(() => {});
            }
            if (found.driverId) {
              getDriver(found.driverId).then((d) => { if (active && d) setAssignedDriver(d); }).catch(() => {});
            }
          }
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
  }, [trip, customerId, setTrip, setRide, setAssignedDriver]);

  // If the user killed the app and restarted, `ride` might be undefined, but `trip` exists.
  // Restore `ride` so we have its id for the gated OTP endpoint (the trip never carries OTPs).
  useEffect(() => {
    if (trip?.rideId && !ride) {
      let active = true;
      getRide(trip.rideId)
        .then((fetchedRide) => {
          if (active) setRide(fetchedRide);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
  }, [trip?.rideId, ride, setRide]);

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

  // Handover OTPs come from the gated endpoint: the server releases the pickup OTP once the
  // pickup handover is allowed, and each drop's OTP once that drop's payment is confirmed.
  const rideId = ride?.id ?? current?.rideId;
  const { otps } = useRideOtps(rideId, {
    enabled: status !== undefined && status !== 'COMPLETED' && status !== 'CANCELLED',
  });

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
        if (!cancelled && driver) {
          setDriverPoint({ latitude: driver.latitude, longitude: driver.longitude });
          setAssignedDriver(driver);
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
  }, [driverId, setAssignedDriver]);

  const markers = useMemo<readonly MapMarker[]>(() => {
    const built: MapMarker[] = [];
    if (current?.pickup) {
      built.push({ id: 'pickup', kind: 'pickup', coordinate: current.pickup, title: 'Pickup' });
    }
    if (current?.stops && current.stops.length > 0) {
      current.stops.forEach((stop, index) => {
        if (stop.status !== 'DELIVERED') {
          built.push({ id: `drop-${index}`, kind: 'drop', coordinate: stop.location, title: `Drop ${index + 1}` });
        }
      });
    } else if (current?.drop) {
      built.push({ id: 'drop', kind: 'drop', coordinate: current.drop, title: 'Drop' });
    }
    if (driverPoint) {
      built.push({
        id: 'driver',
        kind: 'driver',
        coordinate: driverPoint,
        title: assignedDriver?.name ?? 'Driver',
        vehicleType:
          assignedDriver?.vehicleType ||
          (current as any)?.vehicleType ||
          ride?.vehicleType ||
          draft?.vehicleType,
        bearing: assignedDriver?.bearingDegrees,
      });
    }
    return built;
  }, [current?.pickup, current?.drop, current?.stops, driverPoint, assignedDriver]);

  // Route always starts from the driver so the polyline shrinks as they close
  // the distance. Destination flips from pickup to drop once the trip is under
  // way. `useRoute` rounds coordinates to ~11 m before refetching, so a moving
  // driver doesn't blow through the Directions quota.
  const preTransit =
    status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED' || status === 'PICKUP_VERIFIED';
  const routeDestination = (preTransit ? current?.pickup : current?.drop) ?? undefined;
  const roadRoute = useRoute(driverPoint ?? current?.pickup, routeDestination);

  // The pickup OTP and the current drop's OTP, only when the server has released them.
  const pickupOtp = otps?.pickup.otp ?? null;
  const pickupPaymentRequired = otps?.pickup.withheld === 'PAYMENT_REQUIRED';
  const currentStopSequence = current?.currentStop?.sequence;
  const currentDropOtp =
    currentStopSequence != null
      ? (otps?.stops.find((s) => s.sequence === currentStopSequence)?.otp ?? null)
      : null;

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

  let currentDropAddress = current?.drop?.address ?? '—';
  if (current?.stops && current.stops.length > 0) {
    const activeDrop =
      current.stops.find((s) => ['PENDING', 'IN_TRANSIT', 'ARRIVED'].includes(s.status)) ||
      current.stops[current.stops.length - 1];
    currentDropAddress = activeDrop?.location?.address ?? currentDropAddress;
  }

  const tripSubtitle = preTransit
    ? `Pickup: ${current?.pickup?.address ?? draft?.pickup?.address ?? '—'}`
    : `Drop: ${currentDropAddress}`;

  const pickupAddress = current?.pickup?.address ?? draft?.pickup?.address ?? '—';
  const dropAddress = currentDropAddress ?? draft?.drops?.[0]?.address ?? '—';
  const fareDisplay =
    current?.fare != null
      ? `₹${current.fare}`
      : current?.payablePaise != null
      ? `₹${(current.payablePaise / 100).toFixed(0)}`
      : draft?.quote?.payablePaise != null
      ? `₹${(draft.quote.payablePaise / 100).toFixed(0)}`
      : undefined;
  const paymentMethodDisplay =
    (current?.paymentMethod ?? ride?.paymentMethod ?? draft?.paymentMethod) === 'PAY_AT_PICKUP'
      ? 'Pay at Pickup'
      : 'Pay at Delivery';
  const vehicleDisplay =
    (current as any)?.vehicleType ?? assignedDriver?.vehicleType ?? draft?.vehicleType;
  const distanceDisplay =
    typeof current?.totalDistanceKm === 'number'
      ? `${current.totalDistanceKm.toFixed(1)} km`
      : undefined;

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else if (navigation?.canGoBack()) {
      navigation.goBack();
    } else {
      navigation?.navigate('MainTabs', { screen: 'HomeScreen' });
    }
  }, [onBack, navigation]);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const toggleCollapsed = useCallback(() => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    Animated.spring(slideAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();
  }, [isCollapsed, slideAnim]);

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
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.iconButton}
              onPress={handleBack}
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
            {/* Top Interactive Drag / Slide-down Handle */}
            <Pressable
              style={styles.dragHandleBar}
              onPress={toggleCollapsed}
              accessibilityRole="button"
              accessibilityLabel={isCollapsed ? 'Expand details' : 'Slide down to view map'}
            >
              <View style={styles.dragHandlePill} />
              <View style={styles.dragHandleRow}>
                <Text style={styles.dragHandleHint}>
                  {isCollapsed ? 'Tap to view details' : 'Swipe / tap to view map'}
                </Text>
                <Feather
                  name={isCollapsed ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={colors.onSurfaceVariant}
                />
              </View>
            </Pressable>

            {/* Minimized Pill View when Collapsed */}
            {isCollapsed ? (
              <Pressable style={styles.minimizedRow} onPress={toggleCollapsed} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={styles.minimizedTitle} numberOfLines={1}>
                    {tripHeadline}
                  </Text>
                  {Boolean(tripSubtitle) && (
                    <Text style={styles.minimizedSubtitle} numberOfLines={1}>
                      {tripSubtitle}
                    </Text>
                  )}
                </View>
                {Boolean(pickupOtp) && (status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED') && (
                  <View style={styles.minimizedOtpBadge}>
                    <Text style={styles.minimizedOtpLabel}>OTP</Text>
                    <Text style={styles.minimizedOtpValue}>{pickupOtp}</Text>
                  </View>
                )}
                {Boolean(currentDropOtp) && (status === 'IN_TRANSIT' || status === 'DROP_PROGRESS') && (
                  <View style={styles.minimizedOtpBadge}>
                    <Text style={styles.minimizedOtpLabel}>OTP</Text>
                    <Text style={styles.minimizedOtpValue}>{currentDropOtp}</Text>
                  </View>
                )}
              </Pressable>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.cardScrollContent}
              >
                <View style={styles.tripStatusHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tripStatusTitle}>{tripHeadline}</Text>
                    {Boolean(tripSubtitle) && (
                      <Text style={styles.tripStatusSubtitle} numberOfLines={1}>
                        {tripSubtitle}
                      </Text>
                    )}
                  </View>
                  {typeof assignedDriver?.distanceKm === 'number' && (
                    <View style={styles.onTimeBadge}>
                      <Feather name="navigation" size={12} color={colors.onSecondaryContainer} />
                      <Text style={styles.onTimeText}>
                        {assignedDriver.distanceKm.toFixed(1)} km
                      </Text>
                    </View>
                  )}
                </View>

                {/* Coarse progress bar driven off the trip status. */}
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBarFill, { width: progressPercent }]} />
                </View>

                {/* PICKUP OTP — released by the server once the pickup handover is allowed. */}
                {(status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED') &&
                  (pickupOtp ? (
                    <View style={styles.premiumOtpCard}>
                      <View style={styles.otpHeaderRow}>
                        <View style={styles.otpShieldBadge}>
                          <Feather name="shield" size={16} color={colors.primary} />
                        </View>
                        <View style={styles.otpHeaderTexts}>
                          <Text style={styles.otpCardTitle}>PICKUP VERIFICATION OTP</Text>
                          <Text style={styles.otpCardSub}>Share with driver to start ride</Text>
                        </View>
                      </View>
                      <View style={styles.otpDigitsContainer}>
                        {pickupOtp.split('').map((digit, idx) => (
                          <View key={idx} style={styles.otpDigitBox}>
                            <Text style={styles.otpDigitText}>{digit}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : pickupPaymentRequired ? (
                    <View style={styles.premiumPaymentCard}>
                      <Feather name="alert-circle" size={18} color="#D97706" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.paymentCardTitle}>PAYMENT REQUIRED</Text>
                        <Text style={styles.paymentCardSub}>Pay the driver at pickup to start the trip.</Text>
                      </View>
                    </View>
                  ) : null)}

                {/* DELIVERY OTP — released once this drop's payment is confirmed (pay at delivery). */}
                {(status === 'IN_TRANSIT' || status === 'DROP_PROGRESS') &&
                  current?.currentStop &&
                  !current.currentStop.otpVerified &&
                  currentDropOtp && (
                    <View style={styles.premiumOtpCard}>
                      <View style={styles.otpHeaderRow}>
                        <View style={styles.otpShieldBadge}>
                          <Feather name="shield" size={16} color={colors.statusGreen} />
                        </View>
                        <View style={styles.otpHeaderTexts}>
                          <Text style={styles.otpCardTitle}>DELIVERY OTP</Text>
                          <Text style={styles.otpCardSub}>Share at drop location to confirm receipt</Text>
                        </View>
                      </View>
                      <View style={styles.otpDigitsContainer}>
                        {currentDropOtp.split('').map((digit, idx) => (
                          <View key={idx} style={styles.otpDigitBox}>
                            <Text style={styles.otpDigitText}>{digit}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                {/* Route Summary (Pickup & Drop Locations) */}
                <View style={styles.routeContainer}>
                  <View style={styles.routeRow}>
                    <View style={styles.routeDotCol}>
                      <View style={[styles.routeDot, styles.pickupDot]} />
                      <View style={styles.routeLine} />
                    </View>
                    <View style={styles.routeTextCol}>
                      <Text style={styles.routeLabel}>PICKUP LOCATION</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {pickupAddress}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.routeRow}>
                    <View style={styles.routeDotCol}>
                      <View style={[styles.routeDot, styles.dropDot]} />
                    </View>
                    <View style={styles.routeTextCol}>
                      <Text style={styles.routeLabel}>
                        {current?.stops && current.stops.length > 1
                          ? `DROP LOCATION (${current.stops.length} STOPS)`
                          : 'DROP LOCATION'}
                      </Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>
                        {dropAddress}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Trip Meta Badges (Fare, Payment, Vehicle, Distance) */}
                <View style={styles.tripMetaRow}>
                  {Boolean(fareDisplay) && (
                    <View style={styles.tripMetaBadge}>
                      <Feather name="credit-card" size={12} color={colors.primary} />
                      <Text style={styles.tripMetaBadgeText}>{fareDisplay}</Text>
                    </View>
                  )}
                  <View style={styles.tripMetaBadge}>
                    <Feather name="check-circle" size={12} color={colors.statusGreen} />
                    <Text style={styles.tripMetaBadgeText}>{paymentMethodDisplay}</Text>
                  </View>
                  {Boolean(vehicleDisplay) && (
                    <View style={styles.tripMetaBadge}>
                      <Image
                        source={getVehicleImage(vehicleDisplay)}
                        style={styles.metaVehicleImage}
                        resizeMode="contain"
                      />
                      <Text style={styles.tripMetaBadgeText}>{vehicleDisplay}</Text>
                    </View>
                  )}
                  {Boolean(distanceDisplay) && (
                    <View style={styles.tripMetaBadge}>
                      <Feather name="map-pin" size={12} color={colors.onSurfaceVariant} />
                      <Text style={styles.tripMetaBadgeText}>{distanceDisplay}</Text>
                    </View>
                  )}
                </View>

                {/* Driver Details Container */}
                <View style={styles.driverDetailsContainer}>
                  <View style={styles.driverDetailsHeader}>
                    <View style={styles.driverInfoLeft}>
                      <View style={styles.driverAvatarContainer}>
                        <Image
                          source={getVehicleImage(assignedDriver?.vehicleType)}
                          style={styles.driver3dAvatarImage}
                          resizeMode="contain"
                        />
                      </View>
                      <View>
                        <Text style={styles.driverName}>
                          {assignedDriver?.name ?? 'Your driver'}
                        </Text>
                        {assignedDriver?.vehicleType && (
                          <View style={styles.driverSubInfo}>
                            <Image
                              source={getVehicleImage(assignedDriver.vehicleType)}
                              style={styles.driverSubVehicleImage}
                              resizeMode="contain"
                            />
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

                  {/* Actions */}
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
              </ScrollView>
            )}
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
    maxHeight: '68%',
  },
  safeArea: {
    width: '100%',
  },
  tripStatusCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...shadows.card,
  },
  cardScrollContent: {
    paddingBottom: spacing.xs,
  },
  routeContainer: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  routeDotCol: {
    alignItems: 'center',
    width: 14,
    paddingTop: 3,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickupDot: {
    backgroundColor: colors.statusGreen,
  },
  dropDot: {
    backgroundColor: colors.error,
  },
  routeLine: {
    width: 1.5,
    height: 18,
    backgroundColor: colors.outlineVariant,
    marginVertical: 2,
  },
  routeTextCol: {
    flex: 1,
  },
  routeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  routeAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontWeight: '500',
    marginTop: 1,
  },
  tripMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  tripMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  tripMetaBadgeText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
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
  dragHandleBar: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  dragHandlePill: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    marginBottom: 4,
  },
  dragHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dragHandleHint: {
    fontSize: 10,
    color: colors.onSurfaceVariant,
    fontWeight: '500',
  },
  minimizedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  minimizedTitle: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  minimizedSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  minimizedOtpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  minimizedOtpLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  minimizedOtpValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E3A8A',
    letterSpacing: 2,
  },
  premiumOtpCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    ...shadows.sm,
  },
  otpHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  otpShieldBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpHeaderTexts: {
    flex: 1,
  },
  otpCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.8,
  },
  otpCardSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  otpDigitsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  otpDigitBox: {
    width: 54,
    height: 54,
    borderRadius: borderRadius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    ...shadows.sm,
  },
  otpDigitText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: typography.dataMono.fontFamily,
  },
  premiumPaymentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  paymentCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  paymentCardSub: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryContainer,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  otpLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  otpValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.onPrimaryContainer,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: 4,
  },
  otpHint: {
    flex: 1,
    marginLeft: spacing.md,
    textAlign: 'right',
    fontSize: typography.labelSm.fontSize,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelSm.fontFamily,
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
  metaVehicleImage: {
    width: 18,
    height: 18,
    marginRight: 2,
  },
  driverSubVehicleImage: {
    width: 14,
    height: 14,
    marginRight: 2,
  },
  driverAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  driver3dAvatarImage: {
    width: 38,
    height: 38,
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
