import React from 'react';
import { Text, View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountGroup, AccountHeader } from '../../components/account/AccountLayout';
import { SettingsRow } from '../../components/molecules/SettingsRow';
import { colors } from '../../theme';
import { useI18n } from '../../i18n';
import type { AccountScreenProps } from '../../types/navigation';

export interface SettingsScreenProps {
  navigation: AccountScreenProps<'Settings'>['navigation'];
  testID?: string;
}
export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation, testID }) => {
  const { locale } = useI18n();
  return <SafeAreaView style={styles.page} edges={['top', 'left', 'right']} testID={testID}>
    <AccountHeader title="Settings" onBack={() => navigation.goBack()} onNotifications={() => navigation.navigate('Notifications')} />
    <ScrollView contentContainerStyle={styles.body}>
      <View>
        <Text style={styles.heading}>PREFERENCES</Text>
        <AccountGroup>
          <SettingsRow label="Language" value={locale === 'hi' ? 'Hindi' : 'English'} iconName="language" compact mint
            onPress={() => navigation.navigate('LanguageSelection')} />
          <SettingsRow label="Floating window" iconName="picture_in_picture_alt" compact onPress={() => navigation.navigate('FloatingWindow')} />
          <SettingsRow label="Notifications" iconName="notifications_none" compact last onPress={() => navigation.navigate('Notifications')} />
        </AccountGroup>
      </View>
      <View>
        <Text style={styles.heading}>HELP & PRIVACY</Text>
        <AccountGroup>
          <SettingsRow label="Help & support" iconName="headset_mic" compact mint onPress={() => navigation.navigate('Support')} />
          <SettingsRow label="Privacy & permissions" subtitle="Policy and device permissions" iconName="shield" compact last
            onPress={() => navigation.navigate('Privacy')} />
        </AccountGroup>
      </View>
    </ScrollView>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  body: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28, gap: 28 },
  heading: { fontSize: 10, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8, color: colors.onSurfaceMuted, marginBottom: 12, marginLeft: 2 },
});
export default SettingsScreen;
