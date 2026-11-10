import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useDriverOnboarding } from '../../hooks/useDriverOnboarding';
import { colors, spacing, typography, borderRadius } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';
export interface AccountRestrictedScreenProps {
  navigation: AccountScreenProps<'AccountRestricted'>['navigation'];
  testID?: string;
}
export const AccountRestrictedScreen: React.FC<
  AccountRestrictedScreenProps
> = ({ navigation, testID }) => {
  const { summary, loading, error, refresh } = useDriverOnboarding();
  const status = summary?.approvalStatus;
  return (
    <SafeAreaView style={styles.page} testID={testID}>
      <AppHeader
        title="Account review"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {loading
              ? 'Checking your account?'
              : status
              ? status.replace(/_/g, ' ')
              : 'Account status unavailable'}
          </Text>
          <Text style={styles.note}>
            Trip availability follows your current verification status. Contact
            support for review details.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.note}>
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Contact support"
            onPress={() => navigation.navigate('Support')}
          />
          <SecondaryButton
            label="Refresh status"
            disabled={loading}
            onPress={() => void refresh()}
          />
          <SecondaryButton
            label="Privacy & permissions"
            onPress={() => navigation.navigate('Privacy')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.containerPadding },
  card: {
    padding: spacing.containerPadding,
    gap: spacing.containerPadding,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  title: { ...typography.headlineMd, color: colors.onSurface },
  note: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});
export default AccountRestrictedScreen;
