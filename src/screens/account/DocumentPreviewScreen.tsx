import React, { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { ZoomableDocumentPage } from '../../components/documents/ZoomableDocumentPage';
import { useDocumentPreview, useSecureDocumentScreen } from '../../hooks/useDocumentPreview';
import { colors, spacing, typography } from '../../theme';
import type { AccountScreenProps } from '../../types/navigation';
import { statusLabel } from '../../services/documents/DocumentPreviewService';

export function DocumentPreviewScreen({ navigation, route }: AccountScreenProps<'DocumentPreview'>) {
  useSecureDocumentScreen();
  const state = useDocumentPreview(route.params);
  const { width, height } = useWindowDimensions();
  const [page, setPage] = useState(1);
  const onVisible = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    if (viewableItems[0]) setPage((viewableItems[0].index ?? 0) + 1);
  }).current;
  return <SafeAreaView style={styles.root}>
    <AppHeader title={state.preview?.name ?? 'Document preview'} showBackButton onBackPress={() => navigation.goBack()} />
    {state.loading ? <ActivityIndicator accessibilityLabel="Loading private document" /> : state.error ?
      <Text style={styles.message} accessibilityLiveRegion="polite">{state.error}</Text> : null}
    {state.preview ? <>
      <Text style={styles.message}>{statusLabel(state.preview.status)}</Text>
      <Text style={styles.message}>{state.preview.contentType === 'application/pdf' ? `PDF · Page ${page} of ${state.preview.pageCount}` : 'Image'} · Pinch or double-tap to zoom</Text>
      <FlatList data={state.preview.pages} key={state.preview.handle} keyExtractor={(_item, index) => String(index)}
        initialNumToRender={1} maxToRenderPerBatch={1} windowSize={3} removeClippedSubviews
        onViewableItemsChanged={onVisible} viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
        renderItem={({ item, index }) => <ZoomableDocumentPage preview={state.preview!} page={index} width={width}
          height={state.preview!.contentType === 'application/pdf' ? Math.max(120, width * item.height / item.width) : Math.max(200, height - 180)} />} />
    </> : null}
    <Pressable style={styles.retry} onPress={state.retry} accessibilityRole="button"><Text style={styles.retryText}>Retry / refresh private preview</Text></Pressable>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.surface }, message: { ...typography.bodyMd, padding: spacing.sm, color: colors.onSurfaceVariant }, retry: { padding: spacing.sm, minHeight: 44, alignItems: 'center' }, retryText: { ...typography.bodyMd, color: colors.startupBlueDark } });
