import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';

export interface UnifiedAuthScreenProps {
  readonly navigation: any;
  readonly onSendOtp: (phone: string) => Promise<void>;
  /** Retained for backward compatibility with the auth stack; unused in the phone-only flow. */
  readonly onLoginWithEmail?: (email: string, password: string) => Promise<boolean>;
  readonly isLoading?: boolean;
  readonly testID?: string;
}

/**
 * Driver Login — phone number only.
 *
 * Enter a 10-digit mobile number, tap GET OTP: this requests an OTP via the
 * auth service and moves to the OTP verification screen.
 */
export const UnifiedAuthScreen: React.FC<UnifiedAuthScreenProps> = ({
  navigation,
  onSendOtp,
  isLoading = false,
  testID,
}) => {
  const [phone, setPhone] = useState('');
  const [hasError, setHasError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const digits = phone.replace(/\D/g, '');
  const isValid = digits.length === 10;
  const busy = isLoading || isSubmitting;

  const handleGetOtp = useCallback(async () => {
    if (busy) return;
    if (!isValid) {
      setHasError(true);
      return;
    }
    setHasError(false);
    setIsSubmitting(true);
    const phoneToUse = `+91${digits}`;
    try {
      await onSendOtp(phoneToUse);
      navigation.navigate('OTPVerification', {
        phone: phoneToUse,
        intendedRole: 'driver',
        authMode: 'login',
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to send OTP. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [busy, isValid, digits, onSendOtp, navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'bottom']}>
      {/* Top app bar */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.headerTitle}>Pick Up</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          {/* Hero / welcome */}
          <View style={styles.hero}>
            <Text style={styles.title}>Driver Login</Text>
            <Text style={styles.subtitle}>
              Enter your mobile number to securely access your logistics dashboard.
            </Text>
          </View>

          {/* Phone input */}
          <View style={styles.field}>
            <Text style={styles.label}>Mobile Number</Text>
            <View style={[styles.inputRow, hasError && styles.inputRowError]}>
              <View style={styles.prefixBox}>
                <Text style={styles.prefixText}>+91</Text>
              </View>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={(t) => {
                  setPhone(t);
                  if (hasError) setHasError(false);
                }}
                keyboardType="phone-pad"
                placeholder="98765 43210"
                placeholderTextColor={colors.outlineVariant}
                maxLength={11}
                autoComplete="tel"
                editable={!busy}
                onSubmitEditing={handleGetOtp}
              />
            </View>
            {hasError && (
              <Text style={styles.errorText}>Invalid mobile number</Text>
            )}
          </View>

          {/* Primary action */}
          <Pressable
            style={[styles.button, (!isValid || busy) && styles.buttonDisabled]}
            onPress={handleGetOtp}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? (
              <View style={styles.buttonBusy}>
                <ActivityIndicator size="small" color={colors.onPrimary} />
                <Text style={styles.buttonText}>Authenticating...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>GET OTP</Text>
            )}
          </Pressable>

          <Text style={styles.terms}>
            By continuing, you agree to Pick Up's <Text style={styles.termsLink}>Terms of Service</Text>.
          </Text>
        </View>
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.xl,
  },
  hero: {
    marginBottom: spacing.xxl,
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
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.unit,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLowest,
    overflow: 'hidden',
  },
  inputRowError: {
    borderColor: colors.error,
  },
  prefixBox: {
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
    backgroundColor: colors.surfaceContainerLow,
    borderRightWidth: 1,
    borderRightColor: colors.outlineVariant,
  },
  prefixText: {
    ...typography.dataMono,
    color: colors.onSurfaceVariant,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
    ...typography.dataMono,
    color: colors.onSurface,
  },
  errorText: {
    ...typography.labelSm,
    color: colors.error,
    marginTop: spacing.xs,
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
