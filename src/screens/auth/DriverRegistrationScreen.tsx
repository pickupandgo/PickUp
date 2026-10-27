import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { DriverSignupForm } from '../../components/auth/DriverSignupForm';
import {
  formatToE164,
  mapFirebaseAuthError,
  AuthService,
} from '../../services/auth/AuthService';
import { useI18n } from '../../i18n';
import type { AuthScreenProps, DriverRegistrationData } from '../../types/navigation';

export interface DriverRegistrationScreenProps {
  readonly navigation: AuthScreenProps<'DriverRegistration'>['navigation'];
  readonly route?: any;
  readonly testID?: string;
}

export const DriverRegistrationScreen: React.FC<DriverRegistrationScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  const initialPhone = route?.params?.phone || '';

  const handleSubmit = useCallback(
    async (formData: DriverRegistrationData) => {
      if (isSubmittingRef.current || isLoading) return;

      const trimmedName = formData.fullName.trim();
      const cleanPhone = formData.phone.replace(/\D/g, '');
      const trimmedEmail = formData.email?.trim() || '';

      if (trimmedName.length < 2) {
        setError(t('auth.invalidName') || 'Please enter your full name (at least 2 characters).');
        return;
      }

      if (cleanPhone.length !== 10) {
        setError(t('auth.invalidPhone') || 'Please enter a valid 10-digit mobile number.');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (trimmedEmail.length > 0 && !emailRegex.test(trimmedEmail)) {
        setError('Please enter a valid email address.');
        return;
      }

      let formattedPhone: string;
      try {
        formattedPhone = formatToE164(cleanPhone);
      } catch (e: any) {
        setError(e?.message || 'Invalid phone number format.');
        return;
      }

      isSubmittingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const authService = AuthService.getInstance();
        await authService.requestOtp(formattedPhone);

        navigation.navigate('OTPVerification', {
          phone: formattedPhone,
          authMode: 'signup',
          intendedRole: 'driver',
          registrationData: {
            fullName: trimmedName,
            phone: formattedPhone,
            email: trimmedEmail || undefined,
            vehicleType: formData.vehicleType,
            vehicleRegistrationNumber: formData.vehicleRegistrationNumber,
            vehicleMakeModel: formData.vehicleMakeModel,
            drivingLicenseNumber: formData.drivingLicenseNumber,
          },
          driverData: {
            name: trimmedName,
            email: trimmedEmail || undefined,
            vehicleMake: formData.vehicleMakeModel,
            licensePlate: formData.vehicleRegistrationNumber,
          },
        });
      } catch (err: any) {
        setError(err?.message || mapFirebaseAuthError(err));
      } finally {
        isSubmittingRef.current = false;
        setIsLoading(false);
      }
    },
    [isLoading, navigation, t],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'bottom']}>
      <AppHeader
        title={t('auth.signupTitle')}
        onBackPress={() => navigation.goBack()}
        showBackButton
        showDivider
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.serverError}>{error}</Text> : null}

          <DriverSignupForm
            isLoading={isLoading}
            initialPhone={initialPhone}
            onSubmit={handleSubmit}
            onSwitchToLogin={() => navigation.navigate('UnifiedAuth')}
          />
        </ScrollView>
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
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  serverError: {
    backgroundColor: '#FDE8E8',
    color: '#9B1C1C',
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default DriverRegistrationScreen;
