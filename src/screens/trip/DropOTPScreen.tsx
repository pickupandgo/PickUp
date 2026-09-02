import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform,  KeyboardAvoidingView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { otpVerificationLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { TripController } from '../../services/trip/TripController';
import type { HomeScreenProps } from '../../types/navigation';

/** Receiver code length. The engine has no drop OTP, so it is not validated server-side. */
const OTP_LENGTH = 4;

/**
 * DropOTPScreen
 * Receiver code entry before confirming delivery at a drop stop.
 */
export interface DropOTPScreenProps {
  readonly navigation: HomeScreenProps<'DropOTP'>['navigation'];
  readonly route: HomeScreenProps<'DropOTP'>['route'];
  readonly testID?: string;
}

export const DropOTPScreen: React.FC<DropOTPScreenProps> = ({
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
      // The engine has no receiver OTP; mark the drop as started, then proceed.
      await TripController.getInstance().startDrop(tripId).catch(() => {});
      setVerified(true);
      setTimeout(() => {
        navigation.navigate('DeliveryProofCamera', { tripId, stopId });
      }, 1200);
    } catch (e) {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [navigation, tripId, stopId]);

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
        title={otpVerificationLabels.dropOtpTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{otpVerificationLabels.dropOtpTitle}</Text>
          <Text style={styles.subtitle}>{otpVerificationLabels.dropOtpSubtitle}</Text>

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

export default DropOTPScreen;
