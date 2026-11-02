import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { DocumentNavigationCard } from '../../components/documents/DocumentNavigationCard';
import { colors, spacing } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

const categories = [
  { title: 'Vehicle Details', subtitle: 'Vehicle registration and insurance documents', icon: 'local_shipping', route: 'VehicleDocuments' },
  { title: 'Personal Documents', subtitle: 'Identity and personal verification documents', icon: 'badge', route: 'PersonalDocuments' },
  { title: 'KYC Status', subtitle: 'Your identity verification status', icon: 'verified_user', route: 'KYCStatus' },
] as const;

export function DocumentsHubScreen({ navigation }: AccountScreenProps<'DocumentsHub'>) {
  return <SafeAreaView style={styles.root}>
    <AppHeader title="Documents" showBackButton onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      {categories.map(category => <DocumentNavigationCard key={category.route} title={category.title}
        subtitle={category.subtitle} icon={category.icon} onPress={() => navigation.navigate(category.route)} />)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.containerPadding,
    gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
});
