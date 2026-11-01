import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { getAuth } from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from 'react-native-vector-icons/Feather';
import { AuthLayout, authStyles } from '../auth/AuthLayout';
import InputField from '../../components/atoms/InputField';
import { AuthButton as Button } from '../auth/AuthLayout';
import { useSession } from '../../state/SessionContext';
import { type CustomerProfileData } from '../../state/session';
import { profileIssues, hasRequiredProfile } from '../../state/profileValidation';
import { toApiError } from '../../api/http';
import { colors, spacing } from '../../theme';

export interface ProfileDetailsProps { editing?: boolean; navigation?: any; onSave?: () => void; onBack?: () => void; }
export default function ProfileDetailsForm({ editing = false, navigation, onSave, onBack }: ProfileDetailsProps) {
  const { userProfile, markProfileDone, logout } = useSession();
  const user = getAuth().currentUser;
  const uid = user?.uid;
  const [form, setForm] = useState<CustomerProfileData>(() => ({
    fullName: userProfile?.fullName || user?.displayName || '',
    email: userProfile?.email || user?.email || '',
    age: userProfile?.age || '', address: userProfile?.address || '',
  }));
  const [touched, setTouched] = useState<Partial<Record<keyof CustomerProfileData, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const dirty = useRef(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const draftWrites = useRef<Promise<unknown>>(Promise.resolve());
  const draftKey = uid ? 'pickup.profileDraft.' + uid + (editing ? '.edit' : '.onboarding') : null;
  const issues = profileIssues(form);
  const phone = user?.phoneNumber || userProfile?.phone;
  const inputRefs = useRef<Record<string, any>>({});
  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (!draftKey) { setDraftReady(true); return; }
    void AsyncStorage.getItem(draftKey).then(raw => {
      if (!active || !raw || dirty.current) return;
      try {
        const draft = JSON.parse(raw);
        dirty.current = true;
        const fields = ['fullName', 'email', 'age', 'address'] as const;
        setForm(initial => {
          const merged = { ...initial };
          fields.forEach(field => { if (typeof draft[field] === 'string') merged[field] = draft[field]; });
          return merged;
        });
      } catch { /* A malformed draft never blocks remote profile completion. */ }
    }).catch(() => {}).finally(() => { if (active) setDraftReady(true); });
    return () => { active = false; mounted.current = false; };
  }, [draftKey]);
  useEffect(() => {
    if (!dirty.current && userProfile) setForm({ fullName: userProfile.fullName, email: userProfile.email,
      age: userProfile.age || '', address: userProfile.address || '' });
  }, [userProfile]);
  useEffect(() => {
    if (!draftReady || !draftKey) return;
    const raw = JSON.stringify(form);
    draftWrites.current = draftWrites.current.then(() => AsyncStorage.setItem(draftKey, raw)).catch(() => {});
  }, [form, draftReady, draftKey]);
  const update = (field: keyof CustomerProfileData, value: string) => {
    dirty.current = true; setForm(prev => ({ ...prev, [field]: value })); setError(null);
  };
  const discardDraft = async () => {
    await draftWrites.current;
    if (draftKey) await AsyncStorage.removeItem(draftKey).catch(() => {});
  };
  const save = async () => {
    if (lock.current) return;
    setTouched({ fullName: true, email: true, age: true, address: true }); setError(null);
    if (!hasRequiredProfile(form) || !phone) return;
    lock.current = true; setBusy(true);
    try {
      await markProfileDone(form);
      await discardDraft();
      if (!mounted.current || getAuth().currentUser?.uid !== uid) return;
      onSave?.();
      if (editing) navigation?.goBack();
    } catch (e) {
      const api = toApiError(e);
      if (mounted.current) setError(api.status === 404
        ? 'Profile saving is unavailable right now. Your details are kept here; please try again later.'
        : api.userMessage);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const signOut = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await discardDraft(); await logout(); }
    catch { if (mounted.current) setError('Could not sign out. Please try again.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const fields = [
    { key: 'fullName', label: 'Full name', placeholder: 'Enter your full name', max: 120, keyboard: 'default', caps: 'words', next: 'email' },
    { key: 'email', label: 'Email address', placeholder: 'Enter your email address', max: 255, keyboard: 'email-address', caps: 'none', next: 'age' },
    { key: 'age', label: 'Age', placeholder: 'Enter your age', max: 3, keyboard: 'number-pad', caps: 'none', next: 'address' },
    { key: 'address', label: 'Location / address', placeholder: 'Enter your location or address', max: 500, keyboard: 'default', caps: 'sentences' },
  ] as const;
  return <AuthLayout onBack={editing ? (onBack || (() => navigation?.goBack())) : undefined}
    onSignOut={editing ? undefined : signOut} busy={busy}>
    {phone && <View style={authStyles.badge}>
      <Feather name="check-circle" size={spacing.xl} color={colors.statusGreen} />
      <Text style={authStyles.badgeText}>Mobile verified · {phone}</Text>
    </View>}
    <Text style={authStyles.title}>{editing ? 'Edit your profile' : 'Complete your profile'}</Text>
    <Text style={authStyles.body}>All fields are required.</Text>
    {error && <Text style={authStyles.error} accessibilityRole="alert">{error}</Text>}
    {!phone && <Text style={authStyles.error}>Verify your mobile number before continuing.</Text>}
    <View style={authStyles.form}>
      {fields.map(field => <InputField key={field.key}
        ref={ref => { inputRefs.current[field.key] = ref; }}
        label={field.label} placeholder={field.placeholder} value={form[field.key] || ''}
        onChangeText={value => update(field.key, value)} editable={!busy && draftReady}
        maxLength={field.max} keyboardType={field.keyboard} autoCapitalize={field.caps}
        autoCorrect={false} error={touched[field.key] ? issues[field.key] : undefined}
        onBlur={() => setTouched(prev => ({ ...prev, [field.key]: true }))}
        returnKeyType={'next' in field ? 'next' : 'done'}
        onSubmitEditing={() => { if ('next' in field) inputRefs.current[field.next]?.focus(); else void save(); }} />)}
      <Button label={editing ? 'Save changes' : 'Save & Continue'} onPress={save} loading={busy}
        disabled={!hasRequiredProfile(form) || !phone || busy || !draftReady} fullWidth style={authStyles.button} />
    </View>
  </AuthLayout>;
}

