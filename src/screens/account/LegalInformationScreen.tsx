import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { legalLinks, openApprovedLink } from '../../config/legal';
import { colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export function LegalInformationScreen({ navigation, route }: AccountScreenProps<'LegalInformation'>) {
  const privacy = route.params.document === 'privacy';
  const title = privacy ? 'Privacy Policy' : 'Terms of Service';
  const url = privacy ? legalLinks.privacy : legalLinks.terms;
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await openApprovedLink(url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this page. Please retry.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AppHeader title={title} onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      {url ? <>
        <Text style={styles.body}>{privacy ? 'Read the published policy for information about personal data, identity documents, location, device data, retention and your rights.' : 'Read the published Partner terms before using the service.'}</Text>
        <Text style={styles.body}>Opens the MultipleRide page in your browser.</Text>
        <Text selectable style={styles.body}>{url}</Text>
        <PrimaryButton label={`View ${title}`} onPress={open} loading={busy} />
      </> : <Text style={styles.body}>The approved {title} is not available in the app yet. Please check again later.</Text>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.containerPadding, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { ...typography.headlineMd, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceMuted }, error: { ...typography.bodyMd, color: colors.error },
});
