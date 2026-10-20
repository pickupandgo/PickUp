import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { authData } from '../../data/mockData';
import { AuthService, RESEND_COOLDOWN_SECONDS, usePhoneCooldown } from '../../services/auth/AuthService';
import { clearOnboardingComplete } from '../../state/onboarding';
import { OTPInput } from '../../components/atoms/OTPInput';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
  const { phone, authMode = 'login' } = route.params;
  const isSignUp = authMode === 'signup';
  const { cooldownRemaining, isCoolingDown } = usePhoneCooldown(phone);

  const [otp, setOtp] = useState('');
  const [hasError, setHasError] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const isResendingRef = useRef(false);
  const isVerifyingRef = useRef(false);

  const handleOtpComplete = useCallback(async (value: string) => {
    if (isVerifyingRef.current || isVerifying || isLoading) return;
    
    isVerifyingRef.current = true;
    setHasError(false);
    setLocalError(null);
    setSuccessMessage(null);
    setIsVerifying(true);
    
    try {
      if (isSignUp) {
        await clearOnboardingComplete();
      }
      const success = await onVerifyOtp(value);
      if (!success) {
        setHasError(true);
      } else {
        if (isSignUp && route.params?.driverData) {
          try {
            await AuthService.getInstance().registerDriver({
              phone,
              name: route.params.driverData.name || '',
              email: route.params.driverData.email,
              vehicleMake: route.params.driverData.vehicleMake,
              licensePlate: route.params.driverData.licensePlate,
            });
          } catch (regErr: any) {
            console.warn('[AUTH] Driver registration backend call:', regErr?.message);
          }
        }
        navigation.navigate('LanguageSelection');
      }
    } catch (e: any) {
      setHasError(true);
      setLocalError(e?.message || t('otp.invalidOtp'));
    } finally {
      isVerifyingRef.current = false;
      setIsVerifying(false);
    }
  }, [onVerifyOtp, isVerifying, isLoading, isSignUp, route.params, phone, navigation, t]);

  const handleVerify = useCallback(async () => {
    if (otp.length < 6 || isVerifying || isLoading) return;
    await handleOtpComplete(otp);
  }, [otp, handleOtpComplete, isVerifying, isLoading]);

  const handleResend = useCallback(async () => {
    console.log('[AUTH] Resend pressed');
    if (cooldownRemaining > 0 || isCoolingDown || isResending || isResendingRef.current) {
      console.log('[AUTH] Resend blocked by cooldown');
      return;
    }

    isResendingRef.current = true;
    setIsResending(true);
    setHasError(false);
    setLocalError(null);
    setSuccessMessage(null);

    try {
      await onResendOtp();
      setOtp('');
      setSuccessMessage(t('otp.codeRequested'));
    } catch (e: any) {
      setHasError(true);
      setLocalError(e?.message || t('otp.resendFailed'));
    } finally {
      isResendingRef.current = false;
      setIsResending(false);
    }
  }, [onResendOtp, cooldownRemaining, isCoolingDown, isResending, t]);

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
          <Text style={styles.title}>
            {isSignUp ? t('otp.signupTitle') : t('otp.loginTitle')}
          </Text>
          <Text style={styles.subtitle}>
            {isSignUp
              ? t('otp.signupSubtitle', { phone })
              : t('otp.loginSubtitle', { phone })}
          </Text>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.changeNumber}>{t('otp.changeNumber')}</Text>
          </Pressable>

          <OTPInput
            value={otp}
            onChange={setOtp}
            onComplete={handleOtpComplete}
            hasError={hasError}
            style={styles.otpInput}
          />

          {successMessage && !hasError && !error && !localError ? (
            <Text style={styles.successText}>{successMessage}</Text>
          ) : null}

          {hasError || error || localError ? (
            <Text style={styles.errorText}>{localError || error || t('otp.invalidOtp')}</Text>
          ) : null}

          {/* Resend */}
          <View style={styles.resendContainer}>
            {isResending ? (
              <Text style={styles.resendTimer}>{t('otp.requestingNewCode')}</Text>
            ) : cooldownRemaining > 0 ? (
              <Text style={styles.resendTimer}>
                {t('otp.resendIn', { seconds: cooldownRemaining })}
              </Text>
            ) : (
              <Pressable
                onPress={handleResend}
                disabled={cooldownRemaining > 0 || isResending}
                accessibilityRole="button"
                accessibilityLabel={t('otp.resendCode')}
              >
                <Text style={styles.resendLink}>{t('otp.resendCode')}</Text>
              </Pressable>
            )}
          </View>
        </View>

        <PrimaryButton
          label={t('otp.verify')}
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
  successText: {
    ...typography.bodyMd,
    color: colors.success || '#10B981',
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
