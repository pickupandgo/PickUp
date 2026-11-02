import React, { useCallback } from 'react';
import { View, Text, SectionList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { mockSettingsSections } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { SettingsRow } from '../../components/molecules/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import type { SettingsItem } from '../../types/user';
import type { AccountScreenProps } from '../../types/navigation';

const noParamRoutes = new Set<string>([
  'Profile', 'DocumentsHub', 'PersonalDocuments', 'KYCStatus', 'VehicleDocuments', 'VehicleStatus',
  'Settings', 'Subscription', 'SubscriptionProcessing', 'LanguageSelection', 'AccountRestricted',
]);

export interface SettingsScreenProps {
  readonly navigation: AccountScreenProps<'Settings'>['navigation'];
  readonly testID?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { logout } = useAuth();
  
  const handlePress = useCallback(async (item: SettingsItem) => {
    if (item.id === 's9') {
      await logout();
      return;
    }
    if (item.route && noParamRoutes.has(item.route)) {
      navigation.navigate(item.route as 'Profile');
    }
  }, [navigation, logout]);

  const sections = mockSettingsSections.map((section) => ({
    title: section.title,
    data: [...section.items],
  }));

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title="Settings"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SettingsRow
            label={item.label}
            value={item.value}
            iconName={item.iconName}
            hasChevron={item.hasChevron}
            onPress={() => handlePress(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.containerPadding,
    marginBottom: spacing.gutter,
  },
  separator: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
});

export default SettingsScreen;
