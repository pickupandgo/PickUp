import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { DocumentNavigationCard } from '../../components/documents/DocumentNavigationCard';
import { colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export function PrivacyScreen({ navigation }: AccountScreenProps<'Privacy'>) {
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AppHeader title="Privacy" onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.description}>Policies, permissions and help with your personal information.</Text>
      <DocumentNavigationCard title="Privacy Policy" subtitle="Read MultipleRide’s published privacy policy." icon="policy" onPress={() => navigation.navigate('LegalInformation', { document: 'privacy' })} />
      <DocumentNavigationCard title="Terms of Service" subtitle="Partner terms and service information." icon="description" onPress={() => navigation.navigate('LegalInformation', { document: 'terms' })} />
      <DocumentNavigationCard title="Data and Permissions" subtitle="Location, camera, document uploads and notifications." icon="admin_panel_settings" onPress={() => navigation.navigate('DataPermissions')} />
      <DocumentNavigationCard title="Privacy Support" subtitle="Questions about your data and account removal information." icon="help_outline" onPress={() => navigation.navigate('HelpSupport', { topic: 'privacy' })} />
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.containerPadding, gap: spacing.containerPadding, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: spacing.xl },
  description: { ...typography.bodyMd, color: colors.onSurfaceMuted },
});
