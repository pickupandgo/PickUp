import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Keyboard,
} from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { otpVerificationLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { TripLoadNotice } from '../../components/molecules/TripLoadNotice';
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

/** Engine ride OTP length. */
const OTP_LENGTH = 4;

/** Statuses at or after a verified pickup. */
const VERIFIED: ReadonlySet<string> = new Set([
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
]);

/**
 * PickupOTPScreen
 * Sender OTP verification before goods pickup. The OTP can be entered only once the payment
 * backend allows the pickup handover (the engine checks the same gate before the OTP). It only
 * verifies the pickup: the trip is started separately on the pickup screen.
 */
export interface PickupOTPScreenProps {
  readonly navigation: HomeScreenProps<'PickupOTP'>['navigation'];
  readonly route: HomeScreenProps<'PickupOTP'>['route'];
  readonly testID?: string;
}

export const PickupOTPScreen: React.FC<PickupOTPScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { tripId, stopId } = route.params;
  const { t } = useI18n();
  const trip = useLiveTrip(tripId);
  const gate = usePaymentGate(trip);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const submitting = useRef(false);

  // Verified (by this screen, or found so after a timeout and a re-read): back to the pickup
  // screen, where the driver starts the trip.
  const verified = trip ? VERIFIED.has(engineStatusOf(trip)) : false;
  const allowed = gate.view.kind === 'mock' || pickupHandoverAllowed(gate.gate);

  const handleVerify = useCallback(async () => {
    if (submitting.current || !allowed || otp.length !== OTP_LENGTH) return;
    submitting.current = true;
    setIsLoading(true);
    setError(null);
    try {
      await TripController.getInstance().verifyPickupOTP(tripId, otp);
      Keyboard.dismiss();
    } catch (e) {
      setError(describeTripError(e, t));
      gate.refresh();
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  }, [otp, tripId, t, gate, allowed]);

  const handleComplete = useCallback(async (value: string) => {
    setOtp(value);
  }, []);

  if (!trip)
    return (
      <TripLoadNotice tripId={tripId} onHome={() => navigation.popToTop()} />
    );

  if (verified) {
    return (
      <SafeAreaView style={styles.safeArea} testID={testID}>
        <View style={styles.feedbackContainer}>
          <View style={styles.successIcon}>
            <Icon name="check_circle" style={styles.successIconText} />
          </View>
          <Text style={styles.feedbackTitle}>
            {otpVerificationLabels.successTitle}
          </Text>
          <PrimaryButton
            label="Continue"
            onPress={() => {
              if (engineStatusOf(trip) === 'PICKUP_VERIFIED')
                navigation.popTo('ArrivedAtPickup', { tripId, stopId });
              else navigation.popTo('ActiveTrip', { tripId });
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={otpVerificationLabels.pickupOtpTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.title}>
            {otpVerificationLabels.pickupOtpTitle}
          </Text>
          <Text style={styles.subtitle}>
            {otpVerificationLabels.pickupOtpSubtitle}
          </Text>

          {!allowed ? (
            <Text style={styles.lockedText} accessibilityLiveRegion="polite">
              {gate.view.kind === 'loading'
                ? t('trip.gateChecking')
                : t('trip.otpLocked')}
            </Text>
          ) : null}

          <OTPInput
            length={OTP_LENGTH}
            value={otp}
            onChange={setOtp}
            onComplete={handleComplete}
            disabled={isLoading || !allowed}
            hasError={error !== null}
            style={styles.otpInput}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <PrimaryButton
          label={otpVerificationLabels.verifyLabel}
          onPress={handleVerify}
          disabled={otp.length < OTP_LENGTH || !allowed || !trip || isLoading}
          loading={isLoading}
          style={styles.verifyButton}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.containerPadding,
    gap: spacing.containerPadding,
    paddingTop: spacing.lg,
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
  lockedText: {
    ...typography.bodyMd,
    color: colors.error,
  },
  otpInput: {
    marginTop: spacing.lg,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
    textAlign: 'center',
  },
  verifyButton: {
    marginBottom: spacing.lg,
  },
  feedbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.containerPadding,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconText: {
    fontSize: 40,
    color: '#2e7d32',
  },
  feedbackTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
});

export default PickupOTPScreen;
