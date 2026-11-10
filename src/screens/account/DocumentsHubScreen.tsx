import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountGroup, AccountHeader } from '../../components/account/AccountLayout';
import { DocumentNavigationCard } from '../../components/documents/DocumentNavigationCard';
import { colors } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

const categories = [
  { title: 'Personal documents', subtitle: 'Identity and driver documents', icon: 'person_outline', route: 'PersonalDocuments', mint: true },
  { title: 'Vehicle documents', subtitle: 'Registration and insurance', icon: 'directions_car', route: 'VehicleDocuments', mint: true },
  { title: 'KYC status', subtitle: 'View your verification progress', icon: 'assignment', route: 'KYCStatus', mint: false },
] as const;

export function DocumentsHubScreen({ navigation }: AccountScreenProps<'DocumentsHub'>) {
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <AccountHeader title="Documents" onBack={() => navigation.goBack()} onNotifications={() => navigation.navigate('Notifications')} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Your documents and verification</Text>
      <AccountGroup>
        {categories.map((category, index) => <DocumentNavigationCard key={category.route} title={category.title}
          subtitle={category.subtitle} icon={category.icon} compact mint={category.mint} last={index === categories.length - 1}
          onPress={() => navigation.navigate(category.route)} />)}
      </AccountGroup>
      <AccountGroup>
        <DocumentNavigationCard title="Vehicle details" subtitle="View your registered vehicle" icon="local_shipping" compact mint last
          onPress={() => navigation.navigate('VehicleStatus')} />
      </AccountGroup>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, gap: 24 },
  subtitle: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
});
