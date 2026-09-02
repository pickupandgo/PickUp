import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform,  KeyboardAvoidingView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { otpVerificationLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { TripController } from '../../services/trip/TripController';
import type { HomeScreenProps } from '../../types/navigation';

/** Engine ride OTP length. */
const OTP_LENGTH = 4;

/**
 * PickupOTPScreen
 * Sender OTP verification before goods pickup.
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
  const [otp, setOtp] = useState('');
  const [hasError, setHasError] = useState(false);
  const [verified, setVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerify = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      // Verifies the sender OTP against the engine and moves the trip to in-transit.
      await TripController.getInstance().verifyPickupOTP(tripId, otp);
      setVerified(true);
      setTimeout(() => {
        // Pickup done — go to the active trip (now in the drop phase),
        // popping the arrived/OTP screens so we don't loop back to them.
        navigation.navigate('ActiveTrip', { tripId });
      }, 1500);
    } catch (e) {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [otp, tripId, navigation]);

  const handleComplete = useCallback(async (value: string) => {
    setOtp(value);
  }, []);

  if (verified) {
    return (
      <SafeAreaView style={styles.safeArea} testID={testID}>
        <View style={styles.feedbackContainer}>
          <View style={styles.successIcon}>
            <Icon name="check_circle" style={styles.successIconText} />
          </View>
          <Text style={styles.feedbackTitle}>{otpVerificationLabels.successTitle}</Text>
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{otpVerificationLabels.pickupOtpTitle}</Text>
          <Text style={styles.subtitle}>{otpVerificationLabels.pickupOtpSubtitle}</Text>

          <OTPInput
            length={OTP_LENGTH}
            value={otp}
            onChange={setOtp}
            onComplete={handleComplete}
            hasError={hasError}
            style={styles.otpInput}
          />

          {hasError ? (
            <Text style={styles.errorText}>{otpVerificationLabels.errorSubtitle}</Text>
          ) : null}
        </View>

        <PrimaryButton
          label={otpVerificationLabels.verifyLabel}
          onPress={handleVerify}
          disabled={otp.length < OTP_LENGTH}
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
    flex: 1,
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
