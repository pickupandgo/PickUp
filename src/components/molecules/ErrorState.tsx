import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../atoms/Icon';
import type { ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';

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

const variantDefaults: Record<ErrorVariant, { icon: string; title: string; subtitle: string }> = {
  network: {
    icon: 'wifi_off',
    title: 'No Internet Connection',
    subtitle: 'Please check your network connection and try again.',
  },
  location_permission: {
    icon: 'location_off',
    title: 'Location Permission Required',
    subtitle: 'MultipleRide Partner needs your location to find nearby trips and provide navigation.',
  },
  gps_unavailable: {
    icon: 'gps_off',
    title: 'GPS Unavailable',
    subtitle: 'Unable to determine your location. Please ensure GPS is enabled.',
  },
  trip_expired: {
    icon: 'timer_off',
    title: 'Trip Offer Expired',
    subtitle: 'This trip offer is no longer available. New offers will appear shortly.',
  },
  otp_error: {
    icon: 'sms_failed',
    title: 'Verification Failed',
    subtitle: 'The OTP entered is incorrect or has expired. Please try again.',
  },
  cancellation_failed: {
    icon: 'cancel',
    title: 'Cancellation Failed',
    subtitle: 'Unable to cancel the trip. Please contact support if the issue persists.',
  },
  recharge_failed: {
    icon: 'credit_card_off',
    title: 'Recharge Failed',
    subtitle: 'Unable to process your payment. Please try a different method.',
  },
  subscription_failed: {
    icon: 'card_membership',
    title: 'Subscription Failed',
    subtitle: 'Unable to activate your subscription. Please try again.',
  },
  kyc_rejected: {
    icon: 'gpp_bad',
    title: 'Document Rejected',
    subtitle: 'One or more documents were rejected. Please resubmit with clear images.',
  },
  account_restricted: {
    icon: 'block',
    title: 'Account Restricted',
    subtitle: 'Your account is under review. Contact support for assistance.',
  },
  chat_failed: {
    icon: 'chat_error',
    title: 'Message Not Sent',
    subtitle: 'Unable to send your message. Please check your connection.',
  },
  generic: {
    icon: 'error_outline',
    title: 'Something Went Wrong',
    subtitle: 'An unexpected error occurred. Please try again.',
  },
};

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
  const defaults = variantDefaults[variant];

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
