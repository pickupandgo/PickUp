import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { otpVerificationLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { PaymentGateNotice } from '../../components/molecules/PaymentGateNotice';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useLiveTrip } from '../../hooks/useActiveTrip';
import { usePaymentGate } from '../../hooks/usePaymentGate';
import { useI18n } from '../../i18n';
import {
  dropHandoverAllowed,
  isCollectable,
} from '../../services/payments/collectionFlow';
import { TripController } from '../../services/trip/TripController';
import {
  describeTripError,
  engineStatusOf,
} from '../../services/trip/tripErrors';
import type { HomeScreenProps } from '../../types/navigation';

/** Receiver code length. */
const OTP_LENGTH = 4;
const REASON_MIN = 3;
const REASON_MAX = 200;
const FINAL_STOP: ReadonlySet<string> = new Set([
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
]);

/**
 * DropOTPScreen
 * One drop, driven by the engine's trip status and the payment gate (review G). Only the current
 * drop is actionable:
 *   on the way          ARRIVED AT DROP n (one engine step)
 *   arrived, unpaid     pay at delivery: "Collect ₹X for drop n" (COLLECT); OTP locked
 *   arrived, allowed    receiver OTP (paid drop, or paid at pickup), then the delivery photo
 *   failed delivery     reason required; RETRY DELIVERY, or REFRESH for the operations decision
 *   all drops finished  COMPLETE TRIP (explicit, never automatic)
 */
export interface DropOTPScreenProps {
  readonly navigation: HomeScreenProps<'DropOTP'>['navigation'];
  readonly route: HomeScreenProps<'DropOTP'>['route'];
  readonly testID?: string;
}

type Busy = 'arrive' | 'otp' | 'fail' | 'complete' | 'refresh' | null;

