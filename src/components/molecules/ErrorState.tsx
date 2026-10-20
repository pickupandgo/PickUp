import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../atoms/Icon';
import type { ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';
import { useI18n } from '../../i18n';

export type ErrorVariant =
  | 'network'
  | 'location_permission'
  | 'gps_unavailable'
  | 'trip_expired'
  | 'otp_error'
  | 'cancellation_failed'
  | 'recharge_failed'
  | 'subscription_failed'
  | 'kyc_rejected'
  | 'account_restricted'
  | 'chat_failed'
  | 'generic';

export interface ErrorStateProps {
  readonly variant: ErrorVariant;
  readonly title?: string;
  readonly subtitle?: string;
  readonly primaryActionLabel?: string;
  readonly onPrimaryAction?: () => void;
  readonly secondaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  variant,
  title,
  subtitle,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  style,
  testID,
}) => {
  const { t } = useI18n();

  const getDefaults = (v: ErrorVariant): { icon: string; title: string; subtitle: string } => {
    switch (v) {
      case 'network':
        return { icon: 'wifi_off', title: t('error.noInternet'), subtitle: t('error.noInternetSub') };
      case 'location_permission':
        return { icon: 'location_off', title: t('error.locationRequired'), subtitle: t('error.locationRequiredSub') };
      case 'gps_unavailable':
        return { icon: 'gps_off', title: t('error.gpsUnavailable'), subtitle: t('error.gpsUnavailableSub') };
      case 'trip_expired':
        return { icon: 'timer_off', title: t('error.tripExpired'), subtitle: t('error.tripExpiredSub') };
      case 'otp_error':
        return { icon: 'sms_failed', title: t('error.verificationFailed'), subtitle: t('error.verificationFailedSub') };
      case 'cancellation_failed':
        return { icon: 'cancel', title: t('error.cancellationFailed'), subtitle: t('error.cancellationFailedSub') };
      case 'recharge_failed':
        return { icon: 'credit_card_off', title: t('error.rechargeFailed'), subtitle: t('error.rechargeFailedSub') };
      case 'subscription_failed':
        return { icon: 'card_membership', title: t('error.subscriptionFailed'), subtitle: t('error.subscriptionFailedSub') };
      case 'kyc_rejected':
        return { icon: 'gpp_bad', title: t('error.kycRejected'), subtitle: t('error.kycRejectedSub') };
      case 'account_restricted':
        return { icon: 'block', title: t('error.accountRestricted'), subtitle: t('error.accountRestrictedSub') };
      case 'chat_failed':
        return { icon: 'chat_error', title: t('error.chatFailed'), subtitle: t('error.chatFailedSub') };
      case 'generic':
      default:
        return { icon: 'error_outline', title: t('error.generic'), subtitle: t('error.genericSub') };
    }
  };

  const defaults = getDefaults(variant);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.iconCircle}>
        <Icon name={defaults.icon} />
      </View>
      <Text style={styles.title}>{title ?? defaults.title}</Text>
      <Text style={styles.subtitle}>{subtitle ?? defaults.subtitle}</Text>

      {primaryActionLabel && onPrimaryAction ? (
        <PrimaryButton
          label={primaryActionLabel}
          onPress={onPrimaryAction}
          style={styles.primaryAction}
        />
      ) : null}

      {secondaryActionLabel && onSecondaryAction ? (
        <SecondaryButton
          label={secondaryActionLabel}
          onPress={onSecondaryAction}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.gutter,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 40,
    color: colors.error,
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
    lineHeight: 22,
  },
  primaryAction: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
});

export default ErrorState;
