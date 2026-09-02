import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { authData } from '../../data/mockData';

import DriverSignupForm from '../../components/auth/DriverSignupForm';
import DriverLoginForm from '../../components/auth/DriverLoginForm';

export type AuthMode = 'signup' | 'login';

export interface UnifiedAuthScreenProps {
  readonly navigation: any;
  readonly onSendOtp: (phone: string) => Promise<void>;
  readonly onLoginWithEmail: (email: string, password: string) => Promise<boolean>;
  readonly isLoading?: boolean;
  readonly testID?: string;
}

export const UnifiedAuthScreen: React.FC<UnifiedAuthScreenProps> = ({
  navigation,
  onSendOtp,
  onLoginWithEmail,
  isLoading = false,
  testID,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData: any) => {
    if (isSubmitting || isLoading) return;
    setIsSubmitting(true);
    
    try {
      console.log(`[UnifiedAuthScreen] Form Submitted! Mode: ${authMode}`);
      
      if (formData.isPhone === false) {
        // Handle Email/Password login
        const email = formData.email || formData.emailOrPhone || formData.driverIdOrPhone;
        const password = formData.password;
        if (!email || !password) {
          throw new Error('Email and password are required');
        }
        await onLoginWithEmail(email, password);
        // Successful login will automatically navigate based on RootNavigator's onAuthStateChanged listener
      } else {
        // Handle Phone OTP
        let rawPhone = formData.phone || formData.emailOrPhone || formData.driverIdOrPhone;
        
        // Basic formatting for Indian numbers if they didn't add a country code
        let phoneToUse = rawPhone ? rawPhone.replace(/\D/g, '') : '5551234567';
        if (phoneToUse.length === 10) {
          phoneToUse = '+91' + phoneToUse;
        } else if (!rawPhone?.startsWith('+')) {
          phoneToUse = '+' + phoneToUse;
        } else {
          phoneToUse = rawPhone;
        }
        
        await onSendOtp(phoneToUse);
        navigation.navigate('OTPVerification', { phone: phoneToUse, intendedRole: 'driver', authMode });
      }
    } catch (e: any) {
      console.log('[UnifiedAuthScreen] handleSubmit caught error:', e);
      Alert.alert('Error', e.message || 'Failed to authenticate. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderForm = () => {
    if (authMode === 'signup') {
      return (
        <View style={styles.formContent}>
          <Text style={styles.title}>Apply to Drive</Text>
          <Text style={styles.subtitle}>Join our network of professional logistics partners.</Text>
          
          <View style={styles.card}>
            <DriverSignupForm 
              onSwitchToLogin={() => setAuthMode('login')} 
              onSubmit={handleSubmit} 
              isLoading={isLoading || isSubmitting} 
            />
          </View>
        </View>
      );
    } else {
      return (
        <View style={styles.formContent}>
          <Text style={styles.subtitle}>Welcome back. Please log in.</Text>
          
          <View style={styles.card}>
            <DriverLoginForm 
              onSubmit={handleSubmit} 
              isLoading={isLoading || isSubmitting} 
            />
          </View>
        </View>
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{authData.appName}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formArea}>
            {renderForm()}
          </View>

          {authMode === 'login' && (
            <View style={styles.footerArea}>
              <Text style={styles.termsText}>
                By continuing, you agree to Pick Up's <Text style={styles.termsLink}>Terms of Service.</Text>
              </Text>
            </View>
          )}
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
  header: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  headerTitle: {
    ...typography.headlineMd,
    color: colors.primary,
    fontWeight: '700',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.containerPadding,
  },
  formArea: {
    flex: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  formContent: {
    gap: spacing.lg,
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    width: '100%',
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineLg,
    color: colors.onSurface,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  footerArea: {
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  termsText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  termsLink: {
    textDecorationLine: 'underline',
    color: colors.primary,
  },
});

export default UnifiedAuthScreen;
