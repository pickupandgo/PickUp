import React, { useCallback } from 'react';
import { View, Text, SectionList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { SettingsRow } from '../../components/molecules/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import type { AccountScreenProps } from '../../types/navigation';

type Setting = { label: string; iconName: string; route: 'FloatingWindow' | 'EditProfile' | 'LanguageSelection' | 'VehicleDocuments' | 'PersonalDocuments' | 'Notifications' | 'Privacy' | 'HelpSupport' | 'Logout'; value?: string };
const groups: { title: string; data: Setting[] }[] = [
  { title: 'Personal', data: [{ label: 'Profile', iconName: 'person', route: 'EditProfile' }, { label: 'Language', iconName: 'language', route: 'LanguageSelection' }] },
  { title: 'Vehicle & Service', data: [{ label: 'Vehicle Details', iconName: 'local_shipping', route: 'VehicleDocuments' }, { label: 'Personal Documents', iconName: 'description', route: 'PersonalDocuments' }] },
  { title: 'Preferences', data: [{ label: 'Notifications', iconName: 'notifications', route: 'Notifications' }, { label: 'Floating window', iconName: 'picture_in_picture_alt', route: 'FloatingWindow' }, { label: 'Privacy', iconName: 'lock', route: 'Privacy' }] },
  { title: 'Account', data: [{ label: 'Help & Support', iconName: 'help', route: 'HelpSupport' }, { label: 'Logout', iconName: 'logout', route: 'Logout' }] },
];
const SettingsSeparator = () => <View style={styles.separator} />;

export interface SettingsScreenProps {
  readonly navigation: AccountScreenProps<'Settings'>['navigation'];
  readonly testID?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { logout } = useAuth();
  const { locale } = useI18n();
  
  const handlePress = useCallback(async (item: Setting) => {
    if (item.route === 'Logout') {
      await logout();
      return;
    }
    navigation.navigate(item.route);
  }, [navigation, logout]);

  const sections = groups.map(section => ({ ...section, data: section.data.map(item => item.route === 'LanguageSelection' ? { ...item, value: locale === 'hi' ? 'हिन्दी' : 'English' } : item) }));

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
      <AppHeader
        title="Settings"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.route}
        renderItem={({ item }) => (
          <SettingsRow
            label={item.label}
            value={item.value}
            iconName={item.iconName}
            hasChevron={item.route !== 'Logout'}
            onPress={() => handlePress(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={SettingsSeparator}
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
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
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
