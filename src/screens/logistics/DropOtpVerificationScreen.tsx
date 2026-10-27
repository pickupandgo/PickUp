import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { mockActiveTrip } from '../../data/mockData';
import { KeyboardAwareScrollView } from '../../components/organisms';

export interface DropOtpVerificationScreenProps {
  readonly onBack?: () => void;
  readonly onVerify?: (otp: string) => void;
  readonly onResend?: () => void;
}

const DropOtpVerificationScreen: React.FC<DropOtpVerificationScreenProps & { navigation?: any }> = ({
  onBack,
  onVerify,
  onResend,
  navigation,
}) => {
  const [otp, setOtp] = useState(['', '', '', '']);
  const inputs = useRef<Array<TextInput | null>>([]);
  const dropDetails = mockActiveTrip.stops[1]; // assuming index 1 is Drop 1

  const handleOtpChange = (value: string, index: number) => {
    const cleanDigits = value.replace(/[^0-9]/g, '');

    // Case 1: Cleared/backspace
    if (cleanDigits.length === 0) {
      const newOtp = [...otp];
      newOtp[index] = '';
      setOtp(newOtp);
      return;
    }

    const prevDigit = otp[index];
    const isTypingOverSingle =
      prevDigit &&
      cleanDigits.length === 2 &&
      (cleanDigits.startsWith(prevDigit) || cleanDigits.endsWith(prevDigit));

    // Case 2: Multi-digit paste (4 digits)
    if (cleanDigits.length > 1 && !isTypingOverSingle) {
      let digitsToDistribute = cleanDigits;
      if (prevDigit && digitsToDistribute.length > 4) {
        if (digitsToDistribute.startsWith(prevDigit)) {
          digitsToDistribute = digitsToDistribute.slice(1, 5);
        } else if (digitsToDistribute.endsWith(prevDigit)) {
          digitsToDistribute = digitsToDistribute.slice(0, 4);
        }
      }
      digitsToDistribute = digitsToDistribute.slice(0, 4);

      const digits = digitsToDistribute.split('');
      const newOtp = [...otp];
      const startIdx = digits.length >= 4 || index === 0 ? 0 : index;
      for (let i = 0; i < digits.length && startIdx + i < 4; i++) {
        newOtp[startIdx + i] = digits[i];
      }
      setOtp(newOtp);

      const targetFocus = Math.min(3, startIdx + digits.length - 1);
      inputs.current[targetFocus]?.focus();
      return;
    }

    // Case 3: Overwriting existing single digit
    if (isTypingOverSingle) {
      const newChar = cleanDigits.startsWith(prevDigit) ? cleanDigits[1] : cleanDigits[0];
      const newOtp = [...otp];
      newOtp[index] = newChar;
      setOtp(newOtp);
      if (index < 3) {
        inputs.current[index + 1]?.focus();
      }
      return;
    }

    // Case 4: Normal single digit
    const newOtp = [...otp];
    newOtp[index] = cleanDigits[0];
    setOtp(newOtp);

    if (index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const isOtpComplete = otp.every((val) => val.length === 1);

  const handleResend = () => {
    onResend?.();
    setOtp(['', '', '', '']);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Delivery Verification</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation?.navigate('ShareTrackingSheetScreen')}
          accessibilityRole="button"
        >
          <Feather name="more-vertical" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Drop Context Card */}
          <View style={styles.contextCard}>
            <View style={styles.watermarkIcon}>
              <Feather name="package" size={64} color={colors.outlineVariant} style={{ opacity: 0.1 }} />
            </View>
            
            <View style={styles.dropBadge}>
              <Text style={styles.dropBadgeText}>Drop 1 of 3</Text>
            </View>
            
            <View>
              <Text style={styles.dropAddress}>{dropDetails?.address || 'Delivery Location'}</Text>
              <View style={styles.contactRow}>
                <Feather name="user" size={16} color={colors.onSurfaceVariant} />
                <Text style={styles.contactText}>{dropDetails?.contactName || 'Receiver'}</Text>
              </View>
            </View>
          </View>

          {/* OTP Section */}
          <View style={styles.otpSection}>
            <Text style={styles.otpTitle}>Delivery OTP</Text>
            <Text style={styles.otpSubtitle}>
              Please share this 4-digit code with the driver to confirm your delivery handover.
            </Text>

            <View style={styles.otpInputContainer}>
              {otp.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={(ref) => { inputs.current[index] = ref; }}
                  style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
                  value={digit}
                  onChangeText={(val) => handleOtpChange(val, index)}
                  onKeyPress={(e) => handleKeyPress(e, index)}
                  keyboardType="number-pad"
                  maxLength={8}
                  selectTextOnFocus
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                />
              ))}
            </View>
          </View>
        </View>

        <View style={{ flexGrow: 1, minHeight: spacing.xl }} />

        {/* Actions */}
        <View style={styles.actionContainer}>
          <Pressable
            style={[
              styles.verifyButton,
              isOtpComplete ? styles.verifyButtonActive : styles.verifyButtonInactive,
            ]}
            onPress={() => {
              if (isOtpComplete) {
                onVerify?.(otp.join(''));
                navigation?.navigate('DropCompletedStateScreen');
              }
            }}
            disabled={!isOtpComplete}
            accessibilityRole="button"
          >
            <Text style={styles.verifyButtonText}>VERIFY DELIVERY OTP</Text>
          </Pressable>

          <Pressable style={styles.resendButton} onPress={handleResend} accessibilityRole="button">
            <Text style={styles.resendButtonText}>Resend OTP</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  content: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
  },

  // Context Card
  contextCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
    marginBottom: spacing.xxl,
    overflow: 'hidden',
    position: 'relative',
  },
  watermarkIcon: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  dropBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  dropBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  dropAddress: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  contactText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // OTP Section
  otpSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  otpTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
  },
  otpSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: spacing.xl,
  },
  otpInputContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    width: '100%',
  },
  otpInput: {
    width: 56,
    height: 64,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 16,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '600',
    color: colors.onSurface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  otpInputFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },

  // Actions
  actionContainer: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xl,
  },
  verifyButton: {
    width: '100%',
    height: 56,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  verifyButtonActive: {
    backgroundColor: colors.primary,
  },
  verifyButtonInactive: {
    backgroundColor: colors.primaryContainer,
  },
  verifyButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  resendButton: {
    alignItems: 'center',
  },
  resendButtonText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.secondary,
    fontFamily: typography.bodyMd.fontFamily,
    textDecorationLine: 'underline',
  },
});

export default DropOtpVerificationScreen;
