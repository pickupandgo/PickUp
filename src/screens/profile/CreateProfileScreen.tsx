import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { getAuth } from '@react-native-firebase/auth';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Button from '../../components/atoms/Button';
import { useSession } from '../../state/SessionContext';
import {
  getActivePhoneNumber,
  normalizePhoneNumber,
  formatToE164,
  linkEmailPassword,
  mapFirebaseAuthError,
} from '../../auth/authService';
import { useI18n } from '../../i18n';

export interface CreateProfileScreenProps {
  readonly onSave?: () => void;
  readonly route?: any;
  readonly navigation?: any;
}

export const isValidEmailFormat = (emailStr: string): boolean => {
  const trimmed = (emailStr || '').trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
};

const CreateProfileScreen: React.FC<CreateProfileScreenProps & { route?: any; navigation?: any }> = ({
  onSave,
  route,
  navigation,
}) => {
  const { login, markProfileDone, logout, userProfile } = useSession();
  const { t } = useI18n();
  const currentUser = getAuth().currentUser;

  // Genuine verified phone from Firebase Auth or active OTP session
  const verifiedPhone = useMemo(() => {
    const raw =
      currentUser?.phoneNumber ||
      route?.params?.phoneNumber ||
      getActivePhoneNumber();
    return normalizePhoneNumber(raw);
  }, [currentUser?.phoneNumber, route?.params?.phoneNumber]);

  // For users who signed up via Email, Google, or Apple, phone is not yet in Auth.
  // Allow them to input their mobile number.
  const [manualPhone, setManualPhone] = useState<string>(() => {
    if (verifiedPhone) return '';
    return userProfile?.phone ? userProfile.phone.replace(/^\+91/, '').replace(/\D/g, '') : '';
  });

  // Full Name: Genuine display name from Google/Apple or route params or profile
  const [fullName, setFullName] = useState<string>(() => {
    return (
      currentUser?.displayName ||
      route?.params?.fullName ||
      userProfile?.fullName ||
      ''
    );
  });

  // Email: Prefill only when it genuinely belongs to the authenticated account
  const genuineAuthEmail = currentUser?.email || route?.params?.email || '';
  const isEmailFromAuth = Boolean(currentUser?.email);
  const [email, setEmail] = useState<string>(() => {
    return genuineAuthEmail;
  });

  // Providers detection for credential linking
  const hasPasswordProvider = Boolean(
    currentUser?.providerData?.some((p) => p.providerId === 'password')
  );
  const hasGoogleProvider = Boolean(
    currentUser?.providerData?.some((p) => p.providerId === 'google.com')
  );
  const hasAppleProvider = Boolean(
    currentUser?.providerData?.some((p) => p.providerId === 'apple.com')
  );
  const isSocialAuth = hasGoogleProvider || hasAppleProvider;
  const canSetupPassword = !hasPasswordProvider && !isSocialAuth;

  // Credential setup state for Phone OTP users desiring Email/Password sign-in
  const [enablePasswordLogin, setEnablePasswordLogin] = useState<boolean>(false);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [linkConflict, setLinkConflict] = useState<string | null>(null);

  const [age, setAge] = useState<string>(() => {
    return route?.params?.age
      ? String(route.params.age)
      : userProfile?.age
      ? String(userProfile.age)
      : '';
  });

  const [address, setAddress] = useState<string>(() => {
    return route?.params?.address || userProfile?.address || '';
  });

  const [photoUri, setPhotoUri] = useState<string | null>(() => {
    return currentUser?.photoURL || userProfile?.photoUri || null;
  });

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    setLinkConflict(null);

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError(t('profile.fullNameRequired') || 'Please enter your full name.');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t('profile.emailRequired') || 'Please enter your email address.');
      return;
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setError(t('auth.invalidEmail') || 'Please enter a valid email address.');
      return;
    }

    // Phone validation: either verifiedPhone exists or valid 10-digit manualPhone
    let phoneToPersist = verifiedPhone;
    if (!phoneToPersist) {
      const cleanManual = manualPhone.replace(/\D/g, '');
      if (cleanManual.length !== 10) {
        setError(t('profile.verifiedPhoneRequired') || 'Please enter a valid 10-digit mobile number.');
        return;
      }
      try {
        phoneToPersist = formatToE164(cleanManual);
      } catch {
        setError(t('profile.verifiedPhoneRequired') || 'Please enter a valid 10-digit mobile number.');
        return;
      }
    }

    const trimmedAge = age.trim();
    if (trimmedAge) {
      const numAge = parseInt(trimmedAge, 10);
      if (isNaN(numAge) || numAge < 1 || numAge > 120) {
        setError(t('profile.invalidAge') || 'Please enter a valid age between 1 and 120.');
        return;
      }
    }

    // If user opted to enable Email/Password login, validate password and perform linkWithCredential
    if (canSetupPassword && enablePasswordLogin) {
      if (!newPassword || newPassword.length < 6) {
        setError(t('profile.passwordMinLength') || 'Password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(t('profile.passwordMismatch') || 'Passwords do not match.');
        return;
      }
    }

    setIsSaving(true);

    // Link credential if requested
    if (canSetupPassword && enablePasswordLogin && currentUser) {
      try {
        await linkEmailPassword(currentUser, trimmedEmail, newPassword);
        console.log('[PROFILE] Email/password successfully linked to UID:', currentUser.uid);
      } catch (linkErr: any) {
        console.warn('[PROFILE] Account linking error:', linkErr?.code || linkErr?.message);
        if (
          linkErr?.code === 'auth/email-already-in-use' ||
          linkErr?.code === 'auth/credential-already-in-use'
        ) {
          const conflictMsg =
            t('profile.linkConflict') ||
            'This email is already associated with another account. Please use a different email or log in with that account.';
          setLinkConflict(conflictMsg);
          setError(conflictMsg);
          setIsSaving(false);
          return;
        } else if (linkErr?.code === 'auth/provider-already-linked') {
          // Already linked, proceed
        } else {
          const msg = mapFirebaseAuthError(linkErr);
          setError(msg);
          setIsSaving(false);
          return;
        }
      }
    }

    try {
      if (markProfileDone) {
        await markProfileDone({
          fullName: trimmedName,
          email: trimmedEmail,
          age: trimmedAge || undefined,
          address: address.trim() || undefined,
          phone: phoneToPersist,
          photoUri: photoUri || undefined,
        });
      }
      onSave?.();
      await login();
    } catch (err: any) {
      const msg = err?.userMessage || err?.message || t('profile.saveFailed') || 'Failed to save profile.';
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoPress = () => {
    if (navigation?.navigate) {
      navigation.navigate('ChangeProfilePhotoScreen');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>{t('profile.createProfileTitle')}</Text>
            <Pressable onPress={logout} hitSlop={8} style={styles.logoutButton}>
              <Text style={styles.logoutText}>{t('profile.signOut')}</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{t('profile.createProfileSubtitle')}</Text>
        </View>

        {/* Profile Photo Placeholder */}
        <View style={styles.photoSection}>
          <Pressable style={styles.photoContainer} onPress={handlePhotoPress}>
            <View style={styles.photoCircle}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} />
              ) : (
                <Feather name="user" size={36} color={colors.onSurfaceVariant} />
              )}
            </View>
            <View style={styles.cameraButton}>
              <Feather name="camera" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Pressable onPress={handlePhotoPress}>
            <Text style={styles.photoLabel}>{t('profile.addProfilePhoto')}</Text>
          </Pressable>
        </View>

        {/* Error Banner */}
        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-triangle" size={18} color={colors.error} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {/* Form Fields */}
        <View style={styles.formContainer}>
          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.fullName')} *</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.enterFullName')}
              placeholderTextColor={colors.onSurfaceVariant}
              value={fullName}
              onChangeText={(text) => {
                setFullName(text);
                if (error) setError(null);
              }}
            />
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>{t('profile.emailAddress')} *</Text>
              {isEmailFromAuth ? (
                <View style={styles.authBadge}>
                  <Feather name="check" size={12} color={colors.primary} />
                  <Text style={styles.authBadgeText}>{t('common.verified')}</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              style={[styles.input, isEmailFromAuth && styles.readOnlyInput]}
              placeholder={t('auth.enterEmail')}
              placeholderTextColor={colors.onSurfaceVariant}
              value={email}
              editable={!isEmailFromAuth}
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null);
                if (linkConflict) setLinkConflict(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Phone Number Section */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              {verifiedPhone ? t('profile.verifiedMobileNumber') : `${t('profile.mobileNumber')} *`}
            </Text>
            {verifiedPhone ? (
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{verifiedPhone}</Text>
                <Feather name="check-circle" size={20} color={colors.primary} />
              </View>
            ) : (
              <View style={styles.phoneInputRow}>
                <View style={styles.countryCodeBadge}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  placeholder={t('profile.enterMobileNumber') || '10-digit mobile number'}
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={manualPhone}
                  onChangeText={(text) => {
                    setManualPhone(text.replace(/[^0-9]/g, ''));
                    if (error) setError(null);
                  }}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            )}
          </View>

          {/* Optional Credential Setup: Enable Email & Password Sign-In for Phone OTP Users */}
          {canSetupPassword ? (
            <View style={styles.credentialCard}>
              <View style={styles.credentialHeader}>
                <View style={styles.credentialHeaderLeft}>
                  <Feather name="shield" size={18} color={colors.primary} />
                  <Text style={styles.credentialTitle}>
                    {t('profile.enablePasswordLogin')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setEnablePasswordLogin(!enablePasswordLogin);
                    if (linkConflict) setLinkConflict(null);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.credentialAction}>
                    {enablePasswordLogin
                      ? t('profile.removePassword')
                      : t('profile.setPassword')}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.credentialSubtitle}>
                {t('profile.enablePasswordSubtitle')}
              </Text>

              {enablePasswordLogin ? (
                <View style={styles.passwordFieldsContainer}>
                  {/* Create Password */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t('profile.createPassword')} *
                    </Text>
                    <View style={styles.passwordWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder={t('profile.passwordPlaceholder')}
                        placeholderTextColor={colors.onSurfaceVariant}
                        value={newPassword}
                        onChangeText={(text) => {
                          setNewPassword(text);
                          if (error) setError(null);
                          if (linkConflict) setLinkConflict(null);
                        }}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                      />
                      <Pressable
                        onPress={() => setShowPassword(!showPassword)}
                        hitSlop={8}
                        style={styles.eyeIcon}
                      >
                        <Feather
                          name={showPassword ? 'eye-off' : 'eye'}
                          size={18}
                          color={colors.onSurfaceVariant}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Confirm Password */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      {t('profile.confirmPassword')} *
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder={t('profile.confirmPasswordPlaceholder')}
                      placeholderTextColor={colors.onSurfaceVariant}
                      value={confirmPassword}
                      onChangeText={(text) => {
                        setConfirmPassword(text);
                        if (error) setError(null);
                        if (linkConflict) setLinkConflict(null);
                      }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                    />
                  </View>

                  {linkConflict ? (
                    <View style={styles.conflictBanner}>
                      <Feather name="alert-circle" size={16} color={colors.error} />
                      <Text style={styles.conflictText}>{linkConflict}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.age')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('profile.enterAge')}
              placeholderTextColor={colors.onSurfaceVariant}
              value={age}
              onChangeText={(text) => {
                setAge(text.replace(/[^0-9]/g, ''));
                if (error) setError(null);
              }}
              keyboardType="numeric"
              maxLength={3}
            />
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.address')}</Text>
            <View style={styles.addressInputWrapper}>
              <Feather
                name="map-pin"
                size={18}
                color={colors.onSurfaceVariant}
                style={styles.addressIcon}
              />
              <TextInput
                style={styles.addressInput}
                placeholder={t('profile.enterAddress')}
                placeholderTextColor={colors.onSurfaceVariant}
                value={address}
                onChangeText={(text) => {
                  setAddress(text);
                  if (error) setError(null);
                }}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Button
          label={isSaving ? t('profile.saving') : t('common.saveAndContinue')}
          onPress={handleSave}
          variant="primary"
          fullWidth
          disabled={isSaving}
        />
      </View>
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
    overflow: 'hidden',
  },
  photoImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FDE8E8',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.error,
    fontWeight: '500',
  },
  formContainer: {
    gap: spacing.xl,
  },
  fieldGroup: {
    gap: spacing.xs + 2,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    lineHeight: typography.labelSm.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  authBadgeText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
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
  readOnlyInput: {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurfaceVariant,
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
  readOnlyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '600',
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countryCodeBadge: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryCodeText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  phoneInput: {
    flex: 1,
    height: 48,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  credentialCard: {
    backgroundColor: colors.surfaceContainerLowest || '#F9FAFB',
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  credentialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  credentialHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  credentialTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  credentialAction: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  credentialSubtitle: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 16,
  },
  passwordFieldsContainer: {
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  eyeIcon: {
    padding: spacing.xs,
  },
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FDE8E8',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  conflictText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
    fontWeight: '500',
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
});

export default CreateProfileScreen;
