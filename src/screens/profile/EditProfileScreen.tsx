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
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { mockUser } from '../../data/mockData';
import Button from '../../components/atoms/Button';

export interface EditProfileScreenProps {
  readonly onBack?: () => void;
  readonly onSave?: () => void;
}

const EditProfileScreen: React.FC<EditProfileScreenProps & { navigation?: any }> = ({
  onBack,
  onSave,
  navigation,
}) => {
  // `mockUser` fields are readonly literals, so annotate as string —
  // otherwise the state narrows to the literal and the setter rejects edits.
  const [fullName, setFullName] = useState<string>(mockUser.fullName);
  const [email, setEmail] = useState<string>(mockUser.email);
  const [age, setAge] = useState<string>(String(mockUser.age));
  const [address, setAddress] = useState<string>(mockUser.address);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation?.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.appBarTitle}>Edit Profile</Text>
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
            <Text style={styles.changePhotoText}>Change Profile Photo</Text>
          </Pressable>
        </View>

        {/* Form Fields */}
        <View style={styles.formContainer}>
          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={colors.onSurfaceVariant}
                value={fullName}
                onChangeText={setFullName}
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
              <Text style={styles.readOnlyText}>{mockUser.phone}</Text>
              <Feather name="lock" size={18} color={colors.onSurfaceVariant} />
            </View>
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor={colors.onSurfaceVariant}
                value={email}
                onChangeText={setEmail}
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
                style={styles.input}
                placeholder="Age"
                placeholderTextColor={colors.onSurfaceVariant}
                value={age}
                onChangeText={setAge}
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
                style={styles.addressInput}
                placeholder="Enter your address"
                placeholderTextColor={colors.onSurfaceVariant}
                value={address}
                onChangeText={setAddress}
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
          label="SAVE CHANGES"
          onPress={() => navigation?.goBack()}
          variant="primary"
          fullWidth
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
});

export default EditProfileScreen;
