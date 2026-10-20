import React, { useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import AuthInput from '../atoms/AuthInput';
import { PrimaryButton } from '../atoms/PrimaryButton';
import Icon from '../atoms/Icon';
import { useI18n } from '../../i18n';

interface DriverSignupFormProps {
  onSwitchToLogin: () => void;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}

export const DriverSignupForm: React.FC<DriverSignupFormProps> = ({
  onSwitchToLogin,
  onSubmit,
  isLoading,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [licensePlate, setLicensePlate] = useState('');

  return (
    <View style={styles.container}>
      
      {/* Personal Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('auth.personalDetails')}</Text>
        <AuthInput
          label={t('auth.fullName')}
          placeholder="Jane Doe"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <AuthInput
          label={t('auth.emailAddress')}
          placeholder="jane@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <AuthInput
          label={t('auth.phoneNumber')}
          placeholder={t('auth.enterMobileNumber')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          prefix="+91"
        />
      </View>

      <View style={styles.sectionDivider} />

      {/* Vehicle Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('auth.vehicleInfo')}</Text>
        <AuthInput
          label={t('auth.makeModel')}
          placeholder="e.g. Ford Transit"
          value={vehicleMake}
          onChangeText={setVehicleMake}
        />
        <AuthInput
          label={t('auth.licensePlate')}
          placeholder="ABC 1234"
          value={licensePlate}
          onChangeText={setLicensePlate}
          autoCapitalize="characters"
        />
      </View>

      <View style={styles.sectionDivider} />

      {/* Documents */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('auth.documents')}</Text>
        <Text style={styles.sectionSubtitle}>
          {t('auth.uploadDocumentsHint')}
        </Text>
        
        <TouchableOpacity style={styles.dropzone}>
          <Icon name="upload-file" size={28} color={colors.onSurfaceVariant} style={styles.uploadIcon} />
          <Text style={styles.dropzoneTitle}>
            <Text style={{fontWeight: 'bold', color: colors.onSurface}}>{t('auth.clickToUpload')}</Text>{t('auth.orDragDrop')}
          </Text>
          <Text style={styles.dropzoneSubtitle}>{t('auth.fileFormatHint')}</Text>
        </TouchableOpacity>
      </View>

      <PrimaryButton
        label={t('auth.applyToDrive')}
        onPress={() => onSubmit({ name, email, phone, vehicleMake, licensePlate })}
        disabled={isLoading || !name || !email || !phone}
        loading={isLoading}
        style={styles.submitBtn}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('auth.alreadyHaveAccount')}</Text>
        <TouchableOpacity onPress={onSwitchToLogin}>
          <Text style={styles.footerLink}>{t('common.login')}</Text>
        </TouchableOpacity>
      </View>
      
      <TouchableOpacity style={styles.forgotBtn}>
        <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  sectionSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginVertical: spacing.lg,
  },
  dropzone: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
  },
  uploadIcon: {
    marginBottom: spacing.sm,
  },
  dropzoneTitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  dropzoneSubtitle: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  submitBtn: {
    marginTop: spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  footerText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  footerLink: {
    ...typography.bodyMd,
    fontWeight: '700',
    color: colors.primary,
  },
  forgotBtn: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  forgotText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  }
});

export default DriverSignupForm;
