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

export interface VehicleDocumentsScreenProps {
  readonly navigation: AccountScreenProps<'VehicleDocuments'>['navigation'];
  readonly testID?: string;
}
export const VehicleDocumentsScreen: React.FC<VehicleDocumentsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { summary, loading, error, refresh } = useDriverOnboarding();
  const vehicle = summary?.activeVehicle ?? summary?.vehicles[0] ?? null;
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <AppHeader
        title="Vehicle documents"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {vehicle ? (
          <>
            <View style={styles.card}>
              <Text style={styles.title}>{vehicle.makeModel}</Text>
              <Text style={styles.body}>
                {vehicle.registrationNumber} ·{' '}
                {vehicle.category.replace(/_/g, ' ')}
              </Text>
              <Text style={styles.status}>
                {vehicle.status.replace(/_/g, ' ')}
              </Text>
            </View>
            {vehicle.documents.map(document => (
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
          </>
        ) : !loading ? (
          <Text style={styles.body}>No vehicle is registered.</Text>
        ) : null}
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
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  status: { ...typography.bodyMd, color: colors.success },
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
export default VehicleDocumentsScreen;
