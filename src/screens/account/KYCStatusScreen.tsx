import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useDriverOnboarding } from '../../hooks/useDriverOnboarding';
import { useSecureDocumentScreen } from '../../hooks/useDocumentPreview';
import { documentName, documentReviewInfo, savedDocuments, statusLabel } from '../../services/documents/DocumentPreviewService';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';

export function KYCStatusScreen({ navigation }: AccountScreenProps<'KYCStatus'>) {
  useSecureDocumentScreen();
  const { summary, loading, error, refresh } = useDriverOnboarding();
  const documents = summary ? savedDocuments(summary, 'KYC') : [];
  const required = summary?.requiredDocuments.kyc ?? [];
  const types = [...new Set([...required, ...documents.map(doc => doc.record.documentType)])];
  return <SafeAreaView style={styles.root}>
    <AppHeader title="KYC Status" showBackButton onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator accessibilityLabel="Loading KYC status" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {summary?.kyc ? <View style={styles.card}>
        <Text style={styles.title}>Overall KYC status</Text>
        <Text style={[styles.body, summary.kyc.status === 'VERIFIED' && styles.verified,
          summary.kyc.status === 'REJECTED' && styles.error]}>{statusLabel(summary.kyc.status)}</Text>
        {summary.kyc.rejectionReason ? <Text style={styles.error}>{summary.kyc.rejectionReason}</Text> : null}
      </View> : !loading && !error ? <Text style={styles.body}>KYC not submitted.</Text> : null}
      {types.map(type => {
        const document = documents.find(item => item.record.documentType === type);
        return <View key={type} style={styles.card}>
          <Text style={styles.title}>{documentName(type)}</Text>
          <Text style={[styles.body, document?.record.status === 'VERIFIED' && styles.verified,
            document?.record.status === 'REJECTED' && styles.error]}>{document ? statusLabel(document.record.status) : 'Not submitted'}</Text>
          {required.includes(type) ? <Text style={styles.hint}>Required document</Text> : null}
          {document?.record.rejectionReason ? <Text style={styles.error}>{document.record.rejectionReason}</Text> : null}
          {document && documentReviewInfo(document.record) ? <Text style={styles.hint}>{documentReviewInfo(document.record)}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${documentName(type)} in Personal Documents`}
            style={styles.action} onPress={() => navigation.navigate('PersonalDocuments', document ? { documentId: document.record.id } : undefined)}>
            <Text style={styles.link}>Personal Documents</Text>
          </Pressable>
        </View>;
      })}
      <Pressable style={styles.action} accessibilityRole="button" onPress={() => navigation.navigate('VehicleDocuments')}>
        <Text style={styles.link}>Vehicle Details</Text>
      </Pressable>
      <Pressable style={styles.action} accessibilityRole="button" onPress={() => { refresh().catch(() => undefined); }}><Text style={styles.link}>Refresh status</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { gap: spacing.sm, padding: spacing.containerPadding, paddingBottom: spacing.xxl },
  card: { padding: spacing.containerPadding, gap: spacing.xs, borderRadius: borderRadius.lg, borderWidth: 1,
    borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest },
  title: { ...typography.bodyMd, fontWeight: '700', color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  hint: { ...typography.labelSm, color: colors.onSurfaceVariant }, verified: { color: colors.success }, error: { ...typography.bodyMd, color: colors.error },
  action: { minHeight: 44, justifyContent: 'center' }, link: { ...typography.bodyMd, color: colors.startupBlueDark, fontWeight: '600' },
});
