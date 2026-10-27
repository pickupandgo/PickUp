import React, { useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Pressable, Image } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import AuthInput from '../atoms/AuthInput';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';
import Icon from '../atoms/Icon';
import { useI18n } from '../../i18n';
import { vehicleCategories } from '../../data/mockData';
import type { DriverRegistrationData } from '../../types/navigation';

export interface DriverSignupFormProps {
  readonly onSwitchToLogin: () => void;
  readonly onSubmit: (data: DriverRegistrationData) => void;
  readonly isLoading: boolean;
  readonly initialPhone?: string;
}

export const DriverSignupForm: React.FC<DriverSignupFormProps> = ({
  onSwitchToLogin,
  onSubmit,
  isLoading,
  initialPhone = '',
}) => {
  const { t } = useI18n();

  // Step 1: Personal Details
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(initialPhone);

  // Step 2: Vehicle & Licence Details
  const [vehicleType, setVehicleType] = useState('mini_truck');
  const [vehicleMakeModel, setVehicleMakeModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('');

  // Validation errors
  const [formError, setFormError] = useState<string | null>(null);

  const cleanPhone = phone.replace(/\D/g, '');
  const isPhoneValid = cleanPhone.length === 10;
  const isNameValid = name.trim().length >= 2;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmailValid = email.trim().length === 0 || emailRegex.test(email.trim());

  const handleNextStep = () => {
    setFormError(null);
    if (!isNameValid) {
      setFormError('Please enter your full legal name (at least 2 characters).');
      return;
    }
    if (!isPhoneValid) {
      setFormError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (email.trim().length > 0 && !emailRegex.test(email.trim())) {
      setFormError('Please enter a valid email address.');
      return;
    }
    setStep(2);
  };

  const handleFinalSubmit = () => {
    setFormError(null);
    if (!vehicleType) {
      setFormError('Please select a vehicle category.');
      return;
    }
    if (!licensePlate.trim()) {
      setFormError('Please enter your vehicle registration number.');
      return;
    }
    if (!drivingLicenseNumber.trim()) {
      setFormError('Please enter your driving licence number.');
      return;
    }

    onSubmit({
      fullName: name.trim(),
      phone: cleanPhone,
      email: email.trim() || undefined,
      vehicleType,
      vehicleRegistrationNumber: licensePlate.trim().toUpperCase(),
      vehicleMakeModel: vehicleMakeModel.trim() || 'Standard Delivery Vehicle',
      drivingLicenseNumber: drivingLicenseNumber.trim().toUpperCase(),
    });
  };

  return (
    <View style={styles.container}>
      {/* Step Indicator Header */}
      <View style={styles.stepHeader}>
        <View style={styles.stepIndicatorRow}>
          <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]}>
            <Text style={[styles.stepDotText, step >= 1 && styles.stepDotTextActive]}>1</Text>
          </View>
          <View style={[styles.stepConnector, step === 2 && styles.stepConnectorActive]} />
          <View style={[styles.stepDot, step === 2 && styles.stepDotActive]}>
            <Text style={[styles.stepDotText, step === 2 && styles.stepDotTextActive]}>2</Text>
          </View>
        </View>
        <Text style={styles.stepTitle}>
          {step === 1 ? 'Step 1 of 2: Personal Details' : 'Step 2 of 2: Vehicle & Licence Details'}
        </Text>
      </View>

      {formError ? (
        <View style={styles.errorBox}>
          <Icon name="error" size={18} color={colors.error} />
          <Text style={styles.errorText}>{formError}</Text>
        </View>
      ) : null}

      {step === 1 ? (
        /* ─── Step 1: Personal Details ───────────────────────── */
        <View style={styles.section}>
          <AuthInput
            label={t('auth.fullName')}
            placeholder="e.g. Ramesh Kumar"
            value={name}
            onChangeText={(val) => {
              setName(val);
              setFormError(null);
            }}
            autoCapitalize="words"
          />
          <AuthInput
            label={t('auth.phoneNumber')}
            placeholder={t('auth.enterMobileNumber')}
            value={phone}
            onChangeText={(val) => {
              setPhone(val);
              setFormError(null);
            }}
            keyboardType="phone-pad"
            prefix="+91"
            maxLength={10}
          />
          <AuthInput
            label={t('auth.emailAddress')}
            placeholder="driver@example.com (optional)"
            value={email}
            onChangeText={(val) => {
              setEmail(val);
              setFormError(null);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <PrimaryButton
            label="Continue to Vehicle Details"
            onPress={handleNextStep}
            disabled={!isNameValid || !isPhoneValid}
            style={styles.actionBtn}
          />
        </View>
      ) : (
        /* ─── Step 2: Vehicle & Licence Details ─────────────── */
        <View style={styles.section}>
          <Text style={styles.label}>Select Vehicle Category</Text>
          <View style={styles.categoryGrid}>
            {vehicleCategories.slice(0, 4).map((cat) => {
              const isSelected = vehicleType === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
                  onPress={() => setVehicleType(cat.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Icon
                    name={cat.iconName}
                    size={24}
                    color={isSelected ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.categoryName, isSelected && styles.categoryNameSelected]}>
                    {cat.name.split('/')[0].trim()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <AuthInput
            label="Vehicle Registration Number"
            placeholder="e.g. RJ 14 AB 1234"
            value={licensePlate}
            onChangeText={(val) => {
              setLicensePlate(val);
              setFormError(null);
            }}
            autoCapitalize="characters"
          />

          <AuthInput
            label="Vehicle Make & Model"
            placeholder="e.g. Tata Ace Gold / Bolero"
            value={vehicleMakeModel}
            onChangeText={setVehicleMakeModel}
            autoCapitalize="words"
          />

          <AuthInput
            label="Driving Licence Number"
            placeholder="e.g. RJ14 20200012345"
            value={drivingLicenseNumber}
            onChangeText={(val) => {
              setDrivingLicenseNumber(val);
              setFormError(null);
            }}
            autoCapitalize="characters"
          />

          {/* Verification Notice Card */}
          <View style={styles.noticeCard}>
            <Icon name="verified-user" size={22} color={colors.primary} style={styles.noticeIcon} />
            <View style={styles.noticeContent}>
              <Text style={styles.noticeTitle}>Document & Vehicle Inspection</Text>
              <Text style={styles.noticeBody}>
                Your vehicle and driving licence credentials will be verified by our operations team before ride requests can be accepted.
              </Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <SecondaryButton
              label="Back"
              onPress={() => {
                setFormError(null);
                setStep(1);
              }}
              style={styles.backBtn}
            />
            <PrimaryButton
              label={t('auth.applyToDrive')}
              onPress={handleFinalSubmit}
              disabled={isLoading || !licensePlate.trim() || !drivingLicenseNumber.trim()}
              loading={isLoading}
              style={styles.submitBtn}
            />
          </View>
        </View>
      )}

      {/* Switch to login */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('auth.alreadyHaveAccount')}</Text>
        <TouchableOpacity onPress={onSwitchToLogin} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.footerLink}>{t('common.login')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stepDotText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  stepDotTextActive: {
    color: colors.onPrimary,
  },
  stepConnector: {
    width: 48,
    height: 2,
    backgroundColor: colors.surfaceContainerHigh,
    marginHorizontal: spacing.xs,
  },
  stepConnectorActive: {
    backgroundColor: colors.primary,
  },
  stepTitle: {
    ...typography.headlineSm,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.onErrorContainer,
    flex: 1,
  },
  section: {
    gap: spacing.md,
  },
  label: {
    ...typography.headlineSm,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  categoryCard: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  categoryName: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '500',
  },
  categoryNameSelected: {
    color: colors.onPrimaryContainer,
    fontWeight: '700',
  },
  noticeCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  noticeIcon: {
    marginTop: 2,
  },
  noticeContent: {
    flex: 1,
  },
  noticeTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '600',
  },
  noticeBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 18,
  },
  actionBtn: {
    marginTop: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  backBtn: {
    flex: 1,
  },
  submitBtn: {
    flex: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.xs,
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
});

export default DriverSignupForm;
