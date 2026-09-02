import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';
import MapCanvas, { type MapMarker } from '../components/map/MapCanvas';
import { useDriver } from '../state/DriverContext';
import { useRoute } from '../hooks/useRoute';
import {
  advanceTrip,
  cancelTripAsDriver,
  verifyPickupOtp,
  type DriverTripAction,
} from '../api/driver';
import { toApiError } from '../api/http';
import type { TripStatus } from '../api/types';

/**
 * Active trip: one primary action per stage.
 *
 * The order mirrors the engine's state machine. Calling a transition out of
 * order returns 409, so each status maps to exactly one next action.
 * DRIVER_ARRIVED is the exception — it needs the OTP the customer reads out.
 */

interface Stage {
  readonly label: string;
  readonly action?: DriverTripAction;
  readonly needsOtp?: boolean;
}

const STAGE_BY_STATUS: Partial<Record<TripStatus, Stage>> = {
  DRIVER_ASSIGNED: { label: "I'VE ARRIVED AT PICKUP", action: 'arrive' },
  DRIVER_ARRIVED: { label: 'VERIFY PICKUP OTP', needsOtp: true },
  PICKUP_VERIFIED: { label: 'START TRIP', action: 'start' },
  IN_TRANSIT: { label: 'ARRIVED AT DROP', action: 'drop/start' },
  DROP_PROGRESS: { label: 'CONFIRM DELIVERY', action: 'drop/confirm' },
  DELIVERED: { label: 'COMPLETE TRIP', action: 'complete' },
};

const STATUS_COPY: Record<TripStatus, string> = {
  DRIVER_ASSIGNED: 'Head to the pickup point',
  DRIVER_ARRIVED: 'Ask the customer for their 4-digit OTP',
  PICKUP_VERIFIED: 'Pickup confirmed. Start the trip.',
  IN_TRANSIT: 'On the way to the drop',
  DROP_PROGRESS: 'At the drop location',
  DELIVERED: 'Delivered. Close the trip.',
  COMPLETED: 'Trip completed',
  CANCELLED: 'Trip cancelled',
};

