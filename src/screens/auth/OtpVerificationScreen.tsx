import React, { useState, useRef, useEffect } from 'react';
import {
  verifyOTP,
  sendPhoneOTP,
  mapFirebaseAuthError,
  RESEND_COOLDOWN_SECONDS,
  usePhoneCooldown,
  getActivePhoneNumber,
  setActivePhoneNumber,
} from '../../auth/authService';
import { clearProfileComplete } from '../../state/session';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Button from '../../components/atoms/Button';
import { useI18n } from '../../i18n';

export interface OtpVerificationScreenProps {
  readonly phoneNumber?: string;
  readonly timerSeconds?: number;
  readonly onVerify?: (otp: string) => void;
  readonly onResend?: () => void;
  readonly onChangeNumber?: () => void;
  readonly onBack?: () => void;
  readonly isLoading?: boolean;
  readonly error?: string | null;
  readonly isExpired?: boolean;
}

const OtpVerificationScreen: React.FC<OtpVerificationScreenProps & { navigation?: any }> = ({
  phoneNumber,
  timerSeconds = RESEND_COOLDOWN_SECONDS,
  onVerify,
  onResend,
  onChangeNumber,
  onBack,
  isLoading = false,
  error = null,
  isExpired = false,
  navigation,
  route,
}: any) => {
  const { t } = useI18n();
  const actualPhoneNumber =
    route?.params?.phoneNumber ||
    phoneNumber ||
    getActivePhoneNumber() ||
    '';
  const authMode = route?.params?.authMode || 'login';
  const isSignUp = authMode === 'signup';
  const { cooldownRemaining, isCoolingDown } = usePhoneCooldown(actualPhoneNumber);

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resendExpired, setResendExpired] = useState(false);
  const inputRefs = useRef<Array<TextInput | null>>([null, null, null, null, null, null]);
  const isResendingRef = useRef(false);
  const isVerifyingRef = useRef(false);

  const handleResend = async () => {
    if (cooldownRemaining > 0 || isCoolingDown || isResending || isResendingRef.current) {
      console.log('[AUTH] Resend blocked by cooldown');
      return;
    }

    console.log('[AUTH] Resend pressed');
    isResendingRef.current = true;
    setIsResending(true);
    setVerifyError(null);
    setSuccessMessage(null);

    try {
      await sendPhoneOTP(actualPhoneNumber, true);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setSuccessMessage(t('otp.codeRequestedSuccess'));
      setResendExpired(false);
      onResend?.();
    } catch (e: any) {
      setVerifyError(mapFirebaseAuthError(e));
    } finally {
      isResendingRef.current = false;
      setIsResending(false);
    }
  };

  const handleOtpChange = (text: string, index: number) => {
    // Only allow numbers
    const cleanText = text.replace(/[^0-9]/g, '');
    
    if (cleanText.length > 0) {
      const newOtp = [...otp];
      newOtp[index] = cleanText[0];
      setOtp(newOtp);
      
      // Auto-advance
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    } else {
      const newOtp = [...otp];
      newOtp[index] = '';
      setOtp(newOtp);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && otp[index] === '') {
      // Auto-focus previous on backspace if current is empty
      if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleVerify = async () => {
    const enteredOtp = otp.join('');
    if (enteredOtp.length < 6 || isVerifying || isVerifyingRef.current || isLoading) return;

    if (!actualPhoneNumber) {
      setVerifyError(t('otp.missingPhone'));
      return;
    }

    isVerifyingRef.current = true;
    try {
      setIsVerifying(true);
      setVerifyError(null);
      setSuccessMessage(null);
      if (isSignUp) {
        await clearProfileComplete();
      }
      await verifyOTP(enteredOtp, actualPhoneNumber);
      setActivePhoneNumber(actualPhoneNumber);
      onVerify?.(enteredOtp);
      // Navigation is handled by SessionContext onAuthStateChanged automatically updating root navigator
    } catch (e: any) {
      setVerifyError(mapFirebaseAuthError(e));
      if (e?.code === 'auth/code-expired' || e?.code === 'auth/session-expired') {
        setResendExpired(true);
      }
    } finally {
      isVerifyingRef.current = false;
      setIsVerifying(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Navigation */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('home.appName')}</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>
            {isSignUp ? t('otp.verifyForSignUp') : t('otp.verifyMobileNumber')}
          </Text>
          <Text style={styles.subtitle}>
            {isSignUp
              ? t('otp.enterCodeSignUp')
              : t('otp.enterCodeSent')}{'\n'}
            <Text style={styles.phoneNumber}>{actualPhoneNumber}</Text>
          </Text>
        </View>

        {/* OTP Input Section */}
        <View style={styles.inputSection}>
          <View style={styles.otpContainer}>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <TextInput
                key={index}
                ref={(ref) => { inputRefs.current[index] = ref; }}
                style={[
                  styles.otpInput,
                  error ? styles.otpInputError : null,
                  isExpired ? styles.otpInputExpired : null,
                ]}
                value={otp[index]}
                onChangeText={(text) => handleOtpChange(text, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                placeholder="-"
                placeholderTextColor={colors.onSurfaceVariant}
                editable={!isLoading && !isExpired && !isResending}
              />
            ))}
          </View>
          
          {successMessage && !verifyError && (
            <Text style={styles.successText}>{successMessage}</Text>
          )}

          {(error || verifyError) && !isExpired && !resendExpired && (
            <Text style={styles.errorText}>{error || verifyError}</Text>
          )}

          {(isExpired || resendExpired) && (
            <View style={styles.expiredContainer}>
              <MaterialIcons name="timer" size={16} color={colors.onSurfaceVariant} />
              <Text style={styles.expiredText}>{t('otp.codeExpired')}</Text>
            </View>
          )}

          <View style={styles.linksContainer}>
            <Pressable onPress={handleResend} disabled={cooldownRemaining > 0 || isResending}>
              <Text style={[styles.resendLink, (cooldownRemaining > 0 || isResending) && styles.resendDisabled]}>
                {isResending
                  ? t('otp.requestingNewCode')
                  : cooldownRemaining > 0
                  ? t('otp.resendWithTimer', { time: formatTimer(cooldownRemaining) })
                  : t('otp.resendOtp')}
              </Text>
            </Pressable>
            <Pressable onPress={() => (onChangeNumber ? onChangeNumber() : navigation?.goBack())}>
              <Text style={styles.changeLink}>{t('otp.changeNumber')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label={isVerifying || isLoading ? t('otp.verifying') : t('otp.verifyButton')}
            onPress={handleVerify}
            variant="primary"
            fullWidth
            size="lg"
            disabled={otp.join('').length < 6 || isLoading || isVerifying}
            icon={(isLoading || isVerifying) ? <MaterialIcons name="loop" size={20} color={colors.onSurfaceVariant} /> : undefined}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xxxl * 2, // mt-24 approx
    paddingBottom: spacing.xxxl,
    alignItems: 'center',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    lineHeight: 20,
  },
  phoneNumber: {
    fontWeight: '600',
    color: colors.onSurface,
  },
  inputSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  otpInput: {
    width: 48,
    height: 56,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    ...shadows.card,
  },
  otpInputError: {
    backgroundColor: colors.errorContainer,
    color: colors.error,
    borderWidth: 1,
    borderColor: colors.error,
  },
  otpInputExpired: {
    backgroundColor: colors.surfaceVariant,
    color: colors.onSurfaceVariant,
    opacity: 0.5,
  },
  errorText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  successText: {
    fontSize: typography.labelSm.fontSize,
    color: (colors as any).success || '#10B981',
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  expiredContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  expiredText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  linksContainer: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  resendLink: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  resendDisabled: {
    color: colors.onSurfaceVariant,
  },
  changeLink: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textDecorationLine: 'underline',
  },
  actionsContainer: {
    width: '100%',
    maxWidth: 400,
  },
});

export default OtpVerificationScreen;
