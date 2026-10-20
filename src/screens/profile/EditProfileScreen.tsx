import React, { useState } from 'react';
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
import { colors, spacing, borderRadius, typography } from '../../theme';
import Button from '../../components/atoms/Button';
import { useSession } from '../../state/SessionContext';
import { getAuth } from '@react-native-firebase/auth';
import { getActivePhoneNumber, normalizePhoneNumber } from '../../auth/authService';
import { isValidEmailFormat } from './CreateProfileScreen';
import { useI18n } from '../../i18n';

export interface EditProfileScreenProps {
  readonly onBack?: () => void;
  readonly onSave?: () => void;
}

const EditProfileScreen: React.FC<EditProfileScreenProps & { navigation?: any }> = ({
  onBack,
  onSave,
  navigation,
}) => {
  const { userProfile, markProfileDone } = useSession();
  const { t } = useI18n();
  const currentUser = getAuth().currentUser;

  const verifiedPhone =
    normalizePhoneNumber(userProfile?.phone) ||
    normalizePhoneNumber(currentUser?.phoneNumber) ||
    normalizePhoneNumber(getActivePhoneNumber());

  const [fullName, setFullName] = useState<string>(
    userProfile?.fullName || currentUser?.displayName || '',
  );
  const [email, setEmail] = useState<string>(
    userProfile?.email || currentUser?.email || '',
  );
  const [age, setAge] = useState<string>(
    userProfile?.age ? String(userProfile.age) : '',
  );
  const [address, setAddress] = useState<string>(
    userProfile?.address || '',
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError(t('profile.fullNameRequired'));
      return;
    }

    // Email is strictly MANDATORY
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t('profile.emailRequired'));
      return;
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setError(t('auth.invalidEmail'));
      return;
    }

    const trimmedAge = age.trim();
    if (trimmedAge) {
      const numAge = parseInt(trimmedAge, 10);
      if (isNaN(numAge) || numAge < 1 || numAge > 120) {
        setError(t('profile.invalidAge'));
        return;
      }
    }

    setIsSaving(true);
    try {
      if (markProfileDone) {
        await markProfileDone({
          fullName: trimmedName,
          email: trimmedEmail,
          age: trimmedAge || undefined,
          address: address.trim() || undefined,
          phone: verifiedPhone || undefined,
          photoUri: userProfile?.photoUri,
        });
      }
      onSave?.();
      navigation?.goBack();
    } catch (err: any) {
      const msg = err?.userMessage || err?.message || t('profile.saveFailed');
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation?.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.goBack')}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.appBarTitle}>{t('profile.editProfile')}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Photo Section */}
        <View style={styles.photoSection}>
          <Pressable
            style={styles.photoContainer}
            onPress={() => navigation?.navigate('ChangeProfilePhotoScreen')}
          >
            <View style={styles.avatarCircle}>
              <Feather name="user" size={36} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.cameraOverlay}>
              <Feather name="camera" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => navigation?.navigate('ChangeProfilePhotoScreen')}
          >
            <Text style={styles.changePhotoText}>{t('profile.changePhoto')}</Text>
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
            <Text style={styles.fieldLabel}>{t('profile.fullName')}</Text>
            <View style={styles.inputWrapper}>
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
          </View>

          {/* Mobile Number (Verified, Read-only) */}
          <View style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.fieldLabel}>{t('auth.mobileNumber')}</Text>
              <View style={styles.verifiedBadge}>
                <Feather name="check-circle" size={14} color="#2D7A4D" />
                <Text style={styles.verifiedText}>{t('common.verified')}</Text>
              </View>
            </View>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{verifiedPhone || t('profile.noVerifiedNumber')}</Text>
              <Feather name="lock" size={18} color={colors.onSurfaceVariant} />
            </View>
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.emailAddress')}</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder={t('auth.enterEmail')}
                placeholderTextColor={colors.onSurfaceVariant}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.age')}</Text>
            <View style={[styles.inputWrapper, { width: '50%' }]}>
              <TextInput
                style={styles.input}
                placeholder={t('profile.age')}
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
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('profile.address')}</Text>
            <View style={styles.addressWrapper}>
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
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Button
          label={isSaving ? t('profile.saving') : t('common.saveChanges')}
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
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerLow,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  appBarTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.xxl,
    paddingBottom: spacing.xxxl + spacing.xxl,
    gap: spacing.xxxl,
  },
  photoSection: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  photoContainer: {
    position: 'relative',
  },
  avatarCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  changePhotoText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  formContainer: {
    gap: spacing.xxl,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    lineHeight: typography.labelSm.lineHeight,
    color: colors.onSurfaceVariant,
    paddingHorizontal: spacing.xs,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2D7A4D',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  input: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    padding: 0,
  },
  readOnlyField: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    opacity: 0.8,
  },
  readOnlyText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  addressWrapper: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  addressIcon: {
    marginTop: spacing.xs,
  },
  addressInput: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    padding: 0,
    minHeight: 80,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerLow,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
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
});

export default EditProfileScreen;
