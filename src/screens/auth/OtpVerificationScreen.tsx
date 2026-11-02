import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { verifyOTP, sendPhoneOTP, sendPhoneLinkOTP, getPhoneLinkSession, confirmPhoneLinkOTP,
  mapFirebaseAuthError, usePhoneCooldown, hasActiveSession } from '../../auth/authService';
import { useSession } from '../../state/SessionContext';
import { AuthLayout, authStyles } from './AuthLayout';
import { AuthButton as Button } from './AuthLayout';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface OtpVerificationScreenProps {
  phoneNumber?: string; timerSeconds?: number; onVerify?: (otp: string) => void; onResend?: () => void;
  onChangeNumber?: () => void; onBack?: () => void; isLoading?: boolean; error?: string | null;
  isExpired?: boolean; navigation?: any; route?: any;
}
export default function OtpVerificationScreen({ phoneNumber = '', onVerify, onResend, onChangeNumber, onBack,
  isLoading = false, error, isExpired = false, navigation, route }: OtpVerificationScreenProps) {
  const actualPhone = route?.params?.phoneNumber || phoneNumber;
  const linking = route?.params?.authMode === 'link';
  const { retryRegistration } = useSession();
  const { cooldownRemaining } = usePhoneCooldown(actualPhone);
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [expired, setExpired] = useState(isExpired);
  const input = useRef<TextInput>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sessionExists = Boolean(actualPhone && (linking ? getPhoneLinkSession(actualPhone) : hasActiveSession(actualPhone)));
  const back = () => { if (!lock.current && !isLoading) (onChangeNumber || onBack || (() => navigation?.goBack()))(); };

  const resend = async () => {
    if (!actualPhone || lock.current || isLoading || cooldownRemaining > 0) return;
    lock.current = true; setBusy('resend'); setLocalError(null); setMessage(null);
    try {
      if (linking) await sendPhoneLinkOTP(actualPhone, true);
      else await sendPhoneOTP(actualPhone, true);
      if (!mounted.current) return;
      setCode(''); setExpired(false); setMessage('A new code was requested.'); input.current?.focus(); onResend?.();
    } catch (e) { if (mounted.current) setLocalError(mapFirebaseAuthError(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  };
  const verify = async () => {
    if (!/^\d{6}$/.test(code) || !actualPhone || lock.current || isLoading || expired) return;
    lock.current = true; setBusy('verify'); setLocalError(null); setMessage(null);
    try {
      if (linking) {
        const session = getPhoneLinkSession(actualPhone);
        if (!session) throw new Error('Verification session expired. Request a new code.');
        await confirmPhoneLinkOTP(session.verificationId, code, session.uid);
        await retryRegistration();
      } else await verifyOTP(code, actualPhone);
      onVerify?.(code);
    } catch (e: any) {
      if (!mounted.current) return;
      setLocalError(mapFirebaseAuthError(e));
      if (['auth/code-expired', 'auth/session-expired', 'auth/invalid-verification-id'].includes(e?.code)) setExpired(true);
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  };
  const shownError = error || localError || (!actualPhone ? 'Go back and enter your mobile number.'
    : !sessionExists ? 'Request a new code to continue verification.' : null);
  return <AuthLayout onBack={back} busy={Boolean(busy) || isLoading}>
    <Text style={styles.eyebrow}>PHONE VERIFICATION</Text>
    <Text style={authStyles.title}>Verify your number</Text>
    <Text style={styles.subtitle}>Enter the 6-digit code sent to your phone.</Text>
    <View style={styles.destination}>
      <View style={styles.phoneIcon}><Feather name="smartphone" size={spacing.lg} color={colors.homeAction} /></View>
      <Text style={styles.number} numberOfLines={1}>{actualPhone}</Text>
      <Pressable onPress={back} disabled={Boolean(busy) || isLoading} style={styles.editAction}
        accessibilityRole="button" accessibilityLabel="Edit mobile number"><Text style={styles.editText}>Edit</Text></Pressable>
    </View>
    <Text style={styles.codeLabel}>VERIFICATION CODE</Text>
    <View style={styles.codeArea}>
      <View style={styles.cells} pointerEvents="none" accessible={false}>
        {Array.from({ length: 6 }, (_, i) => <View key={i} style={[styles.cell,
          Boolean(code[i]) && styles.filled, focused && Math.min(code.length, 5) === i && styles.focused, Boolean(shownError) && styles.invalid]}>
          <Text style={styles.digit}>{code[i] || ''}</Text>
        </View>)}
      </View>
      <TextInput ref={input} style={styles.codeInput} value={code}
        onChangeText={value => { setCode(value.replace(/\D/g, '').slice(0, 6)); setLocalError(null); }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp"
        importantForAutofill="yes" caretHidden selectionColor={colors.transparent}
        accessibilityLabel="6-digit verification code" editable={!busy && !isLoading && !expired}
        onSubmitEditing={() => void verify()} />
    </View>
    {shownError && <Text style={authStyles.error} accessibilityRole="alert">{shownError}</Text>}
    {expired && <Text style={authStyles.error}>Code expired. Request a new one.</Text>}
    {message && !shownError && <Text style={authStyles.hint} accessibilityLiveRegion="polite">{message}</Text>}
    <Pressable onPress={resend} disabled={cooldownRemaining > 0 || Boolean(busy) || isLoading || !actualPhone}
      accessibilityRole="button" accessibilityLabel="Resend code" style={styles.resend}>
      <Text style={cooldownRemaining > 0 ? styles.subtitle : authStyles.link}>
        {busy === 'resend' ? 'Requesting code…' : cooldownRemaining > 0
          ? 'Resend in ' + Math.floor(cooldownRemaining / 60).toString().padStart(2, '0') + ':' + (cooldownRemaining % 60).toString().padStart(2, '0')
          : 'Resend code'}
      </Text>
    </Pressable>
    <Button label="Verify & Continue" onPress={verify} loading={busy === 'verify' || isLoading}
      disabled={code.length !== 6 || Boolean(busy) || isLoading || expired || !sessionExists}
      fullWidth style={authStyles.button} />
  </AuthLayout>;
}
const styles = StyleSheet.create({
  eyebrow: { ...typography.labelSm, color: colors.homePickup, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginBottom: spacing.lg },
  destination: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryFixed, borderRadius: borderRadius.lg, padding: spacing.sm, marginBottom: spacing.xxl },
  phoneIcon: { width: spacing.xxxl, height: spacing.xxxl, borderRadius: borderRadius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  number: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '700', flex: 1, minWidth: 0 },
  editAction: { minHeight: spacing.rowHeightSm, justifyContent: 'center', paddingHorizontal: spacing.sm },
  editText: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '700' },
  codeLabel: { ...typography.labelSm, color: colors.secondary, fontWeight: '700', letterSpacing: 0.8, marginBottom: spacing.sm },
  codeArea: { position: 'relative', marginBottom: spacing.lg },
  cells: { flexDirection: 'row', gap: spacing.xs },
  cell: { flex: 1, minWidth: 0, minHeight: spacing.rowHeightStandard + spacing.sm, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.md, backgroundColor: colors.surfaceContainerLow },
  filled: { backgroundColor: colors.selectionTint, borderColor: colors.selectionOutline },
  focused: { borderColor: colors.homeAction, borderWidth: 2 },
  invalid: { borderColor: colors.error },
  digit: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' },
  codeInput: { ...StyleSheet.absoluteFillObject, opacity: 0, fontSize: typography.bodyLg.fontSize },
  resend: { minHeight: spacing.rowHeightStandard, justifyContent: 'center', alignItems: 'center', marginVertical: spacing.sm },
});

