import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../atoms/Icon';
import type { ViewStyle } from 'react-native';
import { colors, typography, spacing } from '../../theme';
import { useI18n } from '../../i18n';

export type EmptyVariant =
  | 'trips'
  | 'transactions'
  | 'earnings'
  | 'notifications'
  | 'chat'
  | 'documents'
  | 'generic';

export interface EmptyStateProps {
  readonly variant: EmptyVariant;
  readonly title?: string;
  readonly subtitle?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant,
  title,
  subtitle,
  style,
  testID,
}) => {
  const { t } = useI18n();

  const getDefaults = (v: EmptyVariant): { icon: string; title: string; subtitle: string } => {
    switch (v) {
      case 'trips':
        return { icon: 'local_shipping', title: t('empty.noTrips'), subtitle: t('empty.noTripsSub') };
      case 'transactions':
        return { icon: 'receipt_long', title: t('empty.noTxns'), subtitle: t('empty.noTxnsSub') };
      case 'earnings':
        return { icon: 'payments', title: t('empty.noEarnings'), subtitle: t('empty.noEarningsSub') };
      case 'notifications':
        return { icon: 'notifications_none', title: t('empty.noNotifs'), subtitle: t('empty.noNotifsSub') };
      case 'chat':
        return { icon: 'chat_bubble_outline', title: t('empty.noMessages'), subtitle: t('empty.noMessagesSub') };
      case 'documents':
        return { icon: 'folder_open', title: t('empty.noDocs'), subtitle: t('empty.noDocsSub') };
      case 'generic':
      default:
        return { icon: 'inbox', title: t('empty.generic'), subtitle: t('empty.genericSub') };
    }
  };

  const defaults = getDefaults(variant);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Icon name={defaults.icon} />
      <Text style={styles.title}>{title ?? defaults.title}</Text>
      <Text style={styles.subtitle}>{subtitle ?? defaults.subtitle}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg * 2,
    gap: spacing.xs,
  },
  icon: {
    fontSize: 56,
    color: colors.outline,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default EmptyState;
