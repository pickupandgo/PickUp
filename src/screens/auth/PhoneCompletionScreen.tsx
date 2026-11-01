import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { AuthLayout, MobileField, authStyles } from './AuthLayout';
import { sendPhoneLinkOTP, getPhoneLinkSession, mapFirebaseAuthError, usePhoneCooldown } from '../../auth/authService';
import { formatToE164, nationalMobileInput } from '../../auth/phoneUtils';
import { getAuth } from '@react-native-firebase/auth';
import { useSession } from '../../state/SessionContext';
import { AuthButton as Button } from './AuthLayout';

export default function PhoneCompletionScreen({ navigation }: { navigation?: any }) {
  const { logout, retryRegistration } = useSession();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  const valid = /^[6-9]\d{9}$/.test(national);
  const { cooldownRemaining } = usePhoneCooldown(valid ? national : '');
  const active = valid ? getPhoneLinkSession(national) : null;
  const send = async () => {
    if (lock.current || !valid) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (getAuth().currentUser?.phoneNumber) { await retryRegistration(); return; }
      const fullPhone = formatToE164(national);
      await sendPhoneLinkOTP(fullPhone);
      if (!mounted.current) return;
      navigation?.navigate('OtpVerificationScreen', { phoneNumber: fullPhone, authMode: 'link' });
    } catch (e) { if (mounted.current) setError(mapFirebaseAuthError(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const signOut = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await logout(); } catch (e) { if (mounted.current) setError(mapFirebaseAuthError(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const googleConnected = getAuth().currentUser?.providerData?.some(p => p.providerId === 'google.com');
  return <AuthLayout onSignOut={signOut} busy={busy}>
    <View style={authStyles.badge}><Text style={authStyles.badgeText}>{googleConnected ? 'Google connected' : 'Account connected'}</Text></View>
    <Text style={authStyles.title}>Add your mobile number</Text>
    <Text style={authStyles.body}>Verify your number to continue.</Text>
    <View style={authStyles.form}>
      <MobileField value={phone} onChangeText={value => { setPhone(nationalMobileInput(value)); setError(null); }} editable={!busy}
        onBlur={() => setTouched(true)} error={touched && !valid ? 'Enter a valid 10-digit Indian mobile number.' : undefined} />
      {error && <Text style={authStyles.error} accessibilityRole="alert">{error}</Text>}
      <Button label={active ? 'Continue verification' : 'Send OTP'} onPress={send} loading={busy}
        disabled={!valid || busy || (cooldownRemaining > 0 && !active)} fullWidth style={authStyles.button} />
      {cooldownRemaining > 0 && !active && <Text style={authStyles.hint}>Request another code in {cooldownRemaining}s.</Text>}
    </View>
    <Text style={authStyles.hint}>Your sign-in stays connected while you verify your mobile.</Text>
  </AuthLayout>;
}

