import React, { useState, useRef, useEffect } from 'react';
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
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

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
  phoneNumber = '+91 98765 43210',
  timerSeconds = 30,
  onVerify,
  onResend,
  onChangeNumber,
  onBack,
  isLoading = false,
  error = null,
  isExpired = false,
  navigation,
}) => {
  const [otp, setOtp] = useState(['', '', '', '']);
  const [remaining, setRemaining] = useState(timerSeconds);
  const inputRefs = useRef<Array<TextInput | null>>([null, null, null, null]);

  // Live countdown for the "Resend OTP" link.
  useEffect(() => {
    if (remaining <= 0) {
      return;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [remaining]);

  const handleResend = () => {
    onResend?.();
    setRemaining(timerSeconds);
  };

  const handleOtpChange = (text: string, index: number) => {
    // Only allow numbers
    const cleanText = text.replace(/[^0-9]/g, '');
    
    if (cleanText.length > 0) {
      const newOtp = [...otp];
      newOtp[index] = cleanText[0];
      setOtp(newOtp);
      
      // Auto-advance
      if (index < 3) {
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

  const handleVerify = () => {
    onVerify?.(otp.join(''));
    navigation?.navigate('PermissionScreen');
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
        <Text style={styles.headerTitle}>Pick Up</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Verify Mobile Number</Text>
          <Text style={styles.subtitle}>
            Enter the 4-digit code sent to{'\n'}
            <Text style={styles.phoneNumber}>{phoneNumber}</Text>
          </Text>
        </View>

        {/* OTP Input Section */}
        <View style={styles.inputSection}>
          <View style={styles.otpContainer}>
            {[0, 1, 2, 3].map((index) => (
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
                editable={!isLoading && !isExpired}
              />
            ))}
          </View>
          
          {error && !isExpired && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {isExpired && (
            <View style={styles.expiredContainer}>
              <MaterialIcons name="timer" size={16} color={colors.onSurfaceVariant} />
              <Text style={styles.expiredText}>Code has expired. Request a new one.</Text>
            </View>
          )}

          <View style={styles.linksContainer}>
            <Pressable onPress={handleResend} disabled={remaining > 0}>
              <Text style={[styles.resendLink, remaining > 0 && styles.resendDisabled]}>
                Resend OTP ({formatTimer(remaining)})
              </Text>
            </Pressable>
            <Pressable onPress={() => (onChangeNumber ? onChangeNumber() : navigation?.goBack())}>
              <Text style={styles.changeLink}>Change Number</Text>
            </Pressable>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label={isLoading ? 'VERIFYING...' : 'VERIFY'}
            onPress={handleVerify}
            variant="primary"
            fullWidth
            size="lg"
            disabled={otp.join('').length < 4 || isLoading}
            icon={isLoading ? <MaterialIcons name="loop" size={20} color={colors.onSurfaceVariant} /> : undefined}
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
    width: 56,
    height: 64,
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
