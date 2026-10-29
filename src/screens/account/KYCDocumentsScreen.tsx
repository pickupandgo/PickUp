import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useDriverOnboarding } from '../../hooks/useDriverOnboarding';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export interface KYCDocumentsScreenProps {
  readonly navigation: AccountScreenProps<'KYCDocuments'>['navigation'];
  readonly testID?: string;
}

export const KYCDocumentsScreen: React.FC<KYCDocumentsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { summary, loading, error, refresh } = useDriverOnboarding();
  const documents = summary?.kyc?.documents ?? [];
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <AppHeader
        title="Identity documents"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {summary?.kyc ? (
          <View style={styles.card}>
            <Text style={styles.title}>KYC status</Text>
            <Text style={styles.status}>
              {summary.kyc.status.replace(/_/g, ' ')}
            </Text>
            {summary.kyc.rejectionReason ? (
              <Text style={styles.error}>{summary.kyc.rejectionReason}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.body}>
            No identity verification application exists.
          </Text>
        )}
        {documents.map(document => (
          <View key={document.id} style={styles.card}>
            <Text style={styles.title}>
              {document.documentType.replace(/_/g, ' ')}
            </Text>
            <Text style={styles.body}>
              {document.status.replace(/_/g, ' ')}
            </Text>
            {document.rejectionReason ? (
              <Text style={styles.error}>{document.rejectionReason}</Text>
            ) : null}
          </View>
        ))}
        <Pressable style={styles.button} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { gap: spacing.gutter, padding: spacing.containerPadding },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.containerPadding,
  },
  title: { ...typography.bodyMd, color: colors.onSurface, fontWeight: '700' },
  status: { ...typography.bodyMd, color: colors.success },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  error: { ...typography.bodyMd, color: colors.error },
  button: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.gutter,
  },
  buttonText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
  },
});
export default KYCDocumentsScreen;
