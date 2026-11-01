import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius } from '../../theme';
import Button from '../atoms/Button';
export default function UnavailableFeature({
  title,
  message,
  onBack,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  onBack: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.back}
      >
        <Text style={styles.action}>Back</Text>
      </Pressable>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{message}</Text>
        {actionLabel && onAction && (
          <Button label={actionLabel} onPress={onAction} />
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  back: { paddingVertical: spacing.md },
  action: { ...typography.labelSm, color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  title: { ...typography.headlineSm, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});
