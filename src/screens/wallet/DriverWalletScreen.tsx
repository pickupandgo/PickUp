import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useWallet } from '../../hooks/useWallet';
import { useEarnings } from '../../hooks/useEarnings';
import { useI18n } from '../../i18n';
import type { Transaction, TransactionCategory } from '../../types/wallet';
import type { WalletScreenProps } from '../../types/navigation';

export interface DriverWalletScreenProps {
  readonly navigation: WalletScreenProps<'DriverWallet'>['navigation'];
  readonly testID?: string;
}

const CATEGORY_ICON: Record<TransactionCategory, string> = {
  trip_earning: 'route',
  recharge: 'account_balance_wallet',
  platform_commission: 'percent',
  deduction: 'remove_circle',
  bonus: 'redeem',
  refund: 'undo',
  withdrawal: 'account_balance',
};

const formatMoney = (value: number, currency = '₹') => `${currency}${Math.round(value).toLocaleString('en-IN')}`;

export const DriverWalletScreen: React.FC<DriverWalletScreenProps> = ({ navigation, testID }) => {
  const { balance, transactions } = useWallet();
  const { summary } = useEarnings();
  const { t } = useI18n();

  const currency = balance?.currency ?? '₹';

  const handleRecharge = useCallback(() => navigation.navigate('Recharge'), [navigation]);
  const handleViewHistory = useCallback(() => navigation.navigate('TransactionHistory'), [navigation]);
  const handleMenu = useCallback(() => {
    navigation.dispatch(CommonActions.navigate('AccountTab'));
  }, [navigation]);
  const handleNotifications = useCallback(() => {
    navigation.dispatch(
      CommonActions.navigate('HomeTab', { screen: 'NotificationCenter' }),
    );
  }, [navigation]);

  const recent = transactions.slice(0, 3);

  const renderTransaction = (txn: Transaction, isLast: boolean) => {
    const isCredit = txn.type === 'credit';
    const sign = isCredit ? '+' : '-';
    return (
      <View key={txn.id} style={[styles.txnRow, !isLast && styles.txnRowBorder]}>
        <View style={styles.txnLeft}>
          <View style={styles.txnIcon}>
            <Icon name={CATEGORY_ICON[txn.category] ?? 'receipt_long'} size={20} color={colors.onSurfaceVariant} />
          </View>
          <View>
            <Text style={styles.txnTitle}>{txn.title}</Text>
            <Text style={styles.txnDate}>
              {txn.date}
              {txn.time ? `, ${txn.time}` : ''}
            </Text>
          </View>
        </View>
        <Text style={[styles.txnAmount, isCredit ? styles.txnCredit : styles.txnDebit]}>
          {sign}
          {formatMoney(txn.amount, currency)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top']}>
      {/* Top app bar */}
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={handleMenu}>
          <Icon name="menu" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>PICK UP</Text>
        <Pressable style={styles.headerBtn} onPress={handleNotifications}>
          <Icon name="notifications" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>{t('wallet.title')}</Text>

        {/* Balance */}
        <View style={styles.card}>
          <Text style={styles.balanceLabel}>{t('wallet.availableBalance')}</Text>
          <Text style={styles.balanceValue}>{formatMoney(balance?.balance ?? 0, currency)}</Text>
          <Text style={styles.balanceMin}>
            {t('wallet.minRequired', { amount: formatMoney(balance?.minimumBalance ?? 0, currency) })}
          </Text>
          <Pressable style={styles.rechargeBtn} onPress={handleRecharge} accessibilityRole="button">
            <Text style={styles.rechargeBtnText}>{t('wallet.rechargeWallet')}</Text>
          </Pressable>
        </View>

        {/* Today's Earnings */}
        <View style={styles.earningsCard}>
          <View style={styles.earningsHeader}>
            <Text style={styles.earningsHeaderText}>{t('wallet.todaysEarnings')}</Text>
          </View>
          <View style={styles.earningsBody}>
            <View>
              <Text style={styles.earningsTotal}>
                {formatMoney(summary?.netEarnings ?? summary?.totalEarnings ?? 0, currency)}
              </Text>
              <Text style={styles.earningsTrips}>{t('wallet.tripsCount', { count: summary?.totalTrips ?? 0 })}</Text>
            </View>
            <View style={styles.earningsBreakdown}>
              <View style={styles.breakdownRow}>
                <View style={[styles.dot, styles.dotMuted]} />
                <Text style={styles.breakdownText}>
                  {t('wallet.gross')}: {formatMoney(summary?.grossEarnings ?? 0, currency)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <View style={[styles.dot, styles.dotPrimary]} />
                <Text style={styles.breakdownText}>
                  {t('wallet.net')}: {formatMoney(summary?.netEarnings ?? 0, currency)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Recent Transactions */}
        <View style={styles.txnSection}>
          <Text style={styles.sectionTitle}>{t('wallet.recent')}</Text>
          {recent.length > 0 ? (
            <View style={styles.txnCard}>
              {recent.map((txn, i) => renderTransaction(txn, i === recent.length - 1))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Icon name="receipt_long" size={32} color={colors.outline} />
              <Text style={styles.emptyText}>{t('wallet.noTxns')}</Text>
            </View>
          )}
          <Pressable style={styles.viewAllBtn} onPress={handleViewHistory} accessibilityRole="button">
            <Text style={styles.viewAllText}>{t('wallet.viewAll')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    paddingHorizontal: spacing.containerPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  headerBtn: {
    padding: 4,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontWeight: '700',
    color: colors.primary,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.gutter,
  },
  pageTitle: {
    ...typography.headlineMd,
    color: colors.primary,
    paddingTop: spacing.containerPadding,
    paddingBottom: spacing.xs,
  },
  // Balance card
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    padding: spacing.containerPadding,
    gap: spacing.containerPadding,
  },
  balanceLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  balanceValue: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 2,
  },
  balanceMin: {
    ...typography.labelSm,
    color: colors.outline,
    marginTop: -spacing.xs,
  },
  rechargeBtn: {
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rechargeBtnText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
  // Earnings card
  earningsCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  earningsHeader: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLow,
  },
  earningsHeaderText: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  earningsBody: {
    padding: spacing.containerPadding,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  earningsTotal: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  earningsTrips: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  earningsBreakdown: {
    gap: 4,
    alignItems: 'flex-end',
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotMuted: {
    backgroundColor: colors.outlineVariant,
  },
  dotPrimary: {
    backgroundColor: colors.primary,
  },
  breakdownText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  // Transactions
  txnSection: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    paddingHorizontal: spacing.unit,
  },
  txnCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
  },
  txnRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  txnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  txnIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnTitle: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.primary,
  },
  txnDate: {
    ...typography.labelSm,
    color: colors.outline,
  },
  txnAmount: {
    ...typography.dataMono,
  },
  txnCredit: {
    color: colors.primary,
  },
  txnDebit: {
    color: colors.onSurfaceVariant,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  viewAllBtn: {
    height: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.gutter,
  },
  viewAllText: {
    ...typography.labelSm,
    color: colors.primary,
    letterSpacing: 0.5,
  },
});

export default DriverWalletScreen;
