import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Pressable,
  ImageBackground,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { useBooking } from '../../state/BookingContext';
import { findDriverAndCreateRide, NoDriversAvailableError } from '../../api/matching';
import { getRideTrip } from '../../api/engine';
import { toApiError } from '../../api/http';

export interface FindingDriverScreenProps {
  readonly onCancel?: () => void;
  readonly onBack?: () => void;
}

const FindingDriverScreen: React.FC<FindingDriverScreenProps & { navigation?: any }> = ({
  onCancel,
  onBack,
  navigation,
}) => {
  const [pulseAnim] = useState(new Animated.Value(0));
  const [progressAnim] = useState(new Animated.Value(0));

  const { draft, primaryDrop, customerId, setRide, setTrip, setAssignedDriver } = useBooking();
  const [statusText, setStatusText] = useState('Searching for nearby drivers…');
  const [failure, setFailure] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);

  /**
   * Runs the client-side dispatch: nearby drivers, then offer the ride to each
   * in turn until one accepts. The engine has no server-side matching.
   */
  useEffect(() => {
    const pickup = draft.pickup;
    if (!pickup || !primaryDrop || !customerId) {
      setFailure('Pickup and drop are required before booking.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    (async () => {
      try {
        const { ride, driver } = await findDriverAndCreateRide(
          {
            customerId,
            pickup,
            drop: primaryDrop,
            vehicleType: draft.vehicleType,
            weight: draft.weightKg,
            fare: draft.fareEstimate?.fare,
          },
          {
            signal: controller.signal,
            onProgress: ({ attempt, totalCandidates, driver: candidate }) => {
              if (cancelled) return;
              setStatusText(
                `Contacting ${candidate.name} · ${candidate.distanceKm.toFixed(1)} km away (${attempt} of ${totalCandidates})`
              );
            },
          }
        );

        if (cancelled) return;
        setRide(ride);
        setAssignedDriver(driver);

        // The trip is created the moment the driver accepts.
        const trip = await getRideTrip(ride.id, controller.signal);
        if (cancelled) return;
        if (trip) setTrip(trip);

        navigation?.navigate('DriverFoundScreen');
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        if (caught instanceof NoDriversAvailableError) {
          navigation?.navigate('NoDriversAvailableScreen');
          return;
        }
        setFailure(toApiError(caught).userMessage);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const handleCancel = () => {
    abortRef.current?.abort();
    if (onCancel) return onCancel();
    navigation?.navigate('CancellationReasonScreen');
  };

  useEffect(() => {
    // Pulse animation for the map pin
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.bezier(0.215, 0.61, 0.355, 1),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Indeterminate progress bar animation
    Animated.loop(
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: false, // width/transform interpolation
      })
    ).start();
  }, [pulseAnim, progressAnim]);

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [0.8, 2.5, 2.5],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [0.5, 0, 0],
  });

  const progressTranslate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-100%', '330%'],
  });

  return (
    <View style={styles.container}>
      {/* Map Background */}
      <ImageBackground
        source={{
          uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDwoKdogXLDviOGhD1X2B7fNQUBDa5m4V5AF0mQKHmmuMqx-nerI2-PYdE18EypUlA_hmsQcX44QaZXk528XOtiHUaSOmxsSy5kRpL7ksLowlE0yzo0erVktsFV9SgDjM9mZKltrLp7PzQ6WgFCDowItZDm0MeLJtBW3Psa7-vl3Z7LttTmFPV68OnMYPj9Vng7fIBtDSvDNL4ZUs2qxee5Yyd8hXkigQMuYJK2rTAe_ySsHrvxo7dq',
        }}
        style={styles.mapCanvas}
        imageStyle={{ opacity: 0.6 }}
      >
        {/* Pulsing Pin */}
        <View style={styles.mapPinContainer}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
              },
            ]}
          />
          <View style={styles.mapPinDot} />
        </View>
      </ImageBackground>

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={22} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Finding a Driver</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>

      {/* Main Content Area (Bottom) */}
      <SafeAreaView edges={['bottom']} style={styles.contentSafeArea}>
        <View style={styles.contentContainer}>
          {/* Trip Summary Card */}
          <View style={styles.summaryCard}>
            {/* Status Section */}
            <View style={styles.statusSection}>
              <View style={styles.statusHeaderRow}>
                <Text style={styles.statusLabel}>STATUS</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>Booking Confirmed</Text>
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
                  <Text style={styles.pickupLabel}>Pickup</Text>
                  <Text style={styles.pickupText}>Sardarpura Warehouse</Text>
                </View>
              </View>

              <View style={styles.vehicleCard}>
                <View style={styles.vehicleInfoRow}>
                  <Feather name="truck" size={20} color={colors.onSurfaceVariant} />
                  <View>
                    <Text style={styles.vehicleLabel}>Vehicle</Text>
                    <Text style={styles.vehicleText}>Tata Ace</Text>
                  </View>
                </View>
                <View style={styles.fareInfo}>
                  <Text style={styles.fareLabel}>Est. Fare</Text>
                  <Text style={styles.fareText}>₹450</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Cancel Action */}
          <Pressable style={styles.cancelButton} onPress={handleCancel} accessibilityRole="button">
            <Text style={styles.cancelButtonText}>CANCEL BOOKING</Text>
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
  mapPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -8 }, { translateY: -8 }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryContainer,
  },
  mapPinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryContainer,
    borderWidth: 2,
    borderColor: colors.surface,
    zIndex: 10,
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
  headerSpacer: {
    width: 40,
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
});

export default FindingDriverScreen;
