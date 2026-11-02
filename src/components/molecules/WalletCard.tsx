import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { DashboardAction } from './DashboardAction';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatRupees } from '../../services/payments/money';

export interface WalletCardProps {
  readonly label: string;
  readonly balance: number | null;
  readonly loading?: boolean;
  readonly error?: string | null;
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
  loading = false,
  error = null,
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
      {loading ? <ActivityIndicator accessibilityLabel="Loading wallet balance" /> :
        <Text style={styles.balance}>{balance === null ? '—' : formatRupees(balance, currency)}</Text>}
      {!loading && (error || balance === null) ? (
        <Text style={styles.minBalance} accessibilityLiveRegion="polite"
          accessibilityLabel={error ?? 'Balance unavailable'}>Balance unavailable</Text>
      ) : null}
      <View style={styles.footer}>
        {minimumBalance !== null ? (
          <Text style={styles.minBalance}>
            {minBalancePrefix} {formatRupees(minimumBalance, currency)}
          </Text>
        ) : (
          <View />
        )}
        {onRechargePress ? (
          <DashboardAction label={rechargeLabel} onPress={onRechargePress} style={styles.action} />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    gap: spacing.unit,
    flex: 1,
    minWidth: 0,
    minHeight: 164,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconContainer: {
    width: 24,
    height: 24,
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
    flexShrink: 1,
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
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 'auto',
  },
  minBalance: {
    flexShrink: 1,
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  action: { maxWidth: '100%' },
});

export default WalletCard;
