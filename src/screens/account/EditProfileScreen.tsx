import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { AppHeader } from '../../components/molecules/AppHeader';
import { usePartnerProfile } from '../../hooks/usePartnerProfile';
import { normalizeProfileName, profileNameError, type PartnerProfile } from '../../services/profile/PartnerProfileService';
import { colors, spacing, typography, borderRadius } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

function ReadOnlyField({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return <View style={styles.readOnly}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value || 'Not available'}</Text><Text style={styles.hint}>{hint}</Text></View>;
}
function ProfileForm({ profile, saving, saveName, onBack }: { profile: PartnerProfile; saving: boolean; saveName: (name: string) => Promise<string>; onBack: () => void }) {
  const [name, setName] = useState(profile.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const locked = ['REJECTED', 'SUSPENDED'].includes(profile.approvalStatus);
  const submit = async () => {
    if (saving || locked) return;
    const invalid = profileNameError(name); setFieldError(invalid); setError(null); setNotice(null);
    if (invalid) return;
    try { const actual = await saveName(name); setName(actual); setNotice('Profile updated successfully.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile. Please retry.'); }
  };
  return <>
    <View style={styles.photoSection}>
      {profile.photoUrl ? <Image source={{ uri: profile.photoUrl }} style={styles.photo} accessibilityLabel="Current profile photo" />
        : <View style={[styles.photo, styles.placeholder]}><Icon name="person" size={44} color={colors.navigationIcon} /></View>}
      <Text style={styles.label}>Profile photo</Text>
      <Text style={styles.hint}>Changing your profile photo is not available yet. Identity photos remain in Documents.</Text>
    </View>
    <View style={styles.field}><Text style={styles.label}>Full name</Text><TextInput accessibilityLabel="Full name" value={name} editable={!saving && !locked} maxLength={120}
      autoCapitalize="words" autoComplete="name" textContentType="name" style={styles.nameInput}
      onChangeText={value => { setName(value); setFieldError(null); setError(null); setNotice(null); }} /></View>
    {fieldError ? <Text accessibilityRole="alert" style={styles.error}>{fieldError}</Text> : null}
    <Text style={styles.hint}>Updates your partner profile name. Verified identity-document names are protected.</Text>
    <ReadOnlyField label="Verified phone number · Read-only" value={profile.phone} hint="Changing your verified number is not currently supported." />
    <ReadOnlyField label="Email address · Read-only" value={profile.email} hint="Email updates are not currently supported." />
    <ReadOnlyField label="Residential address · Read-only" value={profile.address} hint="Address updates are not currently supported." />
    {locked ? <Text accessibilityRole="alert" style={styles.error}>Profile updates are unavailable while your account is restricted.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.success}>{notice}</Text> : null}
    <PrimaryButton label="Save Changes" loading={saving} disabled={locked || normalizeProfileName(name) === normalizeProfileName(profile.name)} onPress={submit} />
    <SecondaryButton label="Cancel" disabled={saving} onPress={onBack} />
  </>;
}
export function EditProfileScreen({ navigation }: AccountScreenProps<'EditProfile'>) {
  const state = usePartnerProfile();
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AppHeader title="Edit Profile" onBackPress={() => navigation.goBack()} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {state.loading ? <ActivityIndicator accessibilityLabel="Loading profile" color={colors.primary} /> : null}
        {state.error ? <><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text><PrimaryButton label="Retry" onPress={state.refresh} /></> : null}
        {state.profile ? <ProfileForm key={state.profile.driverId} profile={state.profile} saving={state.saving} saveName={state.saveName} onBack={() => navigation.goBack()} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.containerPadding, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xl },
  photoSection: { alignItems: 'center', gap: spacing.xs }, photo: { width: 88, height: 88, borderRadius: 44 }, placeholder: { backgroundColor: colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  field: { gap: spacing.xs },
  nameInput: { ...typography.bodyLg, color: colors.onSurface, minHeight: 48, padding: spacing.gutter, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: borderRadius.md, backgroundColor: colors.surfaceContainerLowest },
  readOnly: { padding: spacing.containerPadding, gap: spacing.unit, borderRadius: borderRadius.lg, backgroundColor: colors.surfaceContainerLow },
  label: { ...typography.headlineSm, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurface }, hint: { ...typography.bodyMd, color: colors.onSurfaceMuted },
  error: { ...typography.bodyMd, color: colors.error }, success: { ...typography.bodyMd, color: colors.success },
});
