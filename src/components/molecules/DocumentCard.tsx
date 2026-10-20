import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { StatusBadge, type BadgeVariant } from '../atoms/StatusBadge';
import { useI18n } from '../../i18n';

export interface DocumentCardProps {
  readonly label: string;
  readonly status: BadgeVariant;
  readonly statusLabel: string;
  readonly rejectionReason?: string;
  readonly onActionPress?: () => void;
  readonly actionLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  label,
  status,
  statusLabel,
  rejectionReason,
  onActionPress,
  actionLabel,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name="" />
        </View>
        <View style={styles.content}>
          <Text style={styles.label}>{label}</Text>
          <StatusBadge label={statusLabel} variant={status} />
        </View>
      </View>
      {rejectionReason ? (
        <View style={styles.rejectionContainer}>
          <Text style={styles.rejectionLabel}>{t('kyc.rejectionReason')}</Text>
          <Text style={styles.rejectionText}>{rejectionReason}</Text>
        </View>
      ) : null}
      {onActionPress && actionLabel ? (
        <Pressable
          onPress={onActionPress}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.containerPadding,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.gutter,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    color: colors.primary,
  },
  content: {
    flex: 1,
    gap: spacing.unit,
  },
  label: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  rejectionContainer: {
    padding: spacing.gutter,
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.sm,
    gap: spacing.unit,
  },
  rejectionLabel: {
    ...typography.labelSm,
    color: colors.onErrorContainer,
    fontWeight: '600',
  },
  rejectionText: {
    ...typography.bodyMd,
    color: colors.onErrorContainer,
  },
  actionButton: {
    alignSelf: 'flex-end',
  },
  actionLabel: {
    ...typography.labelCaps,
    color: colors.primary,
  },
});

export default DocumentCard;
