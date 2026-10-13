import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatRupees } from '../../services/payments/money';

export interface WalletCardProps {
  readonly label: string;
  readonly balance: number;
  readonly currency: string;
  /** Hidden when null (no minimum balance applies). */
  readonly minimumBalance: number | null;
  readonly onRechargePress?: () => void;
  readonly rechargeLabel?: string;
  readonly minBalancePrefix?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const WalletCard: React.FC<WalletCardProps> = ({
  label,
  balance,
  currency,
  minimumBalance,
  onRechargePress,
  rechargeLabel = 'RECHARGE',
  minBalancePrefix = 'Min',
  style,
  testID,
}) => {
  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name="account_balance_wallet" style={styles.icon} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.balance}>{formatRupees(balance, currency)}</Text>
      <View style={styles.footer}>
        {minimumBalance !== null ? (
          <Text style={styles.minBalance}>
            {minBalancePrefix} {formatRupees(minimumBalance, currency)}
          </Text>
        ) : (
          <View />
        )}
        {onRechargePress ? (
          <Pressable
            onPress={onRechargePress}
            style={styles.pillButton}
            accessibilityRole="button"
            accessibilityLabel={rechargeLabel}
          >
            <Text style={styles.pillLabel}>{rechargeLabel}</Text>
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
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  pillLabel: {
    ...typography.labelCaps,
    fontSize: 10,
    color: colors.onPrimaryContainer,
  },
});

export default WalletCard;
