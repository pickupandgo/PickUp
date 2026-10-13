import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import {
  formatToE164,
  mapFirebaseAuthError,
  AuthService,
  usePhoneCooldown,
} from '../../services/auth/AuthService';

export type AuthMode = 'login' | 'signup';

export interface UnifiedAuthScreenProps {
  readonly navigation: any;
  readonly initialMode?: AuthMode;
  readonly onSendOtp?: (phone: string) => Promise<void>;
  readonly onLoginWithEmail?: (email: string, password: string) => Promise<boolean>;
  readonly onSignUpWithEmail?: (email: string, password: string) => Promise<boolean>;
  readonly isLoading?: boolean;
  readonly error?: string | null;
  readonly testID?: string;
}

export const UnifiedAuthScreen: React.FC<UnifiedAuthScreenProps> = ({
  navigation,
  initialMode = 'login',
  onSendOtp,
  onLoginWithEmail,
  onSignUpWithEmail,
  isLoading = false,
  error = null,
  testID,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [phone, setPhone] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const cleanPhone = phone.replace(/\D/g, '');
  const isValidPhone = cleanPhone.length === 10;
  const { cooldownRemaining, isCoolingDown } = usePhoneCooldown(isValidPhone ? cleanPhone : '');

  const busy = isLoading || isSubmitting;
  const isGetOtpDisabled = !isValidPhone || busy || isCoolingDown || cooldownRemaining > 0;

  const isSignUp = authMode === 'signup';

  const handleSendPhoneOtp = useCallback(async () => {
    if (isSubmittingRef.current || busy || isCoolingDown || cooldownRemaining > 0) return;
    if (!isValidPhone) {
      setLocalError('Please enter a valid 10-digit mobile number.');
      return;
    }

    const formattedPhone = formatToE164(cleanPhone);
    const authService = AuthService.getInstance();
    const remaining = authService.getRemainingCooldown ? authService.getRemainingCooldown(formattedPhone) : 0;
    const hasSession = authService.hasActiveSession ? authService.hasActiveSession(formattedPhone) : false;

    if (remaining > 0 && hasSession) {
      console.log(`[AUTH] Active session exists within cooldown (${remaining}s remaining), navigating to OTP screen without duplicate SMS`);
      navigation?.navigate('OTPVerification', {
        phone: formattedPhone,
        authMode,
        intendedRole: 'driver',
      });
      return;
    }

    if (remaining > 0) {
      console.log(`[AUTH] Request blocked by cooldown (${remaining}s remaining)`);
      return;
    }

    isSubmittingRef.current = true;
    setLocalError(null);
    setIsSubmitting(true);

    try {
      if (onSendOtp) {
        await onSendOtp(formattedPhone);
      }
      navigation?.navigate('OTPVerification', {
        phone: formattedPhone,
        authMode,
        intendedRole: 'driver',
      });
    } catch (e: any) {
      setLocalError(e?.message || mapFirebaseAuthError(e));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [busy, isCoolingDown, cooldownRemaining, isValidPhone, cleanPhone, onSendOtp, navigation, authMode]);

  const activeError = localError || error;

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'bottom']}>
      {/* Top app bar */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.headerTitle}>Pick Up Driver</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mode Switch Tabs: Log In vs Sign Up */}
          <View style={styles.tabContainer}>
            <Pressable
              style={[styles.tab, !isSignUp && styles.activeTab]}
              onPress={() => {
                setAuthMode('login');
                setLocalError(null);
              }}
            >
              <Text style={[styles.tabText, !isSignUp && styles.activeTabText]}>Log In</Text>
            </Pressable>
            <Pressable
              style={[styles.tab, isSignUp && styles.activeTab]}
              onPress={() => {
                setAuthMode('signup');
                setLocalError(null);
              }}
            >
              <Text style={[styles.tabText, isSignUp && styles.activeTabText]}>Sign Up</Text>
            </Pressable>
          </View>

          {/* Hero / welcome */}
          <View style={styles.hero}>
            <Text style={styles.title}>
              {isSignUp ? 'Driver Sign Up' : 'Driver Log In'}
            </Text>
            <Text style={styles.subtitle}>
              {isSignUp
                ? 'Enter your mobile number to create your driver account and start accepting trips.'
                : 'Enter your mobile number to log in to your driver account.'}
            </Text>
          </View>

          {activeError ? <Text style={styles.serverError}>{activeError}</Text> : null}

          {/* Phone Number Input Form */}
          <View style={styles.formSection}>
            <View style={styles.field}>
              <Text style={styles.label}>MOBILE NUMBER</Text>
              <View style={styles.phoneInputRow}>
                <View style={styles.countryCodeBadge}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    if (localError) setLocalError(null);
                  }}
                  keyboardType="phone-pad"
                  placeholder="Enter 10-digit number"
                  placeholderTextColor={colors.outlineVariant}
                  maxLength={10}
                  editable={!busy}
                />
              </View>
            </View>

            {isValidPhone && cooldownRemaining > 0 ? (
              <View style={styles.cooldownContainer}>
                <Text style={styles.cooldownText}>
                  Request a new OTP in {cooldownRemaining} {cooldownRemaining === 1 ? 'second' : 'seconds'}
                </Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.button, isGetOtpDisabled && styles.buttonDisabled]}
              onPress={handleSendPhoneOtp}
              disabled={isGetOtpDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: isGetOtpDisabled }}
            >
              {busy ? (
                <View style={styles.buttonBusy}>
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                  <Text style={styles.buttonText}>Sending OTP...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>GET OTP</Text>
              )}
            </Pressable>
          </View>

          {/* Quick toggle link */}
          <View style={styles.toggleRow}>
            <Text style={styles.togglePrompt}>
              {isSignUp ? 'Already have an account? ' : 'New Driver? '}
              <Text
                style={styles.toggleLink}
                onPress={() => {
                  setAuthMode(isSignUp ? 'login' : 'signup');
                  setLocalError(null);
                }}
              >
                {isSignUp ? 'Log In' : 'Sign Up'}
              </Text>
            </Text>
          </View>

          <Text style={styles.terms}>
            By continuing, you agree to Pick Up's <Text style={styles.termsLink}>Terms of Service</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    paddingHorizontal: spacing.containerPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  headerSide: {
    width: 24,
  },
  headerTitle: {
    ...typography.headlineMd,
    fontWeight: '700',
    color: colors.primary,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
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
    fontSize: 14,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
    textAlign: 'center',
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '700',
  },
  hero: {
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  formSection: {
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.unit,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLowest,
    overflow: 'hidden',
  },
  countryCodeBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderRightWidth: 1,
    borderRightColor: colors.outlineVariant,
    justifyContent: 'center',
  },
  countryCodeText: {
    ...typography.bodyMd,
    fontWeight: '700',
    color: colors.onSurface,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  serverError: {
    ...typography.labelSm,
    color: colors.error,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  cooldownContainer: {
    marginVertical: spacing.xs,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  cooldownText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.gutter,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.unit,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  buttonText: {
    ...typography.headlineSm,
    color: colors.onPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  togglePrompt: {
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  toggleLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '700',
  },
  terms: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  termsLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});

export default UnifiedAuthScreen;
