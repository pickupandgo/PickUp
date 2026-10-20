import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet,  FlatList } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { mockTransactions } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { TransactionRow } from '../../components/molecules/TransactionRow';
import { TabChip } from '../../components/atoms/TabChip';
import { useI18n } from '../../i18n';
import type { Transaction } from '../../types/wallet';
import type { WalletScreenProps } from '../../types/navigation';

type FilterTab = 'all' | 'credit' | 'debit';

export interface TransactionHistoryScreenProps {
  readonly navigation: WalletScreenProps<'TransactionHistory'>['navigation'];
  readonly testID?: string;
}

export const TransactionHistoryScreen: React.FC<TransactionHistoryScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredTransactions = mockTransactions.filter((txn) => {
    if (activeTab === 'all') return true;
    return txn.type === activeTab;
  });

  const renderItem = useCallback(({ item }: { item: Transaction }) => (
    <TransactionRow
      title={item.title}
      description={item.description}
      amount={item.amount}
      currency={item.currency}
      type={item.type}
      date={item.date}
    />
  ), []);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Icon name="receipt_long" style={styles.emptyIcon} />
      <Text style={styles.emptyTitle}>{t('wallet.noTransactions')}</Text>
      <Text style={styles.emptySubtitle}>
        {activeTab === 'credit'
          ? t('wallet.noCredits')
          : activeTab === 'debit'
          ? t('wallet.noDebits')
          : t('wallet.emptySubtitle')}
      </Text>
    </View>
  ), [activeTab, t]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('wallet.transactionHistory')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      {/* Filter tabs */}
      <View style={styles.tabRow}>
        <TabChip label={t('wallet.all')} selected={activeTab === 'all'} onPress={() => setActiveTab('all')} />
        <TabChip label={t('wallet.credits')} selected={activeTab === 'credit'} onPress={() => setActiveTab('credit')} />
        <TabChip label={t('wallet.debits')} selected={activeTab === 'debit'} onPress={() => setActiveTab('debit')} />
      </View>

      <FlatList
        data={filteredTransactions as Transaction[]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  separator: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg * 2,
    gap: spacing.xs,
  },
  emptyIcon: {
    fontSize: 48,
    color: colors.outline,
  },
  emptyTitle: {
    ...typography.headlineSm,
    color: colors.onSurfaceVariant,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});

export default TransactionHistoryScreen;
