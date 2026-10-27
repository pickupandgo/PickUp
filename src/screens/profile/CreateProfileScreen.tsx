import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Button from '../../components/atoms/Button';
import { KeyboardAwareScrollView, useKeyboardAware } from '../../components/organisms';
import { useSession } from '../../state/SessionContext';
import { registerCustomer } from '../../api/payments';
import { hasPaymentsConfig } from '../../config/env';
import { toApiError } from '../../api/http';

export interface CreateProfileScreenProps {
  readonly onSave?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CreateProfileScreen: React.FC<CreateProfileScreenProps & { navigation?: any }> = ({
  onSave,
  navigation,
}) => {
  const keyboardAwareRef = useRef<any>(null);
  const nameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const ageInputRef = useRef<TextInput>(null);
  const addressInputRef = useRef<TextInput>(null);

  const scrollToInput = useCallback((target: any) => {
    keyboardAwareRef.current?.scrollIntoView(target);
  }, []);

  const { login, markProfileDone, logout } = useSession();
  const [fullName, setFullName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [phone, setPhone] = useState<string | null>(() => {
    try {
      return getAuth().currentUser?.phoneNumber ?? null;
    } catch {
      return null;
    }
  });

  const isSubmittingRef = useRef(false);

  useEffect(() => {
    try {
      const auth = getAuth();
      if (auth?.currentUser?.phoneNumber) {
        setPhone(auth.currentUser.phoneNumber);
      }
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setPhone(currentUser?.phoneNumber ?? null);
      });
      return () => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    } catch (e) {
      console.warn('[PROFILE] Failed to attach auth listener:', e);
    }
  }, []);

  const cleanName = fullName.trim();
  const isNameValid = cleanName.length > 0;

  const cleanEmail = email.trim();
  const isEmailFormatValid = EMAIL_REGEX.test(cleanEmail) && !cleanEmail.endsWith('.');
  const isEmailValid = cleanEmail.length > 0 && isEmailFormatValid;

  const hasVerifiedPhone = Boolean(phone && phone.trim().length > 0);
  const isFormValid = isNameValid && isEmailValid && hasVerifiedPhone;

