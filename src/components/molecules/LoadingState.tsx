import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { colors, typography, spacing } from '../../theme';
import { useI18n } from '../../i18n';

export type LoadingVariant =
  | 'searching_trips'
  | 'cancellation'
  | 'recharge'
  | 'subscription'
  | 'uploading'
  | 'verifying'
  | 'generic';

export interface LoadingStateProps {
  readonly variant: LoadingVariant;
  readonly title?: string;
  readonly subtitle?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  variant,
  title,
  subtitle,
  style,
  testID,
}) => {
  const { t } = useI18n();

  const getDefaults = (v: LoadingVariant): { title: string; subtitle: string } => {
    switch (v) {
      case 'searching_trips':
        return { title: t('loading.findingTrip'), subtitle: t('loading.findingTripSub') };
      case 'cancellation':
        return { title: t('loading.cancellation'), subtitle: t('loading.cancellationSub') };
      case 'recharge':
        return { title: t('loading.recharge'), subtitle: t('loading.rechargeSub') };
      case 'subscription':
        return { title: t('loading.subscription'), subtitle: t('loading.subscriptionSub') };
      case 'uploading':
        return { title: t('loading.uploading'), subtitle: t('loading.uploadingSub') };
      case 'verifying':
        return { title: t('loading.verifying'), subtitle: t('loading.verifyingSub') };
      case 'generic':
      default:
        return { title: t('loading.generic'), subtitle: t('loading.genericSub') };
    }
  };

  const defaults = getDefaults(variant);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <ActivityIndicator size="large" color={colors.primary} />
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
    gap: spacing.containerPadding,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
});

export default LoadingState;
