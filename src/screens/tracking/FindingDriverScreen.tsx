import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Pressable,
  Easing,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { mockVehicleTypes } from '../../data/mockData';
import Feather from 'react-native-vector-icons/Feather';
import MapCanvas, { NEIGHBORHOOD_DELTA } from '../../components/map/MapCanvas';
import { useBooking, toGeoPoint } from '../../state/BookingContext';
import { findDriverAndCreateRide, NoDriversAvailableError } from '../../api/matching';
import { cancelRide, cancelTrip, getRideTrip } from '../../api/engine';
import { toApiError } from '../../api/http';
import { useActiveBookingCancellation } from '../../hooks/useActiveBookingCancellation';

import type { GeoPoint, Ride, Trip } from '../../api/types';
import { MIN_DRIVER_SEARCH_DURATION_MS } from '../../config/constants';
import { useI18n } from '../../i18n';

export interface FindingDriverScreenProps {
  readonly onCancel?: () => void;
  readonly onBack?: () => void;
}

const FindingDriverScreen: React.FC<FindingDriverScreenProps & { navigation?: any }> = ({
  onCancel,
  onBack,
  navigation,
}) => {
  const { t } = useI18n();
  const [pulseAnim] = useState(new Animated.Value(0));
  const [progressAnim] = useState(new Animated.Value(0));

  const { draft, primaryDrop, customerId, setRide, setTrip, setAssignedDriver, ride, trip, clearActiveRide } = useBooking();
  const [statusText, setStatusText] = useState(t('tracking.findingNearbyDriver'));
  const [failure, setFailure] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const isSearchingRef = useRef(false);
  const currentRideRef = useRef<Ride | undefined>(undefined);
  const currentTripRef = useRef<Trip | undefined>(undefined);

  /**
   * Cancellation handler called only when customer confirms "Cancel Booking" in dialog.
   * Calls real backend cancellation API and cleans up active search / listeners.
   */
  const handleCancelConfirm = useCallback(async () => {
    // 1. Abort driver search loop & local timers immediately
    abortRef.current?.abort();
    isSearchingRef.current = false;

    const activeTripId = currentTripRef.current?.id || trip?.id;
    const activeRideId = currentRideRef.current?.id || ride?.id;

    if (activeTripId && customerId) {
      await cancelTrip(activeTripId, customerId, 'Customer cancelled booking');
    } else if (activeRideId) {
      try {
        await cancelRide(activeRideId);
      } catch (err) {
        // If ride was already accepted into a trip, attempt trip cancellation
        if (customerId) {
          const matchedTrip = await getRideTrip(activeRideId).catch(() => null);
          if (matchedTrip?.id) {
            await cancelTrip(matchedTrip.id, customerId, 'Customer cancelled booking');
            clearActiveRide();
            return;
          }
        }
        throw err;
      }
    }

    // 2. Clear booking state
    clearActiveRide();
  }, [customerId, trip?.id, ride?.id, clearActiveRide]);

  const { isCancelling, requestCancellation } = useActiveBookingCancellation({
    navigation,
    isBookingActive: true,
    onCancelConfirm: handleCancelConfirm,
    allowedNextRoutes: ['DriverFoundScreen', 'NoDriversAvailableScreen'],
  });

  /**
   * Runs the client-side dispatch: nearby drivers, then offer the ride to each
   * in turn until one accepts. The engine has no server-side matching.
   */
  useEffect(() => {
    const pickup = draft.pickup;
    if (!pickup || !primaryDrop) {
      setFailure(t('booking.pickupDropRequired'));
      return;
    }
    if (!customerId) {
      // Waiting for customerId to load
      return;
    }
    if (isSearchingRef.current) {
      return;
    }
    isSearchingRef.current = true;
    setFailure(undefined);

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    // 4. Record search start time precisely once when backend search begins
    const searchStartedAt = Date.now();

    (async () => {
      try {
        const { ride: foundRide, driver } = await findDriverAndCreateRide(
          {
            customerId,
            pickup,
            drop: primaryDrop,
            drops: draft.drops.map(toGeoPoint),
            vehicleType: draft.vehicleType,
            weight: draft.weightKg,
            fare: draft.fareEstimate?.fare,
          },
          {
            signal: controller.signal,
            searchCenter: pickup,
            onRideCreated: (createdRide) => {
              if (cancelled) return;
              currentRideRef.current = createdRide;
              setRide(createdRide);
            },
            onProgress: ({ attempt, totalCandidates, driver: candidate }) => {
              if (cancelled) return;
              setStatusText(
                t('tracking.contactingDriver', {
                  name: candidate.name,
                  distance: candidate.distanceKm.toFixed(1),
                  attempt,
                  total: totalCandidates,
                })
              );
            },
          }
        );

        if (cancelled) return;
        currentRideRef.current = foundRide;
        setRide(foundRide);
        setAssignedDriver(driver);

        // The trip is created the moment the driver accepts.
        const foundTrip = await getRideTrip(foundRide.id, controller.signal);
        if (cancelled) return;
        if (foundTrip) {
          currentTripRef.current = foundTrip;
          setTrip(foundTrip);
        }

        // 5. Driver found has priority - immediately go to next screen
        navigation?.navigate('DriverFoundScreen');
      } catch (caught) {
        isSearchingRef.current = false;
        // 2. Handle AbortError Explicitly
        if (
          cancelled ||
          controller.signal.aborted ||
          (caught instanceof Error && caught.name === 'AbortError')
        ) {
          return;
        }

        // 1. NEVER classify network errors as No Driver
        if (!(caught instanceof NoDriversAvailableError)) {
          setFailure(toApiError(caught).userMessage);
          return;
        }

        // 6. No driver before 40 seconds: wait locally for the remaining duration
        const elapsed = Date.now() - searchStartedAt;
        const remaining = MIN_DRIVER_SEARCH_DURATION_MS - elapsed;

        if (remaining > 0) {
          setStatusText(t('tracking.findingADriver'));
          try {
            await new Promise<void>((resolve, reject) => {
              const timerId = setTimeout(resolve, remaining);
              
              const onAbort = () => {
                clearTimeout(timerId);
                reject(new Error('AbortError'));
              };
              
              controller.signal.addEventListener('abort', onAbort, { once: true });
            });
          } catch (e) {
            // Customer cancelled during wait (or component unmounted)
            return;
          }
        }
        
        if (cancelled || controller.signal.aborted) return;

        // 7. Navigate once definitively no drivers and minimum duration met
        navigation?.navigate('NoDriversAvailableScreen');
      }
    })();

    return () => {
      cancelled = true;
      isSearchingRef.current = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, draft.pickup?.latitude, draft.pickup?.longitude]);

  useEffect(() => {
    // Indeterminate progress bar animation
    const progressLoop = Animated.loop(
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: false, // width/transform interpolation
      })
    );
    progressLoop.start();
    
    return () => {
      progressLoop.stop();
    };
  }, [progressAnim]);

  const progressTranslate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-100%', '330%'],
  });

  const currentFare = trip?.fare || ride?.fare || draft.fareEstimate?.fare;
  const currentVehicle = ride?.vehicleType || draft.vehicleType || 'Any Vehicle';
  const vehicleData = mockVehicleTypes.find((v) => v.name === currentVehicle || v.id === currentVehicle);

  const paymentMethodLabel = (() => {
    switch (draft.paymentMethod) {
      case 'upi':
        return t('payment.online');
      case 'pickup':
        return t('payment.cashAtPickup');
      case 'cod':
      default:
        return t('payment.cashOnDelivery');
    }
  })();

  return (
    <View style={styles.container}>
      <MapCanvas
        style={styles.mapCanvas}
        center={draft.pickup ?? undefined}
        zoomDelta={NEIGHBORHOOD_DELTA}
        markers={draft.pickup ? [{ id: 'pickup', coordinate: draft.pickup, kind: 'pickup', title: t('home.pickup') }] : []}
      />

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            style={[styles.iconButton, isCancelling && { opacity: 0.5 }]}
            onPress={() => {
              if (isCancelling) return;
              if (onBack) onBack();
              else requestCancellation();
            }}
            accessibilityRole="button"
            disabled={isCancelling}
          >
            <Feather name="arrow-left" size={22} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('tracking.findingADriver')}</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>

      {/* Main Content Area (Bottom) */}
      <SafeAreaView edges={['bottom']} style={styles.contentSafeArea} pointerEvents="box-none">
        <View style={styles.contentContainer} pointerEvents="box-none">
          {/* Trip Summary Card */}
          <View style={styles.summaryCard}>
            {/* Status Section */}
            <View style={styles.statusSection}>
              <View style={styles.statusHeaderRow}>
                <Text style={styles.statusLabel}>{t('common.status').toUpperCase()}</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{t('tracking.inProgress')}</Text>
                </View>
              </View>
              <Text style={styles.statusTitle}>{failure ?? statusText}</Text>
              
              {/* Progress Bar */}
              <View style={styles.progressBarTrack}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    { left: progressTranslate },
                  ]}
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Summary Details */}
            <View style={styles.detailsSection}>
              <View style={styles.pickupRow}>
                <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                <View style={styles.pickupInfo}>
                  <Text style={styles.pickupLabel}>{t('tracking.searchingNear')}</Text>
                  <Text style={styles.pickupText}>{draft.pickup?.address || t('tracking.selectedPickup')}</Text>
                </View>
              </View>

              <View style={styles.vehicleCard}>
                <View style={styles.vehicleInfoRow}>
                  {vehicleData?.image ? (
                    <Image source={vehicleData.image} style={styles.vehicleIconImage} resizeMode="contain" />
                  ) : (
                    <Feather name="truck" size={20} color={colors.onSurfaceVariant} />
                  )}
                  <View>
                    <Text style={styles.vehicleLabel}>{t('trip.vehicle')}</Text>
                    <Text style={styles.vehicleText}>{currentVehicle}</Text>
                  </View>
                </View>
                <View style={styles.fareInfo}>
                  <Text style={styles.fareLabel}>{paymentMethodLabel}</Text>
                  <Text style={styles.fareText}>{currentFare != null ? `₹${currentFare}` : '...'}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Cancel Action */}
          <Pressable
            style={[styles.cancelButton, isCancelling && { opacity: 0.7 }]}
            onPress={() => {
              if (isCancelling) return;
              if (onCancel) onCancel();
              else requestCancellation();
            }}
            accessibilityRole="button"
            disabled={isCancelling}
          >
            {isCancelling ? (
              <View style={styles.cancelButtonContent}>
                <ActivityIndicator size="small" color={colors.onSurface} style={{ marginRight: spacing.sm }} />
                <Text style={styles.cancelButtonText}>{t('tracking.cancelling').toUpperCase()}</Text>
              </View>
            ) : (
              <Text style={styles.cancelButtonText}>{t('tracking.cancelBooking').toUpperCase()}</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  mapCanvas: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
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
    backgroundColor: colors.surface + 'CC', // 80% opacity for blur effect (simplified)
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  headerSpacer: {
    width: 48,
  },

  // Content
  contentSafeArea: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: 10,
  },
  contentContainer: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  
  // Status Section
  statusSection: {
    gap: spacing.sm,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  statusBadge: {
    backgroundColor: colors.secondaryFixed,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primaryContainer, // matches primary-container approx from design
    fontFamily: typography.labelSm.fontFamily,
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  progressBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#e5e1e4',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressBarFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '30%',
    backgroundColor: '#151a31', // primary-container
    borderRadius: 2,
  },

  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.sm,
  },

  // Details
  detailsSection: {
    gap: spacing.md,
  },
  pickupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  pickupInfo: {
    flex: 1,
  },
  pickupLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  pickupText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  vehicleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  vehicleInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  vehicleIconImage: {
    width: 32,
    height: 32,
  },
  vehicleLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  vehicleText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  fareInfo: {
    alignItems: 'flex-end',
  },
  fareLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  fareText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Cancel Button
  cancelButton: {
    width: '100%',
    height: 48,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
  },
  cancelButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FindingDriverScreen;