  const handleSave = async () => {
    setNameTouched(true);
    setEmailTouched(true);
    setApiError(null);

    const validName = fullName.trim().length > 0;
    const validEmail = EMAIL_REGEX.test(email.trim()) && !email.trim().endsWith('.');
    const validPhone = Boolean(phone && phone.trim().length > 0);

    if (!validName || !validEmail || !validPhone || isSubmitting || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const trimmedAge = age.trim();
    const trimmedAddress = address.trim();

    try {
      if (hasPaymentsConfig()) {
        await registerCustomer({
          name: trimmedName,
          email: trimmedEmail,
        });
      }
      onSave?.();
      if (markProfileDone) {
        await markProfileDone({
          fullName: trimmedName,
          email: trimmedEmail,
          age: trimmedAge,
          address: trimmedAddress,
        });
      }
      await login();
    } catch (e: any) {
      const apiErr = toApiError(e);
      const errBody = (apiErr as any).body;
      const rawMessage = errBody?.error?.message || errBody?.message;
      const message = rawMessage || apiErr.userMessage || 'Failed to save profile. Please try again.';
      setApiError(message);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut || isSubmitting || isSubmittingRef.current) return;
    setIsSigningOut(true);
    setApiError(null);
    try {
      await logout();
      if (navigation?.reset) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'LoginScreen' }],
        });
      } else if (navigation?.navigate) {
        navigation.navigate('LoginScreen');
      }
    } catch (err: any) {
      console.warn('[PROFILE] Sign out failed:', err);
      setApiError(err?.message || 'Failed to sign out. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        ref={keyboardAwareRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        footer={
          <View style={styles.footer}>
            <Button
              label="SAVE & CONTINUE"
              onPress={handleSave}
              variant="primary"
              fullWidth
              disabled={!isFormValid || isSubmitting || isSigningOut}
              loading={isSubmitting}
            />
          </View>
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>Create Your Profile</Text>
            <Pressable
              onPress={handleSignOut}
              disabled={isSigningOut || isSubmitting}
              hitSlop={8}
              style={[styles.logoutButton, isSigningOut && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Sign Out"
            >
              <Text style={styles.logoutText}>
                {isSigningOut ? 'Signing Out...' : 'Sign Out'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Tell us a little about yourself to get started.</Text>
        </View>

        {/* API Error Banner if any */}
        {apiError && (
          <View style={styles.apiErrorCard} accessibilityRole="alert">
            <Feather name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.apiErrorText}>{apiError}</Text>
          </View>
        )}

        {/* Profile Photo Placeholder */}
        <View style={styles.photoSection}>
          <View style={styles.photoContainer}>
            <View style={styles.photoCircle}>
              <Feather name="user" size={36} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.cameraButton}>
              <Feather name="camera" size={14} color={colors.onPrimary} />
            </View>
          </View>
          <Text style={styles.photoLabel}>ADD PROFILE PHOTO</Text>
        </View>

        {/* Form Fields */}
        <View style={styles.formContainer}>
          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              ref={nameInputRef}
              style={[
                styles.input,
                nameTouched && !isNameValid && styles.inputError,
              ]}
              placeholder="Enter your full name"
              placeholderTextColor={colors.onSurfaceVariant}
              value={fullName}
              onChangeText={(text) => {
                setFullName(text);
                if (apiError) setApiError(null);
              }}
              onFocus={() => scrollToInput(nameInputRef)}
              onBlur={() => setNameTouched(true)}
              autoCapitalize="words"
              editable={!isSubmitting}
            />
            {nameTouched && !isNameValid && (
              <Text style={styles.inlineErrorText} accessibilityLiveRegion="polite">
                Full name is required.
              </Text>
            )}
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              ref={emailInputRef}
              style={[
                styles.input,
                emailTouched && !isEmailValid && styles.inputError,
              ]}
              placeholder="Enter your email address"
              placeholderTextColor={colors.onSurfaceVariant}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (apiError) setApiError(null);
              }}
              onFocus={() => scrollToInput(emailInputRef)}
              onBlur={() => setEmailTouched(true)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
            />
            {emailTouched && cleanEmail.length === 0 && (
              <Text style={styles.inlineErrorText} accessibilityLiveRegion="polite">
                Email address is required.
              </Text>
            )}
            {emailTouched && cleanEmail.length > 0 && !isEmailFormatValid && (
              <Text style={styles.inlineErrorText} accessibilityLiveRegion="polite">
                Please enter a valid email address.
              </Text>
            )}
          </View>

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Age</Text>
            <TextInput
              ref={ageInputRef}
              style={styles.input}
              placeholder="Enter your age"
              placeholderTextColor={colors.onSurfaceVariant}
              value={age}
              onChangeText={setAge}
              onFocus={() => scrollToInput(ageInputRef)}
              keyboardType="numeric"
              editable={!isSubmitting}
            />
          </View>

          {/* Verified Mobile Number (Read-only) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Verified Mobile Number</Text>
            <View style={[styles.readOnlyField, !hasVerifiedPhone && styles.readOnlyFieldMissing]}>
              <Text style={[styles.readOnlyText, !hasVerifiedPhone && styles.missingPhoneText]}>
                {hasVerifiedPhone ? phone : 'No verified mobile number'}
              </Text>
              {hasVerifiedPhone && (
                <Feather name="check-circle" size={20} color={colors.primary} />
              )}
            </View>
            {!hasVerifiedPhone && (
              <View style={styles.phoneWarningContainer}>
                <Text style={styles.inlineErrorText}>
                  A verified mobile number is required to register.
                </Text>
                <Pressable
                  onPress={handleSignOut}
                  disabled={isSigningOut || isSubmitting}
                  style={[styles.verifyPhoneButton, isSigningOut && styles.buttonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with mobile number"
                >
                  <Text style={styles.verifyPhoneButtonText}>Sign In with Mobile OTP</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Address</Text>
            <View style={styles.addressInputWrapper}>
              <Feather
                name="map-pin"
                size={18}
                color={colors.onSurfaceVariant}
                style={styles.addressIcon}
              />
              <TextInput
                ref={addressInputRef}
                style={styles.addressInput}
                placeholder="Enter your address"
                placeholderTextColor={colors.onSurfaceVariant}
                value={address}
                onChangeText={setAddress}
                onFocus={() => scrollToInput(addressInputRef)}
                editable={!isSubmitting}
              />
            </View>
          </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxxl + spacing.xxl,
  },
  header: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoutButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  logoutText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '600',
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    lineHeight: typography.headlineMd.lineHeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  photoContainer: {
    position: 'relative',
  },
  photoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    lineHeight: typography.labelSm.lineHeight,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  formContainer: {
    gap: spacing.xl,
  },
  fieldGroup: {
    gap: spacing.xs + 2,
  },
  fieldLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    lineHeight: typography.labelSm.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  input: {
    height: 48,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  inputError: {
    borderWidth: 1,
    borderColor: colors.error,
  },
  inlineErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 2,
    fontFamily: typography.bodyMd.fontFamily,
  },
  readOnlyField: {
    height: 48,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readOnlyFieldMissing: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
  },
  readOnlyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    opacity: 0.8,
  },
  missingPhoneText: {
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  phoneWarningContainer: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  verifyPhoneButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  verifyPhoneButtonText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  apiErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  apiErrorText: {
    fontSize: 13,
    color: colors.error,
    flex: 1,
    lineHeight: 18,
  },
  addressInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
  },
  addressIcon: {
    marginRight: spacing.sm,
  },
  addressInput: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
});

export default CreateProfileScreen;

