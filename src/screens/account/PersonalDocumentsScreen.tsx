import React, { useRef, useState } from 'react';
import { DocumentCard } from '../../components/documents/DocumentCard';
import { clearDocumentPreviews, savedDocuments } from '../../services/documents/DocumentPreviewService';
import { useSecureDocumentScreen } from '../../hooks/useDocumentPreview';
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

export interface PersonalDocumentsScreenProps {
  readonly navigation: AccountScreenProps<'PersonalDocuments'>['navigation'];
  readonly route?: AccountScreenProps<'PersonalDocuments'>['route'];
  readonly testID?: string;
}

export const PersonalDocumentsScreen: React.FC<PersonalDocumentsScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { summary, loading, error, refresh } = useDriverOnboarding();
  useSecureDocumentScreen();
  const [revision, setRevision] = useState(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<Record<string, number>>({});
  const documents = summary ? savedDocuments(summary, 'KYC') : [];
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <AppHeader
        title="Personal Documents"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView ref={scroll} contentContainerStyle={styles.content}
        onContentSizeChange={() => {
          const id = route?.params?.documentId;
          if (id && offsets.current[id] !== undefined) scroll.current?.scrollTo({ y: offsets.current[id], animated: true });
        }}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {documents.map(document => <View key={document.record.id} onLayout={event => {
          offsets.current[document.record.id] = event.nativeEvent.layout.y;
          if (route?.params?.documentId === document.record.id) scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true });
        }}><DocumentCard document={document} revision={revision}
          onView={() => navigation.navigate('DocumentPreview', document.ref)} /></View>)}
        {!loading && !documents.length ? <Text style={styles.body}>No identity documents uploaded.</Text> : null}
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
export default PersonalDocumentsScreen;
