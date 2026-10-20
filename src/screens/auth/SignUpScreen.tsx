import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Button from '../../components/atoms/Button';
import InputField from '../../components/atoms/InputField';
import {
  sendPhoneOTP,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  formatToE164,
  mapFirebaseAuthError,
  getRemainingCooldown,
  hasActiveSession,
  usePhoneCooldown,
} from '../../auth/authService';
import { clearProfileComplete } from '../../state/session';
import { useI18n } from '../../i18n';

export interface SignUpScreenProps {
  readonly navigation?: any;
}

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
  const { t, locale } = useI18n();
  const [authMethod, setAuthMethod] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Phone validation
  const cleanPhone = phone.replace(/\D/g, '');
  const isValidPhone = cleanPhone.length === 10;
  const { cooldownRemaining, isCoolingDown } = usePhoneCooldown(isValidPhone ? cleanPhone : '');
  const isGetOtpDisabled = !isValidPhone || loading || isCoolingDown || cooldownRemaining > 0;

  // Email validation
  const isValidEmail = email.includes('@') && email.includes('.') && email.trim().length > 5;
  const isValidPassword = password.length >= 6;
  const isEmailFormValid = isValidEmail && isValidPassword;

  const busy = loading || socialLoading !== null;

  // Phone OTP Sign-Up
  const handleGetOtp = useCallback(async () => {
    if (isSubmittingRef.current || busy || isCoolingDown || cooldownRemaining > 0) return;
    if (!isValidPhone) {
      setError(t('auth.invalidPhone'));
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
  }, [cleanPhone, isValidPhone, busy, isCoolingDown, cooldownRemaining, navigation, t]);

  // Email Sign-Up
  const handleEmailSignUp = useCallback(async () => {
    if (isSubmittingRef.current || busy) return;
    if (!isValidEmail) {
      setError(t('auth.invalidEmail'));
      return;
    }
    if (!isValidPassword) {
      setError(t('auth.passwordMinLength'));
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      await clearProfileComplete();
      await signUpWithEmail(email, password);
      // Auth state listener handles session and navigation to profile
    } catch (e: any) {
      setError(mapFirebaseAuthError(e));
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }, [busy, isValidEmail, isValidPassword, email, password, t]);

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

  // Apple Sign-In
  const handleAppleSignIn = useCallback(async () => {
    if (busy) return;
    setSocialLoading('apple');
    setError(null);

    try {
      await signInWithApple();
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
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Language Switcher Pill */}
          <View style={styles.topBar}>
            <Pressable
              style={styles.langPill}
              onPress={() => navigation?.navigate('LanguageSelectionScreen')}
              hitSlop={8}
            >
              <Feather name="globe" size={14} color={colors.primary} />
              <Text style={styles.langPillText}>{locale === 'hi' ? 'हिन्दी' : 'English'}</Text>
            </Pressable>
          </View>

          {/* Logo & Header */}
          <View style={styles.heroSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoInner}>
                <Image
                  source={require('../../../assets/logo.png')}
                  style={{ width: 38, height: 38 }}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel="Multiple Ride Logo"
                />
              </View>
            </View>
            <Text style={styles.title}>{t('auth.createAccountTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.createAccountSub')}</Text>
          </View>

          {/* Flow Mode Switcher: Log In vs Sign Up */}
          <View style={styles.entryModeContainer}>
            <Pressable
              style={styles.entryModeTab}
              onPress={() => navigation?.navigate('LoginScreen')}
              hitSlop={8}
            >
              <Text style={styles.entryModeInactiveText}>{t('auth.loginTab')}</Text>
            </Pressable>
            <View style={[styles.entryModeTab, styles.entryModeActive]}>
              <Text style={styles.entryModeActiveText}>{t('auth.signupTab')}</Text>
            </View>
          </View>

          {/* Auth Method Tabs */}
          <View style={styles.tabContainer}>
            <Pressable
              style={[styles.tab, authMethod === 'phone' && styles.activeTab]}
              onPress={() => {
                setAuthMethod('phone');
                setError(null);
              }}
            >
              <Text style={[styles.tabText, authMethod === 'phone' && styles.activeTabText]}>
                {t('auth.mobileOtpTab')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, authMethod === 'email' && styles.activeTab]}
              onPress={() => {
                setAuthMethod('email');
                setError(null);
              }}
            >
              <Text style={[styles.tabText, authMethod === 'email' && styles.activeTabText]}>
                {t('auth.emailPasswordTab')}
              </Text>
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Feather name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Phone Form */}
          {authMethod === 'phone' ? (
            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>{t('auth.mobileNumber')}</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <View style={styles.phoneInputWrapper}>
                  <InputField
                    placeholder={t('auth.enterMobileNumber')}
                    value={phone}
                    onChangeText={(tVal) => {
                      setPhone(tVal);
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
                    {t('auth.cooldown', {
                      seconds: cooldownRemaining,
                      unit: cooldownRemaining === 1 ? t('auth.second') : t('auth.seconds'),
                    })}
                  </Text>
                </View>
              )}

              <Button
                label={loading ? t('auth.sendingOtp') : t('auth.getOtp')}
                onPress={handleGetOtp}
                variant="primary"
                size="lg"
                fullWidth
                disabled={isGetOtpDisabled}
                loading={loading}
                style={styles.submitButton}
              />
            </View>
          ) : (
            /* Email Form */
            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>{t('auth.emailAddress')}</Text>
              <View style={styles.inputWrapper}>
                <InputField
                  placeholder="name@example.com"
                  value={email}
                  onChangeText={(tVal) => {
                    setEmail(tVal);
                    if (error) setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!busy}
                />
              </View>

              <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>{t('auth.password')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder={t('auth.passwordMinPlaceholder')}
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={password}
                  onChangeText={(tVal) => {
                    setPassword(tVal);
                    if (error) setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!busy}
                />
                <Pressable
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={8}
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color={colors.onSurfaceVariant}
                  />
                </Pressable>
              </View>

              <Button
                label={loading ? t('auth.creatingAccount') : t('auth.signUpWithEmail')}
                onPress={handleEmailSignUp}
                variant="primary"
                size="lg"
                fullWidth
                disabled={!isEmailFormValid || busy}
                loading={loading}
                style={styles.submitButton}
              />
            </View>
          )}

          {/* Social Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('auth.orContinueWith')}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Sign-In Buttons */}
          <View style={styles.socialButtonsContainer}>
            <Pressable
              style={[styles.socialButton, busy && styles.buttonDisabled]}
              onPress={handleGoogleSignIn}
              disabled={busy}
            >
              {socialLoading === 'google' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Text style={styles.socialIconText}>G</Text>
                  <Text style={styles.socialButtonText}>{t('auth.continueWithGoogle')}</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[styles.socialButton, busy && styles.buttonDisabled]}
              onPress={handleAppleSignIn}
              disabled={busy}
            >
              {socialLoading === 'apple' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="shield" size={18} color={colors.onSurface} style={styles.socialIcon} />
                  <Text style={styles.socialButtonText}>{t('auth.continueWithApple')}</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Switch to Log In */}
          <View style={styles.switchRow}>
            <Text style={styles.switchPrompt}>
              {t('auth.alreadyHaveAccount')}
              <Text
                style={styles.switchLink}
                onPress={() => {
                  navigation?.navigate('LoginScreen');
                }}
              >
                {t('auth.loginTab')}
              </Text>
            </Text>
          </View>

          {/* Terms Footer */}
          <Text style={styles.termsText}>
            {t('auth.bySigningUp')}
            <Text style={styles.termsLink}>{t('auth.termsOfService')}</Text>
            {t('auth.termsAnd')}
            <Text style={styles.termsLink}>{t('auth.privacyPolicy')}</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
  },
  langPillText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  logoInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: {
    fontSize: 26,
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
  entryModeContainer: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerLow,
    padding: 3,
  },
  entryModeTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  entryModeActive: {
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  entryModeActiveText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontWeight: '700',
  },
  entryModeInactiveText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '500',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  activeTab: {
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  tabText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '700',
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
  inputWrapper: {
    marginBottom: spacing.xs,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  passwordInput: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  eyeIcon: {
    padding: spacing.xs,
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
    gap: spacing.sm,
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
  socialIcon: {
    marginRight: 2,
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