export const DropOTPScreen: React.FC<DropOTPScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { tripId, stopId } = route.params;
  const { t } = useI18n();
  const trip = useLiveTrip(tripId);
  const status = trip ? engineStatusOf(trip) : null;
  const stop = trip?.stops.find(s => s.id === stopId && s.type !== 'pickup');
  const current = trip ? trip.stops[trip.currentStopIndex] : undefined;
  const isCurrent = !!stop && current?.id === stop.id;
  const stopStatus = stop?.engineStatus ?? null;
  const sequence = stop?.sequence;
  const awaitingOtp =
    isCurrent && stopStatus === 'ARRIVED' && stop?.otpVerified !== true;

  const gate = usePaymentGate(trip, {
    enabled: awaitingOtp || status === 'DELIVERED',
  });
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFail, setShowFail] = useState(false);
  const [reason, setReason] = useState('');
  const [completionPending, setCompletionPending] = useState(false);

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
      TripController.getInstance().arriveAtDrop(tripId, stopId),
    ).catch(() => undefined);
  }, [run, tripId, stopId]);

  const handleVerify = useCallback(async () => {
    const ok = await run('otp', () =>
      TripController.getInstance().verifyDropOTP(tripId, stopId, otp),
    );
    if (ok) {
      setOtp('');
      navigation.navigate('DeliveryProofCamera', { tripId, stopId });
    } else {
      gate.refresh();
    }
  }, [run, tripId, stopId, otp, navigation, gate]);

  const handleReportFailure = useCallback(async () => {
    const ok = await run('fail', () =>
      TripController.getInstance().failDrop(tripId, stopId, reason),
    );
    if (ok) {
      setShowFail(false);
      setReason('');
    }
  }, [run, tripId, stopId, reason]);

  const handleRefresh = useCallback(() => {
    gate.refresh();
    run('refresh', () =>
      TripController.getInstance().refreshTrip(tripId),
    ).catch(() => undefined);
  }, [gate, run, tripId]);

  const handleComplete = useCallback(async () => {
    setBusy('complete');
    setError(null);
    try {
      const result = await TripController.getInstance().completeTrip(tripId);
      if (result.completion === 'PENDING') {
        setCompletionPending(true);
      } else {
        setCompletionPending(false);
        navigation.navigate('TripCompleted', { tripId });
      }
    } catch (e) {
      setError(describeTripError(e, t));
      gate.refresh();
    } finally {
      setBusy(null);
    }
  }, [tripId, navigation, t, gate]);

  const handleCollect = useCallback(
    (backendTripId: string) =>
      navigation.navigate('CollectPayment', { tripId: backendTripId }),
    [navigation],
  );

  const reasonOk =
    reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  const otpAllowed =
    gate.view.kind === 'mock' || dropHandoverAllowed(gate.gate, sequence);
  const n = sequence ?? '';

  const failForm = () =>
    showFail ? (
      <View style={styles.failBox}>
        <Text style={styles.label}>{t('trip.failReasonLabel')}</Text>
        <TextInput
          style={styles.reasonInput}
          value={reason}
          onChangeText={setReason}
          placeholder={t('trip.failReasonHint')}
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={REASON_MAX}
          multiline
          accessibilityLabel={t('trip.failReasonLabel')}
        />
        {reason.length > 0 && !reasonOk ? (
          <Text style={styles.errorText}>{t('trip.errReason')}</Text>
        ) : null}
        <PrimaryButton
          label={t('trip.reportFailure')}
          onPress={handleReportFailure}
          loading={busy === 'fail'}
          disabled={!reasonOk || busy !== null}
        />
        <SecondaryButton
          label={t('common.cancel')}
          onPress={() => setShowFail(false)}
          disabled={busy !== null}
        />
      </View>
    ) : (
      <SecondaryButton
        label={t('trip.deliveryFailed')}
        onPress={() => setShowFail(true)}
        disabled={busy !== null}
      />
    );

  const renderBody = () => {
    if (!trip) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.subtitle}>{t('trip.loading')}</Text>
        </View>
      );
    }
    if (status === 'CANCELLED') {
      return (
        <>
          <Text style={styles.title}>{t('trip.cancelled')}</Text>
          <PrimaryButton
            label={t('trip.backHome')}
            onPress={() => {
              TripController.getInstance().clearTrip();
              navigation.popToTop();
            }}
          />
        </>
      );
    }
    if (status === 'COMPLETED') {
      return (
        <PrimaryButton
          label={t('trip.viewSummary')}
          onPress={() => navigation.navigate('TripCompleted', { tripId })}
        />
      );
    }
    if (!stop) {
      return (
        <>
          <Text style={styles.subtitle}>{t('trip.errNotFound')}</Text>
          <PrimaryButton
            label={t('trip.backToTrip')}
            onPress={() => navigation.navigate('ActiveTrip', { tripId })}
          />
        </>
      );
    }
    if (status === 'DELIVERED') {
      const owed = gate.view.kind === 'ready' && isCollectable(gate.view.trip);
      return (
        <>
          <Text style={styles.title}>{t('trip.allDropsDone')}</Text>
          {owed ? (
            <PaymentGateNotice
              view={gate.view}
              error={gate.error}
              paidWith={gate.paidWith}
              stage="DROP"
              sequence={sequence}
              onCollect={handleCollect}
            />
          ) : null}
          {completionPending ? (
            <Text style={styles.subtitle}>{t('trip.completionPending')}</Text>
          ) : null}
          <PrimaryButton
            label={t('trip.completeTrip')}
            onPress={handleComplete}
            loading={busy === 'complete'}
            disabled={busy !== null}
          />
          {completionPending ? (
            <SecondaryButton
              label={t('trip.refresh')}
              onPress={handleRefresh}
              disabled={busy !== null}
            />
          ) : null}
        </>
      );
    }
    if (stopStatus && FINAL_STOP.has(stopStatus)) {
      return (
        <>
          <Text style={styles.title}>
            {stopStatus === 'UNDELIVERED'
              ? t('trip.dropUndelivered', { n })
              : t('trip.dropDone', { n })}
          </Text>
          <PrimaryButton
            label={t('trip.nextDrop')}
            onPress={() => navigation.navigate('ActiveTrip', { tripId })}
          />
        </>
      );
    }
    if (!isCurrent) {
      return (
        <>
          <Text style={styles.subtitle}>
            {status === 'DRIVER_ASSIGNED' ||
            status === 'DRIVER_ARRIVED' ||
            status === 'PICKUP_VERIFIED'
              ? t('trip.startFirst')
              : t('trip.notCurrentStop', { stop: current?.label ?? '' })}
          </Text>
          <PrimaryButton
            label={t('trip.backToTrip')}
            onPress={() => navigation.navigate('ActiveTrip', { tripId })}
          />
        </>
      );
    }
    switch (stopStatus) {
      case 'IN_TRANSIT':
        return (
          <>
            <Text style={styles.title}>{t('trip.toDrop', { n })}</Text>
            <Text style={styles.subtitle}>{stop.address}</Text>
            <PrimaryButton
              label={t('trip.arrivedAtDrop', { n })}
              onPress={handleArrived}
              loading={busy === 'arrive'}
              disabled={busy !== null}
            />
          </>
        );
      case 'ARRIVED':
        if (stop.otpVerified) {
          return (
            <>
              <Text style={styles.title}>{t('trip.otpVerified')}</Text>
              <PrimaryButton
                label={t('trip.takePhoto')}
                onPress={() =>
                  navigation.navigate('DeliveryProofCamera', { tripId, stopId })
                }
                disabled={busy !== null}
              />
              {failForm()}
            </>
          );
        }
        return (
          <>
            <Text style={styles.badge}>{t('trip.atDrop', { n })}</Text>
            <PaymentGateNotice
              view={gate.view}
              error={gate.error}
              paidWith={gate.paidWith}
              stage="DROP"
              sequence={sequence}
              onCollect={handleCollect}
            />
            <Text style={styles.title}>
              {otpVerificationLabels.dropOtpTitle}
            </Text>
            <Text style={styles.subtitle}>
              {otpAllowed
                ? otpVerificationLabels.dropOtpSubtitle
                : t('trip.otpLocked')}
            </Text>
            <OTPInput
              length={OTP_LENGTH}
              value={otp}
              onChange={setOtp}
              onComplete={setOtp}
              hasError={error !== null}
              style={styles.otpInput}
            />
            <PrimaryButton
              label={otpVerificationLabels.verifyLabel}
              onPress={handleVerify}
              disabled={otp.length < OTP_LENGTH || !otpAllowed || busy !== null}
              loading={busy === 'otp'}
            />
            {failForm()}
          </>
        );
      case 'DELIVERY_FAILED':
        return (
          <>
            <Text style={styles.title}>
              {t('trip.failedTitle', { reason: stop.failureReason ?? '' })}
            </Text>
            <Text style={styles.subtitle}>{t('trip.failedWaiting')}</Text>
            <PrimaryButton
              label={t('trip.retryDelivery')}
              onPress={handleArrived}
              loading={busy === 'arrive'}
              disabled={busy !== null}
            />
            <SecondaryButton
              label={t('trip.refresh')}
              onPress={handleRefresh}
              disabled={busy !== null}
            />
          </>
        );
      default:
        return (
          <>
            <Text style={styles.subtitle}>{t('trip.startFirst')}</Text>
            <PrimaryButton
              label={t('trip.backToTrip')}
              onPress={() => navigation.navigate('ActiveTrip', { tripId })}
            />
          </>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={otpVerificationLabels.dropOtpTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <InlineErrorBanner
              message={error}
              onRetry={handleRefresh}
              retryLabel={t('trip.refresh')}
            />
          ) : null}
          {renderBody()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.containerPadding,
  },
  center: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxl,
  },
  badge: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  label: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  otpInput: {
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
  },
  failBox: {
    gap: spacing.gutter,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  reasonInput: {
    ...typography.bodyMd,
    color: colors.onSurface,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    padding: spacing.gutter,
    textAlignVertical: 'top',
  },
});

export default DropOTPScreen;
