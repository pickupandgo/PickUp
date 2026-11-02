import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDocumentPage, useDocumentPreview } from '../../hooks/useDocumentPreview';
import { documentName, documentReviewInfo, statusLabel, type SavedDocument } from '../../services/documents/DocumentPreviewService';
import { colors, spacing, borderRadius, typography } from '../../theme';

export function DocumentCard({ document, onView, revision = 0, vehicleLabel }: { document: SavedDocument; onView: () => void; revision?: number; vehicleLabel?: string }) {
  const state = useDocumentPreview(document.ref, revision);
  const page = useDocumentPage(state.preview, 0, 240);
  const title = documentName(document.record.documentType);
  return <View style={styles.card} testID={`document-${document.record.id}`}>
    <Pressable onPress={onView} style={styles.row} accessibilityRole="button" accessibilityLabel={`View ${title}`}>
      <View style={styles.thumbnail}>
        {state.loading || (state.preview && !page.uri && !page.error) ? <ActivityIndicator accessibilityLabel="Loading document preview" /> :
          page.uri ? <Image source={{ uri: page.uri }} resizeMode="contain" style={styles.image} accessibilityLabel={`${title} preview`} /> :
            <Text style={styles.hint}>Preview unavailable</Text>}
      </View>
      <View style={styles.details}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.status, document.record.status === 'VERIFIED' && styles.verified,
          document.record.status === 'REJECTED' && styles.rejected]}>{statusLabel(document.record.status)}</Text>
        {state.preview?.contentType === 'application/pdf' ? <Text style={styles.hint}>PDF · {state.preview.pageCount} pages</Text> : null}
        {document.record.rejectionReason ? <Text style={styles.rejected}>{document.record.rejectionReason}</Text> : null}
        {documentReviewInfo(document.record) ? <Text style={styles.hint}>{documentReviewInfo(document.record)}</Text> : null}
        {document.ref.kind === 'VEHICLE' ? <Text style={styles.hint}>{vehicleLabel ?? 'Vehicle document'}</Text> : null}
        <Text style={styles.view}>View document</Text>
      </View>
    </Pressable>
    {state.error || page.error ? <View style={styles.failure}>
      <Text style={styles.hint} accessibilityLiveRegion="polite">{state.error ?? 'Preview unavailable. Please retry.'}</Text>
      <Pressable onPress={state.retry} accessibilityRole="button" accessibilityLabel={`Retry ${title} preview`} style={styles.retry}><Text style={styles.view}>Retry preview</Text></Pressable>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.outlineVariant, padding: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumbnail: { width: 76, height: 84, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.sm },
  image: { width: '100%', height: '100%' }, details: { flex: 1, minWidth: 0, gap: spacing.unit },
  title: { ...typography.bodyMd, fontWeight: '600', color: colors.onSurface },
  status: { ...typography.labelSm, color: colors.onSurfaceVariant }, verified: { color: colors.success }, rejected: { ...typography.labelSm, color: colors.error },
  hint: { ...typography.labelSm, color: colors.onSurfaceVariant, flexShrink: 1 }, view: { ...typography.labelSm, fontWeight: '700', color: colors.startupBlueDark },
  failure: { gap: spacing.unit }, retry: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
});
