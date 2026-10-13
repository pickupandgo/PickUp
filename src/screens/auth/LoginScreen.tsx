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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Button from '../../components/atoms/Button';
import InputField from '../../components/atoms/InputField';
import {
  sendPhoneOTP,
  signInWithEmail,
  sendPasswordReset,
  signInWithGoogle,
  signInWithApple,
  formatToE164,
  mapFirebaseAuthError,
  getRemainingCooldown,
  hasActiveSession,
  usePhoneCooldown,
} from '../../auth/authService';

export interface LoginScreenProps {
  readonly onGetOtp?: (phone: string) => void;
  readonly navigation?: any;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onGetOtp, navigation }) => {
  const [authMethod, setAuthMethod] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
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

  // Phone OTP Login
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
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'login' });
      return;
    }

    if (remaining > 0) {
      console.log(`[AUTH] Request blocked by cooldown (${remaining}s remaining)`);
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError(null);
    setResetMessage(null);

    try {
      await sendPhoneOTP(fullPhone);
      onGetOtp?.(fullPhone);
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'login' });
    } catch (e: any) {
      setError(mapFirebaseAuthError(e));
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }, [cleanPhone, isValidPhone, busy, isCoolingDown, cooldownRemaining, onGetOtp, navigation]);

  // Email Login
  const handleEmailLogin = useCallback(async () => {
    if (isSubmittingRef.current || busy) return;
    if (!isValidEmail) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError(null);
    setResetMessage(null);

    try {
      await signInWithEmail(email, password);
      // Auth state listener handles session and transition to main
    } catch (e: any) {
      setError(mapFirebaseAuthError(e));
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  }, [busy, isValidEmail, email, password]);

  // Forgot Password
  const handleForgotPassword = useCallback(async () => {
    if (!isValidEmail) {
      setError('Please enter your registered email address above first.');
      return;
    }

    setLoading(true);
    setError(null);
    setResetMessage(null);

    try {
      await sendPasswordReset(email);
      setResetMessage(`Password reset link sent to ${email.trim()}. Please check your inbox.`);
    } catch (e: any) {
      setError(mapFirebaseAuthError(e));
    } finally {
      setLoading(false);
    }
  }, [isValidEmail, email]);

  // Google Sign-In
  const handleGoogleSignIn = useCallback(async () => {
    if (busy) return;
    setSocialLoading('google');
    setError(null);
    setResetMessage(null);

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
    setResetMessage(null);

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
          {/* Logo & Header */}
          <View style={styles.heroSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoInner}>
                <Text style={styles.logoIcon}>📦</Text>
              </View>
            </View>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Log in to book rides and track deliveries</Text>
          </View>

          {/* Flow Mode Switcher: Log In vs Sign Up */}
          <View style={styles.entryModeContainer}>
            <View style={[styles.entryModeTab, styles.entryModeActive]}>
              <Text style={styles.entryModeActiveText}>Log In</Text>
            </View>
            <Pressable
              style={styles.entryModeTab}
              onPress={() => navigation?.navigate('SignUpScreen')}
              hitSlop={8}
            >
              <Text style={styles.entryModeInactiveText}>Sign Up</Text>
            </Pressable>
          </View>

          {/* Auth Method Tabs */}
          <View style={styles.tabContainer}>
            <Pressable
              style={[styles.tab, authMethod === 'phone' && styles.activeTab]}
              onPress={() => {
                setAuthMethod('phone');
                setError(null);
                setResetMessage(null);
              }}
            >
              <Text style={[styles.tabText, authMethod === 'phone' && styles.activeTabText]}>
                Mobile OTP
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, authMethod === 'email' && styles.activeTab]}
              onPress={() => {
                setAuthMethod('email');
                setError(null);
                setResetMessage(null);
              }}
            >
              <Text style={[styles.tabText, authMethod === 'email' && styles.activeTabText]}>
                Email & Password
              </Text>
            </Pressable>
          </View>

          {resetMessage && (
            <View style={styles.successContainer}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={styles.successText}>{resetMessage}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorContainer}>
              <Feather name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Phone Form */}
          {authMethod === 'phone' ? (
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
          ) : (
            /* Email Form */
            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
              <View style={styles.inputWrapper}>
                <InputField
                  placeholder="name@example.com"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (error) setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!busy}
                />
              </View>

              <View style={styles.passwordHeaderRow}>
                <Text style={styles.inputLabel}>PASSWORD</Text>
                <Pressable onPress={handleForgotPassword} hitSlop={8}>
                  <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                </Pressable>
              </View>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (error) setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!busy}
                  onSubmitEditing={handleEmailLogin}
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
                label={loading ? 'Logging In...' : 'Log In with Email'}
                onPress={handleEmailLogin}
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
            <Text style={styles.dividerText}>Or continue with</Text>
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
                  <Text style={styles.socialButtonText}>Continue with Google</Text>
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
                  <Text style={styles.socialButtonText}>Continue with Apple</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Switch to Sign Up */}
          <View style={styles.switchRow}>
            <Text style={styles.switchPrompt}>
              Don't have an account?{' '}
              <Text
                style={styles.switchLink}
                onPress={() => {
                  navigation?.navigate('SignUpScreen');
                }}
              >
                Sign Up
              </Text>
            </Text>
          </View>

          {/* Terms Footer */}
          <Text style={styles.termsText}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
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
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  successText: {
    fontSize: typography.labelSm.fontSize,
    color: '#166534',
    flex: 1,
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
  passwordHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  forgotPasswordText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontWeight: '600',
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

export default LoginScreen;
