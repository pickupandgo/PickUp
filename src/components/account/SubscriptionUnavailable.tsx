import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../molecules/AppHeader';
import { PrimaryButton } from '../atoms/PrimaryButton';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';

/** No entitlement or payment provider is integrated. Even old success routes must stay truthful. */
export function SubscriptionUnavailable({
  onBack,
  testID,
}: {
  onBack: () => void;
  testID?: string;
}) {
  return (
    <SafeAreaView style={styles.page} testID={testID}>
      <AppHeader title="Subscription" showBackButton onBackPress={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Icon name="info_outline" size={36} color={colors.primary} />
          <Text style={styles.title}>Subscriptions are not available yet</Text>
          <Text style={styles.text}>
            This app cannot purchase, activate or confirm a subscription. No
            plan status or payment success is verified here.
          </Text>
          <PrimaryButton label="Back" onPress={onBack} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  body: { padding: spacing.containerPadding },
  card: {
    padding: spacing.lg,
    gap: spacing.containerPadding,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  title: { ...typography.headlineMd, color: colors.onSurface },
  text: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});
