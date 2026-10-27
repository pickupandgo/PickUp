import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { Skeleton } from '../skeleton';

import { useI18n } from '../../i18n';

export interface WalletCardProps {
  readonly label: string;
  readonly balance: number;
  readonly currency: string;
  readonly minimumBalance: number;
  readonly onRechargePress?: () => void;
  readonly rechargeLabel?: string;
  readonly minBalancePrefix?: string;
  readonly isLoading?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const WalletCard: React.FC<WalletCardProps> = ({
  label,
  balance,
  currency,
  minimumBalance,
  onRechargePress,
  rechargeLabel,
  minBalancePrefix,
  isLoading = false,
  style,
  testID,
}) => {
  const { t } = useI18n();
  const resolvedRecharge = rechargeLabel ?? t('home.recharge');
  const minText = minBalancePrefix !== undefined
    ? `${minBalancePrefix} ${currency}${minimumBalance.toLocaleString('en-IN')}`
    : t('home.minWallet', { amount: `${currency}${minimumBalance.toLocaleString('en-IN')}` });

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name="account_balance_wallet" style={styles.icon} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      {isLoading ? (
        <View style={{ marginVertical: 6 }} testID="wallet-card-loading">
          <Skeleton width={80} height={22} borderRadius={4} />
        </View>
      ) : (
        <Text style={styles.balance}>
          {currency}{balance.toLocaleString('en-IN')}
        </Text>
      )}
      <View style={styles.footer}>
        {isLoading ? (
          <Skeleton width={50} height={12} borderRadius={4} />
        ) : (
          <Text style={styles.minBalance}>
            {minText}
          </Text>
        )}
        {onRechargePress ? (
          <Pressable
            onPress={onRechargePress}
            style={({ pressed }) => [styles.pillButton, pressed && styles.pillButtonPressed]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={resolvedRecharge}
          >
            <Text style={styles.pillLabel}>{resolvedRecharge}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.containerPadding,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
    flex: 1,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 16,
    color: colors.primary,
  },
  label: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  balance: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  minBalance: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  pillButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  pillButtonPressed: {
    opacity: 0.8,
  },
  pillLabel: {
    ...typography.labelCaps,
    fontSize: 11,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
});

export default WalletCard;
