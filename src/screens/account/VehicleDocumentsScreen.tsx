import React, { useState } from 'react';
import { DocumentCard } from '../../components/documents/DocumentCard';
import { clearDocumentPreviews, savedDocuments, statusLabel } from '../../services/documents/DocumentPreviewService';
import { useSecureDocumentScreen } from '../../hooks/useDocumentPreview';
import { currentVehicle } from '../../services/dashboard/HomeDashboardService';
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
  readonly route?: AccountScreenProps<'VehicleDocuments'>['route'];
  readonly testID?: string;
}
export const VehicleDocumentsScreen: React.FC<VehicleDocumentsScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { summary, loading, error, refresh } = useDriverOnboarding();
  useSecureDocumentScreen();
  const [revision, setRevision] = useState(0);
  const vehicle = route?.params?.vehicleId ? summary?.vehicles.find(item => item.id === route.params?.vehicleId) ?? null : summary ? currentVehicle(summary) : null;
  const documents = summary && vehicle ? savedDocuments(summary, 'VEHICLE', vehicle.id) : [];
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
              <Text style={vehicle.status === 'VERIFIED' ? styles.status : styles.body}>
                {statusLabel(vehicle.status)}
              </Text>
            </View>
            {documents.map(document => <DocumentCard key={document.record.id} document={document} revision={revision}
              onView={() => navigation.navigate('DocumentPreview', document.ref)} />)}
            {!loading && !documents.length ? <Text style={styles.body}>No documents uploaded for this vehicle.</Text> : null}
          </>
        ) : !loading ? (
          <Text style={styles.body}>{summary?.vehicles.length ? 'Select a vehicle to view its documents.' : 'No vehicle is registered.'}</Text>
        ) : null}
        {summary?.vehicles.length && summary.vehicles.length > 1 ? summary.vehicles.map(item => <Pressable key={item.id} style={styles.button}
          onPress={() => navigation.navigate('VehicleDocuments', { vehicleId: item.id })}>
          <Text style={styles.buttonText}>{item.makeModel} · {item.registrationNumber}</Text>
        </Pressable>) : null}
        <Pressable style={styles.button} onPress={() => {
          clearDocumentPreviews(); refresh().then(() => setRevision(value => value + 1)).catch(() => undefined);
        }}>
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
