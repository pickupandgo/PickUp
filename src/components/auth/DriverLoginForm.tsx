import React, { useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, typography, spacing } from '../../theme';
import AuthInput from '../atoms/AuthInput';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { useI18n } from '../../i18n';

interface DriverLoginFormProps {
  onSubmit: (data: any) => void;
  isLoading: boolean;
}

export const DriverLoginForm: React.FC<DriverLoginFormProps> = ({
  onSubmit,
  isLoading,
}) => {
  const { t } = useI18n();
  const [driverIdOrPhone, setDriverIdOrPhone] = useState('');
  const [password, setPassword] = useState('');

  const isLikelyPhone = driverIdOrPhone.length > 0 && /^\+?[\d\s\-\(\)]+$/.test(driverIdOrPhone);
  const showPassword = !isLikelyPhone;
  const submitLabel = isLikelyPhone ? `${t('auth.getOtp')} ➔` : `${t('common.login')} ➔`;
  const canSubmit = isLikelyPhone 
    ? driverIdOrPhone.replace(/\D/g, '').length >= 10 
    : driverIdOrPhone.length > 0 && password.length > 0;

  return (
    <View style={styles.container}>
      <AuthInput
        label={t('auth.driverIdOrPhone')}
        placeholder={isLikelyPhone ? t('auth.enterMobileNumber') : t('auth.enterIdOrPhone')}
        value={driverIdOrPhone}
        onChangeText={setDriverIdOrPhone}
        autoCapitalize="none"
        iconName={isLikelyPhone ? "phone" : "badge"}
        prefix={isLikelyPhone ? "+91" : undefined}
        keyboardType={isLikelyPhone ? "phone-pad" : "default"}
      />

      {showPassword && (
        <AuthInput
          label={t('auth.password')}
          placeholder={t('auth.enterPassword')}
          value={password}
          onChangeText={setPassword}
          isPassword
          iconName="lock-outline"
        />
      )}

      {showPassword && (
        <TouchableOpacity style={styles.forgotBtn}>
          <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
        </TouchableOpacity>
      )}

      <PrimaryButton
        label={submitLabel}
        onPress={() => onSubmit({ driverIdOrPhone, password, isPhone: isLikelyPhone })}
        disabled={isLoading || !canSubmit}
        loading={isLoading}
        style={styles.submitBtn}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    width: '100%',
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  forgotText: {
    ...typography.labelSm,
    color: colors.onSurface,
    fontWeight: '600',
  },
  submitBtn: {
    marginTop: spacing.md,
  },
});

export default DriverLoginForm;
