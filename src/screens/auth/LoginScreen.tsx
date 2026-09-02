import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings } from '../../data/mockData';
import Button from '../../components/atoms/Button';
import InputField from '../../components/atoms/InputField';

export interface LoginScreenProps {
  readonly onGetOtp?: (phone: string) => void;
  readonly navigation?: any;
}

const LoginScreen: React.FC<LoginScreenProps & { navigation?: any }> = ({ onGetOtp, navigation }) => {
  const [phone, setPhone] = useState('');

  const handleGetOtp = useCallback(() => {
    onGetOtp?.(phone);
    navigation?.navigate('OtpVerificationScreen');
  }, [onGetOtp, phone, navigation]);

  const isValid = phone.length === 10;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          {/* Logo & Welcome */}
          <View style={styles.heroSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoInner}>
                <Text style={styles.logoIcon}>📦</Text>
              </View>
            </View>
            <Text style={styles.title}>{strings.login.title}</Text>
            <Text style={styles.subtitle}>{strings.login.subtitle}</Text>
          </View>

          {/* Phone Input */}
          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <View style={styles.phoneInputWrapper}>
                <InputField
                  placeholder="Enter 10-digit number"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.termsText}>
            {strings.login.termsPrefix}{' '}
            <Text style={styles.termsLink}>Terms of Service</Text>
            {'\n'}and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
          </Text>
          <Button
            label="Get OTP"
            onPress={handleGetOtp}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!isValid}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.marginMobile,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: spacing.xxxl + spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  logoInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: typography.headlineLg.fontSize,
    lineHeight: typography.headlineLg.lineHeight,
    fontWeight: typography.headlineLg.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineLg.fontFamily,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: typography.bodyLg.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
  },
  inputSection: {
    gap: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.labelCaps.fontSize,
    lineHeight: typography.labelCaps.lineHeight,
    fontWeight: typography.labelCaps.fontWeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  countryCode: {
    minWidth: 56,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  countryCodeText: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  phoneInputWrapper: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  termsText: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: typography.bodyMd.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },
  termsLink: {
    color: colors.primary,
    fontWeight: '500',
  },
});

export default LoginScreen;
