import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { sendPhoneOTP, signInWithGoogle, mapFirebaseAuthError, usePhoneCooldown, hasActiveSession } from '../../auth/authService';
import { formatToE164, nationalMobileInput } from '../../auth/phoneUtils';
import { AuthLayout, MobileField, authStyles } from './AuthLayout';
import { AuthButton as Button } from './AuthLayout';
import { colors, spacing, typography, borderRadius } from '../../theme';

export interface LoginScreenProps { onGetOtp?: (phone: string) => void; navigation?: any; }
export const LoginScreen: React.FC<LoginScreenProps> = ({ navigation, onGetOtp }) => {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<'phone' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  const valid = /^[6-9]\d{9}$/.test(national);
  const { cooldownRemaining } = usePhoneCooldown(valid ? national : '');
  const resumable = valid && hasActiveSession(national);
  const continuePhone = async () => {
    if (lock.current || !valid) return;
    lock.current = true; setBusy('phone'); setError(null);
    try {
      const fullPhone = formatToE164(national);
      if (!hasActiveSession(fullPhone)) await sendPhoneOTP(fullPhone);
      if (!mounted.current) return;
      onGetOtp?.(fullPhone);
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'phone' });
    } catch (e) { if (mounted.current) setError(mapFirebaseAuthError(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  };
  const google = async () => {
    if (lock.current) return;
    lock.current = true; setBusy('google'); setError(null);
    try { await signInWithGoogle(); }
    catch (e: any) { if (mounted.current && e?.code !== 'auth/cancelled') setError(mapFirebaseAuthError(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  };
  return <AuthLayout busy={Boolean(busy)}>
    <Image source={require('../../../assets/images/auth_delivery.png')} resizeMode="contain"
      style={styles.illustration} accessible={false} />
    <Text style={authStyles.title}>Let’s get moving</Text>
    <Text style={authStyles.body}>Continue with your mobile number.</Text>
    <View style={authStyles.form}>
      <MobileField value={phone} onChangeText={value => { setPhone(nationalMobileInput(value)); setError(null); }} editable={!busy}
        onBlur={() => setTouched(true)} error={touched && !valid ? 'Enter a valid 10-digit Indian mobile number.' : undefined}
        onSubmitEditing={() => void continuePhone()} />
      {error && <Text style={authStyles.error} accessibilityRole="alert">{error}</Text>}
      <Button label={resumable ? 'Continue verification' : 'Continue'} onPress={continuePhone}
        loading={busy === 'phone'} disabled={!valid || Boolean(busy) || (cooldownRemaining > 0 && !resumable)}
        fullWidth style={authStyles.button} />
      {cooldownRemaining > 0 && !resumable && <Text style={authStyles.hint}>Request another code in {cooldownRemaining}s.</Text>}
    </View>
    <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>or</Text><View style={styles.line} /></View>
    <Pressable onPress={google} disabled={Boolean(busy)} accessibilityRole="button"
      accessibilityLabel="Continue with Google" accessibilityState={{ disabled: Boolean(busy) }} style={styles.google}>
      <Image source={require('../../../assets/images/google_g.png')} resizeMode="contain"
        style={styles.googleIcon} accessible={false} />
      <Text style={styles.googleText}>{busy === 'google' ? 'Connecting…' : 'Continue with Google'}</Text>
    </Pressable>
    <Text style={styles.footer}>New here? We’ll help you set up after verification.</Text>
  </AuthLayout>;
};
const styles = StyleSheet.create({
  illustration: { width: '100%', height: spacing.rowHeightStandard * 3, marginBottom: spacing.xxl },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginVertical: spacing.xxl },
  line: { flex: 1, height: 1, backgroundColor: colors.outlineHairline },
  or: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  google: { minHeight: spacing.rowHeightStandard, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg, backgroundColor: colors.surface, flexDirection: 'row', gap: spacing.md,
    alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  googleIcon: { width: spacing.xl, height: spacing.xl },
  googleText: { ...typography.bodyLg, fontWeight: '500', color: colors.primary },
  footer: { ...typography.labelSm, textAlign: 'center', color: colors.onSurfaceVariant, marginTop: spacing.xxl },
});
export default LoginScreen;