const DriverTripScreen: React.FC<{ readonly navigation?: any }> = ({ navigation }) => {
  const { driverId, activeTrip, setActiveTrip, location, refreshActiveTrip } = useDriver();

  const [otp, setOtp] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string>();

  const trip = activeTrip;
  const status = trip?.status;
  const stage = status ? STAGE_BY_STATUS[status] : undefined;

  // Return home once the trip is over.
  useEffect(() => {
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      const timer = setTimeout(() => {
        setActiveTrip(undefined);
        navigation?.navigate('DriverHome');
      }, 2_500);
      return () => clearTimeout(timer);
    }
  }, [status, setActiveTrip, navigation]);

  // Driver's own position is drawn by react-native-maps as the OS "my location"
  // dot (via `showsUserLocation`), so we don't add a truck marker for them —
  // that marker style is meant for the customer's view of the driver.
  const markers = useMemo<readonly MapMarker[]>(() => {
    const built: MapMarker[] = [];
    if (trip?.pickup) {
      built.push({ id: 'pickup', kind: 'pickup', coordinate: trip.pickup, title: 'Pickup' });
    }
    if (trip?.drop) {
      built.push({ id: 'drop', kind: 'drop', coordinate: trip.drop, title: 'Drop' });
    }
    return built;
  }, [trip?.pickup, trip?.drop]);

  // Route the driver is actually following: to pickup while pre-transit, then
  // pickup→drop. Fetched from Google Directions so it follows real roads.
  const preTransit =
    status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED' || status === 'PICKUP_VERIFIED';
  const routeOrigin = preTransit ? location : trip?.pickup;
  const routeDestination = preTransit ? trip?.pickup : trip?.drop;
  const routeLine = useRoute(routeOrigin, routeDestination);

  const runAction = async () => {
    if (!trip || !stage) return;
    setIsWorking(true);
    setError(undefined);
    try {
      if (stage.needsOtp) {
        if (otp.trim().length !== 4) {
          setError('Enter the 4-digit OTP from the customer.');
          return;
        }
        setActiveTrip(await verifyPickupOtp(trip.id, driverId, otp.trim()));
        setOtp('');
      } else if (stage.action) {
        setActiveTrip(await advanceTrip(trip.id, driverId, stage.action));
      }
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(
        stage.needsOtp && apiError.status === 400
          ? 'That OTP does not match. Ask the customer again.'
          : apiError.userMessage
      );
      // Re-sync in case the engine moved on without us.
      void refreshActiveTrip();
    } finally {
      setIsWorking(false);
    }
  };

  const handleCancel = async () => {
    if (!trip) return;
    setIsWorking(true);
    try {
      setActiveTrip(await cancelTripAsDriver(trip.id, driverId, 'Cancelled by driver'));
    } catch (caught) {
      setError(toApiError(caught).userMessage);
    } finally {
      setIsWorking(false);
    }
  };

  if (!trip) {
    return (
      <SafeAreaView style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No active trip.</Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => navigation?.navigate('DriverHome')}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>BACK TO HOME</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <MapCanvas
        style={StyleSheet.absoluteFill as any}
        markers={markers}
        polyline={routeLine}
        fitToMarkers
        showsUserLocation
      />

      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Text style={styles.headerStatus}>{status ? STATUS_COPY[status] : ''}</Text>
          <Text style={styles.headerMeta}>
            {trip.id} · ₹{trip.fare ?? '—'} · {trip.weight ?? '—'} kg
          </Text>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.panelSafeArea}>
        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panel}>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, styles.pickupDot]} />
              <Text style={styles.routeAddress} numberOfLines={2}>
                {trip.pickup?.address ?? 'Pickup'}
              </Text>
            </View>
            <View style={styles.routeConnector} />
            <View style={styles.routeRow}>
              <View style={[styles.routeDot, styles.dropDot]} />
              <Text style={styles.routeAddress} numberOfLines={2}>
                {trip.drop?.address ?? 'Drop'}
              </Text>
            </View>
          </View>

          {stage?.needsOtp && (
            <View style={styles.otpBlock}>
              <Text style={styles.otpLabel}>PICKUP OTP FROM CUSTOMER</Text>
              <TextInput
                style={styles.otpInput}
                value={otp}
                onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="0000"
                placeholderTextColor={colors.outlineVariant}
              />
            </View>
          )}

          {error && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {stage ? (
            <Pressable
              style={[styles.primaryButton, isWorking && styles.buttonDisabled]}
              onPress={runAction}
              disabled={isWorking}
              accessibilityRole="button"
            >
              {isWorking ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>{stage.label}</Text>
              )}
            </Pressable>
          ) : (
            <Text style={styles.panelHint}>
              {status === 'COMPLETED' ? 'Returning to home…' : 'Nothing left to do.'}
            </Text>
          )}

          {status !== 'COMPLETED' && status !== 'CANCELLED' && (
            <Pressable onPress={handleCancel} disabled={isWorking} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel trip</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceContainerHigh },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  emptyText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  headerSafeArea: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    marginHorizontal: spacing.marginMobile,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    ...shadows.card,
  },
  headerStatus: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  headerMeta: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
    marginTop: 2,
  },
  panelSafeArea: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '62%' },
  panelScroll: { flexGrow: 0 },
  panel: {
    margin: spacing.marginMobile,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 24,
    gap: spacing.md,
    ...shadows.elevated,
  },
  routeCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  pickupDot: { backgroundColor: colors.statusGreen },
  dropDot: { backgroundColor: colors.primary },
  routeConnector: {
    width: 2,
    height: 16,
    backgroundColor: colors.outlineVariant,
    marginLeft: 5,
    marginVertical: 2,
  },
  routeAddress: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  otpBlock: { gap: spacing.xs },
  otpLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  otpInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 12,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  errorText: {
    flex: 1,
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
  },
  primaryButton: {
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  panelHint: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },
  cancelText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },
});

export default DriverTripScreen;
