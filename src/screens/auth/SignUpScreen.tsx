import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Button from '../../components/atoms/Button';
import InputField from '../../components/atoms/InputField';
import { KeyboardAwareScrollView } from '../../components/organisms';
import {
  sendPhoneOTP,
  signInWithGoogle,
  formatToE164,
  mapFirebaseAuthError,
  getRemainingCooldown,
  hasActiveSession,
  usePhoneCooldown,
} from '../../auth/authService';

const logoImage = require('../../../assets/images/assets_logo.png');

export interface SignUpScreenProps {
  readonly navigation?: any;
}

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Phone validation
  const cleanPhone = phone.replace(/\D/g, '');
  const isValidPhone = cleanPhone.length === 10;
  const { cooldownRemaining, isCoolingDown } = usePhoneCooldown(isValidPhone ? cleanPhone : '');
  const isGetOtpDisabled = !isValidPhone || loading || isCoolingDown || cooldownRemaining > 0;

  const busy = loading || socialLoading !== null;

  // Phone OTP Sign-Up
  const handleGetOtp = useCallback(async () => {
    if (isSubmittingRef.current || busy || isCoolingDown || cooldownRemaining > 0) return;
    if (!isValidPhone) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    const fullPhone = formatToE164(cleanPhone);
    const remaining = getRemainingCooldown(fullPhone);

    if (remaining > 0 && hasActiveSession(fullPhone)) {
      console.log(`[AUTH] Active session exists within cooldown (${remaining}s remaining), navigating to OTP screen`);
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'signup' });
      return;
    }

    if (remaining > 0) {
      console.log(`[AUTH] Request blocked by cooldown (${remaining}s remaining)`);
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      await sendPhoneOTP(fullPhone);
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'signup' });
    } catch (e: any) {
      setError(mapFirebaseAuthError(e));
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }, [cleanPhone, isValidPhone, busy, isCoolingDown, cooldownRemaining, navigation]);

  // Google Sign-In
  const handleGoogleSignIn = useCallback(async () => {
    if (busy) return;
    setSocialLoading('google');
    setError(null);

    try {
      await signInWithGoogle();
      // Auth state listener handles session
    } catch (e: any) {
      if (e?.code !== 'auth/cancelled') {
        setError(mapFirebaseAuthError(e));
      }
    } finally {
      setSocialLoading(null);
    }
  }, [busy]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. MultipleRide Logo & Create Account Header */}
        <View style={styles.heroSection}>
          <View style={styles.logoContainer}>
            <View style={styles.logoInner}>
              <Image
                source={logoImage}
                style={styles.logoImage}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel="MultipleRide App Logo"
              />
            </View>
          </View>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Sign up to start booking rides and package deliveries</Text>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Feather name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* 3. Mobile Number Field & Get OTP Button */}
        <View style={styles.formSection}>
          <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
          <View style={styles.phoneRow}>
            <View style={styles.countryCode}>
              <Text style={styles.countryCodeText}>+91</Text>
            </View>
            <View style={styles.phoneInputWrapper}>
              <InputField
                placeholder="Enter 10-digit number"
                value={phone}
                onChangeText={(t) => {
                  setPhone(t);
                  if (error) setError(null);
                }}
                keyboardType="phone-pad"
                maxLength={10}
                editable={!busy}
              />
            </View>
          </View>

          {isValidPhone && cooldownRemaining > 0 && (
            <View style={styles.cooldownContainer}>
              <Text style={styles.cooldownText}>
                Request a new OTP in {cooldownRemaining} {cooldownRemaining === 1 ? 'second' : 'seconds'}
              </Text>
            </View>
          )}

          <Button
            label={loading ? 'Sending OTP...' : 'Get OTP'}
            onPress={handleGetOtp}
            variant="primary"
            size="lg"
            fullWidth
            disabled={isGetOtpDisabled}
            loading={loading}
            style={styles.submitButton}
          />
        </View>

        {/* 4. Social Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* 5. Social Sign-In: Continue with Google Only */}
        <View style={styles.socialButtonsContainer}>
          <Pressable
            style={[styles.socialButton, busy && styles.buttonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            {socialLoading === 'google' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Text style={styles.socialIconText}>G</Text>
                <Text style={styles.socialButtonText}>Continue with Google</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* 6. Switch to Log In */}
        <View style={styles.switchRow}>
          <Text style={styles.switchPrompt}>
            Already have an account?{' '}
            <Text
              style={styles.switchLink}
              onPress={() => {
                navigation?.navigate('LoginScreen');
              }}
            >
              Log In
            </Text>
          </Text>
        </View>

        {/* 7. Terms & Privacy Policy Footer */}
        <Text style={styles.termsText}>
          By signing up, you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>.
        </Text>
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
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  logoInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 44,
    height: 44,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    flex: 1,
  },
  formSection: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countryCode: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineHairline,
  },
  countryCodeText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  phoneInputWrapper: {
    flex: 1,
  },
  cooldownContainer: {
    marginVertical: spacing.xs,
    alignItems: 'center',
  },
  cooldownText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: spacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineHairline,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
  },
  socialButtonsContainer: {
    marginBottom: spacing.xl,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  socialIconText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
  },
  socialButtonText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  switchPrompt: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
  },
  switchLink: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  termsText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});

export default SignUpScreen;
