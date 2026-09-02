import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';
import { getDriver } from '../../api/engine';
import type { GeoPoint } from '../../api/types';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoute } from '../../hooks/useRoute';

export interface DriverAssignedScreenProps {
  readonly onMenuPress?: () => void;
  readonly onContactDriver?: () => void;
  readonly onTripDetails?: () => void;
}

const DriverAssignedScreen: React.FC<DriverAssignedScreenProps & { navigation?: any }> = ({
  onMenuPress,
  onContactDriver,
  onTripDetails,
  navigation,
}) => {
  const { assignedDriver, trip, setTrip } = useBooking();

  // Poll the trip so we react the moment the driver arrives, verifies pickup,
  // or finishes the trip. Without this the screen would stay on "Driver Assigned"
  // forever even after the ride was completed.
  const { trip: polled } = useTripStatus(trip?.id, { intervalMs: 3_000 });
  useEffect(() => {
    if (polled) setTrip(polled);
  }, [polled, setTrip]);

  const current = polled ?? trip;
  const status = current?.status;

  // Advance as soon as the engine reports real progress. `replace` (not
  // `navigate`) removes this screen from the stack so its `useTripStatus`
  // poll stops firing — otherwise later status changes would double-push
  // the same forward screens on top of each other.
  useEffect(() => {
    if (!status) return;
    if (status === 'DRIVER_ARRIVED') {
      navigation?.replace('PickupOtpVerificationScreen');
    } else if (status === 'PICKUP_VERIFIED' || status === 'IN_TRANSIT' || status === 'DROP_PROGRESS') {
      navigation?.replace('CustomerLiveTrackingScreen');
    } else if (status === 'DELIVERED' || status === 'COMPLETED') {
      navigation?.replace('TripCompletedScreen');
    } else if (status === 'CANCELLED') {
      navigation?.replace('TripCancelledStatusScreen');
    }
  }, [status, navigation]);

  // Live driver location. Polled here rather than pushed because the engine has
  // no WebSocket channel; the driver app PATCHes their position every ~5s.
  const [driverPoint, setDriverPoint] = useState<GeoPoint | undefined>(
    assignedDriver
      ? { latitude: assignedDriver.latitude, longitude: assignedDriver.longitude }
      : undefined
  );
  const driverId = current?.driverId ?? assignedDriver?.id;

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

  // Route from the driver to the pickup: they're on their way to fetch you.
  // Recomputed only when the driver crosses ~11m boundaries (see useRoute).
  const roadRoute = useRoute(driverPoint, current?.pickup);

  const markers = useMemo<readonly MapMarker[]>(() => {
    const built: MapMarker[] = [];
    if (current?.pickup) {
      built.push({
        id: 'pickup',
        kind: 'pickup',
        coordinate: current.pickup,
        title: 'Pickup',
        description: current.pickup.address,
      });
    }
    if (current?.drop) {
      built.push({
        id: 'drop',
        kind: 'drop',
        coordinate: current.drop,
        title: 'Drop',
        description: current.drop.address,
      });
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

  return (
    <View style={styles.container}>
      <MapCanvas
        style={StyleSheet.absoluteFill as any}
        markers={markers}
        fitToMarkers={markers.length > 1}
        polyline={roadRoute}
      />

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onMenuPress ? onMenuPress() : navigation?.goBack())}
            accessibilityRole="button"
          >
            <Feather name="menu" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Pick Up</Text>
          <View style={styles.profileIconBox}>
            <Feather name="user" size={16} color={colors.onSurfaceVariant} />
          </View>
        </View>
      </SafeAreaView>

      {/* Driver Info Bottom Card (Using DraggableBottomSheet for consistent feel, or a static view) */}
      {/* We will use a static positioned view to match the design closely as a fixed bottom card. */}
      <View style={styles.bottomSheetContainer}>
        {/* Drag Handle Indicator */}
        <View style={styles.dragHandle} />

        {/* Status Header */}
        <View style={styles.statusHeaderRow}>
          <View style={styles.statusTextCol}>
            <Text style={styles.statusTitle}>Driver Assigned</Text>
            <Text style={styles.statusSubtitle}>Heading to your pickup point</Text>
          </View>
        </View>

        {/* Driver Details */}
        <View style={styles.driverDetailsCard}>
          <View style={styles.driverAvatar}>
            <Feather name="user" size={32} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.driverInfoText}>
            <Text style={styles.driverName}>{assignedDriver?.name ?? 'Driver assigned'}</Text>
            <Text style={styles.vehicleType}>{assignedDriver?.vehicleType ?? '—'}</Text>
          </View>
          {typeof assignedDriver?.distanceKm === 'number' && (
            <View style={styles.vehiclePlateBox}>
              <Text style={styles.vehiclePlateText}>
                {assignedDriver.distanceKm.toFixed(1)} km
              </Text>
            </View>
          )}
        </View>

        {/* The engine gives the OTP to the customer to read out to the driver. */}
        {trip?.otp && (
          <View style={styles.otpRow}>
            <Text style={styles.otpLabel}>PICKUP OTP</Text>
            <Text style={styles.otpValue}>{trip.otp}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label="Contact Driver"
            onPress={() => (onContactDriver ? onContactDriver() : navigation?.navigate('CallDriverScreen'))}
            variant="primary"
            fullWidth
            icon={<MaterialIcons name="call" size={20} color={colors.onPrimary} />}
          />
          <Button
            label="Trip Details"
            onPress={() => (onTripDetails ? onTripDetails() : navigation?.navigate('DriverAssignedExpandedScreen'))}
            variant="secondary"
            fullWidth
            icon={<MaterialIcons name="list-alt" size={20} color={colors.onSecondaryContainer} />}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#e5e1e4', // From HTML design
    zIndex: 0,
  },
  pickupPinContainer: {
    position: 'absolute',
    top: '25%',
    left: '33%',
    alignItems: 'center',
    zIndex: 10,
  },
  pickupPinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.card,
  },
  pickupPinLine: {
    height: 64,
    width: 0,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primary + '66', // 40% opacity
    marginTop: -8,
  },
  driverLocationContainer: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    marginLeft: -32,
    marginTop: -32,
    alignItems: 'center',
    zIndex: 20,
  },
  driverPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  etaBadge: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface + 'E6', // 90% opacity
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    ...shadows.card,
  },
  etaBadgeText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  profileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  bottomSheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest + 'E6', // 90% opacity
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    zIndex: 40,
    ...shadows.elevated,
  },
  dragHandle: {
    width: 48,
    height: 4,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: borderRadius.full,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  statusTextCol: {
    flexDirection: 'column',
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  ratingText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  driverDetailsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  driverAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  driverInfoText: {
    flex: 1,
    flexDirection: 'column',
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  vehicleType: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  vehiclePlateBox: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  vehiclePlateText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  actionsContainer: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xl,
  },
  otpLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  otpValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.onSecondaryContainer,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: 4,
  },
});

export default DriverAssignedScreen;
