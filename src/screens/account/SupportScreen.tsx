import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { SupportContactPanel } from '../../components/account/SupportContactPanel';
import { colors, spacing } from '../../theme';
import type { RootScreenProps } from '../../types/navigation';
export function SupportScreen({ navigation }: RootScreenProps<'Support'>) {
  return (
    <SafeAreaView style={styles.page}>
      <AppHeader
        title="Help & support"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <SupportContactPanel />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.containerPadding, gap: spacing.containerPadding },
});
