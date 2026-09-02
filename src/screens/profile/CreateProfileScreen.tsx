import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { mockUser } from '../../data/mockData';
import Button from '../../components/atoms/Button';

export interface CreateProfileScreenProps {
  readonly onSave?: () => void;
}

const CreateProfileScreen: React.FC<CreateProfileScreenProps & { navigation?: any }> = ({
  onSave,
  navigation,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');

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
          <Text style={styles.title}>Create Your Profile</Text>
          <Text style={styles.subtitle}>Tell us a little about yourself to get started.</Text>
        </View>

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
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor={colors.onSurfaceVariant}
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

          {/* Email Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email address"
              placeholderTextColor={colors.onSurfaceVariant}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Age</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your age"
              placeholderTextColor={colors.onSurfaceVariant}
              value={age}
              onChangeText={setAge}
              keyboardType="numeric"
            />
          </View>

          {/* Verified Mobile Number (Read-only) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Verified Mobile Number</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{mockUser.phone}</Text>
              <Feather name="check-circle" size={20} color={colors.primary} />
            </View>
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
                style={styles.addressInput}
                placeholder="Enter your address"
                placeholderTextColor={colors.onSurfaceVariant}
                value={address}
                onChangeText={setAddress}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Button
          label="SAVE & CONTINUE"
          onPress={() => navigation?.navigate('HomeScreen')}
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
    opacity: 0.8,
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
