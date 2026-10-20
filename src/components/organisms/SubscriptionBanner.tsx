import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { StatusBadge, type BadgeVariant } from '../atoms/StatusBadge';
import { useI18n } from '../../i18n';

export interface SubscriptionBannerProps {
  readonly planName: string;
  readonly status: BadgeVariant;
  readonly statusLabel: string;
  readonly validUntil: string;
  readonly onManagePress?: () => void;
  readonly manageLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const SubscriptionBanner: React.FC<SubscriptionBannerProps> = ({
  planName,
  status,
  statusLabel,
  validUntil,
  onManagePress,
  manageLabel,
  style,
  testID,
}) => {
  const { t } = useI18n();
  const resolvedManageLabel = manageLabel ?? t('profile.manage');

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name="" />
        </View>
        <View style={styles.content}>
          <Text style={styles.planName}>{planName}</Text>
          <Text style={styles.validity}>{t('subscription.validUntilDate', { date: validUntil })}</Text>
        </View>
        <StatusBadge label={statusLabel} variant={status} />
      </View>
      {onManagePress ? (
        <Pressable
          onPress={onManagePress}
          accessibilityRole="button"
          accessibilityLabel={resolvedManageLabel}
        >
          <Text style={styles.manageLabel}>{resolvedManageLabel}</Text>
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
    gap: spacing.gutter,
    ...shadows.sm,
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
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    color: colors.secondary,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  planName: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
  validity: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  manageLabel: {
    ...typography.labelCaps,
    color: colors.primary,
    textAlign: 'right',
  },
});

export default SubscriptionBanner;
