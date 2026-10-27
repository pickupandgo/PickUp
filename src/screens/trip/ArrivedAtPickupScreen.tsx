import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { PaymentGateNotice } from '../../components/molecules/PaymentGateNotice';
import { MultiStopTimeline } from '../../components/organisms/MultiStopTimeline';
import { DriverMap, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { useLiveTrip } from '../../hooks/useActiveTrip';
import { usePaymentGate } from '../../hooks/usePaymentGate';
import { useI18n } from '../../i18n';
import { pickupHandoverAllowed } from '../../services/payments/collectionFlow';
import { TripController } from '../../services/trip/TripController';
import {
  describeTripError,
  engineStatusOf,
} from '../../services/trip/tripErrors';
import type { HomeScreenProps } from '../../types/navigation';

export interface ArrivedAtPickupScreenProps {
  readonly navigation: HomeScreenProps<'ArrivedAtPickup'>['navigation'];
  readonly route: HomeScreenProps<'ArrivedAtPickup'>['route'];
  readonly testID?: string;
}

type Busy = 'arrive' | 'start' | 'refresh' | null;

/**
 * The pickup, driven by the engine's trip status and the payment gate (review G):
 *   DRIVER_ASSIGNED   ARRIVED (one engine step)
 *   DRIVER_ARRIVED    pay at pickup: payment required / waiting / paid, then ENTER SENDER OTP
 *                     (enabled only when the payment backend allows the handover);
 *                     pay at delivery: ENTER SENDER OTP, nothing to collect
 *   PICKUP_VERIFIED   START TRIP (one engine step)
 * A failure shows the server's message and re-reads the trip; the screen never moves on by itself.
 */
export const ArrivedAtPickupScreen: React.FC<ArrivedAtPickupScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { currentLocation } = useDriverLocation();
  const { tripId, stopId } = route.params;
  const trip = useLiveTrip(tripId);
  const status = trip ? engineStatusOf(trip) : null;
  const gate = usePaymentGate(trip, { enabled: status === 'DRIVER_ARRIVED' });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const stop =
    trip?.stops.find(s => s.id === stopId) ??
    trip?.stops.find(s => s.type === 'pickup');

  const routeData: RouteData = {
    polylinePoints: [],
    stops: stop
      ? [
          {
            id: stop.id,
            type: stop.type as StopType,
            coordinate: {
              latitude: stop.latitude,
              longitude: stop.longitude,
            },
            isCurrent: true,
          },
        ]
      : [],
  };

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<unknown>) => {
      setBusy(kind);
      setError(null);
      try {
        await action();
        return true;
      } catch (e) {
        setError(describeTripError(e, t));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  const handleArrived = useCallback(() => {
    run('arrive', () =>
      TripController.getInstance().arriveAtPickup(tripId),
    ).catch(() => undefined);
  }, [run, tripId]);

  const handleStart = useCallback(async () => {
    const started = await run('start', () =>
      TripController.getInstance().startTrip(tripId),
    );
    if (started) {
      navigation.navigate('ActiveTrip', { tripId });
    }
  }, [run, tripId, navigation]);

  const handleRefresh = useCallback(() => {
    gate.refresh();
    run('refresh', () =>
      TripController.getInstance().refreshTrip(tripId),
    ).catch(() => undefined);
  }, [gate, run, tripId]);

  const handleVerifyPickup = useCallback(() => {
    navigation.navigate('PickupOTP', { tripId, stopId });
  }, [navigation, tripId, stopId]);

  const handleCollect = useCallback(
    (backendTripId: string) =>
      navigation.navigate('CollectPayment', { tripId: backendTripId }),
    [navigation],
  );

  const otpAllowed =
    gate.view.kind === 'mock' || pickupHandoverAllowed(gate.gate);

  const renderActions = () => {
    switch (status) {
      case 'DRIVER_ASSIGNED':
        return (
          <PrimaryButton
            label={t('trip.arrived')}
            onPress={handleArrived}
            loading={busy === 'arrive'}
            disabled={busy !== null}
          />
        );
      case 'DRIVER_ARRIVED':
        return (
          <>
            <PaymentGateNotice
              view={gate.view}
              error={gate.error}
              paidWith={gate.paidWith}
              stage="PICKUP"
              onCollect={handleCollect}
            />
            <PrimaryButton
              label={t('trip.enterSenderOtp')}
              onPress={handleVerifyPickup}
              disabled={!otpAllowed || busy !== null}
            />
          </>
        );
      case 'PICKUP_VERIFIED':
        return (
          <>
            <Text style={styles.noteText}>{t('trip.pickupVerified')}</Text>
            <PrimaryButton
              label={t('trip.startTrip')}
              onPress={handleStart}
              loading={busy === 'start'}
              disabled={busy !== null}
            />
          </>
        );
      case 'CANCELLED':
        return (
          <>
            <Text style={styles.noteText}>{t('trip.cancelled')}</Text>
            <PrimaryButton
              label={t('trip.backHome')}
              onPress={() => {
                TripController.getInstance().clearTrip();
                navigation.popToTop();
              }}
            />
          </>
        );
      default:
        return (
          <>
            <Text style={styles.noteText}>{t('trip.pickupDone')}</Text>
            <PrimaryButton
              label={t('trip.continue')}
              onPress={() => navigation.navigate('ActiveTrip', { tripId })}
            />
          </>
        );
    }
  };

  return (
    <View style={styles.safeArea} testID={testID}>
      {/* Absolute back button overlay on map */}
      <SafeAreaView edges={['top']} style={styles.backButtonContainer}>
        <Icon name="arrow_back" style={styles.backButtonIcon} />
        <View
          style={styles.backButtonTouch}
          onTouchEnd={() => navigation.goBack()}
        />
      </SafeAreaView>

      <View style={styles.mapContainer}>
        <DriverMap
          currentLocation={currentLocation || undefined}
          routeData={routeData}
          followDriver={true}
          showControls={false}
          vehicleType={trip?.vehicleId || (trip as any)?.vehicleType}
        />
      </View>

      <View style={styles.bottomPanel}>
        {!trip ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.instructionText}>{t('trip.loading')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.arrivedBadgeContainer}>
              <View style={styles.arrivedBadge}>
                <Text style={styles.arrivedBadgeText}>
                  {status === 'DRIVER_ASSIGNED'
                    ? t('trip.toPickup')
                    : t('trip.atPickup')}
                </Text>
              </View>
            </View>

            <View style={styles.instructionRow}>
              <Text style={styles.instructionText}>
                {status === 'DRIVER_ASSIGNED'
                  ? stop?.address ?? ''
                  : t('trip.senderLoading')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.timelineContainer}>
              <MultiStopTimeline
                stops={trip.stops}
                currentStopIndex={trip.currentStopIndex}
              />
            </View>

            {error ? (
              <InlineErrorBanner
                message={error}
                onRetry={handleRefresh}
                retryLabel={t('trip.refresh')}
                style={styles.error}
              />
            ) : null}

            {renderActions()}

            {status === 'DRIVER_ARRIVED' || status === 'DRIVER_ASSIGNED' ? (
              <SecondaryButton
                label={t('trip.refresh')}
                onPress={handleRefresh}
                disabled={busy !== null}
                style={styles.secondary}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  backButtonContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
    padding: spacing.md,
  },
  backButtonTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 60,
    zIndex: 11,
  },
  backButtonIcon: {
    fontSize: 24,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    padding: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  bottomPanel: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingTop: spacing.md,
    ...shadows.lg,
    marginTop: -20,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  arrivedBadgeContainer: {
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  arrivedBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  arrivedBadgeText: {
    ...typography.labelSm,
    color: '#333333',
    fontWeight: '700',
  },
  instructionRow: {
    marginTop: spacing.xs,
  },
  instructionText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  noteText: {
    ...typography.bodyMd,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.md,
  },
  timelineContainer: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.lg,
  },
  error: {
    marginBottom: spacing.md,
  },
  secondary: {
    marginTop: spacing.gutter,
  },
});

export default ArrivedAtPickupScreen;
