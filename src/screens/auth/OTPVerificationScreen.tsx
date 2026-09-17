import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { authData } from '../../data/mockData';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { AppHeader } from '../../components/molecules/AppHeader';
import type { AuthScreenProps } from '../../types/navigation';

export interface OTPVerificationScreenProps {
  readonly navigation: AuthScreenProps<'OTPVerification'>['navigation'];
  readonly route: AuthScreenProps<'OTPVerification'>['route'];
  readonly onVerifyOtp: (otp: string) => Promise<boolean>;
  readonly onResendOtp: () => Promise<void>;
  readonly isLoading?: boolean;
  readonly error?: string | null;
  readonly testID?: string;
}

export const OTPVerificationScreen: React.FC<OTPVerificationScreenProps> = ({
  navigation,
  route,
  onVerifyOtp,
  onResendOtp,
  isLoading = false,
  error = null,
  testID,
}) => {
  const [otp, setOtp] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState<number>(authData.resendTimerSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { phone } = route.params;

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleOtpComplete = useCallback(async (value: string) => {
    if (isVerifying) return;
    
    console.log(`[OTP DEBUG] OTP value entered (length: ${value.length})`);
    setHasError(false);
    setIsVerifying(true);
    console.log(`[OTP DEBUG] verification started`);
    
    try {
      const success = await onVerifyOtp(value);
      console.log(`[OTP DEBUG] useAuth verification returned: ${success}`);
      if (!success) {
        setHasError(true);
      }
    } finally {
      setIsVerifying(false);
    }
  }, [onVerifyOtp, isVerifying]);

  const handleVerify = useCallback(async () => {
    console.log(`[OTP DEBUG] VERIFY pressed`);
    if (otp.length < 6) return;
    await handleOtpComplete(otp);
  }, [otp, handleOtpComplete]);

  const handleResend = useCallback(async () => {
    await onResendOtp();
    setResendTimer(authData.resendTimerSeconds);
    timerRef.current = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [onResendOtp]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title=""
        onBackPress={() => navigation.goBack()}
        showBackButton
        showDivider={false}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{authData.otpTitle}</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to {phone}
          </Text>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.changeNumber}>Change Number</Text>
          </Pressable>

          <OTPInput
            value={otp}
            onChange={setOtp}
            onComplete={handleOtpComplete}
            hasError={hasError}
            style={styles.otpInput}
          />

          {hasError || error ? (
            <Text style={styles.errorText}>{error || 'Invalid OTP. Please try again.'}</Text>
          ) : null}

          {/* Resend */}
          <View style={styles.resendContainer}>
            {resendTimer > 0 ? (
              <Text style={styles.resendTimer}>
                {authData.resendText} in {resendTimer}s
              </Text>
            ) : (
              <Pressable
                onPress={handleResend}
                accessibilityRole="button"
                accessibilityLabel={authData.resendText}
              >
                <Text style={styles.resendLink}>{authData.resendText}</Text>
              </Pressable>
            )}
          </View>
        </View>

        <PrimaryButton
          label="VERIFY"
          onPress={handleVerify}
          disabled={otp.length < 6}
          loading={isLoading || isVerifying}
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
    gap: spacing.xs,
    paddingTop: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  changeNumber: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
    marginTop: spacing.unit,
  },
  otpInput: {
    marginTop: spacing.xl,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  resendTimer: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  resendLink: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '600',
  },
  verifyButton: {
    marginBottom: spacing.lg,
  },
});

export default OTPVerificationScreen;
