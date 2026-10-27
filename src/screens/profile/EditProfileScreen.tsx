import React, { useState, useRef, useCallback } from 'react';
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
import { KeyboardAwareScrollView, useKeyboardAware } from '../../components/organisms';
import { useSession } from '../../state/SessionContext';
import { getAuth } from '@react-native-firebase/auth';
import { getActivePhoneNumber, normalizePhoneNumber } from '../../auth/authService';

export interface EditProfileScreenProps {
  readonly onBack?: () => void;
  readonly onSave?: () => void;
}

const isValidEmailFormat = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

const EditProfileScreen: React.FC<EditProfileScreenProps & { navigation?: any }> = ({
  onBack,
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

  const { userProfile, markProfileDone } = useSession();
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

  // Synchronize state when userProfile loads or changes
  React.useEffect(() => {
    if (userProfile) {
      if (userProfile.fullName) setFullName(userProfile.fullName);
      if (userProfile.email) setEmail(userProfile.email);
      if (userProfile.age) setAge(String(userProfile.age));
      if (userProfile.address) setAddress(userProfile.address);
    }
  }, [userProfile]);

  const photoUri = userProfile?.photoUri || currentUser?.photoURL;

  const handleSave = async () => {
    setError(null);
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError('Please enter your full name');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address');
      return;
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    const trimmedAge = age.trim();
    if (trimmedAge) {
      const numAge = parseInt(trimmedAge, 10);
      if (isNaN(numAge) || numAge < 1 || numAge > 120) {
        setError('Please enter a valid age');
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
      const msg = err?.userMessage || err?.message || 'Failed to save profile. Please try again.';
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
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.appBarTitle}>Edit Profile</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAwareScrollView
        ref={keyboardAwareRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        footer={
          <View style={styles.footer}>
            <Button
              label={isSaving ? 'SAVING...' : 'SAVE CHANGES'}
              onPress={handleSave}
              variant="primary"
              fullWidth
              disabled={isSaving}
            />
          </View>
        }
      >
        {/* Profile Photo Section */}
        <View style={styles.photoSection}>
          <Pressable
            style={styles.photoContainer}
            onPress={() => navigation?.navigate('ChangeProfilePhotoScreen')}
          >
            <View style={styles.avatarCircle}>
              {photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.avatarCircleImage}
                  resizeMode="cover"
                />
              ) : (
                <Feather name="user" size={36} color={colors.onSurfaceVariant} />
              )}
            </View>
            <View style={styles.cameraOverlay}>
              <Feather name="camera" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => navigation?.navigate('ChangeProfilePhotoScreen')}
          >
            <Text style={styles.changePhotoText}>Change Profile Photo</Text>
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
            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={nameInputRef}
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={colors.onSurfaceVariant}
                value={fullName}
                onChangeText={setFullName}
                onFocus={() => scrollToInput(nameInputRef)}
              />
            </View>
          </View>

          {/* Mobile Number (Verified, Read-only) */}
          <View style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.fieldLabel}>Mobile Number</Text>
              <View style={styles.verifiedBadge}>
                <Feather name="check-circle" size={14} color="#2D7A4D" />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            </View>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{verifiedPhone || 'No verified number'}</Text>
              <Feather name="lock" size={18} color={colors.onSurfaceVariant} />
            </View>
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={emailInputRef}
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor={colors.onSurfaceVariant}
                value={email}
                onChangeText={setEmail}
                onFocus={() => scrollToInput(emailInputRef)}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Age</Text>
            <View style={[styles.inputWrapper, { width: '50%' }]}>
              <TextInput
                ref={ageInputRef}
                style={styles.input}
                placeholder="Age"
                placeholderTextColor={colors.onSurfaceVariant}
                value={age}
                onChangeText={setAge}
                onFocus={() => scrollToInput(ageInputRef)}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Address</Text>
            <View style={styles.addressWrapper}>
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
                multiline
                numberOfLines={3}
                textAlignVertical="top"
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
    overflow: 'hidden',
  },
  avatarCircleImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
    fontSize: typography.bodyMd.fontSize,
    color: colors.primary,
    fontWeight: '500',
    fontFamily: typography.bodyMd.fontFamily,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDE8E8',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    gap: spacing.sm,
  },
  errorBannerText: {
    color: colors.error,
    fontSize: typography.labelSm.fontSize,
    fontFamily: typography.labelSm.fontFamily,
    flex: 1,
  },
  formContainer: {
    gap: spacing.xl,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    height: spacing.rowHeightStandard,
    justifyContent: 'center',
  },
  input: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  verifiedText: {
    fontSize: typography.labelSm.fontSize,
    color: '#2D7A4D',
    fontWeight: '500',
    fontFamily: typography.labelSm.fontFamily,
  },
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: spacing.rowHeightStandard,
  },
  readOnlyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  addressWrapper: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    minHeight: 88,
  },
  addressIcon: {
    marginRight: spacing.sm,
    marginTop: 2,
  },
  addressInput: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    padding: 0,
    fontFamily: typography.bodyMd.fontFamily,
  },
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
  },
});

export default EditProfileScreen;
