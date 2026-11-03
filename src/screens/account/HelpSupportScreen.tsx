import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { legalLinks, openApprovedLink } from '../../config/legal';
import { colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export function HelpSupportScreen({ navigation, route }: AccountScreenProps<'HelpSupport'>) {
  const privacy = route.params?.topic === 'privacy';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AppHeader title={privacy ? 'Privacy Support' : 'Help & Support'} onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{privacy ? 'Questions about your data' : 'Partner support'}</Text>
      <Text style={styles.body}>{legalLinks.support ? 'Open the published support page for assistance.' : 'Support contact information is not available in the app yet. Please check again later.'}</Text>
      {legalLinks.support ? <PrimaryButton label="Contact support" loading={busy} onPress={() => {
        if (busy) return; setBusy(true); setError(null);
        openApprovedLink(legalLinks.support).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not open support.')).finally(() => setBusy(false));
      }} /> : null}
      {privacy ? <><Text style={styles.title}>Account removal and data requests</Text>
        <Text style={styles.body}>This app does not currently provide an account-removal request flow. Read the Privacy Policy for the published contact and data-request instructions.</Text>
        <PrimaryButton label="Privacy Policy" onPress={() => navigation.navigate('LegalInformation', { document: 'privacy' })} />
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.containerPadding, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { ...typography.headlineMd, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceMuted },
});
